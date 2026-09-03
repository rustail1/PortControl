import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

async function subject() {
  const [spawning, rng, clock, ships, config] = await Promise.all([
    import('../src/spawning/index.ts'),
    import('../src/core/SeededRng.ts'),
    import('../src/core/FixedStepClock.ts'),
    import('../src/ships/index.ts'),
    import('../src/config/validateConfigSource.ts'),
  ]);
  return { ...spawning, ...rng, ...clock, ...ships, ...config };
}

let setupPromise;
async function setup() {
  setupPromise ??= (async () => {
    const s = await subject();
    const bundle = s.validateConfigSource(readBaselineSource());
    const characteristics = s.createShipCharacteristicsRegistry(bundle);
    const points = s.createSpawnPointsForValidatedLevel(bundle, 'calm_01');
    const config = s.createSpawnDirectorConfig(bundle, 'calm_01');
    return { s, bundle, characteristics, points, config };
  })();
  return setupPromise;
}

function copyConfig(base, overrides = {}) {
  return {
    level: {
      ...base.level,
      ...(overrides.level ?? {}),
      allowedShips: [...(overrides.level?.allowedShips ?? base.level.allowedShips)],
      shipWeights: { ...(overrides.level?.shipWeights ?? base.level.shipWeights) },
      cargoTypes: [...(overrides.level?.cargoTypes ?? base.level.cargoTypes)],
      cargoGeneration: {
        ...base.level.cargoGeneration,
        ...(overrides.level?.cargoGeneration ?? {}),
        weights: {
          ...(overrides.level?.cargoGeneration?.weights ??
            base.level.cargoGeneration.weights),
        },
      },
      director: {
        ...base.level.director,
        ...(overrides.level?.director ?? {}),
        wave: {
          ...base.level.director.wave,
          ...(overrides.level?.director?.wave ?? {}),
        },
      },
    },
    balance: {
      ...base.balance,
      ...(overrides.balance ?? {}),
    },
  };
}

function clonePoint(point, overrides = {}) {
  return Object.freeze({
    id: point.id,
    x: point.x,
    y: point.y,
    directionDeg: point.directionDeg,
    weight: point.weight,
    ...(point.leadTimeOverride === undefined
      ? {}
      : { leadTimeOverride: point.leadTimeOverride }),
    tags: Object.freeze([...point.tags]),
    ...overrides,
  });
}

function identityAllocator(start = 0) {
  let next = start;
  return () => {
    const current = next++;
    return {
      shipId: `ship-${current}`,
      spawnSequence: current,
      logicalSpawnId: `logical-${current}`,
    };
  };
}

function makeInput({
  simulationTime = 0,
  activeShips = [],
  occupiedDockCount = 0,
  activeStormCellCount = 0,
  owner = () => null,
} = {}) {
  return {
    simulationTime,
    activeShips,
    occupiedDockCount,
    activeStormCellCount,
    getSpawnPointOwner: owner,
  };
}

function activeShip(s, characteristics, {
  id = 'active',
  type = 'speedboat',
  state = s.ShipState.Navigating,
  x = 500,
  y = 500,
} = {}) {
  return {
    ship: new s.ShipModel({
      id,
      characteristics: characteristics.require(type),
      position: { x, y },
      rotationDeg: 0,
      state,
      cargo: {},
      route: null,
    }),
  };
}

function readyFrom(schedule) {
  return {
    transactionId: schedule.command.transactionId,
    spawnPointId: schedule.command.spawnPoint.id,
    spawnPoint: schedule.command.spawnPoint,
    payload: schedule.command.payload,
  };
}

function approveAndMaterialize(director, schedule, simulationTime, inputOverrides = {}) {
  director.confirmScheduled(schedule.command.transactionId, simulationTime);
  const ready = readyFrom(schedule);
  const resolution = director.resolveReadySpawn(
    ready,
    makeInput({
      simulationTime,
      ...inputOverrides,
      owner:
        inputOverrides.owner ??
        ((pointId) =>
          pointId === schedule.command.spawnPoint.id
            ? schedule.command.transactionId
            : null),
    }),
  );
  assert.equal(resolution.kind, 'approved');
  director.confirmMaterialized(schedule.logicalSpawnId);
  return resolution;
}

function countingRng(value = 0.25) {
  const calls = [];
  let state = 0;
  return {
    calls,
    next() {
      calls.push({ method: 'next' });
      state += 1;
      return value;
    },
    range(minimum, maximum) {
      calls.push({ method: 'range', minimum, maximum });
      state += 1;
      return minimum + (maximum - minimum) * value;
    },
    getState() {
      return [state];
    },
    setState(nextState) {
      state = nextState[0];
    },
  };
}

function scriptedRng(entries) {
  let index = 0;
  const trace = [];
  return {
    trace,
    next() {
      const entry = entries[index++];
      assert.ok(entry, 'unexpected next RNG draw');
      assert.equal(entry.method, 'next');
      trace.push(entry.label);
      return entry.value;
    },
    range(minimum, maximum) {
      const entry = entries[index++];
      assert.ok(entry, 'unexpected range RNG draw');
      assert.equal(entry.method, 'range');
      trace.push(entry.label);
      return minimum + (maximum - minimum) * entry.value;
    },
    getState() {
      return [index];
    },
    setState(state) {
      index = state[0];
    },
  };
}

function makeDirector({
  s,
  config,
  points,
  characteristics,
  rng = new s.SeededRng(12345),
  identityStart = 0,
}) {
  return new s.SpawnDirector({
    config,
    spawnPoints: points,
    characteristics,
    rng,
    allocateIdentity: identityAllocator(identityStart),
  });
}

async function baselineObjects() {
  const { bundle } = await setup();
  return {
    ships: bundle.configs['ships.json'].ships,
    balance: bundle.configs['balance.json'],
    level: bundle.levels['calm_01'],
  };
}

const cases = [];

