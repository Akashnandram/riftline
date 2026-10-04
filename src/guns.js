import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WEAPONS } from './config.js';

// Weapon models built from primitives. Units are metres; the gun points down -Z with the grip
// near the origin. Rounded edges catch the light, metal has scratch-varied roughness, polymer has
// a stippled bump. Static parts are merged per material; moving parts (mag, bolt/slide, hammer,
// cylinder) stay separate groups exposed in userData for the animation code.

// ---------------------------------------------------------------------------
// Procedural surface textures
// ---------------------------------------------------------------------------
function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  return t;
}
// roughness map: mid grey with fine scratches and wear
const metalRough = canvasTex(256, (g, s) => {
  g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 3000; i++) { const v = 110 + Math.random() * 60; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * s, Math.random() * s, 2, 2); }
  g.strokeStyle = 'rgba(40,40,40,0.5)'; g.lineWidth = 1;
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * s, y = Math.random() * s, a = (Math.random() - 0.5) * 0.6, l = 10 + Math.random() * 50;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
}, 2);
// bump map: stippled grip texture
const stipple = canvasTex(128, (g, s) => {
  g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 1400; i++) { const v = Math.random() < 0.5 ? 60 : 200; g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.arc(Math.random() * s, Math.random() * s, 1.2, 0, 7); g.fill(); }
}, 3);

const std = (color, metal, rough, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, ...extra });
const M = {
  steel: std(0x34373c, 0.85, 1, { roughnessMap: metalRough }),           // roughness = map * 1 (≈0.45–0.65)
  dark: std(0x1f2125, 0.7, 0.9, { roughnessMap: metalRough }),
  bright: std(0x8f949b, 1, 0.55, { roughnessMap: metalRough }),           // polished steel
  polymer: std(0x2e3034, 0, 0.78, { bumpMap: stipple, bumpScale: 0.6 }),
  rubber: std(0x1c1d1f, 0, 0.95, { bumpMap: stipple, bumpScale: 1 }),
  brass: std(0xc89b3c, 1, 0.3),
  glass: std(0x1c2a3a, 0.9, 0.05, { emissive: 0x0a1a2a }),
  lens: new THREE.MeshBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.12, depthWrite: false }),
  wood: std(0x7a4b28, 0, 0.55, { bumpMap: stipple, bumpScale: 0.15 }),
  glove: std(0x25272b, 0, 0.9, { bumpMap: stipple, bumpScale: 0.3 }),
  red: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
  shell: std(0x9a2a22, 0.35, 0.2),
  tritium: new THREE.MeshBasicMaterial({ color: 0x7dff9a }),
};
export const GUN_MATS = M;
const accentCache = {};
/** Which part of the gun a material belongs to (used by skins). */
export function materialRole(mat) {
  if (mat === M.steel || mat === M.bright) return 'metal';
  if (mat === M.dark) return 'dark';
  if (mat === M.polymer) return 'polymer';
  if (Object.values(accentCache).includes(mat)) return 'accent';
  return null;
}
const accent = (c) => (accentCache[c] ??= std(c, 0.15, 0.7, { bumpMap: stipple, bumpScale: 0.2 }));
const sleeveCache = {};
const sleeve = (c) => (sleeveCache[c] ??= std(new THREE.Color(0x24272d).lerp(new THREE.Color(c), 0.1), 0, 0.9));

// ---------------------------------------------------------------------------
// Primitive helpers (geometry cached by size)
// ---------------------------------------------------------------------------
const geoCache = new Map();
const cached = (k, make) => { if (!geoCache.has(k)) geoCache.set(k, make()); return geoCache.get(k); };

