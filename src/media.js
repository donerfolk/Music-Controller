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

/** @type {((state: import('./types').MediaState) => void) | null} */
let onUpdateCallback = null;
/** @type {((albumArt: string) => void) | null} */
let onArtCallback = null;
let pollIntervalMs = 1000;
let lastWorkerArtFp = '';

function artFingerprint(art) {
  let h = 5381;
  for (let i = 0; i < art.length; i++) {
    h = ((h << 5) + h + art.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

function spawnWorker() {
  if (worker) worker.terminate();
  worker = new Worker(path.join(__dirname, 'smtc-worker.js'));
  worker.on('message', (msg) => {
    if (msg?.type !== 'state') return;
    latestState = msg.state;
    onUpdateCallback?.(msg.state);
    const art = msg.state.albumArt;
    if (!art) return;
    const fp = artFingerprint(art);
    if (fp === lastWorkerArtFp) return;
    lastWorkerArtFp = fp;
    onArtCallback?.(art);
  });
  worker.on('error', (err) => {
    console.error('[media] worker error:', err.message);
  });
}

/**
 * @param {number} intervalMs
 * @param {(state: import('./types').MediaState) => void} onUpdate
 * @param {(albumArt: string) => void} [onArt]
 * @returns {NodeJS.Timeout}
 */
function startSessionPolling(intervalMs, onUpdate, onArt) {
  pollIntervalMs = intervalMs;
  onUpdateCallback = onUpdate;
  onArtCallback = onArt ?? null;
  lastWorkerArtFp = '';
  spawnWorker();
  worker.postMessage({ type: 'poll' });
  return setInterval(() => worker?.postMessage({ type: 'poll' }), intervalMs);
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

function forceRefreshSession() {
  lastWorkerArtFp = '';
  refreshSession();
}

function getSession() {
  return latestState;
}

/**
 * @param {'toggle' | 'next' | 'previous' | 'shuffle' | 'repeat'} action
 * @param {(() => void)=} onComplete
 */
function control(action, onComplete) {
  mediaControl.send(action, onComplete);
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
  forceRefreshSession,
  warmControl,
};
