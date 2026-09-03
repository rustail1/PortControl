import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readBaselineSource } from './support/readBaselineSource.mjs';

async function setup() {
  const [collision, ships, config, events, clock] = await Promise.all([
    import('../src/collision/index.ts'),
    import('../src/ships/index.ts'),
    import('../src/config/validateConfigSource.ts'),
    import('../src/core/DomainEventQueue.ts'),
    import('../src/core/FixedStepClock.ts'),
  ]);
  const bundle = config.validateConfigSource(readBaselineSource());
  const queue = new events.DomainEventQueue();
  const received = { warning: [], collision: [] };
  queue.subscribe('danger_warning', (event) => received.warning.push(event));
  queue.subscribe('collision', (event) => received.collision.push(event));
  const system = new collision.CollisionSystem({
    events: queue,
    config: collision.createCollisionConfig(bundle),
  });
  const registry = ships.createShipCharacteristicsRegistry(bundle);
  const ship = (id, x, y, state = ships.ShipState.Navigating, type = 'speedboat') =>
    new ships.ShipModel({ id, characteristics: registry.require(type), position: { x, y }, rotationDeg: 0, state });
  const candidates = (...items) => items.map(([model, spawnSequence]) => ({ ship: model, spawnSequence }));
  return { collision, ships, bundle, queue, received, system, registry, ship, candidates, FixedStepClock: clock.FixedStepClock };
}

function flush(context) { context.queue.flush(); return context.received; }

test('machine-backed warningRadius is preserved for every validated ship type', async () => {
  const a = await setup(); const source = a.bundle.configs['ships.json'].ships;
  for (const [type, characteristics] of Object.entries(source)) assert.equal(a.registry.require(type).warningRadius, characteristics.warningRadius);
});

test('collision rearm duration comes from validated balance config', async () => {
  const a = await setup(); assert.equal(a.collision.createCollisionConfig(a.bundle).warningRearmOutsideMs, a.bundle.configs['balance.json'].collision.warningRearmOutsideMs);
});

test('warning condition is inclusive and emits exactly once while inside', async () => {
  const a = await setup(); const one = a.ship('one', 0, 0), two = a.ship('two', 84, 0);
  assert.equal(a.system.step(a.candidates([one, 1], [two, 2]), 1 / 60).terminalCollision, null); flush(a);
  a.system.step(a.candidates([one, 1], [two, 2]), 1 / 60); flush(a);
  assert.deepEqual(a.received.warning, [{ shipAId: 'one', shipBId: 'two' }]);
});

test('outside warning radius emits nothing', async () => {
  const a = await setup(); const one = a.ship('one', 0, 0), two = a.ship('two', 84.01, 0);
  a.system.step(a.candidates([one, 1], [two, 2]), 1 / 60); flush(a); assert.deepEqual(a.received.warning, []);
});

test('danger re-arms only after continuous configured outside duration', async () => {
  const a = await setup(); const one = a.ship('one', 0, 0), two = a.ship('two', 84, 0), input = a.candidates([one, 1], [two, 2]);
  a.system.step(input, 0); flush(a); two.setPositionXY(100, 0); a.system.step(input, 0.699); two.setPositionXY(84, 0); a.system.step(input, 0); flush(a);
  assert.equal(a.received.warning.length, 1);
  two.setPositionXY(100, 0); a.system.step(input, 0.7); two.setPositionXY(84, 0); a.system.step(input, 0); flush(a);
  assert.equal(a.received.warning.length, 2);
});

test('interrupted outside time resets the danger re-arm timer', async () => {
  const a = await setup(); const one = a.ship('one', 0, 0), two = a.ship('two', 84, 0), input = a.candidates([one, 1], [two, 2]);
  a.system.step(input, 0); two.setPositionXY(100, 0); a.system.step(input, 0.5); two.setPositionXY(84, 0); a.system.step(input, 0); two.setPositionXY(100, 0); a.system.step(input, 0.5); two.setPositionXY(84, 0); a.system.step(input, 0); flush(a);
  assert.equal(a.received.warning.length, 1);
});

test('reversed candidate input has identical normalized danger pair', async () => {
  const a = await setup(); const one = a.ship('one', 0, 0), two = a.ship('two', 84, 0);
  a.system.step(a.candidates([two, 2], [one, 1]), 0); flush(a); assert.deepEqual(a.received.warning, [{ shipAId: 'one', shipBId: 'two' }]);
});

test('only authored collidable states participate', async () => {
  const a = await setup(); const active = a.ship('active', 0, 0);
  for (const state of [a.ships.ShipState.Unloading, a.ships.ShipState.ReadyToLeave, a.ships.ShipState.Destroyed]) {
    const other = a.ship(`excluded-${state}`, 20, 0, state); a.system.step(a.candidates([active, 1], [other, 2]), 0); flush(a);
  }
  assert.equal(a.received.warning.length, 0); assert.equal(a.received.collision.length, 0);
});

