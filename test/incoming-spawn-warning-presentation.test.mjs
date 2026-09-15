import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

async function loadPresentation() {
  try {
    return await import('../src/presentation/IncomingSpawnWarningPresentation.ts');
  } catch (error) {
    assert.fail(`incoming spawn warning presentation is unavailable: ${String(error)}`);
  }
}

function source(overrides = {}) {
  return {
    transactionId: 'tx-a',
    spawnPointId: 'spawn-a',
    spawnPosition: { x: 25, y: 500 },
    leadTimeSeconds: 2,
    elapsedSeconds: 0,
    ...overrides,
  };
}

const world = Object.freeze({ width: 1000, height: 1000 });

async function createWarning(overrides = {}) {
  const { createIncomingSpawnWarningPresentation } = await loadPresentation();
  return createIncomingSpawnWarningPresentation({
    source: source(overrides),
    world,
  });
}

test('warning is absent before the final presentation-only warning window', async () => {
  assert.equal(await createWarning({ leadTimeSeconds: 2, elapsedSeconds: 0.5 }), null);
});

test('warning appears when remaining time enters the warning window', async () => {
  const warning = await createWarning({ leadTimeSeconds: 2, elapsedSeconds: 0.75 });
  assert.notEqual(warning, null);
  assert.equal(warning.remainingSeconds, 1.25);
});

test('warning animation produces two soft pulse peaks before spawn', async () => {
  const samples = [];
  for (const elapsedSeconds of [0, 0.3125, 0.625, 0.9375, 1.249]) {
    const warning = await createWarning({ leadTimeSeconds: 1.25, elapsedSeconds });
    assert.notEqual(warning, null);
    samples.push(warning);
  }

  assert.ok(samples[1].alpha > samples[0].alpha);
  assert.ok(samples[1].alpha > samples[2].alpha);
  assert.ok(samples[3].alpha > samples[2].alpha);
  assert.ok(samples[3].alpha > samples[4].alpha);
  assert.ok(samples[1].scale > samples[0].scale);
  assert.ok(samples[3].scale > samples[2].scale);
  assert.ok(samples.every((sample) => sample.alpha > 0 && sample.alpha <= 1));
  assert.ok(samples.every((sample) => sample.scale >= 0.9 && sample.scale <= 1.1));
});

test('warning disappears at the actual spawn boundary', async () => {
  assert.equal(await createWarning({ leadTimeSeconds: 0.9, elapsedSeconds: 0.9 }), null);
  assert.equal(await createWarning({ leadTimeSeconds: 0.9, elapsedSeconds: 1.0 }), null);
});

test('edge mapping points arrows inward and preserves only the along-edge entry anchor', async () => {
  const cases = [
    [{ x: 25, y: 200 }, 'left', 0, 0.2],
    [{ x: 975, y: 800 }, 'right', 180, 0.8],
    [{ x: 300, y: 25 }, 'top', 90, 0.3],
    [{ x: 700, y: 975 }, 'bottom', 270, 0.7],
  ];

  for (const [spawnPosition, side, arrowRotationDeg, edgeAnchorRatio] of cases) {
    const warning = await createWarning({
      leadTimeSeconds: 0.9,
      elapsedSeconds: 0.2,
      spawnPosition,
    });
    assert.notEqual(warning, null);
    assert.equal(warning.side, side);
    assert.equal(warning.arrowRotationDeg, arrowRotationDeg);
    assert.equal(warning.edgeAnchorRatio, edgeAnchorRatio);
    assert.equal('shipType' in warning, false);
    assert.equal('spawnPosition' in warning, false);
    assert.equal('path' in warning, false);
  }
});

