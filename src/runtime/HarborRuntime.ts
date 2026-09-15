import type { Point, Size } from '../camera/SquareWorldViewport.ts';
import { SquareWorldViewport } from '../camera/SquareWorldViewport.ts';
import {
  CollisionSystem,
  createCollisionConfig,
  type CollisionDomainEvents,
} from '../collision/CollisionSystem.ts';
import type { ConfigBundle } from '../config/types.ts';
import { toLevelDefinition } from '../config/LevelDefinition.ts';
import { assertLevelSupported } from '../config/RuntimeCapabilities.ts';
import { RuntimeConfigRegistry } from '../config/RuntimeConfigRegistry.ts';
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
import { projectAcceptedFacts } from '../core/SimulationFacts.ts';
import {
  CargoSystem,
  type CargoDomainEvents,
} from '../docks/CargoSystem.ts';
import { createDocksForValidatedLevel } from '../docks/DockFactory.ts';
import type { DockModel, DockRuntimeSnapshot } from '../docks/DockModel.ts';
import { DockSystem } from '../docks/DockSystem.ts';
import { createDockingConfig } from '../docks/DockingConfig.ts';
import { DockingController } from '../docks/DockingController.ts';
import { DepartureCoordinator } from '../docks/DepartureCoordinator.ts';
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
import { GroundingSystem } from '../grounding/GroundingSystem.ts';
import { LandRecoverySystem } from '../grounding/LandRecoverySystem.ts';
import { NavigationValidator } from '../routes/NavigationValidator.ts';
import {
  RouteCommitService,
  type RouteCommitResult,
} from '../routes/RouteCommitService.ts';
import {
  isRouteInputState,
  materializeRouteDraftFromStart,
  RouteInputController,
  type ActiveRouteDraftSnapshot,
  type NormalizedPointerInput,
  type RawRouteDraft,
  type RouteInputOutcome,
} from '../routes/RouteInputController.ts';
import { RoutePreparationService } from '../routes/RoutePreparationService.ts';
import { createRouteProcessingConfig } from '../routes/RouteProcessingConfig.ts';
import { createRouteSamplingConfig } from '../routes/RouteSamplingConfig.ts';
import {
  createShipCharacteristicsRegistry,
  ShipModel,
  ShipRoute,
  ShipState,
  type ShipModelSnapshot,
} from '../ships/index.ts';
import { ShipMotor } from '../ships/ShipMotor.ts';
import { createSpawnPointsForValidatedLevel } from '../spawning/SpawnPointFactory.ts';
import type { SpawnPoint } from '../spawning/SpawnPoint.ts';
import { PresentationPulseStore } from '../presentation/PresentationPulseStore.ts';
import {
  composeRoutePresentationTail,
  createRouteRenderState,
} from '../presentation/RouteRenderState.ts';
import type { SimulationSnapshot } from '../rewind/SessionSnapshot.ts';
import { HarborSimulationPorts } from './HarborSimulationPorts.ts';
import { HarborShipRegistry } from './HarborShipRegistry.ts';
import { HarborRouteCoordinator } from './HarborRouteCoordinator.ts';
import { selectRouteInputShip } from './RouteInputHitTest.ts';
import { HarborSpawnCoordinator } from './HarborSpawnCoordinator.ts';
import {
  HarborSnapshotCoordinator,
  type HarborAuthoritativeSnapshot,
} from './HarborSnapshotCoordinator.ts';
import {
  DeparturePresentationStore,
  type DeparturePresentationSnapshot,
  type IncomingVesselPresentationSnapshot,
} from '../presentation/VesselFlowPresentation.ts';
import type { IncomingSpawnWarningPresentationSnapshot } from '../presentation/IncomingSpawnWarningPresentation.ts';
export {
  createIncomingVesselPresentation,
  DeparturePresentationStore,
} from '../presentation/VesselFlowPresentation.ts';
const DANGER_VISUAL_TTL_SECONDS = 0.45;
const CARGO_REJECT_VISUAL_TTL_SECONDS = 0.65;
const ROUTE_REJECT_VISUAL_TTL_SECONDS = 0.75;
export interface HarborShipPresentationSnapshot {
  readonly ship: ShipModelSnapshot;
  readonly remainingRoute: readonly Point[] | null;
  readonly routeRenderKey: string;
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
export interface HarborRouteRejectPulseSnapshot {
  readonly shipId: string;
  readonly kind: 'rejected_too_short' | 'rejected_invalid' | 'rejected_locked';
  readonly remainingSeconds: number;
}
export interface HarborRoutePreviewSnapshot {
  readonly shipId: string;
  readonly start: Point;
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
  readonly incoming: readonly IncomingVesselPresentationSnapshot[];
  readonly incomingWarnings: readonly IncomingSpawnWarningPresentationSnapshot[];
  readonly departures: readonly DeparturePresentationSnapshot[];
  readonly dangerPairs: readonly HarborDangerPairSnapshot[];
  readonly cargoRejectPulses: readonly HarborCargoRejectPulseSnapshot[];
  readonly routeRejectPulses: readonly HarborRouteRejectPulseSnapshot[];
  readonly selectedShipId: string | null;
  readonly activeDraft: ActiveRouteDraftSnapshot | null;
  readonly routePreview: HarborRoutePreviewSnapshot | null;
}
export type { HarborAuthoritativeSnapshot } from './HarborSnapshotCoordinator.ts';
export { selectRouteInputShip } from './RouteInputHitTest.ts';
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
function freezePoints(points: readonly Point[]): readonly Point[] {
  return Object.freeze(points.map((point) => Object.freeze({ ...point })));
}
export class HarborRuntime {
  readonly #exitZones: readonly ExitZoneDefinition[];
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
  readonly #routePreparation: RoutePreparationService;
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
  readonly #landRecovery: LandRecoverySystem;
  readonly #spawnPoints: readonly SpawnPoint[];
  readonly #session: ReturnType<typeof createGameSessionFromConfig>;
  readonly #spawning: HarborSpawnCoordinator;
  readonly #simulationPorts: HarborSimulationPorts;
  readonly #ships = new HarborShipRegistry();
  readonly #routes: HarborRouteCoordinator;
  readonly #snapshotCoordinator: HarborSnapshotCoordinator;
  readonly #departures: DeparturePresentationStore;
  readonly #presentationPulses = new PresentationPulseStore();
  #latestSimulationSnapshot: SimulationSnapshot | null = null;
  #activeForRenderAdvance = true;
  #presentationSelectedShipId: string | null = null;
  #pendingRoutePreviewDraft: RawRouteDraft | null = null;
  public constructor(options: HarborRuntimeOptions) {
    this.#levelId = options.levelId;
    this.#attemptSeed = options.attemptSeed;
    const level = options.bundle.levels[options.levelId];
    if (level === undefined) {
      throw new RangeError(`Unknown level: ${options.levelId}`);
    }
    const levelDefinition = toLevelDefinition(level);
    assertLevelSupported(levelDefinition);
    this.#allowedShipTypes = levelDefinition.allowedShips;
    const balance = new RuntimeConfigRegistry(options.bundle).balance();
    this.#clock = new FixedStepClock({
      fixedHz: balance.simulation.fixedHz,
      maxCatchUpSteps: balance.simulation.maxCatchUpSteps,
    });
    const logicalWorld = balance.simulation.logicalWorld;
    this.#viewport = new SquareWorldViewport({
      width: logicalWorld[0],
      height: logicalWorld[1],
    });
    this.#departures = new DeparturePresentationStore(this.#viewport.logicalWorld);
    this.#rng = new SeededRng(options.attemptSeed);
    this.#characteristics = createShipCharacteristicsRegistry(options.bundle);
    this.#landGeometry = createLandClearanceGeometryFromLevel(level);
    this.#routeConfig = createRouteProcessingConfig(options.bundle);
    this.#navigation = new NavigationValidator(this.#landGeometry.polygons);
    this.#routePreparation = new RoutePreparationService({
      navigation: this.#navigation,
      config: this.#routeConfig,
    });
    const routeCommit = new RouteCommitService({
      navigation: this.#navigation,
      config: this.#routeConfig,
      preparation: this.#routePreparation,
    });
    this.#docks = createDocksForValidatedLevel(options.bundle, options.levelId);
    this.#docking = new DockingController({
      docks: this.#docks,
      dockSystem: this.#dockSystem,
      config: createDockingConfig(options.bundle),
      landGeometry: this.#landGeometry,
      navigationClearanceExtra: this.#routeConfig.navigationClearanceExtra,
    });
    const departure = new DepartureCoordinator({ routes: routeCommit, docking: this.#docking });
    this.#cargo = new CargoSystem({
      dockSystem: this.#dockSystem,
    });
    this.#exitZones = createExitZones(levelDefinition);
    this.#exit = new ExitSystem({
      zones: this.#exitZones,
      worldBounds: this.#viewport.logicalWorld,
      score: createExitScore(options.bundle),
    });
    this.#collision = new CollisionSystem({
      config: createCollisionConfig(options.bundle),
    });
    this.#grounding = new GroundingSystem({
      geometry: this.#landGeometry,
      navigationClearanceExtra: this.#routeConfig.navigationClearanceExtra,
    });
    this.#landRecovery = new LandRecoverySystem({
      geometry: this.#landGeometry,
      navigationClearanceExtra: this.#routeConfig.navigationClearanceExtra,
    });
    this.#spawnPoints = createSpawnPointsForValidatedLevel(
      options.bundle,
      options.levelId,
    );
    this.#session = createGameSessionFromConfig(
      options.bundle,
      options.levelId,
      options.attemptSeed,
    );
    this.#spawning = new HarborSpawnCoordinator({
      bundle: options.bundle,
      levelId: options.levelId,
      spawnPoints: this.#spawnPoints,
      characteristics: this.#characteristics,
      rng: this.#rng,
      session: this.#session,
      ships: this.#ships,
      docks: () => this.#docks.values(),
    });
    this.#snapshotCoordinator = new HarborSnapshotCoordinator({
      levelId: this.#levelId,
      attemptSeed: this.#attemptSeed,
      session: this.#session,
      clock: this.#clock,
      rng: this.#rng,
      characteristics: this.#characteristics,
      docks: this.#docks,
      ships: this.#ships,
      spawning: this.#spawning,
      docking: this.#docking,
      cargo: this.#cargo,
      exit: this.#exit,
      collision: this.#collision,
    });
    this.#routeInput = new RouteInputController({
      viewport: this.#viewport,
      sampling: createRouteSamplingConfig(options.bundle),
      hitTest: (worldPoint, worldToCssPixelScale) =>
        this.#hitTestShip(worldPoint, worldToCssPixelScale),
      routeStartForShip: (ship) => this.#routeStartFor(ship),
    });

    this.#routes = new HarborRouteCoordinator({
      routes: routeCommit,
      departure,
      resolveShip: (shipId) => this.#ships.resolveShip(shipId),
      routeStartFor: (ship) => this.#routeStartFor(ship),
      isCommitDeferred: (ship) =>
        this.#docking.isShipInManeuver(ship.id) ||
        ship.routeRecoveryHeadingDeg !== null ||
        ship.landRecoveryHeadingDeg !== null,
      onCommitResult: (shipId, result) => {
        if (this.#pendingRoutePreviewDraft?.shipId === shipId) {
          this.#pendingRoutePreviewDraft = null;
        }
        if (
          result.kind === 'rejected_too_short' ||
          result.kind === 'rejected_invalid' ||
          result.kind === 'rejected_locked'
        ) {
          this.#presentationPulses.refreshRouteReject(
            shipId,
            result.kind,
            ROUTE_REJECT_VISUAL_TTL_SECONDS,
          );
        }
      },
    });

    this.#simulationPorts = new HarborSimulationPorts({
      session: this.#session,
      collision: this.#collision,
      grounding: this.#grounding,
      landRecovery: this.#landRecovery,
      docking: this.#docking,
      cargo: this.#cargo,
      exit: this.#exit,
      applyCommands: () => this.#routes.applyPending(),
      spawn: (deltaSeconds) => this.#spawning.step(deltaSeconds),
      move: (deltaSeconds) => { this.#ships.snapshotPreviousPoses(); this.#moveShips(deltaSeconds); },
      collisionCandidates: () => this.#ships.collisionCandidates((ship) => this.#docking.isShipCollidable(ship)),
      groundingCandidates: () => this.#ships.groundingCandidates((shipId) => this.#docking.isShipInManeuver(shipId)),
      landRecoveryShips: () => this.#ships.landRecoveryShips((shipId) => this.#docking.isShipInManeuver(shipId)),
      dockingCandidates: () => this.#ships.dockingCandidates(),
      cargoCandidates: () => this.#ships.cargoCandidates(this.#docks.values()),
      exitShips: () => this.#ships.exitShips(),
      resolveShip: (shipId) => this.#ships.resolveShip(shipId),
      onExit: (result) => this.#handleExitResult(result),
      projectFacts: (collision, cargo, exit) => projectAcceptedFacts({
        collision,
        cargo,
        exit,
        collisionEvents: this.#collisionEvents,
        cargoEvents: this.#cargoEvents,
        exitEvents: this.#exitEvents,
      }),
      capture: () => this.#captureEndOfStep(),
      flush: () => this.#flushEvents(),
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
    return this.#ships.size;
  }

  public get queuedRouteCommandCount(): number {
    return this.#routes.queuedCount;
  }

  public get lastRouteCommitResult(): RouteCommitResult | null {
    return this.#routes.lastCommitResult;
  }

  public objectiveSnapshot() {
    return this.#session.objectiveProgress;
  }

  public sessionSnapshot() {
    return this.#session.toSnapshot();
  }

  public latestSimulationSnapshot(): SimulationSnapshot | null {
    return this.#latestSimulationSnapshot === null
      ? null
      : structuredClone(this.#latestSimulationSnapshot);
  }

  public enqueueRouteDraft(draft: RawRouteDraft): void {
    this.#routes.enqueue(draft);
  }

  public pointerDown(input: NormalizedPointerInput): RouteInputOutcome {
    const outcome = this.#routeInput.pointerDown(input);
    if (outcome.kind === 'started') {
      this.#presentationSelectedShipId = outcome.shipId;
    }
    return outcome;
  }

  public pointerMove(input: NormalizedPointerInput): RouteInputOutcome {
    const ownsActiveDraft = this.#routeInput.activePointerId === input.pointerId;
    const outcome = this.#routeInput.pointerMove(input);
    const selectedShipId = this.#routeInput.selectedShipId;
    const selected = selectedShipId === null ? undefined : this.#ships.get(selectedShipId);
    if (
      ownsActiveDraft &&
      selected !== undefined &&
      (selected.ship.routeRecoveryHeadingDeg !== null ||
        selected.ship.landRecoveryHeadingDeg !== null)
    ) {
      this.#routeInput.rebaseActiveDraftToShip();
    }
    const activeDraft = this.#routeInput.activeDraftSnapshot;
    if (activeDraft !== null && ownsActiveDraft) {
      this.#routes.setLiveDraft(activeDraft);
    }
    return this.#handleRouteInputOutcome(outcome);
  }

  public pointerUp(input: NormalizedPointerInput): RouteInputOutcome {
    return this.#handleRouteInputOutcome(this.#routeInput.pointerUp(input));
  }

  public pointerCancel(input: NormalizedPointerInput): RouteInputOutcome {
    return this.#handleRouteInputOutcome(this.#routeInput.pointerCancel(input));
  }

  public cancelActiveDraft(): RouteInputOutcome {
    return this.#handleRouteInputOutcome(this.#routeInput.cancelActiveDraft());
  }

  public setPageActive(active: boolean): void {
    this.#activeForRenderAdvance = active;
    if (!active) {
      this.#handleRouteInputOutcome(this.#routeInput.cancelActiveDraft());
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
    if (!this.#activeForRenderAdvance) {
      return Object.freeze({
        steps: 0,
        interpolationAlpha: this.#clock.interpolationAlpha,
      });
    }
    this.#departures.advance(renderDeltaMilliseconds / 1000);
    if (this.#session.state !== SessionState.Active) {
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
    const ships = [...this.#ships.values()]
      .sort((left, right) => left.spawnSequence - right.spawnSequence)
      .map((record) => {
        const routeRender = createRouteRenderState(
          record.ship,
          this.#docking.departurePresentationPrefix(record.ship),
        );
        return Object.freeze({
          ship: record.ship.toSnapshot(),
          remainingRoute: routeRender.points,
          routeRenderKey: routeRender.key,
          spawnSequence: record.spawnSequence,
          previousPosition: Object.freeze({ ...record.previousPosition }),
          previousRotationDeg: record.previousRotationDeg,
        });
      });
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
    const routeRejectPulses = this.#presentationPulses.routeRejectSnapshot();
    return Object.freeze({
      levelId: this.#levelId,
      simulationTime: this.#session.simulationTime,
      score: this.#session.score,
      objective: this.#session.objectiveProgress,
      warningCount: this.#session.metricsSnapshot.warningCount,
      result: this.#session.result,
      ships: Object.freeze(ships),
      docks: Object.freeze(docks),
      exits: this.#exitZones,
      land: this.#landGeometry.polygons,
      spawnPoints: this.#spawnPoints,
      incoming: this.#spawning.presentationSnapshot(this.#session.simulationTime),
      incomingWarnings: this.#spawning.warningPresentationSnapshot(
        this.#session.simulationTime,
        this.#viewport.logicalWorld,
      ),
      departures: this.#departures.snapshot(),
      dangerPairs: Object.freeze(dangerPairs),
      cargoRejectPulses: Object.freeze(cargoRejectPulses),
      routeRejectPulses: Object.freeze(routeRejectPulses),
      selectedShipId: this.#presentationSelectedShipId,
      activeDraft: this.#routeInput.activeDraftSnapshot,
      routePreview: this.#createRoutePreviewSnapshot(),
    });
  }

  public authoritativeSnapshot(): HarborAuthoritativeSnapshot {
    return this.#snapshotCoordinator.authoritativeSnapshot(this.#routes.queuedCount);
  }

  public captureSimulationSnapshot(): SimulationSnapshot {
    return this.#snapshotCoordinator.captureSimulationSnapshot({
      queuedCommands: this.#routes.queuedCount,
      hasLiveDraft: this.#routes.hasLiveDraft,
      pendingEvents:
        this.#collisionEvents.pendingCount +
        this.#cargoEvents.pendingCount +
        this.#exitEvents.pendingCount,
    });
  }

  public restoreSimulationSnapshot(snapshot: SimulationSnapshot): void {
    this.#routeInput.cancelActiveDraft();
    this.#routes.clear();
    this.#presentationSelectedShipId = null;
    this.#pendingRoutePreviewDraft = null;
    this.#collisionEvents.clear();
    this.#cargoEvents.clear();
    this.#exitEvents.clear();
    this.#presentationPulses.clear();
    this.#departures.clear();
    this.#spawning.clearPresentation();

    this.#snapshotCoordinator.restoreSimulationSnapshot(snapshot);
    this.#latestSimulationSnapshot = structuredClone(snapshot);
  }

  #handleRouteInputOutcome(outcome: RouteInputOutcome): RouteInputOutcome {
    if (outcome.kind === 'finished') {
      this.#routes.setLiveDraft(null);
      const record = this.#ships.get(outcome.draft.shipId);
      this.#pendingRoutePreviewDraft = record?.ship.state === ShipState.ReadyToLeave
        ? outcome.draft
        : null;
      this.enqueueRouteDraft(outcome.draft);
    } else if (outcome.kind === 'cancelled') {
      this.#routes.setLiveDraft(null);
      this.#pendingRoutePreviewDraft = null;
      this.#presentationSelectedShipId = null;
    }
    return outcome;
  }

  #discardInvalidPresentationSelection(): void {
    const selectedShipId = this.#presentationSelectedShipId;
    if (selectedShipId === null) return;
    const selected = this.#ships.get(selectedShipId);
    if (
      selected === undefined ||
      this.#session.state !== SessionState.Active ||
      !isRouteInputState(selected.ship.state)
    ) {
      this.#presentationSelectedShipId = null;
    }
  }

  #createRoutePreviewSnapshot(): HarborRoutePreviewSnapshot | null {
    const draft = this.#routeInput.activeDraftSnapshot ?? this.#pendingRoutePreviewDraft;
    if (draft === null) {
      return null;
    }
    const record = this.#ships.get(draft.shipId);
    if (record === undefined) {
      return null;
    }
    const routeStart = this.#routeStartFor(record.ship);
    const prepared = this.#routePreparation.prepare({
      ship: record.ship,
      points: materializeRouteDraftFromStart(draft, routeStart),
      start: routeStart,
    });
    const remaining = prepared.validPoints.length === 0
      ? Object.freeze([])
      : new ShipRoute(prepared.validPoints, routeStart).remainingPolyline(0);
    const authoredPreview = (
      Math.hypot(record.ship.x - routeStart.x, record.ship.y - routeStart.y) > 1e-9 &&
      remaining.length > 0
    )
      ? [routeStart, ...remaining.slice(1)]
      : remaining.slice(1);
    const previewPoints = composeRoutePresentationTail(
      this.#docking.departurePresentationPrefix(record.ship),
      authoredPreview,
    );
    return Object.freeze({
      shipId: draft.shipId,
      start: Object.freeze({ ...record.ship.position }),
      validPoints: freezePoints(previewPoints),
      rejectedPoints: freezePoints(prepared.rejectedPoints),
    });
  }

  #fixedStep(deltaSeconds: number): void {
    if (this.#session.state !== SessionState.Active) return;
    this.#advancePresentationPulses(deltaSeconds);
    this.#session.runSimulationStep(deltaSeconds, this.#simulationPorts);
  }

  #handleExitResult(exit: import('../exits/ExitSystem.ts').ExitStepResult): void {
    for (const shipId of exit.rejectedCargoShipIds) {
      this.#presentationPulses.refreshCargoReject(shipId, CARGO_REJECT_VISUAL_TTL_SECONDS);
    }
    for (const shipId of exit.despawnedShipIds) {
      const record = this.#ships.get(shipId);
      if (record !== undefined) {
        this.#departures.add({
          shipId,
          shipType: record.ship.characteristics.type,
          position: record.ship.position,
          rotationDeg: record.ship.rotationDeg,
          speed: record.ship.characteristics.speed,
          collisionRadius: record.ship.characteristics.collisionRadius,
        });
      }
      this.#removeActiveShip(shipId);
    }
  }

  #advancePresentationPulses(deltaSeconds: number): void {
    this.#presentationPulses.advance(deltaSeconds);
  }

  #routeStartFor(ship: ShipModel): Point {
    if (ship.state !== ShipState.ReadyToLeave && ship.state !== ShipState.Leaving) {
      return ship.position;
    }
    return this.#docking.departureRouteStart(ship) ?? ship.position;
  }

  #moveShips(deltaSeconds: number): void {
    const liveShipId = this.#routeInput.activeDraftSnapshot?.shipId ?? null;
    for (const record of this.#ships.values()) {
      this.#shipMotor.stepRoute(
        record.ship,
        deltaSeconds,
        record.ship.id !== liveShipId,
      );
    }
  }

  #removeActiveShip(shipId: string): void {
    if (!this.#ships.delete(shipId)) {
      return;
    }
    this.#collision.forgetShip(shipId);
    this.#docking.forgetShip(shipId);
    this.#exit.forgetShip(shipId);
    this.#session.forgetShip(shipId);
    this.#presentationPulses.forgetShip(shipId);
    if (this.#presentationSelectedShipId === shipId) {
      this.#presentationSelectedShipId = null;
    }
    if (this.#pendingRoutePreviewDraft?.shipId === shipId) {
      this.#pendingRoutePreviewDraft = null;
    }
    if (this.#routeInput.selectedShipId === shipId) {
      this.#routeInput.cancelActiveDraft();
    }
    this.#routes.forgetShip(shipId);
  }

  #captureEndOfStep(): void {
    if (
      this.#routes.queuedCount !== 0 ||
      this.#routes.hasLiveDraft ||
      this.#collisionEvents.pendingCount !== 0 ||
      this.#cargoEvents.pendingCount !== 0 ||
      this.#exitEvents.pendingCount !== 0
    ) {
      return;
    }
    this.#latestSimulationSnapshot = this.captureSimulationSnapshot();
  }

  #flushEvents(): void {
    this.#collisionEvents.flush();
    this.#cargoEvents.flush();
    this.#exitEvents.flush();
  }

  #hitTestShip(worldPoint: Point, worldToCssPixelScale: number): ShipModel | null {
    return selectRouteInputShip(
      [...this.#ships.values()].filter(
        (record) => !this.#docking.isShipInManeuver(record.ship.id),
      ),
      worldPoint,
      worldToCssPixelScale,
    );
  }
}
