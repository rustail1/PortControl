import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

async function subject() {
  const [
    gameSession,
    sessionState,
    objectives,
    config,
    events,
    collision,
    docks,
    exits,
    ships,
    clock,
  ] = await Promise.all([
    import('../src/core/GameSession.ts'),
    import('../src/core/SessionState.ts'),
    import('../src/objectives/index.ts'),
    import('../src/config/validateConfigSource.ts'),
    import('../src/core/DomainEventQueue.ts'),
    import('../src/collision/index.ts'),
    import('../src/docks/index.ts'),
    import('../src/exits/index.ts'),
    import('../src/ships/index.ts'),
    import('../src/core/FixedStepClock.ts'),
  ]);
  return {
    ...gameSession,
    ...sessionState,
    ...objectives,
    ...config,
    ...events,
    ...collision,
    ...docks,
    ...exits,
    ...ships,
    ...clock,
  };
}

let setupPromise;
async function setup() {
  setupPromise ??= (async () => {
    const s = await subject();
    const bundle = s.validateConfigSource(readBaselineSource());
    const scoreConfig = s.createScoreConfig(bundle);
    const registry = s.createShipCharacteristicsRegistry(bundle);
    return { s, bundle, scoreConfig, registry };
  })();
  return setupPromise;
}

function level(
  objective,
  starConditions = [
    { type: 'complete' },
    { type: 'max_warnings', value: 999 },
    { type: 'max_time_seconds', value: 999 },
  ],
  id = 'fixture_level',
) {
  return { id, objective, starConditions };
}

async function makeSession(
  objective,
  starConditions,
  { id = 'fixture_level', seed = 123456 } = {},
) {
  const { s, scoreConfig } = await setup();
  return new s.GameSession({
    level: level(objective, starConditions, id),
    scoreConfig,
    attemptSeed: seed,
  });
}

const cargoFact = (overrides = {}) => ({
  shipId: 'ship-cargo',
  shipType: 'speedboat',
  cargoType: 'general',
  ...overrides,
});

const exitFact = (overrides = {}) => ({
  shipId: 'ship-exit',
  shipType: 'speedboat',
  scoreDelta: 20,
  ...overrides,
});

const wrongDockFact = (overrides = {}) => ({
  shipId: 'ship-wrong',
  ...overrides,
});

const stormHitFact = (overrides = {}) => ({
  shipId: 'ship-storm',
  shipType: 'speedboat',
  ...overrides,
});

const collisionTerminal = (overrides = {}) => ({
  shipAId: 'a',
  shipBId: 'b',
  distanceSquared: 1,
  failReason: 'collision',
  ...overrides,
});

const groundingTerminal = (overrides = {}) => ({
  shipId: 'grounded',
  failReason: 'grounding',
  ...overrides,
});

test('COR-11 #01 SessionState exposes exactly Active Completed Failed', async () => {
  const { s } = await setup();
  assert.deepEqual(Object.values(s.SessionState), ['Active', 'Completed', 'Failed']);
});

test('COR-11 #02 GameSession starts at time zero Active and preserves supplied levelId and seed', async () => {
  const session = await makeSession({ type: 'deliver_cargo', target: 2 }, undefined, {
    id: 'fixture_session',
    seed: 918273,
  });
  assert.equal(session.levelId, 'fixture_session');
  assert.equal(session.attemptSeed, 918273);
  assert.equal(session.simulationTime, 0);
  assert.equal(session.state, 'Active');
  assert.equal(session.result, null);
});

test('COR-11 #03 collision ordinary danger entry returns one synchronous warning fact count', async () => {
  const { s, bundle, registry } = await setup();
  const queue = new s.DomainEventQueue();
  const system = new s.CollisionSystem({
    events: queue,
    config: s.createCollisionConfig(bundle),
  });
  const one = new s.ShipModel({
    id: 'one',
    characteristics: registry.require('speedboat'),
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    state: s.ShipState.Navigating,
  });
  const two = new s.ShipModel({
    id: 'two',
    characteristics: registry.require('speedboat'),
    position: { x: 84, y: 0 },
    rotationDeg: 0,
    state: s.ShipState.Navigating,
  });
  const result = system.step(
    [
      { ship: one, spawnSequence: 1 },
      { ship: two, spawnSequence: 2 },
    ],
    0,
  );
  assert.equal(result.terminalCollision, null);
  assert.equal(result.dangerWarningCount, 1);
});

test('COR-11 #04 collision still-danger next step returns zero synchronous warnings', async () => {
  const { s, bundle, registry } = await setup();
  const queue = new s.DomainEventQueue();
  const system = new s.CollisionSystem({
    events: queue,
    config: s.createCollisionConfig(bundle),
  });
  const one = new s.ShipModel({
    id: 'one',
    characteristics: registry.require('speedboat'),
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    state: s.ShipState.Navigating,
  });
  const two = new s.ShipModel({
    id: 'two',
    characteristics: registry.require('speedboat'),
    position: { x: 84, y: 0 },
    rotationDeg: 0,
    state: s.ShipState.Navigating,
  });
  const input = [
    { ship: one, spawnSequence: 1 },
    { ship: two, spawnSequence: 2 },
  ];
  assert.equal(system.step(input, 0).dangerWarningCount, 1);
  assert.equal(system.step(input, 1 / 60).dangerWarningCount, 0);
});

