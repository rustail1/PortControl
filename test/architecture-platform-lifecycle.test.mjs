import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/scenes/HarborScene.ts', 'utf8');

test('AR-07 HarborScene does not own browser pause/focus lifecycle', () => {
  assert.doesNotMatch(source, /visibilitychange|addEventListener\('blur'|addEventListener\('focus'/);
});

test('AR-07 gameplay lifecycle restarts exactly through idempotent start/stop helpers', () => {
  assert.match(source, /#startGameplayLifecycle\(\): void/);
  assert.match(source, /#stopGameplayLifecycle\(\): void/);
  const startAttempt = source.slice(source.indexOf('#startAttempt(seed: number)'), source.indexOf('#markWorld<'));
  assert.match(startAttempt, /#startGameplayLifecycle\(\)/);
  assert.equal((source.match(/this\.#platform\.gameplayStart\(\)/g) ?? []).length, 1,
    'gameplayStart must be owned only by #startGameplayLifecycle');
  assert.equal((source.match(/this\.#platform\.gameplayStop\(\)/g) ?? []).length, 1,
    'gameplayStop must be owned only by #stopGameplayLifecycle');
  assert.match(source, /#startGameplayLifecycle\(\): void \{[\s\S]*?if \(this\.#platform === null \|\| this\.#gameplayRunning\) return;[\s\S]*?this\.#platform\.gameplayStart\(\);[\s\S]*?this\.#gameplayRunning = true;/);
  assert.match(source, /#stopGameplayLifecycle\(\): void \{[\s\S]*?if \(this\.#platform === null \|\| !this\.#gameplayRunning\) return;[\s\S]*?this\.#platform\.gameplayStop\(\);[\s\S]*?this\.#gameplayRunning = false;/);
});
