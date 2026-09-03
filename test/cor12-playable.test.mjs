import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

async function subject() {
  const [runtime, validation, ships, routes, geometry, grounding, camera, gameSession] =
    await Promise.all([
      import('../src/runtime/HarborRuntime.ts'),
      import('../src/config/validateConfigSource.ts'),
      import('../src/ships/index.ts'),
      import('../src/routes/index.ts'),
      import('../src/geometry/LandClearanceGeometry.ts'),
      import('../src/grounding/GroundingSystem.ts'),
      import('../src/camera/SquareWorldViewport.ts'),
      import('../src/core/GameSession.ts'),
    ]);
  return { ...runtime, ...validation, ...ships, ...routes, ...geometry, ...grounding, ...camera, ...gameSession };
}

let setupPromise;
async function setup() {
  setupPromise ??= (async () => {
    const s = await subject();
    const bundle = s.validateConfigSource(readBaselineSource());
    const registry = s.createShipCharacteristicsRegistry(bundle);
    return { s, bundle, registry };
  })();
  return setupPromise;
}

const frameMs = (fps) => 1000 / fps;

function advance(runtime, frames, fps = 60) {
  for (let index = 0; index < frames; index += 1) {
    runtime.advanceRender(frameMs(fps));
  }
}

function advanceUntil(runtime, predicate, maxFrames = 12000, fps = 60) {
  for (let index = 0; index < maxFrames; index += 1) {
    if (predicate(runtime.presentationSnapshot())) return runtime.presentationSnapshot();
    runtime.advanceRender(frameMs(fps));
  }
  throw new Error('advanceUntil timed out');
}

function firstShip(snapshot) {
  return [...snapshot.ships].sort((a, b) => a.spawnSequence - b.spawnSequence)[0] ?? null;
}

function rawDraft(shipId, points) {
  return Object.freeze({
    shipId,
    points: Object.freeze(points.map((point) => Object.freeze({ ...point }))),
  });
}

function createShip(s, registry, id, state, position = { x: 500, y: 500 }, type = 'speedboat') {
  return new s.ShipModel({
    id,
    characteristics: registry.require(type),
    position,
    rotationDeg: 0,
    state,
    cargo: { general: 1 },
  });
}

function routeToDock(snapshot, ship) {
  const docks = [...snapshot.docks].sort(
    (a, b) => Math.abs(a.definition.position.x - ship.ship.position.x) - Math.abs(b.definition.position.x - ship.ship.position.x),
  );
  const dock = docks[0];
  assert.ok(dock);
  const x = dock.definition.position.x;
  if (ship.ship.position.y > 700) {
    return [{ x: ship.ship.position.x, y: 700 }, { x, y: 300 }, { x, y: dock.definition.position.y }];
  }
  return [
    { x: ship.ship.position.x < 500 ? 180 : 820, y: ship.ship.position.y },
    { x, y: 300 },
    { x, y: dock.definition.position.y },
  ];
}

function freeExitRoute(snapshot, ship) {
  const otherShips = snapshot.ships.filter((candidate) => candidate.ship.id !== ship.ship.id);
  const exits = snapshot.exits
    .map((exit) => ({
      exit,
      occupied: otherShips.some((candidate) => {
        const dx = candidate.ship.position.x - exit.x;
        const dy = candidate.ship.position.y - exit.y;
        return dx * dx + dy * dy < 140 * 140;
      }),
    }))
    .sort((a, b) => Number(a.occupied) - Number(b.occupied));
  const chosen = exits[0]?.exit;
  assert.ok(chosen);
  if (chosen.edge === 'left') {
    return [{ x: 250, y: 300 }, { x: 100, y: 420 }, { x: chosen.x, y: chosen.y }];
  }
  if (chosen.edge === 'right') {
    return [{ x: 750, y: 300 }, { x: 900, y: 420 }, { x: chosen.x, y: chosen.y }];
  }
  return [{ x: ship.ship.position.x, y: 400 }, { x: 500, y: 750 }, { x: chosen.x, y: chosen.y }];
}

