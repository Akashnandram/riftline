import * as THREE from 'three';
import { boxes } from './world.js';
import { buildGun } from './guns.js';

// Articulated soldier rig built from primitives: a joint hierarchy (hips → spine → chest → neck →
// head, shoulders → elbows → hands, thighs → knees → feet) animated procedurally, with two-bone
// IK keeping both hands on the gun, and a verlet ragdoll on death.
// Units are metres; feet at y=0, facing -Z. Head centre sits at ~1.62m to match the hitbox.

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DOWN = V(0, -1, 0), UP = V(0, 1, 0);
const L_UP = 0.29, L_FORE = 0.27, L_THIGH = 0.44, L_SHIN = 0.43, HIP_Y = 0.95;

// ---------------------------------------------------------------------------
// Shared materials / geometry
// ---------------------------------------------------------------------------
const matCache = new Map();
function mat(color, rough = 0.85, metal = 0, emissive = 0, ei = 0) {
  const k = `${color}|${rough}|${metal}|${emissive}|${ei}`;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity: ei }));
  return matCache.get(k);
}
const geoCache = new Map();
function geo(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }
const capG = (r, l) => geo(`cap${r}|${l}`, () => new THREE.CapsuleGeometry(r, l, 4, 10));
const boxG = (w, h, d) => geo(`box${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
const sphG = (r, ws = 16, hs = 12, ps = 0, pl = Math.PI * 2, ts = 0, tl = Math.PI) => geo(`sph${r}|${ws}|${hs}|${ps}|${pl}|${ts}|${tl}`, () => new THREE.SphereGeometry(r, ws, hs, ps, pl, ts, tl));
const cylG = (rt, rb, h, s = 12) => geo(`cyl${rt}|${rb}|${h}|${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));

function mesh(parent, g, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.scale.set(sx, sy, sz);
  o.castShadow = true; o.receiveShadow = true;
  parent.add(o);
  return o;
}
function joint(parent, x, y, z, name) {
  const j = new THREE.Group(); j.position.set(x, y, z); j.name = name; parent.add(j); return j;
}
/** Capsule limb hanging down from its joint. */
function limb(j, r, len, m) { return mesh(j, capG(r, len), m, 0, -len / 2, 0); }

// team fatigues + agent flavour
function palette(teamColor, agent) {
  const team = new THREE.Color(teamColor);
  const cloth = team.clone().lerp(new THREE.Color(0x3a3d42), 0.9).getHex();
  const cloth2 = new THREE.Color(cloth).multiplyScalar(0.8).getHex();
  return {
    cloth: mat(cloth, 0.95), cloth2: mat(cloth2, 0.95),
    vest: mat(team.clone().lerp(new THREE.Color(0x3b3f45), 0.72).getHex(), 0.8),
    team: mat(teamColor, 0.7),
    gear: mat(0x26282c, 0.75, 0.1),
    strap: mat(0x1a1b1e, 0.9),
    boot: mat(0x1e1c1a, 0.8),
    glove: mat(0x222428, 0.9),
    skin: mat({ volt: 0xc68a62, haze: 0xe0b896, aegis: 0x8d5a3b, hawk: 0xd9a37f }[agent.key] ?? 0xd2a07c, 0.7),
    accent: mat(new THREE.Color(agent.color).getHex(), 0.5, 0.1, new THREE.Color(agent.color).getHex(), 0.35),
    glow: mat(new THREE.Color(agent.color).getHex(), 0.3, 0, new THREE.Color(agent.color).getHex(), 1.6),
    metal: mat(0x4a4f57, 0.4, 0.8),
  };
}