/** Rounded box (falls back to a plain box for very thin parts). */
function box(g, mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const r = Math.min(w, h, d) * 0.24;
  const geo = cached(`b${w}|${h}|${d}`, () => (r > 0.0012 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d)));
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  g.add(m);
  return m;
}
function cyl(g, mat, r, len, x, y, z, seg = 16, r2 = r) {
  const m = new THREE.Mesh(cached(`c${r}|${r2}|${len}|${seg}`, () => new THREE.CylinderGeometry(r2, r, len, seg)), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  g.add(m);
  return m;
}
function sph(g, mat, r, x, y, z) {
  const m = new THREE.Mesh(cached(`s${r}`, () => new THREE.SphereGeometry(r, 12, 8)), mat);
  m.position.set(x, y, z); g.add(m); return m;
}
/** A row of small boxes (rail teeth, serrations, vents). */
function row(g, mat, n, step, w, h, d, x, y, z, axis = 'z') {
  for (let i = 0; i < n; i++) box(g, mat, w, h, d, x + (axis === 'x' ? i * step : 0), y + (axis === 'y' ? i * step : 0), z + (axis === 'z' ? i * step : 0));
}

let NO_HANDS = false;
function hands(g, team, gripZ, foreZ, foreY = -0.035, pistol = false) {
  if (NO_HANDS) return;
  const sl = sleeve(team);
  // right hand wraps the grip; forearm runs back toward the bottom-right of the screen
  box(g, M.glove, 0.05, 0.078, 0.09, 0.012, -0.066, gripZ + 0.01, 0.3);
  box(g, M.glove, 0.018, 0.02, 0.05, -0.022, -0.02, gripZ - 0.03);               // trigger finger
  box(g, M.glove, 0.022, 0.022, 0.05, -0.024, -0.05, gripZ - 0.005, 0.3);         // thumb
  box(g, sl, 0.078, 0.078, 0.34, 0.05, -0.13, gripZ + 0.2, 0.42, -0.12);
  box(g, M.polymer, 0.082, 0.03, 0.07, 0.05, -0.112, gripZ + 0.06, 0.42, -0.12);   // glove cuff
  if (pistol) {
    box(g, M.glove, 0.05, 0.072, 0.072, -0.036, -0.075, gripZ, 0.3, 0.2);
    box(g, sl, 0.072, 0.072, 0.34, -0.12, -0.14, gripZ + 0.2, 0.42, 0.35);
  } else {
    box(g, M.glove, 0.058, 0.05, 0.085, -0.018, foreY - 0.02, foreZ, 0, 0, 0.35);
    box(g, M.glove, 0.06, 0.02, 0.02, 0.006, foreY + 0.01, foreZ - 0.02, 0, 0, 0.9); // fingers over the top
    box(g, sl, 0.078, 0.078, 0.42, -0.14, foreY - 0.11, foreZ + 0.22, 0.32, 0.5);
  }
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------
/** Optic housings you can look through when aiming. Returns the sight height. */
function optic(g, kind, z) {
  if (kind === 'holo') {
    // tall rectangular holographic window with a hood
    box(g, M.dark, 0.03, 0.016, 0.07, 0, 0.057, z);
    for (const [bw, bh, x, y] of [[0.05, 0.007, 0, 0.066], [0.05, 0.009, 0, 0.11], [0.007, 0.05, -0.022, 0.088], [0.007, 0.05, 0.022, 0.088]]) box(g, M.steel, bw, bh, 0.03, x, y, z - 0.02);
    box(g, M.dark, 0.05, 0.006, 0.07, 0, 0.116, z);
    box(g, M.lens, 0.038, 0.038, 0.002, 0, 0.088, z - 0.035);
    const ring = new THREE.Mesh(cached('holoRing', () => new THREE.RingGeometry(0.0024, 0.0034, 16)), M.red); ring.position.set(0, 0.088, z - 0.034); g.add(ring);
    return 0.088;
  }
  if (kind === 'prism') {
    // compact magnified prism sight: short tube with an open rear aperture
    box(g, M.dark, 0.03, 0.016, 0.06, 0, 0.057, z);
    cyl(g, M.dark, 0.022, 0.1, 0, 0.088, z, 18);
    cyl(g, M.dark, 0.026, 0.02, 0, 0.088, z - 0.06, 18, 0.022);
    cyl(g, M.glass, 0.02, 0.002, 0, 0.088, z - 0.07, 18);
    box(g, M.steel, 0.014, 0.012, 0.02, 0, 0.114, z);
    const dot = new THREE.Mesh(cached('dot', () => new THREE.SphereGeometry(0.0012, 8, 6)), M.red); dot.position.set(0, 0.088, z - 0.05); g.add(dot);
    return 0.088;
  }
  // default: open red-dot window
  box(g, M.dark, 0.026, 0.016, 0.05, 0, 0.057, z);
  for (const [bw, bh, x, y] of [[0.044, 0.007, 0, 0.068], [0.044, 0.007, 0, 0.104], [0.007, 0.042, -0.019, 0.086], [0.007, 0.042, 0.019, 0.086]]) box(g, M.steel, bw, bh, 0.05, x, y, z);
  box(g, M.dark, 0.012, 0.01, 0.014, 0.024, 0.09, z);
  box(g, M.lens, 0.032, 0.03, 0.002, 0, 0.086, z - 0.022);
  const dot = new THREE.Mesh(cached('dot', () => new THREE.SphereGeometry(0.0012, 8, 6)), M.red); dot.position.set(0, 0.086, z - 0.02); g.add(dot);
  return 0.086;
}

/** AR-pattern rifle; opt picks handguard / muzzle / optic / stock / barrel length / mag. */
function rifle(g, w, team, opt = {}) {
  const a = accent(w.color);
  const bl = opt.barrel ?? 0.24;
  // upper / lower receiver
  box(g, M.steel, 0.05, 0.046, 0.3, 0, 0.012, -0.11);
  box(g, a, 0.046, 0.04, 0.22, 0, -0.03, -0.09);
  box(g, a, 0.052, 0.03, 0.07, 0, -0.045, -0.175);                       // flared magwell
  box(g, M.dark, 0.004, 0.026, 0.06, 0.026, 0.014, -0.06);                // ejection port
  box(g, M.steel, 0.012, 0.014, 0.018, 0.03, 0.006, -0.02);               // forward assist
  box(g, M.dark, 0.006, 0.012, 0.02, -0.026, -0.022, -0.13);              // bolt release
  box(g, M.dark, 0.004, 0.008, 0.02, -0.025, -0.03, -0.035, 0, 0, 0.4);   // selector
  box(g, M.dark, 0.03, 0.01, 0.4, 0, 0.04, -0.17);                        // top rail
  row(g, M.dark, 12, 0.03, 0.034, 0.005, 0.012, 0, 0.047, -0.345);
  // handguard
  if (opt.handguard === 'round') {
    cyl(g, a, 0.034, 0.32, 0, 0.004, -0.43, 20);
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) box(g, M.dark, 0.004, 0.012, 0.03, s * 0.033, 0.004, -0.31 - i * 0.045);
  } else {
    box(g, a, 0.058, 0.064, 0.3, 0, 0.004, -0.42);
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) box(g, M.dark, 0.004, 0.018, 0.035, s * 0.029, 0.004, -0.33 - i * 0.06);
    for (let i = 0; i < 4; i++) box(g, M.dark, 0.022, 0.004, 0.035, 0, -0.029, -0.33 - i * 0.06);
  }
  const bz = -0.57 - bl / 2;
  cyl(g, M.steel, 0.011, bl, 0, 0.004, bz);
  box(g, M.dark, 0.026, 0.026, 0.03, 0, 0.004, -0.6);                     // gas block
  let tipZ;
  if (opt.muzzle === 'suppressor') {
    const sl = 0.2, sz = -0.57 - bl - sl / 2 + 0.02;
    cyl(g, M.dark, 0.022, sl, 0, 0.004, sz, 20);
    for (let i = 0; i < 4; i++) cyl(g, M.steel, 0.0225, 0.006, 0, 0.004, sz - sl / 2 + 0.03 + i * 0.045, 20);
    tipZ = sz - sl / 2 - 0.005;
  } else {
    const mz = -0.57 - bl - 0.03;
    cyl(g, M.dark, 0.017, 0.07, 0, 0.004, mz, 8);
    for (const s of [-1, 1]) box(g, M.dark, 0.006, 0.01, 0.012, s * 0.016, 0.01, mz + 0.01);
    tipZ = mz - 0.04;
  }
  const bolt = box(g, M.steel, 0.034, 0.01, 0.022, 0, 0.032, 0.035);      // charging handle
  // magazine
  const mag = new THREE.Group(); mag.position.set(0, -0.065, -0.175); g.add(mag);
  if (opt.mag === 'straight') {
    box(mag, M.polymer, 0.032, 0.1, 0.064, 0, -0.04, 0, -0.08);
    box(mag, M.dark, 0.036, 0.012, 0.07, 0, -0.095, 0.004, -0.08);
  } else {
    box(mag, M.polymer, 0.032, 0.12, 0.066, 0, -0.05, 0, -0.18);
    box(mag, M.polymer, 0.032, 0.08, 0.064, 0, -0.14, 0.022, -0.42);
    for (let i = 0; i < 3; i++) box(mag, M.dark, 0.034, 0.006, 0.05, 0, -0.03 - i * 0.03, -0.004 + i * 0.006, -0.18);
    box(mag, M.dark, 0.036, 0.012, 0.07, 0, -0.18, 0.04, -0.42);
  }
  // grip, trigger, guard
  box(g, M.polymer, 0.034, 0.1, 0.042, 0, -0.085, 0.018, 0.32);
  box(g, M.dark, 0.004, 0.022, 0.006, 0, -0.05, -0.045, 0.3);
  box(g, M.dark, 0.008, 0.006, 0.06, 0, -0.07, -0.04);
  // stock
  if (opt.stock === 'fixed') {
    box(g, a, 0.044, 0.08, 0.22, 0, -0.018, 0.17);
    box(g, a, 0.034, 0.03, 0.14, 0, 0.03, 0.16);                           // cheek riser
    box(g, M.rubber, 0.048, 0.12, 0.022, 0, -0.03, 0.29);
  } else {
    cyl(g, M.dark, 0.015, 0.14, 0, 0.0, 0.1);
    box(g, M.polymer, 0.042, 0.07, 0.15, 0, -0.015, 0.19);
    box(g, M.polymer, 0.03, 0.02, 0.1, 0, 0.026, 0.19);
    box(g, M.rubber, 0.046, 0.11, 0.022, 0, -0.03, 0.272);
  }
  if (opt.foregrip !== false) box(g, M.polymer, 0.03, 0.03, 0.06, 0, -0.045, -0.46, -0.5);
  if (opt.bipod) for (const s of [-1, 1]) box(g, M.dark, 0.008, 0.008, 0.18, s * 0.018, -0.045, -0.5);
  const sightY = optic(g, opt.optic, -0.13);
  hands(g, team, 0.015, -0.4);
  return { tip: new THREE.Vector3(0, 0.004, tipZ), mag, bolt, eject: new THREE.Vector3(0.03, 0.014, -0.06), sightY,
    grip: new THREE.Vector3(0, -0.075, 0.02), fore: new THREE.Vector3(-0.01, -0.045, -0.33) };
}

