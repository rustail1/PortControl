export interface SpawnPoint {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly directionDeg: number;
  readonly weight: number;
  readonly leadTimeOverride?: number;
  readonly tags: readonly string[];
}

export interface SpawnPointInit {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly directionDeg: number;
  readonly weight: number;
  readonly leadTimeOverride?: number;
  readonly tags?: readonly string[];
}

function requireNonEmptyString(value: string, label: string): void {
  if (value.length === 0) {
    throw new RangeError(`${label} must not be empty`);
  }
}

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite`);
  }
}

function requireNonNegativeFinite(value: number, label: string): void {
  requireFinite(value, label);
  if (value < 0) {
    throw new RangeError(`${label} must not be negative`);
  }
}

export function createSpawnPoint(init: SpawnPointInit): SpawnPoint {
  requireNonEmptyString(init.id, 'id');
  requireFinite(init.x, 'x');
  requireFinite(init.y, 'y');
  requireFinite(init.directionDeg, 'directionDeg');
  requireNonNegativeFinite(init.weight, 'weight');

  if (init.leadTimeOverride !== undefined) {
    requireNonNegativeFinite(init.leadTimeOverride, 'leadTimeOverride');
  }

  const tags = Object.freeze(
    [...(init.tags ?? [])].map((tag, index) => {
      if (typeof tag !== 'string') {
        throw new TypeError(`tags[${index}] must be a string`);
      }
      return tag;
    }),
  );

  const point: SpawnPoint = {
    id: init.id,
    x: init.x,
    y: init.y,
    directionDeg: init.directionDeg,
    weight: init.weight,
    ...(init.leadTimeOverride === undefined
      ? {}
      : { leadTimeOverride: init.leadTimeOverride }),
    tags,
  };

  return Object.freeze(point);
}
