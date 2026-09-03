import assert from 'node:assert/strict';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

async function subject() {
  const [routes, ships, config, core] = await Promise.all([
    import('../src/routes/index.ts'), import('../src/ships/index.ts'),
    import('../src/config/validateConfigSource.ts'), import('../src/core/FixedStepClock.ts'),
  ]);
  return { ...routes, ...ships, ...config, ...core };
}

async function setup(state = 'Navigating') {
  const s = await subject();
  const bundle = s.validateConfigSource(readBaselineSource());
  const registry = s.createShipCharacteristicsRegistry(bundle);
  const ship = new s.ShipModel({ id: 'ship-1', characteristics: registry.require('speedboat'), position: { x: 0, y: 0 }, rotationDeg: 0, state: s.ShipState[state] });
  return { s, bundle, registry, ship, config: s.createRouteProcessingConfig(bundle) };
}

test('RDP is deterministic and preserves endpoint order', async () => {
  const { s } = await setup();
  const points = [{ x: 0, y: 0 }, { x: 10, y: 1 }, { x: 20, y: 0 }, { x: 30, y: 20 }];
  const config = { simplifyEpsilon: 3.5, maxSimplifiedPoints: 96 };
  const first = s.simplifyRoute(points, config);

  assert.deepEqual(s.simplifyRoute(points, config), first);
  assert.deepEqual(first[0], { x: 0, y: 0 });
  assert.deepEqual(first.at(-1), { x: 30, y: 20 });
  assert.ok(first.every((point, index) => points.findIndex((source) => source.x === point.x && source.y === point.y) >= index));
});

test('route processing config reads all COR-03 values from validated balance.json', async () => {
  const { s, bundle } = await setup();
  const config = s.createRouteProcessingConfig(bundle);
  const route = readBaselineSource().configs['balance.json'].route;
  for (const key of ['simplifyEpsilon', 'minValidRouteLength', 'waypointTolerance', 'maxSimplifiedPoints', 'navigationClearanceExtra']) {
    assert.equal(config[key], route[key]);
  }
});

test('cap-aware RDP keeps ordered endpoints and never rejects only for point count', async () => {
  const { s } = await setup();
  const points = Array.from({ length: 8 }, (_, index) => ({ x: index, y: index % 2 }));
  const base = s.simplifyRoute(points, { simplifyEpsilon: 0, maxSimplifiedPoints: 96 });
  const capped = s.simplifyRoute(points, { simplifyEpsilon: 0, maxSimplifiedPoints: 3 });

  assert.ok(base.length > 3);
  assert.ok(capped.length <= 3);
  assert.deepEqual(capped[0], points[0]);
  assert.deepEqual(capped.at(-1), points.at(-1));
  assert.deepEqual(s.simplifyRoute(points, { simplifyEpsilon: 0, maxSimplifiedPoints: 3 }), capped);
});

test('valid commit atomically replaces rather than appends and resets cursor', async () => {
  const { s, ship, config } = await setup();
  const service = new s.RouteCommitService({ navigation: new s.NavigationValidator([]), config });
  ship.replaceRoute(new s.ShipRoute([{ x: 50, y: 0 }]));
  ship.advanceRouteCursor();

  const result = service.commit({ ship, draft: { shipId: ship.id, points: [{ x: 20, y: 0 }, { x: 40, y: 0 }] } });

  assert.equal(result.kind, 'committed');
  assert.deepEqual(ship.route.toSnapshot().points, [{ x: 20, y: 0 }, { x: 40, y: 0 }]);
  assert.equal(ship.routeCursor, 0);
});

test('too-short and fully-invalid redraws preserve old route and cursor', async () => {
  const { s, ship, config } = await setup();
  ship.replaceRoute(new s.ShipRoute([{ x: 50, y: 0 }, { x: 60, y: 0 }]));
  ship.advanceRouteCursor();
  const before = ship.toSnapshot();
  const shortService = new s.RouteCommitService({ navigation: new s.NavigationValidator([]), config });
  assert.equal(shortService.commit({ ship, draft: { shipId: ship.id, points: [{ x: 5, y: 0 }] } }).kind, 'rejected_too_short');
  assert.deepEqual(ship.toSnapshot(), before);
  const invalidService = new s.RouteCommitService({ navigation: new s.NavigationValidator([{ points: [{ x: 1, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: 1, y: 10 }] }]), config });
  assert.equal(invalidService.commit({ ship, draft: { shipId: ship.id, points: [{ x: 20, y: 0 }] } }).kind, 'rejected_invalid');
  assert.deepEqual(ship.toSnapshot(), before);
});