function wraith(g, w, team) { return rifle(g, w, team, { handguard: 'round', muzzle: 'suppressor', optic: 'holo', foregrip: false }); }
function sentry(g, w, team) { return rifle(g, w, team, { barrel: 0.4, optic: 'prism', stock: 'fixed', mag: 'straight', foregrip: false, bipod: true }); }

/** Bullpup burst rifle: magazine behind the grip, short and chunky. */
function talon(g, w, team) {
  const a = accent(w.color);
  box(g, a, 0.056, 0.08, 0.52, 0, 0.0, 0.0);                                 // shell from muzzle to butt
  box(g, M.dark, 0.058, 0.02, 0.2, 0, -0.03, -0.12);                         // lower trim
  box(g, M.dark, 0.004, 0.024, 0.07, 0.029, 0.01, 0.1);                       // ejection port (rear)
  box(g, M.dark, 0.03, 0.01, 0.3, 0, 0.046, -0.08);                          // top rail
  row(g, M.dark, 9, 0.03, 0.034, 0.005, 0.012, 0, 0.053, -0.2);
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) box(g, M.dark, 0.004, 0.03, 0.03, s * 0.029, 0, -0.18 - i * 0.05);
  cyl(g, M.steel, 0.012, 0.18, 0, 0.006, -0.35);
  cyl(g, M.dark, 0.018, 0.06, 0, 0.006, -0.47, 6);
  box(g, M.rubber, 0.058, 0.1, 0.02, 0, -0.01, 0.27);
  const bolt = box(g, M.steel, 0.01, 0.014, 0.024, -0.031, 0.02, -0.08);     // side charging handle
  const mag = new THREE.Group(); mag.position.set(0, -0.06, 0.12); g.add(mag);
  box(mag, M.polymer, 0.032, 0.11, 0.064, 0, -0.045, 0, -0.15);
  box(mag, M.dark, 0.036, 0.012, 0.07, 0, -0.1, 0.008, -0.15);
  box(g, M.polymer, 0.034, 0.1, 0.042, 0, -0.085, 0.018, 0.32);             // grip ahead of the mag
  box(g, M.dark, 0.004, 0.022, 0.006, 0, -0.05, -0.045, 0.3);
  box(g, M.dark, 0.008, 0.006, 0.07, 0, -0.07, -0.035);
  box(g, M.polymer, 0.03, 0.03, 0.06, 0, -0.05, -0.26, -0.5);                // angled foregrip
  const sightY = optic(g, 'holo', -0.1);
  hands(g, team, 0.015, -0.27);
  return { tip: new THREE.Vector3(0, 0.006, -0.5), mag, bolt, eject: new THREE.Vector3(0.03, 0.012, 0.1), sightY,
    grip: new THREE.Vector3(0, -0.075, 0.02), fore: new THREE.Vector3(-0.01, -0.06, -0.26) };
}