test('COR-11 #05 terminal collision step returns zero warning count and keeps COR-08 events', async () => {
  const { s, bundle, registry } = await setup();
  const queue = new s.DomainEventQueue();
  const received = { warning: [], collision: [] };
  queue.subscribe('danger_warning', (event) => received.warning.push(event));
  queue.subscribe('collision', (event) => received.collision.push(event));
  const system = new s.CollisionSystem({
    events: queue,
    config: s.createCollisionConfig(bundle),
  });
  const one = new s.ShipModel({
    id: 'one',
    characteristics: registry.require('speedboat'),
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    state: s.ShipState.Navigating,
  });
  const two = new s.ShipModel({
    id: 'two',
    characteristics: registry.require('speedboat'),
    position: { x: 28, y: 0 },
    rotationDeg: 0,
    state: s.ShipState.Navigating,
  });
  const result = system.step(
    [
      { ship: one, spawnSequence: 1 },
      { ship: two, spawnSequence: 2 },
    ],
    0,
  );
  queue.flush();
  assert.equal(result.dangerWarningCount, 0);
  assert.equal(received.warning.length, 0);
  assert.deepEqual(received.collision, [
    { shipAId: 'one', shipBId: 'two', failReason: 'collision' },
  ]);
});

async function cargoHarness(cargo = { general: 2 }, acceptedCargoTypes = ['general']) {
  const { s, registry } = await setup();
  const queue = new s.DomainEventQueue();
  const dockSystem = new s.DockSystem();
  const dock = new s.DockModel({
    id: 'dock',
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    dockAngle: 0,
    snapRadius: 20,
    acceptedCargoTypes,
    helperFlag: false,
    visualVariant: 'dock_general',
  });
  const ship = new s.ShipModel({
    id: 'ship',
    characteristics: registry.require('speedboat'),
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    state: s.ShipState.Unloading,
    cargo,
  });
  assert.equal(dockSystem.reserve(dock, ship).status, 'eligible');
  assert.equal(dockSystem.occupyReserved(dock, ship.id), true);
  const events = [];
  queue.subscribe('cargo_unloaded', (event) => events.push(event));
  const system = new s.CargoSystem({ dockSystem, events: queue });
  return { s, queue, dockSystem, dock, ship, events, system };
}

test('COR-11 #06 CargoSystem one actual unit returns exactly one synchronous unload fact and one event', async () => {
  const a = await cargoHarness({ general: 2 });
  a.system.step([{ ship: a.ship, dock: a.dock }], 0);
  const result = a.system.step([], 0.8);
  a.queue.flush();
  assert.deepEqual(result.unloadedFacts, [
    { shipId: 'ship', shipType: 'speedboat', cargoType: 'general' },
  ]);
  assert.equal(a.events.length, 1);
  assert.equal(a.ship.cargoQuantity('general'), 1);
});

test('COR-11 #07 CargoSystem no removal produces no phantom synchronous fact', async () => {
  const a = await cargoHarness({ general: 2 });
  a.system.step([{ ship: a.ship, dock: a.dock }], 0);
  const result = a.system.step([], 0.799);
  assert.deepEqual(result.unloadedFacts, []);
  assert.equal(a.ship.cargoQuantity('general'), 2);
});

test('COR-11 #08 CargoSystem accumulated time returns one fact per actual removed unit', async () => {
  const a = await cargoHarness({ general: 2 });
  a.system.step([{ ship: a.ship, dock: a.dock }], 0);
  const result = a.system.step([], 1.6);
  a.queue.flush();
  assert.equal(result.unloadedFacts.length, 2);
  assert.equal(a.events.length, 2);
  assert.equal(a.ship.cargoTotal, 0);
});

async function exitHarness() {
  const { s, bundle, registry } = await setup();
  const queue = new s.DomainEventQueue();
  const events = [];
  queue.subscribe('ship_exited', (event) => events.push(event));
  const ship = new s.ShipModel({
    id: 'ship-exit',
    characteristics: registry.require('speedboat'),
    position: { x: 20, y: 500 },
    rotationDeg: 0,
    state: s.ShipState.Leaving,
    cargo: {},
  });
  const system = new s.ExitSystem({
    zones: s.createExitZones(bundle.levels.calm_01),
    score: s.createExitScore(bundle),
    events: queue,
  });
  return { s, bundle, queue, events, ship, system };
}

test('COR-11 #09 ExitSystem pending entry has no exited fact yet', async () => {
  const a = await exitHarness();
  const result = a.system.step([a.ship]);
  assert.deepEqual(result.pendingShipIds, ['ship-exit']);
  assert.deepEqual(result.exitedShipFacts, []);
});

test('COR-11 #10 ExitSystem safe finalize returns exactly one fact matching ship_exited event', async () => {
  const a = await exitHarness();
  a.system.step([a.ship]);
  const result = a.system.step([]);
  a.queue.flush();
  assert.equal(result.exitedShipFacts.length, 1);
  assert.deepEqual(result.exitedShipFacts[0], a.events[0]);
  assert.deepEqual(result.exitedShipFacts[0], {
    shipId: 'ship-exit',
    shipType: 'speedboat',
    scoreDelta: a.s.createExitScore(a.bundle),
  });
});