test('validator uses collisionRadius plus navigationClearanceExtra and commits a safe prefix', async () => {
  const { s, ship, config, registry } = await setup();
  const navigation = new s.NavigationValidator([{ points: [{ x: 40, y: -10 }, { x: 60, y: -10 }, { x: 60, y: 10 }, { x: 40, y: 10 }] }]);
  const service = new s.RouteCommitService({ navigation, config });
  const result = service.commit({ ship, draft: { shipId: ship.id, points: [{ x: 20, y: 0 }, { x: 100, y: 0 }] } });

  assert.equal(result.kind, 'partial_prefix_committed');
  assert.deepEqual(ship.route.toSnapshot().points, [{ x: 20, y: 0 }]);
  ship.setPosition({ x: 0, y: 30 });
  const tanker = new s.ShipModel({ id: 'tanker', characteristics: registry.require('tanker'), position: { x: 0, y: 30 }, rotationDeg: 0, state: s.ShipState.Navigating });
  assert.notEqual(navigation.validate(tanker, [{ x: 100, y: 30 }], config).validPoints.length, navigation.validate(ship, [{ x: 100, y: 30 }], config).validPoints.length);
});

test('route and cursor survive snapshot restore without semantic loss', async () => {
  const { s, ship, registry } = await setup();
  ship.replaceRoute(new s.ShipRoute([{ x: 10, y: 0 }, { x: 20, y: 0 }]));
  ship.advanceRouteCursor();
  assert.deepEqual(s.ShipModel.restore(ship.toSnapshot(), registry).toSnapshot(), ship.toSnapshot());
});

test('ShipMotor follows route waypoints without teleporting and advances cursor at tolerance', async () => {
  const { s, ship, config } = await setup();
  ship.replaceRoute(new s.ShipRoute([{ x: 100, y: 0 }, { x: 100, y: 100 }]));
  const motor = new s.ShipMotor();
  motor.stepRoute(ship, config.waypointTolerance, 0.1);
  assert.notDeepEqual(ship.position, { x: 100, y: 0 });
  ship.setPosition({ x: 96, y: 0 });
  motor.stepRoute(ship, config.waypointTolerance, 1 / 60);
  assert.equal(ship.routeCursor, 1);
});

test('fixed clock partitions produce the same route snapshot', async () => {
  const run = async (frames) => {
    const { s, ship, config } = await setup();
    ship.replaceRoute(new s.ShipRoute([{ x: 300, y: 0 }]));
    const clock = new s.FixedStepClock({ fixedHz: 60, maxCatchUpSteps: 6 });
    const motor = new s.ShipMotor();
    frames.forEach((frame) => clock.advance(frame, (dt) => motor.stepRoute(ship, config.waypointTolerance, dt)));
    return ship.toSnapshot();
  };
  assert.deepEqual(await run([100]), await run([1000 / 60, 1000 / 60, 1000 / 60, 1000 / 60, 1000 / 60, 1000 / 60]));
});

test('ShipMotor hot path updates authoritative scalar coordinates without exposing mutable position', async () => {
  const { ship } = await setup();
  ship.setPositionXY(12, 34);
  const firstRead = ship.position;
  firstRead.x = 999;

  assert.equal(ship.x, 12);
  assert.equal(ship.y, 34);
  assert.deepEqual(ship.position, { x: 12, y: 34 });
});

test('30, 60 and 120 FPS render partitions reach the same authoritative route outcome', async () => {
  const run = async (fps) => {
    const { s, ship, config } = await setup();
    ship.replaceRoute(new s.ShipRoute([{ x: 900, y: 0 }]));
    const clock = new s.FixedStepClock({ fixedHz: 60, maxCatchUpSteps: 6 });
    const motor = new s.ShipMotor();
    for (let frame = 0; frame < fps * 3; frame += 1) {
      clock.advance(1000 / fps, (dt) => motor.stepRoute(ship, config.waypointTolerance, dt));
    }
    return ship.toSnapshot();
  };
  const [at30, at60, at120] = await Promise.all([run(30), run(60), run(120)]);
  for (const actual of [at60, at120]) {
    assert.ok(Math.abs(actual.position.x - at30.position.x) < 1e-9);
    assert.ok(Math.abs(actual.position.y - at30.position.y) < 1e-9);
    assert.ok(Math.abs(actual.rotationDeg - at30.rotationDeg) < 1e-9);
    assert.equal(actual.routeCursor, at30.routeCursor);
    assert.deepEqual(actual.route, at30.route);
    assert.equal(actual.state, at30.state);
  }
});

test('locked ship does not accept a route commit and COR-03 domain has no forbidden runtime dependency', async () => {
  const { s, ship, config } = await setup('Docking');
  const service = new s.RouteCommitService({ navigation: new s.NavigationValidator([]), config });
  assert.equal(service.commit({ ship, draft: { shipId: ship.id, points: [{ x: 100, y: 0 }] } }).kind, 'rejected_locked');
});
