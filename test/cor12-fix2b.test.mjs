import assert from 'node:assert/strict';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

async function loadSubject() {
  const [camera, config, core, clock, exits, levelSelection, routes, runtime, ships] = await Promise.all([
    import('../src/camera/SquareWorldViewport.ts'),
    import('../src/config/validateConfigSource.ts'),
    import('../src/core/DomainEventQueue.ts'),
    import('../src/core/FixedStepClock.ts'),
    import('../src/exits/ExitSystem.ts'),
    import('../src/scenes/HarborLevelSelection.ts'),
    import('../src/routes/index.ts'),
    import('../src/runtime/HarborRuntime.ts'),
    import('../src/ships/index.ts'),
  ]);
  return {
    ...camera,
    ...config,
    ...core,
    ...clock,
    ...exits,
    ...levelSelection,
    ...routes,
    ...runtime,
    ...ships,
  };
}

function pointer(x, y, pointerId = 1) {
  return {
    source: 'mouse',
    pointerId,
    screenPosition: { x, y },
    cssPosition: { x, y },
    internalViewport: { width: 1000, height: 1000 },
    worldToCssPixelScale: 1,
  };
}

async function createInputController() {
  const subject = await loadSubject();
  const bundle = subject.validateConfigSource(readBaselineSource());
  const registry = subject.createShipCharacteristicsRegistry(bundle);
  const ship = new subject.ShipModel({
    id: 'edge-ship',
    characteristics: registry.require('speedboat'),
    position: { x: 500, y: 500 },
    rotationDeg: 0,
    state: subject.ShipState.Navigating,
  });
  const controller = new subject.RouteInputController({
    viewport: new subject.SquareWorldViewport({ width: 1000, height: 1000 }),
    sampling: { sampleDistance: 8, maxRawPoints: 256 },
    hitTest: () => ship,
  });
  return { subject, bundle, registry, ship, controller };
}

test('COR-12 FIX-2B level query resolves real configured IDs and falls back to calm_07', async () => {
  const subject = await loadSubject();
  const bundle = subject.validateConfigSource(readBaselineSource());

  assert.equal(subject.resolveDevelopmentLevelId('?level=calm_01', bundle.levels), 'calm_01');
  assert.equal(subject.resolveDevelopmentLevelId('?level=calm_07', bundle.levels), 'calm_07');
  assert.equal(subject.resolveDevelopmentLevelId('', bundle.levels), 'calm_07');
  assert.equal(subject.resolveDevelopmentLevelId('?level=missing', bundle.levels), 'calm_07');
});

for (const [edge, inside, outside, expected] of [
  ['left', { x: 480, y: 500 }, { x: -100, y: 500 }, { x: 0, y: 500 }],
  ['right', { x: 520, y: 500 }, { x: 1100, y: 500 }, { x: 1000, y: 500 }],
  ['top', { x: 500, y: 480 }, { x: 500, y: -100 }, { x: 500, y: 0 }],
  ['bottom', { x: 500, y: 520 }, { x: 500, y: 1100 }, { x: 500, y: 1000 }],
]) {
  test(`COR-12 FIX-2B activated pointer leave clips to exact ${edge} world edge`, async () => {
    const { controller } = await createInputController();
    controller.pointerDown(pointer(500, 500));
    controller.pointerMove(pointer(inside.x, inside.y));

    const outcome = controller.pointerMove(pointer(outside.x, outside.y));
    assert.equal(outcome.kind, 'finished');
    assert.deepEqual(outcome.draft.points.at(-1), expected);
    assert.equal(controller.pointerUp(pointer(outside.x, outside.y)).kind, 'ignored');
  });
}

test('COR-12 FIX-2B diagonal pointer leave resolves the world corner deterministically', async () => {
  const { controller } = await createInputController();
  controller.pointerDown(pointer(500, 500));
  controller.pointerMove(pointer(520, 520));

  const outcome = controller.pointerUp(pointer(1100, 1100));
  assert.equal(outcome.kind, 'finished');
  assert.deepEqual(outcome.draft.points.at(-1), { x: 1000, y: 1000 });
});

test('COR-12 FIX-2B former close-waypoint orbit advances instead of circling forever', async () => {
  const { subject, registry } = await createInputController();
  const angle = 60 * Math.PI / 180;
  const target = { x: Math.cos(angle) * 12, y: Math.sin(angle) * 12 };
  const ship = new subject.ShipModel({
    id: 'former-orbit',
    characteristics: registry.require('speedboat'),
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    state: subject.ShipState.Navigating,
    route: { points: [target] },
  });
  const motor = new subject.ShipMotor();

  for (let step = 0; step < 1200 && ship.routeCursor === 0; step += 1) {
    motor.stepRoute(ship, 8, 1 / 60);
  }

  assert.equal(ship.routeCursor, 1);
});

