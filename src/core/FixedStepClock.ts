export interface FixedStepClockConfig {
  readonly fixedHz: number;
  readonly maxCatchUpSteps: number;
}

export interface FixedStepAdvanceResult {
  readonly steps: number;
  readonly interpolationAlpha: number;
}

export type FixedStepCallback = (deltaSeconds: number) => void;

const MILLISECONDS_PER_SECOND = 1000;
const STEP_EPSILON = 1e-10;

export class FixedStepClock {
  readonly #fixedHz: number;
  readonly #maxCatchUpSteps: number;
  readonly #stepSeconds: number;
  readonly #maximumFrameDeltaMilliseconds: number;
  #accumulatedSteps = 0;
  #completedSteps = 0;

  public constructor(config: FixedStepClockConfig) {
    if (!Number.isFinite(config.fixedHz) || config.fixedHz <= 0) {
      throw new RangeError('fixedHz must be a positive finite number');
    }
    if (
      !Number.isInteger(config.maxCatchUpSteps) ||
      config.maxCatchUpSteps <= 0
    ) {
      throw new RangeError('maxCatchUpSteps must be a positive integer');
    }

    this.#fixedHz = config.fixedHz;
    this.#maxCatchUpSteps = config.maxCatchUpSteps;
    this.#stepSeconds = 1 / config.fixedHz;
    this.#maximumFrameDeltaMilliseconds =
      (config.maxCatchUpSteps / config.fixedHz) * MILLISECONDS_PER_SECOND;
  }

  public get elapsedSeconds(): number {
    return this.#completedSteps / this.#fixedHz;
  }

  public get interpolationAlpha(): number {
    return Math.min(Math.max(this.#accumulatedSteps, 0), 1 - Number.EPSILON);
  }

  public advance(
    renderDeltaMilliseconds: number,
    step: FixedStepCallback,
  ): FixedStepAdvanceResult {
    if (
      !Number.isFinite(renderDeltaMilliseconds) ||
      renderDeltaMilliseconds < 0
    ) {
      throw new RangeError(
        'renderDeltaMilliseconds must be a non-negative finite number',
      );
    }

    const acceptedDelta = Math.min(
      renderDeltaMilliseconds,
      this.#maximumFrameDeltaMilliseconds,
    );
    this.#accumulatedSteps +=
      (acceptedDelta * this.#fixedHz) / MILLISECONDS_PER_SECOND;

    let steps = 0;
    while (
      this.#accumulatedSteps + STEP_EPSILON >= 1 &&
      steps < this.#maxCatchUpSteps
    ) {
      this.#accumulatedSteps -= 1;
      if (Math.abs(this.#accumulatedSteps) < STEP_EPSILON) {
        this.#accumulatedSteps = 0;
      }
      this.#completedSteps += 1;
      steps += 1;
      step(this.#stepSeconds);
    }

    return {
      steps,
      interpolationAlpha: this.interpolationAlpha,
    };
  }
}