test('warnings appear at their future entry locations and only deconflict when needed', async () => {
  const { createIncomingSpawnWarningPresentation, layoutIncomingSpawnWarnings } = await loadPresentation();
  const entryYs = [200, 500, 800];
  const warnings = ['tx-a', 'tx-b', 'tx-c'].map((transactionId, index) => {
    const warning = createIncomingSpawnWarningPresentation({
      source: source({
        transactionId,
        spawnPointId: `spawn-${index}`,
        spawnPosition: { x: 25, y: entryYs[index] },
        leadTimeSeconds: 0.9,
        elapsedSeconds: 0.2,
      }),
      world,
    });
    assert.notEqual(warning, null);
    return warning;
  });

  const laidOut = layoutIncomingSpawnWarnings(warnings, world, 1);
  assert.equal(laidOut.length, 3);
  assert.deepEqual(laidOut.map((warning) => warning.position.y), entryYs);
  assert.ok(laidOut.every((warning) => warning.side === 'left'));
  assert.ok(laidOut.every((warning) => warning.position.x > 0 && warning.position.x < 100));

  const crowded = ['tx-d', 'tx-e', 'tx-f'].map((transactionId, index) => {
    const warning = createIncomingSpawnWarningPresentation({
      source: source({
        transactionId,
        spawnPointId: `crowded-${index}`,
        spawnPosition: { x: 25, y: 490 + index * 5 },
        leadTimeSeconds: 0.9,
        elapsedSeconds: 0.2,
      }),
      world,
    });
    assert.notEqual(warning, null);
    return warning;
  });
  const crowdedLayout = layoutIncomingSpawnWarnings(crowded, world, 1);
  const crowdedYs = crowdedLayout.map((warning) => warning.position.y).sort((a, b) => a - b);
  assert.ok(crowdedYs[1] - crowdedYs[0] >= 34);
  assert.ok(crowdedYs[2] - crowdedYs[1] >= 34);
  assert.ok(crowdedYs.every((y) => y >= 30 && y <= 970));
});

async function createRuntime(seed = 41017) {
  const { HarborRuntime } = await import('../src/runtime/HarborRuntime.ts');
  const source = readBaselineSource();
  const levels = {};
  const configs = {};
  for (const [path, document] of Object.entries(source.configs)) {
    if (/^levels\/[^/]+\.json$/.test(path)) levels[document.id] = document;
    else configs[path] = document;
  }
  const bundle = { configs, levels };
  return new HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: seed });
}

function advanceUntil(runtime, predicate, maxFrames = 1200) {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    const snapshot = runtime.presentationSnapshot();
    if (predicate(snapshot)) return { snapshot, frames: frame };
    runtime.advanceRender(1000 / 60);
  }
  throw new Error('advanceUntil timed out');
}

test('runtime warning snapshot is read-only and does not change director schedule or RNG', async () => {
  const runtime = await createRuntime();
  const reached = advanceUntil(runtime, (snapshot) => snapshot.incoming?.length > 0);
  assert.ok(reached.snapshot.incoming.length > 0);

  const before = structuredClone(runtime.authoritativeSnapshot());
  const presentation = runtime.presentationSnapshot();
  assert.ok(Array.isArray(presentation.incomingWarnings));
  assert.ok(presentation.incomingWarnings.length > 0);
  const after = structuredClone(runtime.authoritativeSnapshot());

  assert.deepEqual(after.director, before.director);
  assert.deepEqual(after.rngState, before.rngState);
  assert.deepEqual(after.session, before.session);
  assert.equal(after.pendingIncoming, before.pendingIncoming);
});

test('runtime warning disappears when the scheduled vessel materializes', async () => {
  const runtime = await createRuntime(41018);
  const beforeSpawn = advanceUntil(runtime, (snapshot) => snapshot.incomingWarnings?.length > 0).snapshot;
  assert.ok(beforeSpawn.incomingWarnings.length > 0);

  const materialized = advanceUntil(runtime, (snapshot) => snapshot.ships.length > 0).snapshot;
  assert.equal(materialized.incomingWarnings.length, 0);
});

test('snapshot restore with an active warning reproduces the same simulation outcome', async () => {
  const runtime = await createRuntime(41019);
  advanceUntil(runtime, (snapshot) => snapshot.incomingWarnings?.length > 0);
  const checkpoint = runtime.captureSimulationSnapshot();

  let framesToSpawn = 0;
  while (runtime.presentationSnapshot().ships.length === 0 && framesToSpawn < 240) {
    runtime.advanceRender(1000 / 60);
    framesToSpawn += 1;
  }
  assert.ok(runtime.presentationSnapshot().ships.length > 0);
  const firstOutcome = structuredClone(runtime.authoritativeSnapshot());

  runtime.restoreSimulationSnapshot(checkpoint);
  for (let frame = 0; frame < framesToSpawn; frame += 1) {
    runtime.advanceRender(1000 / 60);
  }
  const restoredOutcome = structuredClone(runtime.authoritativeSnapshot());

  assert.deepEqual(restoredOutcome, firstOutcome);
});

test('HarborScene renders warning triangles from presentation snapshots, not simulation timers', () => {
  const sourceText = readFileSync(new URL('../src/scenes/HarborScene.ts', import.meta.url), 'utf8');
  assert.match(sourceText, /incomingWarnings/);
  assert.match(sourceText, /layoutIncomingSpawnWarnings/);
  assert.match(sourceText, /fillTriangle/);
  assert.doesNotMatch(sourceText, /setTimeout\([^)]*incoming|setInterval\([^)]*incoming/i);
});
