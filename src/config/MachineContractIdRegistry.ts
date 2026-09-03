import type { ConfigBundle } from './types.ts';

function readIdSet(bundle: ConfigBundle, configName: string, field: string): Set<string> {
  const config = bundle.configs[configName];
  const values = config?.[field];
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    throw new TypeError(`Validated ${configName} must define ${field}`);
  }
  return new Set(Object.keys(values));
}

/**
 * Read-only lookup boundary for IDs owned by frozen JSON contracts.
 * Future analytics/audio consumers validate requests here instead of owning
 * duplicate identifier lists.
 */
export class MachineContractIdRegistry {
  readonly #analyticsEventIds: ReadonlySet<string>;
  readonly #audioAssetIds: ReadonlySet<string>;

  public constructor(bundle: ConfigBundle) {
    this.#analyticsEventIds = readIdSet(
      bundle,
      'analytics_events.json',
      'events',
    );
    this.#audioAssetIds = readIdSet(bundle, 'audio.json', 'assets');
  }

  public assertAnalyticsEventId(eventId: string): void {
    if (!this.#analyticsEventIds.has(eventId)) {
      throw new RangeError(`Unknown analytics event ID: ${eventId}`);
    }
  }

  public assertAudioAssetId(audioAssetId: string): void {
    if (!this.#audioAssetIds.has(audioAssetId)) {
      throw new RangeError(`Unknown audio asset ID: ${audioAssetId}`);
    }
  }
}

export function createMachineContractIdRegistry(
  bundle: ConfigBundle,
): MachineContractIdRegistry {
  return new MachineContractIdRegistry(bundle);
}
