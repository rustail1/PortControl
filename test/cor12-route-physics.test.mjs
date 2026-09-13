import assert from 'node:assert/strict';
import test from 'node:test';

import { ShipModel } from '../src/ships/ShipModel.ts';
import { ShipMotor } from '../src/ships/ShipMotor.ts';
import { ShipRoute } from '../src/ships/ShipRoute.ts';
import { ShipState } from '../src/ships/ShipState.ts';

function characteristics(type = 'freighter', speed = 68, turnRateDeg = 95) {
  return Object.freeze({
    type, speed, turnRateDeg,
    collisionRadius: 32, unloadStepMs: 900, warningRadius: 76,
    cargoCapacity: 4, pressureWeight: 2.8, spawnWeight: 10,
    defaultCargoTypes: Object.freeze(['general']),
  });
}

function makeShip({
  type = 'freighter', speed = 68, turnRateDeg = 95,
  position = { x: 0, y: 0 }, rotationDeg = 0,
} = {}) {
  return new ShipModel({
    id: type,
    characteristics: characteristics(type, speed, turnRateDeg),
    position,
    rotationDeg,
    state: ShipState.Navigating,
    cargo: { general: 1 },
  });
}

function angleDelta(left, right) {
  return Math.abs(((right - left + 540) % 360) - 180);
}

function assertOnRoute(ship, epsilon = 1e-7) {
  const expected = ship.route.pointAtDistance(ship.routeProgress);
  assert.ok(
    Math.hypot(ship.x - expected.x, ship.y - expected.y) <= epsilon,
    `ship centre left authored route: actual=${ship.x},${ship.y} expected=${expected.x},${expected.y}`,
  );
}

test('COR-12 physical route follower brakes before a raw 90 degree corner without rewriting it', () => {
  const ship = makeShip();
  const authoredPoints = [{ x: 50, y: 0 }, { x: 50, y: 100 }];
  const authoredSnapshot = { points: authoredPoints, start: { x: 0, y: 0 } };
  ship.replaceRoute(new ShipRoute(authoredPoints, authoredSnapshot.start));
  const motor = new ShipMotor();
  const cruiseStep = ship.characteristics.speed / 60;
  let sawPreCornerBraking = false;

  for (let step = 0; step < 180 && ship.routeProgress < 50; step += 1) {
    const before = ship.routeProgress;
    motor.stepRoute(ship, 2, 1 / 60, false);
    const travelled = ship.routeProgress - before;
    assertOnRoute(ship);
    if (before < 50 && before > 5 && travelled < cruiseStep * 0.95) {
      sawPreCornerBraking = true;
    }
  }

  assert.equal(ship.routeProgress, 50, 'sharp corner must be reached exactly, not skipped');
  assert.ok(sawPreCornerBraking, 'freighter should visibly brake before a 90 degree corner');
  assert.deepEqual(ship.route.toSnapshot(), authoredSnapshot, 'movement must never rewrite the player route');
});

test('COR-12 raw 90 degree vertex slows but does not hard-stop the ship', () => {
  const ship = makeShip();
  ship.replaceRoute(new ShipRoute([{ x: 20, y: 0 }, { x: 20, y: 100 }], ship.position));
  const motor = new ShipMotor();

  for (let step = 0; step < 240 && ship.routeProgress < 20; step += 1) {
    motor.stepRoute(ship, 2, 1 / 60, false);
  }
  assert.equal(ship.routeProgress, 20);
  const rotationAtVertex = ship.rotationDeg;
  const cruiseStep = ship.characteristics.speed / 60;

  motor.stepRoute(ship, 2, 1 / 60, false);

  assert.ok(ship.routeProgress > 20, '90 degree corner must keep controlled forward progress');
  assert.ok(
    ship.routeProgress - 20 < cruiseStep,
    '90 degree corner must remain slower than straight-line cruise',
  );
  assert.ok(angleDelta(rotationAtVertex, ship.rotationDeg) > 0, 'hull must keep turning through the corner');
  assertOnRoute(ship);
});

