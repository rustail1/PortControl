import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readBaselineSource } from './support/readBaselineSource.mjs';

let contextPromise;

async function setup() {
  contextPromise ??= Promise.all([
    import('../src/spawning/index.ts'),
    import('../src/ships/index.ts'),
    import('../src/config/validateConfigSource.ts'),
    import('../src/core/SeededRng.ts'),
    import('../src/core/FixedStepClock.ts'),
  ]).then(([spawning, ships, config, rng, clock]) => {
    const bundle = config.validateConfigSource(readBaselineSource());
    return {
      spawning,
      ships,
      bundle,
      SeededRng: rng.SeededRng,
      FixedStepClock: clock.FixedStepClock,
      registry: ships.createShipCharacteristicsRegistry(bundle),
    };
  });

  return contextPromise;
}

function cloneLevel(level) {
  return structuredClone(level);
}

function findSpawnBlock(level, id) {
  return level.layout.blocks.find(
    (block) => block.blockType === 'spawn_point' && block.id === id,
  );
}

function makePayload(overrides = {}) {
  return {
    shipId: 'incoming-ship',
    shipType: 'speedboat',
    cargo: { general: 2 },
    spawnSequence: 7,
    ...overrides,
  };
}

function makeRng(next) {
  return {
    next,
    range(minimum, maximum) {
      return minimum + (maximum - minimum) * this.next();
    },
    getState() {
      return [];
    },
    setState() {},
  };
}

async function makeIncoming(leadTimeSeconds = 0.9) {
  const a = await setup();
  const level = a.bundle.levels['calm_01'];
  const spawnPoint = a.spawning.createSpawnPointsFromLevel(level)[0];
  const system = new a.spawning.IncomingSpawnSystem();

  assert.ok(spawnPoint);

  return {
    ...a,
    level,
    spawnPoint,
    system,
    request: {
      transactionId: 'tx-1',
      spawnPoint,
      payload: makePayload(),
      leadTimeSeconds,
    },
  };
}

// 1
test('validated calm_01 runtime factory returns exactly its three enabled SpawnPoints', async () => {
  const a = await setup();
  const points = a.spawning.createSpawnPointsForValidatedLevel(a.bundle, 'calm_01');
  assert.equal(points.length, 3);
});

// 2
test('runtime factory returns only spawn_point blocks', async () => {
  const a = await setup();
  const points = a.spawning.createSpawnPointsFromLevel(a.bundle.levels['calm_01']);
  assert.deepEqual(points.map((point) => point.id), ['spawn_l', 'spawn_r', 'spawn_b']);
});

// 3
test('SpawnPoint authored id is preserved', async () => {
  const a = await setup();
  const [point] = a.spawning.createSpawnPointsFromLevel(a.bundle.levels['calm_01']);
  assert.equal(point.id, 'spawn_l');
});

// 4
test('SpawnPoint authored x is preserved exactly', async () => {
  const a = await setup();
  const [point] = a.spawning.createSpawnPointsFromLevel(a.bundle.levels['calm_01']);
  assert.equal(point.x, 25);
});

// 5
test('SpawnPoint authored y is preserved exactly', async () => {
  const a = await setup();
  const [point] = a.spawning.createSpawnPointsFromLevel(a.bundle.levels['calm_01']);
  assert.equal(point.y, 520);
});

// 6
test('SpawnPoint directionDeg comes from authored props without offset', async () => {
  const a = await setup();
  const points = a.spawning.createSpawnPointsFromLevel(a.bundle.levels['calm_01']);
  assert.deepEqual(points.map((point) => point.directionDeg), [0, 180, 270]);
});

// 7
test('SpawnPoint weight is preserved exactly', async () => {
  const a = await setup();
  const points = a.spawning.createSpawnPointsFromLevel(a.bundle.levels['calm_01']);
  assert.deepEqual(points.map((point) => point.weight), [1, 1, 0.85]);
});

// 8
test('SpawnPoint tags are preserved and immutable', async () => {
  const a = await setup();
  const level = cloneLevel(a.bundle.levels['calm_01']);
  const block = findSpawnBlock(level, 'spawn_l');
  block.props.tags = ['west', 'tutorial'];
  const [point] = a.spawning.createSpawnPointsFromLevel(level);
  assert.deepEqual(point.tags, ['west', 'tutorial']);
  assert.equal(Object.isFrozen(point.tags), true);
});