function runCalm01ToCompletion(s, bundle, seed = 20260903) {
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: seed });
  const routedInbound = new Set();
  const routedOutbound = new Set();
  for (let frame = 0; frame < 15000; frame += 1) {
    const snapshot = runtime.presentationSnapshot();
    if (snapshot.result !== null) return runtime;

    const moving = snapshot.ships.find((ship) =>
      [
        s.ShipState.Navigating,
        s.ShipState.ApproachingDock,
        s.ShipState.Docking,
        s.ShipState.Unloading,
        s.ShipState.ReadyToLeave,
        s.ShipState.Leaving,
      ].includes(ship.ship.state),
    );
    const candidate = moving ?? [...snapshot.ships]
      .sort((a, b) => a.spawnSequence - b.spawnSequence)
      .find((ship) => ship.ship.state === s.ShipState.Entering);

    if (candidate?.ship.state === s.ShipState.Entering && !routedInbound.has(candidate.ship.id)) {
      runtime.enqueueRouteDraft(rawDraft(candidate.ship.id, routeToDock(snapshot, candidate)));
      routedInbound.add(candidate.ship.id);
    }
    if (candidate?.ship.state === s.ShipState.ReadyToLeave && !routedOutbound.has(candidate.ship.id)) {
      runtime.enqueueRouteDraft(rawDraft(candidate.ship.id, freeExitRoute(snapshot, candidate)));
      routedOutbound.add(candidate.ship.id);
    }
    runtime.advanceRender(frameMs(60));
  }
  throw new Error('calm_01 did not complete within integration budget');
}

function sourceFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

// A. RUNTIME COMPOSITION

test('COR-12 #01 HarborRuntime creates from real validated calm_07', async () => {
  const { s, bundle } = await setup();
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_07', attemptSeed: 7 });
  assert.equal(runtime.levelId, 'calm_07');
});

test('COR-12 #02 runtime presentation is sourced from frozen calm_07 layout', async () => {
  const { s, bundle } = await setup();
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_07', attemptSeed: 7 });
  const level = bundle.levels.calm_07;
  const authored = level.layout.blocks.filter((block) => block.enabled && block.blockType === 'shore_polygon').length;
  assert.equal(runtime.presentationSnapshot().land.length, authored);
});

test('COR-12 #03 calm_07 exposes exactly authored enabled docks', async () => {
  const { s, bundle } = await setup();
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_07', attemptSeed: 7 });
  assert.deepEqual(
    runtime.presentationSnapshot().docks.map((dock) => dock.definition.id),
    bundle.levels.calm_07.layout.blocks.filter((block) => block.enabled && block.blockType === 'dock').map((block) => block.id),
  );
});

test('COR-12 #04 calm_07 exposes exactly authored enabled SpawnPoints', async () => {
  const { s, bundle } = await setup();
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_07', attemptSeed: 7 });
  assert.deepEqual(
    runtime.presentationSnapshot().spawnPoints.map((point) => point.id),
    bundle.levels.calm_07.layout.blocks.filter((block) => block.enabled && block.blockType === 'spawn_point').map((block) => block.id),
  );
});

test('COR-12 #05 calm_07 allowed ships include speedboat cargo_boat freighter', async () => {
  const { s, bundle } = await setup();
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_07', attemptSeed: 7 });
  assert.deepEqual(runtime.allowedShipTypes, ['speedboat', 'cargo_boat', 'freighter']);
});

test('COR-12 #06 scripted calm_07 intro materializes freighter through SpawnDirector', async () => {
  const { s, bundle } = await setup();
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_07', attemptSeed: 7 });
  const snapshot = advanceUntil(runtime, (state) => state.ships.length > 0);
  assert.equal(firstShip(snapshot)?.ship.shipType, 'freighter');
});

// B. ROUTING

test('COR-12 #07 pointer completion queues a route command only', async () => {
  const { s, bundle } = await setup();
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 11 });
  const snapshot = advanceUntil(runtime, (state) => state.ships.length > 0);
  const ship = firstShip(snapshot);
  assert.ok(ship);
  const viewport = { width: 1000, height: 1000 };
  assert.equal(runtime.pointerDown({ source: 'mouse', pointerId: 1, screenPosition: ship.ship.position, viewport }).kind, 'started');
  runtime.pointerMove({ source: 'mouse', pointerId: 1, screenPosition: { x: 400, y: 500 }, viewport });
  assert.equal(runtime.pointerUp({ source: 'mouse', pointerId: 1, screenPosition: { x: 500, y: 500 }, viewport }).kind, 'finished');
  assert.equal(runtime.queuedRouteCommandCount, 1);
});

