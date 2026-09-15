import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('AR-10 ship route no longer depends on ShipModel for neutral point types', () => {
  const route = read('src/ships/ShipRoute.ts');
  assert.doesNotMatch(route, /from ['"]\.\/ShipModel\.ts['"]/);
  assert.match(route, /shared\/geometry\/Point\.ts/);
  assert.equal(existsSync('src/shared/geometry/Point.ts'), true);
});

test('AR-10 exact-authored runtime no longer exposes simplification or waypoint tolerance hooks', () => {
  const input = read('src/routes/RouteInputController.ts');
  const barrel = read('src/routes/index.ts');
  const motor = read('src/ships/ShipMotor.ts');
  const runtimeConfig = read('src/routes/RouteProcessingConfig.ts');
  assert.doesNotMatch(input, /SimplifyConfig|processing\?/);
  assert.doesNotMatch(barrel, /simplifyRoute|SimplifyConfig/);
  assert.doesNotMatch(motor, /waypointTolerance/);
  assert.doesNotMatch(runtimeConfig, /simplifyEpsilon|waypointTolerance|maxSimplifiedPoints/);
});

test('AR-10 dead bootstrap scene is removed and debug overlay is explicitly DEV-wired', () => {
  assert.equal(existsSync('src/scenes/BootstrapScene.ts'), false);
  const scene = read('src/scenes/HarborScene.ts');
  assert.match(scene, /DebugOverlay/);
  assert.match(scene, /import\.meta\.env\.DEV/);
});

test('AR-10 project map and staged machine contracts describe the actual module graph', () => {
  const map = read('PROJECT_MAP.md');
  const registry = read('src/config/MachineContractIdRegistry.ts');
  assert.doesNotMatch(map, /Bootstrap scene:/);
  assert.doesNotMatch(map, /- Simplification:/);
  assert.match(registry, /STAGED/i);
});