function headgear(head, agent, P) {
  const hg = new THREE.Group(); head.add(hg);
  const k = agent.key;
  if (k === 'aegis') {          // full ballistic helmet with glowing visor
    mesh(hg, sphG(0.135, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), P.gear, 0, 0.12, 0.005);
    mesh(hg, boxG(0.2, 0.05, 0.03), P.glow, 0, 0.11, -0.115);
    mesh(hg, boxG(0.03, 0.06, 0.05), P.metal, 0.13, 0.1, -0.02);
    mesh(hg, boxG(0.03, 0.06, 0.05), P.metal, -0.13, 0.1, -0.02);
    return { group: hg, pops: true };
  }
  if (k === 'haze') {           // hood + face mask
    mesh(hg, sphG(0.14, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), P.cloth2, 0, 0.115, 0.02, -0.15);
    mesh(hg, boxG(0.17, 0.08, 0.05), P.strap, 0, 0.065, -0.095);
    mesh(hg, boxG(0.14, 0.015, 0.02), P.glow, 0, 0.115, -0.106);
    return { group: hg, pops: true };
  }
  if (k === 'hawk') {           // cap + headset
    mesh(hg, sphG(0.122, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), P.vest, 0, 0.13, 0);
    mesh(hg, boxG(0.16, 0.012, 0.12), P.vest, 0, 0.13, -0.12, 0.12);
    mesh(hg, cylG(0.035, 0.035, 0.03), P.gear, 0.118, 0.1, 0, 0, 0, Math.PI / 2);
    mesh(hg, cylG(0.035, 0.035, 0.03), P.gear, -0.118, 0.1, 0, 0, 0, Math.PI / 2);
    mesh(hg, boxG(0.012, 0.012, 0.09), P.accent, 0.12, 0.07, -0.06);
    return { group: hg, pops: true };
  }
  // volt: spiked hair + goggles (hair doesn't pop off)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    mesh(hg, cylG(0, 0.04, 0.12, 6), P.accent, Math.cos(a) * 0.05, 0.22, Math.sin(a) * 0.05 + 0.02, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
  }
  mesh(hg, sphG(0.118, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), mat(0x2a1d14, 0.9), 0, 0.12, 0.01);
  mesh(hg, boxG(0.2, 0.035, 0.03), P.strap, 0, 0.17, -0.1, -0.3);
  mesh(hg, boxG(0.07, 0.035, 0.02), P.glow, -0.04, 0.175, -0.112, -0.3);
  mesh(hg, boxG(0.07, 0.035, 0.02), P.glow, 0.04, 0.175, -0.112, -0.3);
  return { group: hg, pops: false };
}

