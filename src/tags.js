import * as THREE from 'three';
import { game, now } from './state.js';
import { sfx } from './audio.js';

// Kill Confirmed: every death drops a tag where the player fell. The other team scores a point
// by picking it up (CONFIRMED); the fallen player's own team can grab it first to deny it.
// Tags are visual on every peer; pickups are decided by the host (or offline).
export const KC = { perPlayer: 6, life: 30, radius: 1.4 };
const TEAM_HEX = [0x3d8bff, 0xff8a1f];

let geo = null, ringGeo = null;
const mats = [];
function tagMesh(team) {
  geo ||= new THREE.BoxGeometry(0.26, 0.17, 0.03);
  ringGeo ||= new THREE.RingGeometry(0.42, 0.5, 32);
  mats[team] ||= {
    tag: new THREE.MeshStandardMaterial({ color: TEAM_HEX[team], emissive: TEAM_HEX[team], emissiveIntensity: 1.4, metalness: 0.6, roughness: 0.3 }),
    ring: new THREE.MeshBasicMaterial({ color: TEAM_HEX[team], transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
  };
  const g = new THREE.Group();
  const t = new THREE.Mesh(geo, mats[team].tag); t.position.y = 0.75;
  const r = new THREE.Mesh(ringGeo, mats[team].ring); r.rotation.x = -Math.PI / 2; r.position.y = 0.04;
  g.add(t, r);
  return g;
}

/** A tag for a player of `team` who died at pos. */
export function spawnTag(id, pos, team) {
  game.tags ||= [];
  const mesh = tagMesh(team);
  const p = new THREE.Vector3(pos.x, pos.y, pos.z);
  mesh.position.copy(p);
  game.scene.add(mesh);
  const tag = { id, pos: p, team, mesh, until: now() + KC.life };
  game.tags.push(tag);
  return tag;
}

export function removeTag(id) {
  const i = (game.tags || []).findIndex((t) => t.id === id);
  if (i < 0) return null;
  const t = game.tags[i];
  game.scene.remove(t.mesh);
  game.tags.splice(i, 1);
  return t;
}
export function clearTags() { for (const t of [...(game.tags || [])]) removeTag(t.id); }

/** Nearest tag a bot of this team would want (any tag: enemy ones to confirm, own to deny). */
export function nearestTag(f, maxDist) {
  let best = null, bd = maxDist;
  for (const t of game.tags || []) {
    const d = Math.hypot(t.pos.x - f.pos.x, t.pos.z - f.pos.z);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

/** Per frame. host: true decides pickups and expiry (calls game.onTagTaken / onTagGone). */
export function updateTags(dt, host) {
  const t = now();
  for (const tag of [...(game.tags || [])]) {
    const m = tag.mesh.children[0];
    m.rotation.y += dt * 3;
    m.position.y = 0.75 + Math.sin(t * 3 + tag.id) * 0.08;
    if (!host) continue;
    if (t > tag.until) { removeTag(tag.id); game.onTagGone?.(tag.id, null, 'expire'); continue; }
    const taker = game.fighters.find((f) => f.alive && Math.hypot(f.pos.x - tag.pos.x, f.pos.z - tag.pos.z) < KC.radius && Math.abs(f.pos.y - tag.pos.y) < 2);
    if (taker) {
      removeTag(tag.id);
      const kind = taker.team === tag.team ? 'deny' : 'confirm';
      if (kind === 'confirm') game.score[taker.team]++;
      game.onTagGone?.(tag.id, taker, kind);
    }
  }
}

export const tagSound = (kind) => sfx(kind === 'confirm' ? 'capture' : 'buy', { vol: 0.7 });