// 9
test('disabled SpawnPoint blocks are ignored', async () => {
  const a = await setup();
  const level = cloneLevel(a.bundle.levels['calm_01']);
  findSpawnBlock(level, 'spawn_r').enabled = false;
  const points = a.spawning.createSpawnPointsFromLevel(level);
  assert.deepEqual(points.map((point) => point.id), ['spawn_l', 'spawn_b']);
});

// 10
test('SpawnPoint authored order is preserved', async () => {
  const a = await setup();
  const level = cloneLevel(a.bundle.levels['calm_01']);
  const blocks = level.layout.blocks;
  const spawns = blocks.filter((block) => block.blockType === 'spawn_point');
  const nonSpawns = blocks.filter((block) => block.blockType !== 'spawn_point');
  level.layout.blocks = [...nonSpawns, spawns[2], spawns[0], spawns[1]];
  const points = a.spawning.createSpawnPointsFromLevel(level);
  assert.deepEqual(points.map((point) => point.id), ['spawn_b', 'spawn_l', 'spawn_r']);
});

// 11
test('production SpawnPoint factory contains no level-specific IDs or authored coordinates', () => {
  const source = readFileSync('src/spawning/SpawnPointFactory.ts', 'utf8');
  assert.doesNotMatch(source, /calm_01|spawn_l|spawn_r|spawn_b|\b25\b|\b975\b|0\.9/);
});

// 12
test('missing leadTimeOverride uses level director warningLeadTime', async () => {
  const a = await setup();
  const level = a.bundle.levels['calm_01'];
  const [point] = a.spawning.createSpawnPointsFromLevel(level);
  assert.equal(a.spawning.getEffectiveSpawnLeadTime(point, level), level.director.warningLeadTime);
});

// 13
test('leadTimeOverride replaces level director warningLeadTime', async () => {
  const a = await setup();
  const level = cloneLevel(a.bundle.levels['calm_01']);
  findSpawnBlock(level, 'spawn_l').props.leadTimeOverride = 1.75;
  const [point] = a.spawning.createSpawnPointsFromLevel(level);
  assert.equal(a.spawning.getEffectiveSpawnLeadTime(point, level), 1.75);
});

// 14
test('leadTimeOverride zero remains zero through nullish resolution', async () => {
  const a = await setup();
  const level = cloneLevel(a.bundle.levels['calm_01']);
  findSpawnBlock(level, 'spawn_l').props.leadTimeOverride = 0;
  const [point] = a.spawning.createSpawnPointsFromLevel(level);
  assert.equal(a.spawning.getEffectiveSpawnLeadTime(point, level), 0);
});

// 15
test('same SeededRng seed and same ordered SpawnPoints produce the same weighted sequence', async () => {
  const a = await setup();
  const points = a.spawning.createSpawnPointsFromLevel(a.bundle.levels['calm_01']);
  const run = () => {
    const rng = new a.SeededRng(123456);
    return Array.from({ length: 24 }, () => a.spawning.pickWeightedSpawnPoint(points, rng)?.id);
  };
  const expected = [
    'spawn_r', 'spawn_b', 'spawn_b', 'spawn_l', 'spawn_l', 'spawn_l',
    'spawn_r', 'spawn_r', 'spawn_l', 'spawn_r', 'spawn_l', 'spawn_l',
    'spawn_r', 'spawn_b', 'spawn_b', 'spawn_b', 'spawn_b', 'spawn_b',
    'spawn_l', 'spawn_l', 'spawn_b', 'spawn_r', 'spawn_b', 'spawn_r',
  ];
  assert.deepEqual(run(), expected);
  assert.deepEqual(run(), expected);
});

// 16
test('repeated weighted run with the same seed remains byte-for-byte identical', async () => {
  const a = await setup();
  const points = a.spawning.createSpawnPointsFromLevel(a.bundle.levels['calm_01']);
  const sequence = (seed) => {
    const rng = new a.SeededRng(seed);
    return Array.from({ length: 64 }, () => a.spawning.pickWeightedSpawnPoint(points, rng)?.id).join('|');
  };
  assert.equal(sequence(98765), sequence(98765));
});

