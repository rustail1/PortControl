import assert from 'node:assert/strict';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

async function loadSubject() {
  const [config, core, clock, docks, geometry, grounding, routes, ships] = await Promise.all([
    import('../src/config/validateConfigSource.ts'),
    import('../src/core/DomainEventQueue.ts'),
    import('../src/core/FixedStepClock.ts'),
    import('../src/docks/index.ts'),
    import('../src/geometry/LandClearanceGeometry.ts'),
    import('../src/grounding/GroundingSystem.ts'),
    import('../src/routes/index.ts'),
    import('../src/ships/index.ts'),
  ]);
  return { ...config, ...core, ...clock, ...docks, ...geometry, ...grounding, ...routes, ...ships };
}

async function setup() {
  const subject = await loadSubject();
  const bundle = subject.validateConfigSource(readBaselineSource());
  const characteristics = subject.createShipCharacteristicsRegistry(bundle).require('speedboat');
  return { subject, bundle, characteristics };
}

function dockDefinition() {
  return {
    id: 'dock',
    position: { x: 500, y: 500 },
    rotationDeg: 0,
    dockAngle: 0,
    snapRadius: 80,
    acceptedCargoTypes: ['general'],
    helperFlag: false,
    visualVariant: 'dock_general',
  };
}

test('COR-12 FIX-3D shore contact starts moving recovery without terminal grounding', async () => {
  const { subject, characteristics } = await setup();
  const geometry = new subject.LandClearanceGeometry([{
    points: [
      { x: 100, y: 100 }, { x: 200, y: 100 },
      { x: 200, y: 200 }, { x: 100, y: 200 },
    ],
  }]);
  const grounding = new subject.GroundingSystem({ geometry, navigationClearanceExtra: 4 });
  const ship = new subject.ShipModel({
    id: 'shore',
    characteristics,
    position: { x: 83, y: 150 },
    rotationDeg: 0,
    state: subject.ShipState.Navigating,
    cargo: { general: 1 },
    route: { points: [{ x: 180, y: 150 }] },
  });

  const result = grounding.resolve([{
    ship,
    spawnSequence: 0,
    previousPosition: { x: 70, y: 150 },
  }]);

  assert.equal(result.terminalGrounding, null);
  assert.deepEqual(result.avoidedShipIds, [ship.id]);
  assert.equal(ship.state, subject.ShipState.Navigating);
  assert.equal(ship.route, null);
  assert.equal(ship.routeRecoveryHeadingDeg, 180);
  const before = ship.position;
  new subject.ShipMotor().stepRoute(ship, 8, 0.1);
  assert.ok(Math.hypot(ship.x - before.x, ship.y - before.y) > 0);
  assert.notDeepEqual(ship.position, { x: 70, y: 150 });
  const motor = new subject.ShipMotor();
  let previousPosition = ship.position;
  for (let step = 0; step < 240; step += 1) {
    motor.stepRoute(ship, 8, 1 / 60);
    const moved = Math.hypot(
      ship.x - previousPosition.x,
      ship.y - previousPosition.y,
    );
    assert.ok(moved > 0 && moved <= characteristics.speed / 60 + 1e-9);
    const contact = grounding.resolve([{
      ship, spawnSequence: 0, previousPosition,
    }]);
    assert.equal(contact.terminalGrounding, null);
    previousPosition = ship.position;
  }
  assert.ok(ship.x < 100 - characteristics.collisionRadius - 4);
  assert.equal(ship.state, subject.ShipState.Navigating);
});

test('COR-12 FIX-3E side entry follows derived water lane and finishes at exact berth pose', async () => {
  const { subject, bundle, characteristics } = await setup();
  const definition = dockDefinition();
  const dock = new subject.DockModel(definition);
  const docks = new subject.DockCollection([dock]);
  const dockSystem = new subject.DockSystem();
  const controller = new subject.DockingController({
    docks,
    dockSystem,
    config: subject.createDockingConfig(bundle),
  });
  const ship = new subject.ShipModel({
    id: 'entry', characteristics,
    position: { x: 500, y: 560 }, rotationDeg: 270,
    state: subject.ShipState.Navigating, cargo: { general: 1 },
  });

  assert.deepEqual(subject.deriveDockLane(definition), {
    approach: { x: 580, y: 500 },
    berth: { x: 500, y: 500 },
    release: { x: 580, y: 500 },
  });
  controller.step([{ ship, spawnSequence: 0 }], 0);
  const positions = [];
  for (let step = 0; step < 21; step += 1) {
    controller.step([{ ship, spawnSequence: 0 }], 1 / 60);
    positions.push(ship.position);
  }

  assert.ok(Math.max(...positions.map((position) => position.x)) > 570);
  assert.deepEqual(ship.position, definition.position);
  assert.equal(ship.rotationDeg, definition.dockAngle);
  assert.equal(ship.state, subject.ShipState.Unloading);
  assert.equal(dock.occupiedBy, ship.id);
});

