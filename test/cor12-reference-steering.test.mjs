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

function stepHeading(before, after) {
  return Math.atan2(after.y - before.y, after.x - before.x) * 180 / Math.PI;
}

test('COR-12 reference steering limits a 90 degree turn to turnRateDeg * dt', () => {
  const subject = ship();
  subject.replaceRoute(new ShipRoute([{ x: 0, y: 100 }], subject.position));
  new ShipMotor().stepRoute(subject, 2, 1 / 60, false);
  assert.ok(subject.rotationDeg > 0);
  assert.ok(angleDelta(0, subject.rotationDeg) <= subject.characteristics.turnRateDeg / 60 + 1e-9,
    `rotation snapped to ${subject.rotationDeg}`);
});

test('COR-12 reference steering moves only along the resulting hull heading', () => {
  const subject = ship();
  subject.replaceRoute(new ShipRoute([{ x: 0, y: 100 }], subject.position));
  const before = subject.position;
  new ShipMotor().stepRoute(subject, 2, 1 / 60, false);
  assert.ok(angleDelta(subject.rotationDeg, stepHeading(before, subject.position)) < 1e-9);
});

test('COR-12 reference steering does not reverse toward a target directly behind', () => {
  const subject = ship();
  subject.replaceRoute(new ShipRoute([{ x: -100, y: 0 }], subject.position));
  const before = subject.position;
  new ShipMotor().stepRoute(subject, 2, 1 / 60, false);
  assert.ok(subject.x > before.x, `ship moved backward from ${before.x} to ${subject.x}`);
});

test('COR-12 missed waypoint advances by projection instead of circling back to it', () => {
  const subject = ship({ speed: 120, turnRateDeg: 90, position: { x: 20, y: 0 } });
  subject.replaceRoute(new ShipRoute([{ x: 10, y: 0 }, { x: 10, y: 120 }], { x: 0, y: 0 }), { x: 0, y: 0 });
  const motor = new ShipMotor();
  let previousProgress = subject.routeProgress;
  for (let i = 0; i < 600 && subject.routeProgress < subject.route.totalLength; i += 1) {
    motor.stepRoute(subject, 2, 1 / 60, false);
    assert.ok(subject.routeProgress >= previousProgress);
    previousProgress = subject.routeProgress;
  }
  assert.equal(subject.routeProgress, subject.route.totalLength,
    `missed corner caused endless recovery at progress ${subject.routeProgress}`);
});

test('COR-12 existing speedboat and heavy characteristics create distinct speed and turn feel', () => {
  const speedboat = ship({ id: 'speedboat', speed: 150, turnRateDeg: 220 });
  const freighter = ship({ id: 'freighter', speed: 68, turnRateDeg: 95 });
  for (const subject of [speedboat, freighter]) subject.replaceRoute(new ShipRoute([{ x: 0, y: 500 }], subject.position));
  const motor = new ShipMotor();
  const speedboatBefore = speedboat.position;
  const freighterBefore = freighter.position;
  motor.stepRoute(speedboat, 2, 1 / 60, false);
  motor.stepRoute(freighter, 2, 1 / 60, false);
  assert.ok(Math.hypot(speedboat.x - speedboatBefore.x, speedboat.y - speedboatBefore.y) >
    Math.hypot(freighter.x - freighterBefore.x, freighter.y - freighterBefore.y));
  assert.ok(angleDelta(0, speedboat.rotationDeg) > angleDelta(0, freighter.rotationDeg));
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
});

test('COR-12 steering never rewrites the visible raw player route', () => {
  const subject = ship({ speed: 60, turnRateDeg: 120 });
  const start = subject.position;
  const raw = [{ x: 50, y: 0 }, { x: 50, y: 100 }, { x: 120, y: 100 }];
  subject.replaceRoute(new ShipRoute(raw, start), start);
  const motor = new ShipMotor();
  for (let i = 0; i < 90; i += 1) motor.stepRoute(subject, 2, 1 / 60, false);
  assert.deepEqual(subject.route.toSnapshot(), { points: raw, start });
});
