import assert from 'node:assert/strict';
import test from 'node:test';

import { SquareWorldViewport } from '../src/camera/SquareWorldViewport.ts';
import { RouteInputController } from '../src/routes/RouteInputController.ts';
import { selectRouteInputShip } from '../src/runtime/RouteInputHitTest.ts';
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

function shipAt(position = { x: 100, y: 100 }, state = ShipState.Navigating) {
  return new ShipModel({
    id: 'small-fast',
    characteristics: speedboatCharacteristics,
    position,
    rotationDeg: 0,
    state,
  });
}

function pointer(x, y, pointerId = 1, worldToCssPixelScale = 1) {
  return {
    source: 'mouse',
    pointerId,
    screenPosition: { x, y },
    cssPosition: { x, y },
    internalViewport: { width: 1000, height: 1000 },
    worldToCssPixelScale,
  };
}

test('CORE input: small ships expose a 64 CSS px minimum selection target', () => {
  const ship = shipAt();
  const candidates = [{ ship, spawnSequence: 1 }];

  assert.equal(
    selectRouteInputShip(candidates, { x: 131.999, y: 100 }, 1)?.id,
    ship.id,
    '31.999 CSS px from the centre must still select a small ship',
  );
  assert.equal(
    selectRouteInputShip(candidates, { x: 132.001, y: 100 }, 1),
    null,
    'the minimum target must remain bounded rather than growing without limit',
  );
});

test('CORE input: drag activation uses absolute pointer coordinates with a first-sample guard', () => {
  const ship = shipAt();
  const controller = new RouteInputController({
    viewport: new SquareWorldViewport({ width: 1000, height: 1000 }),
    sampling: { sampleDistance: 8, maxRawPoints: 256 },
    hitTest: () => ship,
  });

  assert.deepEqual(controller.pointerDown(pointer(108, 100)), {
    kind: 'started', shipId: ship.id,
  });
  ship.setPosition({ x: 130, y: 100 });

  controller.pointerMove(pointer(122, 100));
  const guarded = controller.activeDraftSnapshot;
  assert.ok(guarded);
  assert.deepEqual(guarded.start, { x: 130, y: 100 });
  assert.deepEqual(guarded.points, [],
    'a forward cursor still behind the moving hull must not author a reverse first segment');
  assert.equal(guarded.tip, undefined);

  controller.pointerMove(pointer(172, 100));
  const extended = controller.activeDraftSnapshot;
  assert.ok(extended);
  assert.deepEqual(extended.points, [{ x: 172, y: 100 }],
    'once the cursor catches the intended gesture direction, the authored point must equal the pointer');
});

test('CORE input matrix: delayed small-ship drags stay WYSIWYG and never author a false reverse first segment', () => {
  const shipTypes = [
    { ...speedboatCharacteristics, type: 'speedboat', speed: 150, collisionRadius: 14 },
    { ...speedboatCharacteristics, type: 'cargo_boat', speed: 105, turnRateDeg: 155, collisionRadius: 22 },
  ];
  const delaysMs = [0, 100, 200];
  const grabs = [
    { name: 'centre', offset: { x: 0, y: 0 } },
    { name: 'nose', offset: { x: 14, y: 0 } },
    { name: 'edge', offset: { x: 0, y: 31.5 } },
  ];
  const gestures = [
    { name: 'straight', delta: { x: 80, y: 0 } },
    { name: 'left', delta: { x: 70, y: -40 } },
    { name: 'right', delta: { x: 70, y: 40 } },
  ];

  for (const characteristics of shipTypes) {
    for (const delayMs of delaysMs) {
      for (const grab of grabs) {
        for (const gesture of gestures) {
          const ship = new ShipModel({
            id: `${characteristics.type}-${delayMs}-${grab.name}-${gesture.name}`,
            characteristics: Object.freeze(characteristics),
            position: { x: 200, y: 300 },
            rotationDeg: 0,
            state: ShipState.Navigating,
          });
          const candidates = [{ ship, spawnSequence: 1 }];
          const controller = new RouteInputController({
            viewport: new SquareWorldViewport({ width: 1000, height: 1000 }),
            sampling: { sampleDistance: 8, maxRawPoints: 256 },
            hitTest: (point, scale) => selectRouteInputShip(candidates, point, scale),
          });
          const down = { x: 200 + grab.offset.x, y: 300 + grab.offset.y };
          assert.equal(controller.pointerDown(pointer(down.x, down.y)).kind, 'started',
            `${characteristics.type}/${grab.name} must be selectable`);

          ship.setPosition({
            x: 200 + characteristics.speed * delayMs / 1000,
            y: 300,
          });

          const activation = { x: down.x + 14, y: down.y };
          controller.pointerMove(pointer(activation.x, activation.y));
          const next = {
            x: activation.x + gesture.delta.x,
            y: activation.y + gesture.delta.y,
          };
          controller.pointerMove(pointer(next.x, next.y));
          const draft = controller.activeDraftSnapshot;
          assert.ok(draft, `${characteristics.type}/${delayMs}/${grab.name}/${gesture.name} must activate`);
          assert.ok(draft.points.length >= 1 && draft.points.length <= 2);
          const first = draft.points[0];
          const last = draft.points.at(-1);
          assert.ok(first.x > draft.start.x,
            `${characteristics.type}/${delayMs}/${grab.name}/${gesture.name} authored first point behind hull: ${JSON.stringify({ start: draft.start, first })}`);
          assert.deepEqual(last, next,
            `${characteristics.type}/${delayMs}/${grab.name}/${gesture.name} preview end must equal the pointer coordinate`);
          if (draft.points.length === 2) {
            assert.deepEqual(draft.points[0], activation,
              `${characteristics.type}/${delayMs}/${grab.name}/${gesture.name} accepted activation point must be absolute pointer coordinates`);
          }
        }
      }
    }
  }
});

