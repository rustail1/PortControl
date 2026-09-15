import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { DockCollection, DockModel } from '../src/docks/DockModel.ts';
import { DockSystem } from '../src/docks/DockSystem.ts';
import { DockingController } from '../src/docks/DockingController.ts';
import { DepartureCoordinator } from '../src/docks/DepartureCoordinator.ts';
import { NavigationValidator } from '../src/routes/NavigationValidator.ts';
import { RouteCommitService } from '../src/routes/RouteCommitService.ts';
import { ShipModel } from '../src/ships/ShipModel.ts';
import { ShipRoute } from '../src/ships/ShipRoute.ts';
import { ShipState } from '../src/ships/ShipState.ts';
import { SessionMetrics } from '../src/objectives/SessionMetrics.ts';

const characteristics = Object.freeze({
  type: 'speedboat', speed: 100, turnRateDeg: 140, collisionRadius: 5,
  unloadStepMs: 500, warningRadius: 20, cargoCapacity: 2,
  pressureWeight: 1, spawnWeight: 1, defaultCargoTypes: Object.freeze(['general']),
});

function readyShip(id = 'ship-1') {
  return new ShipModel({
    id, characteristics, position: { x: 0, y: 0 }, rotationDeg: 0,
    state: ShipState.ReadyToLeave, cargo: {},
  });
}

test('v1.7 departure validation failure leaves route/state/dock transaction untouched', () => {
  const ship = readyShip();
  const dock = new DockModel({
    id: 'dock', position: { x: 0, y: 0 }, rotationDeg: 0, dockAngle: 0,
    approachRadius: 10, acceptedCargoTypes: ['general'], helperFlag: false, visualVariant: 'test',
  }, { id: 'dock', reservedBy: null, occupiedBy: ship.id });
  const docking = new DockingController({
    docks: new DockCollection([dock]), dockSystem: new DockSystem(),
    config: { reservationTieBreak: 'distance', collisionEnabledDuringHarborAssist: true },
  });
  const routes = new RouteCommitService({
    navigation: new NavigationValidator([]), config: { minValidRouteLength: 1, navigationClearanceExtra: 0 },
  });
  const departure = new DepartureCoordinator({ routes, docking });
  const wrongStart = { x: 30, y: 0 };
  const prepared = {
    route: new ShipRoute([{ x: 50, y: 0 }], wrongStart), routeStart: wrongStart, progress: 0, kind: 'committed',
  };
  const result = departure.commit(ship, prepared);
  assert.equal(result.kind, 'rejected_locked');
  assert.equal(ship.state, ShipState.ReadyToLeave);
  assert.equal(ship.route, null);
  assert.equal(ship.routeMotionHeld, false);
  assert.equal(docking.isShipInManeuver(ship.id), false);
  assert.equal(dock.occupiedBy, ship.id);
});

test('v1.7 completed ships can be forgotten from per-ship metrics bookkeeping', () => {
  const metrics = new SessionMetrics({ serviceTimeThresholds: [95] });
  for (let index = 0; index < 200; index += 1) {
    const shipId = `ship-${index}`;
    metrics.registerSpawnedShip({ shipId, shipType: 'speedboat', initialCargo: { general: 1 } });
    assert.equal(metrics.recordExit({ shipId, shipType: 'speedboat', scoreDelta: 1 }, index / 10), true);
    metrics.forgetShip(shipId);
  }
  const snapshot = metrics.toSnapshot();
  assert.equal(snapshot.spawnedShipProvenance.length, 0);
  assert.equal(snapshot.countedExitShipIds.length, 0);
  assert.ok(snapshot.exitTimeline.length <= 64);
  assert.equal(metrics.servicedExitsAtOrBefore(95), 200);
});

