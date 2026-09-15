import assert from 'node:assert/strict';
import test from 'node:test';
import { ShipState, canTransitionShip } from '../src/ships/index.ts';

test('ship lifecycle rejects impossible transitions', () => {
  assert.equal(canTransitionShip(ShipState.Unloading, ShipState.Leaving, 'departure_started'), false);
  assert.equal(canTransitionShip(ShipState.ReadyToLeave, ShipState.ApproachingDock, 'dock_reserved'), false);
  assert.equal(canTransitionShip(ShipState.Destroyed, ShipState.Navigating, 'route_committed'), false);
});

test('ship lifecycle accepts canonical flow', () => {
  assert.equal(canTransitionShip(ShipState.Entering, ShipState.Navigating, 'route_committed'), true);
  assert.equal(canTransitionShip(ShipState.Navigating, ShipState.ApproachingDock, 'dock_reserved'), true);
  assert.equal(canTransitionShip(ShipState.ReadyToLeave, ShipState.Leaving, 'departure_started'), true);
});