// 1-8 machine config
cases.push([1, 'cargoCapacity is machine-backed for every ship', async () => {
  const { characteristics } = await setup();
  const { ships } = await baselineObjects();
  for (const [type, source] of Object.entries(ships)) {
    assert.equal(characteristics.require(type).cargoCapacity, source.cargoCapacity);
  }
}]);
cases.push([2, 'pressureWeight is machine-backed for every ship', async () => {
  const { characteristics } = await setup();
  const { ships } = await baselineObjects();
  for (const [type, source] of Object.entries(ships)) {
    assert.equal(characteristics.require(type).pressureWeight, source.pressureWeight);
  }
}]);
cases.push([3, 'spawnWeight is machine-backed for every ship', async () => {
  const { characteristics } = await setup();
  const { ships } = await baselineObjects();
  for (const [type, source] of Object.entries(ships)) {
    assert.equal(characteristics.require(type).spawnWeight, source.spawnWeight);
  }
}]);
cases.push([4, 'defaultCargoTypes are machine-backed and immutable', async () => {
  const { characteristics } = await setup();
  const { ships } = await baselineObjects();
  for (const [type, source] of Object.entries(ships)) {
    assert.deepEqual(characteristics.require(type).defaultCargoTypes, source.defaultCargoTypes);
    assert.equal(Object.isFrozen(characteristics.require(type).defaultCargoTypes), true);
  }
}]);
cases.push([5, 'occupiedDockPressureWeight comes from balance', async () => {
  const { config } = await setup();
  const { balance } = await baselineObjects();
  assert.equal(config.balance.occupiedDockPressureWeight, balance.spawnDirector.occupiedDockPressureWeight);
}]);
cases.push([6, 'activeStormCellPressureWeight comes from balance', async () => {
  const { config } = await setup();
  const { balance } = await baselineObjects();
  assert.equal(config.balance.activeStormCellPressureWeight, balance.spawnDirector.activeStormCellPressureWeight);
}]);
cases.push([7, 'unsafeSpawnRetryDelayMs comes from balance', async () => {
  const { config } = await setup();
  const { balance } = await baselineObjects();
  assert.equal(config.balance.unsafeSpawnRetryDelayMs, balance.spawnDirector.unsafeSpawnRetryDelayMs);
}]);
cases.push([8, 'all relevant director level fields come from real LevelConfig', async () => {
  const { config } = await setup();
  const { level } = await baselineObjects();
  assert.deepEqual(config.level.director, level.director);
  assert.deepEqual(config.level.allowedShips, level.allowedShips);
  assert.deepEqual(config.level.cargoTypes, level.cargoTypes);
  assert.deepEqual(config.level.cargoGeneration, level.cargoGeneration);
  assert.deepEqual(config.level.shipWeights, level.shipWeights ?? {});
}]);

// 9-22 pressure/gates
cases.push([9, 'pressure sums every active ship pressureWeight', async () => {
  const { s, characteristics, config } = await setup();
  const ships = [
    activeShip(s, characteristics, { type: 'speedboat', id: 'a' }),
    activeShip(s, characteristics, { type: 'cargo_boat', id: 'b' }),
  ];
  const result = s.calculateSpawnPressure(ships, 0, 0, config.balance);
  assert.equal(result.pressure, characteristics.require('speedboat').pressureWeight + characteristics.require('cargo_boat').pressureWeight);
}]);
for (const [number, stateName, counted] of [
  [10, 'Unloading', true],
  [11, 'ReadyToLeave', true],
  [12, 'Leaving', true],
  [13, 'Destroyed', false],
]) {
  cases.push([number, `${stateName} pressure participation is correct`, async () => {
    const { s, characteristics, config } = await setup();
    const ship = activeShip(s, characteristics, { state: s.ShipState[stateName] });
    const result = s.calculateSpawnPressure([ship], 0, 0, config.balance);
    assert.equal(result.activeShips, counted ? 1 : 0);
    assert.equal(result.pressure, counted ? characteristics.require('speedboat').pressureWeight : 0);
  }]);
}
cases.push([14, 'occupied dock coefficient is applied', async () => {
  const { s, config } = await setup();
  assert.equal(s.calculateSpawnPressure([], 2, 0, config.balance).pressure, 2 * config.balance.occupiedDockPressureWeight);
}]);
cases.push([15, 'active storm coefficient is applied', async () => {
  const { s, config } = await setup();
  assert.equal(s.calculateSpawnPressure([], 0, 3, config.balance).pressure, 3 * config.balance.activeStormCellPressureWeight);
}]);
cases.push([16, 'pending incoming does not alter pressure because it is not an active ship input', async () => {
  const { s, config } = await setup();
  assert.deepEqual(s.calculateSpawnPressure([], 0, 0, config.balance), { pressure: 0, activeShips: 0 });
}]);
cases.push([17, 'activeShips below maxAlive allows a due gate', async () => {
  const { s, config, points, characteristics } = await setup();
  const rng = countingRng(0);
  const director = makeDirector({ s, config, points, characteristics, rng });
  assert.equal(director.step(makeInput()).kind, 'schedule_incoming');
}]);
cases.push([18, 'activeShips equal maxAlive blocks', async () => {
  const { s, config, points, characteristics } = await setup();
  const active = Array.from({ length: config.level.director.maxAlive }, (_, i) =>
    activeShip(s, characteristics, { id: `active-${i}`, x: 500, y: 500 + i * 100 }),
  );
  const rng = countingRng();
  const director = makeDirector({ s, config, points, characteristics, rng });
  assert.equal(director.step(makeInput({ activeShips: active })).reason, 'gate_blocked');
  assert.equal(rng.calls.length, 0);
}]);
cases.push([19, 'pressure below pressureCap allows a due gate', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { director: { pressureCap: 999 } } });
  const director = makeDirector({ s, config: custom, points, characteristics });
  assert.equal(director.step(makeInput()).kind, 'schedule_incoming');
}]);
cases.push([20, 'pressure exactly pressureCap blocks', async () => {
  const { s, config, points, characteristics } = await setup();
  const weight = characteristics.require('speedboat').pressureWeight;
  const custom = copyConfig(config, { level: { director: { pressureCap: weight } } });
  const rng = countingRng();
  const director = makeDirector({ s, config: custom, points, characteristics, rng });
  const active = [activeShip(s, characteristics, { x: 500, y: 500 })];
  assert.equal(director.step(makeInput({ activeShips: active })).reason, 'gate_blocked');
  assert.equal(rng.calls.length, 0);
}]);
cases.push([21, 'blocked gate consumes zero RNG', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { director: { maxAlive: 1 } } });
  const rng = countingRng();
  const director = makeDirector({ s, config: custom, points, characteristics, rng });
  director.step(makeInput({ activeShips: [activeShip(s, characteristics)] }));
  assert.equal(rng.calls.length, 0);
}]);
cases.push([22, 'due event proceeds when a previously blocked gate opens', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { director: { maxAlive: 1 } } });
  const director = makeDirector({ s, config: custom, points, characteristics });
  assert.equal(director.step(makeInput({ activeShips: [activeShip(s, characteristics)] })).reason, 'gate_blocked');
  assert.equal(director.step(makeInput({ simulationTime: 1 })).kind, 'schedule_incoming');
}]);

