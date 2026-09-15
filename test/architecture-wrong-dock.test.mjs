import assert from 'node:assert/strict';
import test from 'node:test';

import { DockCollection, DockModel } from '../src/docks/DockModel.ts';
import { DockingController } from '../src/docks/DockingController.ts';
import { DockSystem } from '../src/docks/DockSystem.ts';
import { ShipModel } from '../src/ships/ShipModel.ts';
import { ShipState } from '../src/ships/ShipState.ts';

const characteristics = Object.freeze({
  type: 'speedboat', speed: 100, turnRateDeg: 140, collisionRadius: 5,
  unloadStepMs: 500, warningRadius: 20, cargoCapacity: 1,
  pressureWeight: 1, spawnWeight: 1, defaultCargoTypes: Object.freeze(['general']),
});

function ship(id = 'ship-1') {
  return new ShipModel({ id, characteristics, position: { x: 30, y: 0 }, rotationDeg: 0,
    state: ShipState.Navigating, cargo: { general: 1 } });
}

function controllerFor(dock) {
  return new DockingController({
    docks: new DockCollection([dock]), dockSystem: new DockSystem(),
    config: { reservationTieBreak: 'distance', collisionEnabledDuringHarborAssist: true },
  });
}

test('AR-03 wrong dock counts only outside-to-inside incompatible crossings', () => {
  const subject = ship();
  const dock = new DockModel({ id: 'oil', position: { x: 0, y: 0 }, rotationDeg: 0, dockAngle: 0,
    approachRadius: 10, acceptedCargoTypes: ['oil'], helperFlag: false, visualVariant: 'test' });
  const controller = controllerFor(dock);
  const candidates = [{ ship: subject, spawnSequence: 1 }];

  assert.deepEqual(controller.step(candidates, 0).wrongDockAttemptFacts, []);
  subject.setPosition({ x: 10, y: 0 });
  assert.deepEqual(controller.step(candidates, 0).wrongDockAttemptFacts, [{ shipId: subject.id, dockId: dock.id }]);
  assert.deepEqual(controller.step(candidates, 0).wrongDockAttemptFacts, []);
  subject.setPosition({ x: 30, y: 0 });
  assert.deepEqual(controller.step(candidates, 0).wrongDockAttemptFacts, []);
  subject.setPosition({ x: 10, y: 0 });
  assert.deepEqual(controller.step(candidates, 0).wrongDockAttemptFacts, [{ shipId: subject.id, dockId: dock.id }]);
});

test('AR-03 compatible-but-busy dock is not a wrong-dock attempt', () => {
  const subject = ship();
  subject.setPosition({ x: 10, y: 0 });
  const dock = new DockModel({ id: 'general', position: { x: 0, y: 0 }, rotationDeg: 0, dockAngle: 0,
    approachRadius: 10, acceptedCargoTypes: ['general'], helperFlag: false, visualVariant: 'test' },
    { id: 'general', reservedBy: null, occupiedBy: 'other-ship' });
  const controller = controllerFor(dock);
  assert.deepEqual(controller.step([{ ship: subject, spawnSequence: 1 }], 0).wrongDockAttemptFacts, []);
});
