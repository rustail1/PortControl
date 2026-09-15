import type { CollisionSystem } from '../collision/CollisionSystem.ts';
import type { FixedStepClock } from '../core/FixedStepClock.ts';
import type { GameSession, GameSessionSnapshot } from '../core/GameSession.ts';
import type { SeededRng } from '../core/SeededRng.ts';
import type { CargoSystem } from '../docks/CargoSystem.ts';
import type { DockCollection, DockRuntimeSnapshot } from '../docks/DockModel.ts';
import type { DockingController } from '../docks/DockingController.ts';
import type { ExitSystem } from '../exits/ExitSystem.ts';
import type { SimulationSnapshot } from '../rewind/SessionSnapshot.ts';
import {
  SimulationSnapshotService,
  type SnapshotBoundaryState,
} from '../rewind/SimulationSnapshotService.ts';
import { ShipModel, type ShipModelSnapshot } from '../ships/ShipModel.ts';
import type { ShipCharacteristicsRegistry } from '../ships/ShipCharacteristics.ts';
import type { SpawnDirectorSnapshot } from '../spawning/SpawnDirector.ts';
import type { HarborShipRegistry } from './HarborShipRegistry.ts';
import type { HarborSpawnCoordinator } from './HarborSpawnCoordinator.ts';

export interface HarborAuthoritativeSnapshot {
  readonly levelId: string;
  readonly attemptSeed: number;
  readonly session: GameSessionSnapshot;
  readonly ships: readonly Readonly<{
    ship: ShipModelSnapshot;
    spawnSequence: number;
  }>[];
  readonly docks: readonly DockRuntimeSnapshot[];
  readonly director: SpawnDirectorSnapshot;
  readonly rngState: readonly number[];
  readonly queuedRouteCommands: number;
  readonly pendingIncoming: number;
}

export interface HarborSnapshotCoordinatorOptions {
  readonly levelId: string;
  readonly attemptSeed: number;
  readonly session: GameSession;
  readonly clock: FixedStepClock;
  readonly rng: SeededRng;
  readonly characteristics: ShipCharacteristicsRegistry;
  readonly docks: DockCollection;
  readonly ships: HarborShipRegistry;
  readonly spawning: HarborSpawnCoordinator;
  readonly docking: DockingController;
  readonly cargo: CargoSystem;
  readonly exit: ExitSystem;
  readonly collision: CollisionSystem;
}

/**
 * Owns authoritative snapshot assembly/restore. Presentation and input cleanup
 * stay in HarborRuntime because they are explicitly non-authoritative state.
 */
export class HarborSnapshotCoordinator {
  readonly #levelId: string;
  readonly #attemptSeed: number;
  readonly #session: GameSession;
  readonly #clock: FixedStepClock;
  readonly #rng: SeededRng;
  readonly #characteristics: ShipCharacteristicsRegistry;
  readonly #docks: DockCollection;
  readonly #ships: HarborShipRegistry;
  readonly #spawning: HarborSpawnCoordinator;
  readonly #docking: DockingController;
  readonly #cargo: CargoSystem;
  readonly #exit: ExitSystem;
  readonly #collision: CollisionSystem;
  readonly #snapshots = new SimulationSnapshotService();

  public constructor(options: HarborSnapshotCoordinatorOptions) {
    this.#levelId = options.levelId;
    this.#attemptSeed = options.attemptSeed;
    this.#session = options.session;
    this.#clock = options.clock;
    this.#rng = options.rng;
    this.#characteristics = options.characteristics;
    this.#docks = options.docks;
    this.#ships = options.ships;
    this.#spawning = options.spawning;
    this.#docking = options.docking;
    this.#cargo = options.cargo;
    this.#exit = options.exit;
    this.#collision = options.collision;
  }