test('COR-12 FIX-3E derived lane extends along dock axis until the whole ship is in water', async () => {
  const { subject, characteristics } = await setup();
  const definition = {
    ...dockDefinition(),
    position: { x: 500, y: 175 },
    dockAngle: 90,
    snapRadius: 58,
  };
  const geometry = new subject.LandClearanceGeometry([{
    points: [
      { x: 0, y: 0 }, { x: 1000, y: 0 },
      { x: 1000, y: 250 }, { x: 0, y: 250 },
    ],
  }]);

  const lane = subject.deriveDockLane(
    definition,
    geometry,
    characteristics.collisionRadius + 4,
  );

  assert.deepEqual(lane.approach, { x: 500, y: 291 });
  assert.equal(geometry.blocksSegment(lane.approach, lane.approach, characteristics.collisionRadius + 4), false);
});

test('COR-12 FIX-3E departure keeps dock busy then resumes held outbound route at release', async () => {
  const { subject, bundle, characteristics } = await setup();
  const definition = dockDefinition();
  const dock = new subject.DockModel(definition);
  const docks = new subject.DockCollection([dock]);
  const dockSystem = new subject.DockSystem();
  const controller = new subject.DockingController({
    docks,
    dockSystem,
    config: subject.createDockingConfig(bundle),
  });
  const ship = new subject.ShipModel({
    id: 'departure', characteristics,
    position: definition.position, rotationDeg: definition.dockAngle,
    state: subject.ShipState.ReadyToLeave, cargo: {},
  });
  const waiting = new subject.ShipModel({
    id: 'waiting', characteristics,
    position: { x: 520, y: 500 }, rotationDeg: 180,
    state: subject.ShipState.Navigating, cargo: { general: 1 },
  });
  assert.equal(dockSystem.reserve(dock, { id: ship.id, cargo: { general: 1 } }).status, 'eligible');
  assert.equal(dockSystem.occupyReserved(dock, ship.id), true);
  const commit = new subject.RouteCommitService({
    navigation: new subject.NavigationValidator([]),
    config: subject.createRouteProcessingConfig(bundle),
  });
  assert.equal(commit.commit({
    ship,
    draft: { shipId: ship.id, points: [{ x: 620, y: 500 }, { x: 800, y: 500 }] },
    routeStart: controller.departureRouteStart(ship),
  }).kind, 'committed');
  assert.equal(controller.beginDeparture(ship), true);
  assert.equal(ship.routeMotionHeld, true);
  const motor = new subject.ShipMotor();
  motor.stepRoute(ship, 8, 1 / 60);
  assert.deepEqual(ship.position, definition.position);

  controller.step([{ ship, spawnSequence: 0 }, { ship: waiting, spawnSequence: 1 }], 0.175);
  assert.equal(dock.occupiedBy, ship.id);
  assert.equal(dockSystem.classify(dock, waiting).status, 'busy');
  assert.equal(waiting.state, subject.ShipState.Navigating);
  assert.notDeepEqual(ship.position, definition.position);
  controller.step([{ ship, spawnSequence: 0 }, { ship: waiting, spawnSequence: 1 }], 0.175);

  assert.equal(dock.occupiedBy, null);
  assert.deepEqual(ship.position, { x: 580, y: 500 });
  assert.equal(ship.routeMotionHeld, false);
  assert.notEqual(ship.route, null);
  const released = ship.position;
  motor.stepRoute(ship, 8, 1 / 60);
  assert.ok(ship.x > released.x);
  assert.equal(ship.y, released.y);
});

