import assert from 'node:assert/strict';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

async function setup() {
  const [ships, routes, config] = await Promise.all([
    import('../src/ships/index.ts'),
    import('../src/routes/index.ts'),
    import('../src/config/validateConfigSource.ts'),
  ]);
  const bundle = config.validateConfigSource(readBaselineSource());
  const registry = ships.createShipCharacteristicsRegistry(bundle);
  const ship = new ships.ShipModel({
    id: 'cor12r-boundary',
    characteristics: registry.require('freighter'),
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    state: ships.ShipState.Navigating,
    cargo: { general: 1 },
  });
  return {
    ships,
    routes,
    ship,
    routeConfig: routes.createRouteProcessingConfig(bundle),
  };
}

test('COR-12R NavigationValidator validates supplied geometry without rewriting it', async () => {
  const { routes, ship, routeConfig } = await setup();
  const supplied = Object.freeze([
    Object.freeze({ x: 20, y: 0 }),
    Object.freeze({ x: 40, y: 0 }),
  ]);

  const result = new routes.NavigationValidator([]).validate(
    ship,
    supplied,
    routeConfig,
    { x: 0, y: 0 },
  );

  assert.deepEqual(result.validPoints, supplied);
  assert.deepEqual(result.rejectedPoints, []);
});

test('COR-12R RouteCommitService canonicalizes once before validation', async () => {
  const { routes, ship, routeConfig } = await setup();
  let receivedByValidator = null;
  const navigation = {
    validate(_ship, points) {
      receivedByValidator = points.map((point) => ({ ...point }));
      return {
        validPoints: Object.freeze(points.map((point) => Object.freeze({ ...point }))),
        rejectedPoints: Object.freeze([]),
      };
    },
  };
  const service = new routes.RouteCommitService({ navigation, config: routeConfig });
  const endpoint = { x: 100, y: 140 };

  assert.equal(service.commit({
    ship,
    draft: {
      shipId: ship.id,
      start: { x: 0, y: 0 },
      points: [{ x: 100, y: 0 }, endpoint],
    },
  }).kind, 'committed');

  assert.ok(Array.isArray(receivedByValidator));
  assert.ok(receivedByValidator.length > 2,
    'validator must receive expanded canonical geometry, not the raw two-point bend');
  assert.ok(!receivedByValidator.some((point) => point.x === 100 && point.y === 0),
    'raw square corner must be removed before validation');
  assert.deepEqual(receivedByValidator.at(-1), endpoint);
  assert.deepEqual(ship.route.toSnapshot().points, receivedByValidator,
    'committed ShipRoute must reuse the exact geometry that was validated');
});

test('COR-12R exposes a dedicated RouteCanonicalizer module', async () => {
  const { routes } = await setup();
  assert.equal(typeof routes.RouteCanonicalizer, 'function');
});
