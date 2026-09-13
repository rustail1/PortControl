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

function reverseTarget(ship, distance = 80) {
  const radians = ship.rotationDeg * Math.PI / 180;
  return {
    x: ship.position.x - Math.cos(radians) * distance,
    y: ship.position.y - Math.sin(radians) * distance,
  };
}

function angleDelta(left, right) {
  return Math.abs(((right - left + 540) % 360) - 180);
}

function assertOnRoute(ship, epsilon = 1e-7) {
  assert.notEqual(ship.route, null);
  const route = ship.route;
  const points = [route.start, ...route.points];
  let remaining = ship.routeProgress;
  let expected = points[0];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (remaining <= length || index === points.length - 1) {
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, remaining / length));
      expected = {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      };
      break;
    }
    remaining -= length;
  }
  assert.ok(
    Math.hypot(ship.position.x - expected.x, ship.position.y - expected.y) <= epsilon,
    `ship centre left canonical route: actual=${ship.position.x},${ship.position.y} expected=${expected.x},${expected.y}`,
  );
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
  assert.ok(live.routeProgress > 0 || live.rotationDeg !== ship.rotationDeg);
  assert.notEqual(runtime.presentationSnapshot().activeDraft, null);
  assertOnRoute(live);
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
  assert.ok(afterCancel.routeProgress > 0 || afterCancel.rotationDeg !== ship.rotationDeg);
  assertOnRoute(afterCancel);
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
  const effectiveEnd = live.route.points.at(-1);
  assert.ok(Math.hypot(effectiveEnd.x - second.x, effectiveEnd.y - second.y) <
    Math.hypot(effectiveEnd.x - first.x, effectiveEnd.y - first.y));
  assert.ok(live.routeProgress > 0 || live.rotationDeg !== ship.rotationDeg);
  assert.notEqual(runtime.presentationSnapshot().activeDraft, null);
  assertOnRoute(live);
});

