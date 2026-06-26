/**
 * Renderer — track display, controls, animations, album-art accent color.
 */

const popover = document.getElementById('popover');
const popoverInner = document.querySelector('.popover__inner');
let ignoreOutsideUntil = 0;
const albumArt = document.getElementById('album-art');
const albumArtPlaceholder = document.getElementById('album-art-placeholder');
const colorBendsMount = document.getElementById('color-bends');
const floatingLinesMount = document.getElementById('floating-lines');
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

const NEUTRAL_ACCENT = {
  accent: '#9a9aa4',
  glow: 'rgba(154, 154, 164, 0.35)',
  ambient1: 'rgba(120, 120, 130, 0.28)',
  ambient2: 'rgba(100, 100, 110, 0.24)',
  ambientBase: 'rgba(90, 90, 100, 0.2)',
};

const NEUTRAL_SHADER = ['#2a2a32', '#32323a', '#242428'];

function setAccentVars({ accent, glow, ambient1, ambient2, ambientBase }) {
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-glow', glow);
  document.documentElement.style.setProperty('--ambient-1', ambient1);
  document.documentElement.style.setProperty('--ambient-2', ambient2);
  if (ambientBase) {
    document.documentElement.style.setProperty('--ambient-base', ambientBase);
  }
}

function extractPaletteFromDataUrl(dataUrl) {
  if (!dataUrl) return;
  const loadId = ++paletteLoadToken;
  const img = new Image();
  img.onload = () => {
    if (loadId !== paletteLoadToken) return;
    sampleAndApply(img);
  };
  img.src = dataUrl;
}

function trackKey(state) {
  return `${state.title}\x00${state.artist}\x00${state.album}\x00${state.trackNumber ?? 0}`;
}

function applyThemePalettes(bendsPalette, linesGradient) {
  lastBendsPalette = bendsPalette;
  lastLinesGradient = linesGradient;

  if (currentTheme === 'color-bends') {
    void applyColorBendsBackground(bendsPalette);
  } else if (currentTheme === 'floating-lines') {
    void applyFloatingLinesBackground(linesGradient);
  }

  if (currentTheme === 'album-blur') {
    applyAlbumBlurBackground(lastAlbumArtUrl);
  }
}

function applySampleToUi(sample) {
  const { full, left, right, bendsPalette, linesGradient } = sample;
  const accentFull = vibrantize(full);
  const accentLeft = vibrantize(left);
  const accentRight = vibrantize(right);

  setAccentVars({
    accent: `rgb(${accentFull.r}, ${accentFull.g}, ${accentFull.b})`,
    glow: `rgba(${accentFull.r}, ${accentFull.g}, ${accentFull.b}, 0.45)`,
    ambient1: `rgba(${accentLeft.r}, ${accentLeft.g}, ${accentLeft.b}, 0.38)`,
    ambient2: `rgba(${accentRight.r}, ${accentRight.g}, ${accentRight.b}, 0.34)`,
    ambientBase: `rgba(${accentFull.r}, ${accentFull.g}, ${accentFull.b}, 0.28)`,
  });

  applyThemePalettes(bendsPalette, linesGradient);
}

function sampleAndApply(img) {
  if (!img?.naturalWidth) return false;
  const sample = samplePaletteFromImage(img);
  if (!sample) return false;
  applySampleToUi(sample);
  return true;
}

function applyAlbumArtUrl(dataUrl) {
  if (!dataUrl) return;
  lastAlbumArtUrl = dataUrl;
  if (currentArtUrl !== dataUrl) {
    currentArtUrl = dataUrl;
    albumArt.src = dataUrl;
  }
  extractPaletteFromDataUrl(dataUrl);
}

/**
 * @param {import('../types').MediaState} state
 */
function updatePaletteFromState(state) {
  if (!state?.albumArt) {
    clearAlbumColors();
    return;
  }

  lastAlbumArtUrl = state.albumArt;

  if (currentArtUrl !== state.albumArt) {
    currentArtUrl = state.albumArt;
    albumArt.src = state.albumArt;
  }

  // ponytail: img load doesn't fire when src is unchanged; always sample from a fresh Image
  extractPaletteFromDataUrl(state.albumArt);
}

