import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

async function subject() {
  const [docks, ships, config, routes, camera, core] = await Promise.all([
    import('../src/docks/index.ts'), import('../src/ships/index.ts'),
    import('../src/config/validateConfigSource.ts'), import('../src/routes/index.ts'),
    import('../src/camera/SquareWorldViewport.ts'), import('../src/core/FixedStepClock.ts'),
  ]);
  return { ...docks, ...ships, ...config, ...routes, ...camera, ...core };
}

function definition(id, x, y, dockAngle = 0) {
  return {
    id, position: { x, y }, rotationDeg: dockAngle, dockAngle, snapRadius: 20,
    acceptedCargoTypes: ['general'], helperFlag: false, visualVariant: 'dock_general',
  };
}

async function setup(definitions = [definition('dock_a', 10, 0)]) {
  const s = await subject();
  const bundle = s.validateConfigSource(readBaselineSource());
  const docks = new s.DockCollection(definitions.map((value) => new s.DockModel(value)));
  const dockSystem = new s.DockSystem();
  const controller = new s.DockingController({ docks, dockSystem, config: s.createDockingConfig(bundle) });
  const characteristics = s.createShipCharacteristicsRegistry(bundle).require('speedboat');
  const ship = (id, x = 0, y = 0, rotationDeg = 0) => new s.ShipModel({
    id, characteristics, position: { x, y }, rotationDeg, state: s.ShipState.Navigating,
    cargo: { general: 1 },
  });
  return { s, bundle, docks, dockSystem, controller, ship };
}

function candidate(ship, spawnSequence) {
  return { ship, spawnSequence };
}

test('docking config reads every COR-05 machine field from validated balance.json', async () => {
  const { s, bundle } = await setup();
  const config = s.createDockingConfig(bundle);
  const docking = readBaselineSource().configs['balance.json'].docking;
  assert.deepEqual(config, docking);
});

test('only a compatible free ship inside snapRadius reserves and enters ApproachingDock', async () => {
  const { controller, docks, ship, s } = await setup();
  const outside = ship('outside', -11);
  const inside = ship('inside', 0);
  const wrong = ship('wrong', 0);
  wrong.setPositionXY(0, 0);
  wrong.setState(s.ShipState.Navigating);
  const wrongCargo = new s.ShipModel({ ...wrong.toSnapshot(), characteristics: wrong.characteristics, cargo: { oil: 1 } });

  controller.step([candidate(outside, 1)], 0);
  assert.equal(outside.state, s.ShipState.Navigating);
  assert.equal(docks.require('dock_a').reservedBy, null);
  controller.step([candidate(wrongCargo, 2)], 0);
  assert.equal(wrongCargo.state, s.ShipState.Navigating);
  controller.step([candidate(inside, 3)], 0);
  assert.equal(docks.require('dock_a').reservedBy, inside.id);
  assert.equal(inside.state, s.ShipState.ApproachingDock);
});

test('busy compatible dock leaves the loser state and route unchanged', async () => {
  const { controller, docks, ship, s } = await setup();
  const owner = ship('owner');
  const loser = ship('loser');
  loser.replaceRoute(new s.ShipRoute([{ x: 100, y: 0 }]));
  controller.step([candidate(owner, 1)], 0);
  controller.step([candidate(loser, 2)], 0);
  assert.equal(docks.require('dock_a').reservedBy, owner.id);
  assert.equal(loser.state, s.ShipState.Navigating);
  assert.deepEqual(loser.route.toSnapshot().points, [{ x: 100, y: 0 }]);
});

test('snap starts once, blocks route input by state, and completes with exact pose and occupancy', async () => {
  const { controller, docks, ship, s } = await setup([definition('dock_a', 10, 0, 0)]);
  const model = ship('ship', 0, 0, 359);
  controller.step([candidate(model, 1)], 0);
  assert.equal(model.state, s.ShipState.ApproachingDock);
  assert.equal(s.isRouteInputState(model.state), false);
  assert.equal(controller.isShipCollidable(model), true);
  assert.deepEqual(controller.step([candidate(model, 1)], 0).startedShipIds, ['ship']);
  assert.equal(model.state, s.ShipState.Docking);
  assert.equal(controller.isShipCollidable(model), true);
  model.replaceRoute(new s.ShipRoute([{ x: 100, y: 0 }]));
  const snapStart = model.position;
  new s.ShipMotor().stepRoute(model, 8, 1 / 60);
  assert.deepEqual(model.position, snapStart);
  const input = new s.RouteInputController({
    viewport: new s.SquareWorldViewport({ width: 1000, height: 1000 }),
    sampling: { sampleDistance: 8, maxRawPoints: 8 }, hitTest: () => model,
  });
  assert.deepEqual(input.pointerDown({ source: 'mouse', pointerId: 1, screenPosition: { x: 0, y: 0 }, viewport: { width: 1000, height: 1000 } }), { kind: 'ignored' });
  assert.equal(controller.step([candidate(model, 1)], 0.175).startedShipIds.length, 0);
  assert.ok(model.x > 0 && model.x < 10);
  assert.ok(model.rotationDeg > 359 && model.rotationDeg < 360);
  const complete = controller.step([candidate(model, 1)], 0.175);
  assert.deepEqual(complete.completedShipIds, ['ship']);
  assert.deepEqual(model.position, { x: 10, y: 0 });
  assert.equal(model.rotationDeg, 0);
  assert.equal(model.state, s.ShipState.Unloading);
  assert.equal(controller.isShipCollidable(model), false);
  assert.equal(docks.require('dock_a').reservedBy, null);
  assert.equal(docks.require('dock_a').occupiedBy, model.id);
  assert.deepEqual(controller.step([candidate(model, 1)], 1 / 60).completedShipIds, []);
});

