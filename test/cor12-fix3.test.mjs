import assert from 'node:assert/strict';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

let setupPromise;
async function setup() {
  setupPromise ??= (async () => {
    const [ships, docks, routes, presentation, config, core] = await Promise.all([
      import('../src/ships/index.ts'),
      import('../src/docks/index.ts'),
      import('../src/routes/index.ts'),
      import('../src/presentation/VesselFlowPresentation.ts'),
      import('../src/config/validateConfigSource.ts'),
      import('../src/core/FixedStepClock.ts'),
    ]);
    const s = { ...ships, ...docks, ...routes, ...presentation, ...config, ...core };
    const bundle = s.validateConfigSource(readBaselineSource());
    return { s, registry: s.createShipCharacteristicsRegistry(bundle) };
  })();
  return setupPromise;
}

function shipOf(s, registry, type = 'speedboat', init = {}) {
  return new s.ShipModel({
    id: `${type}-ship`,
    characteristics: registry.require(type),
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    state: s.ShipState.Navigating,
    cargo: { general: 1 },
    ...init,
  });
}

test('COR-12 FIX-3 replace and clear own continuous route progress', async () => {
  const { s, registry } = await setup();
  const ship = shipOf(s, registry);
  ship.replaceRoute(new s.ShipRoute([{ x: 100, y: 0 }, { x: 100, y: 100 }]));
  ship.advanceRouteProgress(120);
  assert.equal(ship.routeProgress, 120);
  assert.equal(ship.routeCursor, 1);

  const restored = s.ShipModel.restore(ship.toSnapshot(), registry);
  assert.equal(restored.routeProgress, 120);
  assert.equal(restored.routeCursor, 1);

  ship.replaceRoute(new s.ShipRoute([{ x: 200, y: 0 }]));
  assert.equal(ship.routeProgress, 0);
  assert.equal(ship.routeCursor, 0);
  ship.clearRoute();
  assert.equal(ship.routeProgress, 0);
  assert.equal(ship.routeCursor, 0);
});

async function dockingHarness() {
  const { s, registry } = await setup();
  const dock = new s.DockModel({
    id: 'dock',
    position: { x: 100, y: 100 },
    rotationDeg: 90,
    dockAngle: 90,
    snapRadius: 200,
    acceptedCargoTypes: ['general'],
    helperFlag: false,
    visualVariant: 'dock_general',
  });
  const docks = new s.DockCollection([dock]);
  const dockSystem = new s.DockSystem();
  const bundle = s.validateConfigSource(readBaselineSource());
  const controller = new s.DockingController({
    docks,
    dockSystem,
    config: s.createDockingConfig(bundle),
  });
  const ship = shipOf(s, registry);
  const candidates = [{ ship, spawnSequence: 0 }];
  controller.step(candidates, 0);
  controller.step(candidates, 0);
  return { s, ship, dock, controller, candidates };
}

test('COR-12 FIX-3 docking uses a guided curve rather than a linear side-slide', async () => {
  const { ship, controller, candidates } = await dockingHarness();
  controller.step(candidates, 0.175);
  assert.notDeepEqual(ship.position, { x: 50, y: 50 });
  assert.ok(ship.x > ship.y, 'initial heading should shape the guided approach');
  assert.ok(ship.rotationDeg > 0 && ship.rotationDeg < 90);
});

test('COR-12 FIX-3 docking stays continuous and reaches exact pose at 350ms', async () => {
  const { s, ship, dock, controller, candidates } = await dockingHarness();
  let previous = ship.position;
  let elapsed = 0;
  while (elapsed < 0.35 - 1e-12) {
    const delta = Math.min(1 / 60, 0.35 - elapsed);
    controller.step(candidates, delta);
    const travel = Math.hypot(ship.x - previous.x, ship.y - previous.y);
    assert.ok(travel > 0 && travel < 20);
    previous = ship.position;
    elapsed += delta;
    if (elapsed < 0.35 - 1e-12) assert.equal(ship.state, s.ShipState.Docking);
  }
  assert.deepEqual(ship.position, dock.definition.position);
  assert.equal(ship.rotationDeg, dock.definition.dockAngle);
  assert.equal(ship.state, s.ShipState.Unloading);
});

