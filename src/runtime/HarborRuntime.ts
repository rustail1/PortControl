import type { Point, Size } from '../camera/SquareWorldViewport.ts';
import { SquareWorldViewport } from '../camera/SquareWorldViewport.ts';
import {
  CollisionSystem,
  createCollisionConfig,
  type CollisionDomainEvents,
  type CollisionShipCandidate,
} from '../collision/CollisionSystem.ts';
import type { ConfigBundle } from '../config/types.ts';
import { DomainEventQueue } from '../core/DomainEventQueue.ts';
import {
  FixedStepClock,
  type FixedStepAdvanceResult,
} from '../core/FixedStepClock.ts';
import {
  createGameSessionFromConfig,
  type SessionResult,
} from '../core/GameSession.ts';
import { SeededRng } from '../core/SeededRng.ts';
import { SessionState } from '../core/SessionState.ts';
import {
  CargoSystem,
  type CargoDomainEvents,
  type CargoUnloadCandidate,
} from '../docks/CargoSystem.ts';
import { createDocksForValidatedLevel } from '../docks/DockFactory.ts';
import type { DockModel, DockRuntimeSnapshot } from '../docks/DockModel.ts';
import { DockSystem } from '../docks/DockSystem.ts';
import { createDockingConfig } from '../docks/DockingConfig.ts';
import {
  DockingController,
  type DockApproachCandidate,
} from '../docks/DockingController.ts';
import {
  createExitScore,
  createExitZones,
  ExitSystem,
  type ExitDomainEvents,
  type ExitZoneDefinition,
} from '../exits/ExitSystem.ts';
import {
  createLandClearanceGeometryFromLevel,
  type LandClearancePolygon,
} from '../geometry/LandClearanceGeometry.ts';
import {
  GroundingSystem,
  type GroundingShipCandidate,
} from '../grounding/GroundingSystem.ts';
import { NavigationValidator } from '../routes/NavigationValidator.ts';
import {
  RouteCommitService,
  type RouteCommitResult,
} from '../routes/RouteCommitService.ts';
import {
  isRouteInputState,
  RouteInputController,
  type ActiveRouteDraftSnapshot,
  type NormalizedPointerInput,
  type RawRouteDraft,
  type RouteInputOutcome,
} from '../routes/RouteInputController.ts';
import { createRouteProcessingConfig } from '../routes/RouteProcessingConfig.ts';
import { createRouteSamplingConfig } from '../routes/RouteSamplingConfig.ts';
import {
  createShipCharacteristicsRegistry,
  type ShipModel,
  type ShipModelSnapshot,
} from '../ships/index.ts';
import { ShipMotor } from '../ships/ShipMotor.ts';
import {
  IncomingSpawnSystem,
  type IncomingIndicatorCommand,
} from '../spawning/IncomingSpawnSystem.ts';
import { ShipSpawner } from '../spawning/ShipSpawner.ts';
import {
  createSpawnDirectorConfig,
  SpawnDirector,
  type SpawnDirectorActiveShip,
  type SpawnDirectorInput,
  type SpawnDirectorSnapshot,
} from '../spawning/SpawnDirector.ts';
import { createSpawnPointsForValidatedLevel } from '../spawning/SpawnPointFactory.ts';
import type { SpawnPoint } from '../spawning/SpawnPoint.ts';
import { PresentationPulseStore } from '../presentation/PresentationPulseStore.ts';

const DANGER_VISUAL_TTL_SECONDS = 0.45;
const CARGO_REJECT_VISUAL_TTL_SECONDS = 0.65;

interface SimulationConfigSource {
  readonly simulation: {
    readonly fixedHz: number;
    readonly maxCatchUpSteps: number;
  };
}

