import assert from 'node:assert/strict';
import test from 'node:test';

async function loadSubject() {
  try {
    const [events, debug] = await Promise.all([
      import('../src/core/DomainEventQueue.ts'),
      import('../src/debug/DebugOverlay.ts'),
    ]);
    return { ...events, ...debug };
  } catch (error) {
    assert.fail(`FND-06 infrastructure is unavailable: ${String(error)}`);
  }
}

test('typed event queue delivers emitted events to their typed subscribers', async () => {
  const { DomainEventQueue } = await loadSubject();
  const events = new DomainEventQueue();
  const received = [];
  events.subscribe('shipSpawned', (event) => received.push(event.shipId));

  events.emit('shipSpawned', { shipId: 'ship_7' });
  events.flush();

  assert.deepEqual(received, ['ship_7']);
});

test('unsubscribe prevents any later delivery', async () => {
  const { DomainEventQueue } = await loadSubject();
  const events = new DomainEventQueue();
  let deliveries = 0;
  const unsubscribe = events.subscribe('dangerRaised', () => {
    deliveries += 1;
  });

  events.emit('dangerRaised', { pairId: '1:2' });
  events.flush();
  unsubscribe();
  unsubscribe();
  events.emit('dangerRaised', { pairId: '3:4' });
  events.flush();

  assert.equal(deliveries, 1);
});

test('event delivery preserves emit order and subscription order', async () => {
  const { DomainEventQueue } = await loadSubject();
  const events = new DomainEventQueue();
  const received = [];
  events.subscribe('tick', (event) => received.push(`first:${event.id}`));
  events.subscribe('tick', (event) => received.push(`second:${event.id}`));

  events.emit('tick', { id: 'a' });
  events.emit('tick', { id: 'b' });
  events.flush();

  assert.deepEqual(received, [
    'first:a',
    'second:a',
    'first:b',
    'second:b',
  ]);
});

test('events emitted while flushing wait for the next explicit flush', async () => {
  const { DomainEventQueue } = await loadSubject();
  const events = new DomainEventQueue();
  const received = [];
  events.subscribe('first', () => {
    received.push('first');
    events.emit('second', { source: 'listener' });
  });
  events.subscribe('second', (event) => received.push(event.source));

  events.emit('first', {});
  events.flush();
  assert.deepEqual(received, ['first']);
  events.flush();
  assert.deepEqual(received, ['first', 'listener']);
});

test('separate event queues do not share singleton state', async () => {
  const { DomainEventQueue } = await loadSubject();
  const left = new DomainEventQueue();
  const right = new DomainEventQueue();
  const received = [];
  left.subscribe('changed', (event) => received.push(`left:${event.value}`));
  right.subscribe('changed', (event) => received.push(`right:${event.value}`));

  left.emit('changed', { value: 1 });
  left.flush();

  assert.deepEqual(received, ['left:1']);
  assert.equal(right.pendingCount, 0);
});

test('debug presenter reads a typed provider snapshot', async () => {
  const { formatDebugSnapshot } = await loadSubject();
  const provider = {
    getDebugSnapshot() {
      return {
        sessionState: 'active',
        seed: 73,
        rngState: [12_345],
        pressure: 1.5,
      };
    },
  };

  assert.equal(
    formatDebugSnapshot(provider.getDebugSnapshot()),
    'session: active\nseed: 73\nrng: [12345]\npressure: 1.5',
  );
});

test('debug presenter makes unavailable future-system values explicit', async () => {
  const { unavailableDebugSnapshot, formatDebugSnapshot } = await loadSubject();

  assert.equal(
    formatDebugSnapshot(unavailableDebugSnapshot),
    'session: unavailable\nseed: unavailable\nrng: unavailable\npressure: unavailable',
  );
});