const GHOST_MAT = new THREE.MeshBasicMaterial({ color: 0xff3355, transparent: true, opacity: 0.55, depthTest: false });
const MARKER_MAT = new Map();

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
export function buildCharacter(teamColor, agent) {
  const P = palette(teamColor, agent);
  const root = new THREE.Group();

  const hips = joint(root, 0, HIP_Y, 0, 'hips');
  mesh(hips, boxG(0.32, 0.17, 0.2), P.cloth, 0, 0, 0);
  mesh(hips, boxG(0.34, 0.05, 0.22), P.strap, 0, 0.07, 0);           // belt
  mesh(hips, boxG(0.07, 0.1, 0.06), P.gear, 0.16, 0.0, -0.04);        // holster pouch

  const spine = joint(hips, 0, 0.05, 0, 'spine');
  mesh(spine, boxG(0.29, 0.2, 0.19), P.cloth, 0, 0.08, 0);
  const chest = joint(spine, 0, 0.16, 0, 'chest');
  mesh(chest, boxG(0.36, 0.3, 0.21), P.cloth, 0, 0.12, 0);
  // plate carrier + pouches + backpack
  mesh(chest, boxG(0.38, 0.27, 0.26), P.vest, 0, 0.1, 0);
  for (let i = -1; i <= 1; i++) mesh(chest, boxG(0.085, 0.1, 0.05), P.gear, i * 0.1, 0.02, -0.15);
  mesh(chest, boxG(0.3, 0.025, 0.27), P.team, 0, 0.215, 0);           // team stripe across shoulders
  mesh(chest, boxG(0.26, 0.28, 0.12), P.gear, 0, 0.1, 0.18);          // backpack
  mesh(chest, boxG(0.04, 0.04, 0.12), P.accent, 0.1, 0.18, 0.18);      // agent tag on pack
  mesh(chest, boxG(0.05, 0.3, 0.03), P.strap, 0.12, 0.13, -0.14, 0, 0, 0.1);
  mesh(chest, boxG(0.05, 0.3, 0.03), P.strap, -0.12, 0.13, -0.14, 0, 0, -0.1);

  const neck = joint(chest, 0, 0.27, 0, 'neck');
  mesh(neck, cylG(0.055, 0.06, 0.12), P.skin, 0, 0.04, 0);
  const head = joint(neck, 0, 0.09, 0, 'head');
  mesh(head, sphG(0.11, 18, 14), P.skin, 0, 0.11, 0, 0, 0, 0, 0.92, 1.08, 1);
  mesh(head, boxG(0.06, 0.03, 0.03), P.skin, 0, 0.09, -0.105);        // nose/jaw hint
  const hg = headgear(head, agent, P);

  const sh = [], el = [], hand = [];
  for (const s of [-1, 1]) {
    const shoulder = joint(chest, s * 0.215, 0.22, 0, 'shoulder');
    mesh(shoulder, sphG(0.07, 12, 10), agent.key === 'aegis' ? P.metal : P.vest, 0, -0.01, 0, 0, 0, 0, 1.15, 0.9, 1.1);
    limb(shoulder, 0.056, L_UP, P.cloth);
    mesh(shoulder, boxG(0.115, 0.04, 0.115), P.team, 0, -0.1, 0);       // armband
    const elbow = joint(shoulder, 0, -L_UP, 0, 'elbow');
    limb(elbow, 0.05, L_FORE, P.cloth2);
    const h = joint(elbow, 0, -L_FORE, 0, 'hand');
    mesh(h, boxG(0.07, 0.09, 0.05), P.glove, 0, -0.035, 0);
    sh.push(shoulder); el.push(elbow); hand.push(h);
  }

  const thigh = [], knee = [], foot = [];
  for (const s of [-1, 1]) {
    const t = joint(hips, s * 0.1, -0.03, 0, 'thigh');
    limb(t, 0.078, L_THIGH, P.cloth);
    mesh(t, boxG(0.06, 0.1, 0.05), P.gear, s * 0.08, -0.2, 0);          // thigh pocket
    const k = joint(t, 0, -L_THIGH, 0, 'knee');
    limb(k, 0.062, L_SHIN, P.cloth2);
    mesh(k, boxG(0.1, 0.1, 0.05), P.gear, 0, -0.02, -0.06);             // knee pad
    const f = joint(k, 0, -L_SHIN, 0, 'foot');
    mesh(f, boxG(0.11, 0.09, 0.26), P.boot, 0, -0.035, -0.05);
    thigh.push(t); knee.push(k); foot.push(f);
  }

  const gunMount = joint(chest, 0.13, 0.15, -0.14, 'gunMount');

  // through-wall reveal silhouette + ally marker
  const ghostMat = GHOST_MAT;
  const ghost = new THREE.Group();
  const gb = new THREE.Mesh(capG(0.25, 0.9), ghostMat); gb.position.y = 0.8;
  const gh = new THREE.Mesh(sphG(0.14), ghostMat); gh.position.y = 1.62;
  ghost.add(gb, gh);
  ghost.renderOrder = gb.renderOrder = gh.renderOrder = 999;
  ghost.visible = false;
  root.add(ghost);
  if (!MARKER_MAT.has(teamColor)) MARKER_MAT.set(teamColor, new THREE.MeshBasicMaterial({ color: teamColor, depthTest: false, transparent: true, opacity: 0.85 }));
  const marker = new THREE.Mesh(geo('marker', () => new THREE.OctahedronGeometry(0.1)), MARKER_MAT.get(teamColor));
  marker.position.y = 2.2; marker.renderOrder = 998; marker.visible = false;
  root.add(marker);

  root.userData = {
    hips, spine, chest, neck, head, sh, el, hand, thigh, knee, foot, gunMount,
    headgear: hg, gun: null, gunKey: null, ghost, marker, phase: Math.random() * 6,
    flinch: V(), lean: 0, teamColor, ragdoll: null,
  };
  return root;
}

export function setCharacterGun(root, key) {
  const u = root.userData;
  if (u.gunKey === key) return;
  if (u.gun) u.gunMount.remove(u.gun);
  u.gun = buildGun(key, u.teamColor, false);
  u.gunKey = key;
  u.gunMount.add(u.gun);
  const pistol = !!u.gun.userData.pistol;
  u.gunMount.position.set(pistol ? 0.05 : 0.12, pistol ? 0.22 : 0.24, pistol ? -0.38 : -0.12);
}

