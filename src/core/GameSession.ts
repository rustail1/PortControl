import type { ConfigBundle } from '../config/types.ts';
import type { TerminalCollision } from '../collision/CollisionSystem.ts';
import type { CargoUnloadFact } from '../docks/CargoSystem.ts';
import type { ExitedShipFact } from '../exits/ExitSystem.ts';
import type { CargoManifest } from '../ships/ShipModel.ts';
import {
  ObjectiveSystem,
  ScoreService,
  SessionMetrics,
  StarEvaluator,
  createScoreConfig,
  parseObjectiveDefinition,
  parseStarConditions,
  type ObjectiveProgressSnapshot,
  type ScoreConfig,
  type ScoreServiceSnapshot,
  type SessionMetricsSnapshot,
  type StarResult,
  type StormHitFact,
  type WrongDockAttemptFact,
} from '../objectives/index.ts';
import { SessionState, type SessionState as SessionStateValue } from './SessionState.ts';

export interface GroundingTerminalCandidate {
  readonly shipId: string;
  readonly failReason: 'grounding';
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface SessionStepInput {
  readonly deltaSeconds: number;
  readonly collisionTerminal?: TerminalCollision | null;
  readonly groundingTerminal?: GroundingTerminalCandidate | null;
  readonly dangerWarningCount?: number;
  readonly cargoUnloadedFacts?: readonly CargoUnloadFact[];
  readonly exitedShipFacts?: readonly ExitedShipFact[];
  readonly wrongDockAttemptFacts?: readonly WrongDockAttemptFact[];
  readonly stormHitFacts?: readonly StormHitFact[];
}

export interface CompletedSessionResult {
  readonly kind: 'completed';
  readonly levelId: string;
  readonly attemptSeed: number;
  readonly completionTimeSeconds: number;
  readonly score: number;
  readonly earnedStars: number;
  readonly starResults: readonly StarResult[];
  readonly objective: ObjectiveProgressSnapshot;
  readonly metrics: SessionMetricsSnapshot;
}

export interface FailedSessionResult {
  readonly kind: 'failed';
  readonly levelId: string;
  readonly attemptSeed: number;
  readonly failureTimeSeconds: number;
  readonly failReason: 'collision' | 'grounding';
  readonly score: number;
  readonly terminalCandidate: TerminalCollision | GroundingTerminalCandidate;
}

export type SessionResult = CompletedSessionResult | FailedSessionResult;

export interface GameSessionSnapshot {
  readonly levelId: string;
  readonly attemptSeed: number;
  readonly simulationTime: number;
  readonly state: SessionStateValue;
  readonly objective: ObjectiveProgressSnapshot;
  readonly metrics: SessionMetricsSnapshot;
  readonly score: ScoreServiceSnapshot;
  readonly result: SessionResult | null;
}

export interface GameSessionOptions {
  readonly level: Record<string, unknown>;
  readonly scoreConfig: ScoreConfig;
  readonly attemptSeed: number;
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number`);
  }
}

function assertAttemptSeed(value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError('attemptSeed must be a safe integer');
  }
}

function levelIdFrom(level: Record<string, unknown>): string {
  const levelId = level['id'];
  if (typeof levelId !== 'string' || levelId.length === 0) {
    throw new RangeError('level.id must not be empty');
  }
  return levelId;
}

function copyGroundingCandidate(
  candidate: GroundingTerminalCandidate,
): GroundingTerminalCandidate {
  return Object.freeze({
    shipId: candidate.shipId,
    failReason: 'grounding',
    ...(candidate.details === undefined
      ? {}
      : { details: Object.freeze({ ...candidate.details }) }),
  });
}

function copyTerminalCandidate(
  candidate: TerminalCollision | GroundingTerminalCandidate,
): TerminalCollision | GroundingTerminalCandidate {
  if (candidate.failReason === 'collision') {
    return Object.freeze({ ...candidate });
  }
  return copyGroundingCandidate(candidate);
}

function copyStarResult(result: StarResult): StarResult {
  const condition =
    result.condition.type === 'min_ship_group_exits'
      ? Object.freeze({
          ...result.condition,
          shipIds: Object.freeze([...result.condition.shipIds]),
        })
      : Object.freeze({ ...result.condition });
  return Object.freeze({ condition, earned: result.earned });
}

function copyCompletedResult(result: CompletedSessionResult): CompletedSessionResult {
  return Object.freeze({
    kind: 'completed',
    levelId: result.levelId,
    attemptSeed: result.attemptSeed,
    completionTimeSeconds: result.completionTimeSeconds,
    score: result.score,
    earnedStars: result.earnedStars,
    starResults: Object.freeze(result.starResults.map(copyStarResult)),
    objective: Object.freeze({ ...result.objective }),
    metrics: Object.freeze({
      ...result.metrics,
      cargoUnloadedByType: Object.freeze({ ...result.metrics.cargoUnloadedByType }),
      exitsByShipType: Object.freeze({ ...result.metrics.exitsByShipType }),
      stormHitsByShipType: Object.freeze({ ...result.metrics.stormHitsByShipType }),
      exitTimeline: Object.freeze(
        result.metrics.exitTimeline.map((entry) => Object.freeze({ ...entry })),
      ),
      spawnedShipProvenance: Object.freeze(
        result.metrics.spawnedShipProvenance.map((entry) =>
          Object.freeze({ ...entry }),
        ),
      ),
      countedExitShipIds: Object.freeze([...result.metrics.countedExitShipIds]),
    }),
  });
}

function copyFailedResult(result: FailedSessionResult): FailedSessionResult {
  return Object.freeze({
    ...result,
    terminalCandidate: copyTerminalCandidate(result.terminalCandidate),
  });
}

function copyResult(result: SessionResult | null): SessionResult | null {
  if (result === null) {
    return null;
  }
  return result.kind === 'completed'
    ? copyCompletedResult(result)
    : copyFailedResult(result);
}

export function createGameSessionFromConfig(
  bundle: ConfigBundle,
  levelId: string,
  attemptSeed: number,
): GameSession {
  const level = bundle.levels[levelId];
  if (level === undefined) {
    throw new RangeError(`Unknown level: ${levelId}`);
  }
  return new GameSession({
    level,
    scoreConfig: createScoreConfig(bundle),
    attemptSeed,
  });
}

export class GameSession {
  readonly #levelId: string;
  readonly #attemptSeed: number;
  readonly #objective: ObjectiveSystem;
  readonly #stars: StarEvaluator;
  readonly #metrics = new SessionMetrics();
  readonly #score: ScoreService;
  #simulationTime = 0;
  #state: SessionStateValue = SessionState.Active;
  #result: SessionResult | null = null;

  public constructor(options: GameSessionOptions) {
    this.#levelId = levelIdFrom(options.level);
    assertAttemptSeed(options.attemptSeed);
    this.#attemptSeed = options.attemptSeed;
    this.#objective = new ObjectiveSystem(parseObjectiveDefinition(options.level));
    this.#stars = new StarEvaluator(parseStarConditions(options.level));
    this.#score = new ScoreService(options.scoreConfig);
  }

  public get levelId(): string {
    return this.#levelId;
  }

  public get attemptSeed(): number {
    return this.#attemptSeed;
  }

  public get simulationTime(): number {
    return this.#simulationTime;
  }

  public get state(): SessionStateValue {
    return this.#state;
  }

  public get score(): number {
    return this.#score.score;
  }

  public get result(): SessionResult | null {
    return this.#result;
  }

  public get objectiveProgress(): ObjectiveProgressSnapshot {
    return this.#objective.toSnapshot();
  }

  public get metricsSnapshot(): SessionMetricsSnapshot {
    return this.#metrics.toSnapshot();
  }

  public registerSpawnedShip(input: {
    readonly shipId: string;
    readonly shipType: string;
    readonly initialCargo: CargoManifest;
  }): void {
    if (this.#state !== SessionState.Active) {
      return;
    }
    this.#metrics.registerSpawnedShip(input);
  }

  public step(input: SessionStepInput): SessionResult | null {
    if (this.#state !== SessionState.Active) {
      return this.#result;
    }
    assertNonNegativeFinite(input.deltaSeconds, 'deltaSeconds');
    this.#simulationTime += input.deltaSeconds;

    const terminal = input.collisionTerminal ?? input.groundingTerminal ?? null;
    if (terminal !== null) {
      this.#fail(terminal);
      return this.#result;
    }

    const warnings = input.dangerWarningCount ?? 0;
    if (!Number.isInteger(warnings) || warnings < 0) {
      throw new RangeError('dangerWarningCount must be a non-negative integer');
    }
    const cargoFacts = input.cargoUnloadedFacts ?? [];
    const exitFacts = input.exitedShipFacts ?? [];
    const wrongDockFacts = input.wrongDockAttemptFacts ?? [];
    const stormFacts = input.stormHitFacts ?? [];

    this.#metrics.recordWarnings(warnings);
    this.#metrics.recordCargoUnloaded(cargoFacts);
    this.#score.addCargoUnits(cargoFacts.length);

    for (const exitFact of exitFacts) {
      if (this.#metrics.recordExit(exitFact, this.#simulationTime)) {
        this.#score.addExitScore(exitFact.scoreDelta);
      }
    }
    this.#metrics.recordWrongDockAttempts(wrongDockFacts);
    this.#metrics.recordStormHits(stormFacts);

    const objective = this.#objective.step(this.#simulationTime, this.#metrics);
    if (objective.completed) {
      const completionTimeSeconds = objective.completionTimeSeconds;
      if (completionTimeSeconds === null) {
        throw new Error('completed objective must have completion time');
      }
      const starResults = this.#stars.evaluate({
        objectiveCompleted: true,
        completionTimeSeconds,
        metrics: this.#metrics,
      });
      this.#score.addCampaignCompletionBonus();
      const earnedStars = starResults.reduce(
        (total, star) => total + (star.earned ? 1 : 0),
        0,
      );
      this.#state = SessionState.Completed;
      this.#result = copyCompletedResult({
        kind: 'completed',
        levelId: this.#levelId,
        attemptSeed: this.#attemptSeed,
        completionTimeSeconds,
        score: this.#score.score,
        earnedStars,
        starResults,
        objective,
        metrics: this.#metrics.toSnapshot(),
      });
    }
    return this.#result;
  }

  public toSnapshot(): GameSessionSnapshot {
    return Object.freeze({
      levelId: this.#levelId,
      attemptSeed: this.#attemptSeed,
      simulationTime: this.#simulationTime,
      state: this.#state,
      objective: Object.freeze({ ...this.#objective.toSnapshot() }),
      metrics: this.#metrics.toSnapshot(),
      score: this.#score.toSnapshot(),
      result: copyResult(this.#result),
    });
  }

  public restore(snapshot: GameSessionSnapshot): void {
    if (snapshot.levelId !== this.#levelId) {
      throw new RangeError('session snapshot levelId does not match');
    }
    if (snapshot.attemptSeed !== this.#attemptSeed) {
      throw new RangeError('session snapshot attemptSeed does not match');
    }
    assertNonNegativeFinite(snapshot.simulationTime, 'simulationTime');
    if (!Object.values(SessionState).includes(snapshot.state)) {
      throw new RangeError(`Unknown SessionState: ${snapshot.state}`);
    }
    this.#simulationTime = snapshot.simulationTime;
    this.#objective.restore(snapshot.objective);
    this.#metrics.restore(snapshot.metrics);
    this.#score.restore(snapshot.score);
    this.#state = snapshot.state;
    this.#result = copyResult(snapshot.result);

    if (
      (this.#state === SessionState.Active && this.#result !== null) ||
      (this.#state === SessionState.Completed &&
        this.#result?.kind !== 'completed') ||
      (this.#state === SessionState.Failed && this.#result?.kind !== 'failed')
    ) {
      throw new RangeError('session state/result snapshot is inconsistent');
    }
  }

  #fail(candidate: TerminalCollision | GroundingTerminalCandidate): void {
    this.#state = SessionState.Failed;
    this.#result = copyFailedResult({
      kind: 'failed',
      levelId: this.#levelId,
      attemptSeed: this.#attemptSeed,
      failureTimeSeconds: this.#simulationTime,
      failReason: candidate.failReason,
      score: this.#score.score,
      terminalCandidate: candidate,
    });
  }
}