test('COR-12 #08 pointer-finished ship route is unchanged before next fixed step', async () => {
  const { s, bundle } = await setup();
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 12 });
  const snapshot = advanceUntil(runtime, (state) => state.ships.length > 0);
  const ship = firstShip(snapshot);
  assert.ok(ship);
  const viewport = { width: 1000, height: 1000 };
  runtime.pointerDown({ source: 'touch', pointerId: 4, screenPosition: ship.ship.position, viewport });
  runtime.pointerMove({ source: 'touch', pointerId: 4, screenPosition: { x: 400, y: 500 }, viewport });
  runtime.pointerUp({ source: 'touch', pointerId: 4, screenPosition: { x: 500, y: 500 }, viewport });
  assert.equal(firstShip(runtime.presentationSnapshot())?.ship.route, null);
});

test('COR-12 #09 queued route applies on fixed-step phase one', async () => {
  const { s, bundle } = await setup();
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 13 });
  const snapshot = advanceUntil(runtime, (state) => state.ships.length > 0);
  const ship = firstShip(snapshot);
  assert.ok(ship);
  runtime.enqueueRouteDraft(rawDraft(ship.ship.id, [{ x: 500, y: 500 }]));
  assert.equal(firstShip(runtime.presentationSnapshot())?.ship.route, null);
  runtime.advanceRender(frameMs(60));
  assert.notEqual(firstShip(runtime.presentationSnapshot())?.ship.route, null);
});

test('COR-12 #10 successful Entering route becomes Navigating', async () => {
  const { s, bundle } = await setup();
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 14 });
  const snapshot = advanceUntil(runtime, (state) => state.ships.length > 0);
  const ship = firstShip(snapshot);
  assert.ok(ship);
  runtime.enqueueRouteDraft(rawDraft(ship.ship.id, [{ x: 500, y: 500 }]));
  runtime.advanceRender(frameMs(60));
  assert.equal(firstShip(runtime.presentationSnapshot())?.ship.state, s.ShipState.Navigating);
});

test('COR-12 #11 rejected too-short Entering draft stays Entering', async () => {
  const { s, bundle } = await setup();
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 15 });
  const snapshot = advanceUntil(runtime, (state) => state.ships.length > 0);
  const ship = firstShip(snapshot);
  assert.ok(ship);
  runtime.enqueueRouteDraft(rawDraft(ship.ship.id, [{ x: ship.ship.position.x + 1, y: ship.ship.position.y }]));
  runtime.advanceRender(frameMs(60));
  assert.equal(firstShip(runtime.presentationSnapshot())?.ship.state, s.ShipState.Entering);
  assert.equal(runtime.lastRouteCommitResult?.kind, 'rejected_too_short');
});

test('COR-12 #12 redraw replaces existing committed route', async () => {
  const { s, bundle } = await setup();
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 16 });
  const snapshot = advanceUntil(runtime, (state) => state.ships.length > 0);
  const ship = firstShip(snapshot);
  assert.ok(ship);
  runtime.enqueueRouteDraft(rawDraft(ship.ship.id, [{ x: 400, y: 500 }]));
  runtime.advanceRender(frameMs(60));
  runtime.enqueueRouteDraft(rawDraft(ship.ship.id, [{ x: 700, y: 700 }]));
  runtime.advanceRender(frameMs(60));
  const route = firstShip(runtime.presentationSnapshot())?.ship.route?.points;
  assert.equal(route?.at(-1)?.x, 700);
});

test('COR-12 #13 overlap selection chooses nearest logical center', async () => {
  const { s, registry } = await setup();
  const near = createShip(s, registry, 'near', s.ShipState.Navigating, { x: 100, y: 100 });
  const far = createShip(s, registry, 'far', s.ShipState.Navigating, { x: 120, y: 100 });
  assert.equal(s.selectRouteInputShip([{ ship: far, spawnSequence: 1 }, { ship: near, spawnSequence: 2 }], { x: 102, y: 100 }, 1)?.id, 'near');
});

test('COR-12 #14 exact selection distance tie chooses lower spawnSequence', async () => {
  const { s, registry } = await setup();
  const left = createShip(s, registry, 'left', s.ShipState.Navigating, { x: 90, y: 100 });
  const right = createShip(s, registry, 'right', s.ShipState.Navigating, { x: 110, y: 100 });
  assert.equal(s.selectRouteInputShip([{ ship: left, spawnSequence: 5 }, { ship: right, spawnSequence: 2 }], { x: 100, y: 100 }, 1)?.id, 'right');
});

