import type { ConfigBundle } from '../config/types.ts';

export interface ScoreConfig {
  readonly cargoUnit: number;
  readonly shipExit: number;
  readonly campaignCompletionBonus: number;
}

export interface ScoreServiceSnapshot {
  readonly score: number;
  readonly completionBonusApplied: boolean;
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number`);
  }
}

function freezeScoreConfig(config: ScoreConfig): ScoreConfig {
  assertNonNegativeFinite(config.cargoUnit, 'score.cargoUnit');
  assertNonNegativeFinite(config.shipExit, 'score.shipExit');
  assertNonNegativeFinite(
    config.campaignCompletionBonus,
    'score.campaignCompletionBonus',
  );
  return Object.freeze({ ...config });
}

export function createScoreConfig(bundle: ConfigBundle): ScoreConfig {
  const balance = bundle.configs['balance.json'] as {
    readonly score: ScoreConfig;
  };
  return freezeScoreConfig(balance.score);
}

export class ScoreService {
  readonly #config: ScoreConfig;
  #score = 0;
  #completionBonusApplied = false;

  public constructor(config: ScoreConfig) {
    this.#config = freezeScoreConfig(config);
  }

  public get score(): number {
    return this.#score;
  }

  public get config(): ScoreConfig {
    return this.#config;
  }

  public addCargoUnits(count: number): void {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError('cargo unit count must be a non-negative integer');
    }
    this.#score += count * this.#config.cargoUnit;
  }

  public addExitScore(scoreDelta: number): void {
    assertNonNegativeFinite(scoreDelta, 'exit scoreDelta');
    this.#score += scoreDelta;
  }

  public addCampaignCompletionBonus(): void {
    if (this.#completionBonusApplied) {
      return;
    }
    this.#score += this.#config.campaignCompletionBonus;
    this.#completionBonusApplied = true;
  }

  public toSnapshot(): ScoreServiceSnapshot {
    return Object.freeze({
      score: this.#score,
      completionBonusApplied: this.#completionBonusApplied,
    });
  }

  public restore(snapshot: ScoreServiceSnapshot): void {
    assertNonNegativeFinite(snapshot.score, 'score');
    this.#score = snapshot.score;
    this.#completionBonusApplied = snapshot.completionBonusApplied;
  }
}
