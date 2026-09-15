import type { ConfigBundle } from './types.ts';

export interface RuntimeBalanceConfig {
  readonly simulation: {
    readonly fixedHz: number;
    readonly maxCatchUpSteps: number;
    readonly logicalWorld: readonly [number, number];
  };
  readonly route: {
    readonly sampleDistance: number;
    readonly maxRawPoints: number;
    readonly minValidRouteLength: number;
    readonly navigationClearanceExtra: number;
  };
  readonly docking: {
    readonly reservationTieBreak: string;
    readonly collisionEnabledDuringHarborAssist: boolean;
  };
  readonly collision: {
    readonly warningRearmOutsideMs: number;
  };
  readonly score: {
    readonly cargoUnit: number;
    readonly shipExit: number;
    readonly campaignCompletionBonus: number;
  };
  readonly visual: {
    readonly worldBackground: string | null;
  };
  readonly spawnDirector: {
    readonly occupiedDockPressureWeight: number;
    readonly activeStormCellPressureWeight: number;
    readonly unsafeSpawnRetryDelayMs: number;
  };
}

function requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RangeError(`${label} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireNumber(record: Readonly<Record<string, unknown>>, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${label}.${key} must be finite`);
  }
  return value;
}

function requireString(record: Readonly<Record<string, unknown>>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new RangeError(`${label}.${key} must be a non-empty string`);
  }
  return value;
}

function requireBoolean(record: Readonly<Record<string, unknown>>, key: string, label: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new RangeError(`${label}.${key} must be boolean`);
  }
  return value;
}

export class RuntimeConfigRegistry {
  readonly #bundle: ConfigBundle;
  #balance: RuntimeBalanceConfig | null = null;

  public constructor(bundle: ConfigBundle) {
    this.#bundle = bundle;
  }

  public balance(): RuntimeBalanceConfig {
    if (this.#balance !== null) return this.#balance;
    const raw = this.#bundle.configs['balance.json'];
    if (raw === undefined) throw new RangeError('balance.json is required');

    const simulation = requireRecord(raw['simulation'], 'balance.simulation');
    const route = requireRecord(raw['route'], 'balance.route');
    const docking = requireRecord(raw['docking'], 'balance.docking');
    const collision = requireRecord(raw['collision'], 'balance.collision');
    const score = requireRecord(raw['score'], 'balance.score');
    const visual = requireRecord(raw['visual'], 'balance.visual');
    const spawnDirector = requireRecord(raw['spawnDirector'], 'balance.spawnDirector');
    // Frozen v1.5 field remains schema-valid but is intentionally not runtime movement authority.
    requireNumber(docking, 'baseSnapDurationMs', 'balance.docking');
    const logicalWorld = simulation['logicalWorld'];
    if (
      !Array.isArray(logicalWorld) ||
      logicalWorld.length !== 2 ||
      !logicalWorld.every((value) => typeof value === 'number' && Number.isFinite(value))
    ) {
      throw new RangeError('balance.simulation.logicalWorld must contain two finite numbers');
    }

    this.#balance = Object.freeze({
      simulation: Object.freeze({
        fixedHz: requireNumber(simulation, 'fixedHz', 'balance.simulation'),
        maxCatchUpSteps: requireNumber(simulation, 'maxCatchUpSteps', 'balance.simulation'),
        logicalWorld: Object.freeze([logicalWorld[0], logicalWorld[1]]) as readonly [number, number],
      }),
      route: Object.freeze({
        sampleDistance: requireNumber(route, 'sampleDistance', 'balance.route'),
        maxRawPoints: requireNumber(route, 'maxRawPoints', 'balance.route'),
        minValidRouteLength: requireNumber(route, 'minValidRouteLength', 'balance.route'),
        navigationClearanceExtra: requireNumber(route, 'navigationClearanceExtra', 'balance.route'),
      }),
      docking: Object.freeze({
        reservationTieBreak: requireString(docking, 'reservationTieBreak', 'balance.docking'),
        collisionEnabledDuringHarborAssist: requireBoolean(docking, 'collisionEnabledUntilSnapComplete', 'balance.docking'),
      }),
      collision: Object.freeze({
        warningRearmOutsideMs: requireNumber(collision, 'warningRearmOutsideMs', 'balance.collision'),
      }),
      score: Object.freeze({
        cargoUnit: requireNumber(score, 'cargoUnit', 'balance.score'),
        shipExit: requireNumber(score, 'shipExit', 'balance.score'),
        campaignCompletionBonus: requireNumber(score, 'campaignCompletionBonus', 'balance.score'),
      }),
      visual: Object.freeze({
        worldBackground: typeof visual['worldBackground'] === 'string' ? visual['worldBackground'] : null,
      }),
      spawnDirector: Object.freeze({
        occupiedDockPressureWeight: requireNumber(spawnDirector, 'occupiedDockPressureWeight', 'balance.spawnDirector'),
        activeStormCellPressureWeight: requireNumber(spawnDirector, 'activeStormCellPressureWeight', 'balance.spawnDirector'),
        unsafeSpawnRetryDelayMs: requireNumber(spawnDirector, 'unsafeSpawnRetryDelayMs', 'balance.spawnDirector'),
      }),
    });
    return this.#balance;
  }
}