test('COR-12 FIX-2B route cursor makes monotonic progress through close polyline points', async () => {
  const { subject, registry } = await createInputController();
  const ship = new subject.ShipModel({
    id: 'monotonic',
    characteristics: registry.require('cargo_boat'),
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    state: subject.ShipState.Navigating,
    route: {
      points: [
        { x: 8, y: 14 },
        { x: 16, y: 22 },
        { x: 28, y: 26 },
        { x: 45, y: 20 },
      ],
    },
  });
  const motor = new subject.ShipMotor();
  let previousCursor = 0;

  for (let step = 0; step < 1800 && ship.routeCursor < 4; step += 1) {
    motor.stepRoute(ship, 8, 1 / 60);
    assert.ok(ship.routeCursor >= previousCursor);
    previousCursor = ship.routeCursor;
  }

  assert.equal(ship.routeCursor, 4);
});

for (const state of ['Navigating', 'Leaving']) {
  test(`COR-12 FIX-2B ${state} continues forward after route exhaustion`, async () => {
    const { subject, registry } = await createInputController();
    const ship = new subject.ShipModel({
      id: `route-end-${state}`,
      characteristics: registry.require('freighter'),
      position: { x: 200, y: 300 },
      rotationDeg: 90,
      state: subject.ShipState[state],
      route: { points: [{ x: 200, y: 300 }] },
    });
    const motor = new subject.ShipMotor();
    motor.stepRoute(ship, 8, 1 / 60);
    const beforeContinuation = ship.position;
    motor.stepRoute(ship, 8, 0.5);

    assert.equal(ship.routeCursor, 1);
    assert.ok(Math.abs(ship.x - beforeContinuation.x) < 1e-9);
    assert.ok(Math.abs(ship.y - (beforeContinuation.y + ship.characteristics.speed * 0.5)) < 1e-9);
  });
}

test('COR-12 FIX-2B ReadyToLeave remains stopped without an outbound route', async () => {
  const { subject, registry } = await createInputController();
  const ship = new subject.ShipModel({
    id: 'ready-stop',
    characteristics: registry.require('speedboat'),
    position: { x: 200, y: 300 },
    rotationDeg: 90,
    state: subject.ShipState.ReadyToLeave,
  });
  const before = ship.toSnapshot();
  new subject.ShipMotor().stepRoute(ship, 8, 2);
  assert.deepEqual(ship.toSnapshot(), before);
});

test('COR-12 FIX-3B controlled loaded ship keeps moving through repeatable boundary returns', async () => {
  const { subject, registry } = await createInputController();
  const ship = new subject.ShipModel({
    id: 'loaded-exit-reject',
    characteristics: registry.require('cargo_boat'),
    position: { x: 20, y: 500 },
    rotationDeg: 180,
    state: subject.ShipState.Navigating,
    cargo: { general: 1 },
    route: { points: [{ x: 0, y: 500 }] },
  });
  const exit = new subject.ExitSystem({
    zones: [{ id: 'left', x: 20, y: 500, width: 40, height: 900, edge: 'left' }],
    worldBounds: { width: 1000, height: 1000 },
    score: 20,
    events: new subject.DomainEventQueue(),
  });

  assert.deepEqual(exit.step([ship]).rejectedCargoShipIds, [ship.id]);
  assert.equal(ship.route, null);
  const rejectedPosition = ship.position;
  const motor = new subject.ShipMotor();
  motor.stepRoute(ship, 8, 0.25);

  assert.ok(Math.abs(
    Math.hypot(ship.x - rejectedPosition.x, ship.y - rejectedPosition.y) -
      ship.characteristics.speed * 0.25,
  ) < 1e-9);
  assert.ok(ship.rotationDeg > 0 && ship.rotationDeg < 180);
  assert.equal(ship.state, subject.ShipState.Navigating);
  ship.replaceRoute(new subject.ShipRoute([{ x: 0, y: ship.y }]));
  ship.setRotationDeg(180);
  const interruptedReturn = exit.step([ship]);
  assert.deepEqual(interruptedReturn.rejectedCargoShipIds, [ship.id]);
  assert.equal(ship.route, null);
  assert.notEqual(ship.routeRecoveryHeadingDeg, null);
  const recoveryTarget = ship.routeRecoveryHeadingDeg;
  const restored = subject.ShipModel.restore(ship.toSnapshot(), registry);
  for (let step = 0; step < 180 && restored.routeRecoveryHeadingDeg !== null; step += 1) {
    const before = restored.position;
    motor.stepRoute(restored, 8, 1 / 60);
    assert.ok(Math.hypot(restored.x - before.x, restored.y - before.y) > 0);
  }
  assert.equal(restored.rotationDeg, recoveryTarget);
  assert.equal(restored.routeRecoveryHeadingDeg, null);
  const alignedX = restored.x;
  motor.stepRoute(restored, 8, 1 / 60);
  assert.ok(restored.x > alignedX);

  restored.setPositionXY(500, 500);
  exit.step([restored]);
  restored.setPositionXY(20, 500);
  restored.setRotationDeg(180);
  restored.replaceRoute(new subject.ShipRoute([{ x: 0, y: 500 }]));
  const repeated = exit.step([restored]);
  assert.deepEqual(repeated.rejectedCargoShipIds, [restored.id]);
  assert.deepEqual(repeated.despawnedShipIds, []);
  assert.equal(repeated.scoreDelta, 0);
  assert.equal(restored.state, subject.ShipState.Navigating);
});

