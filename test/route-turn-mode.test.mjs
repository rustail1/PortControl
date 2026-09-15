import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RouteTurnMode,
  ShipModel,
} from '../src/ships/ShipModel.ts';
import { ShipCharacteristicsRegistry } from '../src/ships/ShipCharacteristics.ts';
import { ShipMotor } from '../src/ships/ShipMotor.ts';
import { ShipRoute } from '../src/ships/ShipRoute.ts';
import { ShipState } from '../src/ships/ShipState.ts';

const DT = 1 / 60;
const EPSILON = 1e-7;

function characteristics(overrides = {}) {
  return Object.freeze({
    type: 'freighter',
    speed: 68,
    turnRateDeg: 95,
    collisionRadius: 32,
    unloadStepMs: 900,
    warningRadius: 76,
    cargoCapacity: 4,
    pressureWeight: 2.8,
    spawnWeight: 10,
    defaultCargoTypes: Object.freeze(['general']),
    ...overrides,
  });
}

function makeShip(overrides = {}) {
  const stats = overrides.characteristics ?? characteristics();
  return new ShipModel({
    id: overrides.id ?? 'route-turn-mode',
    characteristics: stats,
    position: overrides.position ?? { x: 0, y: 0 },
    rotationDeg: overrides.rotationDeg ?? 0,
    state: overrides.state ?? ShipState.Navigating,
    cargo: overrides.cargo ?? { general: 1 },
    route: overrides.route,
    routeProgress: overrides.routeProgress,
    routeSpeed: overrides.routeSpeed,
    routePivotProgress: overrides.routePivotProgress,
    routeTurnMode: overrides.routeTurnMode,
  });
}

function registryFor(ship) {
  return new ShipCharacteristicsRegistry(new Map([
    [ship.characteristics.type, ship.characteristics],
  ]));
}

test('ROUTE TURN MODE exposes explicit reorientation and authored reversal values', () => {
  assert.equal(RouteTurnMode.Reorientation, 'reorientation');
  assert.equal(RouteTurnMode.AuthoredReversal, 'authored_reversal');
});

test('ROUTE TURN MODE model owns mode and pivot progress atomically and snapshot restores both', () => {
  const ship = makeShip();
  const route = new ShipRoute([{ x: 30, y: 0 }, { x: -100, y: 0 }], ship.position);
  ship.replaceRoute(route, ship.position, 30);
  ship.setPosition(route.pointAtDistance(30));

  ship.beginRouteTurn(RouteTurnMode.Reorientation, 30);
  assert.equal(ship.routePivotProgress, 30);
  assert.equal(ship.routeTurnMode, RouteTurnMode.Reorientation);
  assert.equal(ship.routeSpeed, 0);

  const snapshot = ship.toSnapshot();
  assert.equal(snapshot.routePivotProgress, 30);
  assert.equal(snapshot.routeTurnMode, RouteTurnMode.Reorientation);

  const restored = ShipModel.restore(snapshot, registryFor(ship));
  assert.equal(restored.routePivotProgress, 30);
  assert.equal(restored.routeTurnMode, RouteTurnMode.Reorientation);

  restored.finishRouteTurn();
  assert.equal(restored.routePivotProgress, null);
  assert.equal(restored.routeTurnMode, null);
});

test('ROUTE TURN MODE restore rejects pivot/mode mismatch and unknown turn modes', () => {
  const ship = makeShip();
  ship.replaceRoute(new ShipRoute([{ x: 100, y: 0 }], ship.position), ship.position);
  const base = ship.toSnapshot();
  const registry = registryFor(ship);

  assert.throws(
    () => ShipModel.restore({ ...base, routePivotProgress: 10 }, registry),
    /routeTurnMode|turn mode|pivot/i,
  );
  assert.throws(
    () => ShipModel.restore({ ...base, routeTurnMode: 'reorientation' }, registry),
    /routeTurnMode|turn mode|pivot/i,
  );
  assert.throws(
    () => ShipModel.restore({ ...base, routePivotProgress: 10, routeTurnMode: 'bad' }, registry),
    /routeTurnMode|turn mode|unknown/i,
  );
});


test('ROUTE TURN MODE reorientation at progress 0 turns in place until route enters forward half-plane', () => {
  const ship = makeShip({ rotationDeg: 0 });
  const route = new ShipRoute([{ x: -120, y: 0 }], ship.position);
  ship.replaceRoute(route, ship.position);
  const motor = new ShipMotor();

  motor.stepRoute(ship, DT, false);
  assert.equal(ship.routeTurnMode, RouteTurnMode.Reorientation);
  assert.equal(ship.routePivotProgress, 0);
  assert.equal(ship.routeProgress, 0);
  assert.equal(ship.routeSpeed, 0);
  assert.deepEqual(ship.position, { x: 0, y: 0 });

  let released = false;
  for (let frame = 0; frame < 180; frame += 1) {
    motor.stepRoute(ship, DT, false);
    if (ship.routeTurnMode === null) {
      released = true;
      break;
    }
    assert.equal(ship.routeProgress, 0, 'reorientation must not translate while route is behind the hull');
  }
  assert.equal(released, true, 'reorientation must release once heading error reaches 90 degrees or less');
  const progressAtRelease = ship.routeProgress;
  motor.stepRoute(ship, DT, false);
  assert.ok(ship.routeProgress > progressAtRelease, 'normal exact-polyline movement must resume after reorientation release');
  const expected = route.pointAtDistance(ship.routeProgress);
  assert.ok(Math.hypot(ship.x - expected.x, ship.y - expected.y) <= EPSILON);
});