test('COR-12 #15 cancelling unfinished draft preserves committed route', async () => {
  const { s, bundle } = await setup();
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 17 });
  const snapshot = advanceUntil(runtime, (state) => state.ships.length > 0);
  const ship = firstShip(snapshot);
  assert.ok(ship);
  runtime.enqueueRouteDraft(rawDraft(ship.ship.id, [{ x: 450, y: 500 }]));
  runtime.advanceRender(frameMs(60));
  const before = firstShip(runtime.presentationSnapshot())?.ship.route;
  const viewport = { width: 1000, height: 1000 };
  const current = firstShip(runtime.presentationSnapshot());
  assert.ok(current);
  runtime.pointerDown({ source: 'touch', pointerId: 9, screenPosition: current.ship.position, viewport });
  runtime.pointerMove({ source: 'touch', pointerId: 9, screenPosition: { x: 600, y: 600 }, viewport });
  runtime.cancelActiveDraft();
  assert.deepEqual(firstShip(runtime.presentationSnapshot())?.ship.route, before);
});

// C. LIVE CORE FLOW

test('COR-12 #16 deterministic injected seed starts real frozen calm_01', async () => {
  const { s, bundle } = await setup();
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 1234 });
  assert.equal(runtime.attemptSeed, 1234);
  assert.equal(runtime.objectiveSnapshot().target, 6);
});

test('COR-12 #17 incoming indicator exists before first materialization', async () => {
  const { s, bundle } = await setup();
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 1234 });
  runtime.advanceRender(frameMs(60));
  const snapshot = runtime.presentationSnapshot();
  assert.equal(snapshot.ships.length, 0);
  assert.equal(snapshot.incoming.length, 1);
});

test('COR-12 #18 spawned real ship can receive a route command', async () => {
  const { s, bundle } = await setup();
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 1234 });
  const snapshot = advanceUntil(runtime, (state) => state.ships.length > 0);
  const ship = firstShip(snapshot);
  assert.ok(ship);
  runtime.enqueueRouteDraft(rawDraft(ship.ship.id, routeToDock(snapshot, ship)));
  runtime.advanceRender(frameMs(60));
  assert.notEqual(firstShip(runtime.presentationSnapshot())?.ship.route, null);
});

test('COR-12 #19 actual ShipMotor movement changes routed ship position', async () => {
  const { s, bundle } = await setup();
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 1234 });
  const snapshot = advanceUntil(runtime, (state) => state.ships.length > 0);
  const ship = firstShip(snapshot);
  assert.ok(ship);
  const start = { ...ship.ship.position };
  runtime.enqueueRouteDraft(rawDraft(ship.ship.id, routeToDock(snapshot, ship)));
  advance(runtime, 5);
  const moved = runtime.presentationSnapshot().ships.find((candidate) => candidate.ship.id === ship.ship.id);
  assert.ok(moved);
  assert.notDeepEqual(moved.ship.position, start);
});

test('COR-12 #20 real DockingController reaches Docking or Unloading', async () => {
  const { s, bundle } = await setup();
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 1234 });
  let snapshot = advanceUntil(runtime, (state) => state.ships.length > 0);
  const ship = firstShip(snapshot);
  assert.ok(ship);
  runtime.enqueueRouteDraft(rawDraft(ship.ship.id, routeToDock(snapshot, ship)));
  snapshot = advanceUntil(runtime, (state) => state.ships.some((candidate) => candidate.ship.id === ship.ship.id && [s.ShipState.Docking, s.ShipState.Unloading].includes(candidate.ship.state)), 5000);
  assert.ok(snapshot.ships.some((candidate) => candidate.ship.id === ship.ship.id));
});

test('COR-12 #21 actual CargoSystem removes cargo after authored unload timing', async () => {
  const { s, bundle } = await setup();
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 1234 });
  let snapshot = advanceUntil(runtime, (state) => state.ships.length > 0);
  const ship = firstShip(snapshot);
  assert.ok(ship);
  const initial = Object.values(ship.ship.cargo).reduce((sum, value) => sum + value, 0);
  runtime.enqueueRouteDraft(rawDraft(ship.ship.id, routeToDock(snapshot, ship)));
  snapshot = advanceUntil(runtime, (state) => state.objective.current > 0, 6000);
  assert.ok(snapshot.objective.current >= 1);
  assert.ok(initial >= 1);
});