/** Pump shotgun: tube magazine under the barrel, pump slides back after every shot. */
function warden(g, w, team) {
  const a = accent(w.color);
  box(g, M.steel, 0.048, 0.06, 0.24, 0, 0.004, -0.06);                        // receiver
  box(g, M.dark, 0.004, 0.024, 0.07, 0.025, 0.012, -0.05);                    // ejection port
  cyl(g, M.steel, 0.014, 0.52, 0, 0.018, -0.44);                              // barrel
  box(g, M.steel, 0.008, 0.006, 0.52, 0, 0.034, -0.44);                       // vent rib
  sph(g, M.bright, 0.004, 0, 0.04, -0.69);                                    // bead sight
  cyl(g, M.dark, 0.012, 0.44, 0, -0.012, -0.42);                              // mag tube
  cyl(g, M.dark, 0.014, 0.02, 0, -0.012, -0.645);
  box(g, M.dark, 0.034, 0.03, 0.03, 0, 0.004, -0.66);                         // barrel clamp
  // side saddle with shells
  for (let i = 0; i < 4; i++) { const sh = cyl(g, M.shell, 0.007, 0.05, -0.029, -0.004, -0.02 - i * 0.018); sh.rotation.x = 0; }   // upright shells
  box(g, M.dark, 0.006, 0.03, 0.08, -0.026, -0.004, -0.047);
  // pump forend (animated)
  const pump = new THREE.Group(); pump.position.set(0, -0.012, -0.32); g.add(pump);
  box(pump, a, 0.044, 0.042, 0.15, 0, 0, 0);
  for (let i = 0; i < 5; i++) box(pump, M.dark, 0.046, 0.004, 0.006, 0, -0.012, -0.05 + i * 0.025);
  // trigger group + stock
  box(g, M.dark, 0.004, 0.022, 0.006, 0, -0.04, -0.01, 0.3);
  box(g, M.dark, 0.008, 0.006, 0.06, 0, -0.058, -0.01);
  box(g, a, 0.04, 0.09, 0.05, 0, -0.06, 0.08, 0.5);                           // grip wrist
  box(g, a, 0.046, 0.08, 0.24, 0, -0.04, 0.2, 0.12);                          // stock
  box(g, M.rubber, 0.05, 0.12, 0.024, 0, -0.065, 0.32, 0.12);
  const mag = new THREE.Group(); mag.position.set(0, -0.03, -0.08); g.add(mag);  // shell being loaded
  cyl(mag, M.shell, 0.008, 0.05, 0, 0, 0);
  hands(g, team, 0.06, -0.32, -0.035);
  return { tip: new THREE.Vector3(0, 0.018, -0.71), mag, bolt: pump, eject: new THREE.Vector3(0.03, 0.012, -0.05), sightY: 0.04,
    grip: new THREE.Vector3(0, -0.07, 0.07), fore: new THREE.Vector3(0, -0.03, -0.32), pumpAction: true };
}