// ---------------------------------------------------------------------------
// Two-bone IK (shoulder → elbow → hand), all in the chest's local space
// ---------------------------------------------------------------------------
const _d = V(), _dir = V(), _n = V(), _u = V(), _e = V(), _fv = V(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
function solveArm(shoulder, elbow, target, pole) {
  const s = shoulder.position;
  _d.subVectors(target, s);
  let dist = _d.length();
  const max = (L_UP + L_FORE) * 0.999;
  if (dist > max) { _d.multiplyScalar(max / dist); dist = max; }
  _dir.copy(_d).normalize();
  const cosA = THREE.MathUtils.clamp((L_UP * L_UP + dist * dist - L_FORE * L_FORE) / (2 * L_UP * dist), -1, 1);
  _n.crossVectors(_dir, pole);
  if (_n.lengthSq() < 1e-6) _n.set(1, 0, 0);
  _n.normalize();
  _u.copy(_dir).applyAxisAngle(_n, Math.acos(cosA));
  shoulder.quaternion.setFromUnitVectors(DOWN, _u);
  _e.copy(s).addScaledVector(_u, L_UP);
  _fv.copy(s).add(_d).sub(_e).normalize();
  _q.setFromUnitVectors(DOWN, _fv);
  _qi.copy(shoulder.quaternion).invert();
  elbow.quaternion.copy(_qi.multiply(_q));
}

const POLE_R = V(0.9, -1, 0.35).normalize(), POLE_L = V(-1, -0.8, 0.1).normalize();
const _tR = V(), _tL = V(), _m = new THREE.Matrix4();

// ---------------------------------------------------------------------------
// Per-frame animation
// ---------------------------------------------------------------------------
/**
 * s: { yaw, pitch, vel, onGround, kick (0..1), reload (0..1 or -1), speed }
 */
export function animateCharacter(root, s, dt) {
  const u = root.userData;
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw), rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
  const vf = s.vel.x * fx + s.vel.z * fz, vs = s.vel.x * rx + s.vel.z * rz;
  const speed = Math.hypot(vf, vs);
  const amp = Math.min(1, speed / 6.5);
  u.phase += speed * dt * 1.9;
  const fK = speed > 0.1 ? vf / speed : 0, sK = speed > 0.1 ? vs / speed : 0;
  const back = fK < -0.2 ? -1 : 1;

  for (let i = 0; i < 2; i++) {
    const ph = u.phase + i * Math.PI;
    const swing = Math.sin(ph) * 0.6 * amp;
    const t = u.thigh[i], k = u.knee[i], f = u.foot[i];
    if (!s.onGround) {
      t.rotation.set(0.45 - i * 0.3, 0, 0); k.rotation.set(-0.9 + i * 0.3, 0, 0); f.rotation.set(0.2, 0, 0);
      continue;
    }
    t.rotation.set(swing * (Math.abs(fK) + 0.25 * Math.abs(sK)) * back, 0, swing * sK * 0.55 + (i ? 0.03 : -0.03));
    const lift = Math.max(0, Math.cos(ph) * back);
    k.rotation.set(-(lift * 1.05 * amp + 0.05 + amp * 0.1), 0, 0);
    f.rotation.set(lift * 0.35 * amp - swing * 0.2, 0, 0);
  }

  const bobY = Math.abs(Math.sin(u.phase)) * 0.035 * amp;
  u.hips.position.y = HIP_Y - bobY - amp * 0.03 - (s.onGround ? 0 : 0.05);
  u.hips.rotation.y = Math.sin(u.phase) * 0.12 * amp;
  // strafing lean, running forward tilt
  u.lean += (sK * amp * 0.12 - u.lean) * Math.min(1, dt * 8);
  u.hips.rotation.z = -u.lean * 0.5;

  // flinch impulse decays
  u.flinch.multiplyScalar(Math.exp(-9 * dt));
  const breathe = Math.sin(performance.now() / 650) * 0.012;
  const pitch = THREE.MathUtils.clamp(s.pitch, -1.0, 1.0);
  u.spine.rotation.set(pitch * 0.35 + fK * amp * 0.12 + u.flinch.x, -u.hips.rotation.y * 0.8 + u.flinch.z, u.lean * 0.8 + u.flinch.y);
  u.chest.rotation.set(pitch * 0.45 + breathe, -u.hips.rotation.y * 0.2, 0);
  u.neck.rotation.set(pitch * 0.15, 0, -u.lean * 0.6);
  u.head.rotation.set(pitch * 0.1 - u.flinch.x * 1.5, 0, 0);

  // gun: recoil kick + reload tilt
  if (!u.gun) return;
  const g = u.gun, gd = g.userData;
  const rl = s.reload;
  const tilt = rl >= 0 ? Math.sin(Math.min(1, rl * 1.15) * Math.PI) : 0;
  g.position.set(0, -tilt * 0.06, s.kick * 0.04);
  g.rotation.set(s.kick * 0.08 - tilt * 0.35, 0, tilt * 0.6);
  if (gd.mag) {
    const out = rl > 0.12 && rl < 0.7 ? Math.min(1, (rl - 0.12) / 0.15) * (rl < 0.5 ? 1 : 1 - (rl - 0.5) / 0.2) : 0;
    gd.mag.position.copy(gd.magBase); gd.mag.position.y -= out * 0.25;
    gd.mag.visible = !(rl > 0.3 && rl < 0.45);
  }

  // hands onto the gun (targets → chest space)
  u.gunMount.updateMatrix(); g.updateMatrix();
  _m.multiplyMatrices(u.gunMount.matrix, g.matrix);
  _tR.copy(gd.grip).applyMatrix4(_m);
  _tL.copy(gd.fore);
  if (rl > 0.12 && rl < 0.7 && !gd.pistol) _tL.lerp(gd.mag ? V(0, -0.22, -0.17) : gd.fore, Math.sin((rl - 0.12) / 0.58 * Math.PI));
  _tL.applyMatrix4(_m);
  solveArm(u.sh[1], u.el[1], _tR, POLE_R);
  solveArm(u.sh[0], u.el[0], _tL, POLE_L);
  u.hand[1].rotation.set(0.4, 0, 0); u.hand[0].rotation.set(0.6, 0, 0);
}

