import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { HarborRuntime } from '../src/runtime/HarborRuntime.ts';
import { ShipState } from '../src/ships/ShipState.ts';

const FRAME_MS = 1000 / 60;

function frozenBundle() {
  const root = join(import.meta.dirname, '..', 'Port_Control_Baseline_Source_FINAL_v1.5', 'src', 'config');
  const configs = {};
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    configs[entry.name] = JSON.parse(readFileSync(join(root, entry.name), 'utf8'));
  }
  const levels = {};
  for (const entry of readdirSync(join(root, 'levels'), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const level = JSON.parse(readFileSync(join(root, 'levels', entry.name), 'utf8'));
    levels[level.id] = level;
  }
  return Object.freeze({ configs: Object.freeze(configs), levels: Object.freeze(levels) });
}

function advanceUntilShip(runtime, maxFrames = 2400) {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    runtime.advanceRender(FRAME_MS);
    const ship = runtime.presentationSnapshot().ships[0]?.ship;
    if (ship !== undefined) return ship;
  }
  throw new Error('ship did not materialize');
}

function placeFirstShip(runtime, patch) {
  const snapshot = runtime.captureSimulationSnapshot();
  assert.ok(snapshot.ships.length > 0, 'precondition: active ship required');
  const [first, ...rest] = snapshot.ships;
  const ship = {
    ...first.ship,
    route: null,
    routeCursor: 0,
    routeProgress: 0,
    routeMotionHeld: false,
    state: ShipState.Navigating,
    ...patch,
  };
  delete ship.routeRecoveryHeadingDeg;
  delete ship.routePivotProgress;
  delete ship.routeTurnMode;
  delete ship.landRecoveryHeadingDeg;
  delete ship.landRecoveryTurnSign;
  delete ship.landRecoveryMotion;
  runtime.restoreSimulationSnapshot({
    ...snapshot,
    ships: [{ ...first, ship }, ...rest],
  });
  return ship.id;
}

test('LAND RECOVERY runtime turns before calm_07 island and avoids terminal grounding', () => {
  const runtime = new HarborRuntime({ bundle: frozenBundle(), levelId: 'calm_07', attemptSeed: 9191 });
  const spawned = advanceUntilShip(runtime);
  const shipId = placeFirstShip(runtime, {
    position: { x: 345, y: 500 },
    rotationDeg: 0,
    routeSpeed: spawned.shipType === 'speedboat' ? 150 : 68,
  });

  let sawRecovery = false;
  for (let frame = 0; frame < 600; frame += 1) {
    runtime.advanceRender(FRAME_MS);
    const snapshot = runtime.presentationSnapshot();
    assert.equal(snapshot.result?.kind === 'failed', false, `unexpected terminal failure at frame ${frame}`);
    const ship = snapshot.ships.find((entry) => entry.ship.id === shipId)?.ship;
    if (ship === undefined) break;
    if (ship.landRecoveryHeadingDeg !== undefined) sawRecovery = true;
    if (sawRecovery && ship.landRecoveryHeadingDeg === undefined && ship.rotationDeg > 90) {
      assert.ok(ship.position.x < 430, 'ship must remain west of island land polygon after recovery');
      return;
    }
  }
  assert.fail(`land recovery did not complete safely; sawRecovery=${sawRecovery}`);
});

test('LAND RECOVERY runtime defers queued route while recovery owns autonomous motion', () => {
  const runtime = new HarborRuntime({ bundle: frozenBundle(), levelId: 'calm_07', attemptSeed: 9292 });
  const spawned = advanceUntilShip(runtime);
  const shipId = placeFirstShip(runtime, {
    position: { x: 345, y: 500 },
    rotationDeg: 0,
    routeSpeed: spawned.shipType === 'speedboat' ? 150 : 68,
  });

  for (let frame = 0; frame < 30; frame += 1) {
    runtime.advanceRender(FRAME_MS);
    const ship = runtime.presentationSnapshot().ships.find((entry) => entry.ship.id === shipId)?.ship;
    if (ship?.landRecoveryHeadingDeg !== undefined) break;
  }
  const recovering = runtime.presentationSnapshot().ships.find((entry) => entry.ship.id === shipId)?.ship;
  assert.notEqual(recovering?.landRecoveryHeadingDeg, undefined, 'precondition: recovery must be active');

  runtime.enqueueRouteDraft(Object.freeze({
    shipId,
    points: Object.freeze([
      Object.freeze({ x: 250, y: 650 }),
      Object.freeze({ x: 180, y: 700 }),
    ]),
  }));
  runtime.advanceRender(FRAME_MS);
  assert.equal(runtime.queuedRouteCommandCount, 1, 'route commit must stay queued during land recovery');

  for (let frame = 0; frame < 600 && runtime.queuedRouteCommandCount > 0; frame += 1) {
    runtime.advanceRender(FRAME_MS);
  }
  assert.equal(runtime.queuedRouteCommandCount, 0, 'queued route should apply after land recovery finishes');
  const finalShip = runtime.presentationSnapshot().ships.find((entry) => entry.ship.id === shipId)?.ship;
  assert.notEqual(finalShip?.route, null, 'deferred authored route should become authoritative after recovery');
});

