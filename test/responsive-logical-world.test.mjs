import assert from 'node:assert/strict';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

async function loadSubject() {
  try {
    const [{ getLogicalWorldSize }, { SquareWorldViewport }] =
      await Promise.all([
        import('../src/config/getLogicalWorldSize.ts'),
        import('../src/camera/SquareWorldViewport.ts'),
      ]);
    return { getLogicalWorldSize, SquareWorldViewport };
  } catch (error) {
    assert.fail(`responsive logical world is unavailable: ${String(error)}`);
  }
}

async function createSubject() {
  const { getLogicalWorldSize, SquareWorldViewport } = await loadSubject();
  const logicalWorld = getLogicalWorldSize({
    configs: readBaselineSource().configs,
    levels: {},
  });
  return {
    logicalWorld,
    viewport: new SquareWorldViewport(logicalWorld),
  };
}

test('landscape viewport centers the largest square playfield', async () => {
  const { viewport } = await createSubject();

  assert.deepEqual(viewport.layout({ width: 1600, height: 900 }), {
    x: 350,
    y: 0,
    size: 900,
    scale: 0.9,
  });
});

test('portrait viewport centers the same square playfield', async () => {
  const { viewport } = await createSubject();

  assert.deepEqual(viewport.layout({ width: 750, height: 1334 }), {
    x: 0,
    y: 292,
    size: 750,
    scale: 0.75,
  });
});

test('different resolutions preserve the complete logical playfield', async () => {
  const { logicalWorld, viewport } = await createSubject();
  const cases = [
    [{ width: 1920, height: 1080 }, { x: 420, y: 0, size: 1080 }],
    [{ width: 800, height: 800 }, { x: 0, y: 0, size: 800 }],
    [{ width: 320, height: 568 }, { x: 0, y: 124, size: 320 }],
  ];

  for (const [screen, expected] of cases) {
    const layout = viewport.layout(screen);
    assert.deepEqual(
      { x: layout.x, y: layout.y, size: layout.size },
      expected,
    );
    assert.deepEqual(
      viewport.screenToWorld({ x: layout.x, y: layout.y }, screen),
      { x: 0, y: 0 },
    );
    assert.deepEqual(
      viewport.screenToWorld(
        { x: layout.x + layout.size, y: layout.y + layout.size },
        screen,
      ),
      { x: logicalWorld.width, y: logicalWorld.height },
    );
  }
});

test('one logical point maps back to itself for every viewport', async () => {
  const { viewport } = await createSubject();
  const logicalPoint = { x: 250, y: 750 };
  const screens = [
    { width: 1920, height: 1080 },
    { width: 750, height: 1334 },
    { width: 1024, height: 1024 },
  ];

  for (const screen of screens) {
    const screenPoint = viewport.worldToScreen(logicalPoint, screen);
    assert.deepEqual(viewport.screenToWorld(screenPoint, screen), logicalPoint);
  }
});

test('resize derives new layout without mutating logical or simulation state', async () => {
  const { logicalWorld, viewport } = await createSubject();
  const worldBefore = { ...logicalWorld };
  const simulationState = { tick: 42, marker: { x: 125, y: 875 } };
  const simulationBefore = structuredClone(simulationState);

  viewport.layout({ width: 1600, height: 900 });
  viewport.layout({ width: 750, height: 1334 });

  assert.deepEqual(logicalWorld, worldBefore);
  assert.deepEqual(simulationState, simulationBefore);
});

test('screen to world to screen round-trip is stable inside the playfield', async () => {
  const { viewport } = await createSubject();
  const screen = { width: 1366, height: 768 };
  const screenPoints = [
    { x: 299, y: 0 },
    { x: 683, y: 384 },
    { x: 1067, y: 768 },
  ];

  for (const screenPoint of screenPoints) {
    const worldPoint = viewport.screenToWorld(screenPoint, screen);
    assert.notEqual(worldPoint, null);
    assert.deepEqual(viewport.worldToScreen(worldPoint, screen), screenPoint);
  }
});

test('screen points in decorative margins are outside the playfield', async () => {
  const { viewport } = await createSubject();

  assert.equal(
    viewport.screenToWorld({ x: 100, y: 450 }, { width: 1600, height: 900 }),
    null,
  );
});
