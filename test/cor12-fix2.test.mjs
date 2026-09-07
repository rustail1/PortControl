import assert from 'node:assert/strict';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

async function loadSubject() {
  const [camera, collision, config, core, grounding, routes, runtime, ships] =
    await Promise.all([
      import('../src/camera/SquareWorldViewport.ts'),
      import('../src/collision/CollisionSystem.ts'),
      import('../src/config/validateConfigSource.ts'),
      import('../src/core/FixedStepClock.ts'),
      import('../src/grounding/GroundingSystem.ts'),
      import('../src/routes/index.ts'),
      import('../src/runtime/HarborRuntime.ts'),
      import('../src/ships/index.ts'),
    ]);
  return { ...camera, ...collision, ...config, ...core, ...grounding, ...routes, ...runtime, ...ships };
}

function pointer(x, y, pointerId = 1, cssX = x, cssY = y) {
  return {
    source: 'mouse',
    pointerId,
    screenPosition: { x, y },
    cssPosition: { x: cssX, y: cssY },
    internalViewport: { width: 1000, height: 1000 },
    worldToCssPixelScale: 1,
  };
}

async function createInputSubject(state = 'Navigating', route = null) {
  const subject = await loadSubject();
  const bundle = subject.validateConfigSource(readBaselineSource());
  const registry = subject.createShipCharacteristicsRegistry(bundle);
  const ship = new subject.ShipModel({
    id: 'fix2-input',
    characteristics: registry.require('speedboat'),
    position: { x: 100, y: 100 },
    rotationDeg: 0,
    state: subject.ShipState[state],
    route,
    routeCursor: route === null ? 0 : 1,
  });
  const controller = new subject.RouteInputController({
    viewport: new subject.SquareWorldViewport({ width: 1000, height: 1000 }),
    sampling: { sampleDistance: 1, maxRawPoints: 256 },
    hitTest: () => ship,
  });
  return { subject, bundle, registry, ship, controller };
}

for (const displacement of [0, 1, 5, 11]) {
  test(`COR-12 FIX-2 tap/micro movement ${displacement}px never creates a route draft`, async () => {
    const { controller } = await createInputSubject();
    assert.deepEqual(controller.pointerDown(pointer(100, 100)), {
      kind: 'started',
      shipId: 'fix2-input',
    });
    assert.equal(controller.activeDraftSnapshot, null);
    if (displacement > 0) {
      assert.deepEqual(
        controller.pointerMove(pointer(100 + displacement, 100)),
        { kind: 'ignored' },
      );
      assert.equal(controller.activeDraftSnapshot, null);
    }

    assert.deepEqual(controller.pointerUp(pointer(100 + displacement, 100)), {
      kind: 'tapped',
      shipId: 'fix2-input',
    });
    assert.equal(controller.activePointerId, null);
  });
}

test('COR-12 FIX-2 exact 12px displacement activates direct route drawing', async () => {
  const { controller } = await createInputSubject();
  controller.pointerDown(pointer(100, 100));

  assert.deepEqual(controller.pointerMove(pointer(112, 100)), {
    kind: 'updated',
    pointCount: 1,
  });
  assert.deepEqual(controller.activeDraftSnapshot, {
    shipId: 'fix2-input',
    pointerId: 1,
    start: { x: 100, y: 100 },
    points: [{ x: 112, y: 100 }],
  });
  assert.equal(controller.pointerUp(pointer(124, 100)).kind, 'finished');
});

test('COR-12 FIX-2 pointerup at exact threshold activates even without a move event', async () => {
  const { controller } = await createInputSubject();
  controller.pointerDown(pointer(100, 100));

  assert.deepEqual(controller.pointerUp(pointer(112, 100)), {
    kind: 'finished',
    draft: { shipId: 'fix2-input', start: { x: 100, y: 100 }, points: [{ x: 112, y: 100 }] },
  });
});

test('COR-12 moving ship does not rewrite the world-anchored swipe', async () => {
  const { ship, controller } = await createInputSubject();
  controller.pointerDown(pointer(100, 100));
  controller.pointerMove(pointer(120, 100));

  ship.setPosition({ x: 130, y: 100 });
  controller.pointerMove(pointer(160, 100));

  assert.deepEqual(controller.activeDraftSnapshot, {
    shipId: ship.id,
    pointerId: 1,
    start: { x: 100, y: 100 },
    points: [{ x: 120, y: 100 }, { x: 160, y: 100 }],
  });
  assert.deepEqual(controller.pointerUp(pointer(180, 100)), {
    kind: 'finished',
    draft: {
      shipId: ship.id,
      start: { x: 100, y: 100 },
      points: [{ x: 120, y: 100 }, { x: 160, y: 100 }, { x: 180, y: 100 }],
    },
  });
});

