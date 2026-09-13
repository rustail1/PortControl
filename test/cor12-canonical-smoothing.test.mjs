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
  return { routes, ship, service };
}

test('COR-12 canonical route preserves an authored 90 degree corner exactly', async () => {
  const { ship, service } = await setup();
  const start = { x: 0, y: 0 };
  const corner = { x: 100, y: 0 };
  const endpoint = { x: 100, y: 140 };

  assert.equal(service.commit({
    ship,
    draft: {
      shipId: ship.id,
      start,
      points: [corner, endpoint],
    },
  }).kind, 'committed');

  const route = ship.route.toSnapshot();
  assert.deepEqual(route.start, start);
  assert.deepEqual(route.points, [corner, endpoint],
    'commit must not round, replace or insert geometry around an authored corner');
});

test('COR-12 exact reverse draw remains the exact authored out-and-back polyline', async () => {
  const { ship, service } = await setup('speedboat');
  const start = { x: 0, y: 0 };
  const turn = { x: 100, y: 0 };
  const endpoint = { x: 0, y: 0 };

  assert.equal(service.commit({
    ship,
    draft: {
      shipId: ship.id,
      start,
      points: [turn, endpoint],
    },
  }).kind, 'committed');

  const route = ship.route.toSnapshot();
  assert.deepEqual(route.start, start);
  assert.deepEqual(route.points, [turn, endpoint],
    'reverse input must not be replaced by a generated hairpin');
});

test('COR-12 canonicalization removes only consecutive zero-length samples', async () => {
  const { routes } = await setup();
  const start = { x: 0, y: 0 };
  const authored = [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 0 },
    { x: 60, y: 20 },
    { x: 30, y: 0 },
  ];

  assert.deepEqual(routes.canonicalizeRoute(start, authored), [
    { x: 30, y: 0 },
    { x: 60, y: 20 },
    { x: 30, y: 0 },
  ]);
});