  public authoritativeSnapshot(queuedRouteCommands: number): HarborAuthoritativeSnapshot {
    const ships = [...this.#ships.values()]
      .sort((left, right) => left.spawnSequence - right.spawnSequence)
      .map((record) => Object.freeze({
        ship: record.ship.toSnapshot(),
        spawnSequence: record.spawnSequence,
      }));
    const docks = [...this.#docks.values()].map((dock) =>
      Object.freeze({ ...dock.toRuntimeSnapshot() }),
    );
    return Object.freeze({
      levelId: this.#levelId,
      attemptSeed: this.#attemptSeed,
      session: this.#session.toSnapshot(),
      ships: Object.freeze(ships),
      docks: Object.freeze(docks),
      director: this.#spawning.directorSnapshot(),
      rngState: Object.freeze([...this.#rng.getState()]),
      queuedRouteCommands,
      pendingIncoming: this.#spawning.pendingCount,
    });
  }

  public captureSimulationSnapshot(boundary: SnapshotBoundaryState): SimulationSnapshot {
    const ships = [...this.#ships.values()]
      .sort((left, right) => left.spawnSequence - right.spawnSequence)
      .map((record) => Object.freeze({
        ship: record.ship.toSnapshot(),
        spawnSequence: record.spawnSequence,
        transactionId: record.transactionId,
        spawnPointId: record.spawnPointId,
      }));
    const snapshot: SimulationSnapshot = Object.freeze({
      levelId: this.#levelId,
      attemptSeed: this.#attemptSeed,
      session: this.#session.toSnapshot(),
      clock: this.#clock.toSnapshot(),
      ships: Object.freeze(ships),
      docks: Object.freeze(
        [...this.#docks.values()].map((dock) =>
          Object.freeze({ ...dock.toRuntimeSnapshot() }),
        ),
      ),
      director: this.#spawning.directorSnapshot(),
      rngState: Object.freeze([...this.#rng.getState()]),
      nextSpawnSequence: this.#spawning.nextSpawnSequence,
      incoming: this.#spawning.incomingSnapshot(),
      docking: this.#docking.toSnapshot(),
      cargo: this.#cargo.toSnapshot(),
      exit: this.#exit.toSnapshot(),
      collision: this.#collision.toSnapshot(),
    });
    return this.#snapshots.capture(snapshot, boundary);
  }

  public restoreSimulationSnapshot(snapshot: SimulationSnapshot): void {
    if (
      snapshot.levelId !== this.#levelId ||
      snapshot.attemptSeed !== this.#attemptSeed
    ) {
      throw new RangeError('simulation snapshot belongs to another attempt');
    }

    this.#session.restore(snapshot.session);
    this.#rng.setState(snapshot.rngState);

    const docksById = new Map(
      [...this.#docks.values()].map((dock) => [dock.id, dock] as const),
    );
    for (const dockSnapshot of snapshot.docks) {
      const dock = docksById.get(dockSnapshot.id);
      if (dock === undefined) {
        throw new RangeError(`snapshot references unknown dock: ${dockSnapshot.id}`);
      }
      dock.restoreRuntime(dockSnapshot);
    }

    this.#ships.clear();
    for (const item of snapshot.ships) {
      const ship = ShipModel.restore(item.ship, this.#characteristics);
      this.#ships.register({
        ship,
        spawnSequence: item.spawnSequence,
        transactionId: item.transactionId,
        spawnPointId: item.spawnPointId,
      });
    }

    const resolveShip = (id: string): ShipModel | null =>
      this.#ships.get(id)?.ship ?? null;
    const resolveDock = (id: string) => this.#docks.get(id) ?? null;
    this.#docking.restore(snapshot.docking, resolveShip);
    this.#cargo.restore(snapshot.cargo, resolveShip, resolveDock);
    this.#exit.restore(snapshot.exit, resolveShip);
    this.#collision.restore(snapshot.collision);
    this.#spawning.restore({
      director: snapshot.director,
      incoming: snapshot.incoming,
      nextSpawnSequence: snapshot.nextSpawnSequence,
    }, this.#session.simulationTime);
    this.#clock.restore(snapshot.clock);
  }
}