test('COR-12 held preview clips its travelled tail without moving future points', async () => {
  const subject = await loadSubject();
  const bundle = subject.validateConfigSource(readBaselineSource());
  const runtime = new subject.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 123 });
  let snapshot;
  for (let frame = 0; frame < 1600; frame += 1) {
    runtime.advanceRender(1000 / 60);
    snapshot = runtime.presentationSnapshot();
    if (snapshot.ships.length > 0) break;
  }
  const ship = snapshot.ships[0].ship;
  const radians = ship.rotationDeg * Math.PI / 180;
  const first = {
    x: ship.position.x + Math.cos(radians) * 12,
    y: ship.position.y + Math.sin(radians) * 12,
  };
  const last = {
    x: ship.position.x + Math.cos(radians) * 120,
    y: ship.position.y + Math.sin(radians) * 120,
  };
  runtime.pointerDown(pointer(ship.position.x, ship.position.y));
  runtime.pointerMove(pointer(first.x, first.y));
  runtime.pointerMove(pointer(last.x, last.y));
  const beforeMovement = runtime.presentationSnapshot();
  const draftBeforeMovement = beforeMovement.activeDraft;

  for (let frame = 0; frame < 60; frame += 1) runtime.advanceRender(1000 / 60);

  const afterMovement = runtime.presentationSnapshot();
  const movedShip = afterMovement.ships.find(({ ship: candidate }) => candidate.id === ship.id).ship;
  assert.deepEqual(afterMovement.activeDraft, draftBeforeMovement);
  assert.deepEqual(afterMovement.routePreview.start, movedShip.position);
  assert.deepEqual(afterMovement.routePreview.validPoints.at(-1), last);
  assert.notDeepEqual(afterMovement.routePreview.start, beforeMovement.routePreview.start);
});

test('COR-12 FIX-3B off-axis movement does not consume an unvisited first bend', async () => {
  const { ship, controller } = await createInputSubject();
  controller.pointerDown(pointer(100, 100));
  controller.pointerMove(pointer(200, 100));
  controller.pointerMove(pointer(200, 300));

  ship.setPosition({ x: 220, y: 140 });

  assert.deepEqual(controller.activeDraftSnapshot.start, { x: 100, y: 100 });
  assert.deepEqual(controller.activeDraftSnapshot.points, [{ x: 200, y: 100 }, { x: 200, y: 300 }]);
});

test('COR-12 FIX-3B self-crossing swipe cannot skip to a later branch', async () => {
  const { ship, controller } = await createInputSubject();
  const points = [
    { x: 200, y: 200 },
    { x: 100, y: 200 },
    { x: 200, y: 100 },
    { x: 100, y: 100 },
  ];
  controller.pointerDown(pointer(100, 100));
  for (const point of points) controller.pointerMove(pointer(point.x, point.y));

  ship.setPosition({ x: 150, y: 150 });

  assert.deepEqual(controller.activeDraftSnapshot.points, points);
});

test('COR-12 FIX-3B capped draft keeps its route when the boundary endpoint replaces geometry', async () => {
  const { subject, ship } = await createInputSubject();
  ship.setPosition({ x: 500, y: 100 });
  const controller = new subject.RouteInputController({
    viewport: new subject.SquareWorldViewport({ width: 1000, height: 1000 }),
    sampling: { sampleDistance: 1, maxRawPoints: 2 },
    hitTest: () => ship,
  });
  controller.pointerDown(pointer(500, 100));
  controller.pointerMove(pointer(100, 100));
  controller.pointerMove(pointer(900, 100));
  ship.setPosition({ x: 100, y: 100 });
  ship.setPosition({ x: 400, y: 100 });
  assert.deepEqual(controller.activeDraftSnapshot.points, [{ x: 100, y: 100 }, { x: 900, y: 100 }]);

  assert.deepEqual(controller.pointerMove(pointer(-100, 100)), {
    kind: 'finished',
    draft: {
      shipId: ship.id,
      start: { x: 500, y: 100 },
      points: [{ x: 100, y: 100 }, { x: 0, y: 100 }],
    },
  });
});

for (const state of ['Entering', 'ReadyToLeave']) {
  test(`COR-12 FIX-2 tap leaves ${state} state and route unchanged`, async () => {
    const existingRoute = { points: [{ x: 200, y: 100 }, { x: 300, y: 100 }] };
    const { ship, controller } = await createInputSubject(state, existingRoute);
    const before = ship.toSnapshot();

    for (let click = 0; click < 3; click += 1) {
      controller.pointerDown(pointer(100, 100, click + 1));
      assert.equal(controller.pointerUp(pointer(100, 100, click + 1)).kind, 'tapped');
    }

    assert.deepEqual(ship.toSnapshot(), before);
  });
}