/** Light machine gun: box magazine, perforated barrel shroud, carry handle, bipod, iron sights. */
function hammer(g, w, team) {
  const a = accent(w.color);
  box(g, M.steel, 0.062, 0.08, 0.36, 0, 0.004, -0.08);                         // receiver
  box(g, a, 0.064, 0.03, 0.26, 0, 0.055, -0.06);                              // feed cover
  box(g, M.dark, 0.005, 0.03, 0.07, 0.032, 0.0, -0.04);                       // ejection port
  cyl(g, M.dark, 0.026, 0.34, 0, 0.004, -0.42, 18);                           // barrel shroud
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) box(g, M.steel, 0.004, 0.012, 0.03, s * 0.026, 0.004, -0.29 - i * 0.05);
  cyl(g, M.steel, 0.013, 0.14, 0, 0.004, -0.66);
  cyl(g, M.dark, 0.02, 0.06, 0, 0.004, -0.75, 8);
  // carry handle + iron sights
  box(g, M.dark, 0.012, 0.012, 0.16, 0, 0.1, -0.1);
  box(g, M.dark, 0.012, 0.04, 0.012, 0, 0.08, -0.02); box(g, M.dark, 0.012, 0.04, 0.012, 0, 0.08, -0.18);
  box(g, M.steel, 0.022, 0.024, 0.01, 0, 0.08, 0.05); box(g, M.dark, 0.008, 0.012, 0.012, 0, 0.088, 0.05);   // rear aperture
  box(g, M.steel, 0.006, 0.03, 0.01, 0, 0.068, -0.6); box(g, M.tritium, 0.003, 0.003, 0.004, 0, 0.083, -0.604);
  // box magazine (left side, hangs low) + belt
  const mag = new THREE.Group(); mag.position.set(-0.01, -0.07, -0.12); g.add(mag);
  box(mag, a, 0.07, 0.11, 0.12, 0, -0.03, 0);
  box(mag, M.dark, 0.072, 0.012, 0.124, 0, -0.06, 0);
  box(mag, M.brass, 0.012, 0.02, 0.08, 0.03, 0.035, 0);
  const bolt = box(g, M.steel, 0.012, 0.016, 0.026, 0.036, 0.02, -0.16);     // charging handle
  box(g, M.polymer, 0.036, 0.1, 0.044, 0, -0.09, 0.02, 0.32);
  box(g, M.dark, 0.004, 0.022, 0.006, 0, -0.055, -0.04, 0.3);
  box(g, M.dark, 0.008, 0.006, 0.06, 0, -0.074, -0.035);
  box(g, M.polymer, 0.05, 0.09, 0.22, 0, -0.02, 0.2);                          // stock
  box(g, M.rubber, 0.054, 0.12, 0.024, 0, -0.03, 0.315);
  for (const s of [-1, 1]) box(g, M.dark, 0.009, 0.009, 0.22, s * 0.02, -0.03, -0.5);   // folded bipod
  hands(g, team, 0.02, -0.36, -0.03);
  return { tip: new THREE.Vector3(0, 0.004, -0.79), mag, bolt, eject: new THREE.Vector3(0.034, 0.0, -0.04), sightY: 0.088,
    grip: new THREE.Vector3(0, -0.08, 0.025), fore: new THREE.Vector3(-0.005, -0.03, -0.36) };
}

/** Machine pistol: pistol frame with an extended mag and a compensator. */
function wasp(g, w, team) {
  const a = accent(w.color);
  const slide = new THREE.Group(); slide.position.set(0, 0.022, -0.07); g.add(slide);
  box(slide, M.dark, 0.03, 0.034, 0.19, 0, 0, 0);
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) box(slide, M.steel, 0.002, 0.024, 0.004, s * 0.0155, 0, 0.06 + i * 0.007);
  box(slide, M.steel, 0.003, 0.012, 0.035, 0.015, 0.006, -0.01);
  box(slide, M.steel, 0.006, 0.01, 0.008, 0, 0.021, -0.085); box(slide, M.tritium, 0.003, 0.003, 0.003, 0, 0.025, -0.089);
  box(slide, M.steel, 0.022, 0.01, 0.008, 0, 0.021, 0.085);
  box(g, M.steel, 0.032, 0.036, 0.05, 0, 0.022, -0.19);                       // compensator
  for (let i = 0; i < 2; i++) box(g, M.dark, 0.034, 0.006, 0.01, 0, 0.038, -0.18 - i * 0.02);
  box(g, a, 0.028, 0.026, 0.16, 0, -0.008, -0.06);
  box(g, M.polymer, 0.03, 0.1, 0.046, 0, -0.065, 0.005, 0.22);
  box(g, M.dark, 0.006, 0.006, 0.045, 0, -0.04, -0.04);
  box(g, M.dark, 0.004, 0.02, 0.006, 0, -0.03, -0.035, 0.3);
  box(g, M.polymer, 0.02, 0.05, 0.02, 0, -0.04, -0.12, -0.2);                 // small foregrip
  const mag = new THREE.Group(); mag.position.set(0, -0.12, 0.022); g.add(mag);
  box(mag, M.dark, 0.026, 0.1, 0.038, 0, -0.03, 0, 0.22);                     // extended mag
  box(mag, a, 0.03, 0.014, 0.044, 0, -0.08, 0.012, 0.22);
  hands(g, team, 0.005, 0, 0, true);
  return { tip: new THREE.Vector3(0, 0.022, -0.22), mag, bolt: slide, eject: new THREE.Vector3(0.02, 0.03, -0.06), sightY: 0.046,
    grip: new THREE.Vector3(0, -0.065, 0.01), fore: new THREE.Vector3(-0.035, -0.075, 0.02), pistol: true, slide: true };
}

