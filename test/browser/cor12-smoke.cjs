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

    console.log(`Browser smoke: PASS (${passed}/8)`);
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