test('COR-11 #11 ExitSystem future steps never duplicate exited fact', async () => {
  const a = await exitHarness();
  a.system.step([a.ship]);
  assert.equal(a.system.step([]).exitedShipFacts.length, 1);
  assert.equal(a.system.step([a.ship]).exitedShipFacts.length, 0);
  assert.equal(a.system.step([]).exitedShipFacts.length, 0);
});

test('COR-11 #12 real frozen campaign contains and parses all four objective types', async () => {
  const { s, bundle } = await setup();
  const types = new Set();
  for (const levelConfig of Object.values(bundle.levels)) {
    types.add(s.parseObjectiveDefinition(levelConfig).type);
  }
  assert.equal(Object.keys(bundle.levels).length, 40);
  assert.deepEqual([...types].sort(), [
    'deliver_cargo',
    'deliver_cargo_type',
    'service_ships',
    'survive_seconds',
  ]);
});

test('COR-11 #13 deliver_cargo below target remains Active', async () => {
  const session = await makeSession({ type: 'deliver_cargo', target: 2 });
  session.step({ deltaSeconds: 1, cargoUnloadedFacts: [cargoFact()] });
  assert.equal(session.state, 'Active');
  assert.equal(session.objectiveProgress.current, 1);
});

test('COR-11 #14 deliver_cargo exact target completes once', async () => {
  const session = await makeSession({ type: 'deliver_cargo', target: 1 });
  session.step({ deltaSeconds: 1, cargoUnloadedFacts: [cargoFact()] });
  assert.equal(session.state, 'Completed');
  assert.equal(session.objectiveProgress.completed, true);
});

test('COR-11 #15 deliver_cargo over target completes once', async () => {
  const session = await makeSession({ type: 'deliver_cargo', target: 1 });
  session.step({
    deltaSeconds: 1,
    cargoUnloadedFacts: [cargoFact(), cargoFact({ shipId: 'ship-cargo-2' })],
  });
  const snapshot = session.toSnapshot();
  session.step({
    deltaSeconds: 1,
    cargoUnloadedFacts: [cargoFact({ shipId: 'ignored' })],
  });
  assert.deepEqual(session.toSnapshot(), snapshot);
  assert.equal(session.objectiveProgress.current, 2);
});

test('COR-11 #16 deliver_cargo_type ignores wrong cargo type', async () => {
  const session = await makeSession({
    type: 'deliver_cargo_type',
    cargoType: 'container',
    target: 1,
  });
  session.step({ deltaSeconds: 1, cargoUnloadedFacts: [cargoFact()] });
  assert.equal(session.state, 'Active');
  assert.equal(session.objectiveProgress.current, 0);
});

test('COR-11 #17 deliver_cargo_type matching cargo completes', async () => {
  const session = await makeSession({
    type: 'deliver_cargo_type',
    cargoType: 'container',
    target: 1,
  });
  session.step({
    deltaSeconds: 1,
    cargoUnloadedFacts: [cargoFact({ cargoType: 'container' })],
  });
  assert.equal(session.state, 'Completed');
});

test('COR-11 #18 service_ships counts authoritative successful exit facts only', async () => {
  const session = await makeSession({ type: 'service_ships', target: 1 });
  session.step({ deltaSeconds: 1 });
  assert.equal(session.state, 'Active');
  session.step({ deltaSeconds: 1, exitedShipFacts: [exitFact()] });
  assert.equal(session.state, 'Completed');
  assert.equal(session.metricsSnapshot.servicedShipExits, 1);
});

test('COR-11 #19 survive_seconds below target remains Active', async () => {
  const session = await makeSession({ type: 'survive_seconds', target: 2 });
  session.step({ deltaSeconds: 1.99 });
  assert.equal(session.state, 'Active');
});

test('COR-11 #20 survive_seconds exact target completes at exact authored target time', async () => {
  const session = await makeSession({ type: 'survive_seconds', target: 2 });
  session.step({ deltaSeconds: 2 });
  assert.equal(session.state, 'Completed');
  assert.equal(session.result.completionTimeSeconds, 2);
});

test('COR-11 #21 terminal grounding on survive target step wins over completion', async () => {
  const session = await makeSession({ type: 'survive_seconds', target: 2 });
  session.step({ deltaSeconds: 2, groundingTerminal: groundingTerminal() });
  assert.equal(session.state, 'Failed');
  assert.equal(session.result.failReason, 'grounding');
  assert.equal(session.objectiveProgress.completed, false);
});

test('COR-11 #22 Completed session cannot complete or mutate twice', async () => {
  const session = await makeSession({ type: 'deliver_cargo', target: 1 });
  session.step({ deltaSeconds: 1, cargoUnloadedFacts: [cargoFact()] });
  const before = session.toSnapshot();
  session.step({
    deltaSeconds: 999,
    dangerWarningCount: 5,
    cargoUnloadedFacts: [cargoFact({ shipId: 'later' })],
  });
  assert.deepEqual(session.toSnapshot(), before);
});

