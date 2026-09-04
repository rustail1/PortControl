import assert from 'node:assert/strict';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

async function setup() {
  const [camera, presentation, runtime, config] = await Promise.all([
    import('../src/camera/SquareWorldViewport.ts'),
    import('../src/presentation/HarborUiLayout.ts'),
    import('../src/runtime/HarborRuntime.ts'),
    import('../src/config/validateConfigSource.ts'),
  ]);
  return {
    ...camera,
    ...presentation,
    ...runtime,
    bundle: config.validateConfigSource(readBaselineSource()),
  };
}

function assertClose(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

test('COR-12 HUMAN #01 maps 1777.777 internal width to 1600 CSS pixels', async () => {
  const subject = await setup();
  assert.equal(typeof subject.createDisplayCoordinateContract, 'function');
  const display = subject.createDisplayCoordinateContract({
    internalGameSize: { width: 1600 / 0.9, height: 1000 },
    canvasCssBounds: { x: 0, y: 0, width: 1600, height: 900 },
  });

  assert.deepEqual(display.internalPointToCss({ x: 1600 / 0.9, y: 1000 }), {
    x: 1600,
    y: 900,
  });
  assertClose(display.internalToCssScale.x, 0.9);
  assertClose(display.internalToCssScale.y, 0.9);
});

test('COR-12 HUMAN #02 maps 1000x2164.102 internal portrait to 390x844 CSS', async () => {
  const subject = await setup();
  assert.equal(typeof subject.createDisplayCoordinateContract, 'function');
  const display = subject.createDisplayCoordinateContract({
    internalGameSize: { width: 1000, height: 844 / 0.39 },
    canvasCssBounds: { x: 0, y: 0, width: 390, height: 844 },
  });

  assert.deepEqual(display.internalPointToCss({ x: 500, y: (844 / 0.39) / 2 }), {
    x: 195,
    y: 422,
  });
  assertClose(display.cssToInternalScale.x, 1 / 0.39);
  assertClose(display.cssToInternalScale.y, 1 / 0.39);
});

for (const [name, internalGameSize, canvasCssBounds, expectedWorldToCss] of [
  ['desktop', { width: 1600 / 0.9, height: 1000 }, { x: 0, y: 0, width: 1600, height: 900 }, 0.9],
  ['portrait', { width: 1000, height: 844 / 0.39 }, { x: 0, y: 0, width: 390, height: 844 }, 0.39],
]) {
  test(`COR-12 HUMAN selection target is at least 48 CSS px on ${name}`, async () => {
    const subject = await setup();
    assert.equal(typeof subject.createDisplayCoordinateContract, 'function');
    const display = subject.createDisplayCoordinateContract({ internalGameSize, canvasCssBounds });
    const worldToCss = display.worldToCssPixelScale(1);
    const selectionWorldRadius = 24 / worldToCss;

    assertClose(selectionWorldRadius * worldToCss * 2, 48);
    const ship = {
      id: 'small',
      state: 'Navigating',
      x: 100,
      y: 100,
      characteristics: { collisionRadius: 14 },
    };
    assert.equal(
      subject.selectRouteInputShip(
        [{ ship, spawnSequence: 1 }],
        { x: 100 + selectionWorldRadius - 1e-6, y: 100 },
        worldToCss,
      )?.id,
      'small',
    );
  });
}

for (const [name, internalGameSize, canvasCssBounds] of [
  ['square', { width: 1000, height: 1000 }, { x: 0, y: 0, width: 1000, height: 1000 }],
  ['desktop', { width: 1600 / 0.9, height: 1000 }, { x: 0, y: 0, width: 1600, height: 900 }],
  ['portrait', { width: 1000, height: 844 / 0.39 }, { x: 0, y: 0, width: 390, height: 844 }],
]) {
  test(`COR-12 HUMAN UI layout remains CSS-readable on ${name}`, async () => {
    const subject = await setup();
    assert.equal(typeof subject.createDisplayCoordinateContract, 'function');
    const display = subject.createDisplayCoordinateContract({ internalGameSize, canvasCssBounds });
    const layout = subject.createHarborUiLayout(display.cssViewport);
    const hudInternal = display.cssLocalPointToInternal(layout.hud);
    const hudCss = display.internalPointToCss(hudInternal);
    const terminalInternal = display.cssLocalPointToInternal(layout.terminalAction);
    const terminalCss = display.internalPointToCss(terminalInternal);

    assert.deepEqual(hudCss, { x: 12, y: 12 });
    assertClose(terminalCss.x, canvasCssBounds.width / 2);
    assert.ok(terminalCss.y >= 0 && terminalCss.y <= canvasCssBounds.height);
    assertClose(display.cssObjectScale.x * display.internalToCssScale.x, 1);
    assertClose(display.cssObjectScale.y * display.internalToCssScale.y, 1);
  });
}

test('COR-12 HUMAN RouteInputController forwards CSS world scale to hit testing', async () => {
  const subject = await setup();
  let observedScale = null;
  const controller = new (await import('../src/routes/RouteInputController.ts')).RouteInputController({
    viewport: new subject.SquareWorldViewport({ width: 1000, height: 1000 }),
    sampling: { sampleDistance: 8, maxRawPoints: 256 },
    hitTest: (_point, worldToCssPixelScale) => {
      observedScale = worldToCssPixelScale;
      return null;
    },
  });

  controller.pointerDown({
    source: 'touch',
    pointerId: 1,
    screenPosition: { x: 500, y: 1082 },
    cssPosition: { x: 195, y: 422 },
    internalViewport: { width: 1000, height: 844 / 0.39 },
    worldToCssPixelScale: 0.39,
  });

  assert.equal(observedScale, 0.39);
});

test('COR-12 HUMAN danger clipping stops exactly at 120 units', async () => {
  const subject = await setup();
  assert.equal(typeof subject.clipRoutePolyline, 'function');
  assert.deepEqual(
    subject.clipRoutePolyline(
      { x: 0, y: 0 },
      [{ x: 50, y: 0 }, { x: 50, y: 100 }, { x: 150, y: 100 }],
      120,
    ),
    [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 70 }],
  );
});

