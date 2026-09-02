export interface IRng {
  next(): number;
  range(minimum: number, maximum: number): number;
  getState(): number[];
  setState(state: readonly number[]): void;
}

const UINT32_RANGE = 0x1_0000_0000;
const STATE_INCREMENT = 0x6d2b_79f5;

function requireSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer`);
  }
}

export class SeededRng implements IRng {
  #state: number;

  public constructor(seed: number) {
    requireSafeInteger(seed, 'seed');
    this.#state = seed >>> 0;
  }

  public next(): number {
    this.#state = (this.#state + STATE_INCREMENT) >>> 0;
    let value = this.#state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  }

  public range(minimum: number, maximum: number): number {
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
      throw new RangeError('range bounds must be finite numbers');
    }
    if (maximum < minimum) {
      throw new RangeError('maximum must be greater than or equal to minimum');
    }
    return minimum + (maximum - minimum) * this.next();
  }

  public getState(): number[] {
    return [this.#state];
  }

  public setState(state: readonly number[]): void {
    if (state.length !== 1) {
      throw new RangeError('SeededRng state must contain exactly one value');
    }
    const value = state[0];
    if (value === undefined) {
      throw new RangeError('SeededRng state value is required');
    }
    requireSafeInteger(value, 'state value');
    if (value < 0 || value >= UINT32_RANGE) {
      throw new RangeError('state value must be an unsigned 32-bit integer');
    }
    this.#state = value;
  }
}
