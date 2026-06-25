/**
 * System tray icon management.
 */

const path = require('path');
const fs = require('fs');
const { Tray, nativeImage, Menu } = require('electron');

const APP_ICON = path.join(__dirname, '..', 'assets', 'appicon.png');

/** @type {Tray | null} */
let tray = null;

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
  // 32x32 renders app icons more clearly in the Windows notification area.
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

/**
 * @param {(anchor: { bounds: Electron.Rectangle, position: Electron.Point }) => void} onClick
 * @param {() => void} onQuit
 * @returns {Tray}
 */
function createTray(onClick, onQuit) {
  if (tray) {
    tray.removeAllListeners();
    tray.destroy();
    tray = null;
  }

  tray = new Tray(loadTrayImage());
  tray.setToolTip('Apple Music Controller');
  tray.setIgnoreDoubleClickEvents(true);

  tray.on('click', (_event, bounds, position) => {
    onClick({ bounds, position });
  });

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Quit Music Controller', click: onQuit },
    ]),
  );

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
};
