import * as THREE from 'three';
import { game, now, enemiesOf } from './state.js';
import { snapWalkable, groundAt } from './world.js';
import { WEAPONS } from './config.js';
import { giveGadget } from './abilities.js';
import { setGunLook, emitSound } from './entities.js';
import { smokePuff } from './fx.js';

// Killstreak rewards (respawn modes). Kills in a row without dying unlock, automatically:
//  3 — Recon Sweep: every enemy shows on your team's minimap for 8 s (bots get their positions)
//  5 — Supply Drop: a crate falls next to you; whoever on your team reaches it first gets a
//      Hammer LMG, full armor and two gadgets
//  7 — Battle Armor: full health and armor on the spot
export const STREAKS = [
  { at: 3, key: 'recon', name: 'RECON SWEEP', desc: 'enemies on your minimap for 8 s' },
  { at: 5, key: 'drop', name: 'SUPPLY DROP', desc: 'LMG, armor and gadgets incoming' },
  { at: 7, key: 'armor', name: 'BATTLE ARMOR', desc: 'full health and armor' },
];
export const nextStreak = (n) => STREAKS.find((s) => s.at > n);

const DROP_FALL = 2.4, DROP_LIFE = 35, DROP_R = 1.7;
let dropId = 0;

/** Host/offline: f just reached a kill streak of n. */
export function grantStreak(f, n) {
  const s = STREAKS.find((x) => x.at === n);
  if (!s) return;
  if (s.key === 'recon') {
    for (const e of enemiesOf(f)) {
      e.spottedUntil = Math.max(e.spottedUntil, now() + 8);
      for (const a of game.fighters) if (a.team === f.team && a.brain && e.alive) a.brain.intel(e);
    }
  } else if (s.key === 'armor') {
    f.hp = 100; f.armor = 100;
  } else if (s.key === 'drop') {
    const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
    const spot = snapWalkable({ x: f.pos.x + fx * 3, z: f.pos.z + fz * 3 });
    const pos = new THREE.Vector3(spot.x, groundAt(spot.x, spot.z), spot.z);
    const d = spawnDrop(++dropId, pos, f.team);
    d.owner = f;
    game.onDropSpawned?.(d);
  }
  game.onStreak?.(f, s);
}

// ---------------------------------------------------------------------------
// Supply drops (visual on every peer; landing + pickup decided by the host)
// ---------------------------------------------------------------------------
let crateGeo = null, crateMat = null, lidMat = null, beaconMat = null;
function crateMesh(team) {
  crateGeo ||= new THREE.BoxGeometry(1.0, 0.7, 1.0);
  crateMat ||= new THREE.MeshStandardMaterial({ color: 0x4a5a3a, roughness: 0.7, metalness: 0.3 });
  lidMat ||= [new THREE.MeshStandardMaterial({ color: 0x3d8bff, emissive: 0x3d8bff, emissiveIntensity: 1.2 }), new THREE.MeshStandardMaterial({ color: 0xff8a1f, emissive: 0xff8a1f, emissiveIntensity: 1.2 })];
  beaconMat ||= [new THREE.MeshBasicMaterial({ color: 0x3d8bff, transparent: true, opacity: 0.25, depthWrite: false }), new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.25, depthWrite: false })];
  const g = new THREE.Group();
  const box = new THREE.Mesh(crateGeo, crateMat); box.position.y = 0.35; box.castShadow = true;
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.1, 1.02), lidMat[team]); strip.position.y = 0.62;
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 14, 8, 1, true), beaconMat[team]); beacon.position.y = 7;
  g.add(box, strip, beacon);
  return g;
}

export function spawnDrop(id, pos, team, landed = false) {
  game.drops ||= [];
  const mesh = crateMesh(team);
  mesh.position.set(pos.x, pos.y + (landed ? 0 : 26), pos.z);
  game.scene.add(mesh);
  const d = { id, pos: pos.clone(), team, mesh, t: landed ? DROP_FALL : 0, landed, until: now() + DROP_LIFE };
  game.drops.push(d);
  return d;
}

export function removeDrop(id) {
  const i = (game.drops || []).findIndex((d) => d.id === id);
  if (i < 0) return;
  const d = game.drops[i];
  game.scene.remove(d.mesh);
  d.mesh.traverse((o) => { if (o.geometry !== crateGeo) o.geometry?.dispose(); });
  game.drops.splice(i, 1);
}

export function clearDrops() { for (const d of [...(game.drops || [])]) removeDrop(d.id); }

/** Per frame. host: true on the host/offline (decides pickups), false on clients (visuals only). */
export function updateDrops(dt, host) {
  for (const d of [...(game.drops || [])]) {
    if (!d.landed) {
      d.t += dt;
      const k = Math.min(1, d.t / DROP_FALL);
      d.mesh.position.y = d.pos.y + 26 * (1 - k * k);
      if (Math.random() < dt * 20) smokePuff(d.mesh.position.clone().setY(d.mesh.position.y + 0.8), 1.4);
      if (k >= 1) { d.landed = true; emitSound({ pos: d.pos }, 'land', 1.5); }
      continue;
    }
    d.mesh.children[1].rotation.y += dt * 2;
    if (!host) continue;
    if (now() > d.until) { removeDrop(d.id); game.onDropGone?.(d.id); continue; }
    // the bot that called it grabs it right away; anyone on the team can walk over it
    const owner = d.owner?.brain && d.owner.alive ? d.owner : null;
    const taker = owner || game.fighters.find((f) => f.alive && f.team === d.team && Math.hypot(f.pos.x - d.pos.x, f.pos.z - d.pos.z) < DROP_R && Math.abs(f.pos.y - d.pos.y) < 2);
    if (taker) { lootDrop(taker); removeDrop(d.id); game.onDropGone?.(d.id, taker); }
  }
}

function lootDrop(f) {
  f.give('hammer');
  f.ammo.hammer = WEAPONS.hammer.mag;
  f.cur = 'primary';
  f.armor = 100;
  for (const k of f.agent.picks) giveGadget(f, k);
  setGunLook(f);
  emitSound(f, 'buy', 1);
}