function scheduleColorRefresh() {
  for (const ms of [150, 400, 800, 1500, 2500, 4000]) {
    setTimeout(() => {
      if (!currentState?.albumArt) return;
      currentArtUrl = null;
      updatePaletteFromState(currentState);
    }, ms);
  }
}
function dominantRegion(data, size, x0, y0, x1, y1) {
  /** @type {Map<number, { n: number, r: number, g: number, b: number }>} */
  const buckets = new Map();

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * size + x) * 4;
      const alpha = data[i + 3];
      if (alpha < 100) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 248 && g > 248 && b > 248) continue;
      if (r < 8 && g < 8 && b < 8) continue;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      bucket.n += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      buckets.set(key, bucket);
    }
  }

  let best = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.n > best.n) best = bucket;
  }

  if (!best) return { r: 48, g: 48, b: 52 };
  return {
    r: Math.round(best.r / best.n),
    g: Math.round(best.g / best.n),
    b: Math.round(best.b / best.n),
  };
}

/** @type {'color-bends' | 'simple-gradient' | 'album-blur' | 'floating-lines'} */
let currentTheme = 'color-bends';
/** @type {string[] | null} */
let lastBendsPalette = null;
/** @type {string[] | null} */
let lastLinesGradient = null;
/** @type {string | null} */
let lastAlbumArtUrl = null;
/** @type {string} */
let lastSeenTrackKey = '';
/** @type {string | null} */
let currentArtUrl = null;
let paletteLoadToken = 0;

/** @type {ReturnType<import('./color-bends.js').createColorBends> | null} */
let colorBends = null;
/** @type {Promise<ReturnType<import('./color-bends.js').createColorBends>> | null} */
let colorBendsInit = null;
/** @type {ReturnType<import('./floating-lines.js').createFloatingLines> | null} */
let floatingLines = null;
/** @type {Promise<ReturnType<import('./floating-lines.js').createFloatingLines>> | null} */
let floatingLinesInit = null;

const BLUR_DRIFT = { x: -5, y: 5 };
const BLUR_HALF_MS = 10000;
let blurRaf = 0;
let blurStart = 0;

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function vibrantize({ r, g, b }, boost = 1.12) {
  const avg = (r + g + b) / 3;
  return {
    r: Math.min(255, Math.round(avg + (r - avg) * boost)),
    g: Math.min(255, Math.round(avg + (g - avg) * boost)),
    b: Math.min(255, Math.round(avg + (b - avg) * boost)),
  };
}

/** Darken sampled RGB for shaders — keeps album hue, caps brightness. */
function albumColorForShader({ r, g, b }) {
  const peak = Math.max(r, g, b, 1);
  const target = Math.min(peak, 130);
  const scale = target / peak;
  return {
    r: Math.round(r * scale),
    g: Math.round(g * scale),
    b: Math.round(b * scale),
  };
}

function shaderPaletteFromSamples(left, center, right) {
  return [left, center, right].map((c) => rgbToHex(albumColorForShader(c)));
}

function linesGradientFromPalette(palette) {
  if (!palette || palette.length === 0) return null;
  if (palette.length >= 3) return palette.slice(0, 3);
  if (palette.length === 2) return [palette[0], palette[1], palette[0]];
  return [palette[0], palette[0], palette[0]];
}

function samplePaletteFromImage(img) {
  const size = 64;
  accentCanvas.width = size;
  accentCanvas.height = size;
  const ctx = accentCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const third = Math.floor(size / 3);
  const center = dominantRegion(data, size, third, third, size - third - 1, size - third - 1);
  const left = dominantRegion(data, size, 0, 0, third - 1, size - 1);
  const right = dominantRegion(data, size, size - third, 0, size - 1, size - 1);

  const bendsPalette = shaderPaletteFromSamples(left, center, right);
  const linesGradient = linesGradientFromPalette(bendsPalette);

  return {
    full: center,
    left,
    right,
    bendsPalette,
    linesGradient,
  };
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
  if (!colorBendsInit) {
    colorBendsInit = (async () => {
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
        noise: 0.12,
        iterations: 1,
        intensity: 1.05,
        bandWidth: 6,
        colors: lastBendsPalette ?? NEUTRAL_SHADER,
      });
      return colorBends;
    })().catch((err) => {
      colorBendsInit = null;
      console.error('[color-bends] init failed:', err);
      throw err;
    });
  }
  return colorBendsInit;
}

