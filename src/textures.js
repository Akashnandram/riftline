import * as THREE from 'three';
import { GEN } from './texgen.js';

// Procedural PBR-ish textures (albedo + roughness + normal), so the game ships with zero image assets.
// The pixels are computed in background workers (texworker.js): every texture exists straight away
// as a full-size placeholder (flat grey) and is filled in as soon as its worker finishes, so the
// menu shows up without waiting several seconds for the maths. No worker support: computed inline.

const sets = new Map();                 // name + size -> { map, roughnessMap, normalMap }
let workers = null, rr = 0, jobId = 0;
const jobs = new Map();
function startWorkers() {
  if (workers !== null) return workers;
  workers = [];
  try {
    const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./texworker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => { const j = jobs.get(e.data.id); jobs.delete(e.data.id); if (j) fill(j.set, e.data); };
      // a worker that can't start (old browser, blocked): do its jobs here instead
      w.onerror = () => { for (const [id, j] of jobs) if (j.w === w) { jobs.delete(id); fill(j.set, GEN[j.name](j.size)); } };
      workers.push(w);
    }
  } catch { workers = []; }
  return workers;
}
function fill(set, r) {
  for (const [key, data] of [['map', r.col], ['roughnessMap', r.rough], ['normalMap', r.nrm]]) {
    set[key].image.data.set(data);
    set[key].needsUpdate = true;
  }
}
/** A texture set by recipe name; the pixels arrive asynchronously. */
function texSet(name, size) {
  const k = name + size;
  if (sets.has(k)) return sets.get(k);
  const tex = (srgb, fillRGBA) => {
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < data.length; i += 4) data.set(fillRGBA, i);
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.flipY = true;                     // same orientation as the old canvas textures
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const set = { map: tex(true, [150, 150, 150, 255]), roughnessMap: tex(false, [235, 235, 235, 255]), normalMap: tex(false, [128, 128, 255, 255]) };
  sets.set(k, set);
  const ws = startWorkers();
  if (ws.length) {
    const id = ++jobId, w = ws[rr++ % ws.length];
    jobs.set(id, { set, name, size, w });
    w.postMessage({ id, name, size });
  } else fill(set, GEN[name](size));
  return set;
}
/** Resolves once every texture asked for so far is filled in (e.g. before the first match). */
export function texturesReady() {
  if (!jobs.size) return Promise.resolve();
  return new Promise((res) => { const t = setInterval(() => { if (!jobs.size) { clearInterval(t); res(); } }, 50); });
}

const FLOOR_RECIPE = { concrete: 'concreteFloor', sand: 'sandFloor', snow: 'snowFloor', jungle: 'jungleFloor', asphalt: 'asphaltFloor' };
export const FLOORS = Object.fromEntries(Object.keys(FLOOR_RECIPE).map((k) => [k, (size) => texSet(FLOOR_RECIPE[k], size)]));
/** Floor texture set by name (made on first use, so a map only pays for the floor it shows). */
export function floorTextures(name, quality) {
  return texSet(FLOOR_RECIPE[name] || 'concreteFloor', quality === 'low' ? 256 : 512);
}

let matCache = null;
export function buildMaterials(quality) {
  if (matCache) return matCache;
  const size = quality === 'low' ? 256 : 512;
  const mk = (t, extra = {}) => new THREE.MeshStandardMaterial({ ...t, roughness: 1, metalness: 0, ...extra });
  // rarely-used sets are generated lazily the first time a map asks for them
  const lazy = (name, extra) => { let m = null; return () => { if (!m) { m = mk(texSet(name, size), extra); m.userData.shared = true; } return m; }; };
  const extras = {
    container: lazy('corrugated', { metalness: 0.45 }),
    moss: lazy('mossStone'),
    rock: lazy('rock'),
  };
  matCache = {
    extra: (k) => extras[k]?.(),
    floor: floorTextures('concrete', quality),
    wall: mk(texSet('plaster', size)),
    block: mk(texSet('stoneBlocks', size)),
    crate: mk(texSet('crate', size)),
    pillar: mk(texSet('paintedMetal', size), { metalness: 0.55 }),
    outer: mk(texSet('panels', size)),
    hwall: mk(texSet('housePlaster', size)),
    iwall: mk(texSet('housePlaster', size), { color: 0xe6dfd2 }),
    roof: mk(texSet('roofTiles', size)),
    planks: texSet('planks', size),
    pavers: texSet('pavers', size),
    burlap: mk(texSet('burlap', size)),
    furniture: mk(texSet('planks', size), { color: 0xb9a183 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.45, metalness: 0.7 }),
    base: new THREE.MeshStandardMaterial({ color: 0x5b554d, roughness: 0.95 }),
    snowcap: new THREE.MeshStandardMaterial({ color: 0xf2f6fb, roughness: 0.7 }),
  };
  return matCache;
}

// World-space tile size (m) per material, so textures never stretch.
export const TILE = { wall: 3, block: 2, pillar: 2, outer: 4, crate: 0, hwall: 2.5, iwall: 2.5, roof: 2, furniture: 1.2, plat: 2, step: 2, container: 2.4, moss: 2, rock: 3 };

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