test('COR-12 FIX-3 two different docks can be occupied while each remains single-owner', async () => {
  const { s, registry } = await setup();
  const definitions = [
    { id: 'dock_a', x: 100 },
    { id: 'dock_b', x: 300 },
  ].map(({ id, x }) => ({
    id,
    position: { x, y: 100 },
    rotationDeg: 90,
    dockAngle: 90,
    snapRadius: 30,
    acceptedCargoTypes: ['general'],
    helperFlag: false,
    visualVariant: 'dock_general',
  }));
  const docks = new s.DockCollection(definitions.map((value) => new s.DockModel(value)));
  const dockSystem = new s.DockSystem();
  const bundle = s.validateConfigSource(readBaselineSource());
  const controller = new s.DockingController({
    docks,
    dockSystem,
    config: s.createDockingConfig(bundle),
  });
  const first = shipOf(s, registry, 'speedboat', { id: 'ship-a', position: { x: 100, y: 110 } });
  const second = shipOf(s, registry, 'speedboat', { id: 'ship-b', position: { x: 300, y: 110 } });
  const candidates = [
    { ship: first, spawnSequence: 0 },
    { ship: second, spawnSequence: 1 },
  ];
  controller.step(candidates, 0);
  controller.step(candidates, 0);
  controller.step(candidates, 0.35);
  assert.equal(docks.require('dock_a').occupiedBy, first.id);
  assert.equal(docks.require('dock_b').occupiedBy, second.id);
  assert.notEqual(docks.require('dock_a').occupiedBy, docks.require('dock_b').occupiedBy);
});

test('COR-12 FIX-3 cargo pip layout matches authoritative cargo units', async () => {
  const { s } = await setup();
  assert.equal(s.createCargoPipLayout(0).length, 0);
  assert.equal(s.createCargoPipLayout(1).length, 1);
  assert.equal(s.createCargoPipLayout(2).length, 2);
  const freighter = s.createCargoPipLayout(4);
  assert.equal(freighter.length, 4);
  assert.equal(Object.isFrozen(freighter), true);
});

test('COR-12 FIX-3 one authoritative cargo removal removes exactly one pip', async () => {
  const { s, registry } = await setup();
  const ship = shipOf(s, registry, 'cargo_boat', { cargo: { general: 2 } });
  const before = s.createCargoPipLayout(ship.cargoTotal);
  assert.equal(ship.removeCargoUnit('general'), true);
  const after = s.createCargoPipLayout(ship.cargoTotal);
  assert.equal(before.length - after.length, 1);
  assert.equal(ship.cargoTotal, 1);
});

for (const type of ['speedboat', 'cargo_boat', 'freighter']) {
  for (const [shape, points] of Object.entries({
    gentle_curve: [{ x: 60, y: 8 }, { x: 120, y: 30 }, { x: 180, y: 65 }],
    right_angle: [{ x: 90, y: 0 }, { x: 90, y: 100 }, { x: 170, y: 100 }],
    s_curve: [{ x: 55, y: 35 }, { x: 110, y: -35 }, { x: 175, y: 0 }],
  })) {
    test(`COR-12 FIX-3 ${type} follows ${shape} with bounded monotonic progress`, async () => {
      const { s, registry } = await setup();
      const ship = shipOf(s, registry, type);
      ship.replaceRoute(new s.ShipRoute(points));
      const authored = ship.route.toSnapshot();
      const motor = new s.ShipMotor();
      let previousProgress = 0;
      let previousCursor = 0;
      for (let step = 0; step < 3600 && ship.routeCursor < points.length; step += 1) {
        const before = ship.position;
        const beforeRotation = ship.rotationDeg;
        motor.stepRoute(ship, 8, 1 / 60);
        assert.ok(ship.routeProgress >= previousProgress);
        assert.ok(ship.routeCursor >= previousCursor);
        assert.ok(Math.hypot(ship.x - before.x, ship.y - before.y) <= ship.characteristics.speed / 60 + 1e-9);
        const headingDelta = Math.abs(((ship.rotationDeg - beforeRotation + 540) % 360) - 180);
        assert.ok(headingDelta <= ship.characteristics.turnRateDeg / 60 + 1e-9);
        previousProgress = ship.routeProgress;
        previousCursor = ship.routeCursor;
      }
      assert.equal(ship.routeCursor, points.length);
      assert.deepEqual(ship.route.toSnapshot(), authored);
    });
  }
}

