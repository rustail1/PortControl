import assert from 'node:assert/strict';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

async function setup(type = 'freighter') {
  const [ships, routes, config] = await Promise.all([
    import('../src/ships/index.ts'),
    import('../src/routes/index.ts'),
    import('../src/config/validateConfigSource.ts'),
  ]);
  const bundle = config.validateConfigSource(readBaselineSource());
  const registry = ships.createShipCharacteristicsRegistry(bundle);
  const ship = new ships.ShipModel({
    id: type,
    characteristics: registry.require(type),
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    state: ships.ShipState.Navigating,
    cargo: { general: 1 },
  });
  const service = new routes.RouteCommitService({
    navigation: new routes.NavigationValidator([]),
    config: routes.createRouteProcessingConfig(bundle),
  });
  return { ship, service };
}

test('COR-12 canonical route locally rounds a drawn 90 degree corner without overshoot', async () => {
  const { ship, service } = await setup();
  const start = { x: 0, y: 0 };
  const endpoint = { x: 100, y: 140 };

  assert.equal(service.commit({
    ship,
    draft: {
      shipId: ship.id,
      start,
      points: [{ x: 100, y: 0 }, endpoint],
    },
  }).kind, 'committed');

  const route = ship.route.toSnapshot();
  assert.deepEqual(route.start, start);
  assert.deepEqual(route.points.at(-1), endpoint, 'canonical route must preserve authored endpoint');
  assert.ok(route.points.length > 2, '90 degree corner must expand into local canonical curve samples');
  assert.ok(!route.points.some(point => point.x === 100 && point.y === 0),
    'raw square vertex must not remain as a hard corner in canonical geometry');
  assert.ok(route.points.some(point => point.x < 100 && point.y > 0),
    'rounded corner must contain an interior transition sample');
  assert.ok(route.points.every(point =>
    point.x >= -1e-9 && point.x <= 100 + 1e-9 &&
    point.y >= -1e-9 && point.y <= 140 + 1e-9),
  'local smoothing must stay inside the authored corner bounds instead of globally overshooting');
});

test('COR-12 near reverse draw becomes a compact deterministic turnaround instead of a raw cusp', async () => {
  const { ship, service } = await setup('speedboat');
  const start = { x: 0, y: 0 };
  const endpoint = { x: 0, y: 0 };

  assert.equal(service.commit({
    ship,
    draft: {
      shipId: ship.id,
      start,
      points: [{ x: 100, y: 0 }, endpoint],
    },
  }).kind, 'committed');

  const route = ship.route.toSnapshot();
  assert.deepEqual(route.start, start);
  assert.deepEqual(route.points.at(-1), endpoint, 'turnaround must preserve authored endpoint');
  assert.ok(route.points.length > 2, 'turnaround must have explicit canonical geometry');
  assert.ok(route.points.some(point => Math.abs(point.y) > 1),
    'exact reverse must use a compact hairpin instead of retracing one raw line through a cusp');
  assert.ok(route.points.every(point =>
    point.x >= -1e-9 && point.x <= 110 && Math.abs(point.y) <= 40),
  'turnaround must remain compact and local to the authored reverse');
});