// 17
test('zero-weight SpawnPoint is never selected', async () => {
  const a = await setup();
  const points = [
    a.spawning.createSpawnPoint({ id: 'zero', x: 1, y: 2, directionDeg: 0, weight: 0 }),
    a.spawning.createSpawnPoint({ id: 'live', x: 3, y: 4, directionDeg: 0, weight: 1 }),
  ];
  const rng = new a.SeededRng(42);
  for (let index = 0; index < 200; index += 1) {
    assert.equal(a.spawning.pickWeightedSpawnPoint(points, rng)?.id, 'live');
  }
});

// 18
test('weighted picker returns null when no SpawnPoint is selectable', async () => {
  const a = await setup();
  const points = [
    a.spawning.createSpawnPoint({ id: 'a', x: 0, y: 0, directionDeg: 0, weight: 0 }),
    a.spawning.createSpawnPoint({ id: 'b', x: 0, y: 0, directionDeg: 0, weight: 0 }),
  ];
  assert.equal(a.spawning.pickWeightedSpawnPoint(points, makeRng(() => 0.5)), null);
});

// 19
test('weighted picker never sorts and selects against authored order', async () => {
  const a = await setup();
  const points = [
    a.spawning.createSpawnPoint({ id: 'z_authored_first', x: 0, y: 0, directionDeg: 0, weight: 1 }),
    a.spawning.createSpawnPoint({ id: 'a_authored_second', x: 0, y: 0, directionDeg: 0, weight: 1 }),
  ];
  assert.equal(
    a.spawning.pickWeightedSpawnPoint(points, makeRng(() => 0.1))?.id,
    'z_authored_first',
  );
});

// 20
test('weighted picker consumes only the passed IRng', async () => {
  const a = await setup();
  const point = a.spawning.createSpawnPoint({ id: 'only', x: 0, y: 0, directionDeg: 0, weight: 1 });
  let calls = 0;
  const picked = a.spawning.pickWeightedSpawnPoint([point], makeRng(() => {
    calls += 1;
    return 0.25;
  }));
  assert.equal(picked, point);
  assert.equal(calls, 1);
});

// 21
test('all-zero weights do not consume RNG state', async () => {
  const a = await setup();
  const point = a.spawning.createSpawnPoint({ id: 'zero', x: 0, y: 0, directionDeg: 0, weight: 0 });
  let calls = 0;
  assert.equal(a.spawning.pickWeightedSpawnPoint([point], makeRng(() => {
    calls += 1;
    return 0;
  })), null);
  assert.equal(calls, 0);
});

// 22
test('weighted picker production code has no Math.random or hidden RNG construction', () => {
  const source = readFileSync('src/spawning/WeightedSpawnPointPicker.ts', 'utf8');
  assert.doesNotMatch(source, /Math\.random|new\s+SeededRng|Phaser|Yandex/);
});

// 23
test('schedule creates exactly one IncomingIndicator command', async () => {
  const a = await makeIncoming();
  const result = a.system.schedule(a.request);
  assert.equal(result.ok, true);
  assert.equal(a.system.indicatorCount, 1);
  assert.equal(a.system.peekIndicatorCommands().length, 1);
});

// 24
test('schedule never creates ReadySpawn in the same call', async () => {
  const a = await makeIncoming();
  a.system.schedule(a.request);
  assert.equal(a.system.readyCount, 0);
  assert.deepEqual(a.system.peekReadySpawns(), []);
});

// 25
test('scheduled SpawnPoint becomes pending immediately', async () => {
  const a = await makeIncoming();
  a.system.schedule(a.request);
  assert.equal(a.system.isSpawnPointPending(a.spawnPoint.id), true);
  assert.equal(a.system.pendingCount, 1);
});

// 26
test('second schedule on the same pending SpawnPoint returns typed failure', async () => {
  const a = await makeIncoming();
  assert.equal(a.system.schedule(a.request).ok, true);
  assert.deepEqual(
    a.system.schedule({ ...a.request, transactionId: 'tx-2' }),
    {
      ok: false,
      reason: 'spawn_point_pending',
      transactionId: 'tx-2',
      spawnPointId: a.spawnPoint.id,
      ownerTransactionId: 'tx-1',
    },
  );
});

