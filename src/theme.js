/**
 * Background theme preference — persisted in userData/settings.json.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/** @typedef {'color-bends' | 'simple-gradient' | 'album-blur'} BackgroundTheme */

const VALID = new Set(['color-bends', 'simple-gradient', 'album-blur']);
const DEFAULT_THEME = 'color-bends';

/** @type {BackgroundTheme[]} */
const THEME_IDS = ['color-bends', 'simple-gradient', 'album-blur'];

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

/** @returns {BackgroundTheme} */
function getBackgroundTheme() {
  try {
    const data = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return VALID.has(data.backgroundTheme) ? data.backgroundTheme : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** @param {BackgroundTheme} theme @returns {BackgroundTheme} */
function setBackgroundTheme(theme) {
  if (!VALID.has(theme)) return getBackgroundTheme();
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    /* fresh settings */
  }
  data.backgroundTheme = theme;
  fs.writeFileSync(settingsPath(), JSON.stringify(data));
  return theme;
}

module.exports = {
  getBackgroundTheme,
  setBackgroundTheme,
  THEME_IDS,
  DEFAULT_THEME,
};