test('COR-12 HUMAN danger clipping does not mutate committed route points', async () => {
  const subject = await setup();
  assert.equal(typeof subject.clipRoutePolyline, 'function');
  const route = Object.freeze([
    Object.freeze({ x: 30, y: 40 }),
    Object.freeze({ x: 90, y: 40 }),
  ]);
  const before = structuredClone(route);

  subject.clipRoutePolyline({ x: 0, y: 0 }, route, 50);

  assert.deepEqual(route, before);
});

test('COR-12 HUMAN selected ship persists after commit and clears with draft cancellation', async () => {
  const subject = await setup();
  const runtime = new subject.HarborRuntime({ bundle: subject.bundle, levelId: 'calm_01', attemptSeed: 123 });
  let snapshot;
  for (let frame = 0; frame < 1600; frame += 1) {
    runtime.advanceRender(1000 / 60);
    snapshot = runtime.presentationSnapshot();
    if (snapshot.ships.length > 0) break;
  }
  const ship = snapshot.ships[0];
  const input = (screenPosition) => ({
    source: 'mouse',
    pointerId: 1,
    screenPosition,
    cssPosition: screenPosition,
    internalViewport: { width: 1000, height: 1000 },
    worldToCssPixelScale: 1,
  });
  runtime.pointerDown(input(ship.ship.position));
  const headingRadians = ship.ship.rotationDeg * Math.PI / 180;
  runtime.pointerMove(input({
    x: ship.ship.position.x + Math.cos(headingRadians) * 100,
    y: ship.ship.position.y + Math.sin(headingRadians) * 100,
  }));
  runtime.pointerUp(input({
    x: ship.ship.position.x + Math.cos(headingRadians) * 140,
    y: ship.ship.position.y + Math.sin(headingRadians) * 140,
  }));
  assert.equal(runtime.presentationSnapshot().selectedShipId, ship.ship.id);

  runtime.pointerDown(input(ship.ship.position));
  runtime.cancelActiveDraft();
  assert.equal(runtime.presentationSnapshot().selectedShipId, null);
});
