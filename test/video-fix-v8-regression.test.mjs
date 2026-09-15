import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDevelopmentLevelId } from '../src/scenes/HarborLevelSelection.ts';
import { RouteTurnMode, ShipModel } from '../src/ships/ShipModel.ts';
import { ShipMotor } from '../src/ships/ShipMotor.ts';
import { ShipRoute } from '../src/ships/ShipRoute.ts';
import { ShipState } from '../src/ships/ShipState.ts';

function characteristics() {
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
  });
}

function makeShip() {
  return new ShipModel({
    id: 'video-fix-v8',
    characteristics: characteristics(),
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    state: ShipState.Navigating,
    cargo: { general: 1 },
  });
}

test('VIDEO FIX v8 initial 180-degree committed route turns in place before exact authored movement', () => {
  const ship = makeShip();
  const route = new ShipRoute([{ x: -120, y: 0 }], ship.position);
  ship.replaceRoute(route, ship.position);
  const motor = new ShipMotor();

  motor.stepRoute(ship, 1 / 60, false);

  assert.equal(ship.routePivotProgress, 0, 'large initial heading mismatch should surface as TURN');
  assert.equal(ship.routeTurnMode, RouteTurnMode.Reorientation);
  assert.equal(ship.routeProgress, 0, 'route behind the hull must not force backward route translation');
  assert.equal(ship.routeSpeed, 0, 'reorientation must be stationary until the route enters the forward half-plane');
  assert.deepEqual(ship.position, { x: 0, y: 0 });
  const turnedDeg = Math.abs(((ship.rotationDeg - 0 + 540) % 360) - 180);
  assert.ok(turnedDeg > 0, 'hull must turn toward the committed route');
  assert.ok(turnedDeg <= ship.characteristics.turnRateDeg / 60 + 1e-7, 'TURN must remain turn-rate limited');
});

test('VIDEO FIX v8 no-query launch defaults to level 1 while explicit level overrides remain available', () => {
  const levels = Object.freeze({ calm_01: {}, calm_07: {} });

  assert.equal(resolveDevelopmentLevelId('', levels), 'calm_01');
  assert.equal(resolveDevelopmentLevelId('?level=missing', levels), 'calm_01');
  assert.equal(resolveDevelopmentLevelId('?level=calm_07', levels), 'calm_07');
});

test('VIDEO FIX v8 live-route reorientation at nonzero progress stays explicit and stationary until release', () => {
  const ship = makeShip();
  const route = new ShipRoute([
    { x: 30, y: 0 },
    { x: -120, y: 0 },
  ], { x: 0, y: 0 });
  ship.replaceRoute(route, { x: 0, y: 0 }, 30);
  ship.setPosition(route.pointAtDistance(30));
  const motor = new ShipMotor();

  motor.stepRoute(ship, 1 / 60, false);
  assert.equal(ship.routeTurnMode, RouteTurnMode.Reorientation);
  assert.equal(ship.routePivotProgress, 30, 'TURN marker must retain the reorientation origin');
  assert.equal(ship.routeProgress, 30);
  assert.equal(ship.routeSpeed, 0);

  motor.stepRoute(ship, 1 / 60, false);
  assert.equal(ship.routeTurnMode, RouteTurnMode.Reorientation, 'progress equality must not reclassify this TURN as an authored corner');
  assert.equal(ship.routeProgress, 30);
  assert.deepEqual(ship.position, route.pointAtDistance(30));
});