test('COR-12 #22 cargo facts increment actual GameSession objective metrics', async () => {
  const { s, bundle } = await setup();
  const runtime = runCalm01ToCompletion(s, bundle, 2222);
  assert.equal(runtime.presentationSnapshot().objective.current, 6);
});

test('COR-12 #23 emptied serviced ship reaches ReadyToLeave before exit route', async () => {
  const { s, bundle } = await setup();
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 3333 });
  let snapshot = advanceUntil(runtime, (state) => state.ships.length > 0);
  const ship = firstShip(snapshot);
  assert.ok(ship);
  runtime.enqueueRouteDraft(rawDraft(ship.ship.id, routeToDock(snapshot, ship)));
  snapshot = advanceUntil(runtime, (state) => state.ships.some((candidate) => candidate.ship.id === ship.ship.id && candidate.ship.state === s.ShipState.ReadyToLeave), 7000);
  assert.equal(snapshot.ships.find((candidate) => candidate.ship.id === ship.ship.id)?.ship.cargo.general ?? 0, 0);
});

test('COR-12 #24 ReadyToLeave does not auto-exit without a new route', async () => {
  const { s, bundle } = await setup();
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 4444 });
  let snapshot = advanceUntil(runtime, (state) => state.ships.length > 0);
  const ship = firstShip(snapshot);
  assert.ok(ship);
  runtime.enqueueRouteDraft(rawDraft(ship.ship.id, routeToDock(snapshot, ship)));
  snapshot = advanceUntil(runtime, (state) => state.ships.some((candidate) => candidate.ship.id === ship.ship.id && candidate.ship.state === s.ShipState.ReadyToLeave), 7000);
  const before = snapshot.ships.find((candidate) => candidate.ship.id === ship.ship.id)?.ship.position;
  advance(runtime, 120);
  const after = runtime.presentationSnapshot().ships.find((candidate) => candidate.ship.id === ship.ship.id);
  assert.equal(after?.ship.state, s.ShipState.ReadyToLeave);
  assert.deepEqual(after?.ship.position, before);
});

test('COR-12 #25 manual outbound route transitions ReadyToLeave to Leaving', async () => {
  const { s, bundle } = await setup();
  const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 5555 });
  let snapshot = advanceUntil(runtime, (state) => state.ships.length > 0);
  const ship = firstShip(snapshot);
  assert.ok(ship);
  runtime.enqueueRouteDraft(rawDraft(ship.ship.id, routeToDock(snapshot, ship)));
  snapshot = advanceUntil(runtime, (state) => state.ships.some((candidate) => candidate.ship.id === ship.ship.id && candidate.ship.state === s.ShipState.ReadyToLeave), 7000);
  const ready = snapshot.ships.find((candidate) => candidate.ship.id === ship.ship.id);
  assert.ok(ready);
  runtime.enqueueRouteDraft(rawDraft(ship.ship.id, freeExitRoute(snapshot, ready)));
  runtime.advanceRender(frameMs(60));
  assert.equal(runtime.presentationSnapshot().ships.find((candidate) => candidate.ship.id === ship.ship.id)?.ship.state, s.ShipState.Leaving);
});

test('COR-12 #26 actual ExitSystem eventually removes successfully leaving ship', async () => {
  const { s, bundle } = await setup();
  const runtime = runCalm01ToCompletion(s, bundle, 6666);
  assert.ok(runtime.sessionSnapshot().metrics.servicedShipExits >= 1);
});

test('COR-12 #27 exit facts feed GameSession serviced exit metrics once', async () => {
  const { s, bundle } = await setup();
  const runtime = runCalm01ToCompletion(s, bundle, 7777);
  const metrics = runtime.sessionSnapshot().metrics;
  assert.equal(new Set(metrics.countedExitShipIds).size, metrics.countedExitShipIds.length);
  assert.equal(metrics.servicedShipExits, metrics.countedExitShipIds.length);
});

test('COR-12 #28 real calm_01 reaches its unmodified objective target', async () => {
  const { s, bundle } = await setup();
  const runtime = runCalm01ToCompletion(s, bundle, 8888);
  assert.equal(bundle.levels.calm_01.objective.target, 6);
  assert.ok(runtime.presentationSnapshot().objective.current >= 6);
});

test('COR-12 #29 full calm_01 integration result is Completed', async () => {
  const { s, bundle } = await setup();
  const result = runCalm01ToCompletion(s, bundle, 9999).presentationSnapshot().result;
  assert.equal(result?.kind, 'completed');
});

