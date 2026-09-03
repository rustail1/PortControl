import { normalizeRotationDeg, type ShipModel } from '../ships/ShipModel.ts';
import { ShipState } from '../ships/ShipState.ts';
import type { DockCollection, DockModel } from './DockModel.ts';
import type { DockingConfig } from './DockingConfig.ts';
import type { DockSystem } from './DockSystem.ts';

export interface DockApproachCandidate {
  readonly ship: ShipModel;
  readonly spawnSequence: number;
}

export interface DockingControllerOptions {
  readonly docks: DockCollection;
  readonly dockSystem: DockSystem;
  readonly config: DockingConfig;
  readonly resolveSnapDurationMs?: (baseSnapDurationMs: number) => number;
}

export interface DockingStepResult {
  readonly reservedShipIds: readonly string[];
  readonly startedShipIds: readonly string[];
  readonly completedShipIds: readonly string[];
  readonly cancelledShipIds: readonly string[];
  readonly invariantShipIds: readonly string[];
}

interface TransactionIdentity {
  readonly shipId: string;
  readonly dockId: string;
}

interface AwaitingSnap extends TransactionIdentity {
  readonly phase: 'awaiting_snap';
}

interface Snapping extends TransactionIdentity {
  readonly phase: 'snapping';
  readonly startX: number;
  readonly startY: number;
  readonly startRotationDeg: number;
  readonly elapsedMs: number;
  readonly durationMs: number;
}

type DockingTransaction = AwaitingSnap | Snapping;

interface Nomination {
  readonly candidate: DockApproachCandidate;
  readonly dock: DockModel;
  readonly distanceSquared: number;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNomination(left: Nomination, right: Nomination): number {
  return left.distanceSquared - right.distanceSquared
    || left.candidate.spawnSequence - right.candidate.spawnSequence;
}

function interpolateRotation(startDeg: number, targetDeg: number, progress: number): number {
  const start = normalizeRotationDeg(startDeg);
  const target = normalizeRotationDeg(targetDeg);
  const delta = ((target - start + 540) % 360) - 180;
  return normalizeRotationDeg(start + delta * progress);
}

function distanceSquared(ship: ShipModel, dock: DockModel): number {
  const dx = ship.x - dock.definition.position.x;
  const dy = ship.y - dock.definition.position.y;
  return dx * dx + dy * dy;
}

export class DockingController {
  readonly #docks: DockCollection;
  readonly #dockSystem: DockSystem;
  readonly #config: DockingConfig;
  readonly #resolveSnapDurationMs: (baseSnapDurationMs: number) => number;
  readonly #transactions = new Map<string, DockingTransaction>();

  public constructor(options: DockingControllerOptions) {
    this.#docks = options.docks;
    this.#dockSystem = options.dockSystem;
    this.#config = options.config;
    this.#resolveSnapDurationMs = options.resolveSnapDurationMs ?? ((base) => base);
  }

  public step(candidates: readonly DockApproachCandidate[], deltaSeconds: number): DockingStepResult {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('deltaSeconds must be non-negative and finite');
    const ships = this.#indexCandidates(candidates);
    const result = { reservedShipIds: [] as string[], startedShipIds: [] as string[], completedShipIds: [] as string[], cancelledShipIds: [] as string[], invariantShipIds: [] as string[] };
    this.#advanceTransactions(ships, deltaSeconds * 1000, result);
    this.#arbitrate(candidates, result);
    return Object.freeze({
      reservedShipIds: Object.freeze(result.reservedShipIds),
      startedShipIds: Object.freeze(result.startedShipIds),
      completedShipIds: Object.freeze(result.completedShipIds),
      cancelledShipIds: Object.freeze(result.cancelledShipIds),
      invariantShipIds: Object.freeze(result.invariantShipIds),
    });
  }

  public isShipCollidable(ship: ShipModel): boolean {
    if (ship.state === ShipState.Unloading || ship.state === ShipState.Destroyed) return false;
    if (ship.state === ShipState.ApproachingDock || ship.state === ShipState.Docking) {
      return this.#config.collisionEnabledUntilSnapComplete;
    }
    return true;
  }

  #indexCandidates(candidates: readonly DockApproachCandidate[]): ReadonlyMap<string, ShipModel> {
    const ships = new Map<string, ShipModel>();
    const sequences = new Set<number>();
    for (const candidate of candidates) {
      if (!Number.isInteger(candidate.spawnSequence) || candidate.spawnSequence < 0) throw new RangeError('spawnSequence must be a non-negative integer');
      if (ships.has(candidate.ship.id) || sequences.has(candidate.spawnSequence)) throw new RangeError('candidates must have unique ship ids and spawn sequences');
      ships.set(candidate.ship.id, candidate.ship);
      sequences.add(candidate.spawnSequence);
    }
    return ships;
  }