test('COR-12 FIX-2B entering cargo ship can cross its spawn-side ExitZone into the harbor', async () => {
  const { subject, registry } = await createInputController();
  const ship = new subject.ShipModel({
    id: 'entering-through-exit-zone',
    characteristics: registry.require('speedboat'),
    position: { x: 980, y: 500 },
    rotationDeg: 180,
    state: subject.ShipState.Entering,
    cargo: { general: 1 },
  });
  const exit = new subject.ExitSystem({
    zones: [{ id: 'right', x: 980, y: 500, width: 40, height: 900, edge: 'right' }],
    worldBounds: { width: 1000, height: 1000 },
    score: 20,
    events: new subject.DomainEventQueue(),
  });

  assert.deepEqual(exit.step([ship]).rejectedCargoShipIds, []);
  ship.setState(subject.ShipState.Navigating);
  ship.replaceRoute(new subject.ShipRoute([{ x: 800, y: 500 }]));
  assert.deepEqual(exit.step([ship]).rejectedCargoShipIds, []);
  new subject.ShipMotor().stepRoute(ship, 8, 0.5);

  assert.equal(ship.routeMotionHeld, false);
  assert.ok(ship.x < 980);
});

test('COR-12 FIX-2B entering cargo ship routed outward is recovered instead of escaping', async () => {
  const { subject, registry } = await createInputController();
  const ship = new subject.ShipModel({
    id: 'entering-routed-outward',
    characteristics: registry.require('speedboat'),
    position: { x: 980, y: 500 },
    rotationDeg: 180,
    state: subject.ShipState.Entering,
    cargo: { general: 1 },
  });
  const exit = new subject.ExitSystem({
    zones: [{ id: 'right', x: 980, y: 500, width: 40, height: 900, edge: 'right' }],
    worldBounds: { width: 1000, height: 1000 },
    score: 20,
    events: new subject.DomainEventQueue(),
  });
  assert.deepEqual(exit.step([ship]).rejectedCargoShipIds, []);
  ship.setState(subject.ShipState.Navigating);
  ship.replaceRoute(new subject.ShipRoute([{ x: 1000, y: 500 }]));
  ship.setRotationDeg(0);

  assert.deepEqual(exit.step([ship]).rejectedCargoShipIds, [ship.id]);
  assert.equal(ship.route, null);
  assert.equal(ship.routeRecoveryHeadingDeg, 180);
});

