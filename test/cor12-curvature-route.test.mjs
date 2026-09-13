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
  return {
    ships,
    routes,
    ship,
    registry,
    routeConfig: routes.createRouteProcessingConfig(bundle),
  };
}

function angleDelta(left, right) {
  return Math.abs(((right - left + 540) % 360) - 180);
}

function commit(subject, ship, points, start = ship.position) {
  return new subject.routes.RouteCommitService({
    navigation: new subject.routes.NavigationValidator([]),
    config: subject.routeConfig,
  }).commit({ ship, draft: { shipId: ship.id, points }, routeStart: start });
}

function assertOnRoute(ship, epsilon = 1e-6) {
  const expected = ship.route.pointAtDistance(ship.routeProgress);
  assert.ok(Math.hypot(ship.x - expected.x, ship.y - expected.y) <= epsilon,
    `left canonical route: actual=${ship.x},${ship.y} expected=${expected.x},${expected.y}`);
}

function runRoute(ships, ship, maximumSteps = 1200) {
  const motor = new ships.ShipMotor();
  const samples = [];
  for (let step = 0; step < maximumSteps && ship.routeProgress < ship.route.totalLength; step += 1) {
    const progressBefore = ship.routeProgress;
    const rotationBefore = ship.rotationDeg;
    motor.stepRoute(ship, 8, 1 / 60);
    assert.ok(ship.routeProgress >= progressBefore);
    assert.ok(ship.routeProgress - progressBefore <= ship.characteristics.speed / 60 + 1e-9);
    assert.ok(angleDelta(rotationBefore, ship.rotationDeg) <= ship.characteristics.turnRateDeg / 60 + 1e-9);
    assertOnRoute(ship);
    if (ship.routeProgress > progressBefore) {
      samples.push({ position: ship.position, heading: ship.rotationDeg });
    }
  }
  return samples;
}

test('COR-12 path follower keeps centre canonical and hull turn-rate limited through a sharp turn', async () => {
  const { ships, ship } = await setup();
  ship.replaceRoute(new ships.ShipRoute([
    { x: 50, y: 0 },
    { x: 50, y: 100 },
  ]));
  const motor = new ships.ShipMotor();

  for (let step = 0; step < 300 && ship.routeProgress < ship.route.totalLength; step += 1) {
    const beforeRotation = ship.rotationDeg;
    motor.stepRoute(ship, 8, 1 / 60);
    assertOnRoute(ship);
    assert.ok(angleDelta(beforeRotation, ship.rotationDeg) <= ship.characteristics.turnRateDeg / 60 + 1e-9,
      `rotation snapped at step ${step}`);
  }
});

test('COR-12 opposite heading turns before advancing and never leaves the route', async () => {
  const { ships, ship } = await setup('freighter');
  ship.setRotationDeg(180);
  ship.replaceRoute(new ships.ShipRoute([{ x: 100, y: 0 }]));
  const before = ship.position;

  new ships.ShipMotor().stepRoute(ship, 8, 1 / 60);

  assertOnRoute(ship);
  assert.ok(Math.hypot(ship.x - before.x, ship.y - before.y) < 1e-9);
  assert.ok(angleDelta(180, ship.rotationDeg) <= ship.characteristics.turnRateDeg / 60 + 1e-9);
});

test('COR-12 sharp route movement stays on the drawn polyline without progress jumps', async () => {
  const { ships, ship } = await setup('freighter');
  ship.replaceRoute(new ships.ShipRoute([
    { x: 30, y: 0 },
    { x: 30, y: 80 },
  ]));
  const motor = new ships.ShipMotor();

  for (let step = 0; step < 600 && ship.routeProgress < ship.route.totalLength; step += 1) {
    const progressBefore = ship.routeProgress;
    motor.stepRoute(ship, 8, 1 / 60);
    assertOnRoute(ship);
    assert.ok(ship.routeProgress >= progressBefore);
    assert.ok(ship.routeProgress - progressBefore <= ship.characteristics.speed / 60 + 1e-9);
  }
  assert.equal(ship.routeProgress, ship.route.totalLength);
});

test('COR-12 player commit preserves the drawn polyline without an effective replacement', async () => {
  const subject = await setup('freighter');
  const drawn = [{ x: 40, y: 1 }, { x: 80, y: 0 }, { x: 120, y: 0 }];

  assert.equal(commit(subject, subject.ship, drawn).kind, 'committed');
  assert.deepEqual(subject.ship.route.toSnapshot().points, drawn);
});