test('one ship nominates nearest dock, then lexical id on an equal-distance tie', async () => {
  const nearest = await setup([definition('dock_a', 10, 0), definition('dock_b', 5, 0)]);
  const ship = nearest.ship('ship');
  nearest.controller.step([candidate(ship, 1)], 0);
  assert.equal(nearest.docks.require('dock_b').reservedBy, ship.id);
  assert.equal(nearest.docks.require('dock_a').reservedBy, null);

  const tied = await setup([definition('dock_z', -10, 0), definition('dock_a', 10, 0)]);
  const tiedShip = tied.ship('ship');
  tied.controller.step([candidate(tiedShip, 1)], 0);
  assert.equal(tied.docks.require('dock_a').reservedBy, tiedShip.id);
  assert.equal(tied.docks.require('dock_z').reservedBy, null);
});

test('arbitration is input-order independent and uses distance then spawnSequence', async () => {
  const run = async (shipOrder, dockOrder, equalDistance = false) => {
    const setupResult = await setup(dockOrder.map((id) => definition(id, 0, 0)));
    const first = setupResult.ship('first', equalDistance ? 2 : 4);
    const second = setupResult.ship('second', 2);
    const byId = { first, second };
    setupResult.controller.step(shipOrder.map((id) => candidate(byId[id], id === 'first' ? 4 : 9)), 0);
    return [...setupResult.docks.values()].map((dock) => [dock.id, dock.reservedBy]).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  };
  assert.deepEqual(await run(['first', 'second'], ['dock_a']), [['dock_a', 'second']]);
  assert.deepEqual(await run(['first', 'second'], ['dock_a']), await run(['second', 'first'], ['dock_a']));
  assert.deepEqual(await run(['first', 'second'], ['dock_a', 'dock_b']), await run(['first', 'second'], ['dock_b', 'dock_a']));
  const equal = await run(['second', 'first'], ['dock_a'], true);
  assert.deepEqual(equal, [['dock_a', 'first']]);
});

test('same-step loser does not fall back, but may nominate a newly free alternative next step', async () => {
  const { controller, docks, ship, s } = await setup([definition('dock_a', 0, 0), definition('dock_b', 10, 0)]);
  const winner = ship('winner', 1);
  const loser = ship('loser', 2);
  controller.step([candidate(loser, 9), candidate(winner, 1)], 0);
  assert.equal(docks.require('dock_a').reservedBy, winner.id);
  assert.equal(docks.require('dock_b').reservedBy, null);
  assert.equal(loser.state, s.ShipState.Navigating);
  controller.step([candidate(loser, 9), candidate(winner, 1)], 0);
  assert.equal(docks.require('dock_b').reservedBy, loser.id);
});

test('Destroyed active snap cancels transaction and releases its reservation without occupancy', async () => {
  const { controller, docks, ship, s } = await setup();
  const model = ship('ship');
  controller.step([candidate(model, 1)], 0);
  controller.step([candidate(model, 1)], 0);
  model.setState(s.ShipState.Destroyed);
  const result = controller.step([], 1 / 60);
  assert.deepEqual(result.cancelledShipIds, ['ship']);
  assert.equal(docks.require('dock_a').reservedBy, null);
  assert.equal(docks.require('dock_a').occupiedBy, null);
  assert.equal(model.state, s.ShipState.Destroyed);
});

test('active transaction progresses and completes when later arbitration candidates are empty', async () => {
  const { controller, docks, ship, s } = await setup();
  const model = ship('ship');
  controller.step([candidate(model, 1)], 0);
  assert.equal(docks.require('dock_a').reservedBy, model.id);
  const started = controller.step([], 0);
  assert.deepEqual(started.startedShipIds, ['ship']);
  assert.deepEqual(started.invariantShipIds, []);
  controller.step([], 0.175);
  assert.ok(model.x > 0 && model.x < 10);
  const complete = controller.step([], 0.175);
  assert.deepEqual(complete.invariantShipIds, []);
  assert.deepEqual(complete.completedShipIds, ['ship']);
  assert.deepEqual(model.position, { x: 10, y: 0 });
  assert.equal(docks.require('dock_a').reservedBy, null);
  assert.equal(docks.require('dock_a').occupiedBy, model.id);
  assert.equal(model.state, s.ShipState.Unloading);
});

test('30, 60, and 120 render partitions reach identical docking state, pose, and occupancy', async () => {
  const run = async (fps) => {
    const { s, controller, docks, ship } = await setup();
    const model = ship('ship');
    const clock = new s.FixedStepClock({ fixedHz: 60, maxCatchUpSteps: 6 });
    for (let frame = 0; frame < fps; frame += 1) {
      clock.advance(1000 / fps, (dt) => controller.step([candidate(model, 1)], dt));
    }
    return { ship: model.toSnapshot(), dock: docks.require('dock_a').toRuntimeSnapshot() };
  };
  const [at30, at60, at120] = await Promise.all([run(30), run(60), run(120)]);
  assert.deepEqual(at60, at30);
  assert.deepEqual(at120, at30);
});

test('COR-05 domain has no random, Phaser Tween, or Yandex dependency', () => {
  const source = ['src/docks/DockingConfig.ts', 'src/docks/DockingController.ts']
    .map((path) => readFileSync(path, 'utf8')).join('\n');
  assert.doesNotMatch(source, /Math\.random|Phaser|Yandex/);
});
