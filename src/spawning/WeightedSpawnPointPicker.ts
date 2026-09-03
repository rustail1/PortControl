import type { IRng } from '../core/SeededRng.ts';
import type { SpawnPoint } from './SpawnPoint.ts';

function requireValidWeight(weight: number, spawnPointId: string): void {
  if (!Number.isFinite(weight) || weight < 0) {
    throw new RangeError(
      `SpawnPoint ${spawnPointId} weight must be a non-negative finite number`,
    );
  }
}

export function pickWeightedSpawnPoint(
  spawnPoints: readonly SpawnPoint[],
  rng: IRng,
): SpawnPoint | null {
  let totalWeight = 0;

  for (const spawnPoint of spawnPoints) {
    requireValidWeight(spawnPoint.weight, spawnPoint.id);
    if (spawnPoint.weight > 0) {
      totalWeight += spawnPoint.weight;
      if (!Number.isFinite(totalWeight)) {
        throw new RangeError('SpawnPoint total weight must be finite');
      }
    }
  }

  if (totalWeight === 0) {
    return null;
  }

  const sample = rng.next();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new RangeError('IRng.next() must return a finite value in [0, 1)');
  }

  const target = sample * totalWeight;
  let cumulativeWeight = 0;

  for (const spawnPoint of spawnPoints) {
    if (spawnPoint.weight <= 0) {
      continue;
    }

    cumulativeWeight += spawnPoint.weight;
    if (target < cumulativeWeight) {
      return spawnPoint;
    }
  }

  throw new Error('Weighted SpawnPoint selection failed');
}
