import assert from 'node:assert/strict';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

async function loadSubject() {
  try {
    const [routes, ships, camera, config] = await Promise.all([
      import('../src/routes/index.ts'),
      import('../src/ships/index.ts'),
      import('../src/camera/SquareWorldViewport.ts'),
      import('../src/config/validateConfigSource.ts'),
    ]);
    return { ...routes, ...ships, ...camera, ...config };
  } catch (error) {
    assert.fail(`COR-02 route input is unavailable: ${String(error)}`);
  }
}

async function createShip(state) {
  const subject = await loadSubject();
  const bundle = subject.validateConfigSource(readBaselineSource());
  const ships = subject.createShipCharacteristicsRegistry(bundle);
  return {
    subject,
    ship: new subject.ShipModel({
      id: 'ship-input',
      characteristics: ships.require('speedboat'),
      position: { x: 100, y: 100 },
      rotationDeg: 0,
      state,
    }),
    bundle,
  };
}

async function createController(state, sampling) {
  const { subject, ship, bundle } = await createShip(state);
  const viewport = new subject.SquareWorldViewport({ width: 1000, height: 1000 });
  return {
    subject,
    ship,
    controller: new subject.RouteInputController({
      viewport,
      sampling: sampling ?? subject.createRouteSamplingConfig(bundle),
      hitTest: (point) => (point.x <= 150 && point.y <= 150 ? ship : null),
    }),
  };
}

function pointer(source, pointerId, x, y, viewport = { width: 1000, height: 1000 }) {
  return { source, pointerId, screenPosition: { x, y }, viewport };
}

for (const state of ['Entering', 'Navigating', 'ReadyToLeave', 'Leaving']) {
  test(`${state} ship starts a raw route draft`, async () => {
    const { subject, controller } = await createController((await loadSubject()).ShipState[state]);

    const outcome = controller.pointerDown(pointer('mouse', 1, 100, 100));

    assert.deepEqual(outcome, { kind: 'started', shipId: 'ship-input' });
    assert.equal(controller.selectedShipId, 'ship-input');
    assert.equal(controller.activePointerId, 1);
  });
}

for (const state of ['ApproachingDock', 'Docking', 'Unloading', 'Destroyed']) {
  test(`${state} ship cannot start a route draft`, async () => {
    const { subject, controller } = await createController((await loadSubject()).ShipState[state]);

    assert.deepEqual(controller.pointerDown(pointer('touch', 1, 100, 100)), { kind: 'ignored' });
    assert.equal(controller.selectedShipId, null);
    assert.equal(controller.activePointerId, null);
  });
}

test('mouse and touch use the same normalized route result', async () => {
  const run = async (source) => {
    const { subject, controller } = await createController(subjectState('Navigating'));
    controller.pointerDown(pointer(source, 7, 100, 100));
    controller.pointerMove(pointer(source, 7, 200, 100));
    return controller.pointerUp(pointer(source, 7, 300, 100));
  };

  assert.deepEqual(await run('mouse'), await run('touch'));
});

function subjectState(name) {
  return name;
}

test('raw sampling rejects a point closer than sampleDistance and accepts one at it', async () => {
  const { subject, controller } = await createController(subjectState('Navigating'), {
    sampleDistance: 8,
    maxRawPoints: 8,
  });
  controller.pointerDown(pointer('mouse', 1, 100, 100));

  assert.deepEqual(controller.pointerMove(pointer('mouse', 1, 200, 100)), {
    kind: 'updated', pointCount: 1,
  });
  assert.deepEqual(controller.pointerMove(pointer('mouse', 1, 207, 100)), { kind: 'ignored' });
  assert.deepEqual(controller.pointerMove(pointer('mouse', 1, 208, 100)), {
    kind: 'updated', pointCount: 2,
  });
  assert.deepEqual(controller.pointerUp(pointer('mouse', 1, 208, 100)), {
    kind: 'finished',
    draft: { shipId: 'ship-input', points: [{ x: 200, y: 100 }, { x: 208, y: 100 }] },
  });
});

