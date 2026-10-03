import * as THREE from 'three';
import { game } from './state.js';

const live = []; // { obj, t, life, update(k) }

function addFx(obj, life, update) {
  game.scene.add(obj);
  live.push({ obj, t: 0, life, update });
}

export function tracer(from, to, color = 0xfff2b0, width = 0.025, life = 0.07) {
  const len = from.distanceTo(to);
  if (len < 0.1) return;
  const geo = new THREE.CylinderGeometry(width, width, len, 4, 1, true);
  geo.translate(0, len / 2, 0);
  geo.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
  m.position.copy(from);
  m.lookAt(to);
  addFx(m, life, (k) => { m.material.opacity = 0.9 * (1 - k); });
}

export function spark(pos, color = 0xffd27a, size = 0.08) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(size, 6, 4), new THREE.MeshBasicMaterial({ color, transparent: true }));
  m.position.copy(pos);
  addFx(m, 0.18, (k) => { m.scale.setScalar(1 + k * 1.5); m.material.opacity = 1 - k; });
}

export function blood(pos) {
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: 0xff3355, transparent: true }));
    m.position.copy(pos);
    const v = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3);
    addFx(m, 0.35, (k, dt) => { v.y -= 12 * dt; m.position.addScaledVector(v, dt); m.material.opacity = 1 - k; });
  }
}

export function ring(pos, radius, color, life = 0.6, y = 0.05) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(pos.x, y, pos.z);
  addFx(m, life, (k) => { m.scale.setScalar(0.2 + k * radius); m.material.opacity = 1 - k; });
}

export function burstSphere(pos, radius, color, life = 0.35) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
  m.position.copy(pos);
  addFx(m, life, (k) => { m.scale.setScalar(0.2 + k * radius); m.material.opacity = 0.7 * (1 - k); });
}

export function updateFx(dt) {
  for (let i = live.length - 1; i >= 0; i--) {
    const f = live[i];
    f.t += dt;
    const k = Math.min(1, f.t / f.life);
    f.update(k, dt);
    if (k >= 1) {
      game.scene.remove(f.obj);
      f.obj.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
      live.splice(i, 1);
    }
  }
}

export function clearFx() {
  for (const f of live) game.scene.remove(f.obj);
  live.length = 0;
}
