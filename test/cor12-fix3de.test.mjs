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
  const registry = subject.createShipCharacteristicsRegistry(bundle);
  const characteristics = registry.require('speedboat');
  return { subject, bundle, characteristics, registry };
}


function dockDefinition() {
  return {
    id: 'dock',
    position: { x: 500, y: 500 },
    rotationDeg: 0,
    dockAngle: 0,
    approachRadius: 80,
    acceptedCargoTypes: ['general'],
    helperFlag: false,
    visualVariant: 'dock_general',
  };
}

test('COR-12 FIX-3D shore contact produces terminal grounding without recovery mutation', async () => {
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
  const before = ship.toSnapshot();

  const result = grounding.resolve([{
    ship,
    spawnSequence: 0,
    previousPosition: { x: 70, y: 150 },
  }]);

  assert.deepEqual(result.terminalGrounding, { shipId: ship.id, failReason: 'grounding' });
  assert.deepEqual(result.avoidedShipIds, []);
  assert.deepEqual(ship.toSnapshot(), before, 'GroundingSystem reports a terminal fact; terminal arbitration owns mutation');
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
    position: { x: 650, y: 530 }, rotationDeg: 270,
    state: subject.ShipState.Navigating, cargo: { general: 1 },
  });

  assert.deepEqual(subject.deriveDockLane(definition), {
    approach: { x: 580, y: 500 },
    alignment: { x: 544, y: 500 },
    berth: { x: 500, y: 500 },
    release: { x: 580, y: 500 },
  });
  controller.step([{ ship, spawnSequence: 0 }], 0);
  const positions = [ship.position];
  for (let step = 0; step < 1200 && ship.state !== subject.ShipState.Unloading; step += 1) {
    controller.step([], 1 / 60);
    positions.push(ship.position);
  }

  assert.ok(Math.max(...positions.map((position) => position.x)) > 570);
  assert.deepEqual(ship.position, definition.position);
  assert.equal(ship.rotationDeg, definition.dockAngle);
  assert.equal(ship.state, subject.ShipState.Unloading);
  assert.equal(dock.occupiedBy, ship.id);
});

test('COR-12 harbor assist duration follows ship characteristics instead of a shared snap timer', async () => {
  const { subject, bundle, registry } = await setup();
  const elapsedByType = new Map();
  for (const type of ['speedboat', 'cargo_boat', 'freighter', 'tanker']) {
    const dock = new subject.DockModel(dockDefinition());
    const controller = new subject.DockingController({
      docks: new subject.DockCollection([dock]),
      dockSystem: new subject.DockSystem(),
      config: subject.createDockingConfig(bundle),
    });
    const ship = new subject.ShipModel({
      id: type, characteristics: registry.require(type), position: { x: 580, y: 500 },
      rotationDeg: 0, state: subject.ShipState.Navigating, cargo: { general: 1 },
    });
    controller.step([{ ship, spawnSequence: 0 }], 0);
    let elapsed = 0;
    for (let step = 0; step < 1200 && ship.state !== subject.ShipState.Unloading; step += 1) {
      controller.step([], 1 / 60);
      elapsed += 1 / 60;
    }
    elapsedByType.set(type, elapsed);
    assert.equal(ship.state, subject.ShipState.Unloading, type);
    assert.deepEqual(ship.position, dockDefinition().position, type);
    assert.equal(ship.rotationDeg, dockDefinition().dockAngle, type);
  }
  assert.ok(elapsedByType.get('freighter') > elapsedByType.get('speedboat'));
  assert.ok(elapsedByType.get('tanker') > elapsedByType.get('speedboat'));
});

test('COR-12 FIX-3E derived lane extends along dock axis until the whole ship is in water', async () => {
  const { subject, characteristics } = await setup();
  const definition = {
    ...dockDefinition(),
    position: { x: 500, y: 175 },
    dockAngle: 90,
    approachRadius: 58,
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
  const prepared = commit.prepare({
    ship,
    draft: { shipId: ship.id, points: [{ x: 620, y: 500 }, { x: 800, y: 500 }] },
    routeStart: controller.departureRouteStart(ship),
  });
  assert.ok('route' in prepared);
  const departure = new subject.DepartureCoordinator({ routes: commit, docking: controller });
  assert.equal(departure.commit(ship, prepared).kind, 'committed');
  assert.equal(ship.routeMotionHeld, true);
  const motor = new subject.ShipMotor();
  motor.stepRoute(ship, 1 / 60);
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
  motor.stepRoute(ship, 1 / 60);
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
    const prepared = commit.prepare({
      ship,
      draft: { shipId: ship.id, points: [{ x: 620, y: 500 }, { x: 800, y: 500 }] },
      routeStart: controller.departureRouteStart(ship),
    });
    assert.ok('route' in prepared);
    const departure = new subject.DepartureCoordinator({ routes: commit, docking: controller });
    assert.equal(departure.commit(ship, prepared).kind, 'committed');
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

  const result = commit.prepare({
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

test('COR-12 FIX-3E short OUT gesture is measured from release and rejected when too short', async () => {
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

  const result = commit.prepare({
    ship,
    routeStart: { x: 580, y: 500 },
    draft: { shipId: ship.id, points: [{ x: 582, y: 500 }] },
  });

  assert.equal(result.kind, 'rejected_too_short');
  assert.equal(ship.state, subject.ShipState.ReadyToLeave);
});
