import * as THREE from 'three';
import { WEAPONS } from './config.js';

// First-person weapon models built from primitives. Units are metres; the gun points down -Z
// with the grip near the origin. userData exposes parts that the animation code moves.

const M = {
  steel: new THREE.MeshStandardMaterial({ color: 0x1b1d21, metalness: 0.85, roughness: 0.38 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x101114, metalness: 0.6, roughness: 0.5 }),
  polymer: new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.05, roughness: 0.72 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x18191b, metalness: 0, roughness: 0.95 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xc89b3c, metalness: 1, roughness: 0.3 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0.9, roughness: 0.05, emissive: 0x0a1a2a }),
  lens: new THREE.MeshBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.12, depthWrite: false }),
  wood: new THREE.MeshStandardMaterial({ color: 0x6b4527, metalness: 0, roughness: 0.6 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0, roughness: 0.92 }),
  red: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
};
const accentCache = {};
const accent = (c) => (accentCache[c] ??= new THREE.MeshStandardMaterial({ color: c, metalness: 0.35, roughness: 0.55 }));
const sleeveCache = {};
const sleeve = (c) => (sleeveCache[c] ??= new THREE.MeshStandardMaterial({ color: new THREE.Color(0x24272d).lerp(new THREE.Color(c), 0.1), metalness: 0, roughness: 0.9 }));

function box(g, mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  g.add(m);
  return m;
}
function cyl(g, mat, r, len, x, y, z, seg = 14, r2 = r) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, len, seg), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

function hands(g, team, gripZ, foreZ, foreY = -0.035, pistol = false) {
  const sl = sleeve(team);
  // right hand on the grip, forearm runs back toward the bottom-right of the screen
  box(g, M.glove, 0.05, 0.075, 0.09, 0.012, -0.065, gripZ + 0.01, 0.3);
  box(g, M.glove, 0.018, 0.02, 0.05, -0.022, -0.02, gripZ - 0.03); // trigger finger
  const fa = box(g, sl, 0.075, 0.075, 0.34, 0.05, -0.13, gripZ + 0.2, 0.42, -0.12);
  fa.geometry.translate(0, 0, 0);
  box(g, M.glove, 0.06, 0.03, 0.06, 0.05, -0.115, gripZ + 0.05, 0.42, -0.12); // cuff
  // left hand
  if (pistol) {
    box(g, M.glove, 0.05, 0.07, 0.07, -0.035, -0.075, gripZ + 0.0, 0.3, 0.2);
    box(g, sl, 0.07, 0.07, 0.34, -0.12, -0.14, gripZ + 0.2, 0.42, 0.35);
  } else {
    box(g, M.glove, 0.055, 0.05, 0.08, -0.018, foreY - 0.02, foreZ, 0, 0, 0.35);
    box(g, sl, 0.075, 0.075, 0.42, -0.14, foreY - 0.11, foreZ + 0.22, 0.32, 0.5);
  }
}

function rifle(g, w, team) {
  const a = accent(w.color);
  box(g, M.steel, 0.05, 0.075, 0.34, 0, 0, -0.1);                         // receiver
  box(g, M.dark, 0.032, 0.012, 0.36, 0, 0.044, -0.13);                     // top rail
  for (let i = 0; i < 9; i++) box(g, M.steel, 0.036, 0.006, 0.012, 0, 0.052, -0.28 + i * 0.035);
  box(g, a, 0.058, 0.066, 0.3, 0, 0.002, -0.42);                           // handguard
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) box(g, M.dark, 0.004, 0.02, 0.04, s * 0.03, 0.005, -0.33 - i * 0.06);
  cyl(g, M.steel, 0.011, 0.2, 0, 0.004, -0.66);                             // barrel
  cyl(g, M.dark, 0.018, 0.07, 0, 0.004, -0.79, 6);                          // muzzle brake
  box(g, M.dark, 0.006, 0.03, 0.05, 0.027, 0.012, -0.06);                   // ejection port
  const bolt = box(g, M.steel, 0.012, 0.012, 0.025, 0.035, 0.02, -0.02);    // charging handle
  const mag = new THREE.Group(); mag.position.set(0, -0.06, -0.17); g.add(mag);
  box(mag, M.polymer, 0.034, 0.12, 0.068, 0, -0.05, 0, -0.18);
  box(mag, M.polymer, 0.034, 0.08, 0.066, 0, -0.14, 0.025, -0.42);
  box(g, M.polymer, 0.036, 0.1, 0.045, 0, -0.08, 0.015, 0.32);              // pistol grip
  box(g, M.dark, 0.008, 0.035, 0.05, 0, -0.045, -0.04);                     // trigger guard
  box(g, M.polymer, 0.045, 0.06, 0.2, 0, -0.012, 0.16);                     // stock
  box(g, M.rubber, 0.05, 0.11, 0.025, 0, -0.03, 0.27);                      // butt pad
  // red-dot sight
  box(g, M.dark, 0.026, 0.016, 0.05, 0, 0.058, -0.13);
  // open window housing: you look through it when aiming
  for (const [w, h, x, y] of [[0.044, 0.006, 0, 0.068], [0.044, 0.006, 0, 0.104], [0.006, 0.042, -0.019, 0.086], [0.006, 0.042, 0.019, 0.086]]) {
    box(g, M.steel, w, h, 0.05, x, y, -0.13);
  }
  box(g, M.lens, 0.032, 0.03, 0.002, 0, 0.086, -0.152);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0012, 8, 6), M.red); dot.position.set(0, 0.086, -0.15); g.add(dot);
  hands(g, team, 0.015, -0.4);
  return { tip: new THREE.Vector3(0, 0.004, -0.84), mag, bolt, eject: new THREE.Vector3(0.03, 0.012, -0.06), sightY: 0.086 };
}