test('COR-11 #23 Failed session can never later complete', async () => {
  const session = await makeSession({ type: 'deliver_cargo', target: 1 });
  session.step({ deltaSeconds: 1, collisionTerminal: collisionTerminal() });
  const before = session.toSnapshot();
  session.step({ deltaSeconds: 1, cargoUnloadedFacts: [cargoFact()] });
  assert.deepEqual(session.toSnapshot(), before);
  assert.equal(session.state, 'Failed');
});

function metricsWith({ warnings = 0, cargo = 0, wrongDock = 0 } = {}) {
  return setup().then(({ s }) => {
    const metrics = new s.SessionMetrics();
    metrics.recordWarnings(warnings);
    metrics.recordCargoUnloaded(
      Array.from({ length: cargo }, (_, index) =>
        cargoFact({ shipId: `cargo-${index}` }),
      ),
    );
    metrics.recordWrongDockAttempts(
      Array.from({ length: wrongDock }, (_, index) =>
        wrongDockFact({ shipId: `wrong-${index}` }),
      ),
    );
    return { s, metrics };
  });
}

async function evaluateMiddle(condition, metrics, completionTimeSeconds = 10) {
  const { s } = await setup();
  const evaluator = new s.StarEvaluator([
    { type: 'complete' },
    condition,
    { type: 'complete' },
  ]);
  return evaluator.evaluate({
    objectiveCompleted: true,
    completionTimeSeconds,
    metrics,
  })[1].earned;
}

test('COR-11 #24 complete star is true iff primary objective completed', async () => {
  const { s } = await setup();
  const metrics = new s.SessionMetrics();
  const evaluator = new s.StarEvaluator([
    { type: 'complete' },
    { type: 'complete' },
    { type: 'complete' },
  ]);
  assert.equal(
    evaluator.evaluate({
      objectiveCompleted: true,
      completionTimeSeconds: 1,
      metrics,
    })[0].earned,
    true,
  );
  assert.equal(
    evaluator.evaluate({
      objectiveCompleted: false,
      completionTimeSeconds: 1,
      metrics,
    })[0].earned,
    false,
  );
});

test('COR-11 #25 max_warnings inclusive boundary passes and max+1 fails', async () => {
  const at = await metricsWith({ warnings: 3 });
  const over = await metricsWith({ warnings: 4 });
  assert.equal(await evaluateMiddle({ type: 'max_warnings', value: 3 }, at.metrics), true);
  assert.equal(await evaluateMiddle({ type: 'max_warnings', value: 3 }, over.metrics), false);
});

test('COR-11 #26 max_time_seconds inclusive boundary passes and greater time fails', async () => {
  const { s } = await setup();
  const metrics = new s.SessionMetrics();
  assert.equal(
    await evaluateMiddle({ type: 'max_time_seconds', value: 10 }, metrics, 10),
    true,
  );
  assert.equal(
    await evaluateMiddle({ type: 'max_time_seconds', value: 10 }, metrics, 10.001),
    false,
  );
});

test('COR-11 #27 min_cargo uses total unloaded counter', async () => {
  const { metrics } = await metricsWith({ cargo: 3 });
  assert.equal(await evaluateMiddle({ type: 'min_cargo', value: 3 }, metrics), true);
  assert.equal(await evaluateMiddle({ type: 'min_cargo', value: 4 }, metrics), false);
});

test('COR-11 #28 max_wrong_dock_attempts inclusive boundary passes and max+1 fails', async () => {
  const at = await metricsWith({ wrongDock: 2 });
  const over = await metricsWith({ wrongDock: 3 });
  assert.equal(
    await evaluateMiddle(
      { type: 'max_wrong_dock_attempts', value: 2 },
      at.metrics,
    ),
    true,
  );
  assert.equal(
    await evaluateMiddle(
      { type: 'max_wrong_dock_attempts', value: 2 },
      over.metrics,
    ),
    false,
  );
});

test('COR-11 #29 min_multi_cargo_ships counts only successful exits with multi-type spawn provenance', async () => {
  const { s } = await setup();
  const metrics = new s.SessionMetrics();
  metrics.registerSpawnedShip({
    shipId: 'single',
    shipType: 'speedboat',
    initialCargo: { general: 2, container: 0 },
  });
  metrics.registerSpawnedShip({
    shipId: 'multi',
    shipType: 'cargo_boat',
    initialCargo: { general: 1, container: 1 },
  });
  metrics.recordExit(exitFact({ shipId: 'single', shipType: 'speedboat' }), 1);
  metrics.recordExit(exitFact({ shipId: 'multi', shipType: 'cargo_boat' }), 2);
  assert.equal(metrics.multiCargoShipExits, 1);
  assert.equal(
    await evaluateMiddle({ type: 'min_multi_cargo_ships', value: 1 }, metrics),
    true,
  );
});

test('COR-11 #30 min_ship_exits uses ship TYPE id rather than runtime instance id', async () => {
  const { s } = await setup();
  const metrics = new s.SessionMetrics();
  metrics.recordExit(exitFact({ shipId: 'runtime-123', shipType: 'freighter' }), 1);
  assert.equal(
    await evaluateMiddle(
      { type: 'min_ship_exits', shipId: 'freighter', value: 1 },
      metrics,
    ),
    true,
  );
  assert.equal(
    await evaluateMiddle(
      { type: 'min_ship_exits', shipId: 'runtime-123', value: 1 },
      metrics,
    ),
    false,
  );
});

