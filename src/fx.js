import * as THREE from 'three';
import { game } from './state.js';
import { bulletHoleTexture, flashTexture, softTexture } from './textures.js';

const live = []; // { obj, t, life, update(k, dt), shared }

function addFx(obj, life, update, shared = false) {
  game.scene.add(obj);
  live.push({ obj, t: 0, life, update, shared });
}

const G = {
  cyl: new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2),
  chip: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 20, 12),
  ring: new THREE.RingGeometry(0.85, 1, 48),
  plane: new THREE.PlaneGeometry(1, 1),
};

export function tracer(from, to, color = 0xfff2b0, width = 0.012, life = 0.06) {
  const len = from.distanceTo(to);
  if (len < 0.3) return;
  const m = new THREE.Mesh(G.cyl, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.position.copy(from);
  m.scale.set(width, width, len);
  m.lookAt(to);
  addFx(m, life, (k) => { m.material.opacity = 0.75 * (1 - k); }, true);
}

/** Additive world-space muzzle flash sprite (for third-person shooters). */
export function muzzleSprite(pos, size = 0.45) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), color: 0xffe0a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, rotation: Math.random() * 6 }));
  s.position.copy(pos);
  s.scale.setScalar(size);
  addFx(s, 0.05, (k) => { s.material.opacity = 1 - k; }, true);
}

const SURF = {
  concrete: { chip: 0x8d8a85, dust: 0xb8b2a6, n: 6, spark: 0 },
  floor: { chip: 0x6f7378, dust: 0x9a9c9e, n: 5, spark: 0 },
  wood: { chip: 0x7a4d24, dust: 0xa57d52, n: 7, spark: 0 },
  metal: { chip: 0x555a62, dust: 0x888888, n: 2, spark: 9 },
  energy: { chip: 0x3ee6d6, dust: 0x3ee6d6, n: 0, spark: 6 },
};

function particle(pos, vel, color, size, life, grav, additive = false) {
  const m = new THREE.Mesh(G.chip, new THREE.MeshBasicMaterial({ color, transparent: true, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !additive }));
  m.position.copy(pos);
  m.scale.setScalar(size);
  m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
  addFx(m, life, (k, dt) => {
    vel.y -= grav * dt;
    m.position.addScaledVector(vel, dt);
    if (m.position.y < 0.01) { m.position.y = 0.01; vel.set(vel.x * 0.4, -vel.y * 0.3, vel.z * 0.4); }
    m.material.opacity = 1 - k * k;
    if (additive) m.scale.setScalar(size * (1 - k));
  }, true);
}

function dustPuff(pos, normal, color) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color, transparent: true, depthWrite: false, opacity: 0.55 }));
  s.position.copy(pos).addScaledVector(normal, 0.08);
  const drift = normal.clone().multiplyScalar(0.6).add(new THREE.Vector3(0, 0.25, 0));
  addFx(s, 0.7, (k, dt) => {
    s.position.addScaledVector(drift, dt);
    s.scale.setScalar(0.12 + k * 0.55);
    s.material.opacity = 0.55 * (1 - k);
  }, true);
}

/** Bullet impact on a surface: debris, sparks and dust. */
export function impact(pos, normal, kind) {
  const s = SURF[kind] || SURF.concrete;
  const _v = () => normal.clone().multiplyScalar(1.5 + Math.random() * 2.5)
    .add(new THREE.Vector3((Math.random() - 0.5) * 2.5, Math.random() * 2, (Math.random() - 0.5) * 2.5));
  for (let i = 0; i < s.n; i++) particle(pos, _v(), s.chip, 0.015 + Math.random() * 0.02, 0.5 + Math.random() * 0.4, 12);
  for (let i = 0; i < s.spark; i++) particle(pos, _v().multiplyScalar(1.8), 0xffc060, 0.012, 0.18 + Math.random() * 0.15, 6, true);
  if (s.n) dustPuff(pos, normal, s.dust);
  const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color: kind === 'energy' ? 0x3ee6d6 : 0xffd9a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  f.position.copy(pos).addScaledVector(normal, 0.03);
  f.scale.setScalar(0.18);
  addFx(f, 0.06, (k) => { f.material.opacity = 1 - k; }, true);
}

