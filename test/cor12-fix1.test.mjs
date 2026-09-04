import assert from 'node:assert/strict';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

async function setup() {
  const [configModule, runtimeModule, shipsModule, routeModule, geometryModule, pulseModule, uiModule, exitModule, eventModule, gameSessionModule] = await Promise.all([
    import('../src/config/validateConfigSource.ts'),
    import('../src/runtime/HarborRuntime.ts'),
    import('../src/ships/index.ts'),
    import('../src/routes/index.ts'),
    import('../src/geometry/LandClearanceGeometry.ts'),
    import('../src/presentation/PresentationPulseStore.ts'),
    import('../src/presentation/HarborUiLayout.ts'),
    import('../src/exits/ExitSystem.ts'),
    import('../src/core/DomainEventQueue.ts'),
    import('../src/core/GameSession.ts'),
  ]);
  const source = readBaselineSource();
  const bundle = configModule.validateConfigSource(source);
  return {
    bundle,
    ...runtimeModule,
    ...shipsModule,
    ...routeModule,
    ...geometryModule,
    ...pulseModule,
    ...uiModule,
    ...exitModule,
    ...eventModule,
    ...gameSessionModule,
  };
}

function frameMs(fps = 60) {
  return 1000 / fps;
}

function advanceUntil(runtime, predicate, maxFrames = 1600, fps = 60) {
  for (let index = 0; index < maxFrames; index += 1) {
    runtime.advanceRender(frameMs(fps));
    const snapshot = runtime.presentationSnapshot();
    if (predicate(snapshot)) return snapshot;
  }
  throw new Error('condition was not reached');
}

function pointer(ship, screenPosition, pointerId = 1, viewport = { width: 1000, height: 1000 }) {
  return {
    source: 'mouse',
    pointerId,
    screenPosition,
    viewport,
  };
}

async function runtimeWithFirstShip(levelId = 'calm_01', attemptSeed = 12345) {
  const subject = await setup();
  const runtime = new subject.HarborRuntime({
    bundle: subject.bundle,
    levelId,
    attemptSeed,
  });
  const snapshot = advanceUntil(runtime, (value) => value.ships.length > 0);
  return { subject, runtime, snapshot, ship: snapshot.ships[0] };
}

function dockRuntime(overrides = {}) {
  return { id: 'dock-a', reservedBy: null, occupiedBy: null, ...overrides };
}

test('COR-12 FIX-1 #01 pointerMove finished queues route', async () => {
  const { runtime, ship } = await runtimeWithFirstShip();
  assert.equal(runtime.pointerDown(pointer(ship, ship.ship.position)).kind, 'started');
  runtime.pointerMove(pointer(ship, { x: 500, y: 700 }));
  const outcome = runtime.pointerMove(pointer(ship, { x: -1, y: 700 }));
  assert.equal(outcome.kind, 'finished');
  assert.equal(runtime.queuedRouteCommandCount, 1);
});

test('COR-12 FIX-1 #02 pointer leave queues exactly once', async () => {
  const { runtime, ship } = await runtimeWithFirstShip();
  runtime.pointerDown(pointer(ship, ship.ship.position));
  runtime.pointerMove(pointer(ship, { x: 500, y: 700 }));
  runtime.pointerMove(pointer(ship, { x: -1, y: 700 }));
  assert.equal(runtime.queuedRouteCommandCount, 1);
});

test('COR-12 FIX-1 #03 following pointerUp does not duplicate leave-finished command', async () => {
  const { runtime, ship } = await runtimeWithFirstShip();
  runtime.pointerDown(pointer(ship, ship.ship.position));
  runtime.pointerMove(pointer(ship, { x: 500, y: 700 }));
  runtime.pointerMove(pointer(ship, { x: -1, y: 700 }));
  assert.equal(runtime.pointerUp(pointer(ship, { x: -1, y: 700 })).kind, 'ignored');
  assert.equal(runtime.queuedRouteCommandCount, 1);
});