export function flinch(root, dir, head) {
  const u = root.userData;
  if (!u || u.ragdoll) return;
  const k = head ? 0.3 : 0.16;
  u.flinch.x += (Math.random() * 0.5 + 0.5) * k * (head ? -1 : 1) * 0.6;
  u.flinch.y += (Math.random() - 0.5) * k;
  u.flinch.z += (Math.random() - 0.5) * k;
}

// ---------------------------------------------------------------------------
// Ragdoll (verlet particles + distance constraints)
// ---------------------------------------------------------------------------
const ragdolls = [];
const props = [];
const P_HIPS = 0, P_NECK = 1, P_HEAD = 2, P_SHL = 3, P_ELL = 4, P_HAL = 5, P_SHR = 6, P_ELR = 7, P_HAR = 8,
  P_HIL = 9, P_KNL = 10, P_FTL = 11, P_HIR = 12, P_KNR = 13, P_FTR = 14;
const LINKS = [
  [P_HIPS, P_NECK], [P_NECK, P_HEAD], [P_NECK, P_SHL], [P_NECK, P_SHR], [P_SHL, P_SHR],
  [P_SHL, P_HIPS], [P_SHR, P_HIPS], [P_SHL, P_HIR], [P_SHR, P_HIL], [P_HEAD, P_SHL], [P_HEAD, P_SHR],
  [P_SHL, P_ELL], [P_ELL, P_HAL], [P_SHR, P_ELR], [P_ELR, P_HAR],
  [P_HIPS, P_HIL], [P_HIPS, P_HIR], [P_HIL, P_HIR], [P_HIL, P_SHL], [P_HIR, P_SHR],
  [P_HIL, P_KNL], [P_KNL, P_FTL], [P_HIR, P_KNR], [P_KNR, P_FTR],
];
// keep limbs from folding flat onto themselves
const MIN_LINKS = [[P_SHL, P_HAL, 0.3], [P_SHR, P_HAR, 0.3], [P_HIL, P_FTL, 0.55], [P_HIR, P_FTR, 0.55], [P_HEAD, P_HIPS, 0.55]];

function wp(obj, local) { return obj.localToWorld(local ? local.clone() : V()); }