// 23-29 ship selection
cases.push([23, 'allowedShips authored order is preserved', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { allowedShips: ['cargo_boat', 'speedboat'], shipWeights: { cargo_boat: 1, speedboat: 1 } } });
  const rng = countingRng(0);
  const director = makeDirector({ s, config: custom, points, characteristics, rng });
  assert.equal(director.step(makeInput()).command.payload.shipType, 'cargo_boat');
}]);
cases.push([24, 'level shipWeights overrides machine spawnWeight', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { allowedShips: ['speedboat', 'cargo_boat'], shipWeights: { speedboat: 0, cargo_boat: 1 } } });
  const director = makeDirector({ s, config: custom, points, characteristics, rng: countingRng(0) });
  assert.equal(director.step(makeInput()).command.payload.shipType, 'cargo_boat');
}]);
cases.push([25, 'missing level ship weight falls back to machine spawnWeight', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { allowedShips: ['speedboat', 'cargo_boat'], shipWeights: { speedboat: 0 } } });
  const director = makeDirector({ s, config: custom, points, characteristics, rng: countingRng(0) });
  assert.equal(director.step(makeInput()).command.payload.shipType, 'cargo_boat');
}]);
cases.push([26, 'same seed produces same ship type sequence', async () => {
  const { s, config, points, characteristics } = await setup();
  async function run() {
    const director = makeDirector({ s, config, points, characteristics, rng: new s.SeededRng(789) });
    const sequence = [];
    for (let i = 0; i < 6; i += 1) {
      const scheduled = director.step(makeInput({ simulationTime: director.nextSpawnDueTime }));
      sequence.push(scheduled.command.payload.shipType);
      approveAndMaterialize(director, scheduled, director.nextSpawnDueTime);
    }
    return sequence;
  }
  assert.deepEqual(await run(), await run());
}]);
cases.push([27, 'scriptedIntroShip forces the first ship type', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'cargo_boat' } });
  const scheduled = makeDirector({ s, config: custom, points, characteristics, rng: countingRng(0) }).step(makeInput());
  assert.equal(scheduled.command.payload.shipType, 'cargo_boat');
}]);
cases.push([28, 'scripted intro consumes no ship-type RNG draw', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat', cargoTypes: ['general'], cargoGeneration: { mode: 'single', weights: { general: 1 }, multiCargoChance: 0 } } });
  const rng = countingRng(0);
  const director = makeDirector({ s, config: custom, points: [points[0]], characteristics, rng });
  director.step(makeInput());
  assert.deepEqual(rng.calls.map((call) => call.method), ['next', 'next', 'range']);
}]);
cases.push([29, 'after scripted intro materializes normal weighted ship RNG resumes', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat', allowedShips: ['cargo_boat'], shipWeights: { cargo_boat: 1 } } });
  const director = makeDirector({ s, config: custom, points, characteristics, rng: new s.SeededRng(123) });
  const first = director.step(makeInput());
  assert.equal(first.command.payload.shipType, 'speedboat');
  approveAndMaterialize(director, first, 0);
  const second = director.step(makeInput({ simulationTime: director.nextSpawnDueTime }));
  assert.equal(second.command.payload.shipType, 'cargo_boat');
}]);

// 30-40 cargo
cases.push([30, 'single cargo fills full cargoCapacity', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'cargo_boat', cargoTypes: ['general'], cargoGeneration: { mode: 'single', weights: { general: 1 }, multiCargoChance: 0 } } });
  const cargo = makeDirector({ s, config: custom, points, characteristics }).step(makeInput()).command.payload.cargo;
  assert.deepEqual(cargo, { general: characteristics.require('cargo_boat').cargoCapacity });
}]);
cases.push([31, 'cargo generation enforces level/ship compatibility intersection', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'freighter', cargoTypes: ['oil', 'container'], cargoGeneration: { mode: 'single', weights: { oil: 999, container: 1 }, multiCargoChance: 0 } } });
  const cargo = makeDirector({ s, config: custom, points, characteristics, rng: countingRng(0) }).step(makeInput()).command.payload.cargo;
  assert.deepEqual(Object.keys(cargo), ['container']);
}]);
cases.push([32, 'tanker receives only oil when level offers oil', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'tanker', cargoTypes: ['general', 'oil'], cargoGeneration: { mode: 'single', weights: { general: 1, oil: 1 }, multiCargoChance: 0 } } });
  const cargo = makeDirector({ s, config: custom, points, characteristics }).step(makeInput()).command.payload.cargo;
  assert.deepEqual(cargo, { oil: characteristics.require('tanker').cargoCapacity });
}]);
cases.push([33, 'mixed mode false chance falls back to single', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'cargo_boat', cargoTypes: ['general', 'container'], cargoGeneration: { mode: 'mixed', weights: { general: 1, container: 1 }, multiCargoChance: 0 } } });
  const cargo = makeDirector({ s, config: custom, points, characteristics, rng: countingRng(0.5) }).step(makeInput()).command.payload.cargo;
  assert.equal(Object.keys(cargo).length, 1);
}]);
cases.push([34, 'mixed mode true chance selects two distinct cargo types', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'cargo_boat', cargoTypes: ['general', 'container'], cargoGeneration: { mode: 'mixed', weights: { general: 1, container: 1 }, multiCargoChance: 1 } } });
  const rng = scriptedRng([
    { method: 'next', label: 'multi', value: 0 },
    { method: 'next', label: 'primary', value: 0 },
    { method: 'next', label: 'secondary', value: 0 },
    { method: 'next', label: 'point', value: 0 },
    { method: 'range', label: 'jitter', value: 0.5 },
  ]);
  const cargo = makeDirector({ s, config: custom, points: [points[0]], characteristics, rng }).step(makeInput()).command.payload.cargo;
  assert.equal(Object.keys(cargo).length, 2);
  assert.notEqual(Object.keys(cargo)[0], Object.keys(cargo)[1]);
}]);
cases.push([35, 'mixed primary receives ceil(capacity/2)', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'cargo_boat', cargoTypes: ['general', 'container'], cargoGeneration: { mode: 'mixed', weights: { general: 1, container: 1 }, multiCargoChance: 1 } } });
  const cargo = makeDirector({ s, config: custom, points, characteristics, rng: countingRng(0) }).step(makeInput()).command.payload.cargo;
  assert.equal(cargo.general, Math.ceil(characteristics.require('cargo_boat').cargoCapacity / 2));
}]);
cases.push([36, 'mixed secondary receives floor(capacity/2)', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'cargo_boat', cargoTypes: ['general', 'container'], cargoGeneration: { mode: 'mixed', weights: { general: 1, container: 1 }, multiCargoChance: 1 } } });
  const cargo = makeDirector({ s, config: custom, points, characteristics, rng: countingRng(0) }).step(makeInput()).command.payload.cargo;
  assert.equal(cargo.container, Math.floor(characteristics.require('cargo_boat').cargoCapacity / 2));
}]);
cases.push([37, 'mixed selection is without replacement', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'cargo_boat', cargoTypes: ['general', 'container'], cargoGeneration: { mode: 'mixed', weights: { general: 100, container: 1 }, multiCargoChance: 1 } } });
  const cargo = makeDirector({ s, config: custom, points, characteristics, rng: countingRng(0) }).step(makeInput()).command.payload.cargo;
  assert.deepEqual(new Set(Object.keys(cargo)).size, 2);
}]);
cases.push([38, 'insufficient compatible types falls back to single in mixed mode', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'tanker', cargoTypes: ['oil'], cargoGeneration: { mode: 'mixed', weights: { oil: 1 }, multiCargoChance: 1 } } });
  const cargo = makeDirector({ s, config: custom, points, characteristics, rng: countingRng(0) }).step(makeInput()).command.payload.cargo;
  assert.deepEqual(cargo, { oil: characteristics.require('tanker').cargoCapacity });
}]);
cases.push([39, 'unsafe placement retry preserves selected ship type', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat' } });
  const director = makeDirector({ s, config: custom, points: [points[0]], characteristics });
  const blocker = activeShip(s, characteristics, { x: points[0].x, y: points[0].y });
  assert.equal(director.step(makeInput({ activeShips: [blocker] })).reason, 'unsafe_spawn');
  const snap = director.toSnapshot();
  const retry = director.step(makeInput({ simulationTime: config.balance.unsafeSpawnRetryDelayMs / 1000 }));
  assert.equal(retry.command.payload.shipType, snap.unresolved.shipType);
}]);
cases.push([40, 'unsafe placement retry preserves exact cargo manifest', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'cargo_boat' } });
  const director = makeDirector({ s, config: custom, points: [points[0]], characteristics });
  const blocker = activeShip(s, characteristics, { x: points[0].x, y: points[0].y });
  director.step(makeInput({ activeShips: [blocker] }));
  const cargo = director.toSnapshot().unresolved.cargo;
  const retry = director.step(makeInput({ simulationTime: config.balance.unsafeSpawnRetryDelayMs / 1000 }));
  assert.deepEqual(retry.command.payload.cargo, cargo);
}]);

