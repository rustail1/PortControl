import assert from 'node:assert/strict';
import test from 'node:test';
import { readBaselineSource } from './support/readBaselineSource.mjs';

async function subject() {
  const [docks, ships, config, events, core] = await Promise.all([
    import('../src/docks/index.ts'), import('../src/ships/index.ts'),
    import('../src/config/validateConfigSource.ts'), import('../src/core/DomainEventQueue.ts'),
    import('../src/core/FixedStepClock.ts'),
  ]);
  return { ...docks, ...ships, ...config, ...events, ...core };
}
async function setup(cargo = { general: 1 }, types = ['general']) {
  const s = await subject(), bundle = s.validateConfigSource(readBaselineSource());
  const dock = new s.DockModel({ id: 'dock', position: { x: 0, y: 0 }, rotationDeg: 0, dockAngle: 0, snapRadius: 20, acceptedCargoTypes: types, helperFlag: false, visualVariant: 'dock_general' });
  const docks = new s.DockSystem(), events = new s.DomainEventQueue(), characteristics = s.createShipCharacteristicsRegistry(bundle).require('speedboat');
  const ship = new s.ShipModel({ id: 'ship', characteristics, position: { x: 0, y: 0 }, rotationDeg: 0, state: s.ShipState.Unloading, cargo });
  assert.equal(docks.reserve(dock, ship).status, 'eligible'); assert.equal(docks.occupyReserved(dock, ship.id), true);
  const cargoSystem = new s.CargoSystem({ dockSystem: docks, events });
  const received = []; events.subscribe('cargo_unloaded', (event) => received.push(event));
  return { s, bundle, dock, docks, events, ship, cargoSystem, received };
}
const active = (ship, dock) => [{ ship, dock }];

test('validated ships.json supplies each ship unloadStepMs', async () => {
  const { s, bundle } = await setup(); const registry = s.createShipCharacteristicsRegistry(bundle); const source = readBaselineSource().configs['ships.json'].ships;
  for (const type of Object.keys(source)) assert.equal(registry.require(type).unloadStepMs, source[type].unloadStepMs);
});
test('unload threshold removes exactly one unit and emits exactly one event', async () => {
  const { cargoSystem, ship, dock, received, events } = await setup({ general: 2 });
  cargoSystem.step(active(ship, dock), 0); cargoSystem.step([], 0.799); assert.equal(ship.cargoQuantity('general'), 2); assert.equal(received.length, 0);
  cargoSystem.step([], 0.001); events.flush(); assert.equal(ship.cargoQuantity('general'), 1); assert.equal(received.length, 1); assert.deepEqual(received[0], { shipId: 'ship', shipType: 'speedboat', dockId: 'dock', cargoType: 'general' });
  cargoSystem.step([], 0); assert.equal(ship.cargoQuantity('general'), 1); assert.equal(received.length, 1);
});
test('empty cargo releases occupancy, clears inbound route, and becomes ReadyToLeave', async () => {
  const { s, cargoSystem, ship, dock, received, events } = await setup(); ship.replaceRoute(new s.ShipRoute([{ x: 50, y: 0 }])); cargoSystem.step(active(ship, dock), 0); cargoSystem.step([], .8); events.flush();
  assert.equal(received.length, 1); assert.equal(dock.occupiedBy, null); assert.equal(ship.state, s.ShipState.ReadyToLeave); assert.equal(ship.route, null); assert.equal(ship.cargoTotal, 0);
});
test('mixed cargo leaves incompatible units, releases dock, and returns to Navigating', async () => {
  const { cargoSystem, ship, dock, received, events } = await setup({ general: 1, container: 1 }); cargoSystem.step(active(ship, dock), 0); cargoSystem.step([], .8); events.flush();
  assert.deepEqual(ship.cargo, { general: 0, container: 1 }); assert.equal(received.length, 1); assert.equal(dock.occupiedBy, null); assert.equal(ship.state, 'Navigating');
});
test('multi-accept dock uses authored cargo type order and accumulator emits once per unit', async () => {
  const { cargoSystem, ship, dock, received, events } = await setup({ general: 1, container: 1 }, ['container', 'general']); cargoSystem.step(active(ship, dock), 0); cargoSystem.step([], 1.6); events.flush();
  assert.deepEqual(received.map((event) => event.cargoType), ['container', 'general']); assert.equal(ship.cargoTotal, 0); assert.equal(dock.occupiedBy, null);
});
test('Destroyed or lost occupancy stops unload without zombie mutation', async () => {
  const { s, cargoSystem, ship, dock, docks, received } = await setup({ general: 2 }); cargoSystem.step(active(ship, dock), 0); ship.setState(s.ShipState.Destroyed); cargoSystem.step([], 2);
  assert.equal(ship.cargoQuantity('general'), 2); assert.equal(received.length, 0); assert.equal(dock.occupiedBy, ship.id);
  const next = await setup({ general: 1 }); next.cargoSystem.step(active(next.ship, next.dock), 0); assert.equal(next.docks.releaseOccupancy(next.dock, next.ship.id), true); next.cargoSystem.step([], 2); assert.equal(next.ship.cargoQuantity('general'), 1); assert.equal(next.received.length, 0);
});
test('30, 60, and 120 partitions preserve cargo, state, occupancy, and event sequence', async () => {
  const run = async (fps) => { const x = await setup({ general: 2 }); const clock = new x.s.FixedStepClock({ fixedHz: 60, maxCatchUpSteps: 6 }); x.cargoSystem.step(active(x.ship, x.dock), 0); for(let i=0;i<fps*2;i++) clock.advance(1000/fps, dt=>x.cargoSystem.step([],dt)); x.events.flush(); return { cargo:x.ship.cargo, state:x.ship.state, dock:x.dock.toRuntimeSnapshot(), events:x.received }; };
  const [a,b,c]=await Promise.all([run(30),run(60),run(120)]); assert.deepEqual(b,a); assert.deepEqual(c,a);
});
test('Map iteration processes a second simultaneous unload after the first completes', async () => {
  const first = await setup(), { s, cargoSystem, docks, events, received } = first;
  const dock = new s.DockModel({ id: 'dock-2', position: { x: 1, y: 0 }, rotationDeg: 0, dockAngle: 0, snapRadius: 20, acceptedCargoTypes: ['general'], helperFlag: false, visualVariant: 'dock_general' });
  const ship = new s.ShipModel({ id: 'ship-2', characteristics: first.ship.characteristics, position: { x: 1, y: 0 }, rotationDeg: 0, state: s.ShipState.Unloading, cargo: { general: 1 } });
  assert.equal(docks.reserve(dock, ship).status, 'eligible'); assert.equal(docks.occupyReserved(dock, ship.id), true);
  cargoSystem.step([{ ship: first.ship, dock: first.dock }, { ship, dock }], 0); cargoSystem.step([], .8); events.flush();
  assert.equal(first.ship.state, s.ShipState.ReadyToLeave); assert.equal(ship.state, s.ShipState.ReadyToLeave); assert.equal(received.length, 2);
});