test('COR-12 FIX-2 runtime tap selects without queueing or mutating Entering', async () => {
  const subject = await loadSubject();
  const bundle = subject.validateConfigSource(readBaselineSource());
  const runtime = new subject.HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 123 });
  let snapshot;
  for (let frame = 0; frame < 1600; frame += 1) {
    runtime.advanceRender(1000 / 60);
    snapshot = runtime.presentationSnapshot();
    if (snapshot.ships.length > 0) break;
  }
  const ship = snapshot.ships[0].ship;
  const before = structuredClone(ship);

  runtime.pointerDown(pointer(ship.position.x, ship.position.y));
  assert.equal(runtime.pointerUp(pointer(ship.position.x, ship.position.y)).kind, 'tapped');

  assert.equal(runtime.queuedRouteCommandCount, 0);
  assert.equal(runtime.presentationSnapshot().selectedShipId, ship.id);
  assert.deepEqual(runtime.presentationSnapshot().ships[0].ship, before);
});

test('COR-12 activated redraw cancellation seals the drawn replacement route', async () => {
  const existingRoute = { points: [{ x: 200, y: 100 }, { x: 300, y: 100 }] };
  const { ship, controller } = await createInputSubject('Navigating', existingRoute);
  controller.pointerDown(pointer(100, 100));
  controller.pointerMove(pointer(150, 100));

  assert.deepEqual(controller.cancelActiveDraft(), {
    kind: 'finished',
    draft: {
      shipId: ship.id,
      start: { x: 100, y: 100 },
      points: [{ x: 150, y: 100 }],
    },
  });
});

test('COR-12 FIX-2 micro-drag cannot create a waypoint orbit', async () => {
  const { subject, ship, controller } = await createInputSubject('Navigating');
  const before = ship.toSnapshot();
  controller.pointerDown(pointer(100, 100));
  assert.equal(controller.pointerUp(pointer(111, 100)).kind, 'tapped');
  const motor = new subject.ShipMotor();
  for (let step = 0; step < 600; step += 1) {
    motor.stepRoute(ship, 8, 1 / 60);
  }

  assert.equal(ship.route, null);
  assert.equal(ship.routeCursor, before.routeCursor);
  assert.equal(ship.state, before.state);
  assert.equal(ship.rotationDeg, before.rotationDeg);
  assert.ok(ship.x > before.position.x);
  assert.equal(ship.y, before.position.y);
});

test('COR-12 FIX-2 route-less Entering moves exactly speed times dt at cardinal headings', async () => {
  const subject = await loadSubject();
  const bundle = subject.validateConfigSource(readBaselineSource());
  const registry = subject.createShipCharacteristicsRegistry(bundle);
  const motor = new subject.ShipMotor();
  const expectedByRotation = new Map([
    [0, { x: 75, y: 0 }],
    [90, { x: 0, y: 75 }],
    [180, { x: -75, y: 0 }],
    [270, { x: 0, y: -75 }],
  ]);

  for (const [rotationDeg, expected] of expectedByRotation) {
    const ship = new subject.ShipModel({
      id: `entering-${rotationDeg}`,
      characteristics: registry.require('speedboat'),
      position: { x: 0, y: 0 },
      rotationDeg,
      state: subject.ShipState.Entering,
    });
    motor.stepRoute(ship, 8, 0.5);
    assert.ok(Math.abs(ship.x - expected.x) < 1e-9);
    assert.ok(Math.abs(ship.y - expected.y) < 1e-9);
    assert.equal(ship.rotationDeg, rotationDeg);
    assert.equal(ship.route, null);
    assert.equal(ship.state, subject.ShipState.Entering);
  }
});

