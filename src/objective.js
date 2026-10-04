import * as THREE from 'three';
import { game, now } from './state.js';
import { MATCH } from './config.js';
import { isWalkable } from './world.js';
import { applyDamage, emitSound } from './entities.js';
import { burstSphere, ring } from './fx.js';

// Plant mode: attackers (always spawning on the -x side) carry one Rift Charge and must plant it
// on site A or B (both on the defender half). Defenders win by defusing, eliminating attackers
// before the plant, or running out the clock.

export const SITES = {
  A: { key: 'A', min: { x: 12, z: -29 }, max: { x: 28, z: -11 }, center: { x: 21, z: -21 },
    plants: [{ x: 21, z: -25 }, { x: 15.5, z: -16 }, { x: 22, z: -14 }],
    entries: [{ x: 6, z: -20 }, { x: 18, z: -8.5 }] },
  B: { key: 'B', min: { x: 12, z: 11 }, max: { x: 28, z: 29 }, center: { x: 21, z: 21 },
    plants: [{ x: 21, z: 25 }, { x: 15.5, z: 16 }, { x: 22, z: 14 }],
    entries: [{ x: 6, z: 20 }, { x: 18, z: 8.5 }] },
};
for (const s of Object.values(SITES)) s.plants = s.plants.filter((p) => isWalkable(p.x, p.z));

export function siteAt(p) {
  for (const s of Object.values(SITES)) if (p.x > s.min.x && p.x < s.max.x && p.z > s.min.z && p.z < s.max.z) return s;
  return null;
}

/** Callout name for a map position (attackers spawn at -x). */
export function zoneName(p) {
  if (p.x < -30) return 'Attacker Spawn';
  if (p.x > 30) return 'Defender Spawn';
  const s = siteAt(p);
  if (s) return `${s.key} Site`;
  if (p.z < -10) return p.x < -5 ? 'A Lobby' : 'A Main';
  if (p.z > 10) return p.x < -5 ? 'B Lobby' : 'B Main';
  if (p.x > 8) return p.z < 0 ? 'A Link' : 'B Link';
  return 'Mid';
}

// ---------------------------------------------------------------------------
// The charge
// ---------------------------------------------------------------------------
let mesh = null, light = null;
function chargeMesh() {
  if (mesh) return mesh;
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.32, 8), new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.6, roughness: 0.4 }));
  body.position.y = 0.16; body.castShadow = true;
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.34, 8), new THREE.MeshStandardMaterial({ color: 0xff4655, emissive: 0xff2040, emissiveIntensity: 1.2 }));
  core.position.y = 0.17;
  const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 6, 16), new THREE.MeshStandardMaterial({ color: 0x8a8f99, metalness: 0.8, roughness: 0.3 }));
  ringM.rotation.x = Math.PI / 2; ringM.position.y = 0.28;
  g.add(body, core, ringM);
  light = new THREE.PointLight(0xff3050, 0, 4, 2);
  light.position.y = 0.5;
  g.add(light);
  g.userData.core = core;
  mesh = g;
  return g;
}

export function resetCharge() {
  const c = chargeMesh();
  if (!c.parent) game.scene.add(c);
  const attackers = game.fighters.filter((f) => f.team === game.attackers && f.alive);
  const carrier = attackers[Math.floor(Math.random() * attackers.length)] || null;
  game.charge = {
    state: carrier ? 'carried' : 'dropped', carrier, pos: carrier ? carrier.pos.clone() : new THREE.Vector3(-36, 0, 0),
    site: null, timer: MATCH.chargeTime, beepT: 0, progress: 0, actor: null, half: false, plantedAt: 0,
  };
  c.visible = game.config.mode === 'plant';
}

export function hideCharge() { if (mesh) mesh.visible = false; game.charge = null; }

const _back = new THREE.Vector3();
export function updateCharge(dt) {
  const c = game.charge;
  if (!c || !mesh) return;
  const t = now();
  if (c.state === 'carried') {
    const f = c.carrier;
    if (!f.alive) { drop(f); }
    else {
      // worn on the carrier's back
      _back.set(Math.sin(f.yaw) * 0.25, 1.05 - f.drop, Math.cos(f.yaw) * 0.25);
      mesh.position.copy(f.pos).add(_back);
      mesh.rotation.set(Math.PI / 2, f.yaw, 0);
      mesh.visible = !(f.isPlayer && !game.spectating);
      c.pos.copy(f.pos);
    }
  }
  if (c.state === 'dropped') {
    mesh.position.copy(c.pos); mesh.rotation.set(0, t, 0); mesh.visible = true;
    for (const f of game.fighters) {
      if (f.alive && f.team === game.attackers && Math.hypot(f.pos.x - c.pos.x, f.pos.z - c.pos.z) < 1.1 && Math.abs(f.pos.y - c.pos.y) < 1.5) {
        c.state = 'carried'; c.carrier = f;
        emitSound(f, 'equip', 1);
        game.onChargeEvent?.('pickup', f);
        break;
      }
    }
  }
  if (c.state === 'planted') {
    c.timer -= dt;
    // beeps speed up as the timer runs down
    const interval = c.timer > 20 ? 1 : c.timer > 10 ? 0.5 : c.timer > 5 ? 0.25 : 0.12;
    if ((c.beepT -= dt) <= 0) {
      c.beepT = interval;
      emitSound({ pos: c.pos }, 'beep', 1);
      light.intensity = 5;
    }
    light.intensity *= Math.exp(-dt * 10);
    mesh.userData.core.material.emissiveIntensity = 0.6 + light.intensity * 0.4;
    if (c.timer <= 0) explode();
  }
  // a plant/defuse in progress is cancelled if nobody kept it going this frame
  if (c.actor && c.lastTick < t - 0.05) { c.actor = null; if (c.state !== 'planted' || !c.half) c.progress = 0; else c.progress = Math.min(c.progress, MATCH.defuseTime / 2); }
}

