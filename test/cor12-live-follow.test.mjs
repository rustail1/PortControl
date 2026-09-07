import assert from 'node:assert/strict';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

async function setupRuntime(seed = 1212, levelId = 'calm_01') {
  const [{ HarborRuntime }, config] = await Promise.all([
    import('../src/runtime/HarborRuntime.ts'),
    import('../src/config/validateConfigSource.ts'),
  ]);
  const bundle = config.validateConfigSource(readBaselineSource());
  const runtime = new HarborRuntime({ bundle, levelId, attemptSeed: seed });
  for (let frame = 0; frame < 1800; frame += 1) {
    runtime.advanceRender(1000 / 60);
    const ship = runtime.presentationSnapshot().ships[0]?.ship;
    if (ship !== undefined) return { runtime, ship };
  }
  throw new Error('ship did not materialize');
}

function pointer(position, pointerId = 1) {
  return {
    source: 'mouse',
    pointerId,
    screenPosition: position,
    cssPosition: position,
    internalViewport: { width: 1000, height: 1000 },
    worldToCssPixelScale: 1,
  };
}

function safeTarget(position, distance = 140) {
  return {
    x: position.x < 500 ? position.x + distance : position.x - distance,
    y: position.y < 500 ? position.y + distance : position.y - distance,
  };
}

test('COR-12 live-follow starts following an activated draft before pointer release', async () => {
  const { runtime, ship } = await setupRuntime();
  const target = safeTarget(ship.position);
  runtime.pointerDown(pointer(ship.position));
  runtime.pointerMove(pointer(target));

  assert.equal(runtime.presentationSnapshot().ships[0].ship.route, null);
  assert.notEqual(runtime.presentationSnapshot().activeDraft, null);
  runtime.advanceRender(1000 / 60);

  const live = runtime.presentationSnapshot().ships[0].ship;
  assert.notEqual(live.route, null);
  assert.equal(live.state, 'Navigating');
  assert.ok(live.routeProgress > 0);
  assert.notDeepEqual(live.position, ship.position);
  assert.notEqual(runtime.presentationSnapshot().activeDraft, null);
});

test('COR-12 activated cancel seals the live route without rolling movement back', async () => {
  const { runtime, ship } = await setupRuntime(1313);
  const target = safeTarget(ship.position);
  runtime.pointerDown(pointer(ship.position));
  runtime.pointerMove(pointer(target));
  runtime.advanceRender(1000 / 60);
  const beforeCancel = runtime.presentationSnapshot().ships[0].ship;

  const outcome = runtime.cancelActiveDraft();

  assert.equal(outcome.kind, 'finished');
  assert.equal(runtime.presentationSnapshot().activeDraft, null);
  runtime.advanceRender(1000 / 60);
  const afterCancel = runtime.presentationSnapshot().ships[0].ship;
  assert.notEqual(afterCancel.route, null);
  assert.ok(afterCancel.routeProgress >= beforeCancel.routeProgress);
  assert.notDeepEqual(afterCancel.position, ship.position);
});

test('COR-12 sub-threshold cancel remains a non-routing cancellation', async () => {
  const { runtime, ship } = await setupRuntime(1414);
  runtime.pointerDown(pointer(ship.position));
  runtime.pointerMove(pointer({ x: ship.position.x + 5, y: ship.position.y }));

  assert.deepEqual(runtime.cancelActiveDraft(), { kind: 'cancelled' });
  runtime.advanceRender(1000 / 60);
  assert.equal(runtime.presentationSnapshot().ships[0].ship.route, null);
});

test('COR-12 live-follow extends the future tail while the pointer remains down', async () => {
  const { runtime, ship } = await setupRuntime(1515);
  const first = safeTarget(ship.position);
  const second = {
    x: ship.position.x + (first.x - ship.position.x) * 1.5,
    y: ship.position.y + (first.y - ship.position.y) * 1.5,
  };
  runtime.pointerDown(pointer(ship.position));
  runtime.pointerMove(pointer(first));
  runtime.advanceRender(1000 / 60);
  runtime.pointerMove(pointer(second));
  runtime.advanceRender(1000 / 60);

  const live = runtime.presentationSnapshot().ships[0].ship;
  assert.deepEqual(live.route.points.at(-1), second);
  assert.ok(live.routeProgress > 0);
  assert.notEqual(runtime.presentationSnapshot().activeDraft, null);
});