test('COR-12 FIX-3E departure assist is identical across render partitions', async () => {
  const run = async (fps) => {
    const { subject, bundle, characteristics } = await setup();
    const definition = dockDefinition();
    const dock = new subject.DockModel(definition);
    const dockSystem = new subject.DockSystem();
    const controller = new subject.DockingController({
      docks: new subject.DockCollection([dock]),
      dockSystem,
      config: subject.createDockingConfig(bundle),
    });
    const ship = new subject.ShipModel({
      id: 'partitioned', characteristics,
      position: definition.position, rotationDeg: definition.dockAngle,
      state: subject.ShipState.ReadyToLeave, cargo: {},
    });
    dockSystem.reserve(dock, { id: ship.id, cargo: { general: 1 } });
    dockSystem.occupyReserved(dock, ship.id);
    const commit = new subject.RouteCommitService({
      navigation: new subject.NavigationValidator([]),
      config: subject.createRouteProcessingConfig(bundle),
    });
    commit.commit({
      ship,
      draft: { shipId: ship.id, points: [{ x: 620, y: 500 }, { x: 800, y: 500 }] },
      routeStart: controller.departureRouteStart(ship),
    });
    controller.beginDeparture(ship);
    const clock = new subject.FixedStepClock({ fixedHz: 60, maxCatchUpSteps: 6 });
    for (let frame = 0; frame < fps; frame += 1) {
      clock.advance(1000 / fps, (deltaSeconds) => {
        controller.step([{ ship, spawnSequence: 0 }], deltaSeconds);
      });
    }
    return { ship: ship.toSnapshot(), dock: dock.toRuntimeSnapshot() };
  };

  assert.deepEqual(await run(30), await run(60));
  assert.deepEqual(await run(60), await run(120));
});

test('COR-12 FIX-3E outbound route is validated from release instead of creating an unsafe connector', async () => {
  const { subject, bundle, characteristics } = await setup();
  const definition = dockDefinition();
  const dock = new subject.DockModel(definition);
  const dockSystem = new subject.DockSystem();
  const geometry = new subject.LandClearanceGeometry([{
    points: [
      { x: 530, y: 565 }, { x: 550, y: 565 },
      { x: 550, y: 585 }, { x: 530, y: 585 },
    ],
  }]);
  const controller = new subject.DockingController({
    docks: new subject.DockCollection([dock]),
    dockSystem,
    config: subject.createDockingConfig(bundle),
    landGeometry: geometry,
    navigationClearanceExtra: 4,
  });
  const ship = new subject.ShipModel({
    id: 'safe-release', characteristics,
    position: definition.position, rotationDeg: definition.dockAngle,
    state: subject.ShipState.ReadyToLeave, cargo: {},
  });
  dockSystem.reserve(dock, { id: ship.id, cargo: { general: 1 } });
  dockSystem.occupyReserved(dock, ship.id);
  const commit = new subject.RouteCommitService({
    navigation: new subject.NavigationValidator(geometry.polygons),
    config: subject.createRouteProcessingConfig(bundle),
  });

  const result = commit.commit({
    ship,
    routeStart: controller.departureRouteStart(ship),
    draft: {
      shipId: ship.id,
      points: [{ x: 500, y: 650 }, { x: 800, y: 650 }, { x: 800, y: 500 }],
    },
  });

  assert.equal(result.kind, 'rejected_invalid');
  assert.equal(ship.state, subject.ShipState.ReadyToLeave);
  assert.equal(ship.route, null);
});

test('COR-12 FIX-3E short OUT gesture keeps its berth-drawn activation length', async () => {
  const { subject, bundle, characteristics } = await setup();
  const ship = new subject.ShipModel({
    id: 'short-out', characteristics,
    position: { x: 500, y: 500 }, rotationDeg: 0,
    state: subject.ShipState.ReadyToLeave, cargo: {},
  });
  const commit = new subject.RouteCommitService({
    navigation: new subject.NavigationValidator([]),
    config: subject.createRouteProcessingConfig(bundle),
  });

  const result = commit.commit({
    ship,
    routeStart: { x: 580, y: 500 },
    draft: { shipId: ship.id, points: [{ x: 582, y: 500 }] },
  });

  assert.equal(result.kind, 'committed');
  assert.equal(ship.state, subject.ShipState.Leaving);
});
