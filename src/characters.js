import * as THREE from 'three';
import { boxesNear } from './world.js';
import { buildGun } from './guns.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { applySkin } from './skins.js';

// Articulated soldier rig: a bone hierarchy (hips → spine → chest → neck → head, shoulders →
// elbows → hands, thighs → knees → feet) animated procedurally, with two-bone IK keeping both hands
// on the gun, and a verlet ragdoll on death.
// The whole body is ONE skinned mesh (every part rigidly weighted to its bone) using one shared
// material whose colour, roughness, metalness and glow come from vertex attributes — so a fully
// detailed soldier costs a single draw call. Headgear is a second mesh so it can pop off.
// Units are metres; feet at y=0, facing -Z. Head centre sits at ~1.62m to match the hitbox.

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DOWN = V(0, -1, 0), UP = V(0, 1, 0);
const L_UP = 0.29, L_FORE = 0.27, L_THIGH = 0.44, L_SHIN = 0.43, HIP_Y = 0.95;

// ---------------------------------------------------------------------------
// Shared body material: per-vertex colour, roughness/metalness (rm) and emissive glow (emi)
// ---------------------------------------------------------------------------
function bodyMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 rm;\nattribute vec3 emi;\nvarying vec2 vRM;\nvarying vec3 vEmi;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRM = rm; vEmi = emi;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRM;\nvarying vec3 vEmi;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRM.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRM.y;')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += vEmi;');
  };
  m.customProgramCacheKey = () => 'riftline-body';
  return m;
}
const BODY_MAT = bodyMaterial();
// cartoon outline: the same mesh drawn again, pushed out along its normals, back faces only
const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x0c0e12, side: THREE.BackSide });
OUTLINE_MAT.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * 0.018;'); };
OUTLINE_MAT.customProgramCacheKey = () => 'riftline-outline';

/** A "material" here is just the per-vertex values that get baked in. */
const mat = (color, rough = 0.85, metal = 0, glow = 0) => ({ color: new THREE.Color(color), rough, metal, glow });

