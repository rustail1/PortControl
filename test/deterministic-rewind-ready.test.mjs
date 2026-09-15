import assert from 'node:assert/strict';
import test from 'node:test';

import { HarborRuntime } from '../src/runtime/HarborRuntime.ts';
import { validateConfigSource } from '../src/config/validateConfigSource.ts';
import { readBaselineSource } from './support/readBaselineSource.mjs';

const FRAME_MS = 1000 / 60;

function advance(runtime, frames) {
  for (let index = 0; index < frames; index += 1) runtime.advanceRender(FRAME_MS);
}

test('AR-05 full simulation snapshot restore reproduces the same deterministic future', () => {
  const bundle = validateConfigSource(readBaselineSource());
  const runtime = new HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 0x5a17 });

  advance(runtime, 180);
  const checkpoint = runtime.captureSimulationSnapshot();

  advance(runtime, 240);
  const futureA = runtime.captureSimulationSnapshot();

  runtime.restoreSimulationSnapshot(checkpoint);
  advance(runtime, 240);
  const futureB = runtime.captureSimulationSnapshot();

  assert.deepEqual(futureB, futureA);
});
