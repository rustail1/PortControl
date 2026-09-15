import assert from 'node:assert/strict';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

test('COR-12 canonical navigating route continues forward after its authored end', async () => {
  const [ships, config] = await Promise.all([
    import('../src/ships/index.ts'),
    import('../src/config/validateConfigSource.ts'),
  ]);
  const bundle = config.validateConfigSource(readBaselineSource());
  const registry = ships.createShipCharacteristicsRegistry(bundle);
  const ship = new ships.ShipModel({
    id: 'canonical-route-end',
    characteristics: registry.require('speedboat'),
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    state: ships.ShipState.Navigating,
  });
  ship.replaceRoute(new ships.ShipRoute([{ x: 20, y: 0 }]));
  const motor = new ships.ShipMotor();

  for (let step = 0; step < 120 && ship.routeProgress < ship.route.totalLength; step += 1) {
    motor.stepRoute(ship, 1 / 60);
  }
  assert.equal(ship.routeProgress, ship.route.totalLength);
  const endpoint = ship.position;
  const speedAtEnd = ship.routeSpeed;

  motor.stepRoute(ship, 0.5);

  assert.ok(ship.x > endpoint.x, 'navigating ship should continue beyond the consumed line');
  assert.ok(Math.abs(ship.y - endpoint.y) < 1e-9);
  assert.ok(ship.routeSpeed >= speedAtEnd, 'route exhaustion must not create a speed drop');
});