test('COR-12 FIX-1 #04 pointer-leave route waits for next fixed step before mutation', async () => {
  const { runtime, ship } = await runtimeWithFirstShip();
  runtime.pointerDown(pointer(ship, ship.ship.position));
  runtime.pointerMove(pointer(ship, { x: 500, y: 700 }));
  runtime.pointerMove(pointer(ship, { x: -1, y: 700 }));
  const before = runtime.presentationSnapshot().ships.find((candidate) => candidate.ship.id === ship.ship.id);
  assert.equal(before.ship.route, null);
  runtime.advanceRender(frameMs());
  const after = runtime.presentationSnapshot().ships.find((candidate) => candidate.ship.id === ship.ship.id);
  assert.notEqual(after.ship.route, null);
});

test('COR-12 FIX-1 #05 warning pulse exists after source warning', async () => {
  const { PresentationPulseStore } = await setup();
  const pulses = new PresentationPulseStore();
  pulses.refreshDanger('ship-b', 'ship-a', 0.45);
  assert.deepEqual(pulses.dangerSnapshot().map(({ shipAId, shipBId }) => [shipAId, shipBId]), [['ship-a', 'ship-b']]);
});

test('COR-12 FIX-1 #06 warning pulse persists across more than one fixed tick', async () => {
  const { PresentationPulseStore } = await setup();
  const pulses = new PresentationPulseStore();
  pulses.refreshDanger('a', 'b', 0.45);
  pulses.advance(1 / 60);
  pulses.advance(1 / 60);
  assert.equal(pulses.dangerSnapshot().length, 1);
});

test('COR-12 FIX-1 #07 warning pulse survives a 30 FPS two-tick render partition', async () => {
  const { PresentationPulseStore } = await setup();
  const pulses = new PresentationPulseStore();
  pulses.refreshDanger('a', 'b', 0.45);
  pulses.advance(2 / 60);
  assert.ok(pulses.dangerSnapshot()[0].remainingSeconds > 0);
});

test('COR-12 FIX-1 #08 warning pulse expires after TTL', async () => {
  const { PresentationPulseStore } = await setup();
  const pulses = new PresentationPulseStore();
  pulses.refreshDanger('a', 'b', 0.45);
  pulses.advance(0.451);
  assert.equal(pulses.dangerSnapshot().length, 0);
});

test('COR-12 FIX-1 #09 visual warning refresh does not increment gameplay metric twice', async () => {
  const { bundle, PresentationPulseStore, createGameSessionFromConfig } = await setup();
  const session = createGameSessionFromConfig(bundle, 'calm_07', 1);
  session.step({ deltaSeconds: 1 / 60, dangerWarningCount: 1 });
  const pulses = new PresentationPulseStore();
  pulses.refreshDanger('a', 'b', 0.45);
  pulses.refreshDanger('b', 'a', 0.45);
  pulses.advance(1 / 60);
  assert.equal(pulses.dangerSnapshot().length, 1);
  assert.equal(session.metricsSnapshot.warningCount, 1);
});

test('COR-12 FIX-1 #10 restart clears warning pulses', async () => {
  const { PresentationPulseStore } = await setup();
  const oldAttempt = new PresentationPulseStore();
  oldAttempt.refreshDanger('a', 'b', 0.45);
  const restartedAttempt = new PresentationPulseStore();
  assert.equal(restartedAttempt.dangerSnapshot().length, 0);
});

test('COR-12 FIX-1 #11 active preview splits valid and rejected route', async () => {
  const { runtime, ship } = await runtimeWithFirstShip('calm_07', 42);
  runtime.pointerDown(pointer(ship, ship.ship.position));
  runtime.pointerMove(pointer(ship, { x: 500, y: 500 }));
  const preview = runtime.presentationSnapshot().routePreview;
  assert.ok(preview);
  assert.equal(preview.rejectedPoints.length, 1);
});

test('COR-12 FIX-1 #12 calm_07 island crossing produces rejected suffix data', async () => {
  const { runtime, ship } = await runtimeWithFirstShip('calm_07', 42);
  runtime.pointerDown(pointer(ship, ship.ship.position));
  runtime.pointerMove(pointer(ship, { x: 500, y: 500 }));
  const preview = runtime.presentationSnapshot().routePreview;
  assert.deepEqual(preview.rejectedPoints, [{ x: 500, y: 500 }]);
});

