const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const {
  buildViteLaunch,
  terminateOwnedProcess,
} = require('./browser-runner.cjs');

const HOST = '127.0.0.1';
const PORT = 4173;
const URL = `http://${HOST}:${PORT}`;

function waitForServer(timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      const request = http.get(URL, (response) => {
        response.resume();
        if ((response.statusCode ?? 500) < 500) {
          resolve();
          return;
        }
        retry();
      });
      request.on('error', retry);
    };
    const retry = () => {
      if (Date.now() - started >= timeoutMs) {
        reject(new Error('Vite server did not become ready'));
        return;
      }
      setTimeout(probe, 150);
    };
    probe();
  });
}

function rectInside(rect, viewport) {
  return (
    rect !== null &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.width <= viewport.width + 1 &&
    rect.y + rect.height <= viewport.height + 1
  );
}

function assertCenteredHorizontally(rect, viewport) {
  assert.ok(rect);
  assert.ok(Math.abs(rect.x + rect.width / 2 - viewport.width / 2) <= 1);
}

function worldToCss(snapshot, point) {
  const scale = snapshot.worldViewportCss.width / 1000;
  return {
    x: snapshot.worldViewportCss.x + point.x * scale,
    y: snapshot.worldViewportCss.y + point.y * scale,
  };
}

function firstRouteEligibleShip(snapshot) {
  return snapshot.ships.find((ship) =>
    ['Entering', 'Navigating', 'ReadyToLeave', 'Leaving'].includes(ship.state),
  );
}

