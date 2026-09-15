import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('AR-06 HarborRuntime consumes typed runtime registries instead of raw bundle config casts', () => {
  const runtime = read('src/runtime/HarborRuntime.ts');
  assert.match(runtime, /RuntimeConfigRegistry/);
  assert.match(runtime, /toLevelDefinition/);
  assert.doesNotMatch(runtime, /bundle\.configs/);
  assert.doesNotMatch(runtime, /as unknown as/);
});

test('AR-06 capability gate is block-derived and explicit', () => {
  const capabilities = read('src/config/RuntimeCapabilities.ts');
  assert.match(capabilities, /current_zone:\s*'current-zone'/);
  assert.match(capabilities, /storm_path:\s*'storm-path'/);
  assert.match(capabilities, /fog_zone:\s*'fog-zone'/);
  assert.match(capabilities, /Unsupported level capabilities/);
});

test('AR-06 runtime config adapters consume typed registry/level definitions without unknown double casts', () => {
  for (const file of [
    'src/routes/RouteProcessingConfig.ts',
    'src/routes/RouteSamplingConfig.ts',
    'src/docks/DockingConfig.ts',
    'src/spawning/SpawnDirector.ts',
    'src/ships/ShipCharacteristics.ts',
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /as unknown as/, `${file} must not re-cast validated runtime config through unknown`);
  }
});
