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
    shuffleActive: false,
    repeatMode: 'off',
    sourceAppId: session.sourceAppId ?? null,
  };
}

function fetchSession() {
  try {
    const sessions = SMTCMonitor.getMediaSessions?.() ?? [];
    const apple = sessions.find((s) => isAppleMusicSession(s.sourceAppId));
    if (apple) return normalizeSession(apple);
    return normalizeSession(SMTCMonitor.getCurrentMediaSession?.() ?? null);
  } catch (err) {
    return normalizeSession(null);
  }
}

parentPort.on('message', (msg) => {
  if (msg?.type === 'poll') {
    parentPort.postMessage({ type: 'state', state: fetchSession() });
  }
});

parentPort.postMessage({ type: 'state', state: fetchSession() });
