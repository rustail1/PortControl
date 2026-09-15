import assert from 'node:assert/strict';
import test from 'node:test';

import { RouteTurnMode, ShipModel } from '../src/ships/ShipModel.ts';
import { ShipCharacteristicsRegistry } from '../src/ships/ShipCharacteristics.ts';
import { ShipMotor } from '../src/ships/ShipMotor.ts';
import { ShipRoute } from '../src/ships/ShipRoute.ts';
import { ShipState } from '../src/ships/ShipState.ts';

const DT = 1 / 60;
const EPSILON = 1e-7;

function characteristics(type = 'freighter', speed = 68, turnRateDeg = 95) {
  return Object.freeze({
    type,
    speed,
    turnRateDeg,
    collisionRadius: 32,
    unloadStepMs: 900,
    warningRadius: 76,
    cargoCapacity: 4,
    pressureWeight: 2.8,
    spawnWeight: 10,
    defaultCargoTypes: Object.freeze(['general']),
  });
}

function makeShip({
  type = 'freighter',
  speed = 68,
  turnRateDeg = 95,
  rotationDeg = 0,
} = {}) {
  return new ShipModel({
    id: type,
    characteristics: characteristics(type, speed, turnRateDeg),
    position: { x: 0, y: 0 },
    rotationDeg,
    state: ShipState.Navigating,
    cargo: { general: 1 },
  });
}

function angleDelta(left, right) {
  return Math.abs(((right - left + 540) % 360) - 180);
}

function assertOnRoute(ship, epsilon = EPSILON) {
  const expected = ship.route.pointAtDistance(ship.routeProgress);
  assert.ok(
    Math.hypot(ship.x - expected.x, ship.y - expected.y) <= epsilon,
    `navigation left authored polyline: actual=${ship.x},${ship.y} expected=${expected.x},${expected.y}`,
  );
}

function step(motor, ship, continueAfterRouteEnd = false) {
  const before = ship.routeProgress;
  motor.stepRoute(ship, DT, continueAfterRouteEnd);
  assertOnRoute(ship);
  assert.ok(ship.routeProgress + EPSILON >= before, 'route progress regressed');
  return ship.routeProgress - before;
}

function runUntil(motor, ship, predicate, maximumSteps = 3600) {
  for (let frame = 0; frame < maximumSteps; frame += 1) {
    if (predicate()) return frame;
    step(motor, ship);
  }
  assert.fail(`condition was not reached within ${maximumSteps} fixed steps`);
}

test('COR-12 authored motion 01: tiny zigzags do not pulse between throttle and braking', () => {
  const ship = makeShip();
  const points = Array.from({ length: 12 }, (_, index) => ({
    x: (index + 1) * 30,
    y: index % 2 === 0 ? 1.5 : -1.5,
  }));
  ship.replaceRoute(new ShipRoute(points, ship.position));
  const motor = new ShipMotor();
  const cruiseStep = ship.characteristics.speed * DT;
  const deltas = [];
  for (let frame = 0; frame < 180; frame += 1) deltas.push(step(motor, ship));
  assert.ok(deltas.filter((delta) => delta < cruiseStep * 0.9).length <= 2,
    `tiny hand corrections caused ${deltas.filter((delta) => delta < cruiseStep * 0.9).length} braking ticks`);
});

test('COR-12 authored motion 02: a 45 degree corner slows gently without pre-steer', () => {
  const ship = makeShip();
  ship.replaceRoute(new ShipRoute([{ x: 100, y: 0 }, { x: 200, y: 100 }], ship.position));
  const motor = new ShipMotor();
  const cruiseStep = ship.characteristics.speed * DT;
  const approachDeltas = [];
  while (ship.routeProgress < 100 - EPSILON) {
    assert.equal(ship.rotationDeg, 0, `hull pre-steered at progress ${ship.routeProgress}`);
    const progressBefore = ship.routeProgress;
    const delta = step(motor, ship);
    if (progressBefore > 60 && ship.routeProgress < 100 - EPSILON) approachDeltas.push(delta);
  }
  assert.ok(Math.min(...approachDeltas) < cruiseStep * 0.98, '45 degree corner did not slow down');
  assert.ok(Math.min(...approachDeltas) > cruiseStep * 0.45, '45 degree corner slowed too aggressively');
});

test('COR-12 authored motion 03: a 90 degree corner visits the exact vertex without a long stop', () => {
  const ship = makeShip({ type: 'cargo_boat', speed: 105, turnRateDeg: 155 });
  ship.replaceRoute(new ShipRoute([{ x: 80, y: 0 }, { x: 80, y: 120 }], ship.position));
  const motor = new ShipMotor();
  let visitedVertex = false;
  let consecutiveHeldFrames = 0;
  let maximumHeldFrames = 0;
  for (let frame = 0; frame < 600 && ship.routeProgress < ship.route.totalLength; frame += 1) {
    const delta = step(motor, ship);
    if (Math.abs(ship.routeProgress - 80) <= EPSILON) visitedVertex = true;
    consecutiveHeldFrames = delta <= EPSILON ? consecutiveHeldFrames + 1 : 0;
    maximumHeldFrames = Math.max(maximumHeldFrames, consecutiveHeldFrames);
  }
  assert.equal(visitedVertex, true, '90 degree route skipped its authored vertex');
  assert.ok(maximumHeldFrames <= 6, `90 degree route parked for ${maximumHeldFrames} frames`);
  assert.equal(ship.routeProgress, ship.route.totalLength);
});

