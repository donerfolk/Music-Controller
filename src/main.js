/**
 * Electron main process — tray app, popover window, media polling.
 */

const path = require('path');
const { app, BrowserWindow, screen, ipcMain } = require('electron');
const { createTray, destroyTray, setTrayIconState, getTrayBounds, refreshTrayMenu } = require('./tray');
const { getBackgroundTheme, setBackgroundTheme } = require('./theme');
const { getSession, control, startSessionPolling, stopSessionPolling, refreshSession, forceRefreshSession, warmControl } = require('./media');
const { getVolumeState, setVolume, setVolumeLive, adjustVolume, setMuted, warmVolume, shutdown: shutdownVolume } = require('./volume');

const WINDOW_WIDTH = 408;
const WINDOW_HEIGHT = 248;
// Room for box-shadow glow + transparent outside-click margin around the card.
const POPOVER_INSET = 40;
const POLL_INTERVAL_MS = 1000;
const CLOSE_TIMEOUT_MS = 400;
const BLUR_GUARD_MS = 600;
// ponytail: was 12s, which locked out outside-close for the whole track-change
// refresh window. 800ms survives the skip command's transient focus shift
// (refocusPopover re-grabs focus right after); the scheduled refreshes at
// 200/500/1000/1800/3000ms only re-broadcast state, they don't need the guard.
const PLAYBACK_BLUR_GUARD_MS = 800;
/** @type {BrowserWindow | null} */
let popover = null;
/** @type {Electron.Rectangle} */
let cardLayout = { x: 0, y: 0, width: WINDOW_WIDTH, height: WINDOW_HEIGHT };
/** @type {{ bounds: Electron.Rectangle, position: Electron.Point } | null} */
let clickAnchor = null;
/** @type {NodeJS.Timeout | null} */
let pollTimer = null;
/** @type {NodeJS.Timeout | null} */
let closeTimer = null;
let isClosing = false;
let ignoreBlurUntil = 0;
/** @type {NodeJS.Timeout | null} */
let openGuardTimer = null;
let blurDuringOpenGuard = false;
let lastStateKey = '';
let lastBroadcastArtFp = '';

// Tray apps should keep running when the popover is hidden.
app.isQuitting = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    openPopover();
  });
}

