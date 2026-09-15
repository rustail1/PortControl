export interface LevelBlockDefinition {
  readonly blockType?: string;
  readonly enabled?: boolean;
  readonly [key: string]: unknown;
}

export interface LevelDefinition {
  readonly id: string;
  readonly allowedShips: readonly string[];
  readonly layout: { readonly blocks: readonly LevelBlockDefinition[] };
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface SpawnDirectorLevelDefinition {
  readonly id: string;
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
    readonly wave: {
      readonly burstMin: number;
      readonly burstMax: number;
      readonly breathMin: number;
      readonly breathMax: number;
    };
  };
  readonly scriptedIntroShip: string | null;
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

function requireStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new RangeError(`${label} must be a string array`);
  }
  return Object.freeze([...value]);
}

function requireNumberRecord(value: unknown, label: string): Readonly<Record<string, number>> {
  const record = requireRecord(value, label);
  const output: Record<string, number> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      throw new RangeError(`${label}.${key} must be finite`);
    }
    output[key] = item;
  }
  return Object.freeze(output);
}

export function toLevelDefinition(level: Record<string, unknown>): LevelDefinition {
  const id = level['id'];
  const allowedShips = level['allowedShips'];
  const layout = level['layout'];
  const blocks = typeof layout === 'object' && layout !== null && Array.isArray((layout as { blocks?: unknown }).blocks)
    ? (layout as { blocks: unknown[] }).blocks
    : null;
  if (typeof id !== 'string' || id.length === 0) throw new RangeError('level.id must be a non-empty string');
  if (!Array.isArray(allowedShips) || !allowedShips.every((value) => typeof value === 'string')) throw new RangeError('level.allowedShips must be a string array');
  if (blocks === null || !blocks.every((value) => typeof value === 'object' && value !== null)) throw new RangeError('level.layout.blocks must be an object array');
  return Object.freeze({ id, allowedShips: Object.freeze([...allowedShips]), layout: Object.freeze({ blocks: Object.freeze(blocks as LevelBlockDefinition[]) }), raw: level });
}

export function toSpawnDirectorLevelDefinition(level: Record<string, unknown>): SpawnDirectorLevelDefinition {
  const base = toLevelDefinition(level);
  const cargoGeneration = requireRecord(level['cargoGeneration'], 'level.cargoGeneration');
  const cargoMode = cargoGeneration['mode'];
  if (cargoMode !== 'single' && cargoMode !== 'mixed') {
    throw new RangeError('level.cargoGeneration.mode must be single or mixed');
  }
  const director = requireRecord(level['director'], 'level.director');
  const wave = requireRecord(director['wave'], 'level.director.wave');
  const flags = requireRecord(level['flags'], 'level.flags');
  const scriptedIntroShip = flags['scriptedIntroShip'];
  if (scriptedIntroShip !== undefined && scriptedIntroShip !== null && typeof scriptedIntroShip !== 'string') {
    throw new RangeError('level.flags.scriptedIntroShip must be string or null');
  }

  return Object.freeze({
    id: base.id,
    allowedShips: base.allowedShips,
    shipWeights: level['shipWeights'] === undefined
      ? Object.freeze({})
      : requireNumberRecord(level['shipWeights'], 'level.shipWeights'),
    cargoTypes: requireStringArray(level['cargoTypes'], 'level.cargoTypes'),
    cargoGeneration: Object.freeze({
      mode: cargoMode,
      weights: requireNumberRecord(cargoGeneration['weights'], 'level.cargoGeneration.weights'),
      multiCargoChance: requireNumber(cargoGeneration, 'multiCargoChance', 'level.cargoGeneration'),
    }),
    director: Object.freeze({
      startInterval: requireNumber(director, 'startInterval', 'level.director'),
      minimumInterval: requireNumber(director, 'minimumInterval', 'level.director'),
      warningLeadTime: requireNumber(director, 'warningLeadTime', 'level.director'),
      maxAlive: requireNumber(director, 'maxAlive', 'level.director'),
      pressureCap: requireNumber(director, 'pressureCap', 'level.director'),
      jitter: requireNumber(director, 'jitter', 'level.director'),
      wave: Object.freeze({
        burstMin: requireNumber(wave, 'burstMin', 'level.director.wave'),
        burstMax: requireNumber(wave, 'burstMax', 'level.director.wave'),
        breathMin: requireNumber(wave, 'breathMin', 'level.director.wave'),
        breathMax: requireNumber(wave, 'breathMax', 'level.director.wave'),
      }),
    }),
    scriptedIntroShip: scriptedIntroShip ?? null,
  });
}
