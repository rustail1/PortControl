import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('v1.8 runtime uses harbor-assist terminology behind the Frozen Baseline adapter', () => {
  const runtimeConfig = read('src/config/RuntimeConfigRegistry.ts');
  const dockingConfig = read('src/docks/DockingConfig.ts');
  const dockingController = read('src/docks/DockingController.ts');
  const dockModel = read('src/docks/DockModel.ts');
  const dockFactory = read('src/docks/DockFactory.ts');
  const lifecycle = read('src/ships/ShipLifecycle.ts');
  const shipModel = read('src/ships/ShipModel.ts');
  const headingPresentation = read('src/presentation/ShipHeadingPresentation.ts');
  const harborScene = read('src/scenes/HarborScene.ts');
  const harborRuntime = read('src/runtime/HarborRuntime.ts');

  assert.doesNotMatch(runtimeConfig, /readonly baseSnapDurationMs|readonly collisionEnabledUntilSnapComplete/);
  assert.match(runtimeConfig, /collisionEnabledDuringHarborAssist:\s*requireBoolean\(docking, 'collisionEnabledUntilSnapComplete'/);
  assert.match(runtimeConfig, /requireNumber\(docking, 'baseSnapDurationMs'/);
  assert.match(dockingConfig, /collisionEnabledDuringHarborAssist/);
  assert.doesNotMatch(dockingController, /collisionEnabledUntilSnapComplete|\.snapRadius/);
  assert.doesNotMatch(dockModel, /snapRadius/);
  assert.match(dockFactory, /approachRadius:\s*block\.props\.snapRadius/,
    'Frozen level key may exist only at the factory mapping boundary');
  assert.doesNotMatch(lifecycle, /dock_snap_/);
  assert.doesNotMatch(shipModel, /dock_snap_/);
  assert.doesNotMatch(headingPresentation, /readonly snap:|snap:\s*true/);
  assert.doesNotMatch(harborScene, /heading\.snap/);
  assert.doesNotMatch(headingPresentation, /resolveShipVisualHeading|ShipVisualHeading/);
  assert.doesNotMatch(harborScene, /resolveShipVisualHeading/);
  assert.match(dockingController, /departurePresentationPrefix/);
  assert.match(harborRuntime, /departurePresentationPrefix/);
});

test('obsolete route simplifier implementation is removed after exact-authored migration', () => {
  const simplifierUrl = new URL('../src/routes/RouteSimplifier.ts', import.meta.url);
  const projectMap = read('PROJECT_MAP.md');
  assert.equal(existsSync(simplifierUrl), false);
  assert.doesNotMatch(projectMap, /RouteSimplifier\.ts|Legacy simplifier/);
});
