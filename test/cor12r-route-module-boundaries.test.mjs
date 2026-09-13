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

test('COR-12R canonicalizer preserves straight authored anchors used by safe-prefix validation', async () => {
  const { routes, routeConfig } = await setup();
  const canonicalizer = new routes.RouteCanonicalizer(routeConfig);
  const authored = [{ x: 20, y: 0 }, { x: 100, y: 0 }];

  assert.deepEqual(
    canonicalizer.canonicalize({ x: 0, y: 0 }, authored),
    authored,
    'canonicalization must preserve authored validation anchors',
  );
});

test('COR-12R RouteCommitService validates the exact canonical authored geometry', async () => {
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
  assert.deepEqual(receivedByValidator, [{ x: 100, y: 0 }, endpoint],
    'validator must receive the exact authored corner without smoothing or expansion');
  assert.deepEqual(ship.route.toSnapshot().points, receivedByValidator,
    'committed ShipRoute must reuse the exact geometry that was validated');
});

test('COR-12R departure commit trims gesture samples that lie before the guided release start', async () => {
  const { routes, ships, ship, routeConfig } = await setup();
  ship.setState(ships.ShipState.ReadyToLeave);
  ship.setPositionXY(0, 0);
  const routeStart = { x: 0, y: 58 };
  const service = new routes.RouteCommitService({
    navigation: new routes.NavigationValidator([]),
    config: routeConfig,
  });

  const result = service.commit({
    ship,
    routeStart,
    draft: {
      shipId: ship.id,
      start: { x: 0, y: 0 },
      points: [
        { x: 0, y: 15 },
        { x: 0, y: 30 },
        { x: 0, y: 45 },
        { x: 0, y: 60 },
      ],
    },
  });

  assert.equal(result.kind, 'committed');
  assert.deepEqual(ship.route.toSnapshot().start, routeStart);
  assert.ok(
    ship.route.toSnapshot().points.every((point) => point.y >= routeStart.y - 1e-6),
    `guided release must not route backward through dock gesture prefix: ${JSON.stringify(ship.route.toSnapshot())}`,
  );
  assert.deepEqual(ship.route.toSnapshot().points.at(-1), { x: 0, y: 60 });
});

test('COR-12R exposes a dedicated RouteCanonicalizer module', async () => {
  const { routes } = await setup();
  assert.equal(typeof routes.RouteCanonicalizer, 'function');
});
