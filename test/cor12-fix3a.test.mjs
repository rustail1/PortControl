import assert from 'node:assert/strict';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

let setupPromise;
async function setup() {
  setupPromise ??= (async () => {
    const [ships, docks, routes, config, events, runtime] = await Promise.all([
      import('../src/ships/index.ts'),
      import('../src/docks/index.ts'),
      import('../src/routes/index.ts'),
      import('../src/config/validateConfigSource.ts'),
      import('../src/core/DomainEventQueue.ts'),
      import('../src/runtime/HarborRuntime.ts'),
    ]);
    const s = { ...ships, ...docks, ...routes, ...config, ...events, ...runtime };
    const bundle = s.validateConfigSource(readBaselineSource());
    return { s, bundle, registry: s.createShipCharacteristicsRegistry(bundle) };
  })();
  return setupPromise;
}

function shipOf(s, registry, init = {}) {
  return new s.ShipModel({
    id: 'ship',
    characteristics: registry.require('speedboat'),
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    state: s.ShipState.Navigating,
    cargo: { general: 1 },
    ...init,
  });
}

function dockOf(s, init = {}) {
  return new s.DockModel({
    id: 'dock',
    position: { x: 0, y: 0 },
    rotationDeg: 90,
    dockAngle: 90,
    snapRadius: 58,
    acceptedCargoTypes: ['general'],
    helperFlag: false,
    visualVariant: 'dock_general',
    ...init,
  });
}

function occupy(dockSystem, dock, ship) {
  assert.equal(dockSystem.reserve(dock, ship).status, 'eligible');
  assert.equal(dockSystem.occupyReserved(dock, ship.id), true);
}

function routeService(s, bundle) {
  return new s.RouteCommitService({
    navigation: new s.NavigationValidator([]),
    config: s.createRouteProcessingConfig(bundle),
  });
}

for (const dockAngle of [0, 90, 180, 270]) {
  test(`COR-12 FIX-3A off-axis docking ends tangent to authored ${dockAngle} degree dock axis`, async () => {
    const { s, bundle, registry } = await setup();
    const radians = dockAngle * Math.PI / 180;
    const outward = { x: Math.cos(radians), y: Math.sin(radians) };
    const perpendicular = { x: -outward.y, y: outward.x };
    const dock = new s.DockModel({
      id: `dock-${dockAngle}`,
      position: { x: 100, y: 100 },
      rotationDeg: dockAngle,
      dockAngle,
      snapRadius: 200,
      acceptedCargoTypes: ['general'],
      helperFlag: false,
      visualVariant: 'dock_general',
    });
    const dockSystem = new s.DockSystem();
    const controller = new s.DockingController({
      docks: new s.DockCollection([dock]),
      dockSystem,
      config: s.createDockingConfig(bundle),
    });
    const ship = shipOf(s, registry, {
      position: {
        x: dock.definition.position.x + outward.x * 80 + perpendicular.x * 35,
        y: dock.definition.position.y + outward.y * 80 + perpendicular.y * 35,
      },
      rotationDeg: (dockAngle + 180) % 360,
    });
    const candidates = [{ ship, spawnSequence: 0 }];

    controller.step(candidates, 0);
    controller.step(candidates, 0);
    controller.step(candidates, 0.349);
    assert.equal(ship.state, s.ShipState.Docking);
    const nearEnd = ship.position;

    controller.step(candidates, 0.001);
    assert.deepEqual(ship.position, dock.definition.position);
    assert.equal(ship.rotationDeg, dockAngle);
    assert.equal(ship.state, s.ShipState.Unloading);

    const arrival = {
      x: ship.x - nearEnd.x,
      y: ship.y - nearEnd.y,
    };
    const length = Math.hypot(arrival.x, arrival.y);
    assert.ok(length > 0);

    // Authored dockAngle in calm_01 points from the berth back toward open water.
    // Arrival therefore approaches the berth anti-parallel to that outgoing axis.
    const expectedArrival = { x: -outward.x, y: -outward.y };
    const alignment =
      (arrival.x * expectedArrival.x + arrival.y * expectedArrival.y) / length;
    assert.ok(alignment > 0.995, `final tangent alignment=${alignment}`);
  });
}

test('COR-12 FIX-3A ReadyToLeave keeps its dock busy while another dock stays independent', async () => {
  const { s, registry } = await setup();
  const dockSystem = new s.DockSystem();
  const events = new s.DomainEventQueue();
  const dock = dockOf(s, { id: 'dock-a' });
  const otherDock = dockOf(s, { id: 'dock-b', position: { x: 100, y: 0 } });
  const ship = shipOf(s, registry, { state: s.ShipState.Unloading });
  occupy(dockSystem, dock, ship);

  const cargo = new s.CargoSystem({ dockSystem, events });
  cargo.step([{ ship, dock }], 0);
  cargo.step([], 0.8);

  assert.equal(ship.state, s.ShipState.ReadyToLeave);
  assert.equal(dock.occupiedBy, ship.id);
  assert.equal(s.isDockPresentationBusy(dock.toRuntimeSnapshot()), true);

  const waiting = shipOf(s, registry, { id: 'waiting' });
  assert.equal(dockSystem.classify(dock, waiting).status, 'busy');
  assert.equal(dockSystem.reserve(dock, waiting).status, 'busy');
  assert.equal(dockSystem.classify(otherDock, waiting).status, 'eligible');
});

test('COR-12 FIX-3A rejected outbound route keeps ReadyToLeave occupancy through the cargo phase', async () => {
  const { s, bundle, registry } = await setup();
  const dockSystem = new s.DockSystem();
  const events = new s.DomainEventQueue();
  const dock = dockOf(s);
  const ship = shipOf(s, registry, { state: s.ShipState.Unloading });
  occupy(dockSystem, dock, ship);

  const cargo = new s.CargoSystem({ dockSystem, events });
  cargo.step([{ ship, dock }], 0);
  cargo.step([], 0.8);
  assert.equal(ship.state, s.ShipState.ReadyToLeave);
  assert.equal(dock.occupiedBy, ship.id);

  const result = routeService(s, bundle).commit({
    ship,
    draft: { shipId: ship.id, points: [{ x: 1, y: 0 }] },
  });
  assert.equal(result.kind, 'rejected_too_short');

  cargo.step([], 0);
  assert.equal(ship.state, s.ShipState.ReadyToLeave);
  assert.equal(dock.occupiedBy, ship.id);
});

test('COR-12 FIX-3A successful outbound route releases ReadyToLeave occupancy exactly once', async () => {
  const { s, bundle, registry } = await setup();
  const dockSystem = new s.DockSystem();
  const events = new s.DomainEventQueue();
  const dock = dockOf(s);
  const ship = shipOf(s, registry, { state: s.ShipState.Unloading });
  occupy(dockSystem, dock, ship);

  const cargo = new s.CargoSystem({ dockSystem, events });
  cargo.step([{ ship, dock }], 0);
  cargo.step([], 0.8);
  assert.equal(ship.state, s.ShipState.ReadyToLeave);
  assert.equal(dock.occupiedBy, ship.id);

  const result = routeService(s, bundle).commit({
    ship,
    draft: { shipId: ship.id, points: [{ x: 20, y: 0 }] },
  });
  assert.equal(result.kind, 'committed');
  assert.equal(ship.state, s.ShipState.Leaving);

  cargo.step([], 0);
  assert.equal(dock.occupiedBy, null);

  // The retained unload transaction is consumed by the first Leaving phase.
  // Re-running the cargo phase cannot release the berth a second time.
  cargo.step([], 0);
  assert.equal(dock.occupiedBy, null);
});
