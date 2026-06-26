/**
 * Worker thread for SMTC reads — native calls must not block the main process.
 */
'use strict';

const { parentPort } = require('worker_threads');
const { SMTCMonitor } = require('@coooookies/windows-smtc-monitor');

const PlaybackStatus = {
  Closed: 0,
  Opened: 1,
  Changing: 2,
  Stopped: 3,
  Playing: 4,
  Paused: 5,
};

const APPLE_PATTERNS = [/appleinc/i, /applemusic/i, /music\.exe/i];

/** @type {import('@coooookies/windows-smtc-monitor').SMTCMonitor} */
const monitor = new SMTCMonitor();

function isAppleMusicSession(appId) {
  if (!appId) return false;
  return APPLE_PATTERNS.some((re) => re.test(appId));
}

function thumbnailToDataUrl(thumbnail) {
  if (!thumbnail || !thumbnail.length) return null;
  let mime = 'image/png';
  if (thumbnail[0] === 0xff && thumbnail[1] === 0xd8) mime = 'image/jpeg';
  else if (thumbnail.slice(0, 4).toString('ascii') === 'RIFF') mime = 'image/webp';
  return `data:${mime};base64,${thumbnail.toString('base64')}`;
}

function normalizeSession(session) {
  if (!session) {
    return {
      active: false,
      title: 'Not playing',
      artist: '',
      album: '',
      albumArt: null,
      isPlaying: false,
      trackNumber: 0,
      duration: 0,
      shuffleActive: false,
      repeatMode: 'off',
      sourceAppId: null,
    };
  }

  const status = session.playback?.playbackStatus ?? PlaybackStatus.Closed;
  return {
    active: true,
    title: session.media?.title || 'Unknown track',
    artist: session.media?.artist || session.media?.albumArtist || '',
    album: session.media?.albumTitle || '',
    albumArt: thumbnailToDataUrl(session.media?.thumbnail),
    isPlaying: status === PlaybackStatus.Playing,
    trackNumber: session.media?.trackNumber ?? 0,
    duration: session.timeline?.duration ?? 0,
    shuffleActive: false,
    repeatMode: 'off',
    sourceAppId: session.sourceAppId ?? null,
  };
}

function pickSession() {
  const monitorApple = monitor.sessions.find((s) => isAppleMusicSession(s.sourceAppId));
  const fresh = SMTCMonitor.getMediaSessions?.() ?? [];
  const freshApple = fresh.find((s) => isAppleMusicSession(s.sourceAppId));

  const thumbLen = (s) => s?.media?.thumbnail?.length ?? 0;
  if (thumbLen(freshApple) >= thumbLen(monitorApple)) return freshApple ?? monitorApple;
  return monitorApple ?? freshApple ?? SMTCMonitor.getCurrentMediaSession?.() ?? null;
}

function fetchSession() {
  try {
    return normalizeSession(pickSession());
  } catch {
    return normalizeSession(null);
  }
}

let emitTimer = null;

function emitState() {
  parentPort.postMessage({ type: 'state', state: fetchSession() });
}

function scheduleEmit() {
  clearTimeout(emitTimer);
  emitTimer = setTimeout(emitState, 40);
}

for (const event of [
  'session-media-changed',
  'current-session-changed',
  'session-added',
  'session-removed',
  'session-playback-changed',
]) {
  monitor.on(event, scheduleEmit);
}

parentPort.on('message', (msg) => {
  if (msg?.type === 'poll') emitState();
});

emitState();
