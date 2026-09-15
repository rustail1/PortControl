import assert from 'node:assert/strict';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

const FRAME_MS = 1000 / 60;

async function setup() {
  const [runtimeModule, validationModule, shipsModule] = await Promise.all([
    import('../src/runtime/HarborRuntime.ts'),
    import('../src/config/validateConfigSource.ts'),
    import('../src/ships/index.ts'),
  ]);
  const bundle = validationModule.validateConfigSource(readBaselineSource());
  return { ...runtimeModule, ...shipsModule, bundle };
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

test('COR-12R browser seed 3333 selected serviced ship reaches departure', async () => {
  const { HarborRuntime, ShipState, bundle } = await setup();
  const runtime = new HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 3333 });

  let snapshot = advanceUntil(runtime, (state) => state.ships.some((candidate) =>
    [ShipState.Entering, ShipState.Navigating].includes(candidate.ship.state) &&
    candidate.ship.position.x >= 30 && candidate.ship.position.x <= 970 &&
    candidate.ship.position.y >= 30 && candidate.ship.position.y <= 970), 1200);
  const ship = snapshot.ships.find((candidate) =>
    [ShipState.Entering, ShipState.Navigating].includes(candidate.ship.state) &&
    candidate.ship.position.x >= 30 && candidate.ship.position.x <= 970 &&
    candidate.ship.position.y >= 30 && candidate.ship.position.y <= 970);
  assert.ok(ship, 'seed 3333 must expose a route-eligible ship inside the world');
  const dock = [...snapshot.docks].sort(
    (a, b) => Math.abs(a.definition.position.x - ship.ship.position.x) -
      Math.abs(b.definition.position.x - ship.ship.position.x),
  )[0];
  assert.ok(dock, 'calm_01 must expose a nearest dock');
  const dockX = dock.definition.position.x;
  const inbound = ship.ship.position.y > 700
    ? [
        { x: ship.ship.position.x, y: 700 },
        { x: dockX, y: 300 },
        { x: dockX, y: dock.definition.position.y },
      ]
    : [
        { x: ship.ship.position.x < 500 ? 180 : 820, y: ship.ship.position.y },
        { x: dockX, y: 300 },
        { x: dockX, y: dock.definition.position.y },
      ];

  runtime.enqueueRouteDraft(rawDraft(ship.ship.id, inbound));

  snapshot = advanceUntil(
    runtime,
    (state) => state.ships.some((candidate) =>
      candidate.ship.id === ship.ship.id && candidate.ship.state === ShipState.ReadyToLeave),
    7000,
  );
  const ready = snapshot.ships.find((candidate) => candidate.ship.id === ship.ship.id);
  assert.equal(ready?.ship.state, ShipState.ReadyToLeave, JSON.stringify({
    result: snapshot.result,
    objective: snapshot.objective,
    selectedDock: dock.definition.id,
    ship: ready?.ship ?? null,
  }));

  runtime.enqueueRouteDraft(rawDraft(ship.ship.id, [
    { x: dockX, y: ready.ship.position.y + 160 },
  ]));
  runtime.advanceRender(FRAME_MS);

  snapshot = runtime.presentationSnapshot();
  const leaving = snapshot.ships.find((candidate) => candidate.ship.id === ship.ship.id);
  assert.equal(leaving?.ship.state, ShipState.Leaving, JSON.stringify({
    commit: runtime.lastRouteCommitResult,
    ship: leaving?.ship ?? null,
  }));

  let departed = false;
  for (let frame = 0; frame < 1800; frame += 1) {
    snapshot = runtime.presentationSnapshot();
    if (snapshot.departures.some((candidate) => candidate.shipId === ship.ship.id)) {
      departed = true;
      break;
    }
    if (snapshot.result !== null) break;
    runtime.advanceRender(FRAME_MS);
  }

  const finalSnapshot = runtime.presentationSnapshot();
  const finalShip = finalSnapshot.ships
    .find((candidate) => candidate.ship.id === ship.ship.id)?.ship ?? null;
  assert.equal(departed, true, JSON.stringify({
    selectedDock: dock.definition.id,
    result: finalSnapshot.result,
    session: runtime.sessionSnapshot(),
    ship: finalShip,
    docks: finalSnapshot.docks.map((candidate) => candidate.runtime),
    departures: finalSnapshot.departures,
  }));
});