function smg(g, w, team) {
  const a = accent(w.color);
  box(g, a, 0.05, 0.072, 0.26, 0, 0, -0.08);
  box(g, M.dark, 0.03, 0.009, 0.22, 0, 0.04, -0.09);
  row(g, M.dark, 7, 0.03, 0.033, 0.004, 0.01, 0, 0.046, -0.18);
  box(g, M.dark, 0.004, 0.022, 0.04, 0.026, 0.012, -0.04);                 // ejection port
  // suppressor-style shroud with holes
  cyl(g, M.dark, 0.021, 0.16, 0, 0.004, -0.29, 18);
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) box(g, M.steel, 0.003, 0.009, 0.012, s * 0.02, 0.004, -0.23 - i * 0.03);
  cyl(g, M.steel, 0.012, 0.03, 0, 0.004, -0.385);
  const mag = new THREE.Group(); mag.position.set(0, -0.05, -0.11); g.add(mag);
  box(mag, M.polymer, 0.03, 0.17, 0.042, 0, -0.08, 0);
  for (let i = 0; i < 4; i++) box(mag, M.dark, 0.032, 0.005, 0.03, 0, -0.03 - i * 0.03, 0);
  box(mag, M.dark, 0.034, 0.012, 0.046, 0, -0.17, 0);
  box(g, M.polymer, 0.033, 0.095, 0.042, 0, -0.075, 0.02, 0.28);
  box(g, M.polymer, 0.028, 0.08, 0.032, 0, -0.07, -0.22);                   // vertical foregrip
  box(g, M.dark, 0.004, 0.02, 0.006, 0, -0.045, -0.02, 0.3);
  box(g, M.dark, 0.008, 0.006, 0.05, 0, -0.064, -0.02);
  // folding wire stock
  for (const s of [-1, 1]) box(g, M.steel, 0.008, 0.008, 0.18, s * 0.018, -0.005, 0.12);
  box(g, M.rubber, 0.045, 0.07, 0.015, 0, -0.01, 0.21);
  const bolt = box(g, M.steel, 0.012, 0.014, 0.022, -0.031, 0.02, -0.12);  // side charging handle
  // iron sights
  box(g, M.steel, 0.007, 0.022, 0.01, 0, 0.052, -0.18); box(g, M.tritium, 0.003, 0.003, 0.004, 0, 0.062, -0.184);
  box(g, M.steel, 0.022, 0.016, 0.01, 0, 0.05, 0.0);
  hands(g, team, 0.02, -0.22, -0.06);
  return { tip: new THREE.Vector3(0, 0.004, -0.41), mag, bolt, eject: new THREE.Vector3(0.028, 0.012, -0.04), sightY: 0.055,
    grip: new THREE.Vector3(0, -0.075, 0.025), fore: new THREE.Vector3(0, -0.1, -0.22) };
}

function pistol(g, w, team) {
  const a = accent(w.color);
  // slide is a group so it can blow back on every shot
  const slide = new THREE.Group(); slide.position.set(0, 0.022, -0.07); g.add(slide);
  box(slide, M.steel, 0.03, 0.034, 0.19, 0, 0, 0);
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) box(slide, M.dark, 0.002, 0.024, 0.004, s * 0.0155, 0, 0.06 + i * 0.007);
  box(slide, M.dark, 0.003, 0.012, 0.035, 0.015, 0.006, -0.01);              // ejection port
  box(slide, M.steel, 0.006, 0.01, 0.008, 0, 0.021, -0.085);                 // front sight
  box(slide, M.tritium, 0.003, 0.003, 0.003, 0, 0.025, -0.089);
  box(slide, M.steel, 0.022, 0.01, 0.008, 0, 0.021, 0.085);                  // rear sight
  for (const s of [-1, 1]) box(slide, M.tritium, 0.003, 0.003, 0.003, s * 0.006, 0.024, 0.089);
  // frame, rail, guard, trigger, grip
  box(g, a, 0.028, 0.026, 0.16, 0, -0.008, -0.06);
  row(g, M.dark, 3, 0.012, 0.03, 0.004, 0.006, 0, -0.022, -0.13);
  box(g, M.polymer, 0.03, 0.1, 0.046, 0, -0.065, 0.005, 0.22);
  box(g, M.dark, 0.006, 0.006, 0.045, 0, -0.04, -0.04);
  box(g, M.dark, 0.004, 0.02, 0.006, 0, -0.03, -0.035, 0.3);
  cyl(g, M.dark, 0.006, 0.01, 0, 0.022, -0.168);
  const mag = new THREE.Group(); mag.position.set(0, -0.112, 0.016); g.add(mag);
  box(mag, M.dark, 0.028, 0.02, 0.044, 0, 0, 0, 0.22);
  hands(g, team, 0.005, 0, 0, true);
  return { tip: new THREE.Vector3(0, 0.022, -0.172), mag, bolt: slide, eject: new THREE.Vector3(0.02, 0.03, -0.06), sightY: 0.046,
    grip: new THREE.Vector3(0, -0.065, 0.01), fore: new THREE.Vector3(-0.035, -0.075, 0.02), pistol: true, slide: true };
}

