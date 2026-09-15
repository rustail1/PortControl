import assert from 'node:assert/strict';
import test from 'node:test';

import { SquareWorldViewport } from '../src/camera/SquareWorldViewport.ts';
import { RouteInputController } from '../src/routes/RouteInputController.ts';
import { ShipModel } from '../src/ships/ShipModel.ts';
import { ShipState } from '../src/ships/ShipState.ts';

const speedboatCharacteristics = Object.freeze({
  type: 'speedboat',
  speed: 150,
  turnRateDeg: 120,
  collisionRadius: 14,
  unloadStepMs: 500,
  warningRadius: 20,
  cargoCapacity: 1,
  pressureWeight: 1,
  spawnWeight: 1,
  defaultCargoTypes: Object.freeze(['general']),
});

function shipAt(position = { x: 100, y: 100 }) {
  return new ShipModel({
    id: 'pointer-wysiwyg',
    characteristics: speedboatCharacteristics,
    position,
    rotationDeg: 0,
    state: ShipState.Navigating,
  });
}

function pointer(x, y, pointerId = 1) {
  return {
    source: 'mouse',
    pointerId,
    screenPosition: { x, y },
    cssPosition: { x, y },
    internalViewport: { width: 1000, height: 1000 },
    worldToCssPixelScale: 1,
  };
}

function controllerFor(ship) {
  return new RouteInputController({
    viewport: new SquareWorldViewport({ width: 1000, height: 1000 }),
    sampling: { sampleDistance: 8, maxRawPoints: 256 },
    hitTest: () => ship,
  });
}

test('CORE pointer WYSIWYG: an immediate drag authors the exact pointer coordinate', () => {
  const ship = shipAt();
  const controller = controllerFor(ship);

  controller.pointerDown(pointer(108, 100));
  controller.pointerMove(pointer(122, 100));

  const draft = controller.activeDraftSnapshot;
  assert.ok(draft);
  assert.deepEqual(draft.start, { x: 100, y: 100 });
  assert.deepEqual(draft.points, [{ x: 122, y: 100 }]);
  assert.equal(draft.tip, undefined);
});

test('CORE pointer WYSIWYG: a delayed forward drag suppresses the unsafe first sample until the cursor catches the gesture direction', () => {
  const ship = shipAt();
  const controller = controllerFor(ship);

  controller.pointerDown(pointer(108, 100));
  ship.setPosition({ x: 130, y: 100 });

  controller.pointerMove(pointer(122, 100));
  const guarded = controller.activeDraftSnapshot;
  assert.ok(guarded);
  assert.deepEqual(guarded.start, { x: 130, y: 100 });
  assert.deepEqual(guarded.points, []);
  assert.equal(guarded.tip, undefined, 'unsafe cursor-behind-hull sample must not render a false reverse preview');

  controller.pointerMove(pointer(172, 100));
  const caughtUp = controller.activeDraftSnapshot;
  assert.ok(caughtUp);
  assert.deepEqual(caughtUp.points, [{ x: 172, y: 100 }]);
  assert.equal(caughtUp.tip, undefined);
});

test('CORE pointer WYSIWYG: an intentional backward gesture is accepted at the real pointer coordinate', () => {
  const ship = shipAt();
  const controller = controllerFor(ship);

  controller.pointerDown(pointer(108, 100));
  ship.setPosition({ x: 130, y: 100 });
  controller.pointerMove(pointer(94, 100));

  const draft = controller.activeDraftSnapshot;
  assert.ok(draft);
  assert.deepEqual(draft.start, { x: 130, y: 100 });
  assert.deepEqual(draft.points, [{ x: 94, y: 100 }]);
});

test('CORE pointer WYSIWYG: after the first safe sample every later point is the exact pointer coordinate', () => {
  const ship = shipAt();
  const controller = controllerFor(ship);

  controller.pointerDown(pointer(108, 100));
  ship.setPosition({ x: 130, y: 100 });
  controller.pointerMove(pointer(122, 100));
  controller.pointerMove(pointer(172, 100));
  controller.pointerMove(pointer(222, 140));

  const draft = controller.activeDraftSnapshot;
  assert.ok(draft);
  assert.deepEqual(draft.points, [
    { x: 172, y: 100 },
    { x: 222, y: 140 },
  ]);
  assert.deepEqual(draft.points.at(-1), { x: 222, y: 140 });
});

test('CORE pointer WYSIWYG: leaving the canvas commits the exact boundary intersection without an offset', () => {
  const ship = shipAt();
  const controller = controllerFor(ship);

  controller.pointerDown(pointer(108, 100));
  controller.pointerMove(pointer(200, 100));
  const outcome = controller.pointerMove(pointer(1100, 100));

  assert.equal(outcome.kind, 'finished');
  assert.deepEqual(outcome.draft.start, { x: 100, y: 100 });
  assert.deepEqual(outcome.draft.points.at(-1), { x: 1000, y: 100 });
});