test('COR-12 authored motion 04: a 180 degree reversal brakes before the vertex', () => {
  const ship = makeShip({ type: 'cargo_boat', speed: 105, turnRateDeg: 155 });
  ship.replaceRoute(new ShipRoute([{ x: 120, y: 0 }, { x: 0, y: 0 }], ship.position));
  const motor = new ShipMotor();
  const cruiseStep = ship.characteristics.speed * DT;
  const approachDeltas = [];
  while (ship.routeProgress < 120 - EPSILON) {
    const delta = step(motor, ship);
    if (ship.routeProgress > 80) approachDeltas.push(delta);
  }
  assert.ok(approachDeltas.some((delta) => delta < cruiseStep * 0.5),
    'reversal reached the vertex without substantial predictive braking');
});

test('COR-12 authored motion 05: a 180 degree reversal reaches the exact authored vertex', () => {
  const ship = makeShip();
  ship.replaceRoute(new ShipRoute([{ x: 90, y: 0 }, { x: 0, y: 0 }], ship.position));
  const motor = new ShipMotor();
  runUntil(motor, ship, () => ship.routeProgress >= 90 - EPSILON);
  assert.equal(ship.routeProgress, 90);
  assert.deepEqual(ship.position, { x: 90, y: 0 });
});

test('COR-12 authored motion 06: reversal progress stays at the vertex until the hull has turned sufficiently', () => {
  const ship = makeShip();
  ship.replaceRoute(new ShipRoute([{ x: 90, y: 0 }, { x: 0, y: 0 }], ship.position));
  const motor = new ShipMotor();
  runUntil(motor, ship, () => ship.routeProgress >= 90 - EPSILON);
  let heldFrames = 0;
  while (ship.routeProgress <= 90 + EPSILON && heldFrames < 600) {
    step(motor, ship);
    heldFrames += 1;
  }
  assert.ok(heldFrames > 0, 'reversal did not hold its vertex');
  assert.ok(angleDelta(ship.rotationDeg, 180) <= 60 + EPSILON,
    `reversal resumed while hull error was ${angleDelta(ship.rotationDeg, 180)}`);
});

test('COR-12 authored motion 07: a ship continues after completing a 180 degree pivot', () => {
  const ship = makeShip();
  ship.replaceRoute(new ShipRoute([{ x: 90, y: 0 }, { x: -80, y: 0 }], ship.position));
  const motor = new ShipMotor();
  runUntil(motor, ship, () => ship.routeProgress > 90 + 10);
  assert.ok(ship.x < 80, 'ship did not continue along the reverse authored segment');
});

test('COR-12 authored motion 08: the slow-turning tanker eventually leaves pivot state', () => {
  const ship = makeShip({ type: 'tanker', speed: 78, turnRateDeg: 85 });
  ship.replaceRoute(new ShipRoute([{ x: 90, y: 0 }, { x: -90, y: 0 }], ship.position));
  const motor = new ShipMotor();
  runUntil(motor, ship, () => ship.routeProgress > 100, 2400);
  assert.ok(ship.routeProgress > 100);
});

test('COR-12 authored motion 09: backward then forward live extension preserves monotonic progress', () => {
  const ship = makeShip({ type: 'speedboat', speed: 150, turnRateDeg: 220, rotationDeg: 180 });
  const start = ship.position;
  ship.replaceRoute(new ShipRoute([{ x: -120, y: 0 }], start), start);
  const motor = new ShipMotor();
  for (let frame = 0; frame < 30; frame += 1) step(motor, ship);
  const progressBefore = ship.routeProgress;
  ship.replaceRoute(new ShipRoute([{ x: -120, y: 0 }, { x: 160, y: 0 }], start), start, progressBefore);
  assert.equal(ship.routeProgress, progressBefore);
  for (let frame = 0; frame < 120; frame += 1) step(motor, ship);
  assert.ok(ship.routeProgress >= progressBefore);
});

test('COR-12 authored motion 10: every finite valid route terminates without an infinite pivot', () => {
  const ship = makeShip({ type: 'tanker', speed: 78, turnRateDeg: 85 });
  ship.replaceRoute(new ShipRoute([
    { x: 60, y: 0 }, { x: 60, y: 30 }, { x: 20, y: 30 },
    { x: 20, y: 30 }, { x: 90, y: 80 }, { x: -20, y: 80 },
  ], ship.position));
  const motor = new ShipMotor();
  runUntil(motor, ship, () => ship.routeProgress >= ship.route.totalLength - EPSILON, 3600);
  assert.equal(ship.routeProgress, ship.route.totalLength);
});

