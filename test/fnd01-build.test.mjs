import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('production entry point builds into a browser-loadable module', () => {
  const projectRoot = resolve(import.meta.dirname, '..');
  const outputDirectory = join(projectRoot, '.fnd01-test-dist');
  const viteExecutable = join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');

  rmSync(outputDirectory, { force: true, recursive: true });

  try {
    const result = spawnSync(
      process.execPath,
      [viteExecutable, 'build', '--outDir', outputDirectory, '--emptyOutDir'],
      { cwd: projectRoot, encoding: 'utf8' },
    );

    assert.equal(
      result.error,
      undefined,
      result.error?.message ?? 'Vite could not be started',
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const builtHtmlPath = join(outputDirectory, 'index.html');
    assert.equal(existsSync(builtHtmlPath), true, 'Vite did not emit index.html');

    const builtHtml = readFileSync(builtHtmlPath, 'utf8');
    const moduleSource = builtHtml.match(
      /<script[^>]+type="module"[^>]+src="([^"]+)"/,
    )?.[1];

    assert.ok(moduleSource, 'Built HTML does not load a JavaScript module');
    assert.equal(
      existsSync(join(outputDirectory, moduleSource.replace(/^\//, ''))),
      true,
      'Built JavaScript entry point is missing',
    );
  } finally {
    rmSync(outputDirectory, { force: true, recursive: true });
  }
});