test('COR-11 #31 min_ship_group_exits sums authored ship TYPE ids', async () => {
  const { s } = await setup();
  const metrics = new s.SessionMetrics();
  metrics.recordExit(exitFact({ shipId: 'a', shipType: 'speedboat' }), 1);
  metrics.recordExit(exitFact({ shipId: 'b', shipType: 'cargo_boat' }), 1);
  metrics.recordExit(exitFact({ shipId: 'c', shipType: 'tanker' }), 1);
  assert.equal(
    await evaluateMiddle(
      {
        type: 'min_ship_group_exits',
        shipIds: ['speedboat', 'cargo_boat'],
        value: 2,
      },
      metrics,
    ),
    true,
  );
});

test('COR-11 #32 service_ships_under_time includes exit exactly at maxSeconds', async () => {
  const { s } = await setup();
  const metrics = new s.SessionMetrics();
  metrics.recordExit(exitFact({ shipId: 'at' }), 10);
  metrics.recordExit(exitFact({ shipId: 'after' }), 10.001);
  assert.equal(
    await evaluateMiddle(
      { type: 'service_ships_under_time', shipTarget: 1, maxSeconds: 10 },
      metrics,
    ),
    true,
  );
  assert.equal(
    await evaluateMiddle(
      { type: 'service_ships_under_time', shipTarget: 2, maxSeconds: 10 },
      metrics,
    ),
    false,
  );
});

test('COR-11 #33 max_hazard_hits_by_ship is storm-only and inclusive', async () => {
  const { s } = await setup();
  const metrics = new s.SessionMetrics();
  metrics.recordStormHits([
    stormHitFact({ shipId: 't1', shipType: 'tanker' }),
    stormHitFact({ shipId: 't2', shipType: 'tanker' }),
  ]);
  assert.equal(
    await evaluateMiddle(
      {
        type: 'max_hazard_hits_by_ship',
        hazardType: 'storm',
        shipId: 'tanker',
        value: 2,
      },
      metrics,
    ),
    true,
  );
  assert.equal(
    await evaluateMiddle(
      {
        type: 'max_hazard_hits_by_ship',
        hazardType: 'storm',
        shipId: 'tanker',
        value: 1,
      },
      metrics,
    ),
    false,
  );
});

test('COR-11 #34 authored star order is preserved and exactly three results freeze on completion', async () => {
  const session = await makeSession(
    { type: 'deliver_cargo', target: 1 },
    [
      { type: 'complete' },
      { type: 'min_cargo', value: 1 },
      { type: 'max_warnings', value: 0 },
    ],
  );
  session.step({ deltaSeconds: 1, cargoUnloadedFacts: [cargoFact()] });
  assert.deepEqual(
    session.result.starResults.map((result) => result.condition.type),
    ['complete', 'min_cargo', 'max_warnings'],
  );
  assert.equal(session.result.starResults.length, 3);
  assert.equal(
    session.result.earnedStars,
    session.result.starResults.filter((result) => result.earned).length,
  );
  assert.equal(Object.isFrozen(session.result.starResults), true);
});

test('COR-11 #35 all 40 levels accept objective and all three star conditions without unknown types', async () => {
  const { s, bundle } = await setup();
  const starTypes = new Set();
  for (const levelConfig of Object.values(bundle.levels)) {
    s.parseObjectiveDefinition(levelConfig);
    const conditions = s.parseStarConditions(levelConfig);
    assert.equal(conditions.length, 3);
    for (const condition of conditions) starTypes.add(condition.type);
  }
  assert.deepEqual([...starTypes].sort(), [
    'complete',
    'max_hazard_hits_by_ship',
    'max_time_seconds',
    'max_warnings',
    'max_wrong_dock_attempts',
    'min_cargo',
    'min_multi_cargo_ships',
    'min_ship_exits',
    'min_ship_group_exits',
    'service_ships_under_time',
  ]);
});

test('COR-11 #36 real calm_07 min_ship_exits shipId is treated as ship type', async () => {
  const { s, bundle } = await setup();
  const condition = s
    .parseStarConditions(bundle.levels.calm_07)
    .find((candidate) => candidate.type === 'min_ship_exits');
  assert.deepEqual(condition, {
    type: 'min_ship_exits',
    shipId: 'freighter',
    value: 1,
  });
  const metrics = new s.SessionMetrics();
  metrics.recordExit(exitFact({ shipId: 'runtime-f', shipType: 'freighter' }), 1);
  assert.equal(await evaluateMiddle(condition, metrics), true);
});

test('COR-11 #37 real industrial_37 storm tanker star uses tanker as ship type', async () => {
  const { s, bundle } = await setup();
  const condition = s
    .parseStarConditions(bundle.levels.industrial_37)
    .find((candidate) => candidate.type === 'max_hazard_hits_by_ship');
  assert.deepEqual(condition, {
    type: 'max_hazard_hits_by_ship',
    hazardType: 'storm',
    shipId: 'tanker',
    value: 0,
  });
  const metrics = new s.SessionMetrics();
  assert.equal(await evaluateMiddle(condition, metrics), true);
  metrics.recordStormHits([stormHitFact({ shipId: 'runtime-t', shipType: 'tanker' })]);
  assert.equal(await evaluateMiddle(condition, metrics), false);
});

