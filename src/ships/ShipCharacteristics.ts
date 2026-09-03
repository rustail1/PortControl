import type { ConfigBundle } from '../config/types.ts';

export interface ShipCharacteristics {
  readonly type: string;
  readonly speed: number;
  readonly turnRateDeg: number;
  readonly collisionRadius: number;
  readonly unloadStepMs: number;
}

interface ShipsDocument {
  readonly ships: Readonly<Record<string, ShipCharacteristicsSource>>;
}

interface ShipCharacteristicsSource {
  readonly speed: number;
  readonly turnRateDeg: number;
  readonly collisionRadius: number;
  readonly unloadStepMs: number;
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

export function createShipCharacteristicsRegistry(
  bundle: ConfigBundle,
): ShipCharacteristicsRegistry {
  const shipsDocument = bundle.configs['ships.json'] as unknown as ShipsDocument;
  const byType = new Map<string, ShipCharacteristics>();

  for (const [type, source] of Object.entries(shipsDocument.ships)) {
    byType.set(
      type,
      Object.freeze({
        type,
        speed: source.speed,
        turnRateDeg: source.turnRateDeg,
        collisionRadius: source.collisionRadius,
        unloadStepMs: source.unloadStepMs,
      }),
    );
  }

  return new ShipCharacteristicsRegistry(byType);
}
