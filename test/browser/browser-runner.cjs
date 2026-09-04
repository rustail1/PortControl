const { spawn } = require('node:child_process');
const path = require('node:path');

function resolveViteCliPath() {
  return path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
}

function buildViteLaunch({
  platform = process.platform,
  processExecPath = process.execPath,
  viteCliPath = resolveViteCliPath(),
  host,
  port,
}) {
  return {
    command: processExecPath,
    args: [
      viteCliPath,
      '--host',
      host,
      '--port',
      String(port),
      '--strictPort',
    ],
    detached: platform !== 'win32',
  };
}

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child, timeoutMs) {
  if (hasExited(child)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.off('close', onClose);
      child.off('error', onError);
    };
    const onClose = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Process did not exit within ${timeoutMs} ms`));
    }, timeoutMs);
    child.once('close', onClose);
    child.once('error', onError);
  });
}

function signalOwnedProcess(child, signal) {
  if (hasExited(child) || child.pid === undefined) return;
  if (process.platform !== 'win32' && child.spawnargs.length > 0) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
      return;
    }
  }
  child.kill(signal);
}

function forceKillWindowsTree(pid) {
  return new Promise((resolve) => {
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.once('error', resolve);
    killer.once('close', resolve);
  });
}

async function terminateOwnedProcess(
  child,
  { graceMs = 2000, forceMs = 2000 } = {},
) {
  if (hasExited(child)) return;
  const pid = child.pid;
  signalOwnedProcess(child, 'SIGTERM');
  try {
    await waitForExit(child, graceMs);
    return;
  } catch (error) {
    if (!String(error).includes('did not exit within')) throw error;
  }

  if (pid !== undefined && process.platform === 'win32') {
    await forceKillWindowsTree(pid);
  } else {
    signalOwnedProcess(child, 'SIGKILL');
  }
  await waitForExit(child, forceMs);
}

module.exports = {
  buildViteLaunch,
  resolveViteCliPath,
  terminateOwnedProcess,
  waitForExit,
};
