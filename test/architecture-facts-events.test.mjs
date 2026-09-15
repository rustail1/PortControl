import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const systemFiles = [
  'src/collision/CollisionSystem.ts',
  'src/docks/CargoSystem.ts',
  'src/exits/ExitSystem.ts',
];

test('AR-08 systems return facts and do not independently emit authoritative gameplay events', () => {
  for (const file of systemFiles) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /\.emit\('(danger_warning|collision|cargo_unloaded|ship_exited)'/);
    assert.doesNotMatch(source, /DomainEventQueue/);
    assert.doesNotMatch(source, /readonly #events/);
  }
});
