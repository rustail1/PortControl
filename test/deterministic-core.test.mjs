import assert from 'node:assert/strict';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

async function loadClock() {
  try {
    return await import('../src/core/FixedStepClock.ts');
  } catch (error) {
    assert.fail(`FixedStepClock is unavailable: ${String(error)}`);
  }
}

async function loadRng() {
  try {
    return await import('../src/core/SeededRng.ts');
  } catch (error) {
    assert.fail(`SeededRng is unavailable: ${String(error)}`);
  }
}

function simulationClockConfig() {
  const balance = readBaselineSource().configs['balance.json'];
  return {
    fixedHz: balance.simulation.fixedHz,
    maxCatchUpSteps: balance.simulation.maxCatchUpSteps,
  };
}

test('fixed steps produce the same outcome for equivalent render-delta partitions', async () => {
  const { FixedStepClock } = await loadClock();
  const config = simulationClockConfig();
  const run = (renderDeltas) => {
    const clock = new FixedStepClock(config);
    let outcome = 0;
    let stepDelta = 0;

    for (const renderDelta of renderDeltas) {
      clock.advance(renderDelta, (deltaSeconds) => {
        outcome = (outcome * 31 + 7) >>> 0;
        stepDelta = deltaSeconds;
      });
    }

    return {
      outcome,
      elapsedSeconds: clock.elapsedSeconds,
      interpolationAlpha: clock.interpolationAlpha,
      stepDelta,
    };
  };

  const oneFrame = run([100]);
  const splitFrames = run([10, 15, 25, 50]);
  const highFpsFrames = run(Array.from({ length: 12 }, () => 1000 / 120));

  assert.deepEqual(splitFrames, oneFrame);
  assert.deepEqual(highFpsFrames, oneFrame);
  assert.equal(oneFrame.elapsedSeconds, config.maxCatchUpSteps / config.fixedHz);
  assert.equal(oneFrame.stepDelta, 1 / config.fixedHz);
});

test('fixed clock caps a stalled render frame at the configured catch-up budget', async () => {
  const { FixedStepClock } = await loadClock();
  const config = simulationClockConfig();
  const clock = new FixedStepClock(config);
  let executedSteps = 0;

  const result = clock.advance(1000, () => {
    executedSteps += 1;
  });

  assert.equal(result.steps, config.maxCatchUpSteps);
  assert.equal(executedSteps, config.maxCatchUpSteps);
  assert.ok(result.interpolationAlpha >= 0 && result.interpolationAlpha < 1);
});

test('equal seeds produce equal RNG-derived sequences', async () => {
  const { SeededRng } = await loadRng();
  const first = new SeededRng(123456789);
  const second = new SeededRng(123456789);

  const firstSequence = Array.from({ length: 16 }, () => first.next());
  const secondSequence = Array.from({ length: 16 }, () => second.next());

  assert.deepEqual(secondSequence, firstSequence);
  assert.ok(firstSequence.every((value) => value >= 0 && value < 1));
  assert.ok(new Set(firstSequence).size > 1);
});

test('different seeds produce different sequences', async () => {
  const { SeededRng } = await loadRng();
  const first = new SeededRng(1);
  const second = new SeededRng(2);

  assert.notDeepEqual(
    Array.from({ length: 8 }, () => first.next()),
    Array.from({ length: 8 }, () => second.next()),
  );
});

test('restoring RNG state reproduces the future sequence exactly', async () => {
  const { SeededRng } = await loadRng();
  const rng = new SeededRng(987654321);
  rng.next();
  rng.next();
  const state = rng.getState();
  const expectedFuture = Array.from({ length: 8 }, () => rng.next());

  rng.setState(state);

  assert.deepEqual(
    Array.from({ length: 8 }, () => rng.next()),
    expectedFuture,
  );
});

test('range is deterministic and remains inside its half-open bounds', async () => {
  const { SeededRng } = await loadRng();
  const first = new SeededRng(42);
  const second = new SeededRng(42);
  const values = Array.from({ length: 16 }, () => first.range(-5, 12));

  assert.deepEqual(
    Array.from({ length: 16 }, () => second.range(-5, 12)),
    values,
  );
  assert.ok(values.every((value) => value >= -5 && value < 12));
});