test('COR-12 FIX-1 #13 preview equals same NavigationValidator contract', async () => {
  const { subject, runtime, ship } = await runtimeWithFirstShip('calm_07', 42);
  runtime.pointerDown(pointer(ship, ship.ship.position));
  runtime.pointerMove(pointer(ship, { x: 500, y: 500 }));
  const snapshot = runtime.presentationSnapshot();
  const restored = subject.ShipModel.restore(
    snapshot.ships[0].ship,
    subject.createShipCharacteristicsRegistry(subject.bundle),
  );
  const geometry = subject.createLandClearanceGeometryFromLevel(subject.bundle.levels.calm_07);
  const validator = new subject.NavigationValidator(geometry.polygons);
  const expected = validator.validate(
    restored,
    snapshot.activeDraft.points,
    subject.createRouteProcessingConfig(subject.bundle),
  );
  assert.deepEqual(snapshot.routePreview.validPoints, expected.validPoints);
  assert.deepEqual(snapshot.routePreview.rejectedPoints, expected.rejectedPoints);
});

test('COR-12 FIX-1 #14 preview does not mutate authoritative route', async () => {
  const { runtime, ship } = await runtimeWithFirstShip('calm_07', 42);
  runtime.pointerDown(pointer(ship, ship.ship.position));
  runtime.pointerMove(pointer(ship, { x: 500, y: 500 }));
  const active = runtime.presentationSnapshot().ships.find((candidate) => candidate.ship.id === ship.ship.id);
  assert.equal(active.ship.route, null);
});

test('COR-12 FIX-1 #15 cancel clears active preview', async () => {
  const { runtime, ship } = await runtimeWithFirstShip('calm_07', 42);
  runtime.pointerDown(pointer(ship, ship.ship.position));
  runtime.pointerMove(pointer(ship, { x: 500, y: 500 }));
  assert.ok(runtime.presentationSnapshot().routePreview);
  runtime.cancelActiveDraft();
  assert.equal(runtime.presentationSnapshot().routePreview, null);
});

test('COR-12 FIX-1 #16 reserved dock is explicitly busy in presentation contract', async () => {
  const { isDockPresentationBusy } = await setup();
  assert.equal(isDockPresentationBusy(dockRuntime({ reservedBy: 'ship-1' })), true);
});

test('COR-12 FIX-1 #17 free dock removes BUSY state', async () => {
  const { isDockPresentationBusy } = await setup();
  assert.equal(isDockPresentationBusy(dockRuntime()), false);
});

test('COR-12 FIX-1 #18 reservation is BUSY before occupancy', async () => {
  const { isDockPresentationBusy } = await setup();
  assert.equal(isDockPresentationBusy(dockRuntime({ reservedBy: 'ship-1', occupiedBy: null })), true);
  assert.equal(isDockPresentationBusy(dockRuntime({ reservedBy: null, occupiedBy: 'ship-1' })), true);
});

test('COR-12 FIX-1 #19 loaded exit reject creates cargo pulse', async () => {
  const subject = await setup();
  const registry = subject.createShipCharacteristicsRegistry(subject.bundle);
  const ship = new subject.ShipModel({
    id: 'loaded', characteristics: registry.require('cargo_boat'), position: { x: 20, y: 500 },
    rotationDeg: 180, state: subject.ShipState.Leaving, cargo: { general: 1 },
  });
  const events = new subject.DomainEventQueue();
  const exit = new subject.ExitSystem({ zones: [{ id: 'left', x: 20, y: 500, width: 40, height: 900, edge: 'left' }], score: 10, events });
  const result = exit.step([ship]);
  const pulses = new subject.PresentationPulseStore();
  for (const shipId of result.rejectedCargoShipIds) pulses.refreshCargoReject(shipId, 0.65);
  assert.deepEqual(pulses.cargoRejectSnapshot().map((pulse) => pulse.shipId), ['loaded']);
});