test('COR-12 path step crossing a raw corner does not snap hull rotation', async () => {
  const { ships, ship } = await setup('freighter');
  const stepDistance = ship.characteristics.speed / 60;
  ship.replaceRoute(new ships.ShipRoute([
    { x: stepDistance / 2, y: 0 },
    { x: stepDistance / 2, y: 100 },
  ]));

  new ships.ShipMotor().stepRoute(ship, 8, 1 / 60);

  assertOnRoute(ship);
  assert.ok(Math.abs(ship.x - stepDistance / 2) < 1e-9);
  assert.ok(Math.abs(ship.y - stepDistance / 2) < 1e-9);
  assert.ok(angleDelta(0, ship.rotationDeg) <= ship.characteristics.turnRateDeg / 60 + 1e-9);
});

test('COR-12 nearby sharp raw route completes without a circular excursion', async () => {
  const { ships, ship } = await setup('speedboat');
  ship.replaceRoute(new ships.ShipRoute([{ x: 20, y: 0 }, { x: 20, y: 10 }]));

  const samples = runRoute(ships, ship);

  assert.equal(ship.routeProgress, ship.route.totalLength);
  assert.ok(samples.every(({ position }) =>
    position.x >= -1e-9 && position.x <= 20 + 1e-9 &&
    position.y >= -1e-9 && position.y <= 10 + 1e-9));
});

test('COR-12 drawn 90 degree bend stays raw while the ship turns without leaving it', async () => {
  const subject = await setup('freighter');
  assert.equal(commit(subject, subject.ship, [{ x: 100, y: 0 }, { x: 100, y: 140 }]).kind, 'committed');
  assert.deepEqual(subject.ship.route.toSnapshot().points, [{ x: 100, y: 0 }, { x: 100, y: 140 }]);
  const samples = runRoute(subject.ships, subject.ship);
  assert.ok(samples.at(-1).position.y > 100);
});

test('COR-12 reverse swipe remains canonical while the hull turns around', async () => {
  const subject = await setup('speedboat');
  assert.equal(commit(subject, subject.ship, [{ x: -140, y: 0 }]).kind, 'committed');
  assert.deepEqual(subject.ship.route.toSnapshot().points, [{ x: -140, y: 0 }]);
  const samples = runRoute(subject.ships, subject.ship, 1800);
  assert.ok(samples[0].position.x < 0);
  assert.ok(samples.every(({ position }) => Math.abs(position.y) < 1e-9));
});

test('COR-12 different ship speeds advance different distances on the same aligned route', async () => {
  const subject = await setup('speedboat');
  const tanker = new subject.ships.ShipModel({
    id: 'tanker',
    characteristics: subject.registry.require('tanker'),
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    state: subject.ships.ShipState.Navigating,
    cargo: { oil: 1 },
  });
  assert.equal(commit(subject, subject.ship, [{ x: 500, y: 0 }]).kind, 'committed');
  assert.equal(commit(subject, tanker, [{ x: 500, y: 0 }]).kind, 'committed');
  const motor = new subject.ships.ShipMotor();
  for (let step = 0; step < 60; step += 1) {
    motor.stepRoute(subject.ship, 8, 1 / 60);
    motor.stepRoute(tanker, 8, 1 / 60);
  }
  assert.ok(subject.ship.routeProgress > tanker.routeProgress);
  assert.ok(Math.abs(subject.ship.routeProgress - subject.ship.characteristics.speed) < 1e-6);
  assert.ok(Math.abs(tanker.routeProgress - tanker.characteristics.speed) < 1e-6);
});

test('COR-12 live extension preserves the fixed route origin and monotonic progress', async () => {
  const subject = await setup('freighter');
  const service = new subject.routes.RouteCommitService({
    navigation: new subject.routes.NavigationValidator([]),
    config: subject.routeConfig,
  });
  const gestureStart = { x: 0, y: 0 };
  assert.equal(service.commit({
    ship: subject.ship,
    draft: { shipId: subject.ship.id, start: gestureStart, points: [{ x: 200, y: 0 }, { x: 200, y: 160 }] },
  }).kind, 'committed');
  const motor = new subject.ships.ShipMotor();
  for (let step = 0; step < 30; step += 1) motor.stepRoute(subject.ship, 8, 1 / 60);
  const progressBeforeExtension = subject.ship.routeProgress;
  assert.equal(service.commit({
    ship: subject.ship,
    draft: { shipId: subject.ship.id, start: gestureStart, points: [{ x: 200, y: 0 }, { x: 260, y: 180 }] },
  }).kind, 'committed');

  assert.deepEqual(subject.ship.route.toSnapshot().start, gestureStart);
  assert.ok(subject.ship.routeProgress >= progressBeforeExtension);
  assertOnRoute(subject.ship);
  runRoute(subject.ships, subject.ship);
});
