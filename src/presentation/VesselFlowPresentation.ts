import type { Point, Size } from '../camera/SquareWorldViewport.ts';
import type { IncomingIndicatorCommand } from '../spawning/IncomingSpawnSystem.ts';

export interface CargoPipPosition extends Point {}

export function createCargoPipLayout(cargoTotal: number): readonly CargoPipPosition[] {
  if (!Number.isInteger(cargoTotal) || cargoTotal < 0) {
    throw new RangeError('cargoTotal must be a non-negative integer');
  }
  return Object.freeze(
    Array.from({ length: cargoTotal }, (_, index) => Object.freeze({
      x: (index - (cargoTotal - 1) / 2) * 8,
      y: 0,
    })),
  );
}

export interface IncomingVesselPresentationSnapshot {
  readonly transactionId: string;
  readonly spawnPointId: string;
  readonly shipId: string;
  readonly shipType: string;
  readonly position: Point;
  readonly originPosition: Point;
  readonly spawnPosition: Point;
  readonly rotationDeg: number;
  readonly collisionRadius: number;
}

export function createIncomingVesselPresentation(input: {
  readonly indicator: IncomingIndicatorCommand;
  readonly elapsedSeconds: number;
  readonly speed: number;
  readonly collisionRadius: number;
}): IncomingVesselPresentationSnapshot {
  const elapsedSeconds = Math.min(
    Math.max(input.elapsedSeconds, 0),
    input.indicator.leadTimeSeconds,
  );
  const remainingSeconds = input.indicator.leadTimeSeconds - elapsedSeconds;
  const radians = (input.indicator.directionDeg * Math.PI) / 180;
  const originPosition = Object.freeze({
    x: input.indicator.x - Math.cos(radians) * input.speed * input.indicator.leadTimeSeconds,
    y: input.indicator.y - Math.sin(radians) * input.speed * input.indicator.leadTimeSeconds,
  });
  return Object.freeze({
    transactionId: input.indicator.transactionId,
    spawnPointId: input.indicator.spawnPointId,
    shipId: input.indicator.shipId,
    shipType: input.indicator.shipType,
    position: Object.freeze({
      x: input.indicator.x - Math.cos(radians) * input.speed * remainingSeconds,
      y: input.indicator.y - Math.sin(radians) * input.speed * remainingSeconds,
    }),
    originPosition,
    spawnPosition: Object.freeze({ x: input.indicator.x, y: input.indicator.y }),
    rotationDeg: input.indicator.directionDeg,
    collisionRadius: input.collisionRadius,
  });
}

export interface DeparturePresentationInit {
  readonly shipId: string;
  readonly shipType: string;
  readonly position: Point;
  readonly rotationDeg: number;
  readonly speed: number;
  readonly collisionRadius: number;
}

export interface DeparturePresentationSnapshot extends DeparturePresentationInit {}

interface DepartureRecord {
  readonly shipId: string;
  readonly shipType: string;
  readonly rotationDeg: number;
  readonly speed: number;
  readonly collisionRadius: number;
  x: number;
  y: number;
}

export class DeparturePresentationStore {
  readonly #world: Size;
  readonly #records = new Map<string, DepartureRecord>();

  public constructor(world: Size) {
    this.#world = Object.freeze({ ...world });
  }

  public add(init: DeparturePresentationInit): void {
    this.#records.set(init.shipId, {
      shipId: init.shipId,
      shipType: init.shipType,
      x: init.position.x,
      y: init.position.y,
      rotationDeg: init.rotationDeg,
      speed: init.speed,
      collisionRadius: init.collisionRadius,
    });
  }

  public advance(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError('deltaSeconds must be a non-negative finite number');
    }
    for (const [shipId, record] of this.#records) {
      const radians = (record.rotationDeg * Math.PI) / 180;
      record.x += Math.cos(radians) * record.speed * deltaSeconds;
      record.y += Math.sin(radians) * record.speed * deltaSeconds;
      if (this.#fullyOutside(record)) this.#records.delete(shipId);
    }
  }

  public snapshot(): readonly DeparturePresentationSnapshot[] {
    return Object.freeze(
      [...this.#records.values()].map((record) => Object.freeze({
        shipId: record.shipId,
        shipType: record.shipType,
        position: Object.freeze({ x: record.x, y: record.y }),
        rotationDeg: record.rotationDeg,
        speed: record.speed,
        collisionRadius: record.collisionRadius,
      })),
    );
  }

  #fullyOutside(record: DepartureRecord): boolean {
    return (
      record.x + record.collisionRadius < 0 ||
      record.x - record.collisionRadius > this.#world.width ||
      record.y + record.collisionRadius < 0 ||
      record.y - record.collisionRadius > this.#world.height
    );
  }
}