// 41-60 safe spawn/retry
cases.push([41, 'outside combined warning radii is safe', async () => {
  const { s, config, points, characteristics } = await setup();
  const point = clonePoint(points[0], { x: 0, y: 0 });
  const combined = characteristics.require('speedboat').warningRadius * 2;
  const active = [activeShip(s, characteristics, { x: combined + 0.01, y: 0 })];
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat' } });
  assert.equal(makeDirector({ s, config: custom, points: [point], characteristics }).step(makeInput({ activeShips: active })).kind, 'schedule_incoming');
}]);
cases.push([42, 'exact combined warning boundary is unsafe', async () => {
  const { s, config, points, characteristics } = await setup();
  const point = clonePoint(points[0], { x: 0, y: 0 });
  const combined = characteristics.require('speedboat').warningRadius * 2;
  const active = [activeShip(s, characteristics, { x: combined, y: 0 })];
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat' } });
  assert.equal(makeDirector({ s, config: custom, points: [point], characteristics }).step(makeInput({ activeShips: active })).reason, 'unsafe_spawn');
}]);
cases.push([43, 'inside combined warning radii is unsafe', async () => {
  const { s, config, points, characteristics } = await setup();
  const point = clonePoint(points[0], { x: 0, y: 0 });
  const active = [activeShip(s, characteristics, { x: 1, y: 0 })];
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat' } });
  assert.equal(makeDirector({ s, config: custom, points: [point], characteristics }).step(makeInput({ activeShips: active })).reason, 'unsafe_spawn');
}]);
for (const [number, stateName, participates] of [
  [44, 'Leaving', true],
  [45, 'Entering', true],
  [46, 'Navigating', true],
  [47, 'ApproachingDock', true],
  [48, 'Docking', true],
  [49, 'Unloading', false],
  [50, 'ReadyToLeave', false],
  [51, 'Destroyed', false],
]) {
  cases.push([number, `${stateName} geometric spawn-safety participation is correct`, async () => {
    const { s, config, points, characteristics } = await setup();
    const point = clonePoint(points[0], { x: 0, y: 0 });
    const active = [activeShip(s, characteristics, { state: s.ShipState[stateName], x: 0, y: 0 })];
    const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat', director: { pressureCap: 999 } } });
    const result = makeDirector({ s, config: custom, points: [point], characteristics }).step(makeInput({ activeShips: active }));
    assert.equal(result.kind === 'schedule_incoming', !participates);
  }]);
}
cases.push([52, 'another pending transaction makes a spawn point unavailable', async () => {
  const { s, config, points, characteristics } = await setup();
  const director = makeDirector({ s, config, points: [points[0]], characteristics });
  assert.equal(director.step(makeInput({ owner: () => 'other-tx' })).reason, 'unsafe_spawn');
}]);
cases.push([53, 'own pending transaction does not fail actual ready recheck', async () => {
  const { s, config, points, characteristics } = await setup();
  const director = makeDirector({ s, config, points: [points[0]], characteristics });
  const scheduled = director.step(makeInput());
  director.confirmScheduled(scheduled.command.transactionId, 0);
  const resolved = director.resolveReadySpawn(readyFrom(scheduled), makeInput({ owner: () => scheduled.command.transactionId }));
  assert.equal(resolved.kind, 'approved');
}]);
cases.push([54, 'no safe spawn point defers rather than scheduling indicator', async () => {
  const { s, config, points, characteristics } = await setup();
  const director = makeDirector({ s, config, points: [points[0]], characteristics });
  const blocker = activeShip(s, characteristics, { x: points[0].x, y: points[0].y });
  assert.equal(director.step(makeInput({ activeShips: [blocker] })).reason, 'unsafe_spawn');
}]);
cases.push([55, 'unsafe defer uses machine retry delay', async () => {
  const { s, config, points, characteristics } = await setup();
  const director = makeDirector({ s, config, points: [points[0]], characteristics });
  const blocker = activeShip(s, characteristics, { x: points[0].x, y: points[0].y });
  director.step(makeInput({ simulationTime: 10, activeShips: [blocker] }));
  assert.equal(director.retryDueTime, 10 + config.balance.unsafeSpawnRetryDelayMs / 1000);
}]);
cases.push([56, 'no safe point consumes no point-selection or jitter RNG', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat', cargoTypes: ['general'], cargoGeneration: { mode: 'single', weights: { general: 1 }, multiCargoChance: 0 } } });
  const rng = countingRng(0);
  const director = makeDirector({ s, config: custom, points: [points[0]], characteristics, rng });
  const blocker = activeShip(s, characteristics, { x: points[0].x, y: points[0].y });
  director.step(makeInput({ activeShips: [blocker] }));
  assert.deepEqual(rng.calls.map((call) => call.method), ['next']);
}]);
cases.push([57, 'safe retry after initial defer does not reroll ship or cargo', async () => {
  const { s, config, points, characteristics } = await setup();
  const director = makeDirector({ s, config, points: [points[0]], characteristics });
  const blocker = activeShip(s, characteristics, { x: points[0].x, y: points[0].y });
  director.step(makeInput({ activeShips: [blocker] }));
  const before = director.toSnapshot().unresolved;
  const retry = director.step(makeInput({ simulationTime: config.balance.unsafeSpawnRetryDelayMs / 1000 }));
  assert.equal(retry.command.payload.shipType, before.shipType);
  assert.deepEqual(retry.command.payload.cargo, before.cargo);
}]);
cases.push([58, 'actual-ready point becoming unsafe returns retry and no approval', async () => {
  const { s, config, points, characteristics } = await setup();
  const director = makeDirector({ s, config, points: [points[0]], characteristics });
  const scheduled = director.step(makeInput());
  director.confirmScheduled(scheduled.command.transactionId, 0);
  const blocker = activeShip(s, characteristics, { x: points[0].x, y: points[0].y, state: s.ShipState.Leaving });
  const resolution = director.resolveReadySpawn(readyFrom(scheduled), makeInput({ activeShips: [blocker], owner: () => scheduled.command.transactionId }));
  assert.equal(resolution.kind, 'retry');
}]);
cases.push([59, 'actual retry preserves logical identity', async () => {
  const { s, config, points, characteristics } = await setup();
  const director = makeDirector({ s, config, points, characteristics });
  const scheduled = director.step(makeInput());
  director.confirmScheduled(scheduled.command.transactionId, 0);
  const blocker = activeShip(s, characteristics, { x: scheduled.command.spawnPoint.x, y: scheduled.command.spawnPoint.y, state: s.ShipState.Leaving });
  const resolution = director.resolveReadySpawn(readyFrom(scheduled), makeInput({ activeShips: [blocker], owner: () => scheduled.command.transactionId }));
  const retry = director.step(makeInput({ simulationTime: resolution.retryDueTime }));
  assert.equal(retry.logicalSpawnId, scheduled.logicalSpawnId);
  assert.equal(retry.command.payload.shipId, scheduled.command.payload.shipId);
  assert.equal(retry.command.payload.spawnSequence, scheduled.command.payload.spawnSequence);
}]);
cases.push([60, 'eventual safe retry can approve the same logical spawn', async () => {
  const { s, config, points, characteristics } = await setup();
  const director = makeDirector({ s, config, points, characteristics });
  const first = director.step(makeInput());
  director.confirmScheduled(first.command.transactionId, 0);
  const blocker = activeShip(s, characteristics, { x: first.command.spawnPoint.x, y: first.command.spawnPoint.y, state: s.ShipState.Leaving });
  const failed = director.resolveReadySpawn(readyFrom(first), makeInput({ activeShips: [blocker], owner: () => first.command.transactionId }));
  const retry = director.step(makeInput({ simulationTime: failed.retryDueTime }));
  director.confirmScheduled(retry.command.transactionId, failed.retryDueTime);
  const approved = director.resolveReadySpawn(readyFrom(retry), makeInput({ simulationTime: failed.retryDueTime, owner: () => retry.command.transactionId }));
  assert.equal(approved.kind, 'approved');
}]);