test('v1.7 route render state is stable while ship advances inside one authored segment', async () => {
  const { createRouteRenderState } = await import('../src/presentation/RouteRenderState.ts');
  const ship = new ShipModel({
    id: 'route-ship', characteristics, position: { x: 0, y: 0 }, rotationDeg: 0,
    state: ShipState.Navigating, route: { start: { x: 0, y: 0 }, points: [{ x: 100, y: 0 }, { x: 100, y: 100 }] },
  });
  const before = createRouteRenderState(ship);
  ship.setPosition({ x: 40, y: 0 });
  ship.advanceRouteProgress(40);
  const withinSegment = createRouteRenderState(ship);
  assert.equal(withinSegment.key, before.key);
  assert.deepEqual(withinSegment.points[0], { x: 40, y: 0 });
  assert.deepEqual(withinSegment.points.slice(1), before.points.slice(1));

  ship.setPosition({ x: 100, y: 10 });
  ship.advanceRouteProgress(110);
  const nextSegment = createRouteRenderState(ship);
  assert.notEqual(nextSegment.key, before.key);
  assert.deepEqual(nextSegment.points[0], { x: 100, y: 10 });
  assert.deepEqual(nextSegment.points[1], { x: 100, y: 100 });
});

test('v1.7 snapshot phase drains projection events before capture', async () => {
  const { SimulationScheduler } = await import('../src/core/SimulationScheduler.ts');
  const order = [];
  const ports = {
    applyCommands(){ order.push('commands'); }, spawn(){ order.push('spawn'); }, hazards(){ order.push('hazards'); }, move(){ order.push('move'); },
    collision(){ order.push('collision'); return {}; }, grounding(){ order.push('grounding'); return {}; },
    applyTerminal(){ order.push('terminal'); return false; }, docking(){ order.push('docking'); return {}; }, cargo(){ order.push('cargo'); return {}; },
    exit(){ order.push('exit'); return {}; }, objective(){ order.push('objective'); }, capture(){ order.push('capture'); }, flush(){ order.push('flush'); },
  };
  new SimulationScheduler().step(1 / 60, ports);
  assert.ok(order.indexOf('flush') < order.indexOf('capture'), `order=${order.join(',')}`);
});

test('v1.7 typed runtime boundary removes raw level/config casts from orchestration hot path', () => {
  const runtime = readFileSync('src/runtime/HarborRuntime.ts', 'utf8');
  const collision = readFileSync('src/collision/CollisionSystem.ts', 'utf8');
  const exit = readFileSync('src/exits/ExitSystem.ts', 'utf8');
  const score = readFileSync('src/objectives/ScoreService.ts', 'utf8');
  const scene = readFileSync('src/scenes/HarborScene.ts', 'utf8');
  assert.doesNotMatch(runtime, /#level:\s*Record<string, unknown>/);
  assert.doesNotMatch(collision, /bundle\.configs\['balance\.json'\]\s+as/);
  assert.doesNotMatch(exit, /bundle\.configs\['balance\.json'\]\s+as/);
  assert.doesNotMatch(score, /bundle\.configs\['balance\.json'\]\s+as/);
  assert.doesNotMatch(scene, /bundle\.configs\['balance\.json'\]\s+as/);
});

test('v1.7 legacy gameplay tests no longer bypass ShipModel semantic lifecycle with setState', async () => {
  const { readdirSync } = await import('node:fs');
  const offenders = [];
  for (const file of readdirSync('test').filter((name) => name.endsWith('.test.mjs'))) {
    const source = readFileSync(`test/${file}`, 'utf8');
    for (const [index, line] of source.split('\n').entries()) {
      if (/\.setState\(/.test(line) && !/rng\.setState\(/.test(line)) offenders.push(`${file}:${index + 1}:${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('v1.7 grounding regressions assert terminal grounding instead of legacy recovery', () => {
  for (const file of ['test/cor12-fix3de.test.mjs', 'test/cor12-playable.test.mjs', 'test/cor12-fix2.test.mjs']) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /shore contact starts moving recovery without terminal grounding/);
    assert.doesNotMatch(source, /assert\.deepEqual\([^\n]*avoidedShipIds,\s*\[(?!\])/);
  }
});

test('v1.7 snapshot assembly and restore ownership is extracted from HarborRuntime facade', () => {
  const runtime = readFileSync('src/runtime/HarborRuntime.ts', 'utf8');
  const coordinator = readFileSync('src/runtime/HarborSnapshotCoordinator.ts', 'utf8');
  assert.match(runtime, /HarborSnapshotCoordinator/);
  assert.doesNotMatch(runtime, /const snapshot: SimulationSnapshot = Object\.freeze/);
  assert.match(coordinator, /captureSimulationSnapshot|capture\(/);
  assert.match(coordinator, /restore\(/);
  assert.ok(runtime.split('\n').length <= 760, `HarborRuntime remains too large: ${runtime.split('\n').length} lines`);
});
