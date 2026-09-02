import assert from 'node:assert/strict';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

async function assertInvalid(mutator, expectedIssue) {
  const { ConfigValidationError, validateConfigSource } = await import(
    '../src/config/validateConfigSource.ts'
  );
  const source = structuredClone(readBaselineSource());
  mutator(source);

  assert.throws(
    () => validateConfigSource(source),
    (error) =>
      error instanceof ConfigValidationError &&
      error.issues.some((issue) => issue.includes(expectedIssue)),
    `Expected issue containing: ${expectedIssue}`,
  );
}

test('rejects an unknown Release 1.0 feature key', async () => {
  await assertInvalid((source) => {
    source.configs['platform.json'].releaseFeatures.unknownFeature = true;
  }, 'platform.json: schema');
});

test('rejects a platform auth level reference outside the campaign contract', async () => {
  await assertInvalid((source) => {
    source.configs['platform.json'].auth.unlockAfterLevel = 'unknown_level';
  }, 'platform: unknown auth unlock level unknown_level');
});

test('rejects an analytics event parameter missing from the parameter contract', async () => {
  await assertInvalid((source) => {
    source.configs['analytics_events.json'].events.level_start.required.push(
      'unknown_parameter',
    );
  }, 'analytics: level_start references unknown parameter unknown_parameter');
});

test('rejects an unknown screen transition target', async () => {
  await assertInvalid((source) => {
    source.configs['screen_flow.json'].transitions[0].to = 'unknown_screen';
  }, 'screen_flow: transition boot/ready references unknown to screen unknown_screen');
});

test('rejects an unknown screen owner reference', async () => {
  await assertInvalid((source) => {
    source.configs['screen_flow.json'].screens.pause.owner = 'unknown_screen';
  }, 'screen_flow: pause references unknown owner screen unknown_screen');
});

test('rejects an unknown audio machine reference', async () => {
  await assertInvalid((source) => {
    source.configs['audio.json'].assets.ship_select.path =
      'assets/audio/ship_select.wav';
  }, 'audio: ship_select path extension wav is not in formatPreference');
});