test('COR-11 #38 ScoreService reads all score values from validated balance config', async () => {
  const { s, bundle } = await setup();
  assert.deepEqual(s.createScoreConfig(bundle), bundle.configs['balance.json'].score);
});

test('COR-11 #39 cargo score is configured cargoUnit once per synchronous fact', async () => {
  const { scoreConfig } = await setup();
  const session = await makeSession({ type: 'deliver_cargo', target: 99 });
  session.step({ deltaSeconds: 1, cargoUnloadedFacts: [cargoFact()] });
  assert.equal(session.score, scoreConfig.cargoUnit);
  session.step({
    deltaSeconds: 1,
    cargoUnloadedFacts: [
      cargoFact({ shipId: 'two' }),
      cargoFact({ shipId: 'three' }),
    ],
  });
  assert.equal(session.score, scoreConfig.cargoUnit * 3);
});

test('COR-11 #40 exit score uses exact authoritative ExitSystem scoreDelta and duplicate runtime exit is ignored', async () => {
  const { scoreConfig } = await setup();
  const session = await makeSession({ type: 'service_ships', target: 2 });
  session.step({
    deltaSeconds: 1,
    exitedShipFacts: [exitFact({ shipId: 'same', scoreDelta: scoreConfig.shipExit })],
  });
  assert.equal(session.score, scoreConfig.shipExit);
  session.step({
    deltaSeconds: 1,
    exitedShipFacts: [exitFact({ shipId: 'same', scoreDelta: scoreConfig.shipExit })],
  });
  assert.equal(session.score, scoreConfig.shipExit);
  assert.equal(session.metricsSnapshot.servicedShipExits, 1);
});

test('COR-11 #41 completion adds campaignCompletionBonus exactly once', async () => {
  const { scoreConfig } = await setup();
  const session = await makeSession({ type: 'deliver_cargo', target: 1 });
  session.step({ deltaSeconds: 1, cargoUnloadedFacts: [cargoFact()] });
  assert.equal(
    session.score,
    scoreConfig.cargoUnit + scoreConfig.campaignCompletionBonus,
  );
  const score = session.score;
  session.step({ deltaSeconds: 1, cargoUnloadedFacts: [cargoFact({ shipId: 'later' })] });
  assert.equal(session.score, score);
});

test('COR-11 #42 failed session adds no completion bonus and suppresses same-step progression score', async () => {
  const { scoreConfig } = await setup();
  const session = await makeSession({ type: 'deliver_cargo', target: 1 });
  session.step({
    deltaSeconds: 1,
    collisionTerminal: collisionTerminal(),
    cargoUnloadedFacts: [cargoFact()],
    exitedShipFacts: [exitFact({ scoreDelta: scoreConfig.shipExit })],
  });
  assert.equal(session.score, 0);
  assert.equal(session.metricsSnapshot.cargoUnloadedTotal, 0);
  assert.equal(session.metricsSnapshot.servicedShipExits, 0);
});

test('COR-11 #43 prior earned score is preserved when a later fixed step fails', async () => {
  const { scoreConfig } = await setup();
  const session = await makeSession({ type: 'deliver_cargo', target: 2 });
  session.step({ deltaSeconds: 1, cargoUnloadedFacts: [cargoFact()] });
  assert.equal(session.score, scoreConfig.cargoUnit);
  session.step({
    deltaSeconds: 1,
    groundingTerminal: groundingTerminal(),
    cargoUnloadedFacts: [cargoFact({ shipId: 'suppressed' })],
  });
  assert.equal(session.score, scoreConfig.cargoUnit);
});

test('COR-11 #44 spawn provenance single cargo with zero quantity key is not multi-cargo', async () => {
  const session = await makeSession({ type: 'service_ships', target: 2 });
  session.registerSpawnedShip({
    shipId: 'single',
    shipType: 'speedboat',
    initialCargo: { general: 2, container: 0 },
  });
  session.step({
    deltaSeconds: 1,
    exitedShipFacts: [exitFact({ shipId: 'single', shipType: 'speedboat' })],
  });
  assert.equal(session.metricsSnapshot.multiCargoShipExits, 0);
});

test('COR-11 #45 spawn provenance two positive cargo types increments multi-cargo on successful exit', async () => {
  const session = await makeSession({ type: 'service_ships', target: 2 });
  session.registerSpawnedShip({
    shipId: 'multi',
    shipType: 'cargo_boat',
    initialCargo: { general: 1, container: 1 },
  });
  session.step({
    deltaSeconds: 1,
    exitedShipFacts: [exitFact({ shipId: 'multi', shipType: 'cargo_boat' })],
  });
  assert.equal(session.metricsSnapshot.multiCargoShipExits, 1);
});

test('COR-11 #46 unknown unregistered runtime exit still services but never guesses multi-cargo', async () => {
  const session = await makeSession({ type: 'service_ships', target: 2 });
  session.step({
    deltaSeconds: 1,
    exitedShipFacts: [exitFact({ shipId: 'unknown', shipType: 'freighter' })],
  });
  assert.equal(session.metricsSnapshot.servicedShipExits, 1);
  assert.equal(session.metricsSnapshot.multiCargoShipExits, 0);
});