// 61-73 burst curve
cases.push([61, 'first burstTarget equals authored burstMin', async () => {
  const { s, config, points, characteristics } = await setup();
  const director = makeDirector({ s, config, points, characteristics });
  assert.equal(director.burstTarget, config.level.director.wave.burstMin);
}]);
cases.push([62, 'first burst consumes no pre-first-spawn wave RNG draw', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat', cargoTypes: ['general'], cargoGeneration: { mode: 'single', weights: { general: 1 }, multiCargoChance: 0 } } });
  const rng = countingRng(0);
  makeDirector({ s, config: custom, points: [points[0]], characteristics, rng }).step(makeInput());
  assert.equal(rng.calls.length, 3);
}]);
cases.push([63, 'first burst interval is startInterval before jitter', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat', director: { jitter: 0, wave: { burstMin: 2, burstMax: 2 } } } });
  const director = makeDirector({ s, config: custom, points, characteristics });
  const scheduled = director.step(makeInput());
  director.confirmScheduled(scheduled.command.transactionId, 0);
  assert.equal(director.nextSpawnDueTime, custom.level.director.startInterval);
}]);
cases.push([64, 'final burst interval is minimumInterval before jitter', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat', director: { jitter: 0, wave: { burstMin: 2, burstMax: 2, breathMin: 0, breathMax: 0 } } } });
  const director = makeDirector({ s, config: custom, points, characteristics });
  const first = director.step(makeInput());
  approveAndMaterialize(director, first, 0);
  const secondTime = director.nextSpawnDueTime;
  const second = director.step(makeInput({ simulationTime: secondTime }));
  director.confirmScheduled(second.command.transactionId, secondTime);
  assert.equal(director.nextSpawnDueTime - secondTime, custom.level.director.minimumInterval);
}]);
cases.push([65, 'middle burst ordinal uses exact linear interpolation', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat', director: { startInterval: 6, minimumInterval: 2, jitter: 0, wave: { burstMin: 3, burstMax: 3, breathMin: 0, breathMax: 0 } } } });
  const director = makeDirector({ s, config: custom, points, characteristics });
  const first = director.step(makeInput()); approveAndMaterialize(director, first, 0);
  const t1 = director.nextSpawnDueTime;
  const middle = director.step(makeInput({ simulationTime: t1 })); approveAndMaterialize(director, middle, t1);
  assert.equal(director.nextSpawnDueTime - t1, 4);
}]);
cases.push([66, 'interval jitter uses configured fraction', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat', director: { startInterval: 10, jitter: 0.2, wave: { burstMin: 2, burstMax: 2 } } } });
  const rng = scriptedRng([
    { method: 'next', label: 'cargo', value: 0 },
    { method: 'next', label: 'point', value: 0 },
    { method: 'range', label: 'jitter', value: 1 },
  ]);
  const director = makeDirector({ s, config: custom, points: [points[0]], characteristics, rng });
  const scheduled = director.step(makeInput());
  director.confirmScheduled(scheduled.command.transactionId, 0);
  assert.equal(director.nextSpawnDueTime, 12);
}]);
cases.push([67, 'every logical event consumes exactly one jitter draw even when jitter is zero', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat', director: { jitter: 0, wave: { burstMin: 2, burstMax: 2 } } } });
  const rng = countingRng(0);
  const director = makeDirector({ s, config: custom, points: [points[0]], characteristics, rng });
  const first = director.step(makeInput());
  assert.equal(rng.calls.filter((call) => call.method === 'range' && call.minimum === 0 && call.maximum === 0).length, 1);
  approveAndMaterialize(director, first, 0);
  director.step(makeInput({ simulationTime: director.nextSpawnDueTime }));
  assert.equal(rng.calls.filter((call) => call.method === 'range' && call.minimum === 0 && call.maximum === 0).length, 2);
}]);
cases.push([68, 'final burst adds extra breath to next due time', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat', director: { startInterval: 5, minimumInterval: 3, jitter: 0, wave: { burstMin: 1, burstMax: 1, breathMin: 2, breathMax: 2 } } } });
  const director = makeDirector({ s, config: custom, points, characteristics, rng: countingRng(0) });
  const scheduled = director.step(makeInput());
  director.confirmScheduled(scheduled.command.transactionId, 0);
  assert.equal(director.nextSpawnDueTime, 5);
}]);
cases.push([69, 'sampled breath remains within authored min/max', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat', director: { jitter: 0, wave: { burstMin: 1, burstMax: 1, breathMin: 1.25, breathMax: 2.25 } } } });
  const director = makeDirector({ s, config: custom, points, characteristics, rng: new s.SeededRng(44) });
  director.step(makeInput());
  const breath = director.toSnapshot().unresolved.breathSeconds;
  assert.ok(breath >= 1.25 && breath <= 2.25);
}]);
cases.push([70, 'next burstTarget is sampled inside inclusive burstMin/burstMax', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat', director: { wave: { burstMin: 1, burstMax: 3 } } } });
  const director = makeDirector({ s, config: custom, points, characteristics, rng: new s.SeededRng(55) });
  director.step(makeInput());
  const nextTarget = director.toSnapshot().unresolved.nextBurstTarget;
  assert.ok(nextTarget >= 1 && nextTarget <= 3);
}]);
cases.push([71, 'post-burst RNG order is jitter then breath then nextTarget', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat', cargoTypes: ['general'], cargoGeneration: { mode: 'single', weights: { general: 1 }, multiCargoChance: 0 }, director: { wave: { burstMin: 1, burstMax: 2 } } } });
  const rng = scriptedRng([
    { method: 'next', label: 'cargo', value: 0 },
    { method: 'next', label: 'point', value: 0 },
    { method: 'range', label: 'jitter', value: 0.5 },
    { method: 'range', label: 'breath', value: 0.5 },
    { method: 'next', label: 'nextTarget', value: 0 },
  ]);
  makeDirector({ s, config: custom, points: [points[0]], characteristics, rng }).step(makeInput());
  assert.deepEqual(rng.trace, ['cargo', 'point', 'jitter', 'breath', 'nextTarget']);
}]);
cases.push([72, 'wave ordinal advances once per logical event and not on placement retry', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat', director: { wave: { burstMin: 2, burstMax: 2 } } } });
  const director = makeDirector({ s, config: custom, points, characteristics });
  const first = director.step(makeInput());
  director.confirmScheduled(first.command.transactionId, 0);
  assert.equal(director.burstOrdinal, 1);
  const blocker = activeShip(s, characteristics, { state: s.ShipState.Leaving, x: first.command.spawnPoint.x, y: first.command.spawnPoint.y });
  const retry = director.resolveReadySpawn(readyFrom(first), makeInput({ activeShips: [blocker], owner: () => first.command.transactionId }));
  const secondAttempt = director.step(makeInput({ simulationTime: retry.retryDueTime }));
  director.confirmScheduled(secondAttempt.command.transactionId, retry.retryDueTime);
  assert.equal(director.burstOrdinal, 1);
}]);
cases.push([73, 'next due time follows exact PA-01 formula from successful schedule time', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat', director: { startInterval: 8, minimumInterval: 4, jitter: 0, wave: { burstMin: 2, burstMax: 2 } } } });
  const director = makeDirector({ s, config: custom, points, characteristics });
  const scheduled = director.step(makeInput({ simulationTime: 10 }));
  director.confirmScheduled(scheduled.command.transactionId, 10);
  assert.equal(director.nextSpawnDueTime, 18);
}]);