test('COR-12 FIX-3B untouched Entering returns once then neutral-despawns on its next boundary', async () => {
  const { subject, registry } = await createInputController();
  const events = new subject.DomainEventQueue();
  const exited = [];
  events.subscribe('ship_exited', (fact) => exited.push(fact));
  const ship = new subject.ShipModel({
    id: 'untouched-boundary-flow',
    characteristics: registry.require('speedboat'),
    position: { x: 980, y: 500 },
    rotationDeg: 180,
    state: subject.ShipState.Entering,
    cargo: { general: 1 },
  });
  const exit = new subject.ExitSystem({
    zones: [
      { id: 'left', x: 20, y: 500, width: 40, height: 900, edge: 'left' },
      { id: 'right', x: 980, y: 500, width: 40, height: 900, edge: 'right' },
    ],
    worldBounds: { width: 1000, height: 1000 },
    score: 20,
    events,
  });

  assert.deepEqual(exit.step([ship]).despawnedShipIds, []);
  ship.setPositionXY(500, 500);
  exit.step([ship]);
  ship.setPositionXY(20, 500);
  ship.setRotationDeg(180);
  const firstBoundary = exit.step([ship]);
  assert.deepEqual(firstBoundary.despawnedShipIds, []);
  assert.deepEqual(firstBoundary.rejectedCargoShipIds, []);
  assert.equal(firstBoundary.scoreDelta, 0);
  assert.deepEqual(firstBoundary.exitedShipFacts, []);
  assert.equal(ship.state, subject.ShipState.Entering);
  assert.equal(ship.routeRecoveryHeadingDeg, 0);

  const beforeArc = ship.position;
  new subject.ShipMotor().stepRoute(ship, 8, 0.1);
  assert.ok(Math.hypot(ship.x - beforeArc.x, ship.y - beforeArc.y) > 0);
  ship.finishRouteRecovery();
  ship.setPositionXY(500, 500);
  exit.step([ship]);
  ship.setPositionXY(980, 500);
  ship.setRotationDeg(0);
  const secondBoundary = exit.step([ship]);
  events.flush();

  assert.deepEqual(secondBoundary.despawnedShipIds, [ship.id]);
  assert.equal(secondBoundary.scoreDelta, 0);
  assert.deepEqual(secondBoundary.exitedShipFacts, []);
  assert.deepEqual(exited, []);
  assert.equal(ship.state, subject.ShipState.Entering);
});

test('COR-12 FIX-3B world edge without ExitZone still returns untouched Entering traffic', async () => {
  const { subject, registry } = await createInputController();
  const ship = new subject.ShipModel({
    id: 'untouched-top-boundary',
    characteristics: registry.require('speedboat'),
    position: { x: 500, y: 500 },
    rotationDeg: 270,
    state: subject.ShipState.Entering,
    cargo: { general: 1 },
  });
  const exit = new subject.ExitSystem({
    zones: [],
    worldBounds: { width: 1000, height: 1000 },
    score: 20,
    events: new subject.DomainEventQueue(),
  });

  exit.step([ship]);
  ship.setPositionXY(500, ship.characteristics.collisionRadius);
  const result = exit.step([ship]);

  assert.deepEqual(result.despawnedShipIds, []);
  assert.equal(ship.state, subject.ShipState.Entering);
  assert.equal(ship.routeRecoveryHeadingDeg, 90);
});

test('COR-12 FIX-3B loaded boundary return near a corner curves toward the world interior', async () => {
  const { subject, registry } = await createInputController();
  const ship = new subject.ShipModel({
    id: 'loaded-near-corner',
    characteristics: registry.require('speedboat'),
    position: { x: 961, y: 60 },
    rotationDeg: 0,
    state: subject.ShipState.Navigating,
    cargo: { general: 1 },
  });
  const exit = new subject.ExitSystem({
    zones: [{ id: 'right', x: 980, y: 500, width: 40, height: 900, edge: 'right' }],
    worldBounds: { width: 1000, height: 1000 },
    score: 20,
    events: new subject.DomainEventQueue(),
  });

  assert.deepEqual(exit.step([ship]).rejectedCargoShipIds, [ship.id]);
  assert.ok(ship.routeRecoveryHeadingDeg > 90 && ship.routeRecoveryHeadingDeg < 180);
  const motor = new subject.ShipMotor();
  for (let step = 0; step < 600; step += 1) {
    motor.stepRoute(ship, 8, 1 / 60);
    exit.step([ship]);
  }

  assert.ok(ship.x > ship.characteristics.collisionRadius);
  assert.ok(ship.y > ship.characteristics.collisionRadius);
  assert.ok(ship.x < 1000 - ship.characteristics.collisionRadius);
  assert.ok(ship.y < 1000 - ship.characteristics.collisionRadius);
});