async function main() {
  const launch = buildViteLaunch({ host: HOST, port: PORT });
  const server = spawn(
    launch.command,
    launch.args,
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: launch.detached,
      windowsHide: true,
    },
  );
  let serverError = '';
  server.stderr.on('data', (chunk) => {
    serverError += String(chunk);
  });

  let browser;
  let context;
  let page;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    page = await context.newPage();
    const uncaught = [];
    page.on('pageerror', (error) => uncaught.push(String(error)));

    let passed = 0;
    async function check(name, body) {
      await body();
      passed += 1;
      console.log(`ok ${passed} - ${name}`);
    }

    await check('BROWSER-01 app opens without uncaught exception', async () => {
      await page.goto(URL, { waitUntil: 'networkidle' });
      await page.waitForFunction(
        () => globalThis.__PORT_CONTROL_SMOKE__?.getSnapshot?.()?.sceneRunning === true,
        null,
        { timeout: 15000 },
      );
      assert.deepEqual(uncaught, []);
    });

    await check('BROWSER-02 canvas exists and has non-zero dimensions', async () => {
      const canvas = page.locator('canvas');
      await canvas.waitFor({ state: 'visible' });
      const box = await canvas.boundingBox();
      assert.ok(box);
      assert.ok(box.width > 0);
      assert.ok(box.height > 0);
    });

    await check('BROWSER-03 calm_07 HarborScene is running', async () => {
      const snapshot = await page.evaluate(() => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
      assert.equal(snapshot.levelId, 'calm_07');
      assert.equal(snapshot.sceneRunning, true);
    });

    if (process.env.PORT_CONTROL_SMOKE_FORCE_FAILURE === '1') {
      throw new Error('Forced browser smoke failure for cleanup verification');
    }

    await check('BROWSER-04 desktop 1600x900 HUD is visible inside viewport', async () => {
      const snapshot = await page.evaluate(() => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
      const viewport = { width: 1600, height: 900 };
      assert.equal(snapshot.hudVisible, true);
      assert.ok(rectInside(snapshot.canvasCssBounds, viewport));
      assert.ok(rectInside(snapshot.hudCssBounds, viewport));
      assert.ok(snapshot.hudCssFontPixels >= 14);
      assert.ok(rectInside(snapshot.worldViewportCss, viewport));
      assert.ok(Math.abs(snapshot.worldViewportCss.width - snapshot.worldViewportCss.height) <= 1);
      assert.ok(Math.abs(snapshot.worldViewportCss.height - 900) <= 1);
      assert.notEqual(snapshot.internalGameSize.width, viewport.width);
      assert.deepEqual(uncaught, []);
    });

    await check('BROWSER-05 portrait 390x844 HUD is visible inside viewport', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(150);
      const snapshot = await page.evaluate(() => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
      const viewport = { width: 390, height: 844 };
      assert.equal(snapshot.hudVisible, true);
      assert.ok(rectInside(snapshot.canvasCssBounds, viewport));
      assert.ok(rectInside(snapshot.hudCssBounds, viewport));
      assert.ok(snapshot.hudCssFontPixels >= 14);
      assert.ok(rectInside(snapshot.worldViewportCss, viewport));
      assert.ok(Math.abs(snapshot.worldViewportCss.width - snapshot.worldViewportCss.height) <= 1);
      assert.ok(Math.abs(snapshot.worldViewportCss.width - 390) <= 1);
      assert.notEqual(snapshot.internalGameSize.height, viewport.height);
      assert.deepEqual(uncaught, []);
    });

    await check('BROWSER-06 terminal layout center and action stay in viewport', async () => {
      const snapshot = await page.evaluate(() => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
      const viewport = { width: 390, height: 844 };
      assert.ok(rectInside(snapshot.terminalTitleCssBounds, viewport));
      assert.ok(rectInside(snapshot.terminalActionCssBounds, viewport));
      assertCenteredHorizontally(snapshot.terminalTitleCssBounds, viewport);
      assertCenteredHorizontally(snapshot.terminalActionCssBounds, viewport);
      assert.ok(snapshot.terminalActionCssBounds.height >= 48);
      assert.ok(snapshot.terminalActionCssFontPixels >= 18);
      assert.equal(snapshot.terminalActionInteractive, true);
    });

    await check('BROWSER-07 resize does not crash scene', async () => {
      const before = await page.evaluate(() => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
      await page.setViewportSize({ width: 1000, height: 1000 });
      await page.waitForFunction(
        () => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().canvasCssBounds.width === 1000,
      );
      const snapshot = await page.evaluate(() => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
      assert.equal(snapshot.sceneRunning, true);
      assert.equal(snapshot.levelId, before.levelId);
      assert.equal(snapshot.attemptSeed, before.attemptSeed);
      assert.ok(snapshot.simulationTime >= before.simulationTime);
      assert.deepEqual(uncaught, []);
    });

    await check('BROWSER-08 pointer enters gameplay surface without page scrolling', async () => {
      const canvas = page.locator('canvas');
      const box = await canvas.boundingBox();
      assert.ok(box);
      await page.evaluate(() => {
        globalThis.__PORT_CONTROL_POINTER_SMOKE__ = 0;
        document.querySelector('canvas').addEventListener(
          'pointerdown',
          () => {
            globalThis.__PORT_CONTROL_POINTER_SMOKE__ += 1;
          },
          { once: true },
        );
      });
      const before = await page.evaluate(() => scrollY);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      const result = await page.evaluate(() => ({
        pointerCount: globalThis.__PORT_CONTROL_POINTER_SMOKE__,
        scrollY,
        touchAction: getComputedStyle(document.querySelector('canvas')).touchAction,
      }));
      assert.equal(result.pointerCount, 1);
      assert.equal(result.scrollY, before);
      assert.equal(result.touchAction, 'none');
    });

    await check('BROWSER-09 route-less Entering ship visibly moves', async () => {
      await page.waitForFunction(
        () => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().ships
          .some((ship) => ship.state === 'Entering' && ship.route === null),
        null,
        { timeout: 15000 },
      );
      const before = await page.evaluate(() => {
        const snapshot = globalThis.__PORT_CONTROL_SMOKE__.getSnapshot();
        return snapshot.ships.find((ship) => ship.state === 'Entering' && ship.route === null);
      });
      assert.ok(before);
      await page.waitForTimeout(150);
      const after = await page.evaluate((shipId) =>
        globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().ships
          .find((ship) => ship.id === shipId), before.id);
      assert.ok(after);
      assert.equal(after.state, 'Entering');
      assert.equal(after.route, null);
      assert.ok(Math.hypot(
        after.position.x - before.position.x,
        after.position.y - before.position.y,
      ) > 0.1);
    });

    await check('BROWSER-10 tap selects ship without routing', async () => {
      const before = await page.evaluate(() => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
      const ship = firstRouteEligibleShip(before);
      assert.ok(ship);
      const point = worldToCss(before, ship.position);
      await page.mouse.click(point.x, point.y);
      const after = await page.evaluate(() => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
      const sameShip = after.ships.find((candidate) => candidate.id === ship.id);
      assert.ok(sameShip);
      assert.equal(after.selectedShipId, ship.id);
      assert.equal(after.queuedRouteCommands, 0);
      assert.deepEqual(sameShip.route, ship.route);
    });

    let routedShipId;
    let committedRoute;
    await check('BROWSER-11 real 12px-plus drag commits a route', async () => {
      const before = await page.evaluate(() => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
      const ship = firstRouteEligibleShip(before);
      assert.ok(ship);
      routedShipId = ship.id;
      const start = worldToCss(before, ship.position);
      const heading = ship.rotationDeg * Math.PI / 180;
      const target = worldToCss(before, {
        x: ship.position.x + Math.cos(heading) * 80,
        y: ship.position.y + Math.sin(heading) * 80,
      });
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(target.x, target.y, { steps: 4 });
      await page.mouse.up();
      await page.waitForFunction((shipId) =>
        globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().ships
          .find((candidate) => candidate.id === shipId)?.route !== null,
        routedShipId,
        { timeout: 5000 },
      );
      const after = await page.evaluate(() => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
      const routed = after.ships.find((ship) => ship.id === routedShipId);
      assert.ok(routed);
      assert.notEqual(routed.route, null, JSON.stringify({
        beforeState: ship.state,
        afterState: routed.state,
        activeDraft: after.activeDraft,
        queuedRouteCommands: after.queuedRouteCommands,
      }));
      committedRoute = routed.route;
      assert.ok(committedRoute.points.length >= 1);
      assert.equal(after.queuedRouteCommands, 0);
    });

    await check('BROWSER-12 Escape cancels activated draft and preserves route', async () => {
      const before = await page.evaluate(() => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
      const ship = before.ships.find((candidate) => candidate.id === routedShipId);
      assert.ok(ship);
      const start = worldToCss(before, ship.position);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x, start.y + 40, { steps: 2 });
      await page.waitForFunction(() =>
        globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().activeDraft !== null);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      const after = await page.evaluate(() => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
      assert.equal(after.activeDraft, null);
      assert.equal(after.queuedRouteCommands, 0);
      assert.deepEqual(
        after.ships.find((candidate) => candidate.id === routedShipId)?.route,
        committedRoute,
      );
    });

    await check('BROWSER-13 right click cancels draft and suppresses context menu', async () => {
      const before = await page.evaluate(() => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
      const ship = before.ships.find((candidate) => candidate.id === routedShipId);
      assert.ok(ship);
      const start = worldToCss(before, ship.position);
      await page.evaluate(() => {
        globalThis.__PORT_CONTROL_CONTEXT_PREVENTED__ = false;
        document.querySelector('canvas').addEventListener('contextmenu', (event) => {
          globalThis.__PORT_CONTROL_CONTEXT_PREVENTED__ = event.defaultPrevented;
        }, { once: true });
      });
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x, start.y + 40, { steps: 2 });
      await page.waitForFunction(() =>
        globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().activeDraft !== null);
      await page.mouse.click(start.x, start.y, { button: 'right' });
      await page.mouse.up();
      const after = await page.evaluate(() => ({
        snapshot: globalThis.__PORT_CONTROL_SMOKE__.getSnapshot(),
        contextPrevented: globalThis.__PORT_CONTROL_CONTEXT_PREVENTED__,
      }));
      assert.equal(after.snapshot.activeDraft, null);
      assert.equal(after.snapshot.queuedRouteCommands, 0);
      assert.equal(after.contextPrevented, true);
      assert.deepEqual(
        after.snapshot.ships.find((candidate) => candidate.id === routedShipId)?.route,
        committedRoute,
      );
    });

    console.log(`Browser smoke: PASS (${passed}/13)`);
  } finally {
    try {
      await page?.close();
    } finally {
      try {
        await context?.close();
      } finally {
        try {
          await browser?.close();
        } finally {
          await terminateOwnedProcess(server);
        }
      }
    }
  }

  if (serverError.includes('error when starting dev server')) {
    throw new Error(serverError);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
