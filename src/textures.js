import * as THREE from 'three';

// Procedural PBR-ish textures (albedo + roughness + normal) generated on canvases at startup,
// so the game ships with zero image assets.

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function valueNoise(seed, period) {
  const r = rng(seed);
  const grid = new Float32Array(period * period);
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  const at = (x, y) => grid[((y % period + period) % period) * period + ((x % period + period) % period)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** Tileable fBm in [0,1]. x,y in [0,1). */
function fbm(seed, base = 4, octaves = 5) {
  const layers = [];
  for (let o = 0; o < octaves; o++) layers.push({ n: valueNoise(seed + o * 101, base << o), f: base << o, a: 0.5 ** o });
  const norm = layers.reduce((s, l) => s + l.a, 0);
  return (x, y) => {
    let v = 0;
    for (const l of layers) v += l.n(x * l.f, y * l.f) * l.a;
    return v / norm;
  };
}

/**
 * fn(u, v) -> [r, g, b, height(0..1), roughness(0..1)]
 * Returns { map, normalMap, roughnessMap }.
 */
function generate(size, fn, normalStrength = 2) {
  const col = new Uint8ClampedArray(size * size * 4);
  const rough = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, g, b, h, ro] = fn(x / size, y / size);
    const i = y * size + x;
    col[i * 4] = r; col[i * 4 + 1] = g; col[i * 4 + 2] = b; col[i * 4 + 3] = 255;
    const rv = Math.max(0, Math.min(255, ro * 255));
    rough[i * 4] = rv; rough[i * 4 + 1] = rv; rough[i * 4 + 2] = rv; rough[i * 4 + 3] = 255;
    height[i] = h;
  }
  const nrm = new Uint8ClampedArray(size * size * 4);
  const H = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (H(x - 1, y) - H(x + 1, y)) * normalStrength;
    const dy = (H(x, y + 1) - H(x, y - 1)) * normalStrength;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 4;
    nrm[i] = (dx / l * 0.5 + 0.5) * 255; nrm[i + 1] = (dy / l * 0.5 + 0.5) * 255; nrm[i + 2] = (1 / l * 0.5 + 0.5) * 255; nrm[i + 3] = 255;
  }
  const tex = (data, srgb) => {
    const c = document.createElement('canvas'); c.width = c.height = size;
    c.getContext('2d').putImageData(new ImageData(data, size, size), 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: tex(col, true), roughnessMap: tex(rough, false), normalMap: tex(nrm, false) };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => a + (b - a) * t;

// --- Concrete floor: large poured slabs with seams, stains and grit (tile = 4m) ---
function concreteFloor(size) {
  const n = fbm(11, 4), grit = fbm(12, 32, 3), stain = fbm(13, 2, 4);
  return generate(size, (u, v) => {
    const seam = Math.min(u, 1 - u, v, 1 - v) < 0.006 ? 1 : 0;
    const half = Math.min(Math.abs(u - 0.5), Math.abs(v - 0.5)) < 0.003 ? 0.6 : 0;
    const base = 0.6 + (n(u, v) - 0.5) * 0.14 + (grit(u, v) - 0.5) * 0.14;
    const s = clamp01((stain(u, v) - 0.55) * 3) * 0.25;
    const c = (base - s) * (1 - Math.max(seam, half) * 0.45);
    const h = 0.5 + (grit(u, v) - 0.5) * 0.4 - Math.max(seam, half) * 0.5;
    return [c * 158, c * 156, c * 152, h, 0.85 + s * 0.4 - grit(u, v) * 0.1];
  }, 3);
}

// --- Plaster/sandstone walls (tile = 3m) ---
function plaster(size) {
  const n = fbm(21, 4), fine = fbm(22, 64, 2), blot = fbm(23, 3, 4);
  return generate(size, (u, v) => {
    const b = clamp01((blot(u, v) - 0.5) * 2.5);
    const f = fine(u, v);
    const c = 0.82 + (n(u, v) - 0.5) * 0.18 - b * 0.12 + (f - 0.5) * 0.08;
    return [c * 190, c * 168, c * 136, n(u, v) * 0.5 + f * 0.5, 0.9];
  }, 2.5);
}

// --- Stone blocks / bricks (tile = 2m, 4 rows) ---
function stoneBlocks(size) {
  const n = fbm(31, 8), grit = fbm(32, 32, 3);
  return generate(size, (u, v) => {
    const rows = 4, row = Math.floor(v * rows), rv = v * rows - row;
    const cols = 2, off = row % 2 ? 0.5 : 0;
    const cu = (u * cols + off) % 1;
    const mortar = rv < 0.04 || rv > 0.96 || cu < 0.02 || cu > 0.98;
    const tone = 0.85 + ((row * 7 + Math.floor(u * cols + off) * 13) % 5) * 0.03;
    const c = mortar ? 0.42 : tone * (0.8 + n(u, v) * 0.25) + (grit(u, v) - 0.5) * 0.1;
    const h = mortar ? 0.1 : 0.7 + grit(u, v) * 0.3;
    return [c * 160, c * 152, c * 140, h, mortar ? 0.95 : 0.8];
  }, 4);
}

// --- Wooden crate face: frame + planks (one texture per face) ---
function crate(size) {
  const grain = valueNoise(41, 8), fine = fbm(42, 32, 3);
  return generate(size, (u, v) => {
    const edge = Math.min(u, 1 - u, v, 1 - v);
    const frame = edge < 0.11;
    const diag = Math.abs(u - v) < 0.07 && !frame;
    const plank = Math.floor(v * 5);
    const gap = !frame && !diag && Math.abs(v * 5 - Math.round(v * 5)) < 0.03;
    const g = grain(u * 3, v * 40 + plank * 7) * 0.6 + fine(u, v) * 0.4;
    let c = 0.7 + g * 0.35;
    if (frame || diag) c *= 0.8;
    if (gap) c *= 0.35;
    const bolt = frame && (Math.hypot(u - 0.055, v - 0.055) < 0.02 || Math.hypot(u - 0.945, v - 0.055) < 0.02 || Math.hypot(u - 0.055, v - 0.945) < 0.02 || Math.hypot(u - 0.945, v - 0.945) < 0.02);
    if (bolt) return [70, 70, 75, 1, 0.4];
    const h = (frame || diag ? 0.8 : 0.4) + g * 0.15 - (gap ? 0.4 : 0) - (edge < 0.006 ? 0.3 : 0);
    return [c * 176, c * 118, c * 64, h, 0.75];
  }, 4);
}

// --- Painted metal with scratches (tile = 2m) ---
function paintedMetal(size) {
  const n = fbm(51, 4), scratch = valueNoise(52, 64), chip = fbm(53, 16, 3);
  return generate(size, (u, v) => {
    const s = scratch(u * 64, v * 4) > 0.93 ? 1 : 0;
    const c = clamp01((chip(u, v) - 0.68) * 6);
    const panel = Math.abs(v - 0.5) < 0.004 ? 1 : 0;
    const k = 0.78 + n(u, v) * 0.15;
    const r = mix(105 * k, 150, Math.max(s, c)), g = mix(122 * k, 150, Math.max(s, c)), b = mix(145 * k, 155, Math.max(s, c));
    return [r * (1 - panel * 0.4), g * (1 - panel * 0.4), b * (1 - panel * 0.4), 0.5 - c * 0.2 - panel * 0.4, mix(0.55, 0.3, Math.max(s, c))];
  }, 2);
}

// --- Outer walls: dark precast panels (tile = 4m) ---
function panels(size) {
  const n = fbm(61, 4), grit = fbm(62, 32, 3), streak = valueNoise(63, 32);
  return generate(size, (u, v) => {
    const seam = u < 0.008 || u > 0.992 || Math.abs(v - 0.5) < 0.004;
    const tie = [0.25, 0.75].some((a) => [0.25, 0.75].some((b) => Math.hypot(u - a, v - b) < 0.012));
    const st = streak(u * 32, v * 2) * 0.12;
    const c = (0.5 + n(u, v) * 0.2 + (grit(u, v) - 0.5) * 0.1 - st) * (seam ? 0.55 : 1) * (tie ? 0.6 : 1);
    return [c * 95, c * 104, c * 122, seam || tie ? 0.1 : 0.5 + grit(u, v) * 0.3, 0.85];
  }, 3);
}

export function buildMaterials(quality) {
  const size = quality === 'low' ? 256 : 512;
  const mk = (t, extra = {}) => new THREE.MeshStandardMaterial({ ...t, roughness: 1, metalness: 0, ...extra });
  return {
    floor: concreteFloor(size),
    wall: mk(plaster(size)),
    block: mk(stoneBlocks(size)),
    crate: mk(crate(size)),
    pillar: mk(paintedMetal(size), { metalness: 0.55 }),
    outer: mk(panels(size)),
    trim: new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.45, metalness: 0.7 }),
    base: new THREE.MeshStandardMaterial({ color: 0x5b554d, roughness: 0.95 }),
  };
}