test('COR-12 #30 completion score and stars are frozen GameSession result values', async () => {
  const { s, bundle } = await setup();
  const runtime = runCalm01ToCompletion(s, bundle, 10101);
  const result = runtime.presentationSnapshot().result;
  assert.equal(result?.kind, 'completed');
  assert.equal(runtime.presentationSnapshot().score, result?.score);
  assert.ok(result && result.kind === 'completed' && result.starResults.length === 3);
});

// D. COLLISION / FAIL

test('COR-12 #31 actual collision candidates make GameSession fail', async () => {
  const { s, bundle, registry } = await setup();
  const session = s.createGameSessionFromConfig(bundle, 'calm_01', 1);
  const queue = new (await import('../src/core/DomainEventQueue.ts')).DomainEventQueue();
  const { CollisionSystem, createCollisionConfig } = await import('../src/collision/CollisionSystem.ts');
  const collision = new CollisionSystem({ events: queue, config: createCollisionConfig(bundle) });
  const one = createShip(s, registry, 'one', s.ShipState.Navigating, { x: 500, y: 500 });
  const two = createShip(s, registry, 'two', s.ShipState.Navigating, { x: 510, y: 500 });
  const terminal = collision.step([{ ship: one, spawnSequence: 1 }, { ship: two, spawnSequence: 2 }], 1 / 60).terminalCollision;
  session.step({ deltaSeconds: 1 / 60, collisionTerminal: terminal });
  assert.equal(session.result?.kind, 'failed');
  assert.equal(session.result?.kind === 'failed' ? session.result.failReason : null, 'collision');
});

test('COR-12 #32 collision terminal is emitted only once by CollisionSystem', async () => {
  const { s, bundle, registry } = await setup();
  const queue = new (await import('../src/core/DomainEventQueue.ts')).DomainEventQueue();
  const { CollisionSystem, createCollisionConfig } = await import('../src/collision/CollisionSystem.ts');
  const collision = new CollisionSystem({ events: queue, config: createCollisionConfig(bundle) });
  const one = createShip(s, registry, 'one', s.ShipState.Navigating, { x: 0, y: 0 });
  const two = createShip(s, registry, 'two', s.ShipState.Navigating, { x: 1, y: 0 });
  const input = [{ ship: one, spawnSequence: 1 }, { ship: two, spawnSequence: 2 }];
  assert.notEqual(collision.step(input, 0).terminalCollision, null);
  assert.equal(collision.step(input, 0).terminalCollision, null);
});

test('COR-12 #33 terminal GameSession does not accrue later gameplay time or score', async () => {
  const { s, bundle } = await setup();
  const session = s.createGameSessionFromConfig(bundle, 'calm_01', 1);
  session.step({ deltaSeconds: 1 / 60, groundingTerminal: { shipId: 'x', failReason: 'grounding' } });
  const before = session.toSnapshot();
  session.step({ deltaSeconds: 10, cargoUnloadedFacts: [{ shipId: 'x', shipType: 'speedboat', cargoType: 'general' }] });
  assert.deepEqual(session.toSnapshot(), before);
});

test('COR-12 #34 terminal same-step suppresses cargo exit and objective progression', async () => {
  const { s, bundle } = await setup();
  const session = s.createGameSessionFromConfig(bundle, 'calm_01', 1);
  session.step({
    deltaSeconds: 1 / 60,
    groundingTerminal: { shipId: 'x', failReason: 'grounding' },
    cargoUnloadedFacts: [{ shipId: 'x', shipType: 'speedboat', cargoType: 'general' }],
    exitedShipFacts: [{ shipId: 'x', shipType: 'speedboat', scoreDelta: 20 }],
  });
  assert.equal(session.metricsSnapshot.cargoUnloadedTotal, 0);
  assert.equal(session.metricsSnapshot.servicedShipExits, 0);
});

// E. GROUNDING

