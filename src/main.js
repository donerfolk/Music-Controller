/**
 * Electron main process — tray app, popover window, media polling.
 */

const path = require('path');
const { app, BrowserWindow, screen, ipcMain } = require('electron');
const { createTray, destroyTray, setTrayIconState, getTrayBounds } = require('./tray');
const { getSession, control, startSessionPolling, stopSessionPolling, refreshSession, warmControl } = require('./media');
const { getVolumeState, setVolume, setVolumeLive, adjustVolume, setMuted, warmVolume, shutdown: shutdownVolume } = require('./volume');

const WINDOW_WIDTH = 408;
const WINDOW_HEIGHT = 248;
const POLL_INTERVAL_MS = 1000;
const CLOSE_TIMEOUT_MS = 400;
const BLUR_GUARD_MS = 600;
/** @type {BrowserWindow | null} */
let popover = null;
/** @type {{ bounds: Electron.Rectangle, position: Electron.Point } | null} */
let clickAnchor = null;
/** @type {NodeJS.Timeout | null} */
let pollTimer = null;
/** @type {NodeJS.Timeout | null} */
let closeTimer = null;
let isClosing = false;
let ignoreBlurUntil = 0;
let lastStateKey = '';

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

function stateKey(state) {
  return JSON.stringify({
    active: state.active,
    title: state.title,
    artist: state.artist,
    album: state.album,
    isPlaying: state.isPlaying,
    artLen: state.albumArt ? state.albumArt.length : 0,
  });
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

  popover.setBounds({ x, y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT }, false);
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
    },
  });

  popover.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  popover.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  popover.on('blur', () => {
    if (!popover?.isVisible() || isClosing) return;
    if (Date.now() < ignoreBlurUntil) return;
    requestClosePopover();
  });

  popover.on('closed', () => {
    popover = null;
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
  pollTimer = startSessionPolling(POLL_INTERVAL_MS, broadcastState);
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
  popover.webContents.send('window:request-close');
  closeTimer = setTimeout(() => finishClosePopover(), CLOSE_TIMEOUT_MS);
}

function finishClosePopover() {
  clearCloseTimer();
  isClosing = false;
  if (popover && !popover.isDestroyed()) {
    popover.hide();
    destroyPopover();
  }
}

function revealPopover() {
  if (!popover || popover.isDestroyed()) return;

  isClosing = false;
  clearCloseTimer();
  ignoreBlurUntil = Date.now() + BLUR_GUARD_MS;

  positionPopover();
  popover.setAlwaysOnTop(true, 'pop-up-menu');
  popover.show();
  popover.moveTop();
  popover.webContents.send('window:request-open');

  setImmediate(() => {
    if (popover && !popover.isDestroyed() && popover.isVisible()) {
      popover.focus();
    }
  });

  lastStateKey = '';
  broadcastState(getSession());
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

  createPopover();

  const show = () => revealPopover();
  popover.webContents.once('did-finish-load', show);
}

function setupIpc() {
  ipcMain.on('media:control', (_event, action) => {
    control(action);
    lastStateKey = '';
    refreshSession();
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

  ipcMain.on('window:close-complete', () => {
    finishClosePopover();
  });
}

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    warmControl();
    warmVolume();
    createTray(openPopover, () => {
      app.isQuitting = true;
      app.quit();
    });
    setupIpc();
    startPolling();
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