// World-space tile size (m) per material, so textures never stretch.
export const TILE = { wall: 3, block: 2, pillar: 2, outer: 4, crate: 0 };

// --- Bullet hole decal ---
let holeTex = null;
export function bulletHoleTexture() {
  if (holeTex) return holeTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(10,10,10,1)'); grd.addColorStop(0.25, 'rgba(25,22,20,0.95)');
  grd.addColorStop(0.45, 'rgba(60,55,50,0.5)'); grd.addColorStop(1, 'rgba(60,55,50,0)');
  g.fillStyle = grd; g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(20,18,16,0.6)'; g.lineWidth = 1.2;
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 14;
    g.beginPath(); g.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6); g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); g.stroke();
  }
  holeTex = new THREE.CanvasTexture(c);
  holeTex.colorSpace = THREE.SRGBColorSpace;
  return holeTex;
}

// --- Muzzle flash star ---
let flashTex = null;
export function flashTexture() {
  if (flashTex) return flashTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.translate(64, 64);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, 60);
  grd.addColorStop(0, 'rgba(255,255,240,1)'); grd.addColorStop(0.2, 'rgba(255,220,120,0.9)');
  grd.addColorStop(0.5, 'rgba(255,140,40,0.35)'); grd.addColorStop(1, 'rgba(255,100,20,0)');
  g.fillStyle = grd;
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    g.beginPath(); g.moveTo(-6, 0); g.lineTo(0, -60 * (0.6 + Math.random() * 0.4)); g.lineTo(6, 0); g.fill();
  }
  g.beginPath(); g.arc(0, 0, 22, 0, Math.PI * 2); g.fill();
  flashTex = new THREE.CanvasTexture(c);
  flashTex.colorSpace = THREE.SRGBColorSpace;
  return flashTex;
}

// --- Soft round particle ---
let softTex = null;
export function softTexture() {
  if (softTex) return softTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  softTex = new THREE.CanvasTexture(c);
  return softTex;
}
