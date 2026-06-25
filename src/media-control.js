/**
 * Persistent PowerShell media daemon — instant fire-and-forget controls.
 */

const { spawn } = require('child_process');
const path = require('path');

const DAEMON_SCRIPT = path.join(__dirname, '..', 'scripts', 'media-daemon.ps1');
const PLAYBACK_SCRIPT = path.join(__dirname, '..', 'scripts', 'apple-music-playback.ps1');

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

function write(line) {
  startDaemon();
  if (!daemon?.stdin?.writable) {
    console.error('[media-daemon] stdin not ready');
    return;
  }
  daemon.stdin.write(`${line}\n`);
}

/**
 * @param {'toggle' | 'next' | 'previous' | 'shuffle' | 'repeat'} action
 * @param {(() => void)=} onComplete
 */
function send(action, onComplete) {
  if (action === 'shuffle' || action === 'repeat') {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-WindowStyle', 'Hidden',
        '-File', PLAYBACK_SCRIPT,
        action,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
    );
    child.stderr?.on('data', (data) => {
      console.error('[apple-music-playback]', data.toString().trim());
    });
    child.on('close', () => onComplete?.());
    return;
  }
  write(action);
  onComplete?.();
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