interface ActiveShipRecord {
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

export interface HarborShipPresentationSnapshot {
  readonly ship: ShipModelSnapshot;
  readonly spawnSequence: number;
  readonly previousPosition: Point;
  readonly previousRotationDeg: number;
}

export interface HarborDockPresentationSnapshot {
  readonly definition: DockModel['definition'];
  readonly runtime: DockRuntimeSnapshot;
  readonly busy: boolean;
}

export function isDockPresentationBusy(runtime: DockRuntimeSnapshot): boolean {
  return runtime.occupiedBy !== null || runtime.reservedBy !== null;
}

export interface HarborDangerPairSnapshot {
  readonly shipAId: string;
  readonly shipBId: string;
  readonly remainingSeconds: number;
}

export interface HarborCargoRejectPulseSnapshot {
  readonly shipId: string;
  readonly remainingSeconds: number;
}

export interface HarborRoutePreviewSnapshot {
  readonly shipId: string;
  readonly validPoints: readonly Point[];
  readonly rejectedPoints: readonly Point[];
}

export interface HarborPresentationSnapshot {
  readonly levelId: string;
  readonly simulationTime: number;
  readonly score: number;
  readonly objective: ReturnType<HarborRuntime['objectiveSnapshot']>;
  readonly warningCount: number;
  readonly result: SessionResult | null;
  readonly ships: readonly HarborShipPresentationSnapshot[];
  readonly docks: readonly HarborDockPresentationSnapshot[];
  readonly exits: readonly ExitZoneDefinition[];
  readonly land: readonly LandClearancePolygon[];
  readonly spawnPoints: readonly SpawnPoint[];
  readonly incoming: readonly IncomingIndicatorCommand[];
  readonly dangerPairs: readonly HarborDangerPairSnapshot[];
  readonly cargoRejectPulses: readonly HarborCargoRejectPulseSnapshot[];
  readonly selectedShipId: string | null;
  readonly activeDraft: ActiveRouteDraftSnapshot | null;
  readonly routePreview: HarborRoutePreviewSnapshot | null;
}

export interface HarborAuthoritativeSnapshot {
  readonly levelId: string;
  readonly attemptSeed: number;
  readonly session: ReturnType<HarborRuntime['sessionSnapshot']>;
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

export interface RouteSelectableShip {
  readonly ship: ShipModel;
  readonly spawnSequence: number;
}

export function selectRouteInputShip(
  candidates: readonly RouteSelectableShip[],
  worldPoint: Point,
  effectiveWorldToCssPixelScale: number,
): ShipModel | null {
  if (
    !Number.isFinite(effectiveWorldToCssPixelScale) ||
    effectiveWorldToCssPixelScale <= 0
  ) {
    throw new RangeError('effectiveWorldToCssPixelScale must be positive and finite');
  }
  let winner: RouteSelectableShip | null = null;
  let winnerDistanceSquared = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (!isRouteInputState(candidate.ship.state)) {
      continue;
    }
    const selectionRadius = Math.max(
      candidate.ship.characteristics.collisionRadius,
      24 / effectiveWorldToCssPixelScale,
    );
    const dx = worldPoint.x - candidate.ship.x;
    const dy = worldPoint.y - candidate.ship.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared > selectionRadius * selectionRadius) {
      continue;
    }
    if (
      winner === null ||
      distanceSquared < winnerDistanceSquared ||
      (distanceSquared === winnerDistanceSquared &&
        candidate.spawnSequence < winner.spawnSequence)
    ) {
      winner = candidate;
      winnerDistanceSquared = distanceSquared;
    }
  }
  return winner?.ship ?? null;
}

export interface HarborRuntimeOptions {
  readonly bundle: ConfigBundle;
  readonly levelId: string;
  readonly attemptSeed: number;
}

export type AttemptSeedProvider = () => number;

export function selectNextAttemptSeed(
  result: SessionResult,
  currentAttemptSeed: number,
  acquireNewSeed: AttemptSeedProvider,
): number {
  return result.kind === 'failed' ? currentAttemptSeed : acquireNewSeed();
}

function cloneDraft(draft: RawRouteDraft): RawRouteDraft {
  return Object.freeze({
    shipId: draft.shipId,
    points: Object.freeze(
      draft.points.map((point) => Object.freeze({ ...point })),
    ),
  });
}

function cloneIndicator(
  command: IncomingIndicatorCommand,
): IncomingIndicatorCommand {
  return Object.freeze({ ...command });
}

function freezePoints(points: readonly Point[]): readonly Point[] {
  return Object.freeze(points.map((point) => Object.freeze({ ...point })));
}