function smg(g, w, team) {
  const a = accent(w.color);
  box(g, a, 0.052, 0.075, 0.28, 0, 0, -0.08);
  box(g, M.dark, 0.03, 0.01, 0.22, 0, 0.042, -0.09);
  cyl(g, M.steel, 0.02, 0.15, 0, 0.004, -0.29);
  cyl(g, M.dark, 0.012, 0.06, 0, 0.004, -0.39);
  const mag = new THREE.Group(); mag.position.set(0, -0.05, -0.11); g.add(mag);
  box(mag, M.polymer, 0.03, 0.17, 0.042, 0, -0.08, 0);
  box(g, M.polymer, 0.034, 0.095, 0.042, 0, -0.075, 0.02, 0.28);
  box(g, M.polymer, 0.028, 0.08, 0.032, 0, -0.07, -0.22);                    // foregrip
  box(g, M.steel, 0.008, 0.008, 0.18, 0.018, -0.005, 0.12);                  // wire stock
  box(g, M.steel, 0.008, 0.008, 0.18, -0.018, -0.005, 0.12);
  box(g, M.rubber, 0.045, 0.07, 0.015, 0, -0.01, 0.21);
  box(g, M.dark, 0.006, 0.025, 0.04, 0.027, 0.012, -0.04);
  const bolt = box(g, M.steel, 0.01, 0.012, 0.02, -0.03, 0.02, -0.12);
  box(g, M.steel, 0.006, 0.02, 0.01, 0, 0.05, -0.18);                        // iron sights
  box(g, M.steel, 0.02, 0.016, 0.01, 0, 0.05, 0.0);
  hands(g, team, 0.02, -0.22, -0.06);
  return { tip: new THREE.Vector3(0, 0.004, -0.42), mag, bolt, eject: new THREE.Vector3(0.028, 0.012, -0.04), sightY: 0.055 };
}

function pistol(g, w, team) {
  const a = accent(w.color);
  const slide = box(g, M.steel, 0.03, 0.034, 0.19, 0, 0.022, -0.07);
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) box(g, M.dark, 0.002, 0.024, 0.004, s * 0.0155, 0.022, 0.0 + i * 0.008);
  box(g, a, 0.028, 0.026, 0.16, 0, -0.008, -0.06);
  box(g, M.polymer, 0.03, 0.1, 0.045, 0, -0.065, 0.005, 0.22);
  box(g, M.dark, 0.006, 0.025, 0.045, 0, -0.03, -0.035);
  box(g, M.steel, 0.006, 0.01, 0.008, 0, 0.044, -0.155);
  box(g, M.steel, 0.02, 0.01, 0.008, 0, 0.044, 0.015);
  const mag = new THREE.Group(); mag.position.set(0, -0.11, 0.015); g.add(mag);
  box(mag, M.dark, 0.026, 0.02, 0.04, 0, 0, 0, 0.22);
  hands(g, team, 0.005, 0, 0, true);
  return { tip: new THREE.Vector3(0, 0.022, -0.17), mag, bolt: slide, eject: new THREE.Vector3(0.02, 0.03, -0.04), sightY: 0.045 };
}