// 27
test('duplicate transaction id returns typed failure even for another SpawnPoint', async () => {
  const a = await makeIncoming();
  const points = a.spawning.createSpawnPointsFromLevel(a.level);
  assert.equal(a.system.schedule(a.request).ok, true);
  assert.deepEqual(
    a.system.schedule({ ...a.request, spawnPoint: points[1] }),
    {
      ok: false,
      reason: 'duplicate_transaction_id',
      transactionId: 'tx-1',
      spawnPointId: points[1].id,
    },
  );
});

// 28
test('step before lead-time threshold creates no ReadySpawn', async () => {
  const a = await makeIncoming(0.9);
  a.system.schedule(a.request);
  assert.equal(a.system.step(0.899), 0);
  assert.equal(a.system.readyCount, 0);
});

// 29
test('step at exact lead-time threshold creates exactly one ReadySpawn', async () => {
  const a = await makeIncoming(0.9);
  a.system.schedule(a.request);
  assert.equal(a.system.step(0.4), 0);
  assert.equal(a.system.step(0.5), 1);
  assert.equal(a.system.readyCount, 1);
});

// 30
test('subsequent fixed steps never duplicate an emitted ReadySpawn', async () => {
  const a = await makeIncoming(0.2);
  a.system.schedule(a.request);
  assert.equal(a.system.step(0.2), 1);
  assert.equal(a.system.step(1), 0);
  assert.equal(a.system.step(1), 0);
  assert.equal(a.system.readyCount, 1);
});

// 31
test('cancel releases pending SpawnPoint ownership', async () => {
  const a = await makeIncoming();
  a.system.schedule(a.request);
  assert.deepEqual(a.system.cancel('tx-1'), {
    ok: true,
    transactionId: 'tx-1',
    spawnPointId: a.spawnPoint.id,
  });
  assert.equal(a.system.isSpawnPointPending(a.spawnPoint.id), false);
  assert.equal(a.system.pendingCount, 0);
});

// 32
test('consuming ReadySpawn releases SpawnPoint ownership', async () => {
  const a = await makeIncoming(0);
  a.system.schedule(a.request);
  a.system.step(0);
  const ready = a.system.consumeReadySpawns();
  assert.equal(ready.length, 1);
  assert.equal(a.system.isSpawnPointPending(a.spawnPoint.id), false);
  assert.equal(a.system.pendingCount, 0);
});

// 33
test('same SpawnPoint can schedule again after prior ReadySpawn is consumed', async () => {
  const a = await makeIncoming(0);
  a.system.schedule(a.request);
  a.system.step(0);
  a.system.consumeReadySpawns();
  const result = a.system.schedule({ ...a.request, transactionId: 'tx-2' });
  assert.equal(result.ok, true);
  assert.equal(a.system.isSpawnPointPending(a.spawnPoint.id), true);
});

// 34
test('leadTime zero still produces indicator first and ReadySpawn only on later step call', async () => {
  const a = await makeIncoming(0);
  const result = a.system.schedule(a.request);
  assert.equal(result.ok, true);
  assert.equal(a.system.indicatorCount, 1);
  assert.equal(a.system.readyCount, 0);
  assert.equal(a.system.step(0), 1);
  assert.equal(a.system.readyCount, 1);
});

// 35
test('IncomingIndicator command carries exact authored point and effective lead data', async () => {
  const a = await makeIncoming(0.9);
  const result = a.system.schedule(a.request);
  assert.equal(result.ok, true);
  assert.deepEqual(result.indicator, {
    transactionId: 'tx-1',
    spawnPointId: a.spawnPoint.id,
    x: a.spawnPoint.x,
    y: a.spawnPoint.y,
    directionDeg: a.spawnPoint.directionDeg,
    leadTimeSeconds: 0.9,
  });
});

// 36
test('ReadySpawn preserves caller-preselected payload without reroll', async () => {
  const a = await makeIncoming(0);
  const payload = makePayload({
    shipId: 'preselected-id',
    shipType: 'cargo_boat',
    cargo: { general: 3 },
    spawnSequence: 91,
  });
  a.system.schedule({ ...a.request, payload });
  a.system.step(0);
  const [ready] = a.system.peekReadySpawns();
  assert.deepEqual(ready.payload, payload);
});