export class HarborRuntime {
  readonly #level: Record<string, unknown>;
  readonly #levelId: string;
  readonly #allowedShipTypes: readonly string[];
  readonly #attemptSeed: number;
  readonly #viewport: SquareWorldViewport;
  readonly #clock: FixedStepClock;
  readonly #rng: SeededRng;
  readonly #shipMotor = new ShipMotor();
  readonly #characteristics: ReturnType<typeof createShipCharacteristicsRegistry>;
  readonly #landGeometry: ReturnType<typeof createLandClearanceGeometryFromLevel>;
  readonly #routeConfig: ReturnType<typeof createRouteProcessingConfig>;
  readonly #navigation: NavigationValidator;
  readonly #routeCommit: RouteCommitService;
  readonly #routeInput: RouteInputController;
  readonly #docks: ReturnType<typeof createDocksForValidatedLevel>;
  readonly #dockSystem = new DockSystem();
  readonly #docking: DockingController;
  readonly #cargoEvents = new DomainEventQueue<CargoDomainEvents>();
  readonly #cargo: CargoSystem;
  readonly #exitEvents = new DomainEventQueue<ExitDomainEvents>();
  readonly #exit: ExitSystem;
  readonly #collisionEvents = new DomainEventQueue<CollisionDomainEvents>();
  readonly #collision: CollisionSystem;
  readonly #grounding: GroundingSystem;
  readonly #spawnPoints: readonly SpawnPoint[];
  readonly #incoming = new IncomingSpawnSystem();
  readonly #spawner: ShipSpawner;
  readonly #director: SpawnDirector;
  readonly #session: ReturnType<typeof createGameSessionFromConfig>;
  readonly #active = new Map<string, ActiveShipRecord>();
  readonly #routeCommands: RawRouteDraft[] = [];
  readonly #incomingIndicators = new Map<string, IncomingIndicatorCommand>();
  readonly #presentationPulses = new PresentationPulseStore();
  readonly #spawnCandidates: SpawnDirectorActiveShip[] = [];
  readonly #collisionCandidates: CollisionShipCandidate[] = [];
  readonly #dockCandidates: DockApproachCandidate[] = [];
  readonly #groundingCandidates: GroundingShipCandidate[] = [];
  readonly #cargoCandidates: CargoUnloadCandidate[] = [];
  readonly #exitShips: ShipModel[] = [];
  #nextSpawnSequence = 0;
  #activeForRenderAdvance = true;
  #lastRouteCommitResult: RouteCommitResult | null = null;
  #presentationSelectedShipId: string | null = null;

