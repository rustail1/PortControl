import assert from 'node:assert/strict';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

let setupPromise;
async function setup() {
  setupPromise ??= Promise.all([
    import('../src/ships/index.ts'),
    import('../src/routes/index.ts'),
    import('../src/config/validateConfigSource.ts'),
  ]).then(([ships, routes, config]) => {
    const s = { ...ships, ...routes, ...config };
    const bundle = s.validateConfigSource(readBaselineSource());
    return {
      s,
      registry: s.createShipCharacteristicsRegistry(bundle),
      routeConfig: s.createRouteProcessingConfig(bundle),
    };
  });
  return setupPromise;
}

function pointer(x, y) {
  return { source: 'mouse', pointerId: 1, screenPosition: { x, y }, cssPosition: { x, y },
    internalViewport: { width: 1000, height: 1000 }, worldToCssPixelScale: 1 };
}

for (const pointerOffset of [0, 12]) {
test(`COR-12 redraw sideways drift with ${pointerOffset}px grab offset does not snap the hull`, async () => {
  const { s, registry, routeConfig } = await setup();
  const { SquareWorldViewport } = await import('../src/camera/SquareWorldViewport.ts');
  const ship = shipOf(s, registry, { position: { x: 500, y: 500 }, rotationDeg: 0 });
  const controller = new s.RouteInputController({
    viewport: new SquareWorldViewport({ width: 1000, height: 1000 }),
    sampling: { sampleDistance: 1, maxRawPoints: 256 }, hitTest: () => ship,
  });
  controller.pointerDown(pointer(500 + pointerOffset, 500));
  controller.pointerMove(pointer(500 + pointerOffset, 480));
  controller.pointerMove(pointer(500 + pointerOffset, 400));
  ship.setPosition({ x: 440, y: 500 });
  const result = new s.RouteCommitService({ navigation: new s.NavigationValidator([]), config: routeConfig })
    .commit({ ship, draft: controller.pointerUp(pointer(500 + pointerOffset, 300)).draft });
  assert.equal(result.kind, 'committed');
  assert.deepEqual(ship.route.toSnapshot(), {
    start: { x: 500, y: 500 },
    points: [
      { x: 500 + pointerOffset, y: 480 },
      { x: 500 + pointerOffset, y: 400 },
      { x: 500 + pointerOffset, y: 300 },
    ],
  });
  assert.equal(ship.rotationDeg, 0);
});
}

test('COR-12 draft simplification preserves deliberate out-and-back turns', async () => {
  const { s, routeConfig } = await setup();
  assert.deepEqual(s.simplifyRoute([
    { x: 500, y: 500 }, { x: 400, y: 500 }, { x: 600, y: 500 },
  ], routeConfig), [{ x: 500, y: 500 }, { x: 400, y: 500 }, { x: 600, y: 500 }]);
});

function shipOf(s, registry, options = {}) {
  return new s.ShipModel({
    id: options.id ?? 'ship-direct-steering',
    characteristics: registry.require(options.type ?? 'freighter'),
    position: options.position ?? { x: 0, y: 0 },
    rotationDeg: options.rotationDeg ?? 180,
    state: options.state ?? s.ShipState.Navigating,
    cargo: options.cargo ?? { general: 1 },
  });
}

test('COR-12 route commit preserves hull heading until fixed-step turning begins', async () => {
  const { s, registry, routeConfig } = await setup();
  const ship = shipOf(s, registry, { rotationDeg: 180 });
  const before = ship.position;
  const result = new s.RouteCommitService({
    navigation: new s.NavigationValidator([]),
    config: routeConfig,
  }).commit({
    ship,
    draft: { shipId: ship.id, points: [{ x: 0, y: 0 }, { x: 0, y: 100 }] },
  });

  assert.equal(result.kind, 'committed');
  assert.deepEqual(ship.position, before);
  assert.equal(ship.rotationDeg, 180);
});

test('COR-12 outbound commit preserves dock heading until guided departure moves', async () => {
  const { s, registry, routeConfig } = await setup();
  const ship = shipOf(s, registry, {
    position: { x: 355, y: 150 },
    rotationDeg: 90,
    state: s.ShipState.ReadyToLeave,
    cargo: {},
  });
  const result = new s.RouteCommitService({
    navigation: new s.NavigationValidator([]),
    config: routeConfig,
  }).commit({
    ship,
    draft: { shipId: ship.id, points: [{ x: 295, y: 150 }] },
  });

  assert.equal(result.kind, 'committed');
  assert.equal(ship.state, s.ShipState.Leaving);
  assert.equal(ship.rotationDeg, 90);
  assert.deepEqual(ship.position, { x: 355, y: 150 });
});

test('COR-12 FIX-3B navigation keeps velocity aligned with the rate-limited hull', async () => {
  const { s, registry } = await setup();
  const ship = shipOf(s, registry, { rotationDeg: 180 });
  ship.replaceRoute(new s.ShipRoute([{ x: 100, y: 0 }, { x: 100, y: 100 }]));
  const motor = new s.ShipMotor();
  let previousProgress = 0;

  for (let step = 0; step < 600 && ship.routeProgress < ship.route.totalLength; step += 1) {
    const before = ship.position;
    motor.stepRoute(ship, 8, 1 / 60);
    const moved = Math.hypot(ship.x - before.x, ship.y - before.y);
    assert.ok(moved <= ship.characteristics.speed / 60 + 1e-9);
    assert.ok(ship.routeProgress >= previousProgress);
    if (moved > 1e-9) {
      const velocityHeading = Math.atan2(ship.y - before.y, ship.x - before.x) * 180 / Math.PI;
      assert.ok(Math.abs(((velocityHeading - ship.rotationDeg + 540) % 360) - 180) < 1e-9);
    }
    previousProgress = ship.routeProgress;
  }

  assert.equal(ship.routeProgress, ship.route.totalLength);
  assert.ok(ship.y > 0);
});

test('COR-12 reverse command starts a forward rate-limited turn instead of side-slipping', async () => {
  const { s, registry } = await setup();
  const ship = shipOf(s, registry, { rotationDeg: 180 });
  ship.replaceRoute(new s.ShipRoute([{ x: 100, y: 0 }]));

  new s.ShipMotor().stepRoute(ship, 8, 1 / 60);

  assert.ok(ship.x < 0);
  assert.notEqual(ship.y, 0);
  assert.ok(Math.abs(ship.rotationDeg - (180 - ship.characteristics.turnRateDeg / 60)) < 1e-9);
});

test('COR-12 normal route navigation preserves ship-specific speed', async () => {
  const { s, registry } = await setup();
  const speedboat = shipOf(s, registry, { id: 'fast', type: 'speedboat', rotationDeg: 0 });
  const freighter = shipOf(s, registry, { id: 'slow', type: 'freighter', rotationDeg: 0 });
  speedboat.replaceRoute(new s.ShipRoute([{ x: 1000, y: 0 }]));
  freighter.replaceRoute(new s.ShipRoute([{ x: 1000, y: 0 }]));
  const motor = new s.ShipMotor();

  motor.stepRoute(speedboat, 8, 0.2);
  motor.stepRoute(freighter, 8, 0.2);

  assert.equal(speedboat.x, speedboat.characteristics.speed * 0.2);
  assert.equal(freighter.x, freighter.characteristics.speed * 0.2);
  assert.ok(speedboat.x > freighter.x);
});