test('ROUTE TURN MODE live-route reorientation at nonzero progress cannot become authored reversal', () => {
  const ship = makeShip({ rotationDeg: 0 });
  const route = new ShipRoute([{ x: 30, y: 0 }, { x: -120, y: 0 }], { x: 0, y: 0 });
  ship.replaceRoute(route, { x: 0, y: 0 }, 30);
  ship.setPosition(route.pointAtDistance(30));
  const motor = new ShipMotor();

  for (let frame = 0; frame < 8; frame += 1) {
    motor.stepRoute(ship, DT, false);
    assert.equal(ship.routeTurnMode, RouteTurnMode.Reorientation);
    assert.equal(ship.routePivotProgress, 30);
    assert.equal(ship.routeProgress, 30);
    assert.deepEqual(ship.position, route.pointAtDistance(30));
  }
});

test('ROUTE TURN MODE authored 180-degree corner stays anchored until strict reversal release', () => {
  const ship = makeShip({ rotationDeg: 0, characteristics: characteristics({ speed: 80, turnRateDeg: 120 }) });
  const route = new ShipRoute([{ x: 60, y: 0 }, { x: -60, y: 0 }], ship.position);
  ship.replaceRoute(route, ship.position);
  const motor = new ShipMotor();

  for (let frame = 0; frame < 600 && ship.routeTurnMode === null; frame += 1) {
    motor.stepRoute(ship, DT, false);
  }
  assert.equal(ship.routeTurnMode, RouteTurnMode.AuthoredReversal);
  assert.equal(ship.routePivotProgress, 60);
  assert.equal(ship.routeProgress, 60);
  assert.deepEqual(ship.position, { x: 60, y: 0 });

  for (let frame = 0; frame < 10; frame += 1) {
    motor.stepRoute(ship, DT, false);
    assert.equal(ship.routeProgress, 60);
    assert.deepEqual(ship.position, { x: 60, y: 0 });
    assert.equal(ship.routeSpeed, 0);
  }
});

test('ROUTE TURN MODE ordinary 90-degree authored corner never becomes authored reversal', () => {
  const ship = makeShip({ rotationDeg: 0, characteristics: characteristics({ speed: 80, turnRateDeg: 120 }) });
  const route = new ShipRoute([{ x: 60, y: 0 }, { x: 60, y: 80 }], ship.position);
  ship.replaceRoute(route, ship.position);
  const motor = new ShipMotor();
  let sawAuthoredReversal = false;

  for (let frame = 0; frame < 600 && ship.routeProgress < route.totalLength; frame += 1) {
    motor.stepRoute(ship, DT, false);
    if (ship.routeTurnMode === RouteTurnMode.AuthoredReversal) sawAuthoredReversal = true;
    const expected = route.pointAtDistance(ship.routeProgress);
    assert.ok(Math.hypot(ship.x - expected.x, ship.y - expected.y) <= EPSILON);
  }
  assert.equal(sawAuthoredReversal, false);
  assert.equal(ship.routeProgress, route.totalLength);
});

test('ROUTE TURN MODE all four ship types reorient in place then resume on exact authored polyline', () => {
  const variants = [
    ['speedboat', 150, 220],
    ['cargo_boat', 105, 155],
    ['freighter', 68, 95],
    ['tanker', 78, 85],
  ];

  for (const [type, speed, turnRateDeg] of variants) {
    const ship = makeShip({
      id: `matrix-${type}`,
      rotationDeg: 0,
      characteristics: characteristics({ type, speed, turnRateDeg }),
    });
    const route = new ShipRoute([{ x: -180, y: 0 }], ship.position);
    ship.replaceRoute(route, ship.position);
    const motor = new ShipMotor();

    motor.stepRoute(ship, DT, false);
    assert.equal(ship.routeTurnMode, RouteTurnMode.Reorientation, `${type}: must enter reorientation`);
    assert.equal(ship.routeProgress, 0, `${type}: must not move backward during reorientation`);

    for (let frame = 0; frame < 300 && ship.routeTurnMode !== null; frame += 1) {
      motor.stepRoute(ship, DT, false);
      assert.equal(ship.routeProgress, 0, `${type}: route progress changed before reorientation release`);
      const expected = route.pointAtDistance(ship.routeProgress);
      assert.ok(Math.hypot(ship.x - expected.x, ship.y - expected.y) <= EPSILON, `${type}: left authored route during turn`);
    }
    assert.equal(ship.routeTurnMode, null, `${type}: did not release reorientation`);

    motor.stepRoute(ship, DT, false);
    assert.ok(ship.routeProgress > 0, `${type}: did not resume movement after release`);
    const expected = route.pointAtDistance(ship.routeProgress);
    assert.ok(Math.hypot(ship.x - expected.x, ship.y - expected.y) <= EPSILON, `${type}: resumed off authored route`);
  }
});
