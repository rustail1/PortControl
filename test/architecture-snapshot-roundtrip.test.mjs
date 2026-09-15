import assert from 'node:assert/strict';
import test from 'node:test';

async function loadSnapshotService() {
  try {
    return await import('../src/rewind/SimulationSnapshotService.ts');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw error;
  }
}

test('AR-05 snapshot service exists and rejects dirty fixed-step boundaries', async () => {
  const module = await loadSnapshotService();
  assert.ok(module, 'SimulationSnapshotService must exist');
  const service = new module.SimulationSnapshotService();
  const snapshot = { marker: 'authoritative' };

  assert.throws(
    () => service.capture(snapshot, { queuedCommands: 1, hasLiveDraft: false, pendingEvents: 0 }),
    /clean end-of-fixed-step boundary/,
  );
  assert.throws(
    () => service.capture(snapshot, { queuedCommands: 0, hasLiveDraft: true, pendingEvents: 0 }),
    /clean end-of-fixed-step boundary/,
  );
  assert.throws(
    () => service.capture(snapshot, { queuedCommands: 0, hasLiveDraft: false, pendingEvents: 1 }),
    /clean end-of-fixed-step boundary/,
  );
});

test('AR-05 snapshot capture clones authoritative state instead of aliasing it', async () => {
  const module = await loadSnapshotService();
  assert.ok(module, 'SimulationSnapshotService must exist');
  const service = new module.SimulationSnapshotService();
  const source = { nested: { value: 7 } };
  const captured = service.capture(source, { queuedCommands: 0, hasLiveDraft: false, pendingEvents: 0 });
  source.nested.value = 99;
  assert.equal(captured.nested.value, 7);
});

test('AR-05 incoming spawn transaction resumes deterministically after restore', async () => {
  const { IncomingSpawnSystem } = await import('../src/spawning/IncomingSpawnSystem.ts');
  const request = {
    transactionId: 'tx-1',
    spawnPoint: { id: 'spawn-a', x: 10, y: 20, directionDeg: 90 },
    payload: { shipId: 'ship-1', shipType: 'speedboat', cargo: { general: 1 }, spawnSequence: 3 },
    leadTimeSeconds: 2,
  };
  const system = new IncomingSpawnSystem();
  assert.equal(system.schedule(request).ok, true);
  system.consumeIndicatorCommands();
  system.step(0.75);
  const snapshot = system.toSnapshot();

  system.step(1.25);
  const futureA = system.peekReadySpawns();

  const restored = new IncomingSpawnSystem();
  restored.restore(snapshot);
  restored.step(1.25);
  const futureB = restored.peekReadySpawns();

  assert.deepEqual(futureB, futureA);
  assert.equal(restored.getSpawnPointOwner('spawn-a'), 'tx-1');
});

test('AR-05 fixed-step clock snapshot preserves fractional render accumulator', async () => {
  const { FixedStepClock } = await import('../src/core/FixedStepClock.ts');
  const original = new FixedStepClock({ fixedHz: 60, maxCatchUpSteps: 6 });
  original.advance(25, () => {}); // 1.5 simulation steps => one completed, alpha 0.5.
  assert.equal(original.elapsedSeconds, 1 / 60);
  assert.ok(Math.abs(original.interpolationAlpha - 0.5) < 1e-9);

  const snapshot = original.toSnapshot();
  const restored = new FixedStepClock({ fixedHz: 60, maxCatchUpSteps: 6 });
  restored.restore(snapshot);

  assert.equal(restored.elapsedSeconds, original.elapsedSeconds);
  assert.ok(Math.abs(restored.interpolationAlpha - original.interpolationAlpha) < 1e-9);

  let originalSteps = 0;
  let restoredSteps = 0;
  original.advance(1000 / 120, () => { originalSteps += 1; });
  restored.advance(1000 / 120, () => { restoredSteps += 1; });
  assert.equal(restoredSteps, originalSteps);
  assert.equal(restored.elapsedSeconds, original.elapsedSeconds);
  assert.ok(Math.abs(restored.interpolationAlpha - original.interpolationAlpha) < 1e-9);
});