function destroyColorBends() {
  if (!colorBends) return;
  colorBends.destroy();
  colorBends = null;
  colorBendsInit = null;
}

async function ensureFloatingLines() {
  if (floatingLines) {
    floatingLines.resize();
    return floatingLines;
  }
  if (!floatingLinesInit) {
    floatingLinesInit = (async () => {
      const { createFloatingLines } = await import('./floating-lines.js');
      floatingLines = createFloatingLines(floatingLinesMount, {
        linesGradient: lastLinesGradient ?? NEUTRAL_SHADER,
        animationSpeed: 1,
        interactive: true,
        bendRadius: 5,
        bendStrength: -0.5,
        mouseDamping: 0.05,
        parallax: true,
        parallaxStrength: 0.2,
      });
      return floatingLines;
    })().catch((err) => {
      floatingLinesInit = null;
      console.error('[floating-lines] init failed:', err);
      throw err;
    });
  }
  return floatingLinesInit;
}

function destroyFloatingLines() {
  if (!floatingLines) return;
  floatingLines.destroy();
  floatingLines = null;
  floatingLinesInit = null;
}

async function applyColorBendsBackground(palette) {
  if (currentTheme !== 'color-bends') return;
  const colors = palette ?? lastBendsPalette;
  if (!colors) return;
  try {
    const cb = await ensureColorBends();
    cb.updateColors(colors);
    cb.resize();
  } catch {
    /* decorative */
  }
}

async function applyFloatingLinesBackground(gradient) {
  if (currentTheme !== 'floating-lines') return;
  const colors = gradient ?? lastLinesGradient;
  if (!colors) return;
  try {
    const fl = await ensureFloatingLines();
    fl.updateGradient(colors);
    fl.resize();
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
  destroyFloatingLines();
  stopAlbumBlurDrift();
}

function syncBackground() {
  if (currentTheme === 'color-bends') {
    destroyFloatingLines();
    stopAlbumBlurDrift();
    void applyColorBendsBackground(lastBendsPalette);
  } else if (currentTheme === 'floating-lines') {
    destroyColorBends();
    stopAlbumBlurDrift();
    void applyFloatingLinesBackground(lastLinesGradient);
  } else if (currentTheme === 'album-blur') {
    destroyColorBends();
    destroyFloatingLines();
    applyAlbumBlurBackground(lastAlbumArtUrl);
  } else {
    stopBackgroundEffects();
  }
}

/**
 * @param {'color-bends' | 'simple-gradient' | 'album-blur' | 'floating-lines'} theme
 */
function applyTheme(theme) {
  const valid = ['color-bends', 'simple-gradient', 'album-blur', 'floating-lines'];
  if (!valid.includes(theme)) return;
  currentTheme = theme;
  popoverInner.dataset.theme = theme;
  syncBackground();
}

function clearAlbumColors() {
  lastSeenTrackKey = '';
  currentArtUrl = null;
  lastAlbumArtUrl = null;
  lastBendsPalette = null;
  lastLinesGradient = null;
  paletteLoadToken += 1;
  setAccentVars(NEUTRAL_ACCENT);
  syncBackground();
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
    albumArt.hidden = false;
    albumArtPlaceholder.hidden = true;

    const tk = trackKey(state);
    if (tk !== lastSeenTrackKey) {
      lastSeenTrackKey = tk;
      currentArtUrl = null;
      paletteLoadToken += 1;
    }

    updatePaletteFromState(state);
  } else {
    albumArt.removeAttribute('src');
    albumArt.hidden = true;
    albumArtPlaceholder.hidden = false;
    clearAlbumColors();
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
  } else if (action === 'next' || action === 'previous') {
    currentArtUrl = null;
    scheduleColorRefresh();
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
window.musicController.onArtUpdate((dataUrl) => applyAlbumArtUrl(dataUrl));
albumArt.addEventListener('load', () => sampleAndApply(albumArt));
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