test('COR-11 #47 same runtime ship exit can never increment metrics twice', async () => {
  const session = await makeSession({ type: 'service_ships', target: 3 });
  const fact = exitFact({ shipId: 'dup', shipType: 'freighter' });
  session.step({ deltaSeconds: 1, exitedShipFacts: [fact, fact] });
  assert.equal(session.metricsSnapshot.servicedShipExits, 1);
  assert.equal(session.metricsSnapshot.exitsByShipType.freighter, 1);
});

test('COR-11 #48 collision terminal creates Failed result with exact reason and candidate', async () => {
  const session = await makeSession({ type: 'deliver_cargo', target: 5 });
  const candidate = collisionTerminal({ distanceSquared: 77 });
  session.step({ deltaSeconds: 0.5, collisionTerminal: candidate });
  assert.equal(session.state, 'Failed');
  assert.equal(session.result.kind, 'failed');
  assert.equal(session.result.failReason, 'collision');
  assert.deepEqual(session.result.terminalCandidate, candidate);
  assert.equal(session.result.failureTimeSeconds, 0.5);
});

test('COR-11 #49 grounding terminal creates Failed result without implementing geometry', async () => {
  const session = await makeSession({ type: 'deliver_cargo', target: 5 });
  const candidate = groundingTerminal({
    shipId: 'ship-ground',
    details: { boundaryId: 'shore' },
  });
  session.step({ deltaSeconds: 0.25, groundingTerminal: candidate });
  assert.equal(session.result.failReason, 'grounding');
  assert.deepEqual(session.result.terminalCandidate, candidate);
});

test('COR-11 #50 collision wins when collision and grounding candidates exist in same step', async () => {
  const session = await makeSession({ type: 'deliver_cargo', target: 5 });
  session.step({
    deltaSeconds: 1 / 60,
    collisionTerminal: collisionTerminal(),
    groundingTerminal: groundingTerminal(),
  });
  assert.equal(session.result.failReason, 'collision');
});

test('COR-11 #51 terminal fail suppresses warning cargo exit wrong-dock and storm facts from same step', async () => {
  const session = await makeSession({ type: 'deliver_cargo', target: 99 });
  session.step({
    deltaSeconds: 1,
    groundingTerminal: groundingTerminal(),
    dangerWarningCount: 3,
    cargoUnloadedFacts: [cargoFact()],
    exitedShipFacts: [exitFact()],
    wrongDockAttemptFacts: [wrongDockFact()],
    stormHitFacts: [stormHitFact()],
  });
  assert.deepEqual(session.metricsSnapshot, {
    cargoUnloadedTotal: 0,
    cargoUnloadedByType: {},
    servicedShipExits: 0,
    exitsByShipType: {},
    warningCount: 0,
    wrongDockAttemptCount: 0,
    multiCargoShipExits: 0,
    stormHitsByShipType: {},
    exitTimeline: [],
    spawnedShipProvenance: [],
    countedExitShipIds: [],
  });
});

test('COR-11 #52 failed result is immutable and terminal steps cannot mutate time score metrics or result', async () => {
  const session = await makeSession({ type: 'deliver_cargo', target: 2 });
  session.step({ deltaSeconds: 1, collisionTerminal: collisionTerminal() });
  const snapshot = session.toSnapshot();
  assert.equal(Object.isFrozen(session.result), true);
  session.step({ deltaSeconds: 10, cargoUnloadedFacts: [cargoFact()] });
  assert.deepEqual(session.toSnapshot(), snapshot);
});

test('COR-11 #53 completed Result is immutable and contains objective metrics score and stars snapshots', async () => {
  const session = await makeSession(
    { type: 'deliver_cargo', target: 1 },
    [
      { type: 'complete' },
      { type: 'min_cargo', value: 1 },
      { type: 'max_warnings', value: 0 },
    ],
    { id: 'completed_result', seed: 44 },
  );
  session.step({ deltaSeconds: 1.5, cargoUnloadedFacts: [cargoFact()] });
  const result = session.result;
  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.levelId, 'completed_result');
  assert.equal(result.attemptSeed, 44);
  assert.equal(result.score, session.score);
  assert.equal(result.objective.completed, true);
  assert.equal(result.metrics.cargoUnloadedTotal, 1);
  assert.equal(result.starResults.length, 3);
  assert.equal(result.earnedStars, 3);
});

