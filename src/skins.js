import * as THREE from 'three';
import { materialRole } from './guns.js';

// Weapon skins: each one restyles the gun's accent furniture, metal and polymer parts.
// Unlocked by levelling up (see progress.js); any unlocked skin can go on any gun.

function patternTex(draw, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const rnd = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

function camo(colors, seed) {
  return patternTex((g, s) => {
    const r = rnd(seed);
    g.fillStyle = colors[0]; g.fillRect(0, 0, s, s);
    for (let layer = 1; layer < colors.length; layer++) {
      g.fillStyle = colors[layer];
      for (let i = 0; i < 18; i++) {
        const x = r() * s, y = r() * s, rad = 14 + r() * 34;
        g.beginPath();
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2, rr = rad * (0.6 + r() * 0.6);
          k ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        g.closePath(); g.fill();
      }
    }
  });
}
const tiger = () => patternTex((g, s) => {
  g.fillStyle = '#e07a1f'; g.fillRect(0, 0, s, s);
  g.fillStyle = '#16120e';
  for (let i = 0; i < 14; i++) {
    const y = (i / 14) * s + Math.sin(i) * 6;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= s; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 8 - (x % 32 ? 4 : 0));
    for (let x = s; x >= 0; x -= 16) g.lineTo(x, y + 6 + Math.sin(x * 0.07 + i * 2) * 3);
    g.closePath(); g.fill();
  }
});
const carbon = () => patternTex((g, s) => {
  const n = 16, cs = s / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const grd = (x + y) % 2 ? g.createLinearGradient(x * cs, y * cs, x * cs + cs, y * cs) : g.createLinearGradient(x * cs, y * cs, x * cs, y * cs + cs);
    grd.addColorStop(0, '#1b1d21'); grd.addColorStop(0.5, '#3a3e45'); grd.addColorStop(1, '#1b1d21');
    g.fillStyle = grd; g.fillRect(x * cs, y * cs, cs, cs);
  }
});
const neonLines = () => patternTex((g, s) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
  g.strokeStyle = '#ffffff'; g.lineWidth = 3;
  for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(0, i * s / 6 + 10); g.lineTo(s * 0.4, i * s / 6 + 10); g.lineTo(s * 0.55, i * s / 6 + 30); g.lineTo(s, i * s / 6 + 30); g.stroke(); }
});

const std = (o) => new THREE.MeshStandardMaterial(o);

// level = player level that unlocks it
export const SKINS = [
  { key: 'default', name: 'Factory', level: 1, swatch: '#8a7d62' },
  { key: 'arctic', name: 'Arctic', level: 2, swatch: '#d9dee3', make: () => ({ accent: std({ map: camo(['#e6eaee', '#b9c2cb', '#8d98a3', '#5e6872'], 7), roughness: 0.7 }) }) },
  { key: 'jungle', name: 'Jungle', level: 3, swatch: '#4f6b3a', make: () => ({ accent: std({ map: camo(['#5a6b3b', '#3c4a29', '#7b6a43', '#252b1c'], 11), roughness: 0.75 }) }) },
  { key: 'tiger', name: 'Tiger', level: 4, swatch: '#e07a1f', make: () => ({ accent: std({ map: tiger(), roughness: 0.55 }) }) },
  { key: 'carbon', name: 'Carbon', level: 5, swatch: '#2b2f35', make: () => ({ accent: std({ map: carbon(), roughness: 0.35, metalness: 0.3 }), polymer: std({ map: carbon(), roughness: 0.4, metalness: 0.2 }) }) },
  { key: 'crimson', name: 'Crimson', level: 6, swatch: '#a3222c', make: () => ({ accent: std({ color: 0xa3222c, roughness: 0.3, metalness: 0.7 }), metal: std({ color: 0x3a1c20, roughness: 0.35, metalness: 0.9 }) }) },
  { key: 'desert', name: 'Desert', level: 7, swatch: '#c7a36b', make: () => ({ accent: std({ map: camo(['#c9ab78', '#a88a5a', '#e0caa0', '#7d6544'], 23), roughness: 0.8 }), polymer: std({ color: 0x8a7350, roughness: 0.8 }) }) },
  { key: 'neon', name: 'Neon', level: 8, swatch: '#3ee6d6', make: () => ({ accent: std({ color: 0x15181d, emissive: 0x3ee6d6, emissiveMap: neonLines(), emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.4 }), polymer: std({ color: 0x15181d, roughness: 0.5 }) }) },
  { key: 'gold', name: 'Gold', level: 10, swatch: '#d4af37', make: () => ({ accent: std({ color: 0x1b1c20, roughness: 0.4, metalness: 0.5 }), metal: std({ color: 0xd4af37, roughness: 0.22, metalness: 1 }), dark: std({ color: 0x9c7a22, roughness: 0.3, metalness: 1 }) }) },
];
export const SKIN_BY_KEY = Object.fromEntries(SKINS.map((s) => [s.key, s]));

const built = new Map();
function skinMats(key) {
  if (!built.has(key)) built.set(key, SKIN_BY_KEY[key]?.make?.() || {});
  return built.get(key);
}

/** Restyle a built gun (from buildGun) with a skin. Safe on clones: only swaps material refs. */
export function applySkin(gun, key) {
  if (!key || key === 'default') return gun;
  const mats = skinMats(key);
  gun.traverse((o) => {
    if (!o.isMesh) return;
    const role = materialRole(o.material);
    if (role && mats[role]) o.material = mats[role];
  });
  return gun;
}
