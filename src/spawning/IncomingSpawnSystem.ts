import type { CargoManifest } from '../ships/ShipModel.ts';
import type { SpawnPoint } from './SpawnPoint.ts';

export interface IncomingSpawnPayload {
  readonly shipId: string;
  readonly shipType: string;
  readonly cargo: CargoManifest;
  readonly spawnSequence: number;
}

export interface IncomingSpawnRequest {
  readonly transactionId: string;
  readonly spawnPoint: SpawnPoint;
  readonly payload: IncomingSpawnPayload;
  readonly leadTimeSeconds: number;
}

export interface IncomingIndicatorCommand {
  readonly transactionId: string;
  readonly spawnPointId: string;
  readonly x: number;
  readonly y: number;
  readonly directionDeg: number;
  readonly leadTimeSeconds: number;
}

export interface ReadySpawnCommand {
  readonly transactionId: string;
  readonly spawnPointId: string;
  readonly spawnPoint: SpawnPoint;
  readonly payload: IncomingSpawnPayload;
}

export type ScheduleIncomingResult =
  | {
      readonly ok: true;
      readonly indicator: IncomingIndicatorCommand;
    }
  | {
      readonly ok: false;
      readonly reason: 'duplicate_transaction_id';
      readonly transactionId: string;
      readonly spawnPointId: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'spawn_point_pending';
      readonly transactionId: string;
      readonly spawnPointId: string;
      readonly ownerTransactionId: string;
    };

export type CancelIncomingResult =
  | {
      readonly ok: true;
      readonly transactionId: string;
      readonly spawnPointId: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'transaction_not_pending';
      readonly transactionId: string;
    };

interface PendingIncomingTransaction {
  readonly transactionId: string;
  readonly spawnPoint: SpawnPoint;
  readonly payload: IncomingSpawnPayload;
  readonly leadTimeSeconds: number;
  elapsedSeconds: number;
  readyEmitted: boolean;
}

function requireNonEmptyString(value: string, label: string): void {
  if (value.length === 0) {
    throw new RangeError(`${label} must not be empty`);
  }
}

function requireNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number`);
  }
}

function requireSpawnPoint(spawnPoint: SpawnPoint): void {
  requireNonEmptyString(spawnPoint.id, 'spawnPoint.id');
  for (const [label, value] of [
    ['spawnPoint.x', spawnPoint.x],
    ['spawnPoint.y', spawnPoint.y],
    ['spawnPoint.directionDeg', spawnPoint.directionDeg],
  ] as const) {
    if (!Number.isFinite(value)) {
      throw new RangeError(`${label} must be finite`);
    }
  }
}

function freezePayload(payload: IncomingSpawnPayload): IncomingSpawnPayload {
  requireNonEmptyString(payload.shipId, 'payload.shipId');
  requireNonEmptyString(payload.shipType, 'payload.shipType');
  if (!Number.isSafeInteger(payload.spawnSequence) || payload.spawnSequence < 0) {
    throw new RangeError('payload.spawnSequence must be a non-negative safe integer');
  }

  const cargo: Record<string, number> = {};
  for (const [cargoType, quantity] of Object.entries(payload.cargo)) {
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new RangeError(`payload.cargo.${cargoType} must be non-negative and finite`);
    }
    cargo[cargoType] = quantity;
  }

  return Object.freeze({
    shipId: payload.shipId,
    shipType: payload.shipType,
    cargo: Object.freeze(cargo),
    spawnSequence: payload.spawnSequence,
  });
}

export class IncomingSpawnSystem {
  readonly #transactions = new Map<string, PendingIncomingTransaction>();
  readonly #spawnPointOwners = new Map<string, string>();
  readonly #knownTransactionIds = new Set<string>();
  #indicatorCommands: IncomingIndicatorCommand[] = [];
  #readyCommands: ReadySpawnCommand[] = [];

  public get pendingCount(): number {
    return this.#transactions.size;
  }

  public get indicatorCount(): number {
    return this.#indicatorCommands.length;
  }

  public get readyCount(): number {
    return this.#readyCommands.length;
  }

  public isSpawnPointPending(spawnPointId: string): boolean {
    return this.#spawnPointOwners.has(spawnPointId);
  }

  public getSpawnPointOwner(spawnPointId: string): string | null {
    requireNonEmptyString(spawnPointId, 'spawnPointId');
    return this.#spawnPointOwners.get(spawnPointId) ?? null;
  }

  public schedule(request: IncomingSpawnRequest): ScheduleIncomingResult {
    requireNonEmptyString(request.transactionId, 'transactionId');
    requireSpawnPoint(request.spawnPoint);
    requireNonNegativeFinite(request.leadTimeSeconds, 'leadTimeSeconds');

    if (this.#knownTransactionIds.has(request.transactionId)) {
      return Object.freeze({
        ok: false,
        reason: 'duplicate_transaction_id',
        transactionId: request.transactionId,
        spawnPointId: request.spawnPoint.id,
      });
    }

    const ownerTransactionId = this.#spawnPointOwners.get(request.spawnPoint.id);
    if (ownerTransactionId !== undefined) {
      return Object.freeze({
        ok: false,
        reason: 'spawn_point_pending',
        transactionId: request.transactionId,
        spawnPointId: request.spawnPoint.id,
        ownerTransactionId,
      });
    }

    const payload = freezePayload(request.payload);
    const transaction: PendingIncomingTransaction = {
      transactionId: request.transactionId,
      spawnPoint: request.spawnPoint,
      payload,
      leadTimeSeconds: request.leadTimeSeconds,
      elapsedSeconds: 0,
      readyEmitted: false,
    };

    this.#knownTransactionIds.add(request.transactionId);
    this.#transactions.set(request.transactionId, transaction);
    this.#spawnPointOwners.set(request.spawnPoint.id, request.transactionId);

    const indicator = Object.freeze({
      transactionId: request.transactionId,
      spawnPointId: request.spawnPoint.id,
      x: request.spawnPoint.x,
      y: request.spawnPoint.y,
      directionDeg: request.spawnPoint.directionDeg,
      leadTimeSeconds: request.leadTimeSeconds,
    } satisfies IncomingIndicatorCommand);

    this.#indicatorCommands.push(indicator);

    return Object.freeze({
      ok: true,
      indicator,
    });
  }

  public step(deltaSeconds: number): number {
    requireNonNegativeFinite(deltaSeconds, 'deltaSeconds');

    let producedReadyCount = 0;

    for (const transaction of this.#transactions.values()) {
      if (transaction.readyEmitted) {
        continue;
      }

      transaction.elapsedSeconds += deltaSeconds;
      if (transaction.elapsedSeconds < transaction.leadTimeSeconds) {
        continue;
      }

      transaction.readyEmitted = true;
      this.#readyCommands.push(
        Object.freeze({
          transactionId: transaction.transactionId,
          spawnPointId: transaction.spawnPoint.id,
          spawnPoint: transaction.spawnPoint,
          payload: transaction.payload,
        } satisfies ReadySpawnCommand),
      );
      producedReadyCount += 1;
    }

    return producedReadyCount;
  }

  public peekIndicatorCommands(): readonly IncomingIndicatorCommand[] {
    return Object.freeze([...this.#indicatorCommands]);
  }

  public consumeIndicatorCommands(): readonly IncomingIndicatorCommand[] {
    const commands = this.#indicatorCommands;
    this.#indicatorCommands = [];
    return Object.freeze(commands);
  }

  public peekReadySpawns(): readonly ReadySpawnCommand[] {
    return Object.freeze([...this.#readyCommands]);
  }

  public consumeReadySpawns(): readonly ReadySpawnCommand[] {
    const commands = this.#readyCommands;
    this.#readyCommands = [];

    for (const command of commands) {
      this.#release(command.transactionId);
    }

    return Object.freeze(commands);
  }

  public cancel(transactionId: string): CancelIncomingResult {
    requireNonEmptyString(transactionId, 'transactionId');

    const transaction = this.#transactions.get(transactionId);
    if (transaction === undefined) {
      return Object.freeze({
        ok: false,
        reason: 'transaction_not_pending',
        transactionId,
      });
    }

    this.#readyCommands = this.#readyCommands.filter(
      (command) => command.transactionId !== transactionId,
    );
    this.#release(transactionId);

    return Object.freeze({
      ok: true,
      transactionId,
      spawnPointId: transaction.spawnPoint.id,
    });
  }

  #release(transactionId: string): void {
    const transaction = this.#transactions.get(transactionId);
    if (transaction === undefined) {
      return;
    }

    this.#transactions.delete(transactionId);
    if (this.#spawnPointOwners.get(transaction.spawnPoint.id) === transactionId) {
      this.#spawnPointOwners.delete(transaction.spawnPoint.id);
    }
  }
}