test('route sampling reads sampleDistance and maxRawPoints from validated balance.json', async () => {
  const { subject } = await createController(subjectState('Navigating'));
  const config = subject.createRouteSamplingConfig(
    subject.validateConfigSource(readBaselineSource()),
  );
  const route = readBaselineSource().configs['balance.json'].route;

  assert.equal(config.sampleDistance, route.sampleDistance);
  assert.equal(config.maxRawPoints, route.maxRawPoints);
});

test('raw draft never grows beyond maxRawPoints', async () => {
  const { controller } = await createController(subjectState('Navigating'), {
    sampleDistance: 1,
    maxRawPoints: 2,
  });
  controller.pointerDown(pointer('mouse', 1, 100, 100));
  controller.pointerMove(pointer('mouse', 1, 200, 100));
  controller.pointerMove(pointer('mouse', 1, 300, 100));
  controller.pointerMove(pointer('mouse', 1, 400, 100));

  const outcome = controller.pointerUp(pointer('mouse', 1, 400, 100));
  assert.deepEqual(outcome.draft.points, [{ x: 200, y: 100 }, { x: 300, y: 100 }]);
});

test('pointerup and pointercancel clear route ownership', async () => {
  const { controller } = await createController(subjectState('Navigating'));
  controller.pointerDown(pointer('mouse', 1, 100, 100));
  controller.pointerUp(pointer('mouse', 1, 200, 100));
  assert.equal(controller.selectedShipId, null);
  assert.equal(controller.activePointerId, null);

  controller.pointerDown(pointer('touch', 2, 100, 100));
  assert.deepEqual(controller.pointerCancel(pointer('touch', 2, 100, 100)), { kind: 'cancelled' });
  assert.equal(controller.selectedShipId, null);
  assert.equal(controller.activePointerId, null);
});

test('leaving the playfield finishes at the last valid world point', async () => {
  const { controller } = await createController(subjectState('Navigating'));
  controller.pointerDown(pointer('mouse', 1, 100, 100));
  controller.pointerMove(pointer('mouse', 1, 200, 100));

  assert.deepEqual(controller.pointerMove(pointer('mouse', 1, 1100, 100)), {
    kind: 'finished',
    draft: { shipId: 'ship-input', points: [{ x: 200, y: 100 }] },
  });
  assert.equal(controller.selectedShipId, null);
  assert.equal(controller.activePointerId, null);
});

test('a second pointer cannot take over, add points, or finish the active drag', async () => {
  const { controller } = await createController(subjectState('Navigating'));
  controller.pointerDown(pointer('touch', 1, 100, 100));

  assert.deepEqual(controller.pointerDown(pointer('touch', 2, 100, 100)), { kind: 'ignored' });
  assert.deepEqual(controller.pointerMove(pointer('touch', 2, 200, 100)), { kind: 'ignored' });
  assert.deepEqual(controller.pointerUp(pointer('touch', 2, 200, 100)), { kind: 'ignored' });
  assert.equal(controller.activePointerId, 1);

  assert.equal(controller.pointerUp(pointer('touch', 1, 200, 100)).kind, 'finished');
});

test('a new drag works after a previous draft finishes', async () => {
  const { controller } = await createController(subjectState('Navigating'));
  controller.pointerDown(pointer('mouse', 1, 100, 100));
  controller.pointerUp(pointer('mouse', 1, 200, 100));

  assert.deepEqual(controller.pointerDown(pointer('mouse', 2, 100, 100)), {
    kind: 'started', shipId: 'ship-input',
  });
});

test('controller uses the FND-05 square viewport and ignores decorative margins', async () => {
  const { subject, ship } = await createShip(subjectState('Navigating'));
  const controller = new subject.RouteInputController({
    viewport: new subject.SquareWorldViewport({ width: 1000, height: 1000 }),
    sampling: { sampleDistance: 8, maxRawPoints: 8 },
    hitTest: (point) => (point.x <= 150 && point.y <= 150 ? ship : null),
  });
  const wideViewport = { width: 1600, height: 900 };

  assert.deepEqual(controller.pointerDown(pointer('mouse', 1, 100, 450, wideViewport)), { kind: 'ignored' });
  assert.deepEqual(controller.pointerDown(pointer('mouse', 1, 440, 90, wideViewport)), {
    kind: 'started', shipId: 'ship-input',
  });
});
