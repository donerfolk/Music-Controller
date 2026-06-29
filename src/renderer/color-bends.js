/**
 * ColorBends — vanilla port of react-bits ColorBends (Three.js shader background).
 */

import * as THREE from './vendor/three.module.js';

const MAX_COLORS = 8;

const FRAG = `
#define MAX_COLORS ${MAX_COLORS}
uniform vec2 uCanvas;
uniform float uTime;
uniform float uSpeed;
uniform vec2 uRot;
uniform int uColorCount;
uniform vec3 uColors[MAX_COLORS];
uniform int uTransparent;
uniform float uScale;
uniform float uFrequency;
uniform float uWarpStrength;
uniform vec2 uPointer;
uniform float uMouseInfluence;
uniform float uParallax;
uniform float uNoise;
uniform int uIterations;
uniform float uIntensity;
uniform float uBandWidth;
varying vec2 vUv;

void main() {
  float t = uTime * uSpeed;
  vec2 p = vUv * 2.0 - 1.0;
  p += uPointer * uParallax * 0.1;
  vec2 rp = vec2(p.x * uRot.x - p.y * uRot.y, p.x * uRot.y + p.y * uRot.x);
  vec2 q = vec2(rp.x * (uCanvas.x / uCanvas.y), rp.y);
  q /= max(uScale, 0.0001);
  q /= 0.5 + 0.2 * dot(q, q);
  q += 0.2 * cos(t) - 7.56;
  vec2 toward = (uPointer - rp);
  q += toward * uMouseInfluence * 0.2;

  for (int j = 0; j < 5; j++) {
    if (j >= uIterations - 1) break;
    vec2 rr = sin(1.5 * (q.yx * uFrequency) + 2.0 * cos(q * uFrequency));
    q += (rr - q) * 0.15;
  }

  vec3 col = vec3(0.0);
  float a = 1.0;

  if (uColorCount > 0) {
    vec2 s = q;
    vec3 sumCol = vec3(0.0);
    float cover = 0.0;
    for (int i = 0; i < MAX_COLORS; ++i) {
      if (i >= uColorCount) break;
      s -= 0.01;
      vec2 r = sin(1.5 * (s.yx * uFrequency) + 2.0 * cos(s * uFrequency));
      float m0 = length(r + sin(5.0 * r.y * uFrequency - 3.0 * t + float(i)) / 4.0);
      float kBelow = clamp(uWarpStrength, 0.0, 1.0);
      float kMix = pow(kBelow, 0.3);
      float gain = 1.0 + max(uWarpStrength - 1.0, 0.0);
      vec2 disp = (r - s) * kBelow;
      vec2 warped = s + disp * gain;
      float m1 = length(warped + sin(5.0 * warped.y * uFrequency - 3.0 * t + float(i)) / 4.0);
      float m = mix(m0, m1, kMix);
      float w = 1.0 - exp(-uBandWidth / exp(uBandWidth * m));
      sumCol += uColors[i] * w;
      cover = max(cover, w);
    }
    col = clamp(sumCol, 0.0, 1.0);
    a = uTransparent > 0 ? cover : 1.0;
  }

  col *= uIntensity;

  if (uNoise > 0.0001) {
    float n = fract(sin(dot(gl_FragCoord.xy + vec2(uTime), vec2(12.9898, 78.233))) * 43758.5453123);
    col += (n - 0.5) * uNoise;
    col = clamp(col, 0.0, 1.0);
  }

  vec3 rgb = (uTransparent > 0) ? col * a : col;
  gl_FragColor = vec4(rgb, a);
}
`;

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

