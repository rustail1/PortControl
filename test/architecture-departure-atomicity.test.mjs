import assert from 'node:assert/strict';
import test from 'node:test';

import { DepartureCoordinator } from '../src/docks/DepartureCoordinator.ts';
import { DockCollection, DockModel } from '../src/docks/DockModel.ts';
import { DockingController } from '../src/docks/DockingController.ts';
import { DockSystem } from '../src/docks/DockSystem.ts';
import { NavigationValidator } from '../src/routes/NavigationValidator.ts';
import { RouteCommitService } from '../src/routes/RouteCommitService.ts';
import { ShipModel } from '../src/ships/ShipModel.ts';
import { ShipRoute } from '../src/ships/ShipRoute.ts';
import { ShipState } from '../src/ships/ShipState.ts';

function characteristics() {
  return Object.freeze({
    type: 'speedboat', speed: 100, turnRateDeg: 140, collisionRadius: 5,
    unloadStepMs: 500, warningRadius: 20, cargoCapacity: 1,
    pressureWeight: 1, spawnWeight: 1, defaultCargoTypes: Object.freeze(['general']),
  });
}

function setup() {
  const ship = new ShipModel({
    id: 'ship-1', characteristics: characteristics(), position: { x: 0, y: 0 },
    rotationDeg: 0, state: ShipState.ReadyToLeave, cargo: {},
  });
  const dock = new DockModel({
    id: 'dock-1', position: { x: 0, y: 0 }, rotationDeg: 0, dockAngle: 0,
    approachRadius: 10, acceptedCargoTypes: ['general'], helperFlag: false, visualVariant: 'test',
  }, { id: 'dock-1', reservedBy: null, occupiedBy: ship.id });
  const docking = new DockingController({
    docks: new DockCollection([dock]), dockSystem: new DockSystem(),
    config: { reservationTieBreak: 'distance', collisionEnabledDuringHarborAssist: true },
  });
  const routes = new RouteCommitService({
    navigation: new NavigationValidator([]),
    config: { minValidRouteLength: 1, navigationClearanceExtra: 0 },
  });
  return { ship, dock, docking, routes, coordinator: new DepartureCoordinator({ routes, docking }) };
}

test('AR-03 direct route commit cannot bypass the atomic departure coordinator', () => {
  const { ship, routes } = setup();
  const before = ship.toSnapshot();
  const result = routes.commit({
    ship,
    routeStart: { x: 10, y: 0 },
    draft: { shipId: ship.id, start: { x: 10, y: 0 }, points: [{ x: 30, y: 0 }] },
  });
  assert.equal(result.kind, 'rejected_locked');
  assert.deepEqual(ship.toSnapshot(), before);
});

test('AR-03 rejected departure leaves ship route, state and dock occupancy unchanged', () => {
  const { ship, dock, coordinator } = setup();
  const before = ship.toSnapshot();
  const invalidPrepared = Object.freeze({
    route: new ShipRoute([{ x: 40, y: 0 }], { x: 30, y: 0 }),
    routeStart: Object.freeze({ x: 30, y: 0 }), progress: 0, kind: 'committed',
  });
  const result = coordinator.commit(ship, invalidPrepared);
  assert.equal(result.kind, 'rejected_locked');
  assert.deepEqual(ship.toSnapshot(), before);
  assert.equal(dock.occupiedBy, ship.id);
});

test('AR-03 successful departure commits route, state and maneuver together', () => {
  const { ship, dock, docking, coordinator } = setup();
  const prepared = Object.freeze({
    route: new ShipRoute([{ x: 40, y: 0 }], { x: 10, y: 0 }),
    routeStart: Object.freeze({ x: 10, y: 0 }), progress: 0, kind: 'committed',
  });
  const result = coordinator.commit(ship, prepared);
  assert.equal(result.kind, 'committed');
  assert.equal(ship.state, ShipState.Leaving);
  assert.deepEqual(ship.route.toSnapshot().start, { x: 10, y: 0 });
  assert.equal(ship.routeMotionHeld, true);
  assert.equal(docking.isShipInManeuver(ship.id), true);
  assert.equal(dock.occupiedBy, ship.id);
});

test('AR-03 ReadyToLeave preparation always starts departure progress at zero', () => {
  const { ship, routes } = setup();
  ship.replaceRoute(new ShipRoute([{ x: 40, y: 0 }], { x: 10, y: 0 }), { x: 10, y: 0 }, 8);
  const prepared = routes.prepare({
    ship,
    routeStart: { x: 10, y: 0 },
    draft: { shipId: ship.id, start: { x: 10, y: 0 }, points: [{ x: 60, y: 0 }] },
  });
  assert.equal('route' in prepared, true);
  assert.equal(prepared.progress, 0);
});


test('AR-03 generic applyPrepared cannot mutate ReadyToLeave outside the departure coordinator', () => {
  const { ship, routes } = setup();
  const before = ship.toSnapshot();
  const prepared = Object.freeze({
    route: new ShipRoute([{ x: 40, y: 0 }], { x: 10, y: 0 }),
    routeStart: Object.freeze({ x: 10, y: 0 }), progress: 0, kind: 'committed',
  });
  assert.throws(() => routes.applyPrepared(ship, prepared), /DepartureCoordinator/);
  assert.deepEqual(ship.toSnapshot(), before);
});


test('AR-03 malformed nonzero departure progress is rejected before any mutation', () => {
  const { ship, dock, coordinator } = setup();
  const before = ship.toSnapshot();
  const malformed = Object.freeze({
    route: new ShipRoute([{ x: 40, y: 0 }], { x: 10, y: 0 }),
    routeStart: Object.freeze({ x: 10, y: 0 }), progress: 5, kind: 'committed',
  });
  const result = coordinator.commit(ship, malformed);
  assert.equal(result.kind, 'rejected_locked');
  assert.deepEqual(ship.toSnapshot(), before);
  assert.equal(dock.occupiedBy, ship.id);
});