test('COR-12 FIX-2B incoming presentation approaches from offscreen to authored spawn', async () => {
  const subject = await loadSubject();
  const indicator = {
    transactionId: 'incoming-1',
    spawnPointId: 'spawn_l',
    shipId: 'ship-1',
    shipType: 'speedboat',
    x: 0,
    y: 500,
    directionDeg: 0,
    leadTimeSeconds: 2,
  };
  const initial = subject.createIncomingVesselPresentation({
    indicator,
    elapsedSeconds: 0,
    speed: 150,
    collisionRadius: 14,
  });
  const halfway = subject.createIncomingVesselPresentation({
    indicator,
    elapsedSeconds: 1,
    speed: 150,
    collisionRadius: 14,
  });
  const arrived = subject.createIncomingVesselPresentation({
    indicator,
    elapsedSeconds: 2,
    speed: 150,
    collisionRadius: 14,
  });

  assert.deepEqual(initial.position, { x: -300, y: 500 });
  assert.deepEqual(initial.originPosition, { x: -300, y: 500 });
  assert.deepEqual(halfway.position, { x: -150, y: 500 });
  assert.deepEqual(halfway.originPosition, initial.originPosition);
  assert.deepEqual(arrived.position, { x: 0, y: 500 });
  assert.deepEqual(arrived.spawnPosition, { x: 0, y: 500 });
  assert.equal(initial.shipId, 'ship-1');
  assert.equal(initial.shipType, 'speedboat');
  assert.equal(initial.rotationDeg, 0);
});

test('COR-12 FIX-2B real calm_01 pending ship is presentation-only and starts outside world', async () => {
  const subject = await loadSubject();
  const bundle = subject.validateConfigSource(readBaselineSource());
  const runtime = new subject.HarborRuntime({
    bundle,
    levelId: 'calm_01',
    attemptSeed: 1234,
  });
  runtime.advanceRender(1000 / 60);
  const presentation = runtime.presentationSnapshot();
  const incoming = presentation.incoming[0];

  assert.ok(incoming);
  assert.equal(presentation.ships.length, 0);
  assert.equal(runtime.authoritativeSnapshot().ships.length, 0);
  assert.ok(
    incoming.position.x + incoming.collisionRadius < 0 ||
      incoming.position.x - incoming.collisionRadius > 1000 ||
      incoming.position.y + incoming.collisionRadius < 0 ||
      incoming.position.y - incoming.collisionRadius > 1000,
  );
});

test('COR-12 FIX-2B departure presentation dies only after hull is fully outside', async () => {
  const subject = await loadSubject();
  const store = new subject.DeparturePresentationStore({ width: 1000, height: 1000 });
  store.add({
    shipId: 'departing',
    shipType: 'cargo_boat',
    position: { x: 20, y: 500 },
    rotationDeg: 180,
    speed: 100,
    collisionRadius: 22,
  });

  store.advance(0.2);
  assert.equal(store.snapshot().length, 1);
  assert.deepEqual(store.snapshot()[0].position, { x: 0, y: 500 });
  store.advance(0.23);
  assert.equal(store.snapshot().length, 0);
});

test('COR-12 FIX-2B calm_01 is open-water basic feel and calm_07 keeps its island', async () => {
  const subject = await loadSubject();
  const bundle = subject.validateConfigSource(readBaselineSource());
  const calm01 = new subject.HarborRuntime({
    bundle,
    levelId: 'calm_01',
    attemptSeed: 1,
  }).presentationSnapshot();
  const calm07 = new subject.HarborRuntime({
    bundle,
    levelId: 'calm_07',
    attemptSeed: 1,
  }).presentationSnapshot();

  assert.deepEqual(calm01.land, [{
    points: [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 120 },
      { x: 0, y: 120 },
    ],
  }]);
  assert.deepEqual(calm07.land[1], {
    points: [
      { x: 430, y: 415 },
      { x: 570, y: 415 },
      { x: 570, y: 585 },
      { x: 430, y: 585 },
    ],
  });
});

for (const shipType of ['speedboat', 'cargo_boat', 'freighter']) {
  for (const [shape, points] of Object.entries({
    forward: [{ x: 120, y: 0 }],
    sideways: [{ x: 0, y: 120 }],
    backward: [{ x: -120, y: 0 }],
    curved: [{ x: 55, y: 35 }, { x: 80, y: 100 }, { x: 145, y: 130 }],
    short_valid: [{ x: 12, y: 0 }],
    close_points: [{ x: 10, y: 12 }, { x: 18, y: 20 }, { x: 30, y: 22 }, { x: 45, y: 20 }],
  })) {
    test(`COR-12 FIX-2B ${shipType} completes ${shape} route without orbit or reverse`, async () => {
      const { subject, registry } = await createInputController();
      const ship = new subject.ShipModel({
        id: `${shipType}-${shape}`,
        characteristics: registry.require(shipType),
        position: { x: 0, y: 0 },
        rotationDeg: 0,
        state: subject.ShipState.Navigating,
        route: { points },
      });
      const motor = new subject.ShipMotor();
      let previousProgress = ship.routeProgress;
      for (let step = 0; step < 3600 && ship.routeCursor < points.length; step += 1) {
        const before = ship.position;
        motor.stepRoute(ship, 8, 1 / 60);
        const distance = Math.hypot(ship.x - before.x, ship.y - before.y);
        assert.ok(distance <= ship.characteristics.speed / 60 + 1e-9);
        assert.ok(ship.routeProgress >= previousProgress);
        assert.deepEqual(ship.position, ship.route.pointAtDistance(ship.routeProgress));
        previousProgress = ship.routeProgress;
      }
      assert.equal(ship.routeCursor, points.length);
    });
  }
}

