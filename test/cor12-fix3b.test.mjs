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
test(`COR-12 redraw sideways drift with ${pointerOffset}px grab offset does not pin the first tangent`, async () => {
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
  controller.syncActiveDraftToShip();
  const result = new s.RouteCommitService({ navigation: new s.NavigationValidator([]), config: routeConfig })
    .commit({ ship, draft: controller.pointerUp(pointer(500 + pointerOffset, 300)).draft });
  assert.equal(result.kind, 'committed');
  assert.deepEqual(ship.route.toSnapshot(), { start: { x: 440, y: 500 }, points: [{ x: 500 + pointerOffset, y: 300 }] });
  const heading = (Math.atan2(-200, 60 + pointerOffset) * 180 / Math.PI + 360) % 360;
  assert.ok(Math.abs(ship.rotationDeg - heading) < 1e-9);
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

test('COR-12 FIX-3B successful route commit snaps heading to its first valid tangent without moving', async () => {
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
  assert.equal(ship.rotationDeg, 90);
});

test('COR-12 FIX-3B outbound commit immediately points OUT ship along the swipe', async () => {
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
  assert.equal(ship.rotationDeg, 180);
  assert.deepEqual(ship.position, { x: 355, y: 150 });
});

test('COR-12 FIX-3B navigation position follows the authored polyline independent of turn rate', async () => {
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
    assert.ok(
      Math.abs(ship.y) < 1e-9 && ship.x <= 100 + 1e-9 ||
      Math.abs(ship.x - 100) < 1e-9 && ship.y >= -1e-9,
      `off authored polyline at (${ship.x}, ${ship.y})`,
    );
    previousProgress = ship.routeProgress;
  }

  assert.equal(ship.routeProgress, ship.route.totalLength);
  assert.deepEqual(ship.position, { x: 100, y: 100 });
});

test('COR-12 FIX-3B first navigation step obeys route direction instead of current heading', async () => {
  const { s, registry } = await setup();
  const ship = shipOf(s, registry, { rotationDeg: 180 });
  ship.replaceRoute(new s.ShipRoute([{ x: 100, y: 0 }]));

  new s.ShipMotor().stepRoute(ship, 8, 1 / 60);

  assert.ok(ship.x > 0);
  assert.equal(ship.y, 0);
  assert.equal(ship.rotationDeg, 0);
});