// 74-79 RNG order
cases.push([74, 'normal single event consumes ship then cargo then point then jitter', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { allowedShips: ['speedboat', 'cargo_boat'], shipWeights: { speedboat: 1, cargo_boat: 1 }, cargoTypes: ['general'], cargoGeneration: { mode: 'single', weights: { general: 1 }, multiCargoChance: 0 } } });
  const rng = scriptedRng([
    { method: 'next', label: 'ship', value: 0.9 },
    { method: 'next', label: 'cargo', value: 0 },
    { method: 'next', label: 'point', value: 0 },
    { method: 'range', label: 'jitter', value: 0.5 },
  ]);
  const scheduled = makeDirector({ s, config: custom, points: [points[0]], characteristics, rng }).step(makeInput());
  assert.equal(scheduled.command.payload.shipType, 'cargo_boat');
  assert.deepEqual(rng.trace, ['ship', 'cargo', 'point', 'jitter']);
}]);
cases.push([75, 'scripted intro order omits ship draw and starts cargo then point then jitter', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat', cargoTypes: ['general'], cargoGeneration: { mode: 'single', weights: { general: 1 }, multiCargoChance: 0 } } });
  const rng = scriptedRng([
    { method: 'next', label: 'cargo', value: 0 },
    { method: 'next', label: 'point', value: 0 },
    { method: 'range', label: 'jitter', value: 0.5 },
  ]);
  makeDirector({ s, config: custom, points: [points[0]], characteristics, rng }).step(makeInput());
  assert.deepEqual(rng.trace, ['cargo', 'point', 'jitter']);
}]);
cases.push([76, 'mixed cargo order is ship then chance/selections then point then jitter', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { allowedShips: ['cargo_boat'], shipWeights: { cargo_boat: 1 }, cargoTypes: ['general', 'container'], cargoGeneration: { mode: 'mixed', weights: { general: 1, container: 1 }, multiCargoChance: 1 } } });
  const rng = scriptedRng([
    { method: 'next', label: 'ship', value: 0 },
    { method: 'next', label: 'multiChance', value: 0 },
    { method: 'next', label: 'primary', value: 0 },
    { method: 'next', label: 'secondary', value: 0 },
    { method: 'next', label: 'point', value: 0 },
    { method: 'range', label: 'jitter', value: 0.5 },
  ]);
  makeDirector({ s, config: custom, points: [points[0]], characteristics, rng }).step(makeInput());
  assert.deepEqual(rng.trace, ['ship', 'multiChance', 'primary', 'secondary', 'point', 'jitter']);
}]);
cases.push([77, 'final burst event appends breath and nextTarget after jitter', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat', cargoTypes: ['general'], cargoGeneration: { mode: 'single', weights: { general: 1 }, multiCargoChance: 0 }, director: { wave: { burstMin: 1, burstMax: 2 } } } });
  const rng = scriptedRng([
    { method: 'next', label: 'cargo', value: 0 },
    { method: 'next', label: 'point', value: 0 },
    { method: 'range', label: 'jitter', value: 0.5 },
    { method: 'range', label: 'breath', value: 0.5 },
    { method: 'next', label: 'nextTarget', value: 0 },
  ]);
  makeDirector({ s, config: custom, points: [points[0]], characteristics, rng }).step(makeInput());
  assert.deepEqual(rng.trace, ['cargo', 'point', 'jitter', 'breath', 'nextTarget']);
}]);
cases.push([78, 'no-safe initial point stops after ship/cargo and before point/jitter', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat', cargoTypes: ['general'], cargoGeneration: { mode: 'single', weights: { general: 1 }, multiCargoChance: 0 } } });
  const rng = countingRng(0);
  const director = makeDirector({ s, config: custom, points: [points[0]], characteristics, rng });
  const blocker = activeShip(s, characteristics, { x: points[0].x, y: points[0].y });
  director.step(makeInput({ activeShips: [blocker] }));
  assert.deepEqual(rng.calls.map((call) => call.method), ['next']);
}]);
cases.push([79, 'actual placement retry does not reroll ship/cargo/jitter', async () => {
  const { s, config, points, characteristics } = await setup();
  const custom = copyConfig(config, { level: { scriptedIntroShip: 'speedboat', cargoTypes: ['general'], cargoGeneration: { mode: 'single', weights: { general: 1 }, multiCargoChance: 0 } } });
  const rng = countingRng(0);
  const director = makeDirector({ s, config: custom, points, characteristics, rng });
  const first = director.step(makeInput());
  director.confirmScheduled(first.command.transactionId, 0);
  const drawCount = rng.calls.length;
  const blocker = activeShip(s, characteristics, { state: s.ShipState.Leaving, x: first.command.spawnPoint.x, y: first.command.spawnPoint.y });
  const retry = director.resolveReadySpawn(readyFrom(first), makeInput({ activeShips: [blocker], owner: () => first.command.transactionId }));
  director.step(makeInput({ simulationTime: retry.retryDueTime }));
  assert.equal(rng.calls.length, drawCount + 1);
}]);