test('COR-12 #35 runtime grounding and NavigationValidator share exact clearance geometry', async () => {
  const { s, registry } = await setup();
  const geometry = new s.LandClearanceGeometry([{ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }]);
  const ship = createShip(s, registry, 'g', s.ShipState.Navigating, { x: -30, y: 120 });
  const navigation = new s.NavigationValidator(geometry.polygons);
  const config = { simplifyEpsilon: 0, minValidRouteLength: 1, waypointTolerance: 1, maxSimplifiedPoints: 10, navigationClearanceExtra: 4 };
  const planned = navigation.validate(ship, [{ x: 130, y: 120 }], config);
  const grounding = new s.GroundingSystem({ geometry, navigationClearanceExtra: 4 });
  ship.setPositionXY(130, 120);
  const runtime = grounding.resolve([{ ship, spawnSequence: 1, previousPosition: { x: -30, y: 120 } }]);
  assert.equal(planned.validPoints.length === 0, runtime.terminalGrounding !== null);
});

for (const [number, state] of [[36, 'Entering'], [37, 'Navigating'], [38, 'ApproachingDock'], [39, 'Leaving']]) {
  test(`COR-12 #${number} ${state} grounding is detectable`, async () => {
    const { s, registry } = await setup();
    const geometry = new s.LandClearanceGeometry([{ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }]);
    const ship = createShip(s, registry, `g-${state}`, s.ShipState[state], { x: -40, y: 50 });
    ship.setPositionXY(20, 50);
    const result = new s.GroundingSystem({ geometry, navigationClearanceExtra: 4 }).resolve([{ ship, spawnSequence: 1, previousPosition: { x: -40, y: 50 } }]);
    assert.equal(result.terminalGrounding?.failReason, 'grounding');
  });
}

test('COR-12 #40 Docking and Unloading are grounding-exempt during authored snap', async () => {
  const { s, registry } = await setup();
  const geometry = new s.LandClearanceGeometry([{ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }]);
  for (const state of [s.ShipState.Docking, s.ShipState.Unloading]) {
    const ship = createShip(s, registry, `e-${state}`, state, { x: 50, y: 50 });
    const result = new s.GroundingSystem({ geometry, navigationClearanceExtra: 4 }).resolve([{ ship, spawnSequence: 1, previousPosition: { x: 50, y: 50 } }]);
    assert.equal(result.terminalGrounding, null);
  }
});

test('COR-12 #41 collision terminal wins over grounding in GameSession same-step gate', async () => {
  const { s, bundle } = await setup();
  const session = s.createGameSessionFromConfig(bundle, 'calm_01', 1);
  session.step({
    deltaSeconds: 1 / 60,
    collisionTerminal: { shipAId: 'a', shipBId: 'b', distanceSquared: 0, failReason: 'collision' },
    groundingTerminal: { shipId: 'a', failReason: 'grounding' },
  });
  assert.equal(session.result?.kind === 'failed' ? session.result.failReason : null, 'collision');
});

// F. SPAWN / SEED / RESTART

test('COR-12 #42 failed Restart seed policy reuses exact attempt seed', async () => {
  const { s } = await setup();
  let calls = 0;
  assert.equal(s.selectNextAttemptSeed({ kind: 'failed' }, 4242, () => { calls += 1; return 9; }), 4242);
  assert.equal(calls, 0);
});

test('COR-12 #43 same seed reproduces same first spawn identity and type', async () => {
  const { s, bundle } = await setup();
  const run = () => {
    const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_07', attemptSeed: 77 });
    return firstShip(advanceUntil(runtime, (state) => state.ships.length > 0));
  };
  assert.deepEqual(run(), run());
});

test('COR-12 #44 same seed reproduces cargo and SpawnDirector progression', async () => {
  const { s, bundle } = await setup();
  const run = () => {
    const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_07', attemptSeed: 88 });
    advance(runtime, 300);
    const snapshot = runtime.authoritativeSnapshot();
    return { ships: snapshot.ships, director: snapshot.director, rng: snapshot.rngState };
  };
  assert.deepEqual(run(), run());
});

test('COR-12 #45 completed Play Again requests injected new seed provider', async () => {
  const { s } = await setup();
  let calls = 0;
  const seed = s.selectNextAttemptSeed({ kind: 'completed' }, 4, () => { calls += 1; return 9876; });
  assert.equal(seed, 9876);
  assert.equal(calls, 1);
});

test('COR-12 #46 COR-12 simulation/runtime production contains no Math.random', () => {
  const files = [
    'src/runtime/HarborRuntime.ts',
    'src/grounding/GroundingSystem.ts',
    'src/geometry/LandClearanceGeometry.ts',
  ];
  for (const file of files) assert.doesNotMatch(readFileSync(file, 'utf8'), /Math\.random/);
});

