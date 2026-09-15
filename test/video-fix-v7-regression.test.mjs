import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { HarborRuntime } from '../src/runtime/HarborRuntime.ts';
import { HarborManeuverMotor } from '../src/docks/HarborManeuverMotor.ts';
import { ShipModel } from '../src/ships/ShipModel.ts';
import { ShipState } from '../src/ships/ShipState.ts';

const FRAME_MS = 1000 / 60;

function frozenBundle() {
  const root = join(import.meta.dirname, '..', 'Port_Control_Baseline_Source_FINAL_v1.5', 'src', 'config');
  const configs = {};
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    configs[entry.name] = JSON.parse(readFileSync(join(root, entry.name), 'utf8'));
  }
  const levels = {};
  for (const entry of readdirSync(join(root, 'levels'), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const level = JSON.parse(readFileSync(join(root, 'levels', entry.name), 'utf8'));
    levels[level.id] = level;
  }
  return Object.freeze({ configs: Object.freeze(configs), levels: Object.freeze(levels) });
}

function pointer(position) {
  return {
    source: 'mouse', pointerId: 1,
    screenPosition: position, cssPosition: position,
    internalViewport: { width: 1000, height: 1000 },
    worldToCssPixelScale: 1,
  };
}

function advanceUntil(runtime, predicate, maxFrames) {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    const snapshot = runtime.presentationSnapshot();
    if (predicate(snapshot)) return snapshot;
    runtime.advanceRender(FRAME_MS);
  }
  return runtime.presentationSnapshot();
}

function rawDraft(shipId, points) {
  return Object.freeze({
    shipId,
    points: Object.freeze(points.map((point) => Object.freeze({ ...point }))),
  });
}

function readyDepartureSubject() {
  const runtime = new HarborRuntime({ bundle: frozenBundle(), levelId: 'calm_01', attemptSeed: 3333 });
  let snapshot = advanceUntil(runtime, (state) => state.ships.some((candidate) =>
    [ShipState.Entering, ShipState.Navigating].includes(candidate.ship.state) &&
    candidate.ship.position.x >= 30 && candidate.ship.position.x <= 970 &&
    candidate.ship.position.y >= 30 && candidate.ship.position.y <= 970), 1200);
  const candidate = snapshot.ships.find((entry) =>
    [ShipState.Entering, ShipState.Navigating].includes(entry.ship.state) &&
    entry.ship.position.x >= 30 && entry.ship.position.x <= 970 &&
    entry.ship.position.y >= 30 && entry.ship.position.y <= 970);
  assert.ok(candidate);
  const dock = [...snapshot.docks].sort(
    (a, b) => Math.abs(a.definition.position.x - candidate.ship.position.x) -
      Math.abs(b.definition.position.x - candidate.ship.position.x),
  )[0];
  assert.ok(dock);
  const dockX = dock.definition.position.x;
  const inbound = candidate.ship.position.y > 700
    ? [
        { x: candidate.ship.position.x, y: 700 },
        { x: dockX, y: 300 },
        { x: dockX, y: dock.definition.position.y },
      ]
    : [
        { x: candidate.ship.position.x < 500 ? 180 : 820, y: candidate.ship.position.y },
        { x: dockX, y: 300 },
        { x: dockX, y: dock.definition.position.y },
      ];
  runtime.enqueueRouteDraft(rawDraft(candidate.ship.id, inbound));
  snapshot = advanceUntil(runtime, (state) => state.ships.some((entry) =>
    entry.ship.id === candidate.ship.id && entry.ship.state === ShipState.ReadyToLeave), 7000);
  const ready = snapshot.ships.find((entry) => entry.ship.id === candidate.ship.id)?.ship;
  assert.equal(ready?.state, ShipState.ReadyToLeave);
  return { runtime, shipId: candidate.ship.id, ready };
}

test('VIDEO v7 ReadyToLeave live preview does not start departure before pointer release', () => {
  const { runtime, ready, shipId } = readyDepartureSubject();
  runtime.pointerDown(pointer(ready.position));
  runtime.pointerMove(pointer({ x: ready.position.x, y: ready.position.y + 150 }));
  runtime.advanceRender(FRAME_MS);

  const held = runtime.presentationSnapshot().ships.find((entry) => entry.ship.id === shipId)?.ship;
  assert.equal(held?.state, ShipState.ReadyToLeave,
    'drawing from a dock must remain presentation-only until pointer-up seals the final route');
  assert.equal(held?.route, null,
    'an early live-draft must not become authoritative departure geometry');
});

test('VIDEO v7 pointer-up keeps the full dock route visible through atomic commit', () => {
  const { runtime, ready, shipId } = readyDepartureSubject();
  const first = { x: ready.position.x, y: ready.position.y + 120 };
  const final = { x: ready.position.x + 180, y: ready.position.y + 220 };

  runtime.pointerDown(pointer(ready.position));
  runtime.pointerMove(pointer(first));
  runtime.advanceRender(FRAME_MS);
  runtime.pointerMove(pointer(final));

  const beforeRelease = runtime.presentationSnapshot().routePreview;
  assert.equal(beforeRelease?.shipId, shipId);
  const expectedEndpoint = beforeRelease?.validPoints.at(-1);
  assert.ok(expectedEndpoint);

  runtime.pointerUp(pointer(final));
  const handoff = runtime.presentationSnapshot().routePreview;
  assert.equal(handoff?.shipId, shipId,
    'sealed preview must remain visible until the queued departure commit is applied');
  assert.deepEqual(handoff?.validPoints.at(-1), expectedEndpoint,
    'pointer-up must not fall back to an earlier short live route');

  runtime.advanceRender(FRAME_MS);
  const committed = runtime.presentationSnapshot().ships.find((entry) => entry.ship.id === shipId);
  assert.equal(committed?.ship.state, ShipState.Leaving);
  assert.deepEqual(committed?.remainingRoute?.at(-1), expectedEndpoint,
    'first committed departure frame must already contain the final authored endpoint');
});

test('VIDEO v7 assisted departure accelerates visibly instead of lingering at docking creep speed', () => {
  const characteristics = Object.freeze({
    type: 'speedboat', speed: 150, turnRateDeg: 220, collisionRadius: 14,
    warningRadius: 42, unloadStepMs: 800, pressureWeight: 1, spawnWeight: 1,
    cargoCapacity: 1, defaultCargoTypes: Object.freeze(['general']),
  });
  const ship = new ShipModel({
    id: 'departure-feel', characteristics, position: { x: 0, y: 0 }, rotationDeg: 0,
    state: ShipState.Leaving, cargo: {},
  });
  const motor = new HarborManeuverMotor();
  const path = Object.freeze({
    start: Object.freeze({ x: 0, y: 0 }),
    points: Object.freeze([Object.freeze({ x: 100, y: 0 })]),
    finalHeadingDeg: 0,
    phaseProgress: Object.freeze({ approachEnd: 0, alignmentEnd: 55 }),
  });
  let state = { progress: 0, speed: 0 };
  for (let frame = 0; frame < 30; frame += 1) {
    const next = motor.step(ship, path, state, 'departure', 1 / 60);
    ship.setPosition(next.position);
    ship.setRotationDeg(next.rotationDeg);
    state = { progress: next.progress, speed: next.speed };
  }
  assert.ok(state.progress > characteristics.collisionRadius,
    `speedboat must visibly clear at least one hull radius in 0.5s; got ${state.progress.toFixed(3)}px`);
});