function collidePoint(p, prev, r) {
  if (p.y < r) {
    p.y = r;
    // ground friction
    prev.x += (p.x - prev.x) * 0.35; prev.z += (p.z - prev.z) * 0.35;
  }
  for (const b of boxes) {
    if (p.x > b.minX - r && p.x < b.maxX + r && p.y > b.minY - r && p.y < b.maxY + r && p.z > b.minZ - r && p.z < b.maxZ + r) {
      const pen = [[p.x - (b.minX - r), 'x', b.minX - r], [(b.maxX + r) - p.x, 'x', b.maxX + r], [p.y - (b.minY - r), 'y', b.minY - r],
        [(b.maxY + r) - p.y, 'y', b.maxY + r], [p.z - (b.minZ - r), 'z', b.minZ - r], [(b.maxZ + r) - p.z, 'z', b.maxZ + r]];
      pen.sort((a, c) => a[0] - c[0]);
      p[pen[0][1]] = pen[0][2];
      if (pen[0][1] === 'y') { prev.x += (p.x - prev.x) * 0.35; prev.z += (p.z - prev.z) * 0.35; }
    }
  }
}

/** dir: unit vector of the killing shot (world). headshot pops headgear. */
export function startRagdoll(root, scene, vel, dir, head) {
  const u = root.userData;
  if (u.ragdoll) return;
  root.updateMatrixWorld(true);
  const pts = [
    wp(u.hips), wp(u.neck), wp(u.head, V(0, 0.11, 0)),
    wp(u.sh[0]), wp(u.el[0]), wp(u.hand[0]),
    wp(u.sh[1]), wp(u.el[1]), wp(u.hand[1]),
    wp(u.thigh[0]), wp(u.knee[0]), wp(u.foot[0]),
    wp(u.thigh[1]), wp(u.knee[1]), wp(u.foot[1]),
  ];
  const dt = 1 / 60;
  const prev = pts.map((p) => p.clone().addScaledVector(vel, -dt * 0.8));
  const hitIdx = head ? P_HEAD : P_NECK;
  const push = dir ? dir.clone().setY(Math.max(0.1, dir.y)).normalize() : V(Math.random() - 0.5, 0.2, Math.random() - 0.5).normalize();
  for (let i = 0; i < pts.length; i++) {
    const k = i === hitIdx ? 5.5 : i <= P_HAR ? 2.2 : 0.8;
    prev[i].addScaledVector(push, -k * dt);
  }
  const rest = LINKS.map(([a, b]) => pts[a].distanceTo(pts[b]));

  // detach segments so each is driven directly by particles
  const holder = new THREE.Group();
  scene.add(holder);
  const segs = [u.hips, u.spine, u.neck, u.sh[0], u.el[0], u.sh[1], u.el[1], u.thigh[0], u.knee[0], u.thigh[1], u.knee[1]];
  for (const s of segs) holder.attach(s);

  // drop the gun, pop the helmet
  if (u.gun) {
    const g = u.gun; holder.attach(g);
    props.push(makeProp(g, vel.clone().addScaledVector(push, 1.5).add(V(0, 1.5, 0)), 0.06));
    u.gun = null; u.gunKey = null;
  }
  if (head && u.headgear.pops) {
    const h = u.headgear.group; holder.attach(h);
    props.push(makeProp(h, push.clone().multiplyScalar(4).add(V(0, 3.5, 0)), 0.1));
  }
  root.visible = true;
  u.ghost.visible = false; u.marker.visible = false;
  u.ragdoll = { pts, prev, rest, holder, t: 0, sleep: false };
  ragdolls.push(u.ragdoll);
  u.ragdoll.u = u;
}

