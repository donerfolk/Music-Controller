/**
 * Renderer — track display, controls, animations, album-art accent color.
 */

const popover = document.getElementById('popover');
const popoverInner = document.querySelector('.popover__inner');
let ignoreOutsideUntil = 0;
const albumArt = document.getElementById('album-art');
const albumArtPlaceholder = document.getElementById('album-art-placeholder');
const colorBendsMount = document.getElementById('color-bends');
const albumBlurImage = document.querySelector('.album-blur__image');
const albumBlurPan = document.querySelector('.album-blur__pan');
const trackTitle = document.getElementById('track-title');
const trackArtist = document.getElementById('track-artist');
const btnPrev = document.getElementById('btn-prev');
const btnPlay = document.getElementById('btn-play');
const btnNext = document.getElementById('btn-next');
const btnShuffle = document.getElementById('btn-shuffle');
const btnRepeat = document.getElementById('btn-repeat');
const btnVolDown = document.getElementById('btn-vol-down');
const btnVolUp = document.getElementById('btn-vol-up');
const btnMute = document.getElementById('btn-mute');
const volumeSlider = document.getElementById('volume-slider');

/** @type {import('../types').MediaState | null} */
let currentState = null;
let localShuffle = false;
let localRepeat = 'off';
let volumeDragging = false;
let volumeSyncPending = false;
let lastVolumeSent = -1;
const accentCanvas = document.createElement('canvas');

const DEFAULT_ACCENT = {
  accent: '#a78bfa',
  glow: 'rgba(167, 139, 250, 0.55)',
  ambient1: 'rgba(167, 139, 250, 0.62)',
  ambient2: 'rgba(120, 100, 200, 0.58)',
  ambientBase: 'rgba(167, 139, 250, 0.48)',
};

function setAccentVars({ accent, glow, ambient1, ambient2, ambientBase }) {
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-glow', glow);
  document.documentElement.style.setProperty('--ambient-1', ambient1);
  document.documentElement.style.setProperty('--ambient-2', ambient2);
  if (ambientBase) {
    document.documentElement.style.setProperty('--ambient-base', ambientBase);
  }
}

/**
 * @param {Uint8ClampedArray} data
 * @param {number} size
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 */
function averageRegion(data, size, x0, y0, x1, y1) {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * size + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count++;
    }
  }

  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count),
  };
}

function averageAllPixels(data) {
  let r = 0;
  let g = 0;
  let b = 0;
  const count = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }

  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count),
  };
}

const DEFAULT_PALETTE = ['#5227FF', '#a78bfa', '#7850c8'];

/** @type {'color-bends' | 'simple-gradient' | 'album-blur'} */
let currentTheme = 'color-bends';
/** @type {string[] | null} */
let lastPalette = null;
/** @type {string | null} */
let lastAlbumArtUrl = null;

/** @type {ReturnType<import('./color-bends.js').createColorBends> | null} */
let colorBends = null;

const BLUR_DRIFT = { x: -5, y: 5 };
const BLUR_HALF_MS = 10000;
let blurRaf = 0;
let blurStart = 0;

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function vibrantize({ r, g, b }, boost = 1.35) {
  const avg = (r + g + b) / 3;
  return {
    r: Math.min(255, Math.round(avg + (r - avg) * boost)),
    g: Math.min(255, Math.round(avg + (g - avg) * boost)),
    b: Math.min(255, Math.round(avg + (b - avg) * boost)),
  };
}

