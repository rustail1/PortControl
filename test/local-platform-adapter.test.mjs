import assert from 'node:assert/strict';
import test from 'node:test';

async function loadSubject() {
  try {
    return await import('../src/platform/LocalPlatformAdapter.ts');
  } catch (error) {
    assert.fail(`LocalPlatformAdapter is unavailable: ${String(error)}`);
  }
}

test('initializes with a stable local result and needs no Yandex global', async () => {
  const { LocalPlatformAdapter } = await loadSubject();
  assert.equal('YaGames' in globalThis, false);
  const adapter = new LocalPlatformAdapter();

  assert.deepEqual(await adapter.init(), { status: 'ready', mode: 'local' });
  await adapter.gameReady();
  adapter.gameplayStart();
  adapter.gameplayStop();
  adapter.track('local_test', { value: 1 });
});

test('pause and resume subscriptions are idempotent and unsubscribe cleanly', async () => {
  const { LocalPlatformAdapter } = await loadSubject();
  const adapter = new LocalPlatformAdapter();
  let pauses = 0;
  let resumes = 0;
  const unsubscribePause = adapter.onPause(() => {
    pauses += 1;
  });
  const unsubscribeResume = adapter.onResume(() => {
    resumes += 1;
  });

  adapter.simulatePause();
  adapter.simulatePause();
  adapter.simulateResume();
  adapter.simulateResume();
  assert.deepEqual({ pauses, resumes }, { pauses: 1, resumes: 1 });

  unsubscribePause();
  unsubscribePause();
  unsubscribeResume();
  adapter.simulatePause();
  adapter.simulateResume();
  assert.deepEqual({ pauses, resumes }, { pauses: 1, resumes: 1 });
});

test('local ads return typed unavailable results without imitating an ad', async () => {
  const { LocalPlatformAdapter } = await loadSubject();
  const adapter = new LocalPlatformAdapter();

  assert.deepEqual(await adapter.showInterstitial(), { status: 'unavailable' });
  assert.deepEqual(await adapter.showRewarded('rewind'), {
    status: 'unavailable',
  });
});

test('local profile save is available and isolates stored data from callers', async () => {
  const { LocalPlatformAdapter } = await loadSubject();
  const adapter = new LocalPlatformAdapter();
  const profile = { schemaVersion: 1, revision: 3, nested: { coins: 25 } };

  assert.deepEqual(await adapter.loadProfile(), null);
  assert.deepEqual(await adapter.saveProfile(profile, true), {
    status: 'saved',
    storage: 'local',
  });
  profile.nested.coins = 999;

  const loaded = await adapter.loadProfile();
  assert.deepEqual(loaded, {
    schemaVersion: 1,
    revision: 3,
    nested: { coins: 25 },
  });
  loaded.nested.coins = 500;
  assert.equal((await adapter.loadProfile()).nested.coins, 25);
});

test('local auth always preserves guest play', async () => {
  const { LocalPlatformAdapter } = await loadSubject();
  const adapter = new LocalPlatformAdapter();

  assert.deepEqual(await adapter.getAuthState(), { status: 'guest' });
  assert.deepEqual(await adapter.requestAuth(), {
    status: 'unavailable',
    authState: { status: 'guest' },
  });
});

test('remote flags use an isolated copy of the bundled fallback', async () => {
  const { LocalPlatformAdapter } = await loadSubject();
  const adapter = new LocalPlatformAdapter();
  const defaults = {
    experimentalHarbor: false,
    rolloutPercent: 0,
    label: 'bundled',
  };

  const flags = await adapter.loadRemoteFlags(defaults);

  assert.deepEqual(flags, defaults);
  assert.notEqual(flags, defaults);
});
