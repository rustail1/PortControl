import assert from 'node:assert/strict';
import test from 'node:test';
import { ShipModel } from '../src/ships/ShipModel.ts';
import { ShipState } from '../src/ships/ShipState.ts';
import { ShipMotor } from '../src/ships/ShipMotor.ts';
import { ShipRoute } from '../src/ships/ShipRoute.ts';
import { RouteInputController } from '../src/routes/RouteInputController.ts';
import { SquareWorldViewport } from '../src/camera/SquareWorldViewport.ts';

const characteristics = Object.freeze({
  type: 'cargo_boat', speed: 90, turnRateDeg: 20, collisionRadius: 8,
  unloadStepMs: 500, warningRadius: 20, cargoCapacity: 2, pressureWeight: 1,
  spawnWeight: 1, defaultCargoTypes: Object.freeze(['general']),
});

function pointer(x, y, pointerId = 1) {
  return {
    source: 'mouse', pointerId,
    screenPosition: { x, y }, cssPosition: { x, y },
    internalViewport: { width: 1000, height: 1000 },
    worldToCssPixelScale: 1,
  };
}

test('VIDEO v6 pivot releases as soon as authored tangent re-enters forward half-plane', () => {
  const route = new ShipRoute([{ x: 300, y: 0 }], { x: 0, y: 0 });
  const ship = new ShipModel({
    id: 'turn', characteristics, position: { x: 0, y: 0 }, rotationDeg: 100,
    state: ShipState.Navigating, route: route.toSnapshot(),
  });
  const motor = new ShipMotor();

  // First half-second reaches the physical 90-degree boundary.
  motor.stepRoute(ship, 0.5);
  assert.equal(ship.rotationDeg, 90);
  assert.equal(ship.routePivotProgress, null,
    'pivot must release at the forward-half-plane boundary instead of waiting for an arbitrary 60-degree alignment');

  // The very next fixed step must resume authored-route progress.
  motor.stepRoute(ship, 1 / 60);
  assert.ok(ship.routeProgress > 0, 'ship must not remain parked after the route is physically forward-drivable');
});

test('VIDEO v6 outbound drag authors the exact pointer coordinate from an off-centre grab', () => {
  const ship = new ShipModel({
    id: 'out', characteristics, position: { x: 500, y: 500 }, rotationDeg: 90,
    state: ShipState.ReadyToLeave, cargo: {},
  });
  const release = { x: 500, y: 600 };
  const controller = new RouteInputController({
    viewport: new SquareWorldViewport({ width: 1000, height: 1000 }),
    sampling: { sampleDistance: 8, maxRawPoints: 256 },
    hitTest: () => ship,
    routeStartForShip: () => release,
  });

  // Grab off-centre (+10,-10), then drag exactly +100 px right.
  // Current v1.9 semantics keep the accepted route point at the real cursor coordinate;
  // the departure release remains the route origin but does not translate pointer samples.
  controller.pointerDown(pointer(510, 490));
  controller.pointerMove(pointer(610, 490));
  const draft = controller.activeDraftSnapshot;

  assert.ok(draft);
  assert.deepEqual(draft.start, release);
  assert.deepEqual(draft.points, [{ x: 610, y: 490 }],
    'accepted outbound point must equal the actual cursor coordinate without release-space translation');
});