// G. FRAME-RATE DETERMINISM

test('COR-12 #47 real FixedStepClock 30 60 120 render partitions match authoritative runtime output', async () => {
  const { s, bundle } = await setup();
  const run = (fps) => {
    const runtime = new s.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 314159 });
    const totalFrames = fps * 8;
    for (let frame = 0; frame < totalFrames; frame += 1) {
      if (frame === Math.round(fps * 1.5)) {
        const ship = firstShip(runtime.presentationSnapshot());
        if (ship !== null) runtime.enqueueRouteDraft(rawDraft(ship.ship.id, [{ x: 500, y: 700 }]));
      }
      runtime.advanceRender(frameMs(fps));
    }
    return runtime.authoritativeSnapshot();
  };
  assert.deepEqual(run(30), run(60));
  assert.deepEqual(run(60), run(120));
});

// H. CLEANUP

test('COR-12 #48 successful despawn removes active ship exactly once', async () => {
  const { s, bundle } = await setup();
  const runtime = runCalm01ToCompletion(s, bundle, 2020);
  const metrics = runtime.sessionSnapshot().metrics;
  for (const shipId of metrics.countedExitShipIds) {
    assert.equal(runtime.presentationSnapshot().ships.some((ship) => ship.ship.id === shipId), false);
  }
});

test('COR-12 #49 despawned ship has no route or draft reference in presentation contract', async () => {
  const { s, bundle } = await setup();
  const runtime = runCalm01ToCompletion(s, bundle, 2021);
  const exited = runtime.sessionSnapshot().metrics.countedExitShipIds;
  assert.equal(runtime.presentationSnapshot().activeDraft, null);
  assert.equal(runtime.presentationSnapshot().ships.some((ship) => exited.includes(ship.ship.id)), false);
});

test('COR-12 #50 new runtime restart starts clean with no active ships or queued route commands', async () => {
  const { s, bundle } = await setup();
  const oldRuntime = new s.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 222 });
  oldRuntime.advanceRender(frameMs(60));
  const restarted = new s.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 222 });
  assert.equal(restarted.activeShipCount, 0);
  assert.equal(restarted.queuedRouteCommandCount, 0);
  assert.equal(restarted.presentationSnapshot().incoming.length, 0);
});

test('COR-12 #51 old incoming and collision presentation refs do not leak into restart instance', async () => {
  const { s, bundle } = await setup();
  const oldRuntime = new s.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 333 });
  oldRuntime.advanceRender(frameMs(60));
  assert.equal(oldRuntime.presentationSnapshot().incoming.length, 1);
  const restarted = new s.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 333 });
  assert.equal(restarted.presentationSnapshot().incoming.length, 0);
  assert.equal(restarted.presentationSnapshot().dangerPairs.length, 0);
});

// I. SCOPE GUARD

test('COR-12 #52 production COR-12 has no timers Yandex localStorage economy or manager singleton', () => {
  const files = [
    'src/runtime/HarborRuntime.ts',
    'src/grounding/GroundingSystem.ts',
    'src/geometry/LandClearanceGeometry.ts',
    'src/scenes/HarborScene.ts',
  ];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /setInterval|setTimeout|YaGames|Yandex|localStorage|GameManager|GodManager/);
  }
});

test('COR-12 #53 Frozen Baseline is unchanged by the COR-12 commit', () => {
  let changed = '';
  try {
    changed = execFileSync('git', ['diff', '--name-only', 'HEAD^', 'HEAD', '--', 'Port_Control_Baseline_Source_FINAL_v1.5'], { encoding: 'utf8' }).trim();
  } catch {
    changed = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'Port_Control_Baseline_Source_FINAL_v1.5'], { encoding: 'utf8' }).trim();
  }
  assert.equal(changed, '');
});

test('COR-12 #54 COR-13 and Current Storm Fog systems are absent from production src', () => {
  const files = sourceFiles('src');
  const names = files.join('\n');
  assert.doesNotMatch(names, /COR-13|CurrentSystem|StormSystem|FogSystem/i);
});

test('COR-12 #55 runtime contains no hardcoded calm_07 geometry or level-specific branch', () => {
  const source = readFileSync('src/runtime/HarborRuntime.ts', 'utf8');
  assert.doesNotMatch(source, /calm_07|if\s*\([^)]*levelId[^)]*===/);
  assert.doesNotMatch(source, /\b(290|710|975|585|415)\b/);
});
