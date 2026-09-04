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

async function dragWorldRoute(page, shipId, worldPoints) {
  const before = await page.evaluate(() => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
  const ship = before.ships.find((candidate) => candidate.id === shipId);
  assert.ok(ship);
  const start = worldToCss(before, ship.position);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const point of worldPoints) {
    const cssPoint = worldToCss(before, point);
    await page.mouse.move(cssPoint.x, cssPoint.y, { steps: 4 });
  }
  await page.mouse.up();
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
    await page.addInitScript(() => {
      globalThis.crypto.getRandomValues = (values) => {
        values[0] = 3333;
        return values;
      };
    });
    const uncaught = [];
    page.on('pageerror', (error) => uncaught.push(String(error)));

    let passed = 0;
    async function check(name, body) {
      await body();
      passed += 1;
      console.log(`ok ${passed} - ${name}`);
    }

    await check('BROWSER-01 app opens without uncaught exception', async () => {
      await page.goto(`${URL}/?level=calm_01`, { waitUntil: 'networkidle' });
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

    await check('BROWSER-03 generic Human Feel launch runs calm_01 without island', async () => {
      const snapshot = await page.evaluate(() => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
      assert.equal(snapshot.levelId, 'calm_01');
      assert.equal(snapshot.sceneRunning, true);
      assert.equal(snapshot.land.length, 1);
    });

    if (process.env.PORT_CONTROL_SMOKE_FORCE_FAILURE === '1') {
      throw new Error('Forced browser smoke failure for cleanup verification');
    }

    await check('BROWSER-04 incoming vessel moves from fully offscreen toward its spawn', async () => {
      await page.waitForFunction(
        () => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().incoming.length > 0,
        null,
        { timeout: 5000 },
      );
      const before = await page.evaluate(() =>
        globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().incoming[0]);
      assert.ok(before);
      assert.ok(
        before.originPosition.x + before.collisionRadius < 0 ||
        before.originPosition.x - before.collisionRadius > 1000 ||
        before.originPosition.y + before.collisionRadius < 0 ||
        before.originPosition.y - before.collisionRadius > 1000,
      );
      const beforeDistance = Math.hypot(
        before.spawnPosition.x - before.position.x,
        before.spawnPosition.y - before.position.y,
      );
      await page.waitForFunction(({ shipId, beforePosition, beforeDistance }) => {
        const incoming = globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().incoming
          .find((candidate) => candidate.shipId === shipId);
        return incoming !== undefined &&
          Math.hypot(
            incoming.position.x - beforePosition.x,
            incoming.position.y - beforePosition.y,
          ) > 0.1 &&
          Math.hypot(
            incoming.spawnPosition.x - incoming.position.x,
            incoming.spawnPosition.y - incoming.position.y,
          ) < beforeDistance;
      }, {
        shipId: before.shipId,
        beforePosition: before.position,
        beforeDistance,
      }, { timeout: 2000 });
    });

    await check('BROWSER-05 desktop 1600x900 HUD is visible inside viewport', async () => {
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

    await check('BROWSER-06 portrait 390x844 HUD is visible inside viewport', async () => {
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

    await check('BROWSER-07 terminal layout center and action stay in viewport', async () => {
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

    await check('BROWSER-08 resize does not crash scene', async () => {
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

    await check('BROWSER-09 pointer enters gameplay surface without page scrolling', async () => {
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

    await check('BROWSER-10 route-less Entering ship visibly moves', async () => {
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

    let tappedShipId;
    await check('BROWSER-11 tap selects ship without routing', async () => {
      await page.waitForFunction(() =>
        globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().ships.some((ship) =>
          ship.state === 'Entering' &&
          ship.position.x >= 30 && ship.position.x <= 970 &&
          ship.position.y >= 30 && ship.position.y <= 970));
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      const before = await page.evaluate(() => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
      const ship = before.ships.find((candidate) =>
        candidate.state === 'Entering' &&
        candidate.position.x >= 30 && candidate.position.x <= 970 &&
        candidate.position.y >= 30 && candidate.position.y <= 970);
      assert.ok(ship);
      tappedShipId = ship.id;
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
    await check('BROWSER-12 real 12px-plus drag commits a route', async () => {
      const before = await page.evaluate(() => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
      const ship = before.ships.find((candidate) => candidate.id === tappedShipId);
      assert.ok(ship);
      routedShipId = ship.id;
      const start = worldToCss(before, ship.position);
      const heading = ship.rotationDeg * Math.PI / 180;
      const target = worldToCss(before, {
        x: ship.position.x + Math.cos(heading) * 120,
        y: ship.position.y + Math.sin(heading) * 120,
      });
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(target.x, target.y, { steps: 4 });
      await page.mouse.up();
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.waitForTimeout(100);
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
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    });

    await check('BROWSER-13 Escape cancels activated draft and preserves route', async () => {
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

    await check('BROWSER-14 right click cancels draft and suppresses context menu', async () => {
      const before = await page.evaluate(() => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
      const ship = before.ships.find((candidate) => candidate.id === routedShipId);
      assert.ok(ship);
      const routeBeforeCancel = ship.route;
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
        after.snapshot.ships.find((candidate) => candidate.id === ship.id)?.route,
        routeBeforeCancel,
      );
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    });

    await check('BROWSER-15 outward drag commits an exact world-edge endpoint', async () => {
      await page.setViewportSize({ width: 1600, height: 900 });
      await page.waitForFunction(
        () => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().canvasCssBounds.width === 1600,
      );
      await page.waitForFunction(() =>
        globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().ships.some((ship) =>
          ship.state === 'Entering' &&
          ship.position.x >= 30 && ship.position.x <= 970 &&
          ship.position.y >= 30 && ship.position.y <= 970));
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      const before = await page.evaluate(() => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
      const ship = before.ships.find((candidate) =>
        candidate.state === 'Entering' &&
        candidate.position.x >= 30 && candidate.position.x <= 970 &&
        candidate.position.y >= 30 && candidate.position.y <= 970);
      assert.ok(ship);
      const outsideX = ship.position.x < 500 ? -100 : 1100;
      await dragWorldRoute(page, ship.id, [{ x: outsideX, y: ship.position.y + 80 }]);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.waitForFunction(({ shipId, edgeX }) => {
        const route = globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().ships
          .find((candidate) => candidate.id === shipId)?.route;
        return route !== null && route?.points.at(-1)?.x === edgeX;
      }, { shipId: ship.id, edgeX: outsideX < 0 ? 0 : 1000 },
        { timeout: 5000 },
      );
      const route = await page.evaluate((shipId) =>
        globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().ships
          .find((candidate) => candidate.id === shipId)?.route, ship.id);
      assert.ok(route);
      const endpoint = route.points.at(-1);
      assert.ok(endpoint);
      assert.equal(endpoint.x, outsideX < 0 ? 0 : 1000);
      assert.ok(endpoint.y >= 0 && endpoint.y <= 1000);
    });

    await check('BROWSER-16 explicit calm_07 launch preserves its island layout', async () => {
      const calm07Page = await context.newPage();
      try {
        await calm07Page.goto(`${URL}/?level=calm_07`, { waitUntil: 'networkidle' });
        await calm07Page.waitForFunction(
          () => globalThis.__PORT_CONTROL_SMOKE__?.getSnapshot?.()?.sceneRunning === true,
          null,
          { timeout: 15000 },
        );
        const snapshot = await calm07Page.evaluate(() =>
          globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
        assert.equal(snapshot.levelId, 'calm_07');
        assert.equal(snapshot.land.length, 2);
      } finally {
        await calm07Page.close();
      }
    });

    await check('BROWSER-17 stable route, guided dock, cargo pips and short outbound complete once', async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      const flowPage = await context.newPage();
      const flowErrors = [];
      flowPage.on('pageerror', (error) => flowErrors.push(String(error)));
      await flowPage.addInitScript(() => {
        globalThis.crypto.getRandomValues = (values) => {
          values[0] = 3333;
          return values;
        };
      });
      try {
        await flowPage.goto(`${URL}/?level=calm_01`, { waitUntil: 'networkidle' });
        await flowPage.waitForFunction(
          () => globalThis.__PORT_CONTROL_SMOKE__?.getSnapshot?.()?.ships.some((ship) =>
            ['Entering', 'Navigating'].includes(ship.state) &&
            ship.position.x >= 30 && ship.position.x <= 970 &&
            ship.position.y >= 30 && ship.position.y <= 970),
          null,
          { timeout: 15000 },
        );
        await flowPage.evaluate(() => window.dispatchEvent(new Event('blur')));
        let snapshot = await flowPage.evaluate(() =>
          globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
        const ship = snapshot.ships.find((candidate) =>
          ['Entering', 'Navigating'].includes(candidate.state) &&
          candidate.position.x >= 30 && candidate.position.x <= 970 &&
          candidate.position.y >= 30 && candidate.position.y <= 970);
        assert.ok(ship);
        const dock = [...snapshot.docks].sort(
          (a, b) => Math.abs(a.definition.position.x - ship.position.x) -
            Math.abs(b.definition.position.x - ship.position.x),
        )[0];
        assert.ok(dock);
        const dockX = dock.definition.position.x;
        const inbound = ship.position.y > 700
          ? [
              { x: ship.position.x, y: 700 },
              { x: dockX, y: 300 },
              { x: dockX, y: dock.definition.position.y },
            ]
          : [
              { x: ship.position.x < 500 ? 180 : 820, y: ship.position.y },
              { x: dockX, y: 300 },
              { x: dockX, y: dock.definition.position.y },
            ];
        await dragWorldRoute(flowPage, ship.id, inbound);
        await flowPage.evaluate(() => window.dispatchEvent(new Event('focus')));
        await flowPage.waitForFunction((shipId) => {
          const candidate = globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().ships
            .find((current) => current.id === shipId);
          return candidate?.route !== null && candidate?.remainingRoute?.length > 1;
        }, ship.id, { timeout: 5000 });
        const committed = await flowPage.evaluate((shipId) => {
          const candidate = globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().ships
            .find((current) => current.id === shipId);
          return {
            points: candidate.route.points,
            rotationDeg: candidate.rotationDeg,
          };
        }, ship.id);
        await flowPage.waitForFunction(({ shipId, rotationDeg }) => {
          const candidate = globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().ships
            .find((current) => current.id === shipId);
          if (candidate === undefined) return false;
          const delta = Math.abs(((candidate.rotationDeg - rotationDeg + 540) % 360) - 180);
          return candidate.routeProgress > 20 && delta > 2;
        }, { shipId: ship.id, rotationDeg: committed.rotationDeg }, { timeout: 15000 });
        const following = await flowPage.evaluate((shipId) =>
          globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().ships
            .find((candidate) => candidate.id === shipId), ship.id);
        assert.deepEqual(following.route.points, committed.points);
        assert.deepEqual(
          following.remainingRoute.slice(1),
          committed.points.slice(following.routeCursor),
        );
        assert.notDeepEqual(following.remainingRoute[0], following.position);

        await flowPage.waitForFunction((shipId) =>
          globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().ships
            .find((candidate) => candidate.id === shipId)?.state === 'Unloading',
          ship.id,
          { timeout: 30000 },
        );
        const unloading = await flowPage.evaluate((shipId) => {
          const current = globalThis.__PORT_CONTROL_SMOKE__.getSnapshot();
          const candidate = current.ships.find((value) => value.id === shipId);
          return {
            ship: candidate,
            pips: current.cargoPips.find((value) => value.shipId === shipId)?.count,
          };
        }, ship.id);
        const cargoBefore = Object.values(unloading.ship.cargo)
          .reduce((total, quantity) => total + quantity, 0);
        assert.deepEqual(unloading.ship.position, dock.definition.position);
        assert.equal(unloading.ship.rotationDeg, dock.definition.dockAngle);
        assert.equal(unloading.pips, cargoBefore);
        await flowPage.waitForFunction(({ shipId, cargoBefore }) => {
          const current = globalThis.__PORT_CONTROL_SMOKE__.getSnapshot();
          const candidate = current.ships.find((value) => value.id === shipId);
          const cargo = Object.values(candidate?.cargo ?? {})
            .reduce((total, quantity) => total + quantity, 0);
          const pips = current.cargoPips.find((value) => value.shipId === shipId)?.count;
          return cargo < cargoBefore && pips === cargo;
        }, { shipId: ship.id, cargoBefore }, { timeout: 10000 });
        await flowPage.waitForFunction((shipId) =>
          globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().ships
            .find((candidate) => candidate.id === shipId)?.state === 'ReadyToLeave',
          ship.id,
          { timeout: 30000 },
        );
        snapshot = await flowPage.evaluate(() =>
          globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
        const ready = snapshot.ships.find((candidate) => candidate.id === ship.id);
        assert.ok(ready);
        await flowPage.waitForTimeout(150);
        const stillReady = await flowPage.evaluate((shipId) =>
          globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().ships
            .find((candidate) => candidate.id === shipId), ship.id);
        assert.equal(stillReady.state, 'ReadyToLeave');
        assert.deepEqual(stillReady.position, ready.position);
        const scoreBeforeExit = snapshot.score;
        await dragWorldRoute(flowPage, ship.id, [{ x: dockX, y: ready.position.y + 60 }]);
        await flowPage.waitForFunction((shipId) =>
          globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().ships
            .find((candidate) => candidate.id === shipId)?.state === 'Leaving',
          ship.id,
          { timeout: 5000 },
        );
        const leaving = await flowPage.evaluate((shipId) =>
          globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().ships
            .find((candidate) => candidate.id === shipId), ship.id);
        assert.ok(leaving.route.points.at(-1).y < 1000);
        const departedHandle = await flowPage.waitForFunction((shipId) => {
          const current = globalThis.__PORT_CONTROL_SMOKE__.getSnapshot();
          const departure = current.departures.find((candidate) => candidate.shipId === shipId);
          return departure === undefined ? false : { departure, score: current.score };
        }, ship.id, { timeout: 30000 });
        const departed = await departedHandle.jsonValue();
        await departedHandle.dispose();
        assert.ok(departed.departure);
        assert.ok(departed.score > scoreBeforeExit);
        await flowPage.waitForFunction(({ shipId, position }) => {
          const departure = globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().departures
            .find((candidate) => candidate.shipId === shipId);
          return departure !== undefined && Math.hypot(
            departure.position.x - position.x,
            departure.position.y - position.y,
          ) > 0.1;
        }, { shipId: ship.id, position: departed.departure.position }, { timeout: 2000 });
        await flowPage.waitForFunction((shipId) => {
          const current = globalThis.__PORT_CONTROL_SMOKE__.getSnapshot();
          return !current.ships.some((candidate) => candidate.id === shipId) &&
            !current.departures.some((candidate) => candidate.shipId === shipId);
        }, ship.id, { timeout: 5000 });
        const after = await flowPage.evaluate(() =>
          globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
        assert.equal(after.score, departed.score);
        assert.deepEqual(flowErrors, []);
      } finally {
        await flowPage.close();
      }
    });

    await check('BROWSER-18 two stopped dock ships do not stop later incoming traffic', async () => {
      const pressurePage = await context.newPage();
      const pressureErrors = [];
      pressurePage.on('pageerror', (error) => pressureErrors.push(String(error)));
      await pressurePage.addInitScript(() => {
        globalThis.crypto.getRandomValues = (values) => {
          values[0] = 7070;
          return values;
        };
      });
      const interiorShip = async (excludedIds = []) => {
        await pressurePage.waitForFunction((excluded) =>
          globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().ships.some((ship) =>
            !excluded.includes(ship.id) &&
            ['Entering', 'Navigating'].includes(ship.state) &&
            ship.position.x >= 30 && ship.position.x <= 970 &&
            ship.position.y >= 30 && ship.position.y <= 970),
        excludedIds, { timeout: 20000 });
        const current = await pressurePage.evaluate(() =>
          globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
        return {
          snapshot: current,
          ship: current.ships.find((ship) =>
            !excludedIds.includes(ship.id) &&
            ['Entering', 'Navigating'].includes(ship.state) &&
            ship.position.x >= 30 && ship.position.x <= 970 &&
            ship.position.y >= 30 && ship.position.y <= 970),
        };
      };
      const routeAssignedDock = async (ship, dock) => {
        await pressurePage.evaluate(() => window.dispatchEvent(new Event('blur')));
        const current = await pressurePage.evaluate(() =>
          globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
        const liveShip = current.ships.find((candidate) => candidate.id === ship.id);
        assert.ok(liveShip);
        const points = liveShip.position.y > 700
          ? [
              { x: liveShip.position.x, y: 700 },
              { x: dock.definition.position.x, y: 300 },
              { ...dock.definition.position },
            ]
          : [
              { x: dock.definition.position.x, y: liveShip.position.y },
              { x: dock.definition.position.x, y: 300 },
              { ...dock.definition.position },
            ];
        await dragWorldRoute(pressurePage, liveShip.id, points);
        await pressurePage.evaluate(() => window.dispatchEvent(new Event('focus')));
        await pressurePage.waitForFunction((shipId) =>
          globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().ships
            .find((candidate) => candidate.id === shipId)?.route !== null,
        liveShip.id, { timeout: 5000 });
      };
      try {
        await pressurePage.goto(`${URL}/?level=calm_01`, { waitUntil: 'networkidle' });
        const first = await interiorShip();
        assert.ok(first.ship);
        const docks = [...first.snapshot.docks]
          .sort((left, right) => left.definition.position.x - right.definition.position.x);
        assert.equal(docks.length, 2);
        const firstDockIndex = Math.abs(first.ship.position.x - docks[0].definition.position.x) <=
          Math.abs(first.ship.position.x - docks[1].definition.position.x) ? 0 : 1;
        await routeAssignedDock(first.ship, docks[firstDockIndex]);

        const second = await interiorShip([first.ship.id]);
        assert.ok(second.ship);
        await routeAssignedDock(second.ship, docks[1 - firstDockIndex]);
        const servicedIds = [first.ship.id, second.ship.id];
        await pressurePage.waitForFunction((ids) => {
          const current = globalThis.__PORT_CONTROL_SMOKE__.getSnapshot();
          return ids.every((id) => current.ships.find((ship) => ship.id === id)?.state === 'ReadyToLeave') &&
            current.ships.some((ship) => !ids.includes(ship.id));
        }, servicedIds, { timeout: 30000 });
        const stopped = await pressurePage.evaluate(() =>
          globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
        for (const [index, shipId] of servicedIds.entries()) {
          const stoppedShip = stopped.ships.find((ship) => ship.id === shipId);
          assert.ok(stoppedShip);
          assert.deepEqual(stoppedShip.position, docks[index === 0 ? firstDockIndex : 1 - firstDockIndex].definition.position);
        }
        const existingIds = stopped.ships.map((ship) => ship.id);
        await pressurePage.waitForFunction((ids) => {
          const current = globalThis.__PORT_CONTROL_SMOKE__.getSnapshot();
          return current.incoming.some((incoming) => !ids.includes(incoming.shipId)) ||
            current.ships.some((ship) => !ids.includes(ship.id));
        }, existingIds, { timeout: 15000 });
        assert.deepEqual(pressureErrors, []);
      } finally {
        await pressurePage.close();
      }
    });

    console.log(`Browser smoke: PASS (${passed}/${passed})`);
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
