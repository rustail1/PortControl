import type { ConfigBundle } from '../config/types.ts';
import type { Size } from '../camera/SquareWorldViewport.ts';
import type { GameSession } from '../core/GameSession.ts';
import type { SeededRng } from '../core/SeededRng.ts';
import type { DockModel } from '../docks/DockModel.ts';
import {
  createIncomingSpawnWarningPresentation,
  type IncomingSpawnWarningPresentationSnapshot,
} from '../presentation/IncomingSpawnWarningPresentation.ts';
import {
  createIncomingVesselPresentation,
  type IncomingVesselPresentationSnapshot,
} from '../presentation/VesselFlowPresentation.ts';
import type { ShipCharacteristicsRegistry } from '../ships/ShipCharacteristics.ts';
import {
  IncomingSpawnSystem,
  type IncomingIndicatorCommand,
  type IncomingSpawnSystemSnapshot,
} from '../spawning/IncomingSpawnSystem.ts';
import { ShipSpawner } from '../spawning/ShipSpawner.ts';
import {
  createSpawnDirectorConfig,
  SpawnDirector,
  type SpawnDirectorInput,
  type SpawnDirectorSnapshot,
} from '../spawning/SpawnDirector.ts';
import type { SpawnPoint } from '../spawning/SpawnPoint.ts';
import type { HarborShipRegistry } from './HarborShipRegistry.ts';

interface IncomingPresentationRecord {
  readonly indicator: IncomingIndicatorCommand;
  readonly startedAtSeconds: number;
}

export interface HarborSpawnCoordinatorOptions {
  readonly bundle: ConfigBundle;
  readonly levelId: string;
  readonly spawnPoints: readonly SpawnPoint[];
  readonly characteristics: ShipCharacteristicsRegistry;
  readonly rng: SeededRng;
  readonly session: GameSession;
  readonly ships: HarborShipRegistry;
  readonly docks: () => Iterable<DockModel>;
}

export interface HarborSpawnSnapshotState {
  readonly director: SpawnDirectorSnapshot;
  readonly incoming: IncomingSpawnSystemSnapshot;
  readonly nextSpawnSequence: number;
}

function cloneIndicator(command: IncomingIndicatorCommand): IncomingIndicatorCommand {
  return Object.freeze({ ...command });
}

/** Owns spawn director/incoming transaction orchestration and identity allocation. */
export class HarborSpawnCoordinator {
  readonly #incoming = new IncomingSpawnSystem();
  readonly #spawner: ShipSpawner;
  readonly #director: SpawnDirector;
  readonly #characteristics: ShipCharacteristicsRegistry;
  readonly #session: GameSession;
  readonly #ships: HarborShipRegistry;
  readonly #docks: HarborSpawnCoordinatorOptions['docks'];
  readonly #indicators = new Map<string, IncomingPresentationRecord>();
  #nextSpawnSequence = 0;

