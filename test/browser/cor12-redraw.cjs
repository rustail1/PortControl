const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { buildViteLaunch, terminateOwnedProcess } = require('./browser-runner.cjs');

const url = 'http://127.0.0.1:4181';
const artifacts = mkdtempSync(path.join(tmpdir(), 'port-control-redraw-'));
const css = (snapshot, point) => ({
  x: Math.round(snapshot.worldViewportCss.x + point.x * snapshot.worldViewportCss.width / 1000),
  y: Math.round(snapshot.worldViewportCss.y + point.y * snapshot.worldViewportCss.height / 1000),
});

async function main() {
  const launch = buildViteLaunch({ host: '127.0.0.1', port: 4181 });
  const server = spawn(launch.command, launch.args, {
    stdio: ['ignore', 'pipe', 'pipe'], detached: launch.detached, windowsHide: true,
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Vite startup timed out')), 20000);
      server.once('error', reject);
      server.stdout.on('data', chunk => {
        if (String(chunk).includes('4181')) { clearTimeout(timer); resolve(); }
      });
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.addInitScript(() => {
      crypto.getRandomValues = values => { values[0] = 3333; return values; };
    });
    await page.goto(`${url}/?level=calm_01`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => globalThis.__PORT_CONTROL_SMOKE__?.getSnapshot()
      ?.ships.some(ship => ship.state === 'Entering' && ship.position.x < 900), null,
    { timeout: 15000 });
    // Capture the real scene through the existing read-only smoke method; no gameplay injection.
    await page.evaluate(async () => {
      const { HarborScene } = await import('/src/scenes/HarborScene.ts');
      const original = HarborScene.prototype.browserSmokeSnapshot;
      HarborScene.prototype.browserSmokeSnapshot = function () {
        globalThis.__REDRAW_SCENE__ = this;
        return original.call(this);
      };
      try { globalThis.__PORT_CONTROL_SMOKE__.getSnapshot(); }
      finally { HarborScene.prototype.browserSmokeSnapshot = original; }
      window.dispatchEvent(new Event('focus'));
      globalThis.__REDRAW_SCENE__.game.loop.sleep();
    });
    const snapshot = () => page.evaluate(() => globalThis.__PORT_CONTROL_SMOKE__.getSnapshot());
    // Pause only the renderer scheduler between assertions. Blur would cancel the draft.
    // The actual Phaser loop and fixed-step simulation run normally during advance().
    const advance = milliseconds => page.evaluate(milliseconds => new Promise((resolve, reject) => {
      const loop = globalThis.__REDRAW_SCENE__.game.loop;
      const target = globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().simulationTime + milliseconds / 1000;
      const timeout = setTimeout(() => { loop.sleep(); reject(new Error('simulation did not advance')); }, 10000);
      loop.wake();
      const check = () => {
        if (globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().simulationTime >= target) {
          loop.sleep();
          clearTimeout(timeout);
          resolve();
        } else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }), milliseconds);
    const move = async (x, y, options) => {
      await page.mouse.move(x, y, options);
      await advance(20);
    };
    const down = async () => { await page.mouse.down(); await advance(20); };
    let state = await snapshot();
    const shipId = state.ships[0].id;
    let start = css(state, state.ships[0].position);
    await move(start.x, start.y);
    await down();
    const pressed = await snapshot();
    await move(150, start.y, { steps: 5 });
    const drawn = await snapshot();
    await page.mouse.up();
    await advance(50);
    state = await snapshot();
    const oldRoute = state.ships.find(ship => ship.id === shipId).route;
    assert.ok(oldRoute, `initial route missing: ${JSON.stringify({ ship: state.ships[0],
      pressed: pressed.activeDraft, drawn: drawn.activeDraft,
      times: [pressed.simulationTime, drawn.simulationTime, state.simulationTime],
      loop: await page.evaluate(() => ({ hidden: document.hidden,
        paused: globalThis.__REDRAW_SCENE__.game.isPaused,
        running: globalThis.__REDRAW_SCENE__.game.loop.running,
        frame: globalThis.__REDRAW_SCENE__.game.loop.frame })) })}`);
    start = css(state, state.ships.find(ship => ship.id === shipId).position);
    start.x += 12; // A normal off-centre grab must not create a false corner.
    await move(start.x, start.y);
    await down();
    await move(start.x, start.y - 30, { steps: 2 });
    await move(start.x, start.y - 140, { steps: 4 });
    const beforeMovement = (await snapshot()).ships.find(ship => ship.id === shipId).position;
    await advance(600);
    const afterMovement = (await snapshot()).ships.find(ship => ship.id === shipId).position;
    assert.ok(Math.hypot(afterMovement.x - beforeMovement.x, afterMovement.y - beforeMovement.y) > 20,
      'vessel must continue the old route while pointer is held');
    await page.screenshot({ path: path.join(artifacts, 'redraw.png') });
    const readVisible = () => page.evaluate(shipId => {
      const objects = globalThis.__REDRAW_SCENE__.children.list;
      const draft = objects.find(object => object.type === 'Graphics' &&
        object.commandBuffer.includes(0xfff0a6));
      const oldRoutes = objects.filter(object => object.type === 'Graphics' &&
        object.depth === 5 && object.visible && object.commandBuffer.length > 0);
      const selected = globalThis.__PORT_CONTROL_SMOKE__.getSnapshot().ships.find(ship => ship.id === shipId);
      const distanceToShip = body => Math.hypot(body.x - selected.position.x, body.y - selected.position.y);
      const body = objects.filter(object => object.type === 'Graphics' && object.depth === 10 &&
        object.alpha === 1).sort((left, right) => distanceToShip(left) - distanceToShip(right))[0];
      const ends = [];
      const buffer = draft?.commandBuffer ?? [];
      const sizes = { 1: 1, 2: 1, 4: 3, 5: 3, 6: 4, 7: 3, 8: 1, 9: 1 };
      let anchor;
      for (let i = 0; i < buffer.length; i += sizes[buffer[i]] ?? buffer.length) {
        if (buffer[i] === 5) anchor = { x: buffer[i + 1], y: buffer[i + 2] };
        if (buffer[i] === 4) ends.push({ x: buffer[i + 1], y: buffer[i + 2] });
      }
      return { oldRoutes: oldRoutes.length, draftDepth: draft?.depth, bodyDepth: body?.depth,
        anchor, body: { x: body.x, y: body.y }, ends,
        bodyHeading: body.rotation * 180 / Math.PI, targetHeading: selected.rotationDeg };
    }, shipId);
    const visible = await readVisible();
    console.log(JSON.stringify({ artifacts, visible }));
    assert.equal(visible.oldRoutes, 0, 'old committed line must hide while replacement is drawn');
    assert.ok(visible.draftDepth < visible.bodyDepth, 'draft must emerge from hull, not draw over it');
    assert.deepEqual(visible.anchor, visible.body, 'preview must start at the actually rendered vessel');
    assert.ok(visible.ends.length >= 1, 'straight swipe must render a visible route');
    const straightTip = visible.ends.at(-1);
    const straightDx = straightTip.x - visible.anchor.x;
    const straightDy = straightTip.y - visible.anchor.y;
    const straightLength = Math.hypot(straightDx, straightDy);
    assert.ok(straightLength > 0, 'straight swipe tip must differ from the rendered vessel');
    for (const point of visible.ends.slice(0, -1)) {
      const perpendicularDistance = Math.abs(
        straightDx * (point.y - visible.anchor.y) -
        straightDy * (point.x - visible.anchor.x),
      ) / straightLength;
      assert.ok(perpendicularDistance <= 0.5,
        `straight swipe must not retain a geometric corner: ${JSON.stringify({ visible, point, perpendicularDistance })}`);
    }
    assert.deepEqual((await snapshot()).ships.find(ship => ship.id === shipId).route, oldRoute);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await advance(20);
    await page.waitForFunction(() => globalThis.__REDRAW_SCENE__.children.list.some(object =>
      object.type === 'Graphics' && object.depth === 5 && object.visible &&
      object.commandBuffer.length > 0));
    assert.deepEqual((await snapshot()).ships.find(ship => ship.id === shipId).route, oldRoute);
    state = await snapshot();
    start = css(state, state.ships.find(ship => ship.id === shipId).position);
    await move(start.x, start.y);
    await down();
    await move(start.x, start.y - 140, { steps: 6 });
    await advance(600);
    const release = (await snapshot()).ships.find(ship => ship.id === shipId).position;
    await page.mouse.up();
    await advance(20);
    const committed = (await snapshot()).ships.find(ship => ship.id === shipId).route;
    assert.deepEqual(committed.points, [{ x: start.x, y: start.y - 140 }]);
    assert.deepEqual(committed.start, release, 'commit must originate at release, not pointerdown');
    const angleError = pose => Math.abs(((pose.bodyHeading - pose.targetHeading) % 360 + 540) % 360 - 180);
    assert.ok(angleError(await readVisible()) > 10, 'body must not snap through the entire turn at commit');
    await advance(600);
    assert.ok(angleError(await readVisible()) < 2, 'visual turn must settle without changing navigation');

    state = await snapshot();
    start = css(state, state.ships.find(ship => ship.id === shipId).position);
    await move(start.x, start.y);
    await down();
    const curveStart = (await snapshot()).ships.find(ship => ship.id === shipId).position;
    let previousEnds = [];
    for (let i = 1; i <= 12; i++) {
      const angle = i * Math.PI / 24;
      await move(Math.round(start.x - 180 * Math.sin(angle)), Math.round(start.y + 180 * (1 - Math.cos(angle))));
      const pose = await readVisible();
      assert.deepEqual(pose.anchor, pose.body, 'moving curve must stay attached to the rendered hull');
      assert.deepEqual(pose.ends.slice(0, Math.max(0, previousEnds.length - 1)), previousEnds.slice(0, -1),
        'extending the curve must not move previously fixed bends');
      previousEnds = pose.ends;
    }
    assert.ok(previousEnds.length > 2);
    const curveEnd = (await snapshot()).ships.find(ship => ship.id === shipId).position;
    assert.ok(Math.hypot(curveEnd.x - curveStart.x, curveEnd.y - curveStart.y) > 20);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.deepEqual(errors, []);
    console.log('Redraw browser: PASS (moving straight/curved swipe, stable bends, smooth hull, cancel/commit)');
  } finally {
    try { await browser?.close(); }
    finally { await terminateOwnedProcess(server); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