  #advanceTransactions(ships: ReadonlyMap<string, ShipModel>, elapsedMs: number, result: { startedShipIds: string[]; completedShipIds: string[]; cancelledShipIds: string[]; invariantShipIds: string[] }): void {
    const transactions = [...this.#transactions.values()].sort((left, right) => compareOrdinal(left.shipId, right.shipId));
    for (const transaction of transactions) {
      const ship = ships.get(transaction.shipId);
      const dock = this.#docks.get(transaction.dockId);
      if (ship === undefined || dock === undefined) {
        this.#transactions.delete(transaction.shipId);
        result.invariantShipIds.push(transaction.shipId);
        continue;
      }
      if (ship.state === ShipState.Destroyed) {
        this.#dockSystem.releaseReservation(dock, ship.id);
        this.#transactions.delete(ship.id);
        result.cancelledShipIds.push(ship.id);
        continue;
      }
      if (dock.reservedBy !== ship.id) {
        this.#transactions.delete(ship.id);
        result.invariantShipIds.push(ship.id);
        continue;
      }
      if (transaction.phase === 'awaiting_snap') {
        const durationMs = this.#resolveSnapDurationMs(this.#config.baseSnapDurationMs);
        if (!Number.isFinite(durationMs) || durationMs <= 0) throw new RangeError('effective snap duration must be positive and finite');
        const snapping: Snapping = {
          phase: 'snapping', shipId: ship.id, dockId: dock.id, startX: ship.x, startY: ship.y,
          startRotationDeg: ship.rotationDeg, elapsedMs: 0, durationMs,
        };
        this.#transactions.set(ship.id, snapping);
        ship.setState(ShipState.Docking);
        result.startedShipIds.push(ship.id);
        this.#advanceSnap(snapping, ship, dock, elapsedMs, result);
      } else {
        this.#advanceSnap(transaction, ship, dock, elapsedMs, result);
      }
    }
  }

  #advanceSnap(transaction: Snapping, ship: ShipModel, dock: DockModel, deltaMs: number, result: { completedShipIds: string[]; invariantShipIds: string[] }): void {
    const elapsedMs = transaction.elapsedMs + deltaMs;
    const progress = Math.min(Math.max(elapsedMs / transaction.durationMs, 0), 1);
    ship.setPositionXY(
      transaction.startX + (dock.definition.position.x - transaction.startX) * progress,
      transaction.startY + (dock.definition.position.y - transaction.startY) * progress,
    );
    ship.setRotationDeg(interpolateRotation(transaction.startRotationDeg, dock.definition.dockAngle, progress));
    if (progress < 1) {
      this.#transactions.set(ship.id, { ...transaction, elapsedMs });
      return;
    }
    ship.setPositionXY(dock.definition.position.x, dock.definition.position.y);
    ship.setRotationDeg(dock.definition.dockAngle);
    this.#transactions.delete(ship.id);
    if (!this.#dockSystem.occupyReserved(dock, ship.id)) {
      result.invariantShipIds.push(ship.id);
      return;
    }
    ship.setState(ShipState.Unloading);
    result.completedShipIds.push(ship.id);
  }

  #arbitrate(candidates: readonly DockApproachCandidate[], result: { reservedShipIds: string[] }): void {
    const docks = [...this.#docks.values()].sort((left, right) => compareOrdinal(left.id, right.id));
    const nominations: Nomination[] = [];
    for (const candidate of candidates) {
      if (candidate.ship.state !== ShipState.Navigating || this.#transactions.has(candidate.ship.id)) continue;
      let nomination: Nomination | null = null;
      for (const dock of docks) {
        const squared = distanceSquared(candidate.ship, dock);
        if (squared > dock.definition.snapRadius * dock.definition.snapRadius || this.#dockSystem.classify(dock, candidate.ship).status !== 'eligible') continue;
        if (nomination === null || squared < nomination.distanceSquared || (squared === nomination.distanceSquared && compareOrdinal(dock.id, nomination.dock.id) < 0)) {
          nomination = { candidate, dock, distanceSquared: squared };
        }
      }
      if (nomination !== null) nominations.push(nomination);
    }
    const winnersByDock = new Map<string, Nomination>();
    for (const nomination of nominations) {
      const existing = winnersByDock.get(nomination.dock.id);
      if (existing === undefined || compareNomination(nomination, existing) < 0) winnersByDock.set(nomination.dock.id, nomination);
    }
    for (const winner of [...winnersByDock.values()].sort((left, right) => compareOrdinal(left.dock.id, right.dock.id))) {
      if (this.#dockSystem.reserve(winner.dock, winner.candidate.ship).status !== 'eligible') continue;
      winner.candidate.ship.setState(ShipState.ApproachingDock);
      this.#transactions.set(winner.candidate.ship.id, { phase: 'awaiting_snap', shipId: winner.candidate.ship.id, dockId: winner.dock.id });
      result.reservedShipIds.push(winner.candidate.ship.id);
    }
  }
}
