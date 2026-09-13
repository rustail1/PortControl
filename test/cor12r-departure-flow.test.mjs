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

test('COR-12R browser seed 3333 serviced ship can leave dock_a and reach departure', async () => {
  const { HarborRuntime, ShipState, bundle } = await setup();
  const runtime = new HarborRuntime({ bundle, levelId: 'calm_01', attemptSeed: 3333 });

  let snapshot = advanceUntil(runtime, (state) => state.ships.length > 0, 1200);
  const ship = [...snapshot.ships].sort((a, b) => a.spawnSequence - b.spawnSequence)[0];
  assert.ok(ship, 'seed 3333 must materialize a ship');
  const dock = snapshot.docks.find((candidate) => candidate.definition.id === 'dock_a');
  assert.ok(dock, 'calm_01 must expose dock_a');
  const dockX = dock.definition.position.x;

  runtime.enqueueRouteDraft(rawDraft(ship.ship.id, [
    { x: dockX, y: 250 },
    { x: dockX, y: 210 },
    { x: dockX, y: 190 },
  ]));

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
    ship: ready?.ship ?? null,
  }));

  runtime.enqueueRouteDraft(rawDraft(ship.ship.id, [
    { x: dockX, y: ready.ship.position.y + 60 },
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

  const finalShip = runtime.presentationSnapshot().ships
    .find((candidate) => candidate.ship.id === ship.ship.id)?.ship ?? null;
  assert.equal(departed, true, JSON.stringify({
    result: runtime.presentationSnapshot().result,
    session: runtime.sessionSnapshot(),
    ship: finalShip,
    docks: runtime.presentationSnapshot().docks.map((candidate) => candidate.runtime),
    departures: runtime.presentationSnapshot().departures,
  }));
});
