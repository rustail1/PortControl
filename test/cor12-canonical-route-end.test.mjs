import assert from 'node:assert/strict';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

test('COR-12 canonical navigating route holds at its authored end instead of drifting off-line', async () => {
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
    motor.stepRoute(ship, 8, 1 / 60);
  }
  assert.equal(ship.routeProgress, ship.route.totalLength);
  const endpoint = ship.position;

  motor.stepRoute(ship, 8, 0.5);

  assert.deepEqual(ship.position, endpoint);
  assert.deepEqual(ship.position, { x: 20, y: 0 });
});
