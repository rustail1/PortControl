import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { simplifyRouteDraft } from '../src/routes/RouteSimplifier.ts';

const config = JSON.parse(readFileSync(new URL(
  '../Port_Control_Baseline_Source_FINAL_v1.5/src/config/balance.json', import.meta.url,
), 'utf8')).route;

test('COR-12 extending a curved swipe never relocates its already drawn bends', () => {
  const start = { x: 400, y: 400 };
  const points = [];
  let previous = [];
  for (let i = 1; i <= 24; i++) {
    const angle = i * Math.PI / 48;
    points.push({ x: 400 + 200 * Math.sin(angle), y: 400 + 200 * (1 - Math.cos(angle)) });
    const current = simplifyRouteDraft({ start, points }, config);
    assert.deepEqual(current.slice(0, Math.max(0, previous.length - 1)), previous.slice(0, -1),
      `past bends moved when sample ${i} was appended`);
    previous = current;
  }
  assert.ok(previous.length > 2, 'the curve must not become one straight segment');
});

test('COR-12 stable swipe keeps straight gestures direct and retains a real reversal', () => {
  const start = { x: 100, y: 100 };
  assert.deepEqual(simplifyRouteDraft({ start, points: [{ x: 120, y: 100 }, { x: 200, y: 100 }] }, config),
    [{ x: 200, y: 100 }]);
  assert.deepEqual(simplifyRouteDraft({ start, points: [{ x: 200, y: 100 }, { x: 50, y: 100 }] }, config),
    [{ x: 200, y: 100 }, { x: 50, y: 100 }]);
});

test('COR-12 live tip follows sub-sample pointer movement without moving stored bends', () => {
  const draft = { start: { x: 100, y: 100 }, points: [{ x: 120, y: 100 }], tip: { x: 123, y: 100 } };
  assert.deepEqual(simplifyRouteDraft(draft, config), [{ x: 123, y: 100 }]);
  assert.deepEqual(draft.points, [{ x: 120, y: 100 }]);
});

test('COR-12 capped live stroke preserves fixed bends and updates only its endpoint', () => {
  const draft = { start: { x: 100, y: 100 }, points: [
    { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 300, y: 200 }, { x: 300, y: 300 },
  ] };
  const limited = { ...config, maxSimplifiedPoints: 3 };
  const before = simplifyRouteDraft(draft, limited);
  const after = simplifyRouteDraft({ ...draft, points: [...draft.points, { x: 400, y: 300 }] }, limited);
  assert.equal(after.length, 3);
  assert.deepEqual(after.slice(0, -1), before.slice(0, -1));
  assert.deepEqual(after.at(-1), { x: 400, y: 300 });
});

test('COR-12 sub-sample tip motion cannot repeatedly add and remove a bend', () => {
  const draft = { start: { x: 100, y: 100 }, points: [{ x: 200, y: 100 }] };
  for (const y of [107, 101, 106, 100]) {
    assert.deepEqual(simplifyRouteDraft({ ...draft, tip: { x: 200, y } }, config), [{ x: 200, y }]);
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
    sampling: config, processing: config, hitTest: () => ship });
  const pointer = x => ({ source: 'mouse', pointerId: 1, screenPosition: { x, y: 400 },
    cssPosition: { x, y: 400 }, internalViewport: { width: 1000, height: 1000 }, worldToCssPixelScale: 1 });
  return { ship, controller, pointer };
}

test('COR-12 real pointer preview and released draft both include the unsampled live tip', async () => {
  const { controller, pointer } = await createPointerSubject();
  controller.pointerDown(pointer(400));
  controller.pointerMove(pointer(412));
  controller.pointerMove(pointer(415));
  assert.deepEqual(simplifyRouteDraft(controller.activeDraftSnapshot, config), [{ x: 415, y: 400 }]);
  assert.deepEqual(simplifyRouteDraft(controller.pointerUp(pointer(416)).draft, config), [{ x: 416, y: 400 }]);
});

test('COR-12 moving along the start of a held curve cannot relocate its future bends', async () => {
  const { ship, controller, pointer } = await createPointerSubject();
  controller.pointerDown(pointer(400));
  for (let i = 1; i <= 24; i++) {
    const angle = i * Math.PI / 48;
    const point = { x: 400 + 200 * Math.sin(angle), y: 400 + 200 * (1 - Math.cos(angle)) };
    controller.pointerMove({ ...pointer(point.x), screenPosition: point, cssPosition: point });
  }
  const before = simplifyRouteDraft(controller.activeDraftSnapshot, config);
  ship.setPosition({ x: 405.23, y: 400.17 });
  controller.syncActiveDraftToShip();
  assert.deepEqual(simplifyRouteDraft(controller.activeDraftSnapshot, config), before);
  ship.setPosition(before[0]);
  controller.syncActiveDraftToShip();
  assert.deepEqual(simplifyRouteDraft(controller.activeDraftSnapshot, config), before.slice(1));
});

test('COR-12 reaching the last raw sample keeps an unvisited live tip visible', async () => {
  const { ship, controller, pointer } = await createPointerSubject();
  controller.pointerDown(pointer(400));
  controller.pointerMove(pointer(412));
  controller.pointerMove(pointer(419));
  ship.setPosition({ x: 412, y: 400 });
  controller.syncActiveDraftToShip();
  assert.deepEqual(simplifyRouteDraft(controller.activeDraftSnapshot, config), [{ x: 419, y: 400 }]);
  ship.setPosition({ x: 419, y: 400 });
  controller.syncActiveDraftToShip();
  assert.deepEqual(simplifyRouteDraft(controller.activeDraftSnapshot, config), []);
});

test('COR-12 visual heading eases a sharp turn without owning ship movement', async () => {
  const { smoothShipHeading } = await import('../src/presentation/ShipHeadingPresentation.ts');
  const first = smoothShipHeading(0, 90, 1000 / 60);
  assert.ok(first > 0 && first < 30, `first-frame rotation was ${first}`);
  let heading = first;
  for (let i = 1; i < 30; i++) heading = smoothShipHeading(heading, 90, 1000 / 60);
  assert.ok(Math.abs(90 - heading) < 1, 'turn should settle promptly, not produce slow rudder inertia');
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

test('COR-12 docked vessel unloads bow-first into the berth', async () => {
  const { resolveShipVisualHeading } = await import('../src/presentation/ShipHeadingPresentation.ts');
  assert.deepEqual(resolveShipVisualHeading('Docking', 90, 90), {
    targetHeading: 270, snap: false,
  });
  assert.deepEqual(resolveShipVisualHeading('Unloading', 90, 90), {
    targetHeading: 270, snap: false,
  });
});

test('COR-12 ReadyToLeave snaps the docked vessel bow toward open water', async () => {
  const { resolveShipVisualHeading } = await import('../src/presentation/ShipHeadingPresentation.ts');
  assert.deepEqual(resolveShipVisualHeading('ReadyToLeave', 90, 90), {
    targetHeading: 90, snap: true,
  });
  assert.deepEqual(resolveShipVisualHeading('Navigating', 45, undefined), {
    targetHeading: 45, snap: false,
  });
});