function hexToVec3(hex) {
  const h = hex.replace('#', '').trim();
  const v = h.length === 3
    ? [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
    : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  return new THREE.Vector3(v[0] / 255, v[1] / 255, v[2] / 255);
}

/**
 * @param {HTMLElement} container
 * @param {object} [opts]
 */
export function createColorBends(container, opts = {}) {
  const config = {
    rotation: 90,
    speed: 0.2,
    colors: [],
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
    ...opts,
  };

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uColorsArray = Array.from({ length: MAX_COLORS }, () => new THREE.Vector3(0, 0, 0));
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uCanvas: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uSpeed: { value: config.speed },
      uRot: { value: new THREE.Vector2(1, 0) },
      uColorCount: { value: 0 },
      uColors: { value: uColorsArray },
      uTransparent: { value: config.transparent ? 1 : 0 },
      uScale: { value: config.scale },
      uFrequency: { value: config.frequency },
      uWarpStrength: { value: config.warpStrength },
      uPointer: { value: new THREE.Vector2(0, 0) },
      uMouseInfluence: { value: config.mouseInfluence },
      uParallax: { value: config.parallax },
      uNoise: { value: config.noise },
      uIterations: { value: config.iterations },
      uIntensity: { value: config.intensity },
      uBandWidth: { value: config.bandWidth },
    },
    premultipliedAlpha: true,
    transparent: true,
  });

  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
    alpha: true,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, config.transparent ? 0 : 1);
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';
  container.replaceChildren(renderer.domElement);

  const clock = new THREE.Clock();
  let raf = 0;
  let rotation = config.rotation;
  let autoRotate = config.autoRotate;
  const pointerTarget = new THREE.Vector2(0, 0);
  const pointerCurrent = new THREE.Vector2(0, 0);
  const pointerSmooth = 8;

  const applyColors = (colors) => {
    const arr = (colors || []).filter(Boolean).slice(0, MAX_COLORS).map(hexToVec3);
    // ponytail: replace the array ref — in-place vec.copy() doesn't reliably re-upload
    material.uniforms.uColors.value = Array.from({ length: MAX_COLORS }, (_, i) =>
      i < arr.length ? arr[i] : new THREE.Vector3(0, 0, 0),
    );
    material.uniforms.uColorCount.value = arr.length;
    material.uniformsNeedUpdate = true;
  };

  applyColors(config.colors);

  const resize = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    material.uniforms.uCanvas.value.set(w, h);
  };

  resize();
  const ro = 'ResizeObserver' in window
    ? new ResizeObserver(resize)
    : null;
  if (ro) ro.observe(container);
  else window.addEventListener('resize', resize);

  const onPointerMove = (e) => {
    const rect = container.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / (rect.width || 1)) * 2 - 1;
    const y = -(((e.clientY - rect.top) / (rect.height || 1)) * 2 - 1);
    pointerTarget.set(x, y);
  };
  container.addEventListener('pointermove', onPointerMove);

  const loop = () => {
    const dt = clock.getDelta();
    const elapsed = clock.elapsedTime;
    material.uniforms.uTime.value = elapsed;

    const deg = (rotation % 360) + autoRotate * elapsed;
    const rad = (deg * Math.PI) / 180;
    material.uniforms.uRot.value.set(Math.cos(rad), Math.sin(rad));

    pointerCurrent.lerp(pointerTarget, Math.min(1, dt * pointerSmooth));
    material.uniforms.uPointer.value.copy(pointerCurrent);

    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  const startLoop = () => { if (!raf) raf = requestAnimationFrame(loop); };
  const stopLoop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };
  startLoop();

  return {
    updateColors(colors) {
      applyColors(colors);
      // ponytail: RAF may be throttled while the popover is unfocused (skip while
      // open), so force one paint to apply the new palette immediately.
      renderer.render(scene, camera);
    },
    resize() {
      resize();
    },
    setRotation(deg) {
      rotation = deg;
    },
    attachTo(newContainer) {
      if (!newContainer) return;
      if (newContainer === container) { resize(); return; }
      newContainer.replaceChildren(renderer.domElement);
      if (ro) { ro.disconnect(); ro.observe(newContainer); }
      container.removeEventListener('pointermove', onPointerMove);
      newContainer.addEventListener('pointermove', onPointerMove);
      container = newContainer;
      resize();
    },
    pause() { stopLoop(); },
    resume() { startLoop(); },
    destroy() {
      stopLoop();
      container.removeEventListener('pointermove', onPointerMove);
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', resize);
      renderer.dispose();
      material.dispose();
      // ponytail: release the underlying WebGL context — see floating-lines.js.
      renderer.forceContextLoss();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}
