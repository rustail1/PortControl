import assert from 'node:assert/strict';
import test from 'node:test';
import { composeRoutePresentationTail, createRouteRenderState } from '../src/presentation/RouteRenderState.ts';
import { DockCollection, DockModel } from '../src/docks/DockModel.ts';
import { DockSystem } from '../src/docks/DockSystem.ts';
import { DockingController } from '../src/docks/DockingController.ts';
import { ShipRoute } from '../src/ships/ShipRoute.ts';
import { ShipModel } from '../src/ships/ShipModel.ts';
import { ShipState } from '../src/ships/ShipState.ts';

const characteristics = Object.freeze({ type: 'test', speed: 100, turnRateDeg: 100, collisionRadius: 5,
  unloadStepMs: 500, warningRadius: 20, cargoCapacity: 1, pressureWeight: 1, spawnWeight: 1,
  defaultCargoTypes: Object.freeze(['general']) });

test('COR-13 route dynamic head follows vessel while static tail dirty key stays stable', () => {
  const ship = new ShipModel({ id: 'ship', characteristics, position: { x: 0, y: 0 }, rotationDeg: 0,
    state: ShipState.Navigating, route: { start: { x: 0, y: 0 }, points: [{ x: 100, y: 0 }, { x: 100, y: 100 }] } });
  const before = createRouteRenderState(ship);
  ship.setPosition({ x: 40, y: 0 }); ship.advanceRouteProgress(40);
  const after = createRouteRenderState(ship);
  assert.equal(after.key, before.key);
  assert.deepEqual(after.points[0], ship.position);
  assert.deepEqual(after.points.slice(1), before.points.slice(1));
});


test('VIDEO FIX committed navigation route is hidden as soon as harbor assist owns the vessel', () => {
  const ship = new ShipModel({ id: 'docking-route', characteristics, position: { x: 80, y: 0 }, rotationDeg: 180,
    state: ShipState.Docking, route: { start: { x: 0, y: 0 }, points: [{ x: 100, y: 0 }, { x: 100, y: 100 }] } });

  const rendered = createRouteRenderState(ship);

  assert.equal(rendered.points, null, 'old navigation line must disappear while docking/harbor assist is authoritative');
});

test('VIDEO FIX departure presentation prefix follows berth -> alignment -> release before authored route', () => {
  const ship = new ShipModel({ id: 'departure-route', characteristics, position: { x: 0, y: 0 }, rotationDeg: 0,
    state: ShipState.ReadyToLeave, cargo: {} });
  const definition = { id: 'dock', position: { x: 0, y: 0 }, rotationDeg: 0, dockAngle: 0, approachRadius: 80,
    acceptedCargoTypes: ['general'], helperFlag: false, visualVariant: 'test' };
  const dock = new DockModel(definition, { id: 'dock', reservedBy: null, occupiedBy: ship.id });
  const docking = new DockingController({
    docks: new DockCollection([dock]),
    dockSystem: new DockSystem(),
    config: { reservationTieBreak: 'distance_then_spawn_sequence', collisionEnabledDuringHarborAssist: true },
  });
  const release = docking.departureRouteStart(ship);
  assert.deepEqual(release, { x: 80, y: 0 });
  const route = new ShipRoute([{ x: 180, y: 80 }], release);
  ship.replaceRoute(route, release, 0);
  ship.holdRouteMotion();
  const prefix = docking.departurePresentationPrefix(ship);

  const rendered = createRouteRenderState(ship, prefix);

  assert.deepEqual(prefix, [{ x: 44, y: 0 }, { x: 80, y: 0 }]);
  assert.deepEqual(rendered.points, [
    { x: 0, y: 0 },
    { x: 44, y: 0 },
    { x: 80, y: 0 },
    { x: 180, y: 80 },
  ]);
});


test('VIDEO FIX live departure preview keeps the assisted lane and de-duplicates the release point', () => {
  const points = composeRoutePresentationTail(
    [{ x: 44, y: 0 }, { x: 80, y: 0 }],
    [{ x: 80, y: 0 }, { x: 180, y: 80 }],
  );

  assert.deepEqual(points, [
    { x: 44, y: 0 },
    { x: 80, y: 0 },
    { x: 180, y: 80 },
  ]);
});