function makeProp(obj, vel, r) {
  const p = obj.position, prev = p.clone().addScaledVector(vel, -1 / 60);
  return { obj, prev, r, spin: V((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12), t: 0 };
}

const _x = V(), _y = V(), _z = V(), _mb = new THREE.Matrix4(), _tmp = V();
function orientLimb(obj, a, b) {
  obj.position.copy(a);
  obj.quaternion.setFromUnitVectors(DOWN, _tmp.subVectors(b, a).normalize());
}

function poseRagdoll(r) {
  const u = r.u, p = r.pts;
  // torso frame from hips/neck/shoulders
  _y.subVectors(p[P_NECK], p[P_HIPS]).normalize();
  _x.subVectors(p[P_SHR], p[P_SHL]).normalize();
  _z.crossVectors(_x, _y).normalize();
  _x.crossVectors(_y, _z).normalize();
  _mb.makeBasis(_x, _y, _z);
  u.hips.position.copy(p[P_HIPS]); u.hips.quaternion.setFromRotationMatrix(_mb);
  u.spine.position.copy(p[P_HIPS]).addScaledVector(_y, 0.05); u.spine.quaternion.copy(u.hips.quaternion);
  u.neck.position.copy(p[P_NECK]);
  u.neck.quaternion.setFromUnitVectors(UP, _tmp.subVectors(p[P_HEAD], p[P_NECK]).normalize());
  orientLimb(u.sh[0], p[P_SHL], p[P_ELL]); orientLimb(u.el[0], p[P_ELL], p[P_HAL]);
  orientLimb(u.sh[1], p[P_SHR], p[P_ELR]); orientLimb(u.el[1], p[P_ELR], p[P_HAR]);
  orientLimb(u.thigh[0], p[P_HIL], p[P_KNL]); orientLimb(u.knee[0], p[P_KNL], p[P_FTL]);
  orientLimb(u.thigh[1], p[P_HIR], p[P_KNR]); orientLimb(u.knee[1], p[P_KNR], p[P_FTR]);
}

const G = 14;
function stepRagdoll(r, dt) {
  const { pts, prev, rest } = r;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = prev[i];
    const vx = (p.x - q.x) * 0.985, vy = (p.y - q.y) * 0.985, vz = (p.z - q.z) * 0.985;
    q.copy(p);
    p.x += vx; p.y += vy - G * dt * dt; p.z += vz;
  }
  for (let it = 0; it < 8; it++) {
    for (let l = 0; l < LINKS.length; l++) {
      const [a, b] = LINKS[l], pa = pts[a], pb = pts[b];
      _tmp.subVectors(pb, pa);
      const d = _tmp.length() || 1e-6, diff = (d - rest[l]) / d * 0.5;
      pa.addScaledVector(_tmp, diff); pb.addScaledVector(_tmp, -diff);
    }
    for (const [a, b, min] of MIN_LINKS) {
      const pa = pts[a], pb = pts[b];
      _tmp.subVectors(pb, pa);
      const d = _tmp.length() || 1e-6;
      if (d < min) { const diff = (d - min) / d * 0.5; pa.addScaledVector(_tmp, diff); pb.addScaledVector(_tmp, -diff); }
    }
    for (let i = 0; i < pts.length; i++) collidePoint(pts[i], prev[i], i === P_HEAD ? 0.11 : 0.07);
  }
}

function stepProp(p, dt) {
  const o = p.obj.position;
  const vx = (o.x - p.prev.x) * 0.99, vy = (o.y - p.prev.y) * 0.99, vz = (o.z - p.prev.z) * 0.99;
  p.prev.copy(o);
  o.x += vx; o.y += vy - G * dt * dt; o.z += vz;
  const onGround = o.y <= p.r + 0.001;
  if (o.y < p.r) { o.y = p.r; p.prev.y = o.y + vy * 0.35; p.spin.multiplyScalar(0.6); }
  collidePoint(o, p.prev, p.r);
  p.obj.rotation.x += p.spin.x * dt; p.obj.rotation.y += p.spin.y * dt; p.obj.rotation.z += p.spin.z * dt;
  if (onGround) {
    p.spin.multiplyScalar(0.9);
    // settle flat
    p.obj.rotation.x += (Math.round(p.obj.rotation.x / Math.PI) * Math.PI - p.obj.rotation.x) * 0.1;
    p.obj.rotation.z += (Math.round(p.obj.rotation.z / Math.PI) * Math.PI - p.obj.rotation.z) * 0.1;
  }
}

let acc = 0;
export function updateRagdolls(dt) {
  acc = Math.min(0.1, acc + dt);
  const h = 1 / 60;
  while (acc >= h) {
    acc -= h;
    for (const r of ragdolls) {
      if (r.sleep) continue;
      r.t += h;
      stepRagdoll(r, h);
      if (r.t > 4) r.sleep = true;
    }
    for (const p of props) { if ((p.t += h) < 4) stepProp(p, h); }
  }
  for (const r of ragdolls) if (!r.sleep || r.t < 4.05) poseRagdoll(r);
}

/** Remove all ragdolls / dropped props (round reset). */
export function clearRagdolls(scene) {
  for (const r of ragdolls) scene.remove(r.holder);
  ragdolls.length = 0; props.length = 0;
}
