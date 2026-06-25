/**
 * Windows SMTC media session wrapper.
 * Reads run in a worker thread; controls use a persistent PowerShell daemon.
 */

const path = require('path');
const { Worker } = require('worker_threads');
const mediaControl = require('./media-control');

/** @type {Worker | null} */
let worker = null;

/** @type {import('./types').MediaState} */
const IDLE_STATE = {
  active: false,
  title: 'Not playing',
  artist: '',
  album: '',
  albumArt: null,
  isPlaying: false,
  shuffleActive: false,
  repeatMode: 'off',
  sourceAppId: null,
};

/** @type {import('./types').MediaState} */
let latestState = IDLE_STATE;

/**
 * @param {number} intervalMs
 * @param {(state: import('./types').MediaState) => void} onUpdate
 * @returns {NodeJS.Timeout}
 */
function startSessionPolling(intervalMs, onUpdate) {
  worker = new Worker(path.join(__dirname, 'smtc-worker.js'));

  worker.on('message', (msg) => {
    if (msg?.type === 'state') {
      latestState = msg.state;
      onUpdate(msg.state);
    }
  });

  worker.on('error', (err) => {
    console.error('[media] worker error:', err.message);
  });

  const poll = () => worker?.postMessage({ type: 'poll' });
  poll();
  return setInterval(poll, intervalMs);
}

function stopSessionPolling(timer) {
  if (timer) clearInterval(timer);
  if (worker) {
    worker.terminate();
    worker = null;
  }
  mediaControl.shutdown();
}

function refreshSession() {
  worker?.postMessage({ type: 'poll' });
}

function getSession() {
  return latestState;
}

/**
 * @param {'toggle' | 'next' | 'previous' | 'shuffle' | 'repeat'} action
 */
function control(action) {
  mediaControl.send(action);
}

function warmControl() {
  mediaControl.warm();
}

module.exports = {
  getSession,
  control,
  startSessionPolling,
  stopSessionPolling,
  refreshSession,
  warmControl,
};
