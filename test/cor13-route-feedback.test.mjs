import assert from 'node:assert/strict';
import test from 'node:test';

import { HarborRouteCoordinator } from '../src/runtime/HarborRouteCoordinator.ts';
import { PresentationPulseStore } from '../src/presentation/PresentationPulseStore.ts';
import { RouteCommitService } from '../src/routes/RouteCommitService.ts';
import { NavigationValidator } from '../src/routes/NavigationValidator.ts';
import { ShipModel } from '../src/ships/ShipModel.ts';
import { ShipState } from '../src/ships/ShipState.ts';

const characteristics = Object.freeze({
  type: 'test', speed: 100, turnRateDeg: 100, collisionRadius: 5,
  unloadStepMs: 500, warningRadius: 20, cargoCapacity: 1,
  pressureWeight: 1, spawnWeight: 1, defaultCargoTypes: Object.freeze(['general']),
});

function setup() {
  const ship = new ShipModel({ id: 'ship', characteristics, position: { x: 0, y: 0 },
    rotationDeg: 0, state: ShipState.Navigating, cargo: { general: 1 } });
  const pulses = new PresentationPulseStore();
  const routes = new RouteCommitService({ navigation: new NavigationValidator([]),
    config: { minValidRouteLength: 20, navigationClearanceExtra: 0 } });
  const coordinator = new HarborRouteCoordinator({
    routes,
    departure: { commit() { throw new Error('departure is not used'); } },
    resolveShip: () => ship,
    routeStartFor: () => ship.position,
    isCommitDeferred: () => false,
    onCommitResult: (shipId, result) => {
      if (result.kind === 'rejected_too_short' || result.kind === 'rejected_invalid' || result.kind === 'rejected_locked') {
        pulses.refreshRouteReject(shipId, result.kind, 0.75);
      }
    },
  });
  return { ship, pulses, coordinator };
}

test('COR-13 released rejected swipe creates visible rejection pulse instead of silent stall', () => {
  const { ship, pulses, coordinator } = setup();
  coordinator.enqueue({ shipId: ship.id, points: [{ x: 2, y: 0 }] });
  coordinator.applyPending();
  assert.equal(coordinator.lastCommitResult?.kind, 'rejected_too_short');
  assert.deepEqual(pulses.routeRejectSnapshot().map(({ shipId, kind }) => ({ shipId, kind })), [
    { shipId: ship.id, kind: 'rejected_too_short' },
  ]);
});

test('COR-13 live draft rejection is not pulsed before pointer release', () => {
  const { ship, pulses, coordinator } = setup();
  coordinator.setLiveDraft({ shipId: ship.id, points: [{ x: 2, y: 0 }] });
  coordinator.applyPending();
  assert.equal(coordinator.lastCommitResult?.kind, 'rejected_too_short');
  assert.deepEqual(pulses.routeRejectSnapshot(), []);
});

test('COR-13 committed route does not create rejection pulse', () => {
  const { ship, pulses, coordinator } = setup();
  coordinator.enqueue({ shipId: ship.id, points: [{ x: 100, y: 0 }] });
  coordinator.applyPending();
  assert.equal(coordinator.lastCommitResult?.kind, 'committed');
  assert.deepEqual(pulses.routeRejectSnapshot(), []);
});