test('COR-12 FIX-2B follower snapshot restore preserves monotonic segment origin', async () => {
  const { subject, registry } = await createInputController();
  const original = new subject.ShipModel({
    id: 'snapshot-progress',
    characteristics: registry.require('freighter'),
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    state: subject.ShipState.Navigating,
    route: { points: [{ x: 20, y: 34 }, { x: 55, y: 50 }] },
  });
  const motor = new subject.ShipMotor();
  for (let step = 0; step < 20; step += 1) motor.stepRoute(original, 8, 1 / 60);
  const restored = subject.ShipModel.restore(original.toSnapshot(), registry);
  for (let step = 0; step < 300; step += 1) {
    motor.stepRoute(original, 8, 1 / 60);
    motor.stepRoute(restored, 8, 1 / 60);
  }
  assert.deepEqual(restored.toSnapshot(), original.toSnapshot());
});

test('COR-12 FIX-2B close-route follower is equivalent at 30 60 and 120 render FPS', async () => {
  const { subject, registry } = await createInputController();
  const run = (fps) => {
    const ship = new subject.ShipModel({
      id: 'fps-progress',
      characteristics: registry.require('cargo_boat'),
      position: { x: 0, y: 0 },
      rotationDeg: 0,
      state: subject.ShipState.Navigating,
      route: { points: [{ x: 6, y: 10 }, { x: 18, y: 22 }, { x: 45, y: 20 }] },
    });
    const motor = new subject.ShipMotor();
    const clock = new subject.FixedStepClock({ fixedHz: 60, maxCatchUpSteps: 6 });
    for (let frame = 0; frame < fps * 3; frame += 1) {
      clock.advance(1000 / fps, (dt) => motor.stepRoute(ship, 8, dt));
    }
    return ship.toSnapshot();
  };

  assert.deepEqual(run(30), run(60));
  assert.deepEqual(run(60), run(120));
});

test('COR-12 FIX-2B outbound edge route enters ExitZone and scores exactly once', async () => {
  const { subject, bundle, ship, controller } = await createInputController();
  ship.setState(subject.ShipState.ReadyToLeave);
  controller.pointerDown(pointer(500, 500));
  controller.pointerMove(pointer(600, 500));
  const finished = controller.pointerUp(pointer(1100, 500));
  assert.equal(finished.kind, 'finished');
  assert.deepEqual(finished.draft.points.at(-1), { x: 1000, y: 500 });

  const commit = new subject.RouteCommitService({
    navigation: new subject.NavigationValidator([]),
    config: subject.createRouteProcessingConfig(bundle),
  });
  assert.equal(commit.commit({ ship, draft: finished.draft }).kind, 'committed');
  assert.equal(ship.state, subject.ShipState.Leaving);

  const events = new subject.DomainEventQueue();
  const received = [];
  events.subscribe('ship_exited', (fact) => received.push(fact));
  const exit = new subject.ExitSystem({
    zones: [{ id: 'right', x: 980, y: 500, width: 40, height: 900, edge: 'right' }],
    worldBounds: { width: 1000, height: 1000 },
    score: 20,
    events,
  });
  const motor = new subject.ShipMotor();
  let result;
  for (let step = 0; step < 600; step += 1) {
    motor.stepRoute(ship, 8, 1 / 60);
    result = exit.step([ship]);
    if (result.despawnedShipIds.length > 0) break;
  }
  events.flush();

  assert.deepEqual(result.despawnedShipIds, [ship.id]);
  assert.equal(result.scoreDelta, 20);
  assert.equal(received.length, 1);
  assert.equal(exit.step([ship]).scoreDelta, 0);
});