test('COR-12 FIX-2 route-less Entering auto-motion is render-partition deterministic', async () => {
  const run = async (fps) => {
    const subject = await loadSubject();
    const bundle = subject.validateConfigSource(readBaselineSource());
    const registry = subject.createShipCharacteristicsRegistry(bundle);
    const ship = new subject.ShipModel({
      id: `entering-${fps}`,
      characteristics: registry.require('freighter'),
      position: { x: 500, y: 975 },
      rotationDeg: 270,
      state: subject.ShipState.Entering,
    });
    const motor = new subject.ShipMotor();
    const clock = new subject.FixedStepClock({ fixedHz: 60, maxCatchUpSteps: 6 });
    for (let frame = 0; frame < fps * 2; frame += 1) {
      clock.advance(1000 / fps, (dt) => motor.stepRoute(ship, 8, dt));
    }
    assert.ok(Math.abs(ship.y - (975 - ship.characteristics.speed * 2)) < 1e-9);
    return ship.toSnapshot();
  };

  const at30 = await run(30);
  for (const actual of [await run(60), await run(120)]) {
    assert.ok(Math.abs(actual.position.x - at30.position.x) < 1e-9);
    assert.ok(Math.abs(actual.position.y - at30.position.y) < 1e-9);
    assert.equal(actual.rotationDeg, at30.rotationDeg);
    assert.equal(actual.state, at30.state);
    assert.equal(actual.route, null);
  }
});

test('COR-12 FIX-2 committed user route takes ownership after Entering auto-motion', async () => {
  const { subject, bundle, ship } = await createInputSubject('Entering');
  const motor = new subject.ShipMotor();
  motor.stepRoute(ship, 8, 0.5);
  const afterAutomaticEntry = ship.position;
  assert.ok(Math.abs(afterAutomaticEntry.x - 175) < 1e-9);
  const config = subject.createRouteProcessingConfig(bundle);
  const commit = new subject.RouteCommitService({
    navigation: new subject.NavigationValidator([]),
    config,
  });

  assert.equal(
    commit.commit({
      ship,
      draft: { shipId: ship.id, points: [{ x: ship.x + 100, y: ship.y }] },
    }).kind,
    'committed',
  );
  assert.equal(ship.state, subject.ShipState.Navigating);
  motor.stepRoute(ship, config.waypointTolerance, 0.5);
  assert.ok(ship.x > afterAutomaticEntry.x);
  assert.deepEqual(ship.route.toSnapshot(), {
    points: [{ x: afterAutomaticEntry.x + 100, y: afterAutomaticEntry.y }],
    start: afterAutomaticEntry,
  });
});

test('COR-12 FIX-2 ignored route-less Entering remains collision and grounding eligible', async () => {
  const { subject, registry, ship } = await createInputSubject('Entering');
  const other = new subject.ShipModel({
    id: 'other-entering',
    characteristics: registry.require('speedboat'),
    position: ship.position,
    rotationDeg: ship.rotationDeg,
    state: subject.ShipState.Entering,
  });
  const events = new (await import('../src/core/DomainEventQueue.ts')).DomainEventQueue();
  const collision = new subject.CollisionSystem({
    events,
    config: { warningRearmOutsideMs: 1000 },
  });
  assert.notEqual(
    collision.step(
      [{ ship, spawnSequence: 0 }, { ship: other, spawnSequence: 1 }],
      1 / 60,
    ).terminalCollision,
    null,
  );

  const previousPosition = ship.position;
  new subject.ShipMotor().stepRoute(ship, 8, 1 / 60);
  assert.notDeepEqual(ship.position, previousPosition);
  const grounding = new subject.GroundingSystem({
    geometry: { blocksSegment: () => true },
    navigationClearanceExtra: 4,
  });
  const groundingResult = grounding.resolve([
    { ship, spawnSequence: 0, previousPosition },
  ]);
  assert.equal(groundingResult.terminalGrounding, null);
  assert.deepEqual(groundingResult.avoidedShipIds, [ship.id]);
  assert.notEqual(ship.routeRecoveryHeadingDeg, null);
});

for (const shipType of ['speedboat', 'cargo_boat', 'freighter']) {
  for (const [direction, target] of Object.entries({
    forward: { x: 620, y: 500 },
    sideways: { x: 500, y: 620 },
    backward: { x: 380, y: 500 },
  })) {
    test(`COR-12 FIX-2 ${shipType} completes ordinary ${direction} route without orbit`, async () => {
      const subject = await loadSubject();
      const bundle = subject.validateConfigSource(readBaselineSource());
      const registry = subject.createShipCharacteristicsRegistry(bundle);
      const ship = new subject.ShipModel({
        id: `${shipType}-${direction}`,
        characteristics: registry.require(shipType),
        position: { x: 500, y: 500 },
        rotationDeg: 0,
        state: subject.ShipState.Navigating,
        route: { points: [target] },
      });
      const motor = new subject.ShipMotor();
      for (let step = 0; step < 1200 && ship.routeCursor === 0; step += 1) {
        motor.stepRoute(ship, 8, 1 / 60);
      }

      assert.equal(ship.routeCursor, 1);
      assert.ok(Math.hypot(target.x - ship.x, target.y - ship.y) <= 8);
    });
  }
}