function paletteFromArt(left, center, right) {
  return [left, center, right].map((c) => rgbToHex(vibrantize(c)));
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

function albumBlurFrame(now) {
  if (!blurStart) blurStart = now;
  const wrap = albumBlurPan.parentElement;
  const w = wrap?.clientWidth || 0;
  const h = wrap?.clientHeight || 0;
  if (!w || !h) {
    blurRaf = requestAnimationFrame(albumBlurFrame);
    return;
  }
  const period = BLUR_HALF_MS * 2;
  const phase = ((now - blurStart) % period) / BLUR_HALF_MS;
  const t = phase <= 1 ? phase : 2 - phase;
  const e = easeInOut(t);
  const x = (BLUR_DRIFT.x * 0.01) * w * e;
  const y = (BLUR_DRIFT.y * 0.01) * h * e;
  albumBlurPan.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  blurRaf = requestAnimationFrame(albumBlurFrame);
}

function startAlbumBlurDrift() {
  if (currentTheme !== 'album-blur' || !albumBlurImage.getAttribute('src')) return;
  cancelAnimationFrame(blurRaf);
  blurStart = 0;
  blurRaf = requestAnimationFrame(albumBlurFrame);
}

function stopAlbumBlurDrift() {
  cancelAnimationFrame(blurRaf);
  blurRaf = 0;
  blurStart = 0;
  albumBlurPan.style.transform = '';
}

async function ensureColorBends() {
  if (colorBends) {
    colorBends.resize();
    return colorBends;
  }
  try {
    const { createColorBends } = await import('./color-bends.js');
    colorBends = createColorBends(colorBendsMount, {
      rotation: 90,
      speed: 0.2,
      transparent: true,
      autoRotate: 0,
      scale: 1,
      frequency: 1,
      warpStrength: 1,
      mouseInfluence: 0,
      parallax: 0.5,
      noise: 0.15,
      iterations: 1,
      intensity: 1.5,
      bandWidth: 6,
      colors: DEFAULT_PALETTE,
    });
    return colorBends;
  } catch (err) {
    console.error('[color-bends] init failed:', err);
    throw err;
  }
}

function destroyColorBends() {
  if (!colorBends) return;
  colorBends.destroy();
  colorBends = null;
}

async function applyColorBendsBackground(colors) {
  if (currentTheme !== 'color-bends') return;
  try {
    const cb = await ensureColorBends();
    cb.updateColors(colors?.length ? colors : DEFAULT_PALETTE);
    cb.resize();
  } catch {
    /* decorative */
  }
}

function applyAlbumBlurBackground(dataUrl) {
  stopAlbumBlurDrift();
  if (currentTheme !== 'album-blur' || !dataUrl) {
    albumBlurImage.removeAttribute('src');
    return;
  }
  const onReady = () => startAlbumBlurDrift();
  albumBlurImage.onload = onReady;
  albumBlurImage.src = dataUrl;
  if (albumBlurImage.complete) onReady();
}

function stopBackgroundEffects() {
  destroyColorBends();
  stopAlbumBlurDrift();
}

function syncBackground() {
  if (currentTheme === 'color-bends') {
    stopAlbumBlurDrift();
    void applyColorBendsBackground(lastPalette);
  } else if (currentTheme === 'album-blur') {
    destroyColorBends();
    applyAlbumBlurBackground(lastAlbumArtUrl);
  } else {
    stopBackgroundEffects();
  }
}

/**
 * @param {'color-bends' | 'simple-gradient' | 'album-blur'} theme
 */
function applyTheme(theme) {
  const valid = ['color-bends', 'simple-gradient', 'album-blur'];
  if (!valid.includes(theme)) return;
  currentTheme = theme;
  popoverInner.dataset.theme = theme;
  syncBackground();
}

function applyAccentFromArt(dataUrl) {
  lastAlbumArtUrl = dataUrl;
  if (!dataUrl) {
    setAccentVars(DEFAULT_ACCENT);
    lastPalette = null;
    syncBackground();
    return;
  }

  const img = new Image();
  img.onload = () => {
    const size = 16;
    accentCanvas.width = size;
    accentCanvas.height = size;
    const ctx = accentCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    const full = averageAllPixels(data);
    const left = averageRegion(data, size, 0, 0, 7, 15);
    const right = averageRegion(data, size, 8, 0, 15, 15);

    setAccentVars({
      accent: `rgb(${full.r}, ${full.g}, ${full.b})`,
      glow: `rgba(${full.r}, ${full.g}, ${full.b}, 0.55)`,
      ambient1: `rgba(${left.r}, ${left.g}, ${left.b}, 0.62)`,
      ambient2: `rgba(${right.r}, ${right.g}, ${right.b}, 0.58)`,
      ambientBase: `rgba(${full.r}, ${full.g}, ${full.b}, 0.48)`,
    });

    lastPalette = paletteFromArt(left, full, right);
    syncBackground();
  };
  img.src = dataUrl;
}

function updatePlayButton(isPlaying) {
  btnPlay.classList.toggle('is-playing', isPlaying);
  btnPlay.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
}

function renderPlaybackToggles() {
  btnShuffle.classList.toggle('is-active', localShuffle);
  btnShuffle.setAttribute('aria-label', localShuffle ? 'Shuffle on' : 'Shuffle off');
  btnShuffle.setAttribute('aria-pressed', String(localShuffle));

  btnRepeat.classList.toggle('is-active', localRepeat !== 'off');
  btnRepeat.classList.toggle('is-repeat-one', localRepeat === 'one');
  const repeatLabel = localRepeat === 'one'
    ? 'Repeat one'
    : localRepeat === 'all'
      ? 'Repeat all'
      : 'Repeat off';
  btnRepeat.setAttribute('aria-label', repeatLabel);
  btnRepeat.setAttribute('aria-pressed', String(localRepeat !== 'off'));
}

/**
 * @param {import('../types').MediaState} state
 */
function renderState(state) {
  currentState = state;

  if (!state.active) {
    localShuffle = false;
    localRepeat = 'off';
  }

  trackTitle.textContent = state.title || 'Not playing';
  trackArtist.textContent = state.artist || (state.active ? '' : 'Open Apple Music to begin');

  if (state.albumArt) {
    albumArt.src = state.albumArt;
    albumArt.hidden = false;
    albumArtPlaceholder.hidden = true;
    applyAccentFromArt(state.albumArt);
  } else {
    albumArt.removeAttribute('src');
    albumArt.hidden = true;
    albumArtPlaceholder.hidden = false;
    applyAccentFromArt(null);
  }

  updatePlayButton(state.isPlaying);
  renderPlaybackToggles();

  const disabled = !state.active;
  btnPrev.disabled = disabled;
  btnPlay.disabled = disabled;
  btnNext.disabled = disabled;
  btnShuffle.disabled = disabled;
  btnRepeat.disabled = disabled;
}

/**
 * @param {{ volume: number, muted: boolean }} vol
 */
function renderVolume(vol) {
  if (!volumeDragging) {
    volumeSlider.value = String(vol.muted ? 0 : vol.volume);
  }
  btnMute.classList.toggle('is-muted', vol.muted);
  btnMute.setAttribute('aria-label', vol.muted ? 'Unmute' : 'Mute');
}

function playOpenAnimation() {
  popoverInner.classList.remove('is-closing', 'is-hidden');
  popoverInner.classList.add('is-opening');
  syncBackground();
  popoverInner.addEventListener(
    'animationend',
    () => popoverInner.classList.remove('is-opening'),
    { once: true },
  );
}

function playCloseAnimation() {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      stopBackgroundEffects();
      popoverInner.classList.add('is-hidden');
      popoverInner.classList.remove('is-closing');
      resolve();
    };

    popoverInner.classList.add('is-closing');
    popoverInner.classList.remove('is-hidden');

    const onEnd = (e) => {
      if (e.target !== popoverInner) return;
      popoverInner.removeEventListener('transitionend', onEnd);
      finish();
    };

    popoverInner.addEventListener('transitionend', onEnd);
    setTimeout(finish, 250);
  });
}