test('COR-12 FIX-3 short valid outbound command enters Leaving and continuation keeps moving', async () => {
  const { s, registry } = await setup();
  const bundle = s.validateConfigSource(readBaselineSource());
  const ship = shipOf(s, registry, 'speedboat', {
    position: { x: 500, y: 150 },
    rotationDeg: 90,
    state: s.ShipState.ReadyToLeave,
    cargo: {},
  });
  const config = s.createRouteProcessingConfig(bundle);
  const target = { x: 500, y: 150 + config.minValidRouteLength };
  const result = new s.RouteCommitService({
    navigation: new s.NavigationValidator([]),
    config,
  }).commit({ ship, draft: { shipId: ship.id, points: [target] } });
  assert.equal(result.kind, 'committed');
  assert.equal(ship.state, s.ShipState.Leaving);
  const motor = new s.ShipMotor();
  for (let step = 0; step < 120 && ship.routeCursor < 1; step += 1) {
    motor.stepRoute(ship, config.waypointTolerance, 1 / 60);
  }
  const beforeContinuation = ship.position;
  motor.stepRoute(ship, config.waypointTolerance, 1 / 60);
  assert.ok(ship.y > beforeContinuation.y);
});

test('COR-12 FIX-3 generic 90 degree dock orientation points a leaving ship toward positive Y water', async () => {
  const { s, registry } = await setup();
  const ship = shipOf(s, registry, 'speedboat', {
    position: { x: 355, y: 150 },
    rotationDeg: 90,
    state: s.ShipState.Leaving,
    cargo: {},
  });
  new s.ShipMotor().stepRoute(ship, 8, 1 / 60);
  assert.equal(ship.x, 355);
  assert.ok(ship.y > 150);
});

test('COR-12 FIX-3 route progress is monotonic and cannot reacquire an old segment', async () => {
  const { s, registry } = await setup();
  const ship = shipOf(s, registry);
  ship.replaceRoute(new s.ShipRoute([{ x: 100, y: 0 }, { x: 100, y: 100 }]));
  ship.advanceRouteProgress(130);
  ship.advanceRouteProgress(20);
  assert.equal(ship.routeProgress, 130);
  assert.equal(ship.routeCursor, 1);
});

test('COR-12 FIX-3 remaining route clips the consumed tail without changing authored geometry', async () => {
  const { s } = await setup();
  const route = new s.ShipRoute(
    [{ x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }],
    { x: 0, y: 0 },
  );
  const authored = route.toSnapshot();

  assert.deepEqual(route.remainingPolyline(50), [
    { x: 50, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 200, y: 100 },
  ]);
  assert.deepEqual(route.remainingPolyline(150), [
    { x: 100, y: 50 },
    { x: 100, y: 100 },
    { x: 200, y: 100 },
  ]);
  assert.deepEqual(route.toSnapshot(), authored);
});

test('COR-12 FIX-3 follower turns toward the next segment before reaching a 90 degree corner', async () => {
  const { s, registry } = await setup();
  const ship = shipOf(s, registry);
  ship.replaceRoute(new s.ShipRoute([{ x: 100, y: 0 }, { x: 100, y: 150 }]));
  const motor = new s.ShipMotor();
  let beganContinuousTurn = false;
  let previousProgress = 0;
  for (let step = 0; step < 600 && ship.routeCursor < 2; step += 1) {
    const before = ship.position;
    const beforeRotation = ship.rotationDeg;
    motor.stepRoute(ship, 8, 1 / 60);
    assert.ok(ship.routeProgress >= previousProgress);
    assert.ok(Math.hypot(ship.x - before.x, ship.y - before.y) <= ship.characteristics.speed / 60 + 1e-9);
    const headingDelta = Math.abs(((ship.rotationDeg - beforeRotation + 540) % 360) - 180);
    assert.ok(headingDelta <= ship.characteristics.turnRateDeg / 60 + 1e-9);
    if (ship.x < 100 && ship.routeCursor === 0 && ship.rotationDeg > 0) beganContinuousTurn = true;
    previousProgress = ship.routeProgress;
  }
  assert.equal(beganContinuousTurn, true);
  assert.equal(ship.routeCursor, 2);
  assert.deepEqual(ship.route.toSnapshot().points, [{ x: 100, y: 0 }, { x: 100, y: 150 }]);
});

test('COR-12 FIX-3 reaching a close waypoint does not insert a stopped fixed step', async () => {
  const { s, registry } = await setup();
  const ship = shipOf(s, registry, 'speedboat', { position: { x: 96, y: 0 } });
  ship.replaceRoute(new s.ShipRoute([{ x: 100, y: 0 }, { x: 200, y: 0 }]));
  new s.ShipMotor().stepRoute(ship, 8, 1 / 60);
  assert.equal(ship.routeCursor, 1);
  assert.ok(ship.x > 96);
});
