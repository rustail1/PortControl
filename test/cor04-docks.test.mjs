import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

async function subject() {
  const [docks, ships, config] = await Promise.all([
    import('../src/docks/index.ts'),
    import('../src/ships/index.ts'),
    import('../src/config/validateConfigSource.ts'),
  ]);
  return { ...docks, ...ships, ...config };
}

async function setup() {
  const s = await subject();
  const bundle = s.validateConfigSource(readBaselineSource());
  const ships = s.createShipCharacteristicsRegistry(bundle);
  const docks = s.createDocksFromLevel(bundle.levels.industrial_37);
  const ship = (id, cargo) => new s.ShipModel({
    id,
    characteristics: ships.require('speedboat'),
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    state: s.ShipState.Navigating,
    cargo,
  });
  return { s, bundle, docks, ship };
}

test('factory parses actual validated general, container, and oil dock definitions', async () => {
  const { docks } = await setup();
  const general = docks.require('dock_g').definition;
  const container = docks.require('dock_c').definition;
  const oil = docks.require('dock_o').definition;

  assert.deepEqual(general, {
    id: 'dock_g', position: { x: 350, y: 310 }, rotationDeg: 0,
    dockAngle: 0, snapRadius: 58, acceptedCargoTypes: ['general'],
    helperFlag: false, visualVariant: 'dock_general',
  });
  assert.deepEqual(container.acceptedCargoTypes, ['container']);
  assert.deepEqual(oil.acceptedCargoTypes, ['oil']);
});

test('factory ignores disabled dock blocks', async () => {
  const { s, bundle } = await setup();
  const level = structuredClone(bundle.levels.calm_01);
  level.layout.blocks.push({
    blockType: 'dock', id: 'disabled', x: 1, y: 2, rotation: 3, layer: 'gameplay', enabled: false,
    props: { cargoTypes: ['general'], snapRadius: 58, dockAngle: 3, helperFlag: false, visualVariant: 'dock_general' },
  });

  assert.equal(s.createDocksFromLevel(level).get('disabled'), undefined);
});

test('cargo manifest survives authoritative ShipModel snapshot restore', async () => {
  const { s, ship } = await setup();
  const model = ship('cargo-ship', { general: 2, oil: 0 });
  const restored = s.ShipModel.restore(model.toSnapshot(), s.createShipCharacteristicsRegistry(s.validateConfigSource(readBaselineSource())));

  assert.deepEqual(restored.toSnapshot(), model.toSnapshot());
  assert.deepEqual(restored.cargo, { general: 2, oil: 0 });
});

test('classification distinguishes eligible, busy, and incompatible cargo', async () => {
  const { s, docks, ship } = await setup();
  const system = new s.DockSystem();
  const general = docks.require('dock_g');
  const container = docks.require('dock_c');
  const oil = docks.require('dock_o');

  assert.equal(system.classify(general, ship('general', { general: 1 })).status, 'eligible');
  assert.equal(system.classify(container, ship('wrong', { general: 1 })).status, 'incompatible');
  assert.equal(system.classify(oil, ship('oil', { oil: 1 })).status, 'eligible');
  assert.equal(system.classify(general, ship('mixed', { container: 2, general: 1 })).status, 'eligible');
  assert.equal(system.classify(general, ship('zero', { general: 0 })).status, 'incompatible');
});

test('reservation is owner-safe and busy is not wrong-dock incompatibility', async () => {
  const { s, docks, ship } = await setup();
  const system = new s.DockSystem();
  const dock = docks.require('dock_g');
  const owner = ship('owner', { general: 1 });
  const other = ship('other', { general: 1 });

  assert.equal(system.reserve(dock, owner).status, 'eligible');
  assert.equal(dock.reservedBy, owner.id);
  assert.equal(system.reserve(dock, other).status, 'busy');
  assert.equal(system.releaseReservation(dock, other.id), false);
  assert.equal(dock.reservedBy, owner.id);
  assert.equal(system.releaseReservation(dock, owner.id), true);
  assert.equal(dock.reservedBy, null);
});

test('occupied dock is busy, cannot be reserved, and runtime snapshot restores', async () => {
  const { s, docks, ship } = await setup();
  const system = new s.DockSystem();
  const dock = docks.require('dock_o');
  const owner = ship('owner', { oil: 1 });

  assert.equal(system.reserve(dock, owner).status, 'eligible');
  assert.equal(system.occupyReserved(dock, owner.id), true);
  assert.equal(dock.occupiedBy, owner.id);
  assert.equal(system.reserve(dock, ship('later', { oil: 1 })).status, 'busy');
  assert.equal(system.occupyReserved(dock, owner.id), false);
  const restored = s.DockModel.restore(dock.definition, dock.toRuntimeSnapshot());
  assert.deepEqual(restored.toRuntimeSnapshot(), dock.toRuntimeSnapshot());
});

test('COR-04 domain has no level-specific coordinates, random, Phaser, or Yandex dependency', () => {
  const source = [
    'src/docks/DockFactory.ts', 'src/docks/DockModel.ts', 'src/docks/DockSystem.ts',
  ].map((path) => readFileSync(path, 'utf8')).join('\n');
  assert.doesNotMatch(source, /Math\.random|Phaser|Yandex|dock_g|dock_c|dock_o|\b350\b|\b690\b/);
});
