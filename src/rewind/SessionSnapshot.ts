import type { CollisionSystemSnapshot } from '../collision/CollisionSystem.ts';
import type { GameSessionSnapshot } from '../core/GameSession.ts';
import type { FixedStepClockSnapshot } from '../core/FixedStepClock.ts';
import type { CargoSystemSnapshot } from '../docks/CargoSystem.ts';
import type { DockingControllerSnapshot } from '../docks/DockingController.ts';
import type { DockRuntimeSnapshot } from '../docks/DockModel.ts';
import type { ExitSystemSnapshot } from '../exits/ExitSystem.ts';
import type { ShipModelSnapshot } from '../ships/ShipModel.ts';
import type { IncomingSpawnSystemSnapshot } from '../spawning/IncomingSpawnSystem.ts';
import type { SpawnDirectorSnapshot } from '../spawning/SpawnDirector.ts';

export interface ActiveShipSimulationSnapshot {
  readonly ship: ShipModelSnapshot;
  readonly spawnSequence: number;
  readonly transactionId: string;
  readonly spawnPointId: string;
}

export interface SimulationSnapshot {
  readonly levelId: string;
  readonly attemptSeed: number;
  readonly session: GameSessionSnapshot;
  readonly clock: FixedStepClockSnapshot;
  readonly ships: readonly ActiveShipSimulationSnapshot[];
  readonly docks: readonly DockRuntimeSnapshot[];
  readonly director: SpawnDirectorSnapshot;
  readonly rngState: readonly number[];
  readonly nextSpawnSequence: number;
  readonly incoming: IncomingSpawnSystemSnapshot;
  readonly docking: DockingControllerSnapshot;
  readonly cargo: CargoSystemSnapshot;
  readonly exit: ExitSystemSnapshot;
  readonly collision: CollisionSystemSnapshot;
}