test('LAND RECOVERY real draw-to-island route is taken over early as a moving arc before the validated endpoint', () => {
  const runtime = new HarborRuntime({ bundle: frozenBundle(), levelId: 'calm_07', attemptSeed: 9393 });
  const spawned = advanceUntilShip(runtime);
  const speedByType = Object.freeze({ speedboat: 150, cargo_boat: 105, freighter: 68, tanker: 78 });
  const routeSpeed = speedByType[spawned.shipType] ?? 68;
  const shipId = placeFirstShip(runtime, {
    position: { x: 250, y: 500 },
    rotationDeg: 0,
    routeSpeed,
  });

  runtime.enqueueRouteDraft(Object.freeze({
    shipId,
    start: Object.freeze({ x: 250, y: 500 }),
    points: Object.freeze([
      Object.freeze({ x: 300, y: 500 }),
      Object.freeze({ x: 340, y: 500 }),
      Object.freeze({ x: 370, y: 500 }),
      Object.freeze({ x: 400, y: 500 }),
      Object.freeze({ x: 500, y: 500 }),
    ]),
  }));
  runtime.advanceRender(FRAME_MS);
  assert.equal(runtime.lastRouteCommitResult?.kind, 'partial_prefix_committed');

  for (let frame = 0; frame < 240; frame += 1) {
    runtime.advanceRender(FRAME_MS);
    const snapshot = runtime.presentationSnapshot();
    assert.equal(snapshot.result?.kind === 'failed', false, `unexpected terminal failure before recovery at frame ${frame}`);
    const ship = snapshot.ships.find((entry) => entry.ship.id === shipId)?.ship;
    assert.notEqual(ship, undefined);
    if (ship?.landRecoveryMotion !== undefined) {
      assert.equal(ship.landRecoveryMotion, 'arc', 'normal user draw-to-land case must not degrade to stationary emergency pivot');
      assert.ok(ship.position.x < 370, `recovery must take over before the too-close validated route endpoint, x=${ship.position.x}`);
      assert.equal(ship.route, null, 'hazard takeover clears the remaining authored tail instead of bending it');
      return;
    }
  }
  assert.fail('draw-to-island route never entered proactive land recovery');
});

test('LAND RECOVERY rebases a user-authored queued route to the real post-recovery ship position', () => {
  const runtime = new HarborRuntime({ bundle: frozenBundle(), levelId: 'calm_07', attemptSeed: 9494 });
  const spawned = advanceUntilShip(runtime);
  const shipId = placeFirstShip(runtime, {
    position: { x: 345, y: 500 },
    rotationDeg: 0,
    routeSpeed: spawned.shipType === 'speedboat' ? 150 : 68,
  });

  for (let frame = 0; frame < 60; frame += 1) {
    runtime.advanceRender(FRAME_MS);
    const ship = runtime.presentationSnapshot().ships.find((entry) => entry.ship.id === shipId)?.ship;
    if (ship?.landRecoveryHeadingDeg !== undefined) break;
  }
  const recovering = runtime.presentationSnapshot().ships.find((entry) => entry.ship.id === shipId)?.ship;
  assert.notEqual(recovering?.landRecoveryHeadingDeg, undefined, 'precondition: recovery must be active');
  const authoredStart = { ...recovering.position };

  runtime.enqueueRouteDraft(Object.freeze({
    shipId,
    start: Object.freeze({ ...authoredStart }),
    points: Object.freeze([
      Object.freeze({ x: authoredStart.x - 80, y: authoredStart.y }),
      Object.freeze({ x: authoredStart.x - 160, y: authoredStart.y }),
    ]),
  }));
  runtime.advanceRender(FRAME_MS);
  assert.equal(runtime.queuedRouteCommandCount, 1, 'route must remain queued while recovery owns movement');

  let previousShip = runtime.presentationSnapshot().ships.find((entry) => entry.ship.id === shipId)?.ship;
  assert.notEqual(previousShip, undefined);
  for (let frame = 0; frame < 600; frame += 1) {
    const queuedBefore = runtime.queuedRouteCommandCount;
    runtime.advanceRender(FRAME_MS);
    const currentShip = runtime.presentationSnapshot().ships.find((entry) => entry.ship.id === shipId)?.ship;
    assert.notEqual(currentShip, undefined);
    if (queuedBefore > 0 && runtime.queuedRouteCommandCount === 0) {
      const stepDistance = Math.hypot(
        currentShip.position.x - previousShip.position.x,
        currentShip.position.y - previousShip.position.y,
      );
      assert.ok(stepDistance <= 3, `deferred route commit must not teleport the ship; moved ${stepDistance.toFixed(3)} px in one fixed step`);
      assert.notEqual(currentShip.route, null);
      const routeStart = currentShip.route.start;
      assert.ok(
        Math.hypot(routeStart.x - previousShip.position.x, routeStart.y - previousShip.position.y) <= 1e-6,
        'queued route must be translated so its start is the real ship position when recovery releases authority',
      );
      assert.ok(
        Math.hypot(routeStart.x - authoredStart.x, routeStart.y - authoredStart.y) > 10,
        'regression precondition: ship must have moved far enough during recovery to require rebasing',
      );
      assert.equal(currentShip.route.points.length, 2);
      assert.ok(Math.abs(currentShip.route.points[0].x - (routeStart.x - 80)) <= 1e-6);
      assert.ok(Math.abs(currentShip.route.points[0].y - routeStart.y) <= 1e-6);
      assert.ok(Math.abs(currentShip.route.points[1].x - (routeStart.x - 160)) <= 1e-6);
      assert.ok(Math.abs(currentShip.route.points[1].y - routeStart.y) <= 1e-6);
      return;
    }
    previousShip = currentShip;
  }
  assert.fail('queued route never committed after land recovery');
});