function handleControl(action) {
  if (!currentState?.active) return;

  if (action === 'toggle') {
    updatePlayButton(!currentState.isPlaying);
  } else if (action === 'shuffle') {
    localShuffle = !localShuffle;
    renderPlaybackToggles();
  } else if (action === 'repeat') {
    const cycle = { off: 'all', all: 'one', one: 'off' };
    localRepeat = cycle[localRepeat] || 'off';
    renderPlaybackToggles();
  }

  window.musicController.control(action);
}

btnPrev.addEventListener('click', () => handleControl('previous'));
btnPlay.addEventListener('click', () => handleControl('toggle'));
btnNext.addEventListener('click', () => handleControl('next'));
btnShuffle.addEventListener('click', () => handleControl('shuffle'));
btnRepeat.addEventListener('click', () => handleControl('repeat'));

btnVolDown.addEventListener('click', () => {
  const next = Math.max(0, Number(volumeSlider.value) - 5);
  volumeSlider.value = String(next);
  lastVolumeSent = next;
  btnMute.classList.toggle('is-muted', next === 0);
  window.musicController.adjustVolume(-5);
});

btnVolUp.addEventListener('click', () => {
  const next = Math.min(100, Number(volumeSlider.value) + 5);
  volumeSlider.value = String(next);
  lastVolumeSent = next;
  btnMute.classList.toggle('is-muted', next === 0);
  window.musicController.adjustVolume(5);
});

