import assert from 'node:assert/strict';
import test from 'node:test';

import { RouteTurnMode, ShipModel } from '../src/ships/ShipModel.ts';
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

test('COR-12 ordinary 90 degree bend slows without pre-steer or a long stop', () => {
  const ship = makeShip();
  const authoredPoints = [{ x: 50, y: 0 }, { x: 50, y: 100 }];
  const authoredSnapshot = { points: authoredPoints, start: { x: 0, y: 0 } };
  ship.replaceRoute(new ShipRoute(authoredPoints, authoredSnapshot.start));
  const motor = new ShipMotor();
  const cruiseStep = ship.characteristics.speed / 60;
  let sawPreTurn = false;
  let heldFrames = 0;
  let maximumHeldFrames = 0;

  for (let step = 0; step < 240 && ship.routeProgress < ship.route.totalLength; step += 1) {
    const beforeProgress = ship.routeProgress;
    const beforeX = ship.x;
    motor.stepRoute(ship, 1 / 60, false);
    const travelled = ship.routeProgress - beforeProgress;
    assertOnRoute(ship);
    if (beforeX < 50 - 1e-7 && ship.rotationDeg > 0) sawPreTurn = true;
    heldFrames = travelled <= 1e-9 ? heldFrames + 1 : 0;
    maximumHeldFrames = Math.max(maximumHeldFrames, heldFrames);
  }

  assert.equal(sawPreTurn, false, 'hull must not turn before the authored vertex');
  assert.ok(maximumHeldFrames <= 6, `ordinary bend parked for ${maximumHeldFrames} frames`);
  assert.equal(ship.routeProgress, ship.route.totalLength);
  assert.deepEqual(ship.route.toSnapshot(), authoredSnapshot, 'movement must never rewrite the player route');
});

test('ROUTE TURN MODE route more than 90 degrees off the bow turns in place before moving', () => {
  const ship = makeShip({ rotationDeg: 0 });
  const headingDeg = 105;
  const radians = headingDeg * Math.PI / 180;
  ship.replaceRoute(new ShipRoute([{ x: Math.cos(radians) * 120, y: Math.sin(radians) * 120 }], ship.position));
  const motor = new ShipMotor();

  motor.stepRoute(ship, 1 / 60, false);

  assert.equal(ship.routePivotProgress, 0, 'large heading mismatch must surface as TURN immediately');
  assert.equal(ship.routeTurnMode, RouteTurnMode.Reorientation);
  assert.equal(ship.routeProgress, 0, 'route behind the hull must not translate the ship backward/sideways');
  assert.equal(ship.routeSpeed, 0);
  assertOnRoute(ship);
  assert.ok(ship.rotationDeg > 0, 'hull must visibly turn toward the committed route');
});

test('COR-12 initial route behind the bow waits on canonical progress then resumes after reorientation', () => {
  const ship = makeShip({ rotationDeg: 0 });
  ship.replaceRoute(new ShipRoute([{ x: -120, y: 0 }], ship.position));
  const motor = new ShipMotor();
  let releasedPivot = false;

  for (let step = 0; step < 240 && ship.routeProgress < ship.route.totalLength; step += 1) {
    const beforeProgress = ship.routeProgress;
    motor.stepRoute(ship, 1 / 60, false);
    assertOnRoute(ship);
    if (ship.routeTurnMode !== null) {
      assert.equal(ship.routeTurnMode, RouteTurnMode.Reorientation);
      assert.equal(ship.routeProgress, beforeProgress, 'reorientation must stay stationary while tangent is behind the hull');
    }
    if (ship.routeTurnMode === null && ship.routeProgress > 0) {
      releasedPivot = true;
      assert.ok(
        angleDelta(ship.rotationDeg, 180) <= 90 + 1e-7,
        `initial TURN released before the route entered the hull forward half-plane: heading=${ship.rotationDeg}`,
      );
      break;
    }
  }

  assert.equal(releasedPivot, true, 'initial TURN should release and then resume exact-polyline movement');
  assert.ok(ship.x < 0);
  assert.ok(Math.abs(ship.y) < 1e-9);
});

test('COR-12 sharp greater-than-90 corner reaches the vertex then pivots there before continuing', () => {
  const ship = makeShip({ type: 'cargo_boat', speed: 105, turnRateDeg: 155 });
  const points = [{ x: 45, y: 0 }, { x: 0, y: 45 }];
  ship.replaceRoute(new ShipRoute(points, ship.position));
  const motor = new ShipMotor();

  for (let step = 0; step < 300 && ship.routeProgress < 45; step += 1) {
    motor.stepRoute(ship, 1 / 60, false);
    assertOnRoute(ship);
  }
  assert.equal(ship.routeProgress, 45, 'sharp turn must reach the exact authored vertex');
  assert.deepEqual(ship.position, { x: 45, y: 0 });

  let heldFrames = 0;
  let resumed = false;
  for (let step = 0; step < 300; step += 1) {
    const before = ship.routeProgress;
    motor.stepRoute(ship, 1 / 60, false);
    assertOnRoute(ship);
    if (Math.abs(before - 45) < 1e-7 && Math.abs(ship.routeProgress - 45) < 1e-7) heldFrames += 1;
    if (ship.routeProgress > 45 + 1e-7) {
      resumed = true;
      assert.ok(angleDelta(ship.rotationDeg, 135) <= 90 + 1e-7);
      break;
    }
  }

  assert.ok(heldFrames > 0, 'sharp turn should pivot instead of translating while facing away');
  assert.equal(resumed, true, 'ship must continue after the route is no longer behind its bow');
});

test('COR-12 small hand bend keeps cruise speed instead of creating a micro-stop', () => {
  const ship = makeShip();
  const points = [{ x: 40, y: 0 }, { x: 240, y: 35.3 }];
  ship.replaceRoute(new ShipRoute(points, ship.position));
  ship.advanceRouteProgress(40);
  ship.setPosition(ship.route.pointAtDistance(40));
  const motor = new ShipMotor();
  const cruiseStep = ship.characteristics.speed / 60;
  const before = ship.routeProgress;

  motor.stepRoute(ship, 1 / 60, true);

  assert.ok(
    Math.abs((ship.routeProgress - before) - cruiseStep) < 1e-9,
    'a small hand correction must not pulse or stop the ship speed',
  );
  assertOnRoute(ship);
});

test('COR-12 live route still cannot run beyond its temporary authored tip', () => {
  const ship = makeShip();
  const motor = new ShipMotor();
  const start = { x: 0, y: 0 };
  ship.replaceRoute(new ShipRoute([{ x: 30, y: 0 }], start), start, 29.5);
  ship.setPosition(ship.route.pointAtDistance(29.5));

  motor.stepRoute(ship, 1 / 60, false);

  assert.equal(ship.routeProgress, 30);
  assert.deepEqual(ship.position, { x: 30, y: 0 });
  motor.stepRoute(ship, 1 / 60, false);
  assert.equal(ship.routeProgress, 30, 'live follower must wait at the actual temporary tip, not drift past it');
  assertOnRoute(ship);
});
