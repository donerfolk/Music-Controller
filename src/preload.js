/**
 * Preload script — exposes a safe IPC bridge to the renderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('musicController', {
  onUpdate: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('media:update', handler);
    return () => ipcRenderer.removeListener('media:update', handler);
  },

  onArtUpdate: (callback) => {
    const handler = (_event, albumArt) => callback(albumArt);
    ipcRenderer.on('media:art', handler);
    return () => ipcRenderer.removeListener('media:art', handler);
  },

  onRequestClose: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('window:request-close', handler);
    return () => ipcRenderer.removeListener('window:request-close', handler);
  },

  notifyCloseComplete: () => {
    ipcRenderer.send('window:close-complete');
  },

  dismiss: () => {
    ipcRenderer.send('window:dismiss');
  },

  onLayout: (callback) => {
    const handler = (_event, layout) => callback(layout);
    ipcRenderer.on('window:layout', handler);
    return () => ipcRenderer.removeListener('window:layout', handler);
  },

  /** Fire-and-forget — returns immediately for snappy controls. */
  control: (action) => ipcRenderer.send('media:control', action),

  onRequestOpen: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('window:request-open', handler);
    return () => ipcRenderer.removeListener('window:request-open', handler);
  },

  getVolume: () => ipcRenderer.invoke('volume:get'),
  setVolumeLive: (volume) => ipcRenderer.send('volume:set-live', volume),
  setVolume: (volume) => ipcRenderer.invoke('volume:set', volume),
  adjustVolume: (delta) => ipcRenderer.send('volume:adjust', delta),
  setMuted: (muted) => ipcRenderer.send('volume:mute', muted),

  onVolumeUpdate: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('volume:update', handler);
    return () => ipcRenderer.removeListener('volume:update', handler);
  },

  getTheme: () => ipcRenderer.invoke('theme:get'),

  onThemeUpdate: (callback) => {
    const handler = (_event, theme) => callback(theme);
    ipcRenderer.on('theme:update', handler);
    return () => ipcRenderer.removeListener('theme:update', handler);
  },
});
