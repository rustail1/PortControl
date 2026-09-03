import type { ConfigBundle } from '../config/types.ts';
import type { IRng } from '../core/SeededRng.ts';
import { participatesInShipCollision } from '../collision/CollisionSystem.ts';
import {
  ShipState,
  type CargoManifest,
  type ShipCharacteristicsRegistry,
  type ShipModel,
} from '../ships/index.ts';
import type {
  IncomingSpawnRequest,
  ReadySpawnCommand,
} from './IncomingSpawnSystem.ts';
import type { SpawnPoint } from './SpawnPoint.ts';
import { pickWeightedSpawnPoint } from './WeightedSpawnPointPicker.ts';

export interface SpawnIdentity {
  readonly shipId: string;
  readonly spawnSequence: number;
  readonly logicalSpawnId: string;
}

export type AllocateSpawnIdentity = () => SpawnIdentity;

export interface SpawnDirectorWaveConfig {
  readonly burstMin: number;
  readonly burstMax: number;
  readonly breathMin: number;
  readonly breathMax: number;
}

export interface SpawnDirectorLevelConfig {
  readonly levelId: string;
  readonly allowedShips: readonly string[];
  readonly shipWeights: Readonly<Record<string, number>>;
  readonly cargoTypes: readonly string[];
  readonly cargoGeneration: {
    readonly mode: 'single' | 'mixed';
    readonly weights: Readonly<Record<string, number>>;
    readonly multiCargoChance: number;
  };
  readonly director: {
    readonly startInterval: number;
    readonly minimumInterval: number;
    readonly warningLeadTime: number;
    readonly maxAlive: number;
    readonly pressureCap: number;
    readonly jitter: number;
    readonly wave: SpawnDirectorWaveConfig;
  };
  readonly scriptedIntroShip: string | null;
}

export interface SpawnDirectorBalanceConfig {
  readonly occupiedDockPressureWeight: number;
  readonly activeStormCellPressureWeight: number;
  readonly unsafeSpawnRetryDelayMs: number;
}

export interface SpawnDirectorConfig {
  readonly level: SpawnDirectorLevelConfig;
  readonly balance: SpawnDirectorBalanceConfig;
}

export interface SpawnDirectorActiveShip {
  readonly ship: ShipModel;
}

export interface SpawnDirectorInput {
  readonly simulationTime: number;
  readonly activeShips: readonly SpawnDirectorActiveShip[];
  readonly occupiedDockCount: number;
  readonly activeStormCellCount: number;
  readonly getSpawnPointOwner: (spawnPointId: string) => string | null;
}

export interface SpawnPressureSnapshot {
  readonly pressure: number;
  readonly activeShips: number;
}

export type SpawnDirectorStepResult =
  | {
      readonly kind: 'noop';
      readonly reason:
        | 'not_due'
        | 'gate_blocked'
        | 'unresolved'
        | 'retry_wait'
        | 'unsafe_spawn';
      readonly pressure: number;
      readonly activeShips: number;
    }
  | {
      readonly kind: 'schedule_incoming';
      readonly logicalSpawnId: string;
      readonly command: IncomingSpawnRequest;
      readonly pressure: number;
      readonly activeShips: number;
    };

export type ReadySpawnResolution =
  | {
      readonly kind: 'approved';
      readonly logicalSpawnId: string;
      readonly command: ReadySpawnCommand;
      readonly pressure: number;
      readonly aliveShips: number;
      readonly shipType: string;
    }
  | {
      readonly kind: 'retry';
      readonly logicalSpawnId: string;
      readonly transactionId: string;
      readonly retryDueTime: number;
      readonly pressure: number;
      readonly aliveShips: number;
    };

interface LogicalSpawnEvent {
  readonly identity: SpawnIdentity;
  readonly shipType: string;
  readonly cargo: CargoManifest;
  readonly scriptedIntro: boolean;
  readonly burstOrdinal: number;
  readonly burstTarget: number;
  placementAttempt: number;
  spawnPointId: string | null;
  transactionId: string | null;
  scheduled: boolean;
  awaitingScheduleConfirmation: boolean;
  waveCommitted: boolean;
  effectiveInterval: number | null;
  breathSeconds: number | null;
  nextBurstTarget: number | null;
}