test('COR-12 FIX-1 #20 staying inside exit does not spam gameplay reject', async () => {
  const subject = await setup();
  const registry = subject.createShipCharacteristicsRegistry(subject.bundle);
  const ship = new subject.ShipModel({ id: 'loaded', characteristics: registry.require('cargo_boat'), position: { x: 20, y: 500 }, rotationDeg: 0, state: subject.ShipState.Leaving, cargo: { general: 1 } });
  const exit = new subject.ExitSystem({ zones: [{ id: 'left', x: 20, y: 500, width: 40, height: 900, edge: 'left' }], score: 10, events: new subject.DomainEventQueue() });
  assert.deepEqual(exit.step([ship]).rejectedCargoShipIds, ['loaded']);
  assert.deepEqual(exit.step([ship]).rejectedCargoShipIds, []);
});

test('COR-12 FIX-1 #21 leave and re-enter exit can create second cargo pulse source fact', async () => {
  const subject = await setup();
  const registry = subject.createShipCharacteristicsRegistry(subject.bundle);
  const ship = new subject.ShipModel({ id: 'loaded', characteristics: registry.require('cargo_boat'), position: { x: 20, y: 500 }, rotationDeg: 0, state: subject.ShipState.Leaving, cargo: { general: 1 } });
  const exit = new subject.ExitSystem({ zones: [{ id: 'left', x: 20, y: 500, width: 40, height: 900, edge: 'left' }], score: 10, events: new subject.DomainEventQueue() });
  assert.deepEqual(exit.step([ship]).rejectedCargoShipIds, ['loaded']);
  ship.setPositionXY(100, 500);
  exit.step([ship]);
  ship.setPositionXY(20, 500);
  assert.deepEqual(exit.step([ship]).rejectedCargoShipIds, ['loaded']);
});

test('COR-12 FIX-1 #22 successful empty exit has no cargo reject feedback', async () => {
  const subject = await setup();
  const registry = subject.createShipCharacteristicsRegistry(subject.bundle);
  const ship = new subject.ShipModel({ id: 'empty', characteristics: registry.require('cargo_boat'), position: { x: 20, y: 500 }, rotationDeg: 0, state: subject.ShipState.Leaving, cargo: {} });
  const exit = new subject.ExitSystem({ zones: [{ id: 'left', x: 20, y: 500, width: 40, height: 900, edge: 'left' }], score: 10, events: new subject.DomainEventQueue() });
  const first = exit.step([ship]);
  assert.deepEqual(first.rejectedCargoShipIds, []);
  assert.deepEqual(first.pendingShipIds, ['empty']);
});

test('COR-12 FIX-1 #23 resize-style draft cancellation keeps committed route', async () => {
  const { runtime, ship } = await runtimeWithFirstShip();
  runtime.enqueueRouteDraft({ shipId: ship.ship.id, points: [{ x: 500, y: 700 }] });
  runtime.advanceRender(frameMs());
  const committed = runtime.presentationSnapshot().ships[0].ship.route;
  runtime.pointerDown(pointer(runtime.presentationSnapshot().ships[0], runtime.presentationSnapshot().ships[0].ship.position));
  runtime.pointerMove(pointer(runtime.presentationSnapshot().ships[0], { x: 450, y: 650 }));
  runtime.cancelActiveDraft();
  assert.deepEqual(runtime.presentationSnapshot().ships[0].ship.route, committed);
});

test('COR-12 FIX-1 #24 resize-style cancellation clears active draft', async () => {
  const { runtime, ship } = await runtimeWithFirstShip();
  runtime.pointerDown(pointer(ship, ship.ship.position));
  runtime.pointerMove(pointer(ship, { x: 500, y: 700 }));
  assert.ok(runtime.presentationSnapshot().activeDraft);
  runtime.cancelActiveDraft();
  assert.equal(runtime.presentationSnapshot().activeDraft, null);
});

for (const [index, viewport] of [
  [25, { width: 1000, height: 1000 }],
  [26, { width: 1600, height: 900 }],
  [27, { width: 390, height: 844 }],
]) {
  test(`COR-12 FIX-1 #${index} UI layout stays inside ${viewport.width}x${viewport.height}`, async () => {
    const { createHarborUiLayout } = await setup();
    const layout = createHarborUiLayout(viewport);
    for (const point of [layout.hud, layout.terminalTitle, layout.terminalAction]) {
      assert.ok(point.x >= 0 && point.x <= viewport.width);
      assert.ok(point.y >= 0 && point.y <= viewport.height);
    }
    assert.ok(layout.hudMaxWidth <= viewport.width);
  });
}