// 37
test('cancel after ReadySpawn emission removes queued ready command and releases point', async () => {
  const a = await makeIncoming(0);
  a.system.schedule(a.request);
  a.system.step(0);
  assert.equal(a.system.readyCount, 1);
  assert.equal(a.system.cancel('tx-1').ok, true);
  assert.equal(a.system.readyCount, 0);
  assert.equal(a.system.isSpawnPointPending(a.spawnPoint.id), false);
});

// 38
test('schedule result does not materialize an active ShipModel', async () => {
  const a = await makeIncoming();
  const result = a.system.schedule(a.request);
  assert.equal(result.ok, true);
  assert.equal('ship' in result, false);
  assert.equal('ship' in result.indicator, false);
});

// 39
test('ShipSpawner materializes ReadySpawn as ShipState.Entering', async () => {
  const a = await makeIncoming(0);
  a.system.schedule(a.request);
  a.system.step(0);
  const [ready] = a.system.consumeReadySpawns();
  const record = new a.spawning.ShipSpawner(a.registry).materialize(ready);
  assert.equal(record.ship.state, a.ships.ShipState.Entering);
});

// 40
test('ShipSpawner uses authored SpawnPoint x exactly', async () => {
  const a = await makeIncoming(0);
  a.system.schedule(a.request);
  a.system.step(0);
  const [ready] = a.system.consumeReadySpawns();
  const record = new a.spawning.ShipSpawner(a.registry).materialize(ready);
  assert.equal(record.ship.x, a.spawnPoint.x);
});

// 41
test('ShipSpawner uses authored SpawnPoint y exactly', async () => {
  const a = await makeIncoming(0);
  a.system.schedule(a.request);
  a.system.step(0);
  const [ready] = a.system.consumeReadySpawns();
  const record = new a.spawning.ShipSpawner(a.registry).materialize(ready);
  assert.equal(record.ship.y, a.spawnPoint.y);
});

// 42
test('ShipSpawner uses SpawnPoint directionDeg as initial rotation', async () => {
  const a = await makeIncoming(0);
  a.system.schedule(a.request);
  a.system.step(0);
  const [ready] = a.system.consumeReadySpawns();
  const record = new a.spawning.ShipSpawner(a.registry).materialize(ready);
  assert.equal(record.ship.rotationDeg, a.spawnPoint.directionDeg);
});

// 43
test('ShipSpawner starts with route null', async () => {
  const a = await makeIncoming(0);
  a.system.schedule(a.request);
  a.system.step(0);
  const [ready] = a.system.consumeReadySpawns();
  const record = new a.spawning.ShipSpawner(a.registry).materialize(ready);
  assert.equal(record.ship.route, null);
});

// 44
test('ShipSpawner preserves supplied cargo exactly', async () => {
  const a = await makeIncoming(0);
  const payload = makePayload({ cargo: { general: 4 } });
  a.system.schedule({ ...a.request, payload });
  a.system.step(0);
  const [ready] = a.system.consumeReadySpawns();
  const record = new a.spawning.ShipSpawner(a.registry).materialize(ready);
  assert.deepEqual(record.ship.cargo, payload.cargo);
});

// 45
test('ShipSpawner preserves supplied ship type characteristics', async () => {
  const a = await makeIncoming(0);
  const payload = makePayload({ shipType: 'cargo_boat' });
  a.system.schedule({ ...a.request, payload });
  a.system.step(0);
  const [ready] = a.system.consumeReadySpawns();
  const record = new a.spawning.ShipSpawner(a.registry).materialize(ready);
  assert.equal(record.ship.characteristics, a.registry.require('cargo_boat'));
  assert.equal(record.ship.characteristics.type, 'cargo_boat');
});

// 46
test('ShipSpawner preserves caller-supplied spawnSequence outside ShipModel', async () => {
  const a = await makeIncoming(0);
  const payload = makePayload({ spawnSequence: 1234 });
  a.system.schedule({ ...a.request, payload });
  a.system.step(0);
  const [ready] = a.system.consumeReadySpawns();
  const record = new a.spawning.ShipSpawner(a.registry).materialize(ready);
  assert.equal(record.spawnSequence, 1234);
  assert.equal('spawnSequence' in record.ship.toSnapshot(), false);
});

// 47
test('ShipSpawner production code has no selection RNG or hidden spawn offset', () => {
  const source = readFileSync('src/spawning/ShipSpawner.ts', 'utf8');
  assert.doesNotMatch(source, /Math\.random|SeededRng|IRng|pickWeighted|offset|clamp|Phaser|Yandex/);
});