test('COR-11 #54 snapshot restore reproduces deterministic future including metrics score objective and result', async () => {
  const stars = [
    { type: 'complete' },
    { type: 'min_multi_cargo_ships', value: 1 },
    { type: 'max_wrong_dock_attempts', value: 1 },
  ];
  const a = await makeSession({ type: 'deliver_cargo', target: 3 }, stars, {
    id: 'snapshot_level',
    seed: 888,
  });
  a.registerSpawnedShip({
    shipId: 'multi',
    shipType: 'cargo_boat',
    initialCargo: { general: 1, container: 1 },
  });
  a.step({
    deltaSeconds: 1,
    dangerWarningCount: 1,
    cargoUnloadedFacts: [cargoFact()],
    exitedShipFacts: [
      exitFact({ shipId: 'multi', shipType: 'cargo_boat' }),
    ],
    wrongDockAttemptFacts: [wrongDockFact()],
    stormHitFacts: [stormHitFact({ shipType: 'cargo_boat' })],
  });
  const snapshot = a.toSnapshot();

  const b = await makeSession({ type: 'deliver_cargo', target: 3 }, stars, {
    id: 'snapshot_level',
    seed: 888,
  });
  b.restore(snapshot);

  const future = {
    deltaSeconds: 2,
    cargoUnloadedFacts: [
      cargoFact({ shipId: 'cargo-2' }),
      cargoFact({ shipId: 'cargo-3', cargoType: 'container' }),
    ],
  };
  a.step(future);
  b.step(future);
  assert.deepEqual(b.toSnapshot(), a.toSnapshot());
  assert.equal(a.state, 'Completed');
});

test('COR-11 #55 snapshot restore can restore a pre-fail Active state for future rewind composition', async () => {
  const session = await makeSession({ type: 'deliver_cargo', target: 2 });
  session.step({ deltaSeconds: 1, cargoUnloadedFacts: [cargoFact()] });
  const active = session.toSnapshot();
  session.step({ deltaSeconds: 1, collisionTerminal: collisionTerminal() });
  assert.equal(session.state, 'Failed');
  session.restore(active);
  assert.equal(session.state, 'Active');
  assert.equal(session.result, null);
  assert.equal(session.score, active.score.score);
});

test('COR-11 #56 real FixedStepClock 30 60 120 render partitions produce identical session outcome', async () => {
  const { s, scoreConfig } = await setup();
  const run = (renderFps) => {
    const session = new s.GameSession({
      level: level(
        { type: 'deliver_cargo', target: 2 },
        [
          { type: 'complete' },
          { type: 'max_warnings', value: 1 },
          { type: 'min_cargo', value: 2 },
        ],
        'fps_level',
      ),
      scoreConfig,
      attemptSeed: 321,
    });
    session.registerSpawnedShip({
      shipId: 'multi',
      shipType: 'cargo_boat',
      initialCargo: { general: 1, container: 1 },
    });
    const clock = new s.FixedStepClock({ fixedHz: 60, maxCatchUpSteps: 6 });
    let fixedStep = 0;
    for (let frame = 0; frame < renderFps * 2; frame += 1) {
      clock.advance(1000 / renderFps, (deltaSeconds) => {
        fixedStep += 1;
        const input = { deltaSeconds };
        if (fixedStep === 10) {
          input.dangerWarningCount = 1;
        }
        if (fixedStep === 20) {
          input.exitedShipFacts = [
            exitFact({ shipId: 'multi', shipType: 'cargo_boat', scoreDelta: scoreConfig.shipExit }),
          ];
        }
        if (fixedStep === 30) {
          input.wrongDockAttemptFacts = [wrongDockFact()];
        }
        if (fixedStep === 40) {
          input.stormHitFacts = [stormHitFact({ shipType: 'cargo_boat' })];
        }
        if (fixedStep === 50) {
          input.cargoUnloadedFacts = [cargoFact({ shipId: 'cargo-1' })];
        }
        if (fixedStep === 60) {
          input.cargoUnloadedFacts = [cargoFact({ shipId: 'cargo-2' })];
        }
        session.step(input);
      });
    }
    return {
      clockElapsed: clock.elapsedSeconds,
      session: session.toSnapshot(),
    };
  };
  const at30 = run(30);
  const at60 = run(60);
  const at120 = run(120);
  assert.deepEqual(at60, at30);
  assert.deepEqual(at120, at30);
  assert.equal(at60.clockElapsed, 2);
  assert.equal(at60.session.state, 'Completed');
});

test('COR-11 #57 production COR-11 boundary has no forbidden random timer platform economy or level-specific logic', () => {
  const paths = [
    'src/core/SessionState.ts',
    'src/core/GameSession.ts',
    'src/objectives/SessionMetrics.ts',
    'src/objectives/ObjectiveSystem.ts',
    'src/objectives/StarEvaluator.ts',
    'src/objectives/ScoreService.ts',
    'src/collision/CollisionSystem.ts',
    'src/docks/CargoSystem.ts',
    'src/exits/ExitSystem.ts',
  ];
  const source = paths.map((path) => readFileSync(path, 'utf8')).join('\n');
  assert.doesNotMatch(
    source,
    /Math\.random|setTimeout|setInterval|Phaser|Yandex|GameManager|service locator/i,
  );
  assert.doesNotMatch(source, /calm_01|calm_07|industrial_37|freighter|tanker/);
  assert.doesNotMatch(source, /\b100\b|\b20\b|\b250\b/);
  assert.doesNotMatch(source, /cargoCoinValue|starCoinValue|baseCoins|EconomyService|AnalyticsService|level_failed|level_complete/);
});

test('COR-11 #58 GameSession snapshot intentionally excludes foreign owner snapshots', async () => {
  const session = await makeSession({ type: 'deliver_cargo', target: 2 });
  const snapshot = session.toSnapshot();
  for (const forbidden of ['director', 'ships', 'docks', 'hazards', 'rng']) {
    assert.equal(Object.hasOwn(snapshot, forbidden), false);
  }
});
