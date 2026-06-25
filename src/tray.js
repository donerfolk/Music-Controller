/**
 * System tray icon management.
 */

const path = require('path');
const fs = require('fs');
const { Tray, nativeImage, Menu } = require('electron');

const APP_ICON = path.join(__dirname, '..', 'assets', 'appicon.png');

const THEME_MENU = [
  { id: 'color-bends', label: 'Color Bends' },
  { id: 'simple-gradient', label: 'Simple Gradient' },
  { id: 'album-blur', label: 'Album Blur' },
];

/** @type {Tray | null} */
let tray = null;
/** @type {(() => void) | null} */
let onQuit = null;
/** @type {() => string} */
let getTheme = () => 'color-bends';
/** @type {(theme: string) => void} */
let setTheme = () => {};

/**
 * @returns {Electron.NativeImage}
 */
function loadTrayImage() {
  const iconPath = fs.existsSync(APP_ICON)
    ? APP_ICON
    : path.join(__dirname, '..', 'assets', 'icon-paused.png');

  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    return nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon-paused.png'));
  }
  return image.resize({ width: 32, height: 32 });
}

/**
 * @param {boolean} playing
 */
function setTrayIconState(playing) {
  if (!tray) return;
  tray.setImage(loadTrayImage());
  tray.setToolTip(playing ? 'Apple Music — Playing' : 'Apple Music — Paused');
}

function buildContextMenu() {
  const active = getTheme();
  return Menu.buildFromTemplate([
    {
      label: 'Themes',
      submenu: THEME_MENU.map(({ id, label }) => ({
        label,
        type: 'radio',
        checked: active === id,
        click: () => setTheme(id),
      })),
    },
    { type: 'separator' },
    { label: 'Quit Music Controller', click: () => onQuit?.() },
  ]);
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildContextMenu());
}

/**
 * @param {(anchor: { bounds: Electron.Rectangle, position: Electron.Point }) => void} onClick
 * @param {() => void} onQuitClick
 * @param {{ getTheme: () => string, setTheme: (theme: string) => void }} themeApi
 * @returns {Tray}
 */
function createTray(onClick, onQuitClick, themeApi) {
  if (tray) {
    tray.removeAllListeners();
    tray.destroy();
    tray = null;
  }

  onQuit = onQuitClick;
  getTheme = themeApi.getTheme;
  setTheme = themeApi.setTheme;

  tray = new Tray(loadTrayImage());
  tray.setToolTip('Apple Music Controller');
  tray.setIgnoreDoubleClickEvents(true);

  tray.on('click', (_event, bounds, position) => {
    onClick({ bounds, position });
  });

  refreshTrayMenu();
  return tray;
}

function destroyTray() {
  if (!tray) return;
  tray.removeAllListeners();
  tray.destroy();
  tray = null;
}

/**
 * @returns {Electron.Rectangle}
 */
function getTrayBounds() {
  if (!tray) return { x: 0, y: 0, width: 0, height: 0 };
  return tray.getBounds();
}

module.exports = {
  createTray,
  destroyTray,
  setTrayIconState,
  getTrayBounds,
  refreshTrayMenu,
};