test('ApproachingDock Docking and Leaving remain collidable', async () => {
  const a = await setup();
  for (const state of [a.ships.ShipState.ApproachingDock, a.ships.ShipState.Docking, a.ships.ShipState.Leaving]) assert.equal(a.collision.participatesInShipCollision(state), true);
});

test('collision boundary is inclusive and terminal result/event occur exactly once', async () => {
  const a = await setup(); const one = a.ship('one', 0, 0), two = a.ship('two', 28, 0), input = a.candidates([one, 1], [two, 2]);
  const result = a.system.step(input, 0); flush(a); a.system.step(input, 1); flush(a);
  assert.deepEqual(result.terminalCollision, { shipAId: 'one', shipBId: 'two', distanceSquared: 784, failReason: 'collision' });
  assert.deepEqual(a.received.collision, [{ shipAId: 'one', shipBId: 'two', failReason: 'collision' }]);
  assert.deepEqual(a.received.warning, []);
});

test('outside collision radii does not produce a terminal collision', async () => {
  const a = await setup(); const one = a.ship('one', 0, 0), two = a.ship('two', 28.01, 0);
  assert.equal(a.system.step(a.candidates([one, 1], [two, 2]), 0).terminalCollision, null);
});

test('previous warning can be followed by terminal collision without movement mutation', async () => {
  const a = await setup(); const one = a.ship('one', 0, 0), two = a.ship('two', 84, 0); one.replaceRoute(new a.ships.ShipRoute([{ x: 150, y: 0 }]));
  a.system.step(a.candidates([one, 1], [two, 2]), 0); flush(a); const before = one.toSnapshot(); two.setPositionXY(20, 0);
  a.system.step(a.candidates([one, 1], [two, 2]), 0); flush(a);
  assert.deepEqual(one.toSnapshot(), before); assert.equal(a.received.collision.length, 1); assert.equal(a.received.warning.length, 1);
});

test('multiple collisions select smallest squared distance independent of input order', async () => {
  const a = await setup(); const one = a.ship('one', 0, 0), two = a.ship('two', 27, 0), three = a.ship('three', 50, 0);
  const result = a.system.step(a.candidates([three, 3], [one, 1], [two, 2]), 0); flush(a);
  assert.deepEqual(result.terminalCollision, { shipAId: 'two', shipBId: 'three', distanceSquared: 529, failReason: 'collision' });
});

test('equal-distance collision tie uses normalized spawn sequence pair', async () => {
  const a = await setup(); const one = a.ship('one', 0, 0), two = a.ship('two', 28, 0), three = a.ship('three', -28, 0);
  const result = a.system.step(a.candidates([three, 3], [two, 2], [one, 1]), 0);
  assert.deepEqual(result.terminalCollision, { shipAId: 'one', shipBId: 'two', distanceSquared: 784, failReason: 'collision' });
});

test('reversing collision input chooses the identical terminal pair', async () => {
  const run = async (reverse) => {
    const a = await setup(); const one = a.ship('one', 0, 0), two = a.ship('two', 28, 0), three = a.ship('three', -28, 0);
    const entries = [[one, 1], [two, 2], [three, 3]]; return a.system.step(a.candidates(...(reverse ? entries.reverse() : entries)), 0).terminalCollision;
  };
  assert.deepEqual(await run(true), await run(false));
});

test('collision candidate validation rejects duplicate active ship identities', async () => {
  const a = await setup(); const one = a.ship('one', 0, 0); assert.throws(() => a.system.step(a.candidates([one, 1], [one, 2]), 0), /Duplicate collision candidate ship/);
});

test('fixed 30 60 and 120 render partitions produce the same warning and collision sequence', async () => {
  const run = async (fps) => {
    const a = await setup(); const one = a.ship('one', 0, 0), two = a.ship('two', 100, 0); one.replaceRoute(new a.ships.ShipRoute([{ x: 200, y: 0 }])); const motor = new a.ships.ShipMotor(); const clock = new a.FixedStepClock({ fixedHz: 60, maxCatchUpSteps: 6 }); let terminal = null;
    for (let frame = 0; frame < fps * 2; frame += 1) clock.advance(1000 / fps, (dt) => { motor.stepRoute(one, 1, dt); const outcome = a.system.step(a.candidates([one, 1], [two, 2]), dt); if (outcome.terminalCollision !== null) terminal = outcome.terminalCollision; });
    flush(a); return { warning: a.received.warning, collision: a.received.collision, terminal };
  };
  const [at30, at60, at120] = await Promise.all([run(30), run(60), run(120)]); assert.deepEqual(at60, at30); assert.deepEqual(at120, at30); assert.equal(at30.collision.length, 1);
});

test('collision production code has no forbidden runtime or level-specific dependency', () => {
  const source = readFileSync('src/collision/CollisionSystem.ts', 'utf8');
  assert.doesNotMatch(source, /Math\.random|Phaser|Yandex|calm_01|exit_left|Math\.sqrt|\b700\b/);
});
