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

function runRoute(ships, ship, maximumSteps = 1200) {
  const motor = new ships.ShipMotor();
  const samples = [];
  for (let step = 0; step < maximumSteps && ship.routeProgress < ship.route.totalLength; step += 1) {
    const before = ship.position;
    const progressBefore = ship.routeProgress;
    motor.stepRoute(ship, 8, 1 / 60);
    const dx = ship.x - before.x;
    const dy = ship.y - before.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 1e-9) continue;
    const velocityHeading = Math.atan2(dy, dx) * 180 / Math.PI;
    assert.ok(angleDelta(ship.rotationDeg, velocityHeading) < 1e-9);
    assert.ok(ship.routeProgress >= progressBefore);
    assert.ok(distance <= ship.characteristics.speed / 60 + 1e-9);
    samples.push({ position: ship.position, heading: ship.rotationDeg });
  }
  return samples;
}

test('COR-12 path follower keeps hull aligned with velocity through a sharp turn', async () => {
  const { ships, ship } = await setup();
  ship.replaceRoute(new ships.ShipRoute([
    { x: 50, y: 0 },
    { x: 50, y: 100 },
  ]));
  const motor = new ships.ShipMotor();

  for (let step = 0; step < 180 && ship.routeProgress < ship.route.totalLength; step += 1) {
    const before = ship.position;
    motor.stepRoute(ship, 8, 1 / 60);
    const dx = ship.x - before.x;
    const dy = ship.y - before.y;
    if (Math.hypot(dx, dy) <= 1e-9) continue;
    const velocityHeading = Math.atan2(dy, dx) * 180 / Math.PI;
    assert.ok(
      angleDelta(ship.rotationDeg, velocityHeading) < 1e-9,
      `side-slip at step ${step}: hull=${ship.rotationDeg}, velocity=${velocityHeading}`,
    );
  }
});

test('COR-12 path follower advances by speed dt and faces its actual movement delta', async () => {
  const { ships, ship } = await setup('freighter');
  ship.setRotationDeg(180);
  ship.replaceRoute(new ships.ShipRoute([{ x: 100, y: 0 }]));
  const before = ship.position;

  new ships.ShipMotor().stepRoute(ship, 8, 1 / 60);

  const dx = ship.x - before.x;
  const dy = ship.y - before.y;
  const expectedDistance = ship.characteristics.speed / 60;
  assert.ok(Math.abs(Math.hypot(dx, dy) - expectedDistance) < 1e-9);
  assert.ok(Math.abs(ship.routeProgress - expectedDistance) < 1e-9);
  assert.ok(angleDelta(ship.rotationDeg, Math.atan2(dy, dx) * 180 / Math.PI) < 1e-9);
});

test('COR-12 sharp route movement stays on the drawn polyline without progress jumps', async () => {
  const { ships, ship } = await setup('freighter');
  ship.replaceRoute(new ships.ShipRoute([
    { x: 30, y: 0 },
    { x: 30, y: 80 },
  ]));
  const motor = new ships.ShipMotor();

  for (let step = 0; step < 300 && ship.routeProgress < ship.route.totalLength; step += 1) {
    const before = ship.position;
    const progressBefore = ship.routeProgress;
    motor.stepRoute(ship, 8, 1 / 60);
    const dx = ship.x - before.x;
    const dy = ship.y - before.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 1e-9) continue;
    const expected = ship.routeProgress <= 30
      ? { x: ship.routeProgress, y: 0 }
      : { x: 30, y: ship.routeProgress - 30 };
    assert.ok(
      Math.hypot(ship.x - expected.x, ship.y - expected.y) < 1e-6,
      `left route at step ${step}: ${ship.x},${ship.y}`,
    );
    assert.ok(angleDelta(ship.rotationDeg, Math.atan2(dy, dx) * 180 / Math.PI) < 1e-9);
    const expectedProgressDelta = Math.min(
      ship.characteristics.speed / 60,
      ship.route.totalLength - progressBefore,
    );
    assert.ok(Math.abs((ship.routeProgress - progressBefore) - expectedProgressDelta) < 1e-6);
  }
});

test('COR-12 player commit preserves the drawn polyline without an effective replacement', async () => {
  const subject = await setup('freighter');
  const drawn = [{ x: 40, y: 1 }, { x: 80, y: 0 }, { x: 120, y: 0 }];

  assert.equal(commit(subject, subject.ship, drawn).kind, 'committed');
  assert.deepEqual(subject.ship.route.toSnapshot().points, drawn);
});

test('COR-12 path step crossing a raw corner faces its actual chord delta', async () => {
  const { ships, ship } = await setup('freighter');
  const stepDistance = ship.characteristics.speed / 60;
  ship.replaceRoute(new ships.ShipRoute([
    { x: stepDistance / 2, y: 0 },
    { x: stepDistance / 2, y: 100 },
  ]));

  new ships.ShipMotor().stepRoute(ship, 8, 1 / 60);

  assert.ok(Math.abs(ship.x - stepDistance / 2) < 1e-9);
  assert.ok(Math.abs(ship.y - stepDistance / 2) < 1e-9);
  assert.ok(angleDelta(ship.rotationDeg, 45) < 1e-9);
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

test('COR-12 drawn 90 degree bend stays raw while the ship turns forward', async () => {
  const subject = await setup('freighter');
  assert.equal(commit(subject, subject.ship, [{ x: 100, y: 0 }, { x: 100, y: 140 }]).kind, 'committed');
  assert.deepEqual(subject.ship.route.toSnapshot().points, [{ x: 100, y: 0 }, { x: 100, y: 140 }]);
  const samples = runRoute(subject.ships, subject.ship);
  assert.ok(samples.at(-1).position.y > 100);
});

test('COR-12 reverse swipe follows the straight raw line nose-first', async () => {
  const subject = await setup('speedboat');
  assert.equal(commit(subject, subject.ship, [{ x: -140, y: 0 }]).kind, 'committed');
  assert.deepEqual(subject.ship.route.toSnapshot().points, [{ x: -140, y: 0 }]);
  const samples = runRoute(subject.ships, subject.ship);
  assert.ok(samples[0].position.x < 0);
  assert.ok(samples.every(({ position }) => Math.abs(position.y) < 1e-9));
});

test('COR-12 different ship speeds advance different distances on the same route', async () => {
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
  runRoute(subject.ships, subject.ship);
});