function revolver(g, w, team) {
  box(g, M.bright, 0.032, 0.05, 0.1, 0, 0.005, -0.03);
  // cylinder (rotates 60° per shot) with flutes and chambers
  const mag = new THREE.Group(); mag.position.set(0, 0.006, -0.035); g.add(mag);
  const cylBody = new THREE.Group(); mag.add(cylBody);
  cyl(cylBody, M.bright, 0.026, 0.055, 0, 0, 0, 18);
  for (let i = 0; i < 6; i++) {
    const an = i * Math.PI / 3, an2 = an + Math.PI / 6;
    cyl(cylBody, M.dark, 0.0055, 0.056, Math.cos(an) * 0.016, Math.sin(an) * 0.016, 0, 8);
    box(cylBody, M.dark, 0.006, 0.006, 0.04, Math.cos(an2) * 0.025, Math.sin(an2) * 0.025, 0);
  }
  // barrel, top rib, ejector rod, front sight
  cyl(g, M.bright, 0.011, 0.17, 0, 0.012, -0.17);
  box(g, M.bright, 0.014, 0.014, 0.17, 0, 0.026, -0.17);
  cyl(g, M.steel, 0.004, 0.12, 0, -0.006, -0.14);
  box(g, M.dark, 0.006, 0.014, 0.008, 0, 0.039, -0.245);
  box(g, M.dark, 0.012, 0.006, 0.01, 0, 0.033, 0.015);                       // rear notch
  box(g, M.wood, 0.031, 0.105, 0.046, 0, -0.067, 0.027, 0.35);
  box(g, M.bright, 0.033, 0.012, 0.048, 0, -0.012, 0.02, 0.35);              // grip frame strap
  const hammer = new THREE.Group(); hammer.position.set(0, 0.03, 0.03); g.add(hammer);
  box(hammer, M.steel, 0.008, 0.024, 0.016, 0, 0.008, 0, -0.4);
  box(hammer, M.steel, 0.012, 0.006, 0.014, 0, 0.02, 0.006, -0.4);
  box(g, M.dark, 0.006, 0.006, 0.04, 0, -0.04, -0.01);
  box(g, M.dark, 0.004, 0.02, 0.006, 0, -0.026, -0.008, 0.3);
  hands(g, team, 0.02, 0, 0, true);
  return { tip: new THREE.Vector3(0, 0.012, -0.26), mag, cylinder: cylBody, bolt: hammer, eject: null, sightY: 0.04,
    grip: new THREE.Vector3(0, -0.065, 0.025), fore: new THREE.Vector3(-0.035, -0.075, 0.03), pistol: true, revolver: true };
}

function sniper(g, w, team) {
  const a = accent(w.color);
  box(g, M.steel, 0.05, 0.068, 0.32, 0, 0, -0.08);
  box(g, a, 0.06, 0.07, 0.38, 0, -0.012, -0.43);                              // chassis forend
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) box(g, M.dark, 0.004, 0.024, 0.04, s * 0.03, -0.012, -0.3 - i * 0.06);
  // fluted barrel + brake
  cyl(g, M.dark, 0.014, 0.44, 0, 0.006, -0.82, 16);
  for (let i = 0; i < 4; i++) { const an = i * Math.PI / 2; box(g, M.steel, 0.004, 0.004, 0.36, Math.cos(an) * 0.0135, 0.006 + Math.sin(an) * 0.0135, -0.8); }
  box(g, M.dark, 0.04, 0.034, 0.1, 0, 0.006, -1.07);
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) box(g, M.steel, 0.004, 0.02, 0.016, s * 0.02, 0.006, -1.04 - i * 0.025);
  const mag = new THREE.Group(); mag.position.set(0, -0.06, -0.12); g.add(mag);
  box(mag, M.dark, 0.034, 0.07, 0.08, 0, -0.025, 0);
  box(g, M.polymer, 0.036, 0.1, 0.045, 0, -0.08, 0.04, 0.3);
  box(g, M.dark, 0.004, 0.022, 0.006, 0, -0.045, -0.015, 0.3);
  box(g, M.dark, 0.008, 0.006, 0.06, 0, -0.065, -0.015);
  box(g, a, 0.048, 0.08, 0.26, 0, -0.02, 0.2);
  box(g, a, 0.04, 0.03, 0.14, 0, 0.035, 0.18);                                // cheek rest
  box(g, M.rubber, 0.05, 0.12, 0.025, 0, -0.03, 0.34);
  box(g, M.dark, 0.02, 0.05, 0.02, 0, -0.07, 0.28);                          // monopod
  // folded bipod legs under the forend
  for (const s of [-1, 1]) box(g, M.dark, 0.008, 0.008, 0.2, s * 0.018, -0.055, -0.5);
  // scope: tube, bells, turrets, caps, rings
  cyl(g, M.dark, 0.021, 0.3, 0, 0.088, -0.1);
  cyl(g, M.dark, 0.032, 0.07, 0, 0.088, -0.28, 18, 0.022);
  cyl(g, M.dark, 0.027, 0.05, 0, 0.088, 0.07, 18, 0.021);
  cyl(g, M.glass, 0.03, 0.002, 0, 0.088, -0.316, 18);
  for (const z of [-0.18, 0.0]) { box(g, M.steel, 0.03, 0.04, 0.018, 0, 0.06, z); cyl(g, M.steel, 0.024, 0.016, 0, 0.088, z, 18); }
  const t1 = cyl(g, M.steel, 0.012, 0.02, 0, 0.115, -0.08, 14); t1.rotation.x = 0;
  const t2 = cyl(g, M.steel, 0.012, 0.02, 0.026, 0.088, -0.08, 14); t2.rotation.set(0, 0, Math.PI / 2);
  // bolt (lifts and pulls back after every shot)
  const bolt = new THREE.Group(); bolt.position.set(0.032, 0.015, 0.02); g.add(bolt);
  box(bolt, M.steel, 0.04, 0.008, 0.008, 0.02, 0, 0);
  sph(bolt, M.steel, 0.011, 0.042, -0.006, 0);
  hands(g, team, 0.04, -0.4);
  return { tip: new THREE.Vector3(0, 0.006, -1.12), mag, bolt, eject: new THREE.Vector3(0.03, 0.02, -0.04), sightY: 0.088,
    grip: new THREE.Vector3(0, -0.075, 0.045), fore: new THREE.Vector3(-0.01, -0.05, -0.36), boltAction: true };
}

