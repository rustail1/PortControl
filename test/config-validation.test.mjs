import assert from 'node:assert/strict';
import test from 'node:test';

import { readBaselineSource } from './support/readBaselineSource.mjs';

async function loadSubject() {
  try {
    return await import('../src/config/validateConfigSource.ts');
  } catch (error) {
    assert.fail(`Config validation module is unavailable: ${String(error)}`);
  }
}

async function assertInvalid(source, expectedIssue) {
  const { ConfigValidationError, validateConfigSource } = await loadSubject();

  assert.throws(
    () => validateConfigSource(source),
    (error) =>
      error instanceof ConfigValidationError &&
      error.issues.some((issue) => issue.includes(expectedIssue)),
  );
}

async function assertSemanticInvalid(source, expectedIssue) {
  const { validateSemanticConfig } = await import(
    '../src/config/semanticValidation.ts'
  );
  const issues = validateSemanticConfig(source.configs);

  assert.ok(
    issues.some((issue) => issue.includes(expectedIssue)),
    `Expected semantic issue containing "${expectedIssue}", got:\n${issues.join('\n')}`,
  );
}

test('loads the frozen bundle after all schema and semantic gates pass', async () => {
  const { validateConfigSource } = await loadSubject();

  const bundle = validateConfigSource(readBaselineSource());

  assert.equal(Object.keys(bundle.levels).length, 40);
  assert.equal(bundle.configs['balance.json'].version, 1);
});

test('rejects an unknown property through strict JSON Schema validation', async () => {
  const source = structuredClone(readBaselineSource());
  source.configs['ships.json'].unexpected = true;

  await assertInvalid(source, 'ships.json: schema');
});

test('rejects a bundled config that has no schema assignment', async () => {
  const source = structuredClone(readBaselineSource());
  source.configs['unassigned.json'] = { version: 1 };

  await assertInvalid(source, 'unassigned.json: no schema assignment');
});

test('rejects director interval and wave ordering violations', async () => {
  const source = structuredClone(readBaselineSource());
  const level = source.configs['levels/calm_01.json'];
  level.director.startInterval = level.director.minimumInterval - 1;
  level.director.wave.burstMax = level.director.wave.burstMin - 1;

  await assertInvalid(source, 'startInterval < minimumInterval');
  await assertInvalid(source, 'burstMax < burstMin');
});

test('rejects localization key-set differences', async () => {
  const source = structuredClone(readBaselineSource());
  delete source.configs['localization/en.json'].strings['ui.play'];

  await assertSemanticInvalid(source, 'localization key parity mismatch');
});

test('rejects duplicate block identifiers', async () => {
  const source = structuredClone(readBaselineSource());
  const blocks = source.configs['levels/calm_01.json'].layout.blocks;
  blocks[1].id = blocks[0].id;

  await assertInvalid(source, 'duplicate block IDs');
});

test('rejects polygon winding that is not visual-clockwise', async () => {
  const source = structuredClone(readBaselineSource());
  const polygon = source.configs['levels/calm_01.json'].layout.blocks.find(
    (block) => block.blockType === 'shore_polygon',
  );
  polygon.props.points.reverse();

  await assertSemanticInvalid(source, 'polygon must be visual-clockwise');
});

test('rejects self-intersecting polygons', async () => {
  const source = structuredClone(readBaselineSource());
  const polygon = source.configs['levels/calm_01.json'].layout.blocks.find(
    (block) => block.blockType === 'shore_polygon',
  );
  polygon.props.points = [
    [0, 0],
    [10, 10],
    [0, 10],
    [10, 0],
  ];
  polygon.x = 5;
  polygon.y = 5;

  await assertSemanticInvalid(source, 'self-intersecting polygon');
});

test('rejects rectangle extents outside the configured logical world', async () => {
  const source = structuredClone(readBaselineSource());
  const exit = source.configs['levels/calm_01.json'].layout.blocks.find(
    (block) => block.blockType === 'exit_zone',
  );
  exit.x = 10;

  await assertSemanticInvalid(source, 'rect extents outside world');
});