test('COR-12 live-follow ignores a second pointer without rebasing the active route', async () => {
  const { runtime, ship } = await setupRuntime(1616);
  const target = safeTarget(ship.position);
  runtime.pointerDown(pointer(ship.position));
  runtime.pointerMove(pointer(target));
  runtime.advanceRender(1000 / 60);
  const routeBefore = runtime.presentationSnapshot().ships[0].ship.route;

  assert.deepEqual(runtime.pointerMove(pointer({ x: 900, y: 900 }, 2)), { kind: 'ignored' });
  runtime.advanceRender(1000 / 60);

  assert.deepEqual(runtime.presentationSnapshot().ships[0].ship.route, routeBefore);
});

test('COR-12 pointer cancel seals an activated live route', async () => {
  const { runtime, ship } = await setupRuntime(1717);
  const target = safeTarget(ship.position);
  runtime.pointerDown(pointer(ship.position));
  runtime.pointerMove(pointer(target));
  runtime.advanceRender(1000 / 60);

  assert.equal(runtime.pointerCancel(pointer(target)).kind, 'finished');
  runtime.advanceRender(1000 / 60);

  assert.equal(runtime.presentationSnapshot().activeDraft, null);
  assert.notEqual(runtime.presentationSnapshot().ships[0].ship.route, null);
});

test('COR-12 live-follow is equivalent at 30 60 and 120 render FPS', async () => {
  const run = async (fps) => {
    const { runtime, ship } = await setupRuntime(1818);
    runtime.pointerDown(pointer(ship.position));
    runtime.pointerMove(pointer(safeTarget(ship.position, 240)));
    for (let frame = 0; frame < fps; frame += 1) {
      runtime.advanceRender(1000 / fps);
    }
    const current = runtime.presentationSnapshot().ships[0].ship;
    return {
      position: current.position,
      rotationDeg: current.rotationDeg,
      state: current.state,
      route: current.route,
      routeCursor: current.routeCursor,
      routeProgress: current.routeProgress,
    };
  };

  assert.deepEqual(await run(30), await run(60));
  assert.deepEqual(await run(60), await run(120));
});

test('COR-12 live-follow never applies a fully invalid land-crossing suffix', async () => {
  const { runtime, ship } = await setupRuntime(42, 'calm_07');
  runtime.pointerDown(pointer(ship.position));
  runtime.pointerMove(pointer({ x: 500, y: 500 }));
  assert.equal(runtime.presentationSnapshot().routePreview.rejectedPoints.length, 1);

  runtime.advanceRender(1000 / 60);

  assert.equal(runtime.presentationSnapshot().ships[0].ship.route, null);
  assert.equal(runtime.lastRouteCommitResult.kind, 'rejected_invalid');
});

test('COR-12 live reverse route starts a forward U-turn and accepts future extension', async () => {
  const { runtime, ship } = await setupRuntime(1212);
  assert.ok(ship.position.x > 950);
  const outward = { x: 990, y: ship.position.y };
  const redirected = { x: 700, y: 500 };
  runtime.pointerDown(pointer(ship.position));
  runtime.pointerMove(pointer(outward));
  runtime.advanceRender(1000 / 60);
  const turning = runtime.presentationSnapshot().ships[0].ship;
  assert.equal(turning.routeRecoveryHeadingDeg ?? null, null);
  assert.notEqual(turning.route, null);
  assert.ok(turning.position.x < ship.position.x);

  runtime.pointerMove(pointer(redirected));
  runtime.advanceRender(1000 / 60);
  const extended = runtime.presentationSnapshot().ships[0].ship;
  assert.notEqual(extended.route, null);
  assert.deepEqual(extended.route.points.at(-1), redirected);
});

test('COR-12 second pointer cannot rebase a live draft during recovery', async () => {
  const { runtime, ship } = await setupRuntime(1212);
  runtime.pointerDown(pointer(ship.position));
  runtime.pointerMove(pointer({ x: 990, y: ship.position.y }));
  runtime.advanceRender(1000 / 60);
  assert.notEqual(runtime.presentationSnapshot().ships[0].ship.routeRecoveryHeadingDeg, null);
  const before = runtime.presentationSnapshot().activeDraft;

  assert.deepEqual(runtime.pointerMove(pointer({ x: 700, y: 500 }, 2)), { kind: 'ignored' });

  assert.deepEqual(runtime.presentationSnapshot().activeDraft, before);
});