function drop(f) {
  const c = game.charge;
  c.state = 'dropped'; c.carrier = null;
  c.pos.set(f.pos.x, f.pos.y, f.pos.z);
  c.actor = null; c.progress = 0;
  game.onChargeEvent?.('drop', f);
}

/** Can fighter f plant right now? */
export function canPlant(f) {
  const c = game.charge;
  return game.config.mode === 'plant' && game.phase === 'live' && c && c.state === 'carried' && c.carrier === f && f.alive && f.onGround && !!siteAt(f.pos);
}
export function canDefuse(f) {
  const c = game.charge;
  return game.config.mode === 'plant' && game.phase === 'live' && c && c.state === 'planted' && f.alive && f.team !== game.attackers
    && Math.hypot(f.pos.x - c.pos.x, f.pos.z - c.pos.z) < 1.6 && Math.abs(f.pos.y - c.pos.y) < 1.2;
}

/** Call every frame while f is holding the plant/defuse action. Returns progress 0..1 or -1 if not allowed. */
export function tickAction(f, dt) {
  const c = game.charge;
  const planting = canPlant(f), defusing = !planting && canDefuse(f);
  if (!planting && !defusing) return -1;
  if (Math.hypot(f.vel.x, f.vel.z) > 0.6) { if (c.actor === f) { c.actor = null; c.progress = defusing && c.half ? MATCH.defuseTime / 2 : 0; } return -1; }
  if (c.actor && c.actor !== f) return -1;
  if (c.actor !== f) { c.actor = f; emitSound(f, planting ? 'plantStart' : 'defuseStart', 1); }
  c.lastTick = now();
  c.progress += dt;
  const need = planting ? MATCH.plantTime : MATCH.defuseTime;
  if (defusing && !c.half && c.progress >= need / 2) { c.half = true; emitSound(f, 'ping', 0.8); }
  if (c.progress >= need) {
    c.actor = null; c.progress = 0;
    if (planting) plant(f); else defuse(f);
  }
  return c.actor === f ? c.progress / need : 1;
}

function plant(f) {
  const c = game.charge;
  c.state = 'planted'; c.carrier = null;
  c.pos.set(f.pos.x - Math.sin(f.yaw) * 0.5, f.pos.y, f.pos.z - Math.cos(f.yaw) * 0.5);
  c.site = siteAt(f.pos).key;
  c.timer = MATCH.chargeTime; c.half = false; c.plantedAt = now();
  mesh.position.copy(c.pos); mesh.rotation.set(0, f.yaw, 0); mesh.visible = true;
  for (const a of game.fighters) if (a.team === game.attackers) a.credits += MATCH.plantBonus;
  ring(c.pos, 6, 0xff4655, 0.8);
  emitSound({ pos: c.pos }, 'planted', 1);
  game.onChargeEvent?.('planted', f);
}

function defuse(f) {
  const c = game.charge;
  c.state = 'defused';
  light.intensity = 0;
  mesh.userData.core.material.emissiveIntensity = 0.05;
  emitSound({ pos: c.pos }, 'defused', 1);
  game.onChargeEvent?.('defused', f);
}

function explode() {
  const c = game.charge;
  c.state = 'exploded';
  mesh.visible = false;
  burstSphere(new THREE.Vector3(c.pos.x, 1, c.pos.z), MATCH.blastRadius, 0xff6a3d, 0.9);
  burstSphere(new THREE.Vector3(c.pos.x, 1, c.pos.z), MATCH.blastRadius * 0.6, 0xffffff, 0.4);
  emitSound({ pos: c.pos }, 'boom', 2);
  for (const f of game.fighters) {
    if (f.alive && f.pos.distanceTo(c.pos) < MATCH.blastRadius) {
      f.lastHitDir = new THREE.Vector3().subVectors(f.pos, c.pos).setY(0.6).normalize();
      applyDamage(f, 999, null, { ability: 'Rift Charge', dir: f.lastHitDir });
    }
  }
  game.onChargeEvent?.('exploded', null);
}
