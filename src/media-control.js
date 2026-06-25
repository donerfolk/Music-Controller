/**
 * Persistent PowerShell media daemon — instant fire-and-forget controls.
 */

const { spawn } = require('child_process');
const path = require('path');

const DAEMON_SCRIPT = path.join(__dirname, '..', 'scripts', 'media-daemon.ps1');

/** @type {import('child_process').ChildProcess | null} */
let daemon = null;

function startDaemon() {
  if (daemon) return;

  daemon = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', DAEMON_SCRIPT],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );

  daemon.stderr?.on('data', (data) => {
    console.error('[media-daemon]', data.toString().trim());
  });

  daemon.on('exit', () => {
    daemon = null;
  });

  daemon.on('error', (err) => {
    console.error('[media-daemon] error:', err.message);
    daemon = null;
  });
}

/**
 * @param {'toggle' | 'next' | 'previous'} action
 */
function send(action) {
  startDaemon();
  if (!daemon?.stdin?.writable) {
    console.error('[media-daemon] stdin not ready');
    return;
  }
  daemon.stdin.write(`${action}\n`);
}

function warm() {
  startDaemon();
}

function shutdown() {
  if (daemon) {
    daemon.kill();
    daemon = null;
  }
}

module.exports = { send, warm, shutdown };