// 80-87 determinism
async function deterministicSequence(seed, count = 8) {
  const { s, config, points, characteristics } = await setup();
  const rng = new s.SeededRng(seed);
  const director = makeDirector({ s, config, points, characteristics, rng });
  const events = [];
  for (let index = 0; index < count; index += 1) {
    const time = director.nextSpawnDueTime;
    const scheduled = director.step(makeInput({ simulationTime: time }));
    assert.equal(scheduled.kind, 'schedule_incoming');
    events.push({
      type: scheduled.command.payload.shipType,
      cargo: scheduled.command.payload.cargo,
      point: scheduled.command.spawnPoint.id,
      spawnSequence: scheduled.command.payload.spawnSequence,
      time,
      burstTarget: director.burstTarget,
    });
    approveAndMaterialize(director, scheduled, time);
  }
  return { events, snapshot: director.toSnapshot(), rngState: rng.getState() };
}
cases.push([80, 'same seed and same inputs produce identical ship type sequence', async () => {
  const a = await deterministicSequence(1001);
  const b = await deterministicSequence(1001);
  assert.deepEqual(a.events.map((event) => event.type), b.events.map((event) => event.type));
}]);
cases.push([81, 'same seed and inputs produce identical cargo sequence', async () => {
  const a = await deterministicSequence(1002);
  const b = await deterministicSequence(1002);
  assert.deepEqual(a.events.map((event) => event.cargo), b.events.map((event) => event.cargo));
}]);
cases.push([82, 'same seed and inputs produce identical spawn-point sequence', async () => {
  const a = await deterministicSequence(1003);
  const b = await deterministicSequence(1003);
  assert.deepEqual(a.events.map((event) => event.point), b.events.map((event) => event.point));
}]);
cases.push([83, 'same seed and inputs produce identical timing sequence', async () => {
  const a = await deterministicSequence(1004);
  const b = await deterministicSequence(1004);
  assert.deepEqual(a.events.map((event) => event.time), b.events.map((event) => event.time));
}]);
cases.push([84, 'same seed and inputs produce identical burst sequence', async () => {
  const a = await deterministicSequence(1005);
  const b = await deterministicSequence(1005);
  assert.deepEqual(a.events.map((event) => event.burstTarget), b.events.map((event) => event.burstTarget));
}]);
cases.push([85, 'snapshot restore reproduces exact future sequence and RNG state', async () => {
  const { s, config, points, characteristics } = await setup();
  const rngA = new s.SeededRng(555);
  const directorA = makeDirector({ s, config, points, characteristics, rng: rngA, identityStart: 0 });
  const first = directorA.step(makeInput());
  approveAndMaterialize(directorA, first, 0);
  const snapshot = directorA.toSnapshot();

  const rngB = new s.SeededRng(1);
  const directorB = makeDirector({ s, config, points, characteristics, rng: rngB, identityStart: 1 });
  directorB.restore(snapshot);

  const time = directorA.nextSpawnDueTime;
  const nextA = directorA.step(makeInput({ simulationTime: time }));
  const nextB = directorB.step(makeInput({ simulationTime: time }));
  assert.deepEqual(nextA, nextB);
  assert.deepEqual(rngA.getState(), rngB.getState());
}]);
cases.push([86, 'reversing active ship snapshot order does not change safety result', async () => {
  const { s, config, points, characteristics } = await setup();
  const blockers = [
    activeShip(s, characteristics, { id: 'a', x: 500, y: 500 }),
    activeShip(s, characteristics, { id: 'b', x: 600, y: 600 }),
  ];
  const a = makeDirector({ s, config, points, characteristics, rng: new s.SeededRng(77) }).step(makeInput({ activeShips: blockers }));
  const b = makeDirector({ s, config, points, characteristics, rng: new s.SeededRng(77) }).step(makeInput({ activeShips: [...blockers].reverse() }));
  assert.deepEqual(a, b);
}]);