  public constructor(options: HarborSpawnCoordinatorOptions) {
    this.#characteristics = options.characteristics;
    this.#session = options.session;
    this.#ships = options.ships;
    this.#docks = options.docks;
    this.#spawner = new ShipSpawner(options.characteristics);
    this.#director = new SpawnDirector({
      config: createSpawnDirectorConfig(options.bundle, options.levelId),
      spawnPoints: options.spawnPoints,
      characteristics: options.characteristics,
      rng: options.rng,
      allocateIdentity: () => {
        const spawnSequence = this.#nextSpawnSequence;
        this.#nextSpawnSequence += 1;
        return Object.freeze({
          shipId: `ship-${spawnSequence}`,
          spawnSequence,
          logicalSpawnId: `spawn-${spawnSequence}`,
        });
      },
    });
  }

  public get pendingCount(): number {
    return this.#incoming.pendingCount;
  }

  public directorSnapshot(): SpawnDirectorSnapshot {
    return this.#director.toSnapshot();
  }

  public incomingSnapshot(): IncomingSpawnSystemSnapshot {
    return this.#incoming.toSnapshot();
  }

  public get nextSpawnSequence(): number {
    return this.#nextSpawnSequence;
  }

  public presentationSnapshot(
    simulationTime: number,
  ): readonly IncomingVesselPresentationSnapshot[] {
    return Object.freeze(
      [...this.#indicators.values()].map((record) => {
        const characteristics = this.#characteristics.require(
          record.indicator.shipType,
        );
        return createIncomingVesselPresentation({
          indicator: record.indicator,
          elapsedSeconds: simulationTime - record.startedAtSeconds,
          speed: characteristics.speed,
          collisionRadius: characteristics.collisionRadius,
        });
      }),
    );
  }

  public warningPresentationSnapshot(
    simulationTime: number,
    world: Size,
  ): readonly IncomingSpawnWarningPresentationSnapshot[] {
    const warnings: IncomingSpawnWarningPresentationSnapshot[] = [];
    for (const record of this.#indicators.values()) {
      const warning = createIncomingSpawnWarningPresentation({
        source: {
          transactionId: record.indicator.transactionId,
          spawnPointId: record.indicator.spawnPointId,
          spawnPosition: {
            x: record.indicator.x,
            y: record.indicator.y,
          },
          leadTimeSeconds: record.indicator.leadTimeSeconds,
          elapsedSeconds: simulationTime - record.startedAtSeconds,
        },
        world,
      });
      if (warning !== null) warnings.push(warning);
    }
    return Object.freeze(warnings);
  }

  public step(deltaSeconds: number): void {
    const pendingAtPhaseStart = this.#incoming.pendingCount > 0;
    const simulationTime = this.#session.simulationTime;
    const directorResult = this.#director.step(
      this.#createDirectorInput(simulationTime),
    );

    if (pendingAtPhaseStart) {
      this.#incoming.step(deltaSeconds);
      this.#resolveReadySpawns(simulationTime);
    }

    if (directorResult.kind === 'schedule_incoming') {
      const scheduled = this.#incoming.schedule(directorResult.command);
      if (scheduled.ok) {
        this.#director.confirmScheduled(
          directorResult.command.transactionId,
          simulationTime,
        );
      } else {
        this.#director.rejectScheduled(
          directorResult.command.transactionId,
          simulationTime,
        );
      }
    }

    for (const indicator of this.#incoming.consumeIndicatorCommands()) {
      this.#indicators.set(indicator.transactionId, {
        indicator: cloneIndicator(indicator),
        startedAtSeconds: simulationTime + deltaSeconds,
      });
    }
  }

  public restore(state: HarborSpawnSnapshotState, simulationTime: number): void {
    this.#director.restore(state.director);
    this.#nextSpawnSequence = state.nextSpawnSequence;
    this.#incoming.restore(state.incoming);
    this.#indicators.clear();
    for (const transaction of state.incoming.transactions) {
      this.#indicators.set(transaction.transactionId, {
        indicator: Object.freeze({
          transactionId: transaction.transactionId,
          spawnPointId: transaction.spawnPoint.id,
          shipId: transaction.payload.shipId,
          shipType: transaction.payload.shipType,
          x: transaction.spawnPoint.x,
          y: transaction.spawnPoint.y,
          directionDeg: transaction.spawnPoint.directionDeg,
          leadTimeSeconds: transaction.leadTimeSeconds,
        }),
        startedAtSeconds: simulationTime - transaction.elapsedSeconds,
      });
    }
  }

  public clearPresentation(): void {
    this.#indicators.clear();
  }

  #resolveReadySpawns(simulationTime: number): void {
    const ready = this.#incoming.peekReadySpawns();
    if (ready.length === 0) return;

    for (const command of ready) {
      const resolution = this.#director.resolveReadySpawn(
        command,
        this.#createDirectorInput(simulationTime),
      );
      const consumed = this.#incoming.consumeReadySpawns();
      const approved = consumed.find(
        (candidate) => candidate.transactionId === command.transactionId,
      );
      if (approved === undefined) {
        throw new Error('approved ReadySpawn was not consumable');
      }
      const spawned = this.#spawner.materialize(approved);
      this.#ships.register(spawned);
      this.#session.registerSpawnedShip({
        shipId: spawned.ship.id,
        shipType: spawned.ship.characteristics.type,
        initialCargo: approved.payload.cargo,
      });
      this.#director.confirmMaterialized(resolution.logicalSpawnId);
      this.#indicators.delete(command.transactionId);
      break;
    }
  }

  #createDirectorInput(simulationTime: number): SpawnDirectorInput {
    let occupiedDockCount = 0;
    for (const dock of this.#docks()) {
      if (dock.occupiedBy !== null) occupiedDockCount += 1;
    }
    return {
      simulationTime,
      activeShips: this.#ships.spawnCandidates(),
      occupiedDockCount,
      activeStormCellCount: 0,
      getSpawnPointOwner: (spawnPointId) =>
        this.#incoming.getSpawnPointOwner(spawnPointId),
    };
  }
}
