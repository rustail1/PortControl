import assert from 'node:assert/strict';
import test from 'node:test';

import { ShipModel } from '../src/ships/ShipModel.ts';
import { ShipMotor } from '../src/ships/ShipMotor.ts';
import { ShipRoute } from '../src/ships/ShipRoute.ts';
import { ShipState } from '../src/ships/ShipState.ts';

const DT = 1 / 60;

const characteristics = Object.freeze({
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

function makeShip() {
  return new ShipModel({
    id: 'route-end-continuation',
    characteristics,
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    state: ShipState.Navigating,
    cargo: { general: 1 },
  });
}

test('Navigating continues forward after consuming the authored route instead of stopping', () => {
  const ship = makeShip();
  const motor = new ShipMotor();
  ship.replaceRoute(new ShipRoute([{ x: 40, y: 0 }], ship.position), ship.position);

  for (let frame = 0; frame < 600 && ship.routeProgress < ship.route.totalLength; frame += 1) {
    motor.stepRoute(ship, DT);
  }

  assert.equal(ship.routeProgress, ship.route.totalLength, 'precondition: authored line must be fully consumed');
  const end = ship.position;
  const speedAtEnd = ship.routeSpeed;

  motor.stepRoute(ship, 0.5);

  assert.ok(ship.x > end.x + 1, `ship should continue beyond route end, got x=${ship.x} from end=${end.x}`);
  assert.ok(Math.abs(ship.y - end.y) < 1e-9, 'continuation should preserve the last authored heading');
  assert.ok(ship.routeSpeed >= speedAtEnd, 'continuation must not create a speed drop at route exhaustion');
  assert.ok(ship.routeSpeed <= ship.characteristics.speed, 'continuation must remain bounded by cruise speed');
});


test('route-end continuation accelerates from current physical speed without snapping to cruise', () => {
  const ship = makeShip();
  const motor = new ShipMotor();
  ship.setRouteSpeed(10);
  ship.replaceRoute(new ShipRoute([{ x: 2, y: 0 }], ship.position), ship.position);

  for (let frame = 0; frame < 600 && ship.routeProgress < ship.route.totalLength; frame += 1) {
    motor.stepRoute(ship, DT);
  }

  const speedAtEnd = ship.routeSpeed;
  assert.ok(speedAtEnd > 0 && speedAtEnd < ship.characteristics.speed,
    `precondition: end speed should remain sub-cruise, got ${speedAtEnd}`);
  const end = ship.position;

  motor.stepRoute(ship, DT);

  assert.ok(ship.x > end.x, 'ship should continue immediately beyond the consumed route');
  assert.ok(ship.routeSpeed > speedAtEnd, 'ship should continue accelerating toward cruise');
  assert.ok(ship.routeSpeed < ship.characteristics.speed, 'one tick must not snap sub-cruise speed to full cruise');
});

test('active live draft can still hold at its temporary endpoint when continuation is disabled', () => {
  const ship = makeShip();
  const motor = new ShipMotor();
  ship.replaceRoute(new ShipRoute([{ x: 20, y: 0 }], ship.position), ship.position);

  for (let frame = 0; frame < 600 && ship.routeProgress < ship.route.totalLength; frame += 1) {
    motor.stepRoute(ship, DT, false);
  }
  const end = ship.position;

  motor.stepRoute(ship, 0.5, false);

  assert.deepEqual(ship.position, end);
});