function artFingerprint(art) {
  let h = 5381;
  for (let i = 0; i < art.length; i++) {
    h = ((h << 5) + h + art.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

function stateKey(state) {
  return JSON.stringify({
    active: state.active,
    title: state.title,
    artist: state.artist,
    album: state.album,
    trackNumber: state.trackNumber ?? 0,
    duration: state.duration ?? 0,
    isPlaying: state.isPlaying,
    shuffleActive: state.shuffleActive,
    repeatMode: state.repeatMode,
    artFp: state.albumArt ? artFingerprint(state.albumArt) : '',
  });
}

function broadcastState(state) {
  const key = stateKey(state);
  if (key === lastStateKey) return;
  lastStateKey = key;

  setTrayIconState(state.isPlaying);
  if (popover && !popover.isDestroyed()) {
    popover.webContents.send('media:update', state);
  }
}

function nudgeSessionRefresh() {
  lastStateKey = '';
  refreshSession();
}

function broadcastArt(albumArt) {
  if (!albumArt) return;
  const fp = artFingerprint(albumArt);
  if (fp === lastBroadcastArtFp) return;
  lastBroadcastArtFp = fp;
  if (popover && !popover.isDestroyed()) {
    popover.webContents.send('media:art', albumArt);
  }
}

function nudgeForceRefresh() {
  lastStateKey = '';
  lastBroadcastArtFp = '';
  forceRefreshSession();
}

/**
 * Position the popover just above the tray icon, clamped to the display work area.
 */
function positionPopover() {
  if (!popover) return;

  const trayBounds = clickAnchor?.bounds ?? getTrayBounds();
  const clickPoint = clickAnchor?.position;
  const hasTrayBounds = trayBounds.width > 0 && trayBounds.height > 0;
  const hasClickPoint = clickPoint && (clickPoint.x > 0 || clickPoint.y > 0);

  const anchorPoint = hasClickPoint
    ? clickPoint
    : hasTrayBounds
      ? { x: trayBounds.x + trayBounds.width / 2, y: trayBounds.y }
      : screen.getCursorScreenPoint();

  const display = screen.getDisplayNearestPoint(anchorPoint);
  const { workArea } = display;

  let x;
  let y;

  if (hasTrayBounds) {
    x = Math.round(trayBounds.x + trayBounds.width / 2 - WINDOW_WIDTH / 2);
    y = Math.round(trayBounds.y - WINDOW_HEIGHT - 10);
    if (trayBounds.y < workArea.y + workArea.height / 2) {
      y = trayBounds.y + trayBounds.height + 10;
    }
  } else if (hasClickPoint) {
    x = Math.round(clickPoint.x - WINDOW_WIDTH / 2);
    y = Math.round(clickPoint.y - WINDOW_HEIGHT - 12);
  } else {
    x = workArea.x + workArea.width - WINDOW_WIDTH - 16;
    y = workArea.y + workArea.height - WINDOW_HEIGHT - 16;
  }

  x = Math.max(workArea.x + 8, Math.min(x, workArea.x + workArea.width - WINDOW_WIDTH - 8));
  y = Math.max(workArea.y + 8, Math.min(y, workArea.y + workArea.height - WINDOW_HEIGHT - 8));

  cardLayout = { x, y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT };
  popover.setBounds(
    {
      x: cardLayout.x - POPOVER_INSET,
      y: cardLayout.y - POPOVER_INSET,
      width: cardLayout.width + POPOVER_INSET * 2,
      height: cardLayout.height + POPOVER_INSET * 2,
    },
    false,
  );
  broadcastPopoverLayout();
}

function sendPopoverLayout() {
  if (!popover || popover.isDestroyed()) return;

  return {
    card: {
      x: POPOVER_INSET,
      y: POPOVER_INSET,
      width: cardLayout.width,
      height: cardLayout.height,
    },
  };
}

function broadcastPopoverLayout() {
  if (!popover || popover.isDestroyed()) return;
  popover.webContents.send('window:layout', sendPopoverLayout());
}

function destroyPopover() {
  if (!popover || popover.isDestroyed()) return;
  popover.destroy();
  popover = null;
}

function createPopover() {
  if (popover && !popover.isDestroyed()) {
    popover.destroy();
  }

  popover = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    roundedCorners: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  popover.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  popover.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  popover.on('blur', () => {
    if (!popover?.isVisible() || isClosing) return;
    if (Date.now() < ignoreBlurUntil) {
      blurDuringOpenGuard = true;
      return;
    }
    requestClosePopover();
  });

  popover.on('closed', () => {
    popover = null;
    // Pre-load the next window immediately so subsequent opens are instant.
    if (!app.isQuitting) {
      setImmediate(() => {
        if (!popover) createPopover();
      });
    }
  });
}

function broadcastTheme(theme) {
  if (popover && !popover.isDestroyed()) {
    popover.webContents.send('theme:update', theme);
  }
}

function applyBackgroundTheme(theme) {
  const next = setBackgroundTheme(theme);
  broadcastTheme(next);
  refreshTrayMenu();
  return next;
}

function broadcastVolume(volumeState) {
  if (popover && !popover.isDestroyed()) {
    popover.webContents.send('volume:update', volumeState);
  }
}

async function pushVolumeState() {
  try {
    broadcastVolume(await getVolumeState());
  } catch (err) {
    console.error('[main] volume read failed:', err.message);
  }
}

function startPolling() {
  pollTimer = startSessionPolling(POLL_INTERVAL_MS, broadcastState, broadcastArt);
}

function clearOpenGuardTimer() {
  if (openGuardTimer) {
    clearTimeout(openGuardTimer);
    openGuardTimer = null;
  }
}

function clearCloseTimer() {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

function requestClosePopover() {
  if (!popover || !popover.isVisible() || isClosing) return;
  isClosing = true;
  clearCloseTimer();
  clearOpenGuardTimer();
  popover.webContents.send('window:request-close');
  closeTimer = setTimeout(() => finishClosePopover(), CLOSE_TIMEOUT_MS);
}

function finishClosePopover() {
  clearCloseTimer();
  isClosing = false;
  if (popover && !popover.isDestroyed()) {
    popover.hide();
  }
}

function revealPopover() {
  if (!popover || popover.isDestroyed()) return;

  isClosing = false;
  clearCloseTimer();
  clearOpenGuardTimer();
  blurDuringOpenGuard = false;
  ignoreBlurUntil = Date.now() + BLUR_GUARD_MS;
  // If the window blurs during the open guard (user clicked away while we
  // were still focusing), close once the guard expires.
  openGuardTimer = setTimeout(() => {
    openGuardTimer = null;
    if (popover && !popover.isDestroyed() && popover.isVisible() && !isClosing) {
      if (!popover.isFocused() && blurDuringOpenGuard) requestClosePopover();
    }
  }, BLUR_GUARD_MS);

  positionPopover();
  popover.setAlwaysOnTop(true, 'pop-up-menu');
  popover.show();
  popover.moveTop();
  // Compute layout after show() so getBounds() reflects the final OS position.
  popover.webContents.send('window:request-open', sendPopoverLayout());
  popover.webContents.send('theme:update', getBackgroundTheme());

  setImmediate(() => {
    if (popover && !popover.isDestroyed() && popover.isVisible()) {
      popover.focus();
    }
  });

  lastStateKey = '';
  lastBroadcastArtFp = '';
  const session = getSession();
  broadcastState(session);
  if (session.albumArt) broadcastArt(session.albumArt);
  nudgeSessionRefresh();
}

/**
 * @param {{ bounds?: Electron.Rectangle, position?: Electron.Point } | void} anchor
 */
function openPopover(anchor) {
  clickAnchor = anchor ?? null;

  if (popover && !popover.isDestroyed() && popover.isVisible()) {
    requestClosePopover();
    return;
  }

  if (!popover || popover.isDestroyed()) {
    createPopover();
  }

  if (popover.webContents.isLoading()) {
    popover.webContents.once('did-finish-load', revealPopover);
  } else {
    revealPopover();
  }
}

function extendBlurGuard(ms = BLUR_GUARD_MS) {
  ignoreBlurUntil = Math.max(ignoreBlurUntil, Date.now() + ms);
}

function refocusPopover() {
  if (!popover || popover.isDestroyed() || !popover.isVisible() || isClosing) return;
  popover.setAlwaysOnTop(true, 'pop-up-menu');
  popover.moveTop();
  popover.focus();
}

function setupIpc() {
  ipcMain.on('media:control', (_event, action) => {
    const isPlaybackToggle = action === 'shuffle' || action === 'repeat';
    const isTrackChange = action === 'next' || action === 'previous';
    // ponytail: no blur guard for track changes — the SMTC daemon commands the
    // session directly (no foreground switch), so the popover doesn't blur on
    // skip. Guarding here blocked outside-click close during the transition.
    if (isPlaybackToggle) {
      extendBlurGuard(PLAYBACK_BLUR_GUARD_MS);
    }

    control(action, () => {
      if (!isPlaybackToggle) return;
      extendBlurGuard(BLUR_GUARD_MS);
      setImmediate(() => refocusPopover());
    });

    if (isTrackChange) {
      nudgeForceRefresh();
      for (const ms of [200, 500, 1000, 1800, 3000]) {
        setTimeout(nudgeForceRefresh, ms);
      }
    } else if (!isPlaybackToggle) {
      nudgeSessionRefresh();
      setTimeout(nudgeSessionRefresh, 300);
      setTimeout(nudgeSessionRefresh, 900);
    }
  });

  ipcMain.handle('volume:get', async () => getVolumeState());

  ipcMain.on('volume:set-live', (_event, volume) => {
    setVolumeLive(volume);
  });

  ipcMain.handle('volume:set', async (_event, volume) => {
    const state = await setVolume(volume);
    broadcastVolume(state);
    return state;
  });

  ipcMain.on('volume:adjust', (_event, delta) => {
    adjustVolume(delta);
    setTimeout(() => {
      void getVolumeState().then(broadcastVolume).catch(() => {});
    }, 60);
  });

  ipcMain.on('volume:mute', (_event, muted) => {
    setMuted(muted);
    setTimeout(() => {
      void getVolumeState().then(broadcastVolume).catch(() => {});
    }, 60);
  });

  ipcMain.handle('theme:get', () => getBackgroundTheme());

  ipcMain.on('window:close-complete', () => {
    finishClosePopover();
  });

  ipcMain.on('window:dismiss', () => {
    requestClosePopover();
  });
}

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    warmControl();
    warmVolume();
    createTray(openPopover, () => {
      app.isQuitting = true;
      app.quit();
    }, {
      getTheme: getBackgroundTheme,
      setTheme: applyBackgroundTheme,
    });
    setupIpc();
    startPolling();
    // Pre-load the popover window so it's ready before the first tray click.
    createPopover();
  });
}

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopSessionPolling(pollTimer);
  pollTimer = null;
  shutdownVolume();
  destroyTray();
  destroyPopover();
});