// 48
test('30 60 and 120 render partitions produce identical indicator and ReadySpawn fixed-step timing', async () => {
  const a = await setup();
  const level = a.bundle.levels['calm_01'];
  const spawnPoint = a.spawning.createSpawnPointsFromLevel(level)[0];
  const leadTimeSeconds = a.spawning.getEffectiveSpawnLeadTime(spawnPoint, level);

  const run = (fps) => {
    const system = new a.spawning.IncomingSpawnSystem();
    const clock = new a.FixedStepClock({ fixedHz: 60, maxCatchUpSteps: 6 });
    system.schedule({
      transactionId: 'fixed-step-transaction',
      spawnPoint,
      payload: makePayload({ shipId: 'fixed-step-ship', spawnSequence: 55 }),
      leadTimeSeconds,
    });

    const indicators = system.consumeIndicatorCommands();
    let fixedStepIndex = 0;
    let readyFixedStep = null;

    for (let frame = 0; frame < fps * 2; frame += 1) {
      clock.advance(1000 / fps, (dt) => {
        fixedStepIndex += 1;
        system.step(dt);
        if (readyFixedStep === null && system.readyCount > 0) {
          readyFixedStep = fixedStepIndex;
        }
      });
    }

    const ready = system.consumeReadySpawns();
    return {
      indicators,
      readyCount: ready.length,
      completed: ready.length === 1,
      readyFixedStep,
      fixedStepIndex,
      elapsedSeconds: clock.elapsedSeconds,
    };
  };

  const at30 = run(30);
  const at60 = run(60);
  const at120 = run(120);

  assert.deepEqual(at60, at30);
  assert.deepEqual(at120, at30);
  assert.equal(at30.readyCount, 1);
  assert.equal(at30.readyFixedStep, 54);
});

// 49
test('SpawnPoint and lead-time runtime validation reject non-finite or negative authored values', async () => {
  const a = await setup();
  const valid = { id: 'valid', x: 1, y: 2, directionDeg: 3, weight: 1 };

  assert.throws(() => a.spawning.createSpawnPoint({ ...valid, x: Number.NaN }), /x must be finite/);
  assert.throws(() => a.spawning.createSpawnPoint({ ...valid, y: Number.POSITIVE_INFINITY }), /y must be finite/);
  assert.throws(() => a.spawning.createSpawnPoint({ ...valid, directionDeg: Number.NaN }), /directionDeg must be finite/);
  assert.throws(() => a.spawning.createSpawnPoint({ ...valid, weight: -1 }), /weight must not be negative/);
  assert.throws(() => a.spawning.createSpawnPoint({ ...valid, weight: Number.NaN }), /weight must be finite/);
  assert.throws(() => a.spawning.createSpawnPoint({ ...valid, leadTimeOverride: -0.1 }), /leadTimeOverride/);

  const point = a.spawning.createSpawnPoint(valid);
  const system = new a.spawning.IncomingSpawnSystem();
  assert.throws(
    () => system.schedule({
      transactionId: 'invalid-lead',
      spawnPoint: point,
      payload: makePayload(),
      leadTimeSeconds: Number.NaN,
    }),
    /leadTimeSeconds/,
  );
});

// 50
test('COR-09 production boundary excludes forbidden runtime dependencies, timers, hardcoded level data, and later director scope', () => {
  const files = [
    'src/spawning/SpawnPoint.ts',
    'src/spawning/SpawnPointFactory.ts',
    'src/spawning/WeightedSpawnPointPicker.ts',
    'src/spawning/IncomingSpawnSystem.ts',
    'src/spawning/ShipSpawner.ts',
    'src/spawning/index.ts',
  ];
  const source = files.map((path) => readFileSync(path, 'utf8')).join('\n');

  assert.doesNotMatch(source, /Math\.random|Phaser|Yandex|setTimeout|setInterval/);
  assert.doesNotMatch(source, /calm_01|spawn_l|spawn_r|spawn_b|\b25\b|\b975\b|0\.9/);
  assert.doesNotMatch(source, /SpawnDirector|pressureCap|minimumInterval|startInterval|interval jitter|unsafe retry|retry delay|wave orchestration/i);
});
