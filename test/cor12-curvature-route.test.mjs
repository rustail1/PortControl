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
    const headingBefore = ship.rotationDeg;
    const progressBefore = ship.routeProgress;
    motor.stepRoute(ship, 8, 1 / 60);
    const dx = ship.x - before.x;
    const dy = ship.y - before.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 1e-9) continue;
    const velocityHeading = Math.atan2(dy, dx) * 180 / Math.PI;
    assert.ok(angleDelta(ship.rotationDeg, velocityHeading) < 1e-9);
    const headingChange = angleDelta(headingBefore, velocityHeading);
    assert.ok(
      headingChange <= ship.characteristics.turnRateDeg / 60 + 0.2,
      `curvature exceeded: ${headingChange} > ${ship.characteristics.turnRateDeg / 60}`,
    );
    assert.ok(dx * Math.cos(headingBefore * Math.PI / 180) + dy * Math.sin(headingBefore * Math.PI / 180) > 0);
    assert.ok(Math.abs(
      ship.routeProgress - progressBefore - ship.characteristics.speed / 60,
    ) < 1e-8 || ship.routeProgress === ship.route.totalLength);
    samples.push({ position: ship.position, heading: ship.rotationDeg });
  }
  return samples;
}

test('COR-12 curvature route keeps hull aligned with velocity through a sharp turn', async () => {
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

test('COR-12 compiled 90 degree bend stays forward and curvature-limited', async () => {
  const subject = await setup('freighter');
  assert.equal(commit(subject, subject.ship, [{ x: 100, y: 0 }, { x: 100, y: 140 }]).kind, 'committed');
  assert.ok(subject.ship.route.length > 2);
  const samples = runRoute(subject.ships, subject.ship);
  assert.ok(samples.some(({ position }) => position.x > 100));
  assert.deepEqual(subject.ship.position, { x: 100, y: 140 });
});

test('COR-12 reverse swipe compiles to a forward U-turn without reverse velocity', async () => {
  const subject = await setup('speedboat');
  assert.equal(commit(subject, subject.ship, [{ x: -140, y: 0 }]).kind, 'committed');
  const effective = subject.ship.route.toSnapshot().points;
  assert.ok(effective.some((point) => Math.abs(point.y) > 20));
  const samples = runRoute(subject.ships, subject.ship);
  assert.ok(samples[0].position.x > 0);
  assert.deepEqual(subject.ship.position, { x: -140, y: 0 });
});

test('COR-12 slow-turning tanker receives a wider reverse curve than speedboat', async () => {
  const subject = await setup('speedboat');
  const tanker = new subject.ships.ShipModel({
    id: 'tanker',
    characteristics: subject.registry.require('tanker'),
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    state: subject.ships.ShipState.Navigating,
    cargo: { oil: 1 },
  });
  assert.equal(commit(subject, subject.ship, [{ x: -180, y: 0 }]).kind, 'committed');
  assert.equal(commit(subject, tanker, [{ x: -180, y: 0 }]).kind, 'committed');
  const excursion = (ship) => Math.max(...ship.route.toSnapshot().points.map((point) => Math.abs(point.y)));
  assert.ok(excursion(tanker) > excursion(subject.ship));
});

test('COR-12 live replacement starts at current pose and cannot rewrite travelled path', async () => {
  const subject = await setup('freighter');
  assert.equal(commit(subject, subject.ship, [{ x: 200, y: 0 }, { x: 200, y: 160 }]).kind, 'committed');
  const motor = new subject.ships.ShipMotor();
  for (let step = 0; step < 30; step += 1) motor.stepRoute(subject.ship, 8, 1 / 60);
  const travelledTo = subject.ship.position;
  assert.equal(commit(subject, subject.ship, [{ x: 200, y: 0 }, { x: 260, y: 180 }], travelledTo).kind, 'committed');

  assert.deepEqual(subject.ship.route.toSnapshot().start, travelledTo);
  assert.deepEqual(subject.ship.route.remainingPolyline(0)[0], travelledTo);
  runRoute(subject.ships, subject.ship);
});