test('COR-12 live-follow cannot run past its temporary tip and jerk backward on extension', async () => {
  const { runtime, ship } = await setupRuntime(1516);
  const first = safeTarget(ship.position, 40);
  const extension = {
    x: ship.position.x + (first.x - ship.position.x) * 3,
    y: ship.position.y + (first.y - ship.position.y) * 3,
  };
  runtime.pointerDown(pointer(ship.position));
  runtime.pointerMove(pointer(first));
  for (let frame = 0; frame < 120; frame += 1) runtime.advanceRender(1000 / 60);

  const waiting = runtime.presentationSnapshot().ships[0].ship;
  const temporaryTip = waiting.route.points.at(-1);
  assert.ok(Math.hypot(
    waiting.position.x - temporaryTip.x,
    waiting.position.y - temporaryTip.y,
  ) < 1e-6, 'active live route must hold at its temporary tip');

  runtime.pointerMove(pointer(extension));
  runtime.advanceRender(1000 / 60);
  const extended = runtime.presentationSnapshot().ships[0].ship;
  const extensionX = extension.x - temporaryTip.x;
  const extensionY = extension.y - temporaryTip.y;
  const movementX = extended.position.x - waiting.position.x;
  const movementY = extended.position.y - waiting.position.y;
  assert.ok(movementX * extensionX + movementY * extensionY >= 0);
  assertOnRoute(extended);
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

test('COR-12 reverse live route keeps canonical position while hull turns toward it', async () => {
  const { runtime } = await setupRuntime(1212);
  for (let frame = 0; frame < 120; frame += 1) runtime.advanceRender(1000 / 60);
  const ready = runtime.presentationSnapshot().ships[0].ship;
  const reverse = reverseTarget(ready);
  const redirected = safeTarget(ready.position);
  runtime.pointerDown(pointer(ready.position));
  runtime.pointerMove(pointer(reverse));
  runtime.advanceRender(1000 / 60);
  const turning = runtime.presentationSnapshot().ships[0].ship;
  assert.equal(turning.routeRecoveryHeadingDeg ?? null, null);
  assert.notEqual(turning.route, null);
  assertOnRoute(turning);
  assert.ok(
    Math.hypot(turning.position.x - ready.position.x, turning.position.y - ready.position.y) < 1e-7,
    'exact reverse should turn in place until the hull has a forward component along the canonical route',
  );
  assert.ok(angleDelta(turning.rotationDeg, ready.rotationDeg) > 0, 'hull should begin turning without a rotation snap');

  runtime.pointerMove(pointer(redirected));
  runtime.advanceRender(1000 / 60);
  const extended = runtime.presentationSnapshot().ships[0].ship;
  assert.notEqual(extended.route, null);
  assertOnRoute(extended);
  const turningEnd = turning.route.points.at(-1);
  const extendedEnd = extended.route.points.at(-1);
  assert.ok(Math.hypot(extendedEnd.x - redirected.x, extendedEnd.y - redirected.y) <
    Math.hypot(turningEnd.x - redirected.x, turningEnd.y - redirected.y));
});

test('COR-12 live-follow keeps drawn intent fixed and preserves progress through extension', async () => {
  const { runtime } = await setupRuntime(1212);
  for (let frame = 0; frame < 120; frame += 1) runtime.advanceRender(1000 / 60);
  const ready = runtime.presentationSnapshot().ships[0].ship;
  const shortReverse = reverseTarget(ready);
  runtime.pointerDown(pointer(ready.position));
  runtime.pointerMove(pointer(shortReverse));
  for (let frame = 0; frame < 30; frame += 1) runtime.advanceRender(1000 / 60);

  const progressedDraft = runtime.presentationSnapshot().activeDraft;
  assert.notEqual(progressedDraft, null);
  assert.deepEqual(progressedDraft.start, ready.position);
  assert.deepEqual(progressedDraft.points, [shortReverse]);

  const beforeExtension = runtime.presentationSnapshot().ships[0].ship;
  runtime.pointerMove(pointer({ x: 700, y: 500 }));
  runtime.advanceRender(1000 / 60);
  const extendedShip = runtime.presentationSnapshot().ships[0].ship;
  const extendedRoute = extendedShip.route;
  assert.notEqual(extendedRoute, null);
  assert.deepEqual(extendedRoute.start, ready.position);
  assert.ok(extendedShip.routeProgress >= beforeExtension.routeProgress);
  assertOnRoute(extendedShip);
});

test('COR-12 drawn preview clips its tail while future points remain anchored', async () => {
  const { runtime, ship } = await setupRuntime(1818);
  runtime.pointerDown(pointer(ship.position));
  runtime.pointerMove(pointer(safeTarget(ship.position, 240)));
  const initialSnapshot = runtime.presentationSnapshot();
  const initialPreview = initialSnapshot.routePreview;
  assert.notEqual(initialPreview, null);

  for (let frame = 0; frame < 15; frame += 1) runtime.advanceRender(1000 / 60);

  const movedSnapshot = runtime.presentationSnapshot();
  const movedPreview = movedSnapshot.routePreview;
  assert.deepEqual(movedSnapshot.activeDraft, initialSnapshot.activeDraft);
  assert.deepEqual(movedPreview.start, movedSnapshot.ships[0].ship.position);
  assert.deepEqual(movedPreview.validPoints, initialPreview.validPoints);
  assert.notDeepEqual(movedPreview.start, initialPreview.start);
});

test('COR-12 second pointer cannot rebase a canonical live draft while hull is turning', async () => {
  const { runtime, ship } = await setupRuntime(1212);
  runtime.pointerDown(pointer(ship.position));
  runtime.pointerMove(pointer(reverseTarget(ship, 80)));
  runtime.advanceRender(1000 / 60);
  const turningShip = runtime.presentationSnapshot().ships[0].ship;
  assert.equal(turningShip.routeRecoveryHeadingDeg ?? null, null);
  assertOnRoute(turningShip);
  const before = runtime.presentationSnapshot().activeDraft;

  assert.deepEqual(runtime.pointerMove(pointer({ x: 700, y: 500 }, 2)), { kind: 'ignored' });

  assert.deepEqual(runtime.presentationSnapshot().activeDraft, before);
});
