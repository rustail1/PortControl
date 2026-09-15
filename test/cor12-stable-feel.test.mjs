import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { canonicalizeRoute } from '../src/routes/RouteCanonicalizer.ts';

const config = JSON.parse(readFileSync(new URL(
  '../Port_Control_Baseline_Source_FINAL_v1.5/src/config/balance.json', import.meta.url,
), 'utf8')).route;

test('COR-12 extending a curved swipe never relocates its already authored bends', () => {
  const start = { x: 400, y: 400 };
  const points = [];
  let previous = [];
  for (let i = 1; i <= 24; i++) {
    const angle = i * Math.PI / 48;
    points.push({ x: 400 + 200 * Math.sin(angle), y: 400 + 200 * (1 - Math.cos(angle)) });
    const current = canonicalizeRoute(start, points);
    assert.deepEqual(current.slice(0, previous.length), previous,
      `past bends moved when sample ${i} was appended`);
    previous = current;
  }
  assert.deepEqual(previous, points);
});

test('COR-12 exact-authored gestures retain straight samples and a real reversal', () => {
  const start = { x: 100, y: 100 };
  assert.deepEqual(canonicalizeRoute(start, [{ x: 120, y: 100 }, { x: 200, y: 100 }]),
    [{ x: 120, y: 100 }, { x: 200, y: 100 }]);
  assert.deepEqual(canonicalizeRoute(start, [{ x: 200, y: 100 }, { x: 50, y: 100 }]),
    [{ x: 200, y: 100 }, { x: 50, y: 100 }]);
});

test('COR-12 live tip is presentation/input state and never rewrites stored authored samples', () => {
  const draft = { start: { x: 100, y: 100 }, points: [{ x: 120, y: 100 }], tip: { x: 123, y: 100 } };
  assert.deepEqual(canonicalizeRoute(draft.start, draft.points), [{ x: 120, y: 100 }]);
  assert.deepEqual(draft.tip, { x: 123, y: 100 });
  assert.deepEqual(draft.points, [{ x: 120, y: 100 }]);
});

test('COR-12 dense authored strokes are not capped by legacy maxSimplifiedPoints', () => {
  const start = { x: 100, y: 100 };
  const points = [
    { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 300, y: 200 },
    { x: 300, y: 300 }, { x: 400, y: 300 },
  ];
  assert.deepEqual(canonicalizeRoute(start, points), points);
});

test('COR-12 sub-sample tip motion cannot mutate authored bends', () => {
  const draft = { start: { x: 100, y: 100 }, points: [{ x: 200, y: 100 }] };
  const before = canonicalizeRoute(draft.start, draft.points);
  for (const y of [107, 101, 106, 100]) {
    const withTip = { ...draft, tip: { x: 200, y } };
    assert.deepEqual(canonicalizeRoute(withTip.start, withTip.points), before);
    assert.deepEqual(withTip.tip, { x: 200, y });
  }
});

async function createPointerSubject() {
  const { RouteInputController } = await import('../src/routes/RouteInputController.ts');
  const { SquareWorldViewport } = await import('../src/camera/SquareWorldViewport.ts');
  const { ShipModel } = await import('../src/ships/ShipModel.ts');
  const ships = JSON.parse(readFileSync(new URL(
    '../Port_Control_Baseline_Source_FINAL_v1.5/src/config/ships.json', import.meta.url,
  ), 'utf8')).ships;
  const ship = new ShipModel({ id: 'live-tip', characteristics: { type: 'speedboat', ...ships.speedboat },
    position: { x: 400, y: 400 }, rotationDeg: 0, state: 'Navigating', cargo: { general: 1 } });
  const controller = new RouteInputController({ viewport: new SquareWorldViewport({ width: 1000, height: 1000 }),
    sampling: { sampleDistance: config.sampleDistance, maxRawPoints: config.maxRawPoints }, hitTest: () => ship });
  const pointer = x => ({ source: 'mouse', pointerId: 1, screenPosition: { x, y: 400 },
    cssPosition: { x, y: 400 }, internalViewport: { width: 1000, height: 1000 }, worldToCssPixelScale: 1 });
  return { ship, controller, pointer };
}

