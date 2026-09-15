import type { CollisionShipCandidate } from '../collision/CollisionSystem.ts';
import type { CargoUnloadCandidate } from '../docks/CargoSystem.ts';
import type { DockModel } from '../docks/DockModel.ts';
import type { DockApproachCandidate } from '../docks/DockingController.ts';
import type { GroundingShipCandidate } from '../grounding/GroundingSystem.ts';
import type { ShipModel } from '../ships/ShipModel.ts';
import type { SpawnDirectorActiveShip } from '../spawning/SpawnDirector.ts';

export interface HarborActiveShipRecord {
  readonly ship: ShipModel;
  readonly spawnSequence: number;
  readonly transactionId: string;
  readonly spawnPointId: string;
  readonly spawnCandidate: SpawnDirectorActiveShip;
  readonly collisionCandidate: CollisionShipCandidate;
  readonly dockCandidate: DockApproachCandidate;
  readonly previousPosition: { x: number; y: number };
  readonly groundingCandidate: GroundingShipCandidate;
  previousRotationDeg: number;
}

export interface HarborShipRegistration {
  readonly ship: ShipModel;
  readonly spawnSequence: number;
  readonly transactionId: string;
  readonly spawnPointId: string;
}

/**
 * Owns active-ship indexing and the transient candidate views derived from it.
 * HarborRuntime composes systems; it does not duplicate per-system ship lists.
 */
export class HarborShipRegistry {
  readonly #records = new Map<string, HarborActiveShipRecord>();
  readonly #spawnCandidates: SpawnDirectorActiveShip[] = [];
  readonly #collisionCandidates: CollisionShipCandidate[] = [];
  readonly #dockCandidates: DockApproachCandidate[] = [];
  readonly #groundingCandidates: GroundingShipCandidate[] = [];
  readonly #cargoCandidates: CargoUnloadCandidate[] = [];
  readonly #exitShips: ShipModel[] = [];
  readonly #landRecoveryShips: ShipModel[] = [];

  public get size(): number {
    return this.#records.size;
  }

  public get(shipId: string): HarborActiveShipRecord | undefined {
    return this.#records.get(shipId);
  }

  public values(): IterableIterator<HarborActiveShipRecord> {
    return this.#records.values();
  }

  public resolveShip(shipId: string): ShipModel | undefined {
    return this.#records.get(shipId)?.ship;
  }

  public register(input: HarborShipRegistration): HarborActiveShipRecord {
    const previousPosition = { x: input.ship.x, y: input.ship.y };
    const groundingCandidate: GroundingShipCandidate = Object.freeze({
      ship: input.ship,
      spawnSequence: input.spawnSequence,
      previousPosition,
    });
    const record: HarborActiveShipRecord = {
      ship: input.ship,
      spawnSequence: input.spawnSequence,
      transactionId: input.transactionId,
      spawnPointId: input.spawnPointId,
      spawnCandidate: Object.freeze({ ship: input.ship }),
      collisionCandidate: Object.freeze({
        ship: input.ship,
        spawnSequence: input.spawnSequence,
      }),
      dockCandidate: Object.freeze({
        ship: input.ship,
        spawnSequence: input.spawnSequence,
      }),
      previousPosition,
      groundingCandidate,
      previousRotationDeg: input.ship.rotationDeg,
    };
    this.#records.set(input.ship.id, record);
    return record;
  }

  public delete(shipId: string): boolean {
    return this.#records.delete(shipId);
  }

  public clear(): void {
    this.#records.clear();
    this.#spawnCandidates.length = 0;
    this.#collisionCandidates.length = 0;
    this.#dockCandidates.length = 0;
    this.#groundingCandidates.length = 0;
    this.#cargoCandidates.length = 0;
    this.#exitShips.length = 0;
    this.#landRecoveryShips.length = 0;
  }

  public snapshotPreviousPoses(): void {
    for (const record of this.#records.values()) {
      record.previousPosition.x = record.ship.x;
      record.previousPosition.y = record.ship.y;
      record.previousRotationDeg = record.ship.rotationDeg;
    }
  }

  public spawnCandidates(): readonly SpawnDirectorActiveShip[] {
    this.#spawnCandidates.length = 0;
    for (const record of this.#records.values()) {
      this.#spawnCandidates.push(record.spawnCandidate);
    }
    return this.#spawnCandidates;
  }

  public collisionCandidates(
    isCollidable: (ship: ShipModel) => boolean,
  ): readonly CollisionShipCandidate[] {
    this.#collisionCandidates.length = 0;
    for (const record of this.#records.values()) {
      if (isCollidable(record.ship)) {
        this.#collisionCandidates.push(record.collisionCandidate);
      }
    }
    return this.#collisionCandidates;
  }

  public groundingCandidates(
    isInManeuver: (shipId: string) => boolean,
  ): readonly GroundingShipCandidate[] {
    this.#groundingCandidates.length = 0;
    for (const record of this.#records.values()) {
      if (!isInManeuver(record.ship.id)) {
        this.#groundingCandidates.push(record.groundingCandidate);
      }
    }
    return this.#groundingCandidates;
  }

  public dockingCandidates(): readonly DockApproachCandidate[] {
    this.#dockCandidates.length = 0;
    for (const record of this.#records.values()) {
      this.#dockCandidates.push(record.dockCandidate);
    }
    return this.#dockCandidates;
  }

  public cargoCandidates(docks: Iterable<DockModel>): readonly CargoUnloadCandidate[] {
    this.#cargoCandidates.length = 0;
    for (const dock of docks) {
      const shipId = dock.occupiedBy;
      if (shipId === null) continue;
      const record = this.#records.get(shipId);
      if (record !== undefined) {
        this.#cargoCandidates.push({ ship: record.ship, dock });
      }
    }
    return this.#cargoCandidates;
  }


  public landRecoveryShips(
    isInManeuver: (shipId: string) => boolean,
  ): readonly ShipModel[] {
    this.#landRecoveryShips.length = 0;
    for (const record of this.#records.values()) {
      if (!isInManeuver(record.ship.id)) this.#landRecoveryShips.push(record.ship);
    }
    return this.#landRecoveryShips;
  }

  public exitShips(): readonly ShipModel[] {
    this.#exitShips.length = 0;
    for (const record of this.#records.values()) {
      this.#exitShips.push(record.ship);
    }
    return this.#exitShips;
  }
}