  public constructor(options: HarborRuntimeOptions) {
    this.#levelId = options.levelId;
    this.#attemptSeed = options.attemptSeed;
    const level = options.bundle.levels[options.levelId];
    if (level === undefined) {
      throw new RangeError(`Unknown level: ${options.levelId}`);
    }
    this.#level = level;
    const allowedShips = level['allowedShips'];
    if (
      !Array.isArray(allowedShips) ||
      !allowedShips.every((value) => typeof value === 'string')
    ) {
      throw new RangeError('level.allowedShips must be a string array');
    }
    this.#allowedShipTypes = Object.freeze([...allowedShips]);

    const balance = options.bundle.configs['balance.json'] as unknown as SimulationConfigSource;
    this.#clock = new FixedStepClock({
      fixedHz: balance.simulation.fixedHz,
      maxCatchUpSteps: balance.simulation.maxCatchUpSteps,
    });
    const logicalWorld = (
      options.bundle.configs['balance.json'] as {
        readonly simulation: { readonly logicalWorld: readonly [number, number] };
      }
    ).simulation.logicalWorld;
    this.#viewport = new SquareWorldViewport({
      width: logicalWorld[0],
      height: logicalWorld[1],
    });

    this.#rng = new SeededRng(options.attemptSeed);
    this.#characteristics = createShipCharacteristicsRegistry(options.bundle);
    this.#landGeometry = createLandClearanceGeometryFromLevel(level);
    this.#routeConfig = createRouteProcessingConfig(options.bundle);
    this.#navigation = new NavigationValidator(this.#landGeometry.polygons);
    this.#routeCommit = new RouteCommitService({
      navigation: this.#navigation,
      config: this.#routeConfig,
    });

    this.#docks = createDocksForValidatedLevel(options.bundle, options.levelId);
    this.#docking = new DockingController({
      docks: this.#docks,
      dockSystem: this.#dockSystem,
      config: createDockingConfig(options.bundle),
    });
    this.#cargo = new CargoSystem({
      dockSystem: this.#dockSystem,
      events: this.#cargoEvents,
    });
    this.#exit = new ExitSystem({
      zones: createExitZones(level),
      score: createExitScore(options.bundle),
      events: this.#exitEvents,
    });
    this.#collision = new CollisionSystem({
      events: this.#collisionEvents,
      config: createCollisionConfig(options.bundle),
    });
    this.#grounding = new GroundingSystem({
      geometry: this.#landGeometry,
      navigationClearanceExtra: this.#routeConfig.navigationClearanceExtra,
    });

    this.#spawnPoints = createSpawnPointsForValidatedLevel(
      options.bundle,
      options.levelId,
    );
    this.#spawner = new ShipSpawner(this.#characteristics);
    this.#director = new SpawnDirector({
      config: createSpawnDirectorConfig(options.bundle, options.levelId),
      spawnPoints: this.#spawnPoints,
      characteristics: this.#characteristics,
      rng: this.#rng,
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
    this.#session = createGameSessionFromConfig(
      options.bundle,
      options.levelId,
      options.attemptSeed,
    );

    this.#routeInput = new RouteInputController({
      viewport: this.#viewport,
      sampling: createRouteSamplingConfig(options.bundle),
      hitTest: (worldPoint, worldToCssPixelScale) =>
        this.#hitTestShip(worldPoint, worldToCssPixelScale),
    });

    this.#collisionEvents.subscribe('danger_warning', (event) => {
      this.#presentationPulses.refreshDanger(
        event.shipAId,
        event.shipBId,
        DANGER_VISUAL_TTL_SECONDS,
      );
    });
  }

  public get levelId(): string {
    return this.#levelId;
  }

  public get attemptSeed(): number {
    return this.#attemptSeed;
  }

  public get allowedShipTypes(): readonly string[] {
    return this.#allowedShipTypes;
  }

  public get logicalWorld(): Size {
    return this.#viewport.logicalWorld;
  }

  public get activeShipCount(): number {
    return this.#active.size;
  }

  public get queuedRouteCommandCount(): number {
    return this.#routeCommands.length;
  }

  public get lastRouteCommitResult(): RouteCommitResult | null {
    return this.#lastRouteCommitResult;
  }

  public objectiveSnapshot() {
    return this.#session.objectiveProgress;
  }

  public sessionSnapshot() {
    return this.#session.toSnapshot();
  }

  public enqueueRouteDraft(draft: RawRouteDraft): void {
    this.#routeCommands.push(cloneDraft(draft));
  }

  public pointerDown(input: NormalizedPointerInput): RouteInputOutcome {
    const outcome = this.#routeInput.pointerDown(input);
    if (outcome.kind === 'started') {
      this.#presentationSelectedShipId = outcome.shipId;
    }
    return outcome;
  }

  public pointerMove(input: NormalizedPointerInput): RouteInputOutcome {
    return this.#handleRouteInputOutcome(this.#routeInput.pointerMove(input));
  }

  public pointerUp(input: NormalizedPointerInput): RouteInputOutcome {
    return this.#handleRouteInputOutcome(this.#routeInput.pointerUp(input));
  }

  public pointerCancel(input: NormalizedPointerInput): RouteInputOutcome {
    const outcome = this.#routeInput.pointerCancel(input);
    if (outcome.kind === 'cancelled') {
      this.#presentationSelectedShipId = null;
    }
    return outcome;
  }

  public cancelActiveDraft(): RouteInputOutcome {
    const outcome = this.#routeInput.cancelActiveDraft();
    this.#presentationSelectedShipId = null;
    return outcome;
  }

  public setPageActive(active: boolean): void {
    this.#activeForRenderAdvance = active;
    if (!active) {
      this.#routeInput.cancelActiveDraft();
    }
  }

  public advanceRender(renderDeltaMilliseconds: number): FixedStepAdvanceResult {
    if (
      !Number.isFinite(renderDeltaMilliseconds) ||
      renderDeltaMilliseconds < 0
    ) {
      throw new RangeError(
        'renderDeltaMilliseconds must be a non-negative finite number',
      );
    }
    if (
      !this.#activeForRenderAdvance ||
      this.#session.state !== SessionState.Active
    ) {
      return Object.freeze({
        steps: 0,
        interpolationAlpha: this.#clock.interpolationAlpha,
      });
    }
    return this.#clock.advance(renderDeltaMilliseconds, (deltaSeconds) => {
      this.#fixedStep(deltaSeconds);
    });
  }

  public presentationSnapshot(): HarborPresentationSnapshot {
    this.#discardInvalidPresentationSelection();
    const ships = [...this.#active.values()]
      .sort((left, right) => left.spawnSequence - right.spawnSequence)
      .map((record) =>
        Object.freeze({
          ship: record.ship.toSnapshot(),
          spawnSequence: record.spawnSequence,
          previousPosition: Object.freeze({ ...record.previousPosition }),
          previousRotationDeg: record.previousRotationDeg,
        }),
      );
    const docks = [...this.#docks.values()].map((dock) => {
      const runtime = Object.freeze({ ...dock.toRuntimeSnapshot() });
      return Object.freeze({
        definition: dock.definition,
        runtime,
        busy: isDockPresentationBusy(runtime),
      });
    });
    const dangerPairs = this.#presentationPulses.dangerSnapshot();
    const cargoRejectPulses = this.#presentationPulses.cargoRejectSnapshot();
    return Object.freeze({
      levelId: this.#levelId,
      simulationTime: this.#session.simulationTime,
      score: this.#session.score,
      objective: this.#session.objectiveProgress,
      warningCount: this.#session.metricsSnapshot.warningCount,
      result: this.#session.result,
      ships: Object.freeze(ships),
      docks: Object.freeze(docks),
      exits: createExitZones(this.#level),
      land: this.#landGeometry.polygons,
      spawnPoints: this.#spawnPoints,
      incoming: Object.freeze(
        [...this.#incomingIndicators.values()].map(cloneIndicator),
      ),
      dangerPairs: Object.freeze(dangerPairs),
      cargoRejectPulses: Object.freeze(cargoRejectPulses),
      selectedShipId: this.#presentationSelectedShipId,
      activeDraft: this.#routeInput.activeDraftSnapshot,
      routePreview: this.#createRoutePreviewSnapshot(),
    });
  }

  public authoritativeSnapshot(): HarborAuthoritativeSnapshot {
    const ships = [...this.#active.values()]
      .sort((left, right) => left.spawnSequence - right.spawnSequence)
      .map((record) =>
        Object.freeze({
          ship: record.ship.toSnapshot(),
          spawnSequence: record.spawnSequence,
        }),
      );
    const docks = [...this.#docks.values()].map((dock) =>
      Object.freeze({ ...dock.toRuntimeSnapshot() }),
    );
    return Object.freeze({
      levelId: this.#levelId,
      attemptSeed: this.#attemptSeed,
      session: this.#session.toSnapshot(),
      ships: Object.freeze(ships),
      docks: Object.freeze(docks),
      director: this.#director.toSnapshot(),
      rngState: Object.freeze([...this.#rng.getState()]),
      queuedRouteCommands: this.#routeCommands.length,
      pendingIncoming: this.#incoming.pendingCount,
    });
  }

  #handleRouteInputOutcome(outcome: RouteInputOutcome): RouteInputOutcome {
    if (outcome.kind === 'finished') {
      this.enqueueRouteDraft(outcome.draft);
    } else if (outcome.kind === 'cancelled') {
      this.#presentationSelectedShipId = null;
    }
    return outcome;
  }

  #discardInvalidPresentationSelection(): void {
    const selectedShipId = this.#presentationSelectedShipId;
    if (selectedShipId === null) return;
    const selected = this.#active.get(selectedShipId);
    if (
      selected === undefined ||
      this.#session.state !== SessionState.Active ||
      !isRouteInputState(selected.ship.state)
    ) {
      this.#presentationSelectedShipId = null;
    }
  }

  #createRoutePreviewSnapshot(): HarborRoutePreviewSnapshot | null {
    const draft = this.#routeInput.activeDraftSnapshot;
    if (draft === null) {
      return null;
    }
    const record = this.#active.get(draft.shipId);
    if (record === undefined) {
      return null;
    }
    const validation = this.#navigation.validate(
      record.ship,
      draft.points,
      this.#routeConfig,
    );
    return Object.freeze({
      shipId: draft.shipId,
      validPoints: freezePoints(validation.validPoints),
      rejectedPoints: freezePoints(validation.rejectedPoints),
    });
  }

  #fixedStep(deltaSeconds: number): void {
    if (this.#session.state !== SessionState.Active) {
      return;
    }
    this.#advancePresentationPulses(deltaSeconds);
    this.#applyQueuedRoutes();
    this.#spawnPhase(deltaSeconds);
    this.#snapshotPreviousPoses();
    this.#moveShips(deltaSeconds);

    this.#buildCollisionCandidates();
    const collision = this.#collision.step(
      this.#collisionCandidates,
      deltaSeconds,
    );
    this.#buildGroundingCandidates();
    const grounding = this.#grounding.resolve(this.#groundingCandidates);

    if (
      collision.terminalCollision !== null ||
      grounding.terminalGrounding !== null
    ) {
      this.#session.step({
        deltaSeconds,
        collisionTerminal: collision.terminalCollision,
        groundingTerminal: grounding.terminalGrounding,
      });
      this.#flushEvents();
      return;
    }

    this.#buildDockCandidates();
    this.#docking.step(this.#dockCandidates, deltaSeconds);

    this.#buildCargoCandidates();
    const cargo = this.#cargo.step(this.#cargoCandidates, deltaSeconds);

    this.#buildExitShips();
    const exit = this.#exit.step(this.#exitShips);
    for (const shipId of exit.rejectedCargoShipIds) {
      this.#presentationPulses.refreshCargoReject(
        shipId,
        CARGO_REJECT_VISUAL_TTL_SECONDS,
      );
    }
    for (const shipId of exit.despawnedShipIds) {
      this.#removeActiveShip(shipId);
    }

    this.#session.step({
      deltaSeconds,
      dangerWarningCount: collision.dangerWarningCount,
      cargoUnloadedFacts: cargo.unloadedFacts,
      exitedShipFacts: exit.exitedShipFacts,
    });
    this.#flushEvents();
  }

  #advancePresentationPulses(deltaSeconds: number): void {
    this.#presentationPulses.advance(deltaSeconds);
  }

  #applyQueuedRoutes(): void {
    if (this.#routeCommands.length === 0) {
      return;
    }
    const commands = this.#routeCommands.splice(0);
    for (const draft of commands) {
      const record = this.#active.get(draft.shipId);
      if (record === undefined) {
        continue;
      }
      this.#lastRouteCommitResult = this.#routeCommit.commit({
        ship: record.ship,
        draft,
      });
    }
  }

  #spawnPhase(deltaSeconds: number): void {
    const pendingAtPhaseStart = this.#incoming.pendingCount > 0;
    const simulationTime = this.#session.simulationTime;
    const directorInput = this.#createDirectorInput(simulationTime);
    const directorResult = this.#director.step(directorInput);

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
      this.#incomingIndicators.set(indicator.transactionId, indicator);
    }
  }

  #resolveReadySpawns(simulationTime: number): void {
    const ready = this.#incoming.peekReadySpawns();
    if (ready.length === 0) {
      return;
    }
    for (const command of ready) {
      const resolution = this.#director.resolveReadySpawn(
        command,
        this.#createDirectorInput(simulationTime),
      );
      if (resolution.kind === 'retry') {
        this.#incoming.cancel(command.transactionId);
        this.#incomingIndicators.delete(command.transactionId);
        continue;
      }

      const consumed = this.#incoming.consumeReadySpawns();
      const approved = consumed.find(
        (candidate) => candidate.transactionId === command.transactionId,
      );
      if (approved === undefined) {
        throw new Error('approved ReadySpawn was not consumable');
      }
      const spawned = this.#spawner.materialize(approved);
      const record = this.#createActiveRecord(spawned);
      this.#active.set(spawned.ship.id, record);
      this.#session.registerSpawnedShip({
        shipId: spawned.ship.id,
        shipType: spawned.ship.characteristics.type,
        initialCargo: approved.payload.cargo,
      });
      this.#director.confirmMaterialized(resolution.logicalSpawnId);
      this.#incomingIndicators.delete(command.transactionId);
      break;
    }
  }

  #createActiveRecord(spawned: {
    readonly ship: ShipModel;
    readonly spawnSequence: number;
    readonly transactionId: string;
    readonly spawnPointId: string;
  }): ActiveShipRecord {
    const previousPosition = { x: spawned.ship.x, y: spawned.ship.y };
    const record = {
      ship: spawned.ship,
      spawnSequence: spawned.spawnSequence,
      transactionId: spawned.transactionId,
      spawnPointId: spawned.spawnPointId,
      spawnCandidate: Object.freeze({ ship: spawned.ship }),
      collisionCandidate: Object.freeze({
        ship: spawned.ship,
        spawnSequence: spawned.spawnSequence,
      }),
      dockCandidate: Object.freeze({
        ship: spawned.ship,
        spawnSequence: spawned.spawnSequence,
      }),
      previousPosition,
      groundingCandidate: null as unknown as GroundingShipCandidate,
      previousRotationDeg: spawned.ship.rotationDeg,
    };
    const groundingCandidate: GroundingShipCandidate = Object.freeze({
      ship: spawned.ship,
      spawnSequence: spawned.spawnSequence,
      previousPosition,
    });
    record.groundingCandidate = groundingCandidate;
    return record;
  }

  #createDirectorInput(simulationTime: number): SpawnDirectorInput {
    this.#spawnCandidates.length = 0;
    for (const record of this.#active.values()) {
      this.#spawnCandidates.push(record.spawnCandidate);
    }
    let occupiedDockCount = 0;
    for (const dock of this.#docks.values()) {
      if (dock.occupiedBy !== null) {
        occupiedDockCount += 1;
      }
    }
    return {
      simulationTime,
      activeShips: this.#spawnCandidates,
      occupiedDockCount,
      activeStormCellCount: 0,
      getSpawnPointOwner: (spawnPointId) =>
        this.#incoming.getSpawnPointOwner(spawnPointId),
    };
  }

  #snapshotPreviousPoses(): void {
    for (const record of this.#active.values()) {
      record.previousPosition.x = record.ship.x;
      record.previousPosition.y = record.ship.y;
      record.previousRotationDeg = record.ship.rotationDeg;
    }
  }

  #moveShips(deltaSeconds: number): void {
    for (const record of this.#active.values()) {
      this.#shipMotor.stepRoute(
        record.ship,
        this.#routeConfig.waypointTolerance,
        deltaSeconds,
      );
    }
  }

  #buildCollisionCandidates(): void {
    this.#collisionCandidates.length = 0;
    for (const record of this.#active.values()) {
      if (this.#docking.isShipCollidable(record.ship)) {
        this.#collisionCandidates.push(record.collisionCandidate);
      }
    }
  }

  #buildGroundingCandidates(): void {
    this.#groundingCandidates.length = 0;
    for (const record of this.#active.values()) {
      this.#groundingCandidates.push(record.groundingCandidate);
    }
  }

  #buildDockCandidates(): void {
    this.#dockCandidates.length = 0;
    for (const record of this.#active.values()) {
      this.#dockCandidates.push(record.dockCandidate);
    }
  }

  #buildCargoCandidates(): void {
    this.#cargoCandidates.length = 0;
    for (const dock of this.#docks.values()) {
      const shipId = dock.occupiedBy;
      if (shipId === null) {
        continue;
      }
      const record = this.#active.get(shipId);
      if (record !== undefined) {
        this.#cargoCandidates.push({ ship: record.ship, dock });
      }
    }
  }

  #buildExitShips(): void {
    this.#exitShips.length = 0;
    for (const record of this.#active.values()) {
      this.#exitShips.push(record.ship);
    }
  }

  #removeActiveShip(shipId: string): void {
    if (!this.#active.delete(shipId)) {
      return;
    }
    this.#collision.forgetShip(shipId);
    this.#presentationPulses.forgetShip(shipId);
    if (this.#presentationSelectedShipId === shipId) {
      this.#presentationSelectedShipId = null;
    }
    if (this.#routeInput.selectedShipId === shipId) {
      this.#routeInput.cancelActiveDraft();
    }
    for (let index = this.#routeCommands.length - 1; index >= 0; index -= 1) {
      if (this.#routeCommands[index]?.shipId === shipId) {
        this.#routeCommands.splice(index, 1);
      }
    }
  }

  #flushEvents(): void {
    this.#collisionEvents.flush();
    this.#cargoEvents.flush();
    this.#exitEvents.flush();
  }

  #hitTestShip(worldPoint: Point, worldToCssPixelScale: number): ShipModel | null {
    return selectRouteInputShip(
      [...this.#active.values()],
      worldPoint,
      worldToCssPixelScale,
    );
  }
}