test('COR-12 route origin is captured at drag activation and never snaps back to pointerdown', async () => {
  const { ship, controller, pointer } = await createPointerSubject();
  controller.pointerDown(pointer(400));
  ship.setPosition({ x: 408, y: 400 });

  controller.pointerMove(pointer(412));
  const active = controller.activeDraftSnapshot;
  assert.ok(active, 'threshold crossing must activate a live route');
  assert.deepEqual(active.start, { x: 408, y: 400 }, 'route must begin at the moving ship pose when drawing activates');

  ship.setPosition({ x: 430, y: 400 });
  const finished = controller.pointerUp(pointer(416));
  assert.equal(finished.kind, 'finished');
  assert.deepEqual(finished.draft.start, { x: 408, y: 400 }, 'release must not rebase an already active route');
});

test('COR-12 real pointer preview and released draft both include the unsampled live tip', async () => {
  const { controller, pointer } = await createPointerSubject();
  controller.pointerDown(pointer(400));
  controller.pointerMove(pointer(412));
  controller.pointerMove(pointer(415));
  const active = controller.activeDraftSnapshot;
  assert.ok(active);
  assert.deepEqual(active.tip, { x: 415, y: 400 });
  const finished = controller.pointerUp(pointer(416));
  assert.equal(finished.kind, 'finished');
  assert.deepEqual(finished.draft.tip, { x: 416, y: 400 });
});

test('COR-12 moving along a held curve cannot relocate its raw future bends', async () => {
  const { ship, controller, pointer } = await createPointerSubject();
  controller.pointerDown(pointer(400));
  for (let i = 1; i <= 24; i++) {
    const angle = i * Math.PI / 48;
    const point = { x: 400 + 200 * Math.sin(angle), y: 400 + 200 * (1 - Math.cos(angle)) };
    controller.pointerMove({ ...pointer(point.x), screenPosition: point, cssPosition: point });
  }
  const before = controller.activeDraftSnapshot;
  ship.setPosition({ x: 405.23, y: 400.17 });
  assert.deepEqual(controller.activeDraftSnapshot, before);
  ship.setPosition(before.points[0]);
  assert.deepEqual(controller.activeDraftSnapshot, before);
});

test('COR-12 ship movement cannot consume raw samples or the live tip', async () => {
  const { ship, controller, pointer } = await createPointerSubject();
  controller.pointerDown(pointer(400));
  controller.pointerMove(pointer(412));
  controller.pointerMove(pointer(419));
  const before = controller.activeDraftSnapshot;
  ship.setPosition({ x: 412, y: 400 });
  ship.setPosition({ x: 419, y: 400 });
  assert.deepEqual(controller.activeDraftSnapshot, before);
});

test('COR-12 visual heading helper still eases explicit presentation-only transitions', async () => {
  const { smoothShipHeading } = await import('../src/presentation/ShipHeadingPresentation.ts');
  const first = smoothShipHeading(0, 90, 1000 / 60);
  assert.ok(first > 0 && first < 30, `first-frame rotation was ${first}`);
  let heading = first;
  for (let i = 1; i < 30; i++) heading = smoothShipHeading(heading, 90, 1000 / 60);
  assert.ok(Math.abs(90 - heading) < 1, 'presentation-only turn should settle promptly');
  assert.equal(smoothShipHeading(20, 90, 0), 20);
});

test('COR-12 visual heading uses shortest wrap and equivalent elapsed time', async () => {
  const { smoothShipHeading } = await import('../src/presentation/ShipHeadingPresentation.ts');
  const heading = smoothShipHeading(350, 10, 50);
  assert.ok(heading > 350 || heading < 10);
  const once = smoothShipHeading(0, 90, 100);
  const twice = smoothShipHeading(smoothShipHeading(0, 90, 50), 90, 50);
  assert.ok(Math.abs(once - twice) < 1e-9);
});

test('COR-12 authoritative ship heading has no second presentation resolver', () => {
  const scene = readFileSync('src/scenes/HarborScene.ts', 'utf8');
  const headingPresentation = readFileSync('src/presentation/ShipHeadingPresentation.ts', 'utf8');
  assert.match(scene, /const rotation = simulationRotation;/);
  assert.doesNotMatch(scene, /resolveShipVisualHeading|snapshot\.docks\.find/);
  assert.doesNotMatch(headingPresentation, /resolveShipVisualHeading|ShipVisualHeading/);
});