test('COR-12 authored motion 11: a slowly extended live tip uses controlled braking', () => {
  const ship = makeShip();
  ship.replaceRoute(new ShipRoute([{ x: 80, y: 0 }], ship.position));
  const motor = new ShipMotor();
  const cruiseStep = ship.characteristics.speed * DT;
  const finalDeltas = [];
  while (ship.routeProgress < ship.route.totalLength - EPSILON) {
    const delta = step(motor, ship);
    if (ship.route.totalLength - ship.routeProgress < 20) finalDeltas.push(delta);
  }
  const controlledDeltas = finalDeltas.filter(
    (delta) => delta > EPSILON && delta < cruiseStep * 0.9,
  );
  assert.ok(controlledDeltas.length >= 3,
    `live tip did not brake over multiple fixed steps: ${finalDeltas.join(',')}`);
});

test('COR-12 authored motion 12: extending a stopped live tip resumes movement', () => {
  const ship = makeShip();
  const start = ship.position;
  ship.replaceRoute(new ShipRoute([{ x: 50, y: 0 }], start), start);
  const motor = new ShipMotor();
  runUntil(motor, ship, () => ship.routeProgress >= 50 - EPSILON);
  for (let frame = 0; frame < 10; frame += 1) step(motor, ship);
  ship.replaceRoute(new ShipRoute([{ x: 50, y: 0 }, { x: 150, y: 0 }], start), start, ship.routeProgress);
  runUntil(motor, ship, () => ship.routeProgress > 50 + EPSILON, 120);
  assert.ok(ship.routeProgress > 50);
});

test('COR-12 authored motion 13: live-tip resume does not jump from zero to full speed in one tick', () => {
  const ship = makeShip();
  const start = ship.position;
  ship.replaceRoute(new ShipRoute([{ x: 50, y: 0 }], start), start);
  const motor = new ShipMotor();
  runUntil(motor, ship, () => ship.routeProgress >= 50 - EPSILON);
  for (let frame = 0; frame < 10; frame += 1) step(motor, ship);
  ship.replaceRoute(new ShipRoute([{ x: 50, y: 0 }, { x: 150, y: 0 }], start), start, ship.routeProgress);
  const firstDelta = step(motor, ship);
  assert.ok(firstDelta > 0, 'live-tip extension did not resume');
  assert.ok(firstDelta < ship.characteristics.speed * DT * 0.8,
    `live-tip extension snapped to cruise in one tick: ${firstDelta}`);
});

test('COR-12 authored motion 14: all navigation samples remain on the authored polyline', () => {
  const ship = makeShip({ type: 'speedboat', speed: 150, turnRateDeg: 220 });
  ship.replaceRoute(new ShipRoute([
    { x: 70, y: 0 }, { x: 70, y: 70 }, { x: 20, y: 30 }, { x: 130, y: 30 },
  ], ship.position));
  const motor = new ShipMotor();
  for (let frame = 0; frame < 1200 && ship.routeProgress < ship.route.totalLength; frame += 1) {
    step(motor, ship);
  }
  assert.equal(ship.routeProgress, ship.route.totalLength);
});

test('COR-12 authored motion 15: ShipMotor never mutates a committed route snapshot', () => {
  const ship = makeShip();
  const route = new ShipRoute([{ x: 80, y: 0 }, { x: 80, y: 90 }, { x: 20, y: 90 }], ship.position);
  ship.replaceRoute(route, ship.position);
  const before = structuredClone(ship.route.toSnapshot());
  const motor = new ShipMotor();
  for (let frame = 0; frame < 240; frame += 1) step(motor, ship);
  assert.deepEqual(ship.route.toSnapshot(), before);
});

test('COR-12 authored motion 16: snapshot restore preserves braking and pivot motion state', () => {
  const ship = makeShip();
  ship.replaceRoute(new ShipRoute([{ x: 100, y: 0 }, { x: -80, y: 0 }], ship.position));
  const motor = new ShipMotor();
  runUntil(motor, ship, () => ship.routePivotProgress !== null);
  const registry = new ShipCharacteristicsRegistry(new Map([
    [ship.characteristics.type, ship.characteristics],
  ]));
  const restored = ShipModel.restore(ship.toSnapshot(), registry);
  assert.equal(restored.routeSpeed, 0);
  assert.equal(restored.routePivotProgress, ship.routePivotProgress);
  assert.equal(restored.routeTurnMode, RouteTurnMode.AuthoredReversal);
  for (let frame = 0; frame < 90; frame += 1) {
    motor.stepRoute(ship, DT, false);
    motor.stepRoute(restored, DT, false);
  }
  assert.deepEqual(restored.toSnapshot(), ship.toSnapshot());
});