function revolver(g, w, team) {
  box(g, M.steel, 0.032, 0.05, 0.1, 0, 0.005, -0.03);
  const mag = new THREE.Group(); mag.position.set(0, 0.006, -0.035); g.add(mag);
  const c = cyl(mag, M.steel, 0.026, 0.055, 0, 0, 0, 6);
  for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; cyl(mag, M.dark, 0.006, 0.056, Math.cos(a) * 0.016, Math.sin(a) * 0.016, 0, 8); }
  c.rotation.z = 0.2;
  cyl(g, M.steel, 0.011, 0.17, 0, 0.012, -0.17);
  box(g, M.steel, 0.014, 0.014, 0.17, 0, 0.026, -0.17);
  box(g, M.steel, 0.006, 0.012, 0.008, 0, 0.038, -0.245);
  box(g, M.wood, 0.03, 0.1, 0.045, 0, -0.065, 0.025, 0.35);
  const bolt = box(g, M.steel, 0.008, 0.02, 0.02, 0, 0.035, 0.025, -0.4);   // hammer
  box(g, M.dark, 0.006, 0.025, 0.04, 0, -0.03, -0.01);
  hands(g, team, 0.02, 0, 0, true);
  return { tip: new THREE.Vector3(0, 0.012, -0.26), mag, bolt, eject: null, sightY: 0.04 };
}

function sniper(g, w, team) {
  const a = accent(w.color);
  box(g, M.steel, 0.052, 0.07, 0.34, 0, 0, -0.08);
  box(g, a, 0.06, 0.07, 0.36, 0, -0.01, -0.42);                               // chassis forend
  cyl(g, M.steel, 0.013, 0.42, 0, 0.006, -0.78);
  cyl(g, M.dark, 0.022, 0.09, 0, 0.006, -1.02, 8);                            // suppressor-ish brake
  const mag = new THREE.Group(); mag.position.set(0, -0.06, -0.12); g.add(mag);
  box(mag, M.dark, 0.034, 0.07, 0.08, 0, -0.025, 0);
  box(g, M.polymer, 0.036, 0.1, 0.045, 0, -0.08, 0.04, 0.3);
  box(g, a, 0.048, 0.08, 0.26, 0, -0.02, 0.2);
  box(g, a, 0.04, 0.03, 0.14, 0, 0.035, 0.18);                                // cheek rest
  box(g, M.rubber, 0.05, 0.12, 0.025, 0, -0.03, 0.34);
  // scope
  cyl(g, M.dark, 0.021, 0.3, 0, 0.088, -0.1);
  cyl(g, M.dark, 0.032, 0.07, 0, 0.088, -0.28, 16, 0.022);
  cyl(g, M.dark, 0.027, 0.05, 0, 0.088, 0.07, 16, 0.021);
  cyl(g, M.glass, 0.03, 0.002, 0, 0.088, -0.316);
  for (const z of [-0.18, 0.0]) box(g, M.steel, 0.03, 0.04, 0.018, 0, 0.06, z);
  box(g, M.steel, 0.016, 0.016, 0.02, 0, 0.11, -0.08);                       // turret
  box(g, M.steel, 0.022, 0.016, 0.016, 0.03, 0.088, -0.08);
  const bolt = new THREE.Group(); bolt.position.set(0.035, 0.015, 0.02); g.add(bolt);
  box(bolt, M.steel, 0.04, 0.008, 0.008, 0.02, 0, 0);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), M.steel); knob.position.set(0.042, -0.006, 0); bolt.add(knob);
  hands(g, team, 0.04, -0.4);
  return { tip: new THREE.Vector3(0, 0.006, -1.07), mag, bolt, eject: new THREE.Vector3(0.03, 0.02, -0.04), sightY: 0.088 };
}

const BUILD = { p9: pistol, magnum: revolver, hornet: smg, raptor: rifle, longbow: sniper };

export function buildGun(key, teamColor) {
  const w = WEAPONS[key];
  const g = new THREE.Group();
  const parts = BUILD[key](g, w, teamColor);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  parts.magBase = parts.mag.position.clone();
  parts.boltBase = parts.bolt.position.clone();
  g.userData = parts;
  return g;
}

// Brass casing geometry shared by the ejection effect
export const casingGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.018, 6);
export const casingMat = M.brass;
