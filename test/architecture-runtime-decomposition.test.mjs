import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) { return readFileSync(path, 'utf8'); }

test('AR-04 active-ship candidate bookkeeping lives outside HarborRuntime', () => {
  const registry = read('src/runtime/HarborShipRegistry.ts');
  const runtime = read('src/runtime/HarborRuntime.ts');
  assert.match(registry, /export class HarborShipRegistry/);
  assert.doesNotMatch(runtime, /#collisionCandidates|#groundingCandidates|#dockCandidates|#cargoCandidates|#exitShips|#spawnCandidates/);
  assert.doesNotMatch(runtime, /#buildCollisionCandidates|#buildGroundingCandidates|#buildDockCandidates|#buildCargoCandidates|#buildExitShips|#snapshotPreviousPoses/);
});

test('AR-04 route command orchestration lives outside HarborRuntime', () => {
  const coordinator = read('src/runtime/HarborRouteCoordinator.ts');
  const runtime = read('src/runtime/HarborRuntime.ts');
  assert.match(coordinator, /export class HarborRouteCoordinator/);
  assert.doesNotMatch(runtime, /#applyQueuedRoutes|#applyLiveRouteDraft|#commitRouteDraft|#routeCommitIsDeferred/);
});

test('AR-04 spawn orchestration lives outside HarborRuntime', () => {
  const coordinator = read('src/runtime/HarborSpawnCoordinator.ts');
  const runtime = read('src/runtime/HarborRuntime.ts');
  assert.match(coordinator, /export class HarborSpawnCoordinator/);
  assert.doesNotMatch(runtime, /#spawnPhase|#resolveReadySpawns|#createDirectorInput/);
});