interface LogicalSpawnEventSnapshot {
  readonly identity: SpawnIdentity;
  readonly shipType: string;
  readonly cargo: CargoManifest;
  readonly scriptedIntro: boolean;
  readonly burstOrdinal: number;
  readonly burstTarget: number;
  readonly placementAttempt: number;
  readonly spawnPointId: string | null;
  readonly transactionId: string | null;
  readonly scheduled: boolean;
  readonly awaitingScheduleConfirmation: boolean;
  readonly waveCommitted: boolean;
  readonly effectiveInterval: number | null;
  readonly breathSeconds: number | null;
  readonly nextBurstTarget: number | null;
}

export interface SpawnDirectorSnapshot {
  readonly nextSpawnDueTime: number;
  readonly burstOrdinal: number;
  readonly burstTarget: number;
  readonly retryDueTime: number | null;
  readonly scriptedIntroConsumed: boolean;
  readonly unresolved: LogicalSpawnEventSnapshot | null;
  readonly rngState: readonly number[];
}

interface LevelSource {
  readonly allowedShips: readonly string[];
  readonly shipWeights?: Readonly<Record<string, number>>;
  readonly cargoTypes: readonly string[];
  readonly cargoGeneration: {
    readonly mode: 'single' | 'mixed';
    readonly weights: Readonly<Record<string, number>>;
    readonly multiCargoChance: number;
  };
  readonly director: SpawnDirectorLevelConfig['director'];
  readonly flags: {
    readonly scriptedIntroShip?: string | null;
  };
}

interface BalanceSource {
  readonly spawnDirector: SpawnDirectorBalanceConfig;
}

function freezeCargo(cargo: Record<string, number>): CargoManifest {
  return Object.freeze({ ...cargo });
}

function requireNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
}

function requireFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number`);
  }
}

function weightedPick<T>(
  candidates: readonly T[],
  weightOf: (candidate: T) => number,
  rng: IRng,
): T {
  let totalWeight = 0;
  for (const candidate of candidates) {
    const weight = weightOf(candidate);
    if (weight > 0) {
      totalWeight += weight;
    }
  }
  if (!(totalWeight > 0)) {
    throw new RangeError('weighted selection requires at least one positive weight');
  }

  let target = rng.next() * totalWeight;
  let fallback: T | null = null;
  for (const candidate of candidates) {
    const weight = weightOf(candidate);
    if (weight <= 0) {
      continue;
    }
    fallback = candidate;
    if (target < weight) {
      return candidate;
    }
    target -= weight;
  }
  if (fallback === null) {
    throw new RangeError('weighted selection requires a selectable candidate');
  }
  return fallback;
}

function uniformInclusiveInteger(minimum: number, maximum: number, rng: IRng): number {
  return minimum + Math.floor(rng.next() * (maximum - minimum + 1));
}

function cloneIdentity(identity: SpawnIdentity): SpawnIdentity {
  return Object.freeze({
    shipId: identity.shipId,
    spawnSequence: identity.spawnSequence,
    logicalSpawnId: identity.logicalSpawnId,
  });
}

function cloneLogicalEvent(event: LogicalSpawnEvent): LogicalSpawnEventSnapshot {
  return Object.freeze({
    identity: cloneIdentity(event.identity),
    shipType: event.shipType,
    cargo: freezeCargo({ ...event.cargo }),
    scriptedIntro: event.scriptedIntro,
    burstOrdinal: event.burstOrdinal,
    burstTarget: event.burstTarget,
    placementAttempt: event.placementAttempt,
    spawnPointId: event.spawnPointId,
    transactionId: event.transactionId,
    scheduled: event.scheduled,
    awaitingScheduleConfirmation: event.awaitingScheduleConfirmation,
    waveCommitted: event.waveCommitted,
    effectiveInterval: event.effectiveInterval,
    breathSeconds: event.breathSeconds,
    nextBurstTarget: event.nextBurstTarget,
  });
}

export function createSpawnDirectorConfig(
  bundle: ConfigBundle,
  levelId: string,
): SpawnDirectorConfig {
  const level = bundle.levels[levelId] as unknown as LevelSource | undefined;
  if (level === undefined) {
    throw new RangeError(`Unknown level: ${levelId}`);
  }
  const balance = bundle.configs['balance.json'] as unknown as BalanceSource;
  const spawnDirector = balance.spawnDirector;

  return Object.freeze({
    level: Object.freeze({
      levelId,
      allowedShips: Object.freeze([...level.allowedShips]),
      shipWeights: Object.freeze({ ...(level.shipWeights ?? {}) }),
      cargoTypes: Object.freeze([...level.cargoTypes]),
      cargoGeneration: Object.freeze({
        mode: level.cargoGeneration.mode,
        weights: Object.freeze({ ...level.cargoGeneration.weights }),
        multiCargoChance: level.cargoGeneration.multiCargoChance,
      }),
      director: Object.freeze({
        startInterval: level.director.startInterval,
        minimumInterval: level.director.minimumInterval,
        warningLeadTime: level.director.warningLeadTime,
        maxAlive: level.director.maxAlive,
        pressureCap: level.director.pressureCap,
        jitter: level.director.jitter,
        wave: Object.freeze({
          burstMin: level.director.wave.burstMin,
          burstMax: level.director.wave.burstMax,
          breathMin: level.director.wave.breathMin,
          breathMax: level.director.wave.breathMax,
        }),
      }),
      scriptedIntroShip: level.flags.scriptedIntroShip ?? null,
    }),
    balance: Object.freeze({
      occupiedDockPressureWeight: spawnDirector.occupiedDockPressureWeight,
      activeStormCellPressureWeight: spawnDirector.activeStormCellPressureWeight,
      unsafeSpawnRetryDelayMs: spawnDirector.unsafeSpawnRetryDelayMs,
    }),
  });
}

export function calculateSpawnPressure(
  activeShips: readonly SpawnDirectorActiveShip[],
  occupiedDockCount: number,
  activeStormCellCount: number,
  balance: SpawnDirectorBalanceConfig,
): SpawnPressureSnapshot {
  requireNonNegativeInteger(occupiedDockCount, 'occupiedDockCount');
  requireNonNegativeInteger(activeStormCellCount, 'activeStormCellCount');

  let pressure = 0;
  let activeShipCount = 0;
  for (const candidate of activeShips) {
    if (candidate.ship.state === ShipState.Destroyed) {
      continue;
    }
    activeShipCount += 1;
    pressure += candidate.ship.characteristics.pressureWeight;
  }
  pressure += occupiedDockCount * balance.occupiedDockPressureWeight;
  pressure += activeStormCellCount * balance.activeStormCellPressureWeight;

  return Object.freeze({
    pressure,
    activeShips: activeShipCount,
  });
}

export class SpawnDirector {
  readonly #config: SpawnDirectorConfig;
  readonly #spawnPoints: readonly SpawnPoint[];
  readonly #characteristics: ShipCharacteristicsRegistry;
  readonly #rng: IRng;
  readonly #allocateIdentity: AllocateSpawnIdentity;
  readonly #spawnPointsById: ReadonlyMap<string, SpawnPoint>;

  #nextSpawnDueTime = 0;
  #burstOrdinal = 0;
  #burstTarget: number;
  #retryDueTime: number | null = null;
  #scriptedIntroConsumed = false;
  #unresolved: LogicalSpawnEvent | null = null;

  public constructor(options: {
    readonly config: SpawnDirectorConfig;
    readonly spawnPoints: readonly SpawnPoint[];
    readonly characteristics: ShipCharacteristicsRegistry;
    readonly rng: IRng;
    readonly allocateIdentity: AllocateSpawnIdentity;
  }) {
    this.#config = options.config;
    this.#spawnPoints = Object.freeze([...options.spawnPoints]);
    this.#characteristics = options.characteristics;
    this.#rng = options.rng;
    this.#allocateIdentity = options.allocateIdentity;
    this.#burstTarget = options.config.level.director.wave.burstMin;
    this.#spawnPointsById = new Map(this.#spawnPoints.map((point) => [point.id, point]));
  }

  public get nextSpawnDueTime(): number {
    return this.#nextSpawnDueTime;
  }

  public get burstOrdinal(): number {
    return this.#burstOrdinal;
  }

  public get burstTarget(): number {
    return this.#burstTarget;
  }

  public get retryDueTime(): number | null {
    return this.#retryDueTime;
  }

  public get hasUnresolvedLogicalSpawn(): boolean {
    return this.#unresolved !== null;
  }

  public step(input: SpawnDirectorInput): SpawnDirectorStepResult {
    this.#validateInput(input);
    const pressure = calculateSpawnPressure(
      input.activeShips,
      input.occupiedDockCount,
      input.activeStormCellCount,
      this.#config.balance,
    );

    if (this.#unresolved !== null) {
      if (this.#unresolved.scheduled || this.#unresolved.awaitingScheduleConfirmation) {
        return this.#noop('unresolved', pressure);
      }
      if (
        this.#retryDueTime !== null &&
        input.simulationTime < this.#retryDueTime
      ) {
        return this.#noop('retry_wait', pressure);
      }
      return this.#preparePlacement(input, pressure);
    }

    if (input.simulationTime < this.#nextSpawnDueTime) {
      return this.#noop('not_due', pressure);
    }
    if (!this.#gatesOpen(pressure)) {
      return this.#noop('gate_blocked', pressure);
    }

    this.#unresolved = this.#createLogicalEvent();
    return this.#preparePlacement(input, pressure);
  }

  public confirmScheduled(transactionId: string, simulationTime: number): void {
    requireFiniteNonNegative(simulationTime, 'simulationTime');
    const event = this.#requirePreparedTransaction(transactionId);
    event.awaitingScheduleConfirmation = false;
    event.scheduled = true;
    this.#retryDueTime = null;

    if (event.waveCommitted) {
      return;
    }
    if (event.effectiveInterval === null) {
      throw new Error('prepared logical spawn is missing interval jitter');
    }

    if (event.burstOrdinal === event.burstTarget - 1) {
      if (event.breathSeconds === null || event.nextBurstTarget === null) {
        throw new Error('final burst event is missing post-burst samples');
      }
      this.#nextSpawnDueTime =
        simulationTime + event.effectiveInterval + event.breathSeconds;
      this.#burstOrdinal = 0;
      this.#burstTarget = event.nextBurstTarget;
    } else {
      this.#nextSpawnDueTime = simulationTime + event.effectiveInterval;
      this.#burstOrdinal = event.burstOrdinal + 1;
    }
    event.waveCommitted = true;
  }

  public rejectScheduled(transactionId: string, simulationTime: number): void {
    requireFiniteNonNegative(simulationTime, 'simulationTime');
    const event = this.#requirePreparedTransaction(transactionId);
    event.awaitingScheduleConfirmation = false;
    event.scheduled = false;
    event.spawnPointId = null;
    event.transactionId = null;
    event.placementAttempt += 1;
    this.#retryDueTime =
      simulationTime + this.#config.balance.unsafeSpawnRetryDelayMs / 1000;
  }

  public resolveReadySpawn(
    command: ReadySpawnCommand,
    input: SpawnDirectorInput,
  ): ReadySpawnResolution {
    this.#validateInput(input);
    const event = this.#unresolved;
    if (
      event === null ||
      !event.scheduled ||
      event.transactionId !== command.transactionId ||
      event.identity.logicalSpawnId.length === 0
    ) {
      throw new RangeError(`ReadySpawn does not match unresolved logical spawn`);
    }

    const pressure = calculateSpawnPressure(
      input.activeShips,
      input.occupiedDockCount,
      input.activeStormCellCount,
      this.#config.balance,
    );
    const owner = input.getSpawnPointOwner(command.spawnPointId);
    const ownOrFree = owner === null || owner === command.transactionId;
    const geometrySafe = this.#isGeometrySafe(
      command.spawnPoint,
      event.shipType,
      input.activeShips,
    );

    if (!this.#gatesOpen(pressure) || !ownOrFree || !geometrySafe) {
      const transactionId = event.transactionId;
      if (transactionId === null) {
        throw new Error('scheduled logical spawn is missing transactionId');
      }
      event.scheduled = false;
      event.spawnPointId = null;
      event.transactionId = null;
      event.placementAttempt += 1;
      const retryDueTime =
        input.simulationTime +
        this.#config.balance.unsafeSpawnRetryDelayMs / 1000;
      this.#retryDueTime = retryDueTime;
      return Object.freeze({
        kind: 'retry',
        logicalSpawnId: event.identity.logicalSpawnId,
        transactionId,
        retryDueTime,
        pressure: pressure.pressure,
        aliveShips: pressure.activeShips,
      });
    }

    return Object.freeze({
      kind: 'approved',
      logicalSpawnId: event.identity.logicalSpawnId,
      command,
      pressure: pressure.pressure,
      aliveShips: pressure.activeShips,
      shipType: event.shipType,
    });
  }

  public confirmMaterialized(logicalSpawnId: string): void {
    const event = this.#unresolved;
    if (event === null || event.identity.logicalSpawnId !== logicalSpawnId) {
      throw new RangeError(`Unknown logical spawn: ${logicalSpawnId}`);
    }
    if (!event.scheduled) {
      throw new Error('cannot materialize an unscheduled logical spawn');
    }
    if (event.scriptedIntro) {
      this.#scriptedIntroConsumed = true;
    }
    this.#unresolved = null;
    this.#retryDueTime = null;
  }

  public toSnapshot(): SpawnDirectorSnapshot {
    return Object.freeze({
      nextSpawnDueTime: this.#nextSpawnDueTime,
      burstOrdinal: this.#burstOrdinal,
      burstTarget: this.#burstTarget,
      retryDueTime: this.#retryDueTime,
      scriptedIntroConsumed: this.#scriptedIntroConsumed,
      unresolved:
        this.#unresolved === null ? null : cloneLogicalEvent(this.#unresolved),
      rngState: Object.freeze([...this.#rng.getState()]),
    });
  }

  public restore(snapshot: SpawnDirectorSnapshot): void {
    this.#nextSpawnDueTime = snapshot.nextSpawnDueTime;
    this.#burstOrdinal = snapshot.burstOrdinal;
    this.#burstTarget = snapshot.burstTarget;
    this.#retryDueTime = snapshot.retryDueTime;
    this.#scriptedIntroConsumed = snapshot.scriptedIntroConsumed;
    this.#rng.setState(snapshot.rngState);

    if (snapshot.unresolved === null) {
      this.#unresolved = null;
      return;
    }
    if (
      snapshot.unresolved.spawnPointId !== null &&
      !this.#spawnPointsById.has(snapshot.unresolved.spawnPointId)
    ) {
      throw new RangeError(
        `Unknown snapshot spawn point: ${snapshot.unresolved.spawnPointId}`,
      );
    }
    this.#unresolved = {
      identity: cloneIdentity(snapshot.unresolved.identity),
      shipType: snapshot.unresolved.shipType,
      cargo: freezeCargo({ ...snapshot.unresolved.cargo }),
      scriptedIntro: snapshot.unresolved.scriptedIntro,
      burstOrdinal: snapshot.unresolved.burstOrdinal,
      burstTarget: snapshot.unresolved.burstTarget,
      placementAttempt: snapshot.unresolved.placementAttempt,
      spawnPointId: snapshot.unresolved.spawnPointId,
      transactionId: snapshot.unresolved.transactionId,
      scheduled: snapshot.unresolved.scheduled,
      awaitingScheduleConfirmation:
        snapshot.unresolved.awaitingScheduleConfirmation,
      waveCommitted: snapshot.unresolved.waveCommitted,
      effectiveInterval: snapshot.unresolved.effectiveInterval,
      breathSeconds: snapshot.unresolved.breathSeconds,
      nextBurstTarget: snapshot.unresolved.nextBurstTarget,
    };
  }

  #createLogicalEvent(): LogicalSpawnEvent {
    const identity = cloneIdentity(this.#allocateIdentity());
    if (
      !identity.shipId ||
      !identity.logicalSpawnId ||
      !Number.isSafeInteger(identity.spawnSequence) ||
      identity.spawnSequence < 0
    ) {
      throw new RangeError('allocateSpawnIdentity returned invalid identity');
    }

    const scriptedIntro =
      this.#config.level.scriptedIntroShip !== null &&
      !this.#scriptedIntroConsumed;
    const shipType = scriptedIntro
      ? this.#config.level.scriptedIntroShip!
      : this.#selectShipType();
    const cargo = this.#generateCargo(shipType);

    return {
      identity,
      shipType,
      cargo,
      scriptedIntro,
      burstOrdinal: this.#burstOrdinal,
      burstTarget: this.#burstTarget,
      placementAttempt: 0,
      spawnPointId: null,
      transactionId: null,
      scheduled: false,
      awaitingScheduleConfirmation: false,
      waveCommitted: false,
      effectiveInterval: null,
      breathSeconds: null,
      nextBurstTarget: null,
    };
  }

  #selectShipType(): string {
    const candidates = this.#config.level.allowedShips.filter((shipType) => {
      const characteristics = this.#characteristics.require(shipType);
      return (
        this.#config.level.shipWeights[shipType] ??
        characteristics.spawnWeight
      ) > 0;
    });
    return weightedPick(
      candidates,
      (shipType) =>
        this.#config.level.shipWeights[shipType] ??
        this.#characteristics.require(shipType).spawnWeight,
      this.#rng,
    );
  }

  #generateCargo(shipType: string): CargoManifest {
    const characteristics = this.#characteristics.require(shipType);
    const selectable = this.#config.level.cargoTypes.filter(
      (cargoType) =>
        characteristics.defaultCargoTypes.includes(cargoType) &&
        (this.#config.level.cargoGeneration.weights[cargoType] ?? 0) > 0,
    );
    if (selectable.length === 0) {
      throw new RangeError(`No compatible selectable cargo for ${shipType}`);
    }

    if (this.#config.level.cargoGeneration.mode === 'mixed') {
      const multiCargoRoll = this.#rng.next();
      if (
        multiCargoRoll < this.#config.level.cargoGeneration.multiCargoChance &&
        characteristics.cargoCapacity >= 2 &&
        selectable.length >= 2
      ) {
        const primary = weightedPick(
          selectable,
          (cargoType) => this.#config.level.cargoGeneration.weights[cargoType] ?? 0,
          this.#rng,
        );
        const secondaryCandidates = selectable.filter(
          (cargoType) => cargoType !== primary,
        );
        const secondary = weightedPick(
          secondaryCandidates,
          (cargoType) => this.#config.level.cargoGeneration.weights[cargoType] ?? 0,
          this.#rng,
        );
        return freezeCargo({
          [primary]: Math.ceil(characteristics.cargoCapacity / 2),
          [secondary]: Math.floor(characteristics.cargoCapacity / 2),
        });
      }
    }

    const selected = weightedPick(
      selectable,
      (cargoType) => this.#config.level.cargoGeneration.weights[cargoType] ?? 0,
      this.#rng,
    );
    return freezeCargo({
      [selected]: characteristics.cargoCapacity,
    });
  }

  #preparePlacement(
    input: SpawnDirectorInput,
    pressure: SpawnPressureSnapshot,
  ): SpawnDirectorStepResult {
    const event = this.#unresolved;
    if (event === null) {
      throw new Error('placement requires unresolved logical spawn');
    }

    const safePoints = this.#spawnPoints.filter((point) => {
      if (input.getSpawnPointOwner(point.id) !== null) {
        return false;
      }
      return this.#isGeometrySafe(point, event.shipType, input.activeShips);
    });

    if (safePoints.length === 0) {
      this.#retryDueTime =
        input.simulationTime +
        this.#config.balance.unsafeSpawnRetryDelayMs / 1000;
      return this.#noop('unsafe_spawn', pressure);
    }

    const spawnPoint = pickWeightedSpawnPoint(safePoints, this.#rng);
    if (spawnPoint === null) {
      this.#retryDueTime =
        input.simulationTime +
        this.#config.balance.unsafeSpawnRetryDelayMs / 1000;
      return this.#noop('unsafe_spawn', pressure);
    }

    if (event.effectiveInterval === null) {
      const { director } = this.#config.level;
      let baseInterval: number;
      if (
        event.burstTarget === 1 ||
        event.burstOrdinal === event.burstTarget - 1
      ) {
        baseInterval = director.minimumInterval;
      } else if (event.burstOrdinal === 0) {
        baseInterval = director.startInterval;
      } else {
        const t = event.burstOrdinal / (event.burstTarget - 1);
        baseInterval =
          director.startInterval +
          (director.minimumInterval - director.startInterval) * t;
      }
      const jitterFraction = this.#rng.range(-director.jitter, director.jitter);
      event.effectiveInterval = baseInterval * (1 + jitterFraction);

      if (event.burstOrdinal === event.burstTarget - 1) {
        event.breathSeconds = this.#rng.range(
          director.wave.breathMin,
          director.wave.breathMax,
        );
        event.nextBurstTarget = uniformInclusiveInteger(
          director.wave.burstMin,
          director.wave.burstMax,
          this.#rng,
        );
      }
    }

    const transactionId = `${event.identity.logicalSpawnId}:placement:${event.placementAttempt}`;
    event.spawnPointId = spawnPoint.id;
    event.transactionId = transactionId;
    event.awaitingScheduleConfirmation = true;

    const command: IncomingSpawnRequest = Object.freeze({
      transactionId,
      spawnPoint,
      payload: Object.freeze({
        shipId: event.identity.shipId,
        shipType: event.shipType,
        cargo: event.cargo,
        spawnSequence: event.identity.spawnSequence,
      }),
      leadTimeSeconds:
        spawnPoint.leadTimeOverride ??
        this.#config.level.director.warningLeadTime,
    });

    return Object.freeze({
      kind: 'schedule_incoming',
      logicalSpawnId: event.identity.logicalSpawnId,
      command,
      pressure: pressure.pressure,
      activeShips: pressure.activeShips,
    });
  }

  #isGeometrySafe(
    point: SpawnPoint,
    shipType: string,
    activeShips: readonly SpawnDirectorActiveShip[],
  ): boolean {
    const newWarningRadius = this.#characteristics.require(shipType).warningRadius;
    for (const candidate of activeShips) {
      if (!participatesInShipCollision(candidate.ship.state)) {
        continue;
      }
      const dx = point.x - candidate.ship.x;
      const dy = point.y - candidate.ship.y;
      const combined =
        newWarningRadius + candidate.ship.characteristics.warningRadius;
      if (dx * dx + dy * dy <= combined * combined) {
        return false;
      }
    }
    return true;
  }

  #gatesOpen(pressure: SpawnPressureSnapshot): boolean {
    return (
      pressure.activeShips < this.#config.level.director.maxAlive &&
      pressure.pressure < this.#config.level.director.pressureCap
    );
  }

  #noop(
    reason: Extract<SpawnDirectorStepResult, { kind: 'noop' }>['reason'],
    pressure: SpawnPressureSnapshot,
  ): SpawnDirectorStepResult {
    return Object.freeze({
      kind: 'noop',
      reason,
      pressure: pressure.pressure,
      activeShips: pressure.activeShips,
    });
  }

  #requirePreparedTransaction(transactionId: string): LogicalSpawnEvent {
    const event = this.#unresolved;
    if (
      event === null ||
      !event.awaitingScheduleConfirmation ||
      event.transactionId !== transactionId
    ) {
      throw new RangeError(`Unknown prepared transaction: ${transactionId}`);
    }
    return event;
  }

  #validateInput(input: SpawnDirectorInput): void {
    requireFiniteNonNegative(input.simulationTime, 'simulationTime');
    requireNonNegativeInteger(input.occupiedDockCount, 'occupiedDockCount');
    requireNonNegativeInteger(input.activeStormCellCount, 'activeStormCellCount');
  }
}
