import type { ConfigBundle } from '../config/types.ts';
import {
  createSpawnPoint,
  type SpawnPoint,
} from './SpawnPoint.ts';

interface LevelSpawnPointBlock {
  readonly blockType: 'spawn_point';
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly enabled: boolean;
  readonly props: {
    readonly directionDeg: number;
    readonly weight: number;
    readonly leadTimeOverride?: number;
    readonly tags?: readonly string[];
  };
}

interface LevelLayout {
  readonly blocks?: readonly unknown[];
}

interface LevelDirector {
  readonly warningLeadTime?: unknown;
}

function isSpawnPointBlock(value: unknown): value is LevelSpawnPointBlock {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { readonly blockType?: unknown }).blockType === 'spawn_point'
  );
}

function requireDirectorWarningLeadTime(level: Record<string, unknown>): number {
  const director = level['director'] as LevelDirector | undefined;
  const warningLeadTime = director?.warningLeadTime;

  if (
    typeof warningLeadTime !== 'number' ||
    !Number.isFinite(warningLeadTime) ||
    warningLeadTime < 0
  ) {
    throw new RangeError(
      'level.director.warningLeadTime must be a non-negative finite number',
    );
  }

  return warningLeadTime;
}

export function createSpawnPointsFromLevel(
  level: Record<string, unknown>,
): readonly SpawnPoint[] {
  const layout = level['layout'] as LevelLayout | undefined;
  const blocks = Array.isArray(layout?.blocks) ? layout.blocks : [];

  const spawnPoints = blocks
    .filter(isSpawnPointBlock)
    .filter((block) => block.enabled === true)
    .map((block) =>
      createSpawnPoint({
        id: block.id,
        x: block.x,
        y: block.y,
        directionDeg: block.props.directionDeg,
        weight: block.props.weight,
        leadTimeOverride: block.props.leadTimeOverride,
        tags: block.props.tags,
      }),
    );

  return Object.freeze(spawnPoints);
}

export function createSpawnPointsForValidatedLevel(
  bundle: ConfigBundle,
  levelId: string,
): readonly SpawnPoint[] {
  const level = bundle.levels[levelId];
  if (level === undefined) {
    throw new RangeError(`Unknown level: ${levelId}`);
  }
  return createSpawnPointsFromLevel(level);
}

export function getEffectiveSpawnLeadTime(
  spawnPoint: SpawnPoint,
  level: Record<string, unknown>,
): number {
  const warningLeadTime = requireDirectorWarningLeadTime(level);
  return spawnPoint.leadTimeOverride ?? warningLeadTime;
}