async function runFixedPartition(renderHz) {
  const { s, bundle, config, points, characteristics } = await setup();
  const rng = new s.SeededRng(24680);
  const director = makeDirector({ s, config, points, characteristics, rng });
  const incoming = new s.IncomingSpawnSystem();
  const spawner = new s.ShipSpawner(characteristics);
  const balance = bundle.configs['balance.json'];
  const clock = new s.FixedStepClock({
    fixedHz: balance.simulation.fixedHz,
    maxCatchUpSteps: balance.simulation.maxCatchUpSteps,
  });
  const indicators = [];
  const approved = [];
  const frameMs = 1000 / renderHz;
  const totalFrames = renderHz * 20;

  for (let frame = 0; frame < totalFrames; frame += 1) {
    clock.advance(frameMs, (dt) => {
      const time = clock.elapsedSeconds;
      const result = director.step(makeInput({
        simulationTime: time,
        owner: (pointId) => incoming.getSpawnPointOwner(pointId),
      }));
      if (result.kind === 'schedule_incoming') {
        const scheduled = incoming.schedule(result.command);
        assert.equal(scheduled.ok, true);
        indicators.push({
          tx: result.command.transactionId,
          point: result.command.spawnPoint.id,
          type: result.command.payload.shipType,
          cargo: result.command.payload.cargo,
          seq: result.command.payload.spawnSequence,
        });
        director.confirmScheduled(result.command.transactionId, time);
      }

      incoming.step(dt);
      const ready = incoming.peekReadySpawns();
      if (ready.length > 0) {
        assert.equal(ready.length, 1);
        const command = ready[0];
        const resolution = director.resolveReadySpawn(
          command,
          makeInput({
            simulationTime: time,
            owner: (pointId) => incoming.getSpawnPointOwner(pointId),
          }),
        );
        assert.equal(resolution.kind, 'approved');
        const consumed = incoming.consumeReadySpawns();
        assert.equal(consumed.length, 1);
        const materialized = spawner.materialize(command);
        approved.push({
          tx: command.transactionId,
          point: materialized.spawnPointId,
          type: materialized.ship.characteristics.type,
          cargo: materialized.ship.cargo,
          seq: materialized.spawnSequence,
        });
        director.confirmMaterialized(resolution.logicalSpawnId);
      }
    });
  }

  return {
    indicators,
    approved,
    director: director.toSnapshot(),
    rngState: rng.getState(),
  };
}
cases.push([87, '30/60/120 render partitions produce identical logical, indicator, approved, timing, burst and RNG state', async () => {
  const thirty = await runFixedPartition(30);
  const sixty = await runFixedPartition(60);
  const oneTwenty = await runFixedPartition(120);
  assert.deepEqual(thirty, sixty);
  assert.deepEqual(sixty, oneTwenty);
}]);

// Extra production/no-go and boundary checks.
cases.push([88, 'production COR-10 boundary contains no forbidden random/timer/platform dependencies', () => {
  const source = [
    'src/spawning/SpawnDirector.ts',
    'src/spawning/IncomingSpawnSystem.ts',
    'src/spawning/ShipSpawner.ts',
    'src/spawning/SpawnPoint.ts',
    'src/spawning/SpawnPointFactory.ts',
    'src/spawning/WeightedSpawnPointPicker.ts',
    'src/ships/ShipCharacteristics.ts',
  ].map((path) => readFileSync(path, 'utf8')).join('\n');
  assert.doesNotMatch(source, /Math\.random|setTimeout|setInterval|Phaser|Yandex/);
}]);
cases.push([89, 'SpawnDirector production source does not embed forbidden baseline values or level-specific IDs', () => {
  const source = readFileSync('src/spawning/SpawnDirector.ts', 'utf8');
  assert.doesNotMatch(source, /calm_01|spawn_l|spawn_r|spawn_b/);
  assert.doesNotMatch(source, /\b0\.45\b|\b0\.12\b|\b250\b/);
}]);
cases.push([90, 'IncomingSpawnSystem exposes read-only pending owner lookup used by actual recheck', async () => {
  const { s, points } = await setup();
  const incoming = new s.IncomingSpawnSystem();
  assert.equal(incoming.getSpawnPointOwner(points[0].id), null);
  const result = incoming.schedule({
    transactionId: 'owner-check',
    spawnPoint: points[0],
    payload: {
      shipId: 'ship-owner-check',
      shipType: 'speedboat',
      cargo: { general: 1 },
      spawnSequence: 999,
    },
    leadTimeSeconds: 0.5,
  });
  assert.equal(result.ok, true);
  assert.equal(incoming.getSpawnPointOwner(points[0].id), 'owner-check');
}]);

for (const [number, name, fn] of cases) {
  test(`COR-10 #${String(number).padStart(2, '0')} ${name}`, fn);
}
