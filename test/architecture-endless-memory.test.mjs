import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { IncomingSpawnSystem } from '../src/spawning/IncomingSpawnSystem.ts';
import { ExitSystem } from '../src/exits/ExitSystem.ts';

test('AR-09 incoming spawn system retains only active/pending transactions', () => {
  const system = new IncomingSpawnSystem();
  const spawnPoint = { id: 'spawn-a', x: 10, y: 20, directionDeg: 0 };
  for (let index = 0; index < 2000; index += 1) {
    const transactionId = `tx-${index}`;
    const scheduled = system.schedule({
      transactionId,
      spawnPoint,
      payload: { shipId: `ship-${index}`, shipType: 'speedboat', cargo: { general: 1 }, spawnSequence: index },
      leadTimeSeconds: 1,
    });
    assert.equal(scheduled.ok, true);
    system.consumeIndicatorCommands();
    assert.equal(system.cancel(transactionId).ok, true);
  }
  const snapshot = system.toSnapshot();
  assert.equal(system.pendingCount, 0);
  assert.deepEqual(snapshot.transactions, []);
  assert.deepEqual(snapshot.indicatorCommands, []);
  assert.deepEqual(snapshot.readyCommands, []);
  assert.equal(system.getSpawnPointOwner('spawn-a'), null);
});

test('AR-09 ExitSystem forgetShip removes all historical per-ship bookkeeping', () => {
  const system = new ExitSystem({ zones: [], worldBounds: { width: 1000, height: 1000 }, score: 20 });
  const ids = Array.from({ length: 2000 }, (_, index) => `ship-${index}`);
  system.restore({
    pendingShipIds: [],
    done: ids,
    insideCargo: ids,
    enteringThroughExit: ids,
    untouchedEnteredWorld: ids,
    untouchedReturned: ids,
    insideUntouchedBoundary: ids,
  }, () => null);
  for (const id of ids) system.forgetShip(id);
  assert.deepEqual(system.toSnapshot(), {
    pendingShipIds: [],
    done: [],
    insideCargo: [],
    enteringThroughExit: [],
    untouchedEnteredWorld: [],
    untouchedReturned: [],
    insideUntouchedBoundary: [],
  });
});

test('AR-09 production cleanup hooks exist for ship-scoped caches', () => {
  for (const file of [
    'src/collision/CollisionSystem.ts',
    'src/docks/DockingController.ts',
    'src/exits/ExitSystem.ts',
  ]) {
    assert.match(readFileSync(file, 'utf8'), /forgetShip\(shipId: string\)/, `${file} must expose explicit cleanup`);
  }
  assert.doesNotMatch(readFileSync('src/spawning/IncomingSpawnSystem.ts', 'utf8'), /knownTransactionIds/);
});