btnMute.addEventListener('click', () => {
  const isMuted = btnMute.classList.contains('is-muted');
  btnMute.classList.toggle('is-muted', !isMuted);
  window.musicController.setMuted(!isMuted);
});

async function syncVolumeFromSlider() {
  if (volumeSyncPending) return;
  volumeSyncPending = true;
  const value = Number(volumeSlider.value);
  lastVolumeSent = -1;
  try {
    renderVolume(await window.musicController.setVolume(value));
  } catch {
    /* ignore */
  } finally {
    volumeSyncPending = false;
  }
}

volumeSlider.addEventListener('pointerdown', (event) => {
  volumeDragging = true;
  volumeSlider.setPointerCapture(event.pointerId);
});

volumeSlider.addEventListener('input', () => {
  const value = Number(volumeSlider.value);
  btnMute.classList.toggle('is-muted', value === 0);
  if (value === lastVolumeSent) return;
  lastVolumeSent = value;
  window.musicController.setVolumeLive(value);
});

function endVolumeDrag(event) {
  if (!volumeDragging) return;
  if (volumeSlider.hasPointerCapture(event.pointerId)) {
    volumeSlider.releasePointerCapture(event.pointerId);
  }
  void syncVolumeFromSlider().finally(() => {
    volumeDragging = false;
  });
}

volumeSlider.addEventListener('pointerup', endVolumeDrag);
volumeSlider.addEventListener('pointercancel', endVolumeDrag);

volumeSlider.addEventListener('change', () => {
  if (volumeDragging || volumeSyncPending) return;
  void syncVolumeFromSlider();
});

window.musicController.onUpdate((state) => renderState(state));
window.musicController.onVolumeUpdate((vol) => renderVolume(vol));
window.musicController.onThemeUpdate((theme) => applyTheme(theme));
popover.addEventListener('pointerdown', (event) => {
  if (Date.now() < ignoreOutsideUntil) return;
  if (!event.target.closest('.popover__inner')) {
    window.musicController.dismiss();
  }
});

window.musicController.onLayout(({ card }) => {
  document.documentElement.style.setProperty('--card-x', `${card.x}px`);
  document.documentElement.style.setProperty('--card-y', `${card.y}px`);
  document.documentElement.style.setProperty('--card-w', `${card.width}px`);
  document.documentElement.style.setProperty('--card-h', `${card.height}px`);
});

window.musicController.onRequestOpen(async () => {
  ignoreOutsideUntil = Date.now() + 350;
  try {
    applyTheme(await window.musicController.getTheme());
  } catch {
    /* use current theme */
  }
  playOpenAnimation();
  try {
    renderVolume(await window.musicController.getVolume());
  } catch {
    /* volume unavailable */
  }
});
window.musicController.onRequestClose(async () => {
  await playCloseAnimation();
  window.musicController.notifyCloseComplete();
});