// ---- Persistent bullet holes: one instanced mesh (a single draw call), cleared every round ----
const HOLES_MAX = 220;
let holes = null, holeI = 0, holeCount = 0;
const _ho = new THREE.Object3D();
export function bulletHole(pos, normal, kind) {
  if (kind === 'energy') return;
  if (!holes || !holes.parent) {
    const mat = new THREE.MeshStandardMaterial({ map: bulletHoleTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 });
    holes = new THREE.InstancedMesh(G.plane, mat, HOLES_MAX);
    holes.count = 0; holes.receiveShadow = true; holes.frustumCulled = false;
    game.scene.add(holes);
  }
  const s = (kind === 'wood' ? 0.07 : 0.055) * (0.8 + Math.random() * 0.4);
  _ho.position.copy(pos).addScaledVector(normal, 0.004);
  _ho.lookAt(pos.x + normal.x, pos.y + normal.y, pos.z + normal.z);
  _ho.rotateZ(Math.random() * Math.PI * 2);
  _ho.scale.set(s, s, 1);
  _ho.updateMatrix();
  holes.setMatrixAt(holeI, _ho.matrix);
  holeI = (holeI + 1) % HOLES_MAX;
  holeCount = Math.min(HOLES_MAX, holeCount + 1);
  holes.count = holeCount;
  holes.instanceMatrix.needsUpdate = true;
}

/** Thin gun smoke drifting up from a muzzle. */
export function smokePuff(pos, size = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color: 0xc8c8c8, transparent: true, depthWrite: false, opacity: 0.22 }));
  s.position.copy(pos);
  const drift = new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.35 + Math.random() * 0.2, (Math.random() - 0.5) * 0.3);
  addFx(s, 0.9, (k, dt) => {
    s.position.addScaledVector(drift, dt);
    s.scale.setScalar((0.05 + k * 0.32) * size);
    s.material.opacity = 0.22 * (1 - k);
  }, true);
}

export function blood(pos, dir) {
  for (let i = 0; i < 7; i++) {
    const v = new THREE.Vector3((Math.random() - 0.5) * 2.5, Math.random() * 2.2, (Math.random() - 0.5) * 2.5);
    if (dir) v.addScaledVector(dir, 2.5);
    particle(pos, v, 0xb3152b, 0.02 + Math.random() * 0.025, 0.45, 12);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color: 0x9e1024, transparent: true, depthWrite: false, opacity: 0.6 }));
  s.position.copy(pos);
  addFx(s, 0.35, (k) => { s.scale.setScalar(0.15 + k * 0.4); s.material.opacity = 0.6 * (1 - k); }, true);
}

export function spark(pos, color = 0xffd27a, size = 0.08) {
  const m = new THREE.Mesh(G.sphere, new THREE.MeshBasicMaterial({ color, transparent: true }));
  m.position.copy(pos);
  m.scale.setScalar(size);
  addFx(m, 0.18, (k) => { m.scale.setScalar(size * (1 + k * 1.5)); m.material.opacity = 1 - k; }, true);
}

export function ring(pos, radius, color, life = 0.6, y = 0.05) {
  const m = new THREE.Mesh(G.ring, new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(pos.x, y, pos.z);
  addFx(m, life, (k) => { m.scale.setScalar(0.2 + k * radius); m.material.opacity = 1 - k; }, true);
}

export function burstSphere(pos, radius, color, life = 0.35) {
  const m = new THREE.Mesh(G.sphere, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
  m.position.copy(pos);
  addFx(m, life, (k) => { m.scale.setScalar(0.2 + k * radius); m.material.opacity = 0.7 * (1 - k); }, true);
}

export function updateFx(dt) {
  for (let i = live.length - 1; i >= 0; i--) {
    const f = live[i];
    f.t += dt;
    const k = Math.min(1, f.t / f.life);
    f.update(k, dt);
    if (k >= 1) {
      game.scene.remove(f.obj);
      f.obj.material?.dispose();
      if (!f.shared) f.obj.geometry?.dispose();
      live.splice(i, 1);
    }
  }
}

export function clearFx() {
  for (const f of live) game.scene.remove(f.obj);
  live.length = 0;
  if (holes) { holes.count = 0; holeCount = 0; holeI = 0; }
}
