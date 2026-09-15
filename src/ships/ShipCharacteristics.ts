import type { ConfigBundle } from '../config/types.ts';

export interface ShipCharacteristics {
  readonly type: string;
  readonly speed: number;
  readonly turnRateDeg: number;
  readonly collisionRadius: number;
  readonly unloadStepMs: number;
  readonly warningRadius: number;
  readonly cargoCapacity: number;
  readonly pressureWeight: number;
  readonly spawnWeight: number;
  readonly defaultCargoTypes: readonly string[];
}

export class ShipCharacteristicsRegistry {
  readonly #byType: ReadonlyMap<string, ShipCharacteristics>;

  public constructor(byType: ReadonlyMap<string, ShipCharacteristics>) {
    this.#byType = byType;
  }

  public require(type: string): ShipCharacteristics {
    const characteristics = this.#byType.get(type);
    if (characteristics === undefined) {
      throw new RangeError(`Unknown ship type: ${type}`);
    }
    return characteristics;
  }
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

export function createShipCharacteristicsRegistry(
  bundle: ConfigBundle,
): ShipCharacteristicsRegistry {
  const shipsDocument = bundle.configs['ships.json'];
  if (shipsDocument === undefined) throw new RangeError('ships.json is required');
  const ships = requireRecord(shipsDocument['ships'], 'ships.ships');
  const byType = new Map<string, ShipCharacteristics>();

  for (const [type, rawSource] of Object.entries(ships)) {
    const source = requireRecord(rawSource, `ships.ships.${type}`);
    byType.set(
      type,
      Object.freeze({
        type,
        speed: requireNumber(source, 'speed', `ships.ships.${type}`),
        turnRateDeg: requireNumber(source, 'turnRateDeg', `ships.ships.${type}`),
        collisionRadius: requireNumber(source, 'collisionRadius', `ships.ships.${type}`),
        unloadStepMs: requireNumber(source, 'unloadStepMs', `ships.ships.${type}`),
        warningRadius: requireNumber(source, 'warningRadius', `ships.ships.${type}`),
        cargoCapacity: requireNumber(source, 'cargoCapacity', `ships.ships.${type}`),
        pressureWeight: requireNumber(source, 'pressureWeight', `ships.ships.${type}`),
        spawnWeight: requireNumber(source, 'spawnWeight', `ships.ships.${type}`),
        defaultCargoTypes: requireStringArray(source['defaultCargoTypes'], `ships.ships.${type}.defaultCargoTypes`),
      }),
    );
  }

  return new ShipCharacteristicsRegistry(byType);
}
