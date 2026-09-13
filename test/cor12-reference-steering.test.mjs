import assert from 'node:assert/strict';
import test from 'node:test';

import { ShipModel } from '../src/ships/ShipModel.ts';
import { ShipMotor } from '../src/ships/ShipMotor.ts';
import { ShipRoute } from '../src/ships/ShipRoute.ts';
import { ShipState } from '../src/ships/ShipState.ts';

function characteristics(type, speed, turnRateDeg) {
  return Object.freeze({
    type, speed, turnRateDeg,
    collisionRadius: 10, unloadStepMs: 800, warningRadius: 40,
    cargoCapacity: 1, pressureWeight: 1, spawnWeight: 1,
    defaultCargoTypes: Object.freeze(['general']),
  });
}

function ship({ id = 'ship', speed = 60, turnRateDeg = 90, position = { x: 0, y: 0 }, rotationDeg = 0 } = {}) {
  return new ShipModel({ id, characteristics: characteristics(id, speed, turnRateDeg), position, rotationDeg,
    state: ShipState.Navigating, cargo: { general: 1 } });
}

function angleDelta(left, right) {
  return Math.abs(((right - left + 540) % 360) - 180);
}

function assertOnCanonicalRoute(subject, epsilon = 1e-9) {
  const expected = subject.route.pointAtDistance(subject.routeProgress);
  assert.ok(Math.hypot(subject.x - expected.x, subject.y - expected.y) <= epsilon,
    `ship centre left route: actual=${subject.x},${subject.y} expected=${expected.x},${expected.y}`);
}

test('COR-12 reference steering limits a 90 degree turn to turnRateDeg * dt', () => {
  const subject = ship();
  subject.replaceRoute(new ShipRoute([{ x: 0, y: 100 }], subject.position));
  new ShipMotor().stepRoute(subject, 2, 1 / 60, false);
  assert.ok(subject.rotationDeg > 0);
  assert.ok(angleDelta(0, subject.rotationDeg) <= subject.characteristics.turnRateDeg / 60 + 1e-9,
    `rotation snapped to ${subject.rotationDeg}`);
  assertOnCanonicalRoute(subject);
});

test('COR-12 canonical follow keeps the ship centre on route while hull turns independently', () => {
  const subject = ship();
  subject.replaceRoute(new ShipRoute([{ x: 0, y: 100 }], subject.position));
  new ShipMotor().stepRoute(subject, 2, 1 / 60, false);
  assertOnCanonicalRoute(subject);
  assert.ok(Math.abs(subject.x) < 1e-9);
  assert.ok(subject.y > 0, 'aligned component should permit slow forward route progress');
  assert.ok(subject.rotationDeg < 10, `hull rotation snapped to ${subject.rotationDeg}`);
});

test('COR-12 reverse route turns in place before making backward canonical progress', () => {
  const subject = ship();
  subject.replaceRoute(new ShipRoute([{ x: -100, y: 0 }], subject.position));
  const before = subject.position;
  new ShipMotor().stepRoute(subject, 2, 1 / 60, false);
  assertOnCanonicalRoute(subject);
  assert.ok(Math.hypot(subject.x - before.x, subject.y - before.y) < 1e-9,
    `ship should not move off-route while facing away: ${subject.x},${subject.y}`);
  assert.ok(angleDelta(0, subject.rotationDeg) > 0, 'hull should start turning toward the reverse route');
});

test('COR-12 sharp corner keeps monotonic progress and exact route ownership', () => {
  const subject = ship({ speed: 120, turnRateDeg: 90 });
  subject.replaceRoute(new ShipRoute([{ x: 10, y: 0 }, { x: 10, y: 120 }], subject.position));
  const motor = new ShipMotor();
  let previousProgress = subject.routeProgress;
  for (let i = 0; i < 600 && subject.routeProgress < subject.route.totalLength; i += 1) {
    motor.stepRoute(subject, 2, 1 / 60, false);
    assert.ok(subject.routeProgress >= previousProgress);
    assertOnCanonicalRoute(subject, 1e-7);
    previousProgress = subject.routeProgress;
  }
  assert.equal(subject.routeProgress, subject.route.totalLength,
    `sharp corner failed to finish at progress ${subject.routeProgress}`);
});

test('COR-12 existing speedboat and heavy characteristics create distinct speed and turn feel', () => {
  const speedboat = ship({ id: 'speedboat', speed: 150, turnRateDeg: 220 });
  const freighter = ship({ id: 'freighter', speed: 68, turnRateDeg: 95 });
  for (const subject of [speedboat, freighter]) subject.replaceRoute(new ShipRoute([{ x: 0, y: 500 }], subject.position));
  const motor = new ShipMotor();
  motor.stepRoute(speedboat, 2, 1 / 60, false);
  motor.stepRoute(freighter, 2, 1 / 60, false);
  assert.ok(speedboat.routeProgress > freighter.routeProgress);
  assert.ok(angleDelta(0, speedboat.rotationDeg) > angleDelta(0, freighter.rotationDeg));
  assertOnCanonicalRoute(speedboat);
  assertOnCanonicalRoute(freighter);
});

test('COR-12 live extension preserves travelled progress and already drawn geometry', () => {
  const subject = ship({ speed: 60, turnRateDeg: 120 });
  const start = subject.position;
  const firstPoints = [{ x: 100, y: 0 }, { x: 100, y: 100 }];
  subject.replaceRoute(new ShipRoute(firstPoints, start), start);
  const motor = new ShipMotor();
  for (let i = 0; i < 20; i += 1) motor.stepRoute(subject, 2, 1 / 60, false);
  const progressBefore = subject.routeProgress;
  const extendedPoints = [...firstPoints, { x: 180, y: 140 }];
  subject.replaceRoute(new ShipRoute(extendedPoints, start), start, progressBefore);
  assert.equal(subject.routeProgress, progressBefore);
  assert.deepEqual(subject.route.toSnapshot().start, start);
  assert.deepEqual(subject.route.toSnapshot().points.slice(0, firstPoints.length), firstPoints);
  assertOnCanonicalRoute(subject);
});

test('COR-12 steering never rewrites the visible raw player route', () => {
  const subject = ship({ speed: 60, turnRateDeg: 120 });
  const start = subject.position;
  const raw = [{ x: 50, y: 0 }, { x: 50, y: 100 }, { x: 120, y: 100 }];
  subject.replaceRoute(new ShipRoute(raw, start), start);
  const motor = new ShipMotor();
  for (let i = 0; i < 90; i += 1) {
    motor.stepRoute(subject, 2, 1 / 60, false);
    assertOnCanonicalRoute(subject, 1e-7);
  }
  assert.deepEqual(subject.route.toSnapshot(), { points: raw, start });
});