test('COR-12 exact 180 degree corner brakes to the authored vertex, pivots there, then continues on the same line', () => {
  const ship = makeShip({ type: 'cargo_boat', speed: 105, turnRateDeg: 155 });
  const points = [{ x: 45, y: 0 }, { x: 0, y: 0 }];
  const snapshot = { points, start: { x: 0, y: 0 } };
  ship.replaceRoute(new ShipRoute(points, snapshot.start));
  const motor = new ShipMotor();

  for (let step = 0; step < 300 && ship.routeProgress < 45; step += 1) {
    motor.stepRoute(ship, 2, 1 / 60, false);
    assertOnRoute(ship);
  }
  assert.equal(ship.routeProgress, 45, 'U-turn must reach the exact authored turnaround point');
  assert.ok(Math.abs(ship.x - 45) < 1e-7 && Math.abs(ship.y) < 1e-7);

  let heldFrames = 0;
  let resumed = false;
  for (let step = 0; step < 300; step += 1) {
    const before = ship.routeProgress;
    motor.stepRoute(ship, 2, 1 / 60, false);
    assertOnRoute(ship);
    if (Math.abs(before - 45) < 1e-7 && Math.abs(ship.routeProgress - 45) < 1e-7) heldFrames += 1;
    if (ship.routeProgress > 45 + 1e-7) {
      resumed = true;
      break;
    }
  }

  assert.ok(heldFrames >= 10, `180 degree turn should visibly pivot in place; heldFrames=${heldFrames}`);
  assert.ok(resumed, 'ship must continue after turning around');
  assert.deepEqual(ship.route.toSnapshot(), snapshot, '180 degree handling must not add a hidden hairpin or rewrite the route');
});

test('COR-12 small hand bend keeps cruise speed instead of creating a micro-brake', () => {
  const ship = makeShip();
  const points = [{ x: 40, y: 0 }, { x: 240, y: 35.3 }];
  ship.replaceRoute(new ShipRoute(points, ship.position));
  ship.advanceRouteProgress(40);
  ship.setPosition(ship.route.pointAtDistance(40));
  const motor = new ShipMotor();
  const cruiseStep = ship.characteristics.speed / 60;
  const before = ship.routeProgress;

  motor.stepRoute(ship, 2, 1 / 60, true);

  assert.ok(
    Math.abs((ship.routeProgress - before) - cruiseStep) < 1e-9,
    'a roughly 10 degree hand correction must not pulse the ship speed',
  );
  assertOnRoute(ship);
});

test('COR-12 live route tip brakes before the temporary end and resumes below cruise after extension', () => {
  const ship = makeShip();
  const motor = new ShipMotor();
  const start = { x: 0, y: 0 };
  const cruiseStep = ship.characteristics.speed / 60;
  ship.replaceRoute(new ShipRoute([{ x: 30, y: 0 }], start), start, 25);
  ship.setPosition(ship.route.pointAtDistance(25));
  const beforeTipApproach = ship.routeProgress;

  motor.stepRoute(ship, 2, 1 / 60, false);

  const approachStep = ship.routeProgress - beforeTipApproach;
  assert.ok(approachStep > 0, 'ship should still approach the live tip');
  assert.ok(approachStep < cruiseStep * 0.9, 'ship should already brake before reaching the live tip');
  assertOnRoute(ship);

  ship.replaceRoute(new ShipRoute([{ x: 30, y: 0 }], start), start, 30);
  ship.setPosition(ship.route.pointAtDistance(30));
  ship.replaceRoute(new ShipRoute([{ x: 30, y: 0 }, { x: 38, y: 0 }], start), start, 30);
  const beforeExtension = ship.routeProgress;

  motor.stepRoute(ship, 2, 1 / 60, false);

  const extensionStep = ship.routeProgress - beforeExtension;
  assert.ok(extensionStep > 0, 'extending a held live tip should resume movement');
  assert.ok(extensionStep < cruiseStep * 0.9, 'live extension should not jump straight back to cruise speed');
  assertOnRoute(ship);
});