const geoCache = new Map();
function geo(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }
const capG = (r, l) => geo(`cap${r}|${l}`, () => new THREE.CapsuleGeometry(r, l, 3, 9));
const boxG = (w, h, d) => geo(`box${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
const rbG = (w, h, d, r = 0.02) => geo(`rb${w}|${h}|${d}|${r}`, () => new RoundedBoxGeometry(w, h, d, Math.max(w, h, d) > 0.25 ? 3 : 1, Math.min(r, Math.min(w, h, d) / 2.05)));
const sphG = (r, ws = 16, hs = 12, ps = 0, pl = Math.PI * 2, ts = 0, tl = Math.PI) => geo(`sph${r}|${ws}|${hs}|${ps}|${pl}|${ts}|${tl}`, () => new THREE.SphereGeometry(r, ws, hs, ps, pl, ts, tl));
const cylG = (rt, rb, h, s = 12) => geo(`cyl${rt}|${rb}|${h}|${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const torG = (r, t) => geo(`tor${r}|${t}`, () => new THREE.TorusGeometry(r, t, 6, 16));

// Parts are collected as plain records while building, then baked; no Mesh objects are created.
let PARTS = null;
function mesh(bone, g, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  PARTS.push({ bone, g, m, x, y, z, rx, ry, rz, sx, sy, sz });
}
function joint(parent, x, y, z, name) {
  const j = new THREE.Bone(); j.position.set(x, y, z); j.name = name; parent.add(j); return j;
}
/** Tapered limb hanging down from its joint: capsule core + a slightly narrower lower half. */
function limb(j, r, len, m, taper = 0.85) {
  mesh(j, capG(r, len * 0.55), m, 0, -len * 0.3, 0);
  mesh(j, capG(r * taper, len * 0.5), m, 0, -len * 0.68, 0);
}

// team fatigues + agent flavour
function palette(teamColor, agent) {
  const team = new THREE.Color(teamColor);
  // bold team-coloured suits (cartoon style): bright jacket, darker trousers, charcoal gear
  const cloth = team.clone().lerp(new THREE.Color(0x2a2d33), 0.3).getHex();
  const cloth2 = team.clone().lerp(new THREE.Color(0x1d2026), 0.62).getHex();
  const ac = new THREE.Color(agent.color).getHex();
  return {
    cloth: mat(cloth, 0.95), cloth2: mat(cloth2, 0.95),
    vest: mat(0x30343b, 0.75),
    webbing: mat(team.clone().lerp(new THREE.Color(0x2a2c30), 0.8).getHex(), 0.9),
    team: mat(teamColor, 0.6),
    gear: mat(0x26282c, 0.7, 0.1),
    strap: mat(0x1a1b1e, 0.9),
    boot: mat(0x24201c, 0.65), sole: mat(0x111111, 0.9),
    glove: mat(0x222428, 0.8),
    skin: mat({ volt: 0xc68a62, haze: 0xe0b896, aegis: 0x8d5a3b, hawk: 0xd9a37f }[agent.key] ?? 0xd2a07c, 0.55),
    lip: mat(new THREE.Color({ volt: 0xc68a62, haze: 0xe0b896, aegis: 0x8d5a3b, hawk: 0xd9a37f }[agent.key] ?? 0xd2a07c).multiplyScalar(0.78).getHex(), 0.5),
    eye: mat(0x101012, 0.2), brow: mat(0x241a12, 0.9),
    accent: mat(ac, 0.5, 0.1, 0.35),
    glow: mat(ac, 0.3, 0, 1.6),
    metal: mat(0x4a4f57, 0.35, 0.85),
    plate: mat(team.clone().lerp(new THREE.Color(0x555a62), 0.6).getHex(), 0.45, 0.6),
  };
}

function face(head, P) {
  mesh(head, sphG(0.108, 20, 16), P.skin, 0, 0.11, 0, 0, 0, 0, 0.9, 1.08, 1.0);         // cranium
  mesh(head, rbG(0.15, 0.085, 0.12, 0.035), P.skin, 0, 0.045, -0.025);                  // jaw
  mesh(head, rbG(0.03, 0.045, 0.035, 0.012), P.skin, 0, 0.1, -0.108);                   // nose
  for (const s of [-1, 1]) {
    mesh(head, sphG(0.028, 8, 6), P.skin, s * 0.098, 0.105, 0.005, 0, 0, 0, 0.45, 1, 0.8);  // ears
    mesh(head, sphG(0.012, 8, 6), P.eye, s * 0.036, 0.128, -0.095);                    // eyes
    mesh(head, boxG(0.034, 0.008, 0.012), P.brow, s * 0.037, 0.148, -0.097, 0, 0, s * -0.12);
  }
  mesh(head, boxG(0.045, 0.008, 0.01), P.lip, 0, 0.055, -0.1);
}

function headgear(head, agent, P) {
  const hg = new THREE.Group(); head.add(hg);
  const k = agent.key;
  if (k === 'aegis') {          // full ballistic helmet with glowing visor
    mesh(hg, sphG(0.135, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), P.gear, 0, 0.12, 0.005);
    mesh(hg, rbG(0.21, 0.055, 0.035, 0.015), P.glow, 0, 0.115, -0.115);
    for (const s of [-1, 1]) mesh(hg, rbG(0.03, 0.07, 0.06, 0.01), P.metal, s * 0.132, 0.1, -0.02);
    mesh(hg, rbG(0.06, 0.03, 0.04, 0.01), P.metal, 0, 0.255, -0.06);                   // NVG mount
    return { group: hg, pops: true };
  }
  if (k === 'haze') {           // hood + face mask
    mesh(hg, sphG(0.14, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), P.cloth2, 0, 0.115, 0.02, -0.15);
    mesh(hg, rbG(0.17, 0.08, 0.05, 0.02), P.strap, 0, 0.065, -0.095);
    mesh(hg, boxG(0.14, 0.015, 0.02), P.glow, 0, 0.12, -0.106);
    return { group: hg, pops: true };
  }
  if (k === 'hawk') {           // cap + headset
    mesh(hg, sphG(0.122, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), P.vest, 0, 0.13, 0);
    mesh(hg, rbG(0.16, 0.014, 0.12, 0.006), P.vest, 0, 0.13, -0.12, 0.12);
    for (const s of [-1, 1]) mesh(hg, cylG(0.036, 0.036, 0.03), P.gear, s * 0.118, 0.1, 0, 0, 0, Math.PI / 2);
    mesh(hg, torG(0.115, 0.008), P.gear, 0, 0.12, 0, 0, Math.PI / 2, 0, 1, 1.15, 1);
    mesh(hg, boxG(0.012, 0.012, 0.09), P.accent, 0.12, 0.07, -0.06);
    return { group: hg, pops: true };
  }
  // volt: spiked hair + goggles (hair doesn't pop off)
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    mesh(hg, cylG(0, 0.04, 0.12, 6), P.accent, Math.cos(a) * 0.05, 0.22, Math.sin(a) * 0.05 + 0.02, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
  }
  mesh(hg, sphG(0.118, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), mat(0x2a1d14, 0.9), 0, 0.12, 0.01);
  mesh(hg, rbG(0.21, 0.035, 0.03, 0.01), P.strap, 0, 0.17, -0.1, -0.3);
  for (const s of [-1, 1]) mesh(hg, rbG(0.07, 0.04, 0.025, 0.01), P.glow, s * 0.04, 0.175, -0.112, -0.3);
  return { group: hg, pops: false };
}

function torso(hips, spine, chest, agent, P) {
  // pelvis, belt, holster and dump pouch
  mesh(hips, rbG(0.33, 0.18, 0.21, 0.05), P.cloth, 0, 0, 0);
  mesh(hips, rbG(0.35, 0.05, 0.23, 0.015), P.strap, 0, 0.07, 0);
  mesh(hips, rbG(0.05, 0.04, 0.02, 0.008), P.metal, 0, 0.07, -0.118);                 // buckle
  mesh(hips, rbG(0.07, 0.14, 0.06, 0.015), P.gear, 0.19, -0.03, -0.02);                // holster
  mesh(hips, rbG(0.035, 0.06, 0.035, 0.01), P.strap, 0.19, 0.06, -0.02);               // pistol grip
  mesh(hips, rbG(0.11, 0.09, 0.07, 0.025), P.webbing, -0.12, -0.02, 0.1);              // dump pouch
  // waist + chest
  mesh(spine, rbG(0.29, 0.21, 0.19, 0.06), P.cloth, 0, 0.08, 0);
  mesh(chest, rbG(0.36, 0.31, 0.21, 0.07), P.cloth, 0, 0.12, 0);
  // plate carrier: front/back plates, cummerbund, webbing rows, pouches, radio
  mesh(chest, rbG(0.32, 0.27, 0.05, 0.02), P.vest, 0, 0.1, -0.12);
  mesh(chest, rbG(0.32, 0.29, 0.05, 0.02), P.vest, 0, 0.1, 0.115);
  mesh(chest, rbG(0.39, 0.13, 0.22, 0.03), P.vest, 0, 0.02, 0);
  for (let r = 0; r < 3; r++) mesh(chest, boxG(0.3, 0.008, 0.008), P.webbing, 0, 0.05 + r * 0.05, -0.147);
  for (let i = -1; i <= 1; i++) mesh(chest, rbG(0.085, 0.1, 0.05, 0.015), P.gear, i * 0.098, 0.02, -0.165);
  mesh(chest, rbG(0.12, 0.035, 0.012, 0.006), P.team, 0.06, 0.215, -0.15);            // name tape
  mesh(chest, rbG(0.05, 0.08, 0.04, 0.012), P.gear, -0.13, 0.17, -0.15);              // radio
  mesh(chest, cylG(0.005, 0.005, 0.22, 5), P.strap, -0.145, 0.32, -0.15);              // antenna
  mesh(chest, rbG(0.3, 0.025, 0.27, 0.01), P.team, 0, 0.225, 0);                        // team stripe
  // collar
  mesh(chest, torG(0.075, 0.025), P.vest, 0, 0.285, 0, Math.PI / 2, 0, 0, 1.05, 0.9, 1);
  // backpack + straps + hydration tube
  mesh(chest, rbG(0.26, 0.3, 0.13, 0.04), P.gear, 0, 0.1, 0.2);
  mesh(chest, rbG(0.2, 0.08, 0.06, 0.02), P.webbing, 0, 0.0, 0.28);
  mesh(chest, boxG(0.04, 0.04, 0.12), P.accent, 0.1, 0.18, 0.2);
  for (const s of [-1, 1]) mesh(chest, rbG(0.05, 0.3, 0.025, 0.008), P.strap, s * 0.12, 0.13, -0.142, 0, 0, s * 0.1);
  mesh(chest, cylG(0.008, 0.008, 0.3, 5), P.strap, 0.08, 0.15, -0.155, 0.2, 0, 0.3);
  if (agent.key === 'aegis') mesh(chest, rbG(0.3, 0.22, 0.03, 0.02), P.plate, 0, 0.12, -0.155);
}

const GHOST_MAT = new THREE.MeshBasicMaterial({ color: 0xff3355, transparent: true, opacity: 0.55, depthTest: false });
const MARKER_MAT = new Map();

// ---------------------------------------------------------------------------
// Bake: parts → one geometry with skinIndex/skinWeight and per-vertex material values
// ---------------------------------------------------------------------------
const _pm = new THREE.Matrix4(), _q0 = new THREE.Quaternion(), _e0 = new THREE.Euler(), _p0 = V(), _s0 = V();
function bake(parts, boneIndex, skinned) {
  const geos = [];
  for (const pt of parts) {
    const g0 = pt.g.index ? pt.g.toNonIndexed() : pt.g.clone();
    for (const k of Object.keys(g0.attributes)) if (k !== 'position' && k !== 'normal') g0.deleteAttribute(k);
    _pm.compose(_p0.set(pt.x, pt.y, pt.z), _q0.setFromEuler(_e0.set(pt.rx, pt.ry, pt.rz)), _s0.set(pt.sx, pt.sy, pt.sz));
    // into the bone's bind-pose space, then into rig (root) space
    _pm.premultiply(pt.bone.matrixWorld);
    g0.applyMatrix4(_pm);
    const n = g0.attributes.position.count;
    const col = new Float32Array(n * 3), rm = new Float32Array(n * 2), emi = new Float32Array(n * 3);
    const c = pt.m.color, gl = pt.m.glow;
    // baked shading: undersides and the lower part of each piece a little darker (cheap fake AO)
    g0.computeBoundingBox();
    const bb = g0.boundingBox, hy = Math.max(1e-4, bb.max.y - bb.min.y), pos = g0.attributes.position, nor = g0.attributes.normal;
    for (let i = 0; i < n; i++) {
      const ao = gl > 0.5 ? 1 : 1 - 0.28 * Math.max(0, -nor.getY(i)) - 0.1 * (1 - (pos.getY(i) - bb.min.y) / hy);
      col[i * 3] = c.r * ao; col[i * 3 + 1] = c.g * ao; col[i * 3 + 2] = c.b * ao;
      rm[i * 2] = pt.m.rough; rm[i * 2 + 1] = pt.m.metal;
      emi[i * 3] = c.r * gl; emi[i * 3 + 1] = c.g * gl; emi[i * 3 + 2] = c.b * gl;
    }
    g0.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g0.setAttribute('rm', new THREE.BufferAttribute(rm, 2));
    g0.setAttribute('emi', new THREE.BufferAttribute(emi, 3));
    if (skinned) {
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), b = boneIndex.get(pt.bone);
      for (let i = 0; i < n; i++) { si[i * 4] = b; sw[i * 4] = 1; }
      g0.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      g0.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    }
    geos.push(g0);
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return merged;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
const rigCache = new Map();   // teamColor|agent → { body, head } baked geometries
export function buildCharacter(teamColor, agent) {
  const P = palette(teamColor, agent);
  const root = new THREE.Group();
  const key = teamColor + '|' + agent.key;
  const cached = rigCache.get(key);
  PARTS = [];

  const hips = joint(root, 0, HIP_Y, 0, 'hips');
  const spine = joint(hips, 0, 0.05, 0, 'spine');
  const chest = joint(spine, 0, 0.16, 0, 'chest');
  const neck = joint(chest, 0, 0.27, 0, 'neck');
  const head = joint(neck, 0, 0.09, 0, 'head');
  if (!cached) {
    torso(hips, spine, chest, agent, P);
    mesh(neck, cylG(0.052, 0.06, 0.12), P.skin, 0, 0.04, 0);
    face(head, P);
  }

  const sh = [], el = [], hand = [];
  for (const s of [-1, 1]) {
    const shoulder = joint(chest, s * 0.215, 0.22, 0, 'shoulder');
    const elbow = joint(shoulder, 0, -L_UP, 0, 'elbow');
    const h = joint(elbow, 0, -L_FORE, 0, 'hand');
    if (!cached) {
      mesh(shoulder, sphG(0.066, 12, 10), agent.key === 'aegis' ? P.plate : P.cloth, 0, -0.01, 0, 0, 0, 0, 1.08, 0.9, 1.05);
      limb(shoulder, 0.057, L_UP, P.cloth, 0.9);
      mesh(shoulder, rbG(0.12, 0.045, 0.12, 0.015), P.team, 0, -0.1, 0);                 // armband
      limb(elbow, 0.05, L_FORE, P.cloth2, 0.82);
      mesh(elbow, rbG(0.085, 0.07, 0.09, 0.025), P.gear, 0, -0.01, 0.02);                // elbow pad
      mesh(elbow, cylG(0.046, 0.042, 0.06), P.glove, 0, -L_FORE + 0.03, 0);               // glove cuff
      // glove: palm, finger block, thumb
      mesh(h, rbG(0.07, 0.075, 0.045, 0.015), P.glove, 0, -0.03, 0);
      mesh(h, rbG(0.066, 0.05, 0.04, 0.014), P.glove, 0, -0.085, -0.008, 0.35);
      mesh(h, rbG(0.022, 0.05, 0.022, 0.008), P.glove, s * -0.04, -0.035, -0.02, 0, 0, s * 0.5);
    }
    sh.push(shoulder); el.push(elbow); hand.push(h);
  }

  const thigh = [], knee = [], foot = [];
  for (const s of [-1, 1]) {
    const t = joint(hips, s * 0.1, -0.03, 0, 'thigh');
    const k = joint(t, 0, -L_THIGH, 0, 'knee');
    const f = joint(k, 0, -L_SHIN, 0, 'foot');
    if (!cached) {
      limb(t, 0.08, L_THIGH, P.cloth, 0.82);
      mesh(t, rbG(0.06, 0.11, 0.07, 0.02), P.cloth2, s * 0.075, -0.22, 0);                  // cargo pocket
      mesh(t, rbG(0.05, 0.025, 0.08, 0.008), P.strap, s * 0.07, -0.08, 0);                  // leg strap
      limb(k, 0.063, L_SHIN, P.cloth2, 0.85);
      mesh(k, rbG(0.105, 0.11, 0.06, 0.028), P.gear, 0, -0.03, -0.06);                      // knee pad
      // boot: shaft, foot, toe cap, sole
      mesh(f, cylG(0.06, 0.065, 0.12), P.boot, 0, 0.0, 0.0);
      mesh(f, rbG(0.11, 0.08, 0.24, 0.03), P.boot, 0, -0.04, -0.05);
      mesh(f, rbG(0.105, 0.05, 0.07, 0.022), P.boot, 0, -0.05, -0.15);
      mesh(f, rbG(0.12, 0.02, 0.27, 0.008), P.sole, 0, -0.082, -0.055);
    }
    thigh.push(t); knee.push(k); foot.push(f);
  }

  const gunMount = joint(chest, 0.13, 0.15, -0.14, 'gunMount');
  const bones = [hips, spine, chest, neck, head, ...sh, ...el, ...hand, ...thigh, ...knee, ...foot, gunMount];
  root.updateMatrixWorld(true);

  // headgear: its own little mesh under the head bone (so a headshot can knock it off)
  const hgRec = cached ? null : (() => { const before = PARTS.length; const r = headgear(head, agent, P); return { r, parts: PARTS.splice(before) }; })();
  let entry = cached;
  if (!entry) {
    const boneIndex = new Map(bones.map((b, i) => [b, i]));
    const hgGroup = hgRec.r.group;
    hgGroup.updateMatrixWorld(true);
    // headgear parts are baked relative to the head-gear group (identity under the head bone)
    const inv = new THREE.Matrix4().copy(hgGroup.matrixWorld).invert();
    const hgParts = hgRec.parts.map((p) => ({ ...p, bone: { matrixWorld: new THREE.Matrix4().multiplyMatrices(inv, p.bone.matrixWorld) } }));
    entry = { body: bake(PARTS, boneIndex, true), head: bake(hgParts, null, false), pops: hgRec.r.pops };
    head.remove(hgGroup);
    rigCache.set(key, entry);
  }
  PARTS = null;

  const skeleton = new THREE.Skeleton(bones);
  const body = new THREE.SkinnedMesh(entry.body, BODY_MAT);
  body.castShadow = true; body.receiveShadow = true;
  body.boundingSphere = new THREE.Sphere(V(0, 0.95, 0), 1.4);   // fixed bounds: no per-vertex skinning pass on the CPU
  root.add(body);
  body.bind(skeleton);
  const outline = new THREE.SkinnedMesh(entry.body, OUTLINE_MAT);
  outline.boundingSphere = body.boundingSphere;
  root.add(outline);
  outline.bind(skeleton, body.bindMatrix);

  const hg = new THREE.Group(); head.add(hg);
  const hgMesh = new THREE.Mesh(entry.head, BODY_MAT);
  hgMesh.castShadow = true; hg.add(hgMesh);
  hg.add(new THREE.Mesh(entry.head, OUTLINE_MAT));

  // through-wall reveal silhouette + ally marker
  const ghost = new THREE.Group();
  const gb = new THREE.Mesh(capG(0.25, 0.9), GHOST_MAT); gb.position.y = 0.8;
  const gh = new THREE.Mesh(sphG(0.14), GHOST_MAT); gh.position.y = 1.62;
  ghost.add(gb, gh);
  ghost.renderOrder = gb.renderOrder = gh.renderOrder = 999;
  ghost.visible = false;
  root.add(ghost);
  if (!MARKER_MAT.has(teamColor)) MARKER_MAT.set(teamColor, new THREE.MeshBasicMaterial({ color: teamColor, depthTest: false, transparent: true, opacity: 0.85 }));
  const marker = new THREE.Mesh(geo('marker', () => new THREE.OctahedronGeometry(0.1)), MARKER_MAT.get(teamColor));
  marker.position.y = 2.2; marker.renderOrder = 998; marker.visible = false;
  root.add(marker);

  root.userData = {
    hips, spine, chest, neck, head, sh, el, hand, thigh, knee, foot, gunMount, body, outline, skeleton,
    headgear: { group: hg, pops: entry.pops }, gun: null, gunKey: null, ghost, marker, phase: Math.random() * 6,
    flinch: V(), lean: 0, teamColor, ragdoll: null, land: 0, wasGround: true, lastYaw: 0, turnPhase: 0, animAcc: 0,
  };
  return root;
}

/** Free a rig's per-instance GPU data (the bone texture). Geometry is shared and kept. */
export function disposeCharacter(root) {
  root?.userData?.skeleton?.dispose();
}

export function setCharacterGun(root, key, skin = 'default') {
  const u = root.userData;
  if (u.gunKey === key && u.gunSkin === skin) return;
  if (u.gun) u.gunMount.remove(u.gun);
  u.gun = applySkin(buildGun(key, u.teamColor, false), skin);
  u.gunKey = key; u.gunSkin = skin;
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
  let speed = Math.hypot(vf, vs);
  // turning on the spot: shuffle the feet a little instead of sliding
  const yawRate = dt > 0 ? Math.abs(Math.atan2(Math.sin(s.yaw - u.lastYaw), Math.cos(s.yaw - u.lastYaw))) / dt : 0;
  u.lastYaw = s.yaw;
  if (speed < 0.6 && yawRate > 1.2 && s.onGround) speed = Math.min(2.2, yawRate * 0.5);
  const amp = Math.min(1, speed / 6.5);
  u.phase += speed * dt * 1.9;
  const fK = speed > 0.1 ? vf / (Math.hypot(vf, vs) || 1) : 0, sK = speed > 0.1 ? vs / (Math.hypot(vf, vs) || 1) : 0;
  const back = fK < -0.2 ? -1 : 1;
  const c = s.slide ? 0 : (s.crouch || 0);
  const sp = s.sprint ? 1 : 0;
  // landing: knees soak up the impact for a moment
  if (s.onGround && !u.wasGround) u.land = Math.min(1, u.land + 0.8);
  u.wasGround = s.onGround;
  u.land = Math.max(0, u.land - dt * 4);
  const land = Math.sin(u.land * Math.PI * 0.5);

  for (let i = 0; i < 2; i++) {
    const ph = u.phase + i * Math.PI;
    const swing = Math.sin(ph) * 0.6 * amp;
    const t = u.thigh[i], k = u.knee[i], f = u.foot[i];
    if (!s.onGround) {
      // airborne: tuck one leg, reach with the other
      t.rotation.set(0.5 - i * 0.35, 0, i ? 0.04 : -0.04); k.rotation.set(-1.0 + i * 0.35, 0, 0); f.rotation.set(0.25, 0, 0);
      continue;
    }
    t.rotation.set(swing * (Math.abs(fK) + 0.25 * Math.abs(sK)) * back, 0, swing * sK * 0.55 + (i ? 0.03 : -0.03));
    const lift = Math.max(0, Math.cos(ph) * back);
    k.rotation.set(-(lift * 1.05 * amp + 0.05 + amp * 0.1), 0, 0);
    f.rotation.set(lift * 0.35 * amp - swing * 0.2, 0, 0);
    if (c > 0.01) {
      // crouch: thighs forward, knees folded, feet flat; a small shuffle when moving
      t.rotation.x += (1.15 + swing * 0.35 - t.rotation.x) * c;
      k.rotation.x += (-2.0 + lift * 0.3 - k.rotation.x) * c;
      f.rotation.x += (0.85 - f.rotation.x) * c;
    }
    if (land > 0) { t.rotation.x += land * 0.55; k.rotation.x -= land * 1.0; f.rotation.x += land * 0.45; }
    if (s.slide) {
      // feet-first slide: lead leg out straight, the other tucked under
      t.rotation.set(i ? 1.45 : 1.1, 0, i ? 0.05 : -0.12); k.rotation.set(i ? -0.15 : -1.7, 0, 0); f.rotation.set(i ? -0.2 : 0.6, 0, 0);
    }
  }

  // pelvis: dips twice per stride, sways side to side over the planted foot
  const bobY = Math.abs(Math.sin(u.phase)) * 0.035 * amp;
  const idle = 1 - Math.min(1, speed / 1.5);
  const tNow = performance.now() / 1000;
  u.hips.position.y = HIP_Y - bobY * (1 - c * 0.6) - amp * 0.03 - (s.onGround ? 0 : 0.05) - 0.42 * c - land * 0.12 - (s.slide ? 0.55 : 0);
  u.hips.position.x = Math.cos(u.phase) * 0.025 * amp + Math.sin(tNow * 0.6 + u.phase) * 0.008 * idle;   // weight shift at rest
  u.hips.rotation.y = Math.sin(u.phase) * 0.12 * amp;
  // strafing lean, running forward tilt
  u.lean += (sK * amp * 0.12 - u.lean) * Math.min(1, dt * 8);
  u.hips.rotation.z = -u.lean * 0.5;

  // flinch impulse decays
  u.flinch.multiplyScalar(Math.exp(-9 * dt));
  const breathe = Math.sin(performance.now() / 650) * 0.012;
  const pitch = THREE.MathUtils.clamp(s.pitch, -1.0, 1.0);
  u.spine.rotation.set(pitch * 0.35 + fK * amp * 0.12 + u.flinch.x - 0.22 * c + sp * 0.22 - (s.slide ? 0.55 : 0), -u.hips.rotation.y * 0.8 + u.flinch.z, u.lean * 0.8 + u.flinch.y);
  u.chest.rotation.set(pitch * 0.45 + breathe + 0.12 * c + land * 0.12, -u.hips.rotation.y * 0.2, -u.hips.rotation.z * 0.5);
  // head stays level and on target while the body bobs
  u.neck.rotation.set(pitch * 0.15 - land * 0.1, -u.spine.rotation.y * 0.5, -u.lean * 0.6);
  u.head.rotation.set(pitch * 0.1 - u.flinch.x * 1.5 - fK * amp * 0.08, 0, -u.hips.rotation.z * 0.6);

  // gun: recoil kick + reload tilt
  if (!u.gun) return;
  const g = u.gun, gd = g.userData;
  const rl = s.reload;
  const tilt = rl >= 0 ? Math.sin(Math.min(1, rl * 1.15) * Math.PI) : 0;
  // the gun rides with the stride a little
  const sway = Math.sin(u.phase * 2) * 0.012 * amp, swayX = Math.cos(u.phase) * 0.01 * amp;
  g.position.set(swayX, -tilt * 0.06 + sway - land * 0.03, s.kick * 0.04);
  g.rotation.set(s.kick * 0.08 - tilt * 0.35 + sway * 2 - sp * 0.7, swayX * 2 + sp * 0.5, tilt * 0.6);
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
  for (const b of boxesNear(p.x - r, p.z - r, p.x + r, p.z + r)) {
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
  if (u.body) { u.body.frustumCulled = false; if (u.outline) u.outline.frustumCulled = false; }
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

/** Remove one fighter's ragdoll (respawn modes). */
export function removeRagdoll(root, scene) {
  const r = root.userData.ragdoll;
  if (!r) return;
  scene.remove(r.holder);
  const i = ragdolls.indexOf(r); if (i >= 0) ragdolls.splice(i, 1);
  for (let k = props.length - 1; k >= 0; k--) if (props[k].obj.parent === r.holder || !props[k].obj.parent) props.splice(k, 1);
}

/** Remove all ragdolls / dropped props (round reset). */
export function clearRagdolls(scene) {
  for (const r of ragdolls) scene.remove(r.holder);
  ragdolls.length = 0; props.length = 0;
}