const BUILD = { p9: pistol, magnum: revolver, hornet: smg, raptor: rifle, longbow: sniper, wasp, warden, talon, sentry, wraith, hammer };

/** Merge a group's direct static meshes by material to cut draw calls. */
function mergeStatic(g, keep) {
  const byMat = new Map();
  for (const o of [...g.children]) {
    if (!o.isMesh || keep.has(o) || o.material.transparent) continue;
    o.updateMatrix();
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    geo.applyMatrix4(o.matrix);
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(geo);
    g.remove(o);
  }
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    for (const gg of geos) gg.dispose();
    if (merged) g.add(new THREE.Mesh(merged, mat));
  }
}

/**
 * Third-person guns: bake every part (at any depth) into one mesh per material, except the
 * magazine (it animates on reload). Referenced parts are replaced by empty transforms so the
 * userData pointers stay valid. ~23 draw calls per held gun → ~5.
 */
function mergeDeep(g, parts) {
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const keep = new Set();
  parts.mag?.traverse((o) => keep.add(o));
  const byMat = new Map(), remove = [], m4 = new THREE.Matrix4();
  g.traverse((o) => {
    if (!o.isMesh || keep.has(o) || o.material.transparent) return;
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    geo.applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld));
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(geo);
    remove.push(o);
  });
  for (const o of remove) {
    const ph = new THREE.Object3D();
    ph.position.copy(o.position); ph.quaternion.copy(o.quaternion); ph.scale.copy(o.scale);
    for (const c of [...o.children]) ph.add(c);
    const par = o.parent, i = par.children.indexOf(o);
    par.children[i] = ph; ph.parent = par; o.parent = null;
    for (const k of Object.keys(parts)) if (parts[k] === o) parts[k] = ph;
  }
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    for (const gg of geos) gg.dispose();
    if (merged) g.add(new THREE.Mesh(merged, mat));
  }
}

/** withHands=false builds the third-person version held by character rigs. */
const proto = new Map();
export function buildGun(key, teamColor, withHands = true) {
  // build each (weapon, team, hands) combination once, then clone (clones share geometry)
  const k = `${key}|${teamColor}|${withHands}`;
  if (!proto.has(k)) {
    const w = WEAPONS[key];
    const g = new THREE.Group();
    NO_HANDS = !withHands;
    const parts = BUILD[key](g, w, teamColor);
    NO_HANDS = false;
    if (withHands) mergeStatic(g, new Set([parts.mag, parts.bolt]));
    else mergeDeep(g, parts);
    g.userData = parts;
    proto.set(k, g);
  }
  const src = proto.get(k);
  const g = src.clone(true);
  // re-point animated parts at the cloned objects
  const map = new Map();
  (function walk(a, b) { map.set(a, b); for (let i = 0; i < a.children.length; i++) walk(a.children[i], b.children[i]); })(src, g);
  const parts = { ...src.userData };
  for (const p of ['mag', 'bolt', 'cylinder']) if (parts[p]) parts[p] = map.get(parts[p]);
  parts.magBase = parts.mag.position.clone();
  parts.boltBase = parts.bolt.position.clone();
  parts.boltRot = parts.bolt.rotation.clone();
  g.userData = parts;
  g.traverse((o) => { if (o.isMesh) { o.castShadow = !withHands; o.receiveShadow = !withHands; } });
  return g;
}

// Brass casing geometry shared by the ejection effect
export const casingGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.018, 8);
export const casingMat = M.brass;
