import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

async function loadSubject() {
  try {
    return await import('../src/ships/index.ts');
  } catch (error) {
    assert.fail(`COR-01 ship domain is unavailable: ${String(error)}`);
  }
}

async function createRegistry() {
  const [{ validateConfigSource }, subject] = await Promise.all([
    import('../src/config/validateConfigSource.ts'),
    loadSubject(),
  ]);
  return {
    subject,
    registry: subject.createShipCharacteristicsRegistry(
      validateConfigSource(readBaselineSource()),
    ),
  };
}

async function createShip(overrides = {}) {
  const { subject, registry } = await createRegistry();
  return {
    subject,
    ship: new subject.ShipModel({
      id: 'ship-001',
      characteristics: registry.require('speedboat'),
      position: { x: 10, y: 20 },
      rotationDeg: 0,
      state: subject.ShipState.Navigating,
      ...overrides,
    }),
    registry,
  };
}

test('ShipState exposes exactly the eight COR-01 states', async () => {
  const { ShipState } = await loadSubject();

  assert.deepEqual(Object.values(ShipState).sort(), [
    'ApproachingDock',
    'Destroyed',
    'Docking',
    'Entering',
    'Leaving',
    'Navigating',
    'ReadyToLeave',
    'Unloading',
  ]);
});

test('ShipModel snapshot and restore preserve authoritative simulation state', async () => {
  const { subject, ship, registry } = await createShip({
    id: 'ship-restore',
    position: { x: 125.5, y: 440.25 },
    rotationDeg: 315,
    state: (await loadSubject()).ShipState.ReadyToLeave,
  });

  const snapshot = ship.toSnapshot();
  const restored = subject.ShipModel.restore(snapshot, registry);

  assert.deepEqual(restored.toSnapshot(), snapshot);
  assert.equal(restored.characteristics, registry.require('speedboat'));
});

test('ShipModel gets speed and turn rate from validated ships.json', async () => {
  const { registry } = await createRegistry();
  const ships = readBaselineSource().configs['ships.json'].ships;
  const speedboat = registry.require('speedboat');

  assert.equal(speedboat.speed, ships.speedboat.speed);
  assert.equal(speedboat.turnRateDeg, ships.speedboat.turnRateDeg);
});

test('ShipMotor moves by speed multiplied by simulation dt', async () => {
  const { subject, ship } = await createShip();
  const motor = new subject.ShipMotor();

  motor.step(ship, { x: 1000, y: 20 }, 0.5);

  assert.deepEqual(ship.toSnapshot().position, { x: 85, y: 20 });
});

test('ShipMotor limits a single rotation step to turnRateDeg multiplied by dt', async () => {
  const { subject, ship } = await createShip();
  const motor = new subject.ShipMotor();

  motor.step(ship, { x: -990, y: 1020 }, 0.5);

  assert.equal(ship.rotationDeg, 110);
});

test('ShipMotor takes the shortest canonical turn across zero degrees', async () => {
  const { moveAngleTowardsDeg } = await loadSubject();

  assert.equal(moveAngleTowardsDeg(359, 0, 22), 0);
  assert.equal(moveAngleTowardsDeg(0, 359, 22), 359);
});

test('an equal simulation sequence produces an equal ShipModel snapshot', async () => {
  const run = async () => {
    const { subject, ship } = await createShip();
    const motor = new subject.ShipMotor();
    for (const target of [
      { x: 1000, y: 20 },
      { x: 1000, y: 1000 },
      { x: 10, y: 1000 },
    ]) {
      for (let step = 0; step < 10; step += 1) {
        motor.step(ship, target, 1 / 60);
      }
    }
    return ship.toSnapshot();
  };

  assert.deepEqual(await run(), await run());
});

test('different validated ship configs produce different motor behavior', async () => {
  const { subject, registry } = await createRegistry();
  const speedboat = new subject.ShipModel({
    id: 'speedboat', characteristics: registry.require('speedboat'),
    position: { x: 0, y: 0 }, rotationDeg: 0,
    state: subject.ShipState.Navigating,
  });
  const freighter = new subject.ShipModel({
    id: 'freighter', characteristics: registry.require('freighter'),
    position: { x: 0, y: 0 }, rotationDeg: 0,
    state: subject.ShipState.Navigating,
  });
  const motor = new subject.ShipMotor();

  motor.step(speedboat, { x: 0, y: 1000 }, 0.5);
  motor.step(freighter, { x: 0, y: 1000 }, 0.5);

  assert.notDeepEqual(speedboat.toSnapshot(), freighter.toSnapshot());
  assert.equal(speedboat.rotationDeg, 90);
  assert.equal(freighter.rotationDeg, 47.5);
});

test('Destroyed ship remains immobile under the ordinary ShipMotor', async () => {
  const { subject, ship } = await createShip({
    state: (await loadSubject()).ShipState.Destroyed,
    rotationDeg: 45,
  });
  const motor = new subject.ShipMotor();
  const before = ship.toSnapshot();

  motor.step(ship, { x: 1000, y: 1000 }, 1);

  assert.deepEqual(ship.toSnapshot(), before);
});

test('COR-01 domain code has no random, Phaser Tween, or Yandex SDK dependency', () => {
  const root = join(import.meta.dirname, '..', 'src', 'ships');
  const files = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'));
  const source = files.map((entry) => readFileSync(join(root, entry.name), 'utf8')).join('\n');

  assert.doesNotMatch(source, /Math\.random|Phaser|Tween|Yandex/i);
});
