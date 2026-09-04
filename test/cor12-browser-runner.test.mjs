import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
let runner = {};
try {
  runner = require('./browser/browser-runner.cjs');
} catch {}

test('COR-12 RUNNER #01 launches local Vite CLI directly on Windows', () => {
  assert.equal(typeof runner.buildViteLaunch, 'function');
  assert.deepEqual(
    runner.buildViteLaunch({
      platform: 'win32',
      processExecPath: 'C:\\node\\node.exe',
      viteCliPath: 'C:\\repo\\node_modules\\vite\\bin\\vite.js',
      host: '127.0.0.1',
      port: 4173,
    }),
    {
      command: 'C:\\node\\node.exe',
      args: [
        'C:\\repo\\node_modules\\vite\\bin\\vite.js',
        '--host',
        '127.0.0.1',
        '--port',
        '4173',
        '--strictPort',
      ],
      detached: false,
    },
  );
});

test('COR-12 RUNNER #02 uses an owned process group on Linux', () => {
  assert.equal(typeof runner.buildViteLaunch, 'function');
  const launch = runner.buildViteLaunch({
    platform: 'linux',
    processExecPath: '/usr/bin/node',
    viteCliPath: '/repo/node_modules/vite/bin/vite.js',
    host: '127.0.0.1',
    port: 4173,
  });

  assert.equal(launch.command, '/usr/bin/node');
  assert.equal(launch.args[0], '/repo/node_modules/vite/bin/vite.js');
  assert.equal(launch.detached, true);
  assert.equal(launch.args.includes('npm'), false);
});

test('COR-12 RUNNER #03 cleanup waits until its direct child exits', async () => {
  assert.equal(typeof runner.terminateOwnedProcess, 'function');
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });

  await runner.terminateOwnedProcess(child, { graceMs: 1500, forceMs: 1500 });

  assert.notEqual(child.exitCode ?? child.signalCode, null);
});
