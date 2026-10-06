import * as THREE from 'three';
import { game, now, enemiesOf } from './state.js';
import { GADGETS } from './config.js';
import { smokes, raycastWorld, hasLOS, pointInSolid, addDynamicBox, removeDynamicBox, boxMesh } from './world.js';
import { applyDamage, emitSound } from './entities.js';
import { ring, burstSphere, spark } from './fx.js';

const projectiles = [];
const pools = [];
const barriers = [];
const timers = [];

const GRAV = 16;

/** Remove a mesh and free its GPU buffers. */
function drop(m) {
  game.scene.remove(m);
  m.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
}
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();

/** Gadget slot ('q' | 'e') has something to throw. */
export function abilityReady(f, slot) {
  const a = f.abil[slot];
  return !!(a && a.key && a.charges > 0);
}

/**
 * Use the gadget in a slot. target: optional world point (bots aim gadgets at a spot).
 * mirror: an online client replaying a gadget the host already approved (visuals only); gkey says which.
 */
export function useAbility(f, slot, target = null, mirror = false, gkey = null) {
  if (mirror) { const k = gkey || f.abil[slot]?.key; if (IMPL[k]) IMPL[k](f, target); return true; }
  if (game.net?.role === 'client') { if (f.alive && game.phase === 'live' && abilityReady(f, slot)) game.net.sendAbility?.(slot, target); return false; }
  if (!f.alive || game.phase !== 'live' || !abilityReady(f, slot)) return false;
  const a = f.abil[slot], key = a.key;
  if (!IMPL[key](f, target)) return false;
  game.onAbilityUsed?.(f, slot, target, key);
  a.charges--;
  return true;
}

/** Add one gadget to a fighter (stacks up to its max, else takes an empty slot). Returns the slot or null. */
export function giveGadget(f, key) {
  const def = GADGETS[key];
  if (!def) return null;
  for (const s of ['q', 'e']) { const a = f.abil[s]; if (a.key === key && a.charges < def.max) { a.charges++; return s; } }
  for (const s of ['q', 'e']) { const a = f.abil[s]; if (!a.key || a.charges <= 0) { a.key = key; a.charges = 1; return s; } }
  return null;
}

export function updateAbilityState(f, dt) {
  if (!f.alive) return;
  const t = now();
  if (f.healLeft > 0) {
    const h = Math.min(f.healLeft, 20 * dt);
    f.healLeft -= h; f.hp = Math.min(100, f.hp + h);
  }
  // Field Medic perk: slow regeneration back to 60 when out of the fight
  if (f.agent.key === 'aegis' && f.hp < 60 && t - (f.lastHurtT || 0) > 4) f.hp = Math.min(60, f.hp + 5 * dt);
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------
function throwProjectile(f, opts, target) {
  const o = f.eye(new THREE.Vector3());
  const dir = f.lookDir(new THREE.Vector3(), false);
  o.addScaledVector(dir, 0.5);
  const vel = new THREE.Vector3();
  if (target) {
    // lob so it lands on target in ~T seconds
    const T = Math.max(0.45, Math.min(1.3, o.distanceTo(target) / opts.speed));
    vel.set((target.x - o.x) / T, (target.y - o.y + 0.5 * GRAV * opts.grav * T * T) / T, (target.z - o.z) / T);
  } else vel.copy(dir).multiplyScalar(opts.speed).add(new THREE.Vector3(0, opts.lift ?? 1.5, 0));
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(opts.size ?? 0.12, 10, 8), new THREE.MeshBasicMaterial({ color: opts.color }));
  mesh.position.copy(o);
  game.scene.add(mesh);
  projectiles.push({ owner: f, pos: o, vel, t: 0, mesh, bounces: 0, ...opts });
  emitSound(f, 'ability');
}

export function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.t += dt;
    let done = false;
    if (!p.stuck) {
      p.vel.y -= GRAV * p.grav * dt;
      const prev = p.pos.clone();
      p.pos.addScaledVector(p.vel, dt);
      const hit = pointInSolid(p.pos, 0.04);
      if (hit) {
        if (p.onImpact) {
          p.pos.copy(prev);
          done = p.onImpact(p) !== 'keep';
          if (!done) { p.stuck = true; p.vel.set(0, 0, 0); }
        } else {
          let axis = 'y';
          if (hit !== true) {
            if (prev.x <= hit.minX || prev.x >= hit.maxX) axis = 'x';
            else if (prev.z <= hit.minZ || prev.z >= hit.maxZ) axis = 'z';
          }
          p.pos.copy(prev);
          for (const k of ['x', 'y', 'z']) p.vel[k] *= k === axis ? -p.bounce : 0.75;
          p.bounces++;
          if (axis === 'y' && Math.abs(p.vel.y) < 1.2) p.vel.y = 0;
        }
      }
    }
    if (!done && p.fuse && p.t >= p.fuse) { p.onFuse(p); done = true; }
    if (!done && p.life && p.t >= p.life) done = true;
    if (!done && p.update) p.update(p, dt);
    p.mesh.position.copy(p.pos);
    if (done) { drop(p.mesh); projectiles.splice(i, 1); }
  }
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------
export function blind(f, dur) {
  f.blindUntil = Math.max(f.blindUntil, now() + dur);
  if (f === game.player) game.onBlind?.(dur);
}

function popFlash(p) {
  burstSphere(p.pos, 2.5, 0xffffff, 0.25);
  emitSound({ pos: p.pos }, 'flash');
  for (const e of enemiesOf(p.owner)) {
    const eye = e.eye(_a);
    const dist = eye.distanceTo(p.pos);
    if (dist > 40 || !hasLOS(eye, p.pos)) continue;
    const dot = _b.subVectors(p.pos, eye).normalize().dot(e.lookDir(_v, false));
    if (dot > 0.45) blind(e, 2.2 * (dist < 20 ? 1 : 0.75));
    else if (dot > -0.15) blind(e, 0.7);
  }
}

function groundBelow(pos) {
  const t = raycastWorld(pos, new THREE.Vector3(0, -1, 0), 20);
  return pos.y - Math.min(t, pos.y);
}

function spawnSmoke(point) {
  const r = 4.2;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(r, 28, 18),
    new THREE.MeshStandardMaterial({ color: 0x8a7fa8, roughness: 1, transparent: true, opacity: 0.94, side: THREE.DoubleSide, depthWrite: true }),
  );
  const pos = new THREE.Vector3(point.x, groundBelow(point) + 1.4, point.z);
  mesh.position.copy(pos);
  mesh.scale.setScalar(0.05);
  game.scene.add(mesh);
  smokes.push({ pos, r, grow: 0.05, born: now(), until: now() + 15, mesh });
  emitSound({ pos }, 'smoke');
}

function spawnPool(p) {
  const y = groundBelow(p.pos);
  const pos = new THREE.Vector3(p.pos.x, y, p.pos.z);
  const r = 3.4;
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, 0.12, 32),
    new THREE.MeshBasicMaterial({ color: 0x8cff4a, transparent: true, opacity: 0.45, depthWrite: false }),
  );
  mesh.position.set(pos.x, y + 0.07, pos.z);
  game.scene.add(mesh);
  pools.push({ pos, r, owner: p.owner, until: now() + 6.5, mesh });
  emitSound({ pos }, 'smoke');
}

/** Sonar Puck: one ping that finds every enemy within range, walls or not. */
function sonarPing(puck) {
  if (!puck.owner) return;
  ring(puck.pos, SONAR_R, 0x7dff6b, 0.9, Math.max(0.1, puck.pos.y));
  emitSound({ pos: puck.pos }, 'ping');
  for (const e of enemiesOf(puck.owner)) {
    if (e.pos.distanceTo(puck.pos) > SONAR_R) continue;
    e.revealedUntil = Math.max(e.revealedUntil, now() + 3);
    e.spottedUntil = Math.max(e.spottedUntil, now() + 3);
    e.revealedBy = puck.owner.team;
    for (const ally of game.fighters) if (ally.team === puck.owner.team && ally.brain) ally.brain.intel(e);
  }
}

function explodeShock(p) {
  const at = p.pos;
  burstSphere(at, 4.5, 0x7dff6b, 0.3);
  emitSound({ pos: at }, 'boom');
  for (const e of enemiesOf(p.owner)) {
    const c = _a.set(e.pos.x, e.pos.y + 1, e.pos.z);
    const d = c.distanceTo(at);
    if (d > 4.5 || !hasLOS(at, c, true)) continue;
    applyDamage(e, Math.round(75 * (1 - 0.6 * d / 4.5)), p.owner, { ability: 'Frag Grenade' });
  }
}

const SONAR_R = 14;

// ---------------------------------------------------------------------------
// Ability implementations: return true if the ability was used.
// ---------------------------------------------------------------------------
const IMPL = {
  smoke(f, target) {
    throwProjectile(f, { speed: 18, grav: 1, lift: 2, fuse: 1.1, bounce: 0.3, color: 0xb7b0c8, size: 0.11, onFuse: (p) => spawnSmoke(p.pos) }, target);
    return true;
  },
  flash(f, target) {
    throwProjectile(f, { speed: 20, grav: 0.35, lift: 1, fuse: 0.55, bounce: 0.5, color: 0xffd23f, onFuse: popFlash }, target);
    return true;
  },
  frag(f, target) {
    throwProjectile(f, { speed: 17, grav: 1, lift: 2, fuse: 1.2, bounce: 0.35, color: 0xff8a1f, onFuse: (p) => explodeShock(p) }, target);
    return true;
  },
  gas(f, target) {
    throwProjectile(f, { speed: 16, grav: 1, lift: 2, fuse: 1.6, bounce: 0.3, color: 0x8cff4a, onFuse: spawnPool }, target);
    return true;
  },
  sensor(f, target) {
    throwProjectile(f, { speed: 20, grav: 1, lift: 2, color: 0x7dff6b, size: 0.1, fuse: 0.9, bounce: 0.3, onFuse: (p) => sonarPing(p) }, target);
    return true;
  },
  medkit(f) {
    if (f.hp >= 100) return false;
    f.healLeft = 60;
    emitSound(f, 'ability');
    return true;
  },
  cover(f) {
    const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
    const c = { x: f.pos.x + fx * 3, z: f.pos.z + fz * 3 };
    const alongX = Math.abs(fz) > Math.abs(fx);
    const hw = alongX ? 3 : 0.3, hd = alongX ? 0.3 : 3;
    const b = { minX: c.x - hw, maxX: c.x + hw, minZ: c.z - hd, maxZ: c.z + hd, minY: f.pos.y, maxY: f.pos.y + 3.2, kind: 'barrier' };
    addDynamicBox(b);
    const mesh = boxMesh(b, 0x3ee6d6, { transparent: true, opacity: 0.45, emissive: 0x1aa79b, emissiveIntensity: 0.6 });
    game.scene.add(mesh);
    barriers.push({ box: b, mesh, until: now() + 16 });
    emitSound(f, 'ability');
    return true;
  },
};

// ---------------------------------------------------------------------------
// Per-frame world effects
// ---------------------------------------------------------------------------
export function updateAbilities(dt) {
  const t = now();
  updateProjectiles(dt);

  for (let i = timers.length - 1; i >= 0; i--) {
    if (t >= timers[i].at) { const fn = timers[i].fn; timers.splice(i, 1); fn(); }
  }

  for (let i = smokes.length - 1; i >= 0; i--) {
    const s = smokes[i];
    s.grow = Math.min(1, (t - s.born) / 0.6);
    const fade = Math.min(1, (s.until - t) / 0.8);
    s.mesh.scale.setScalar(Math.max(0.05, s.grow));
    s.mesh.material.opacity = 0.94 * fade;
    if (t >= s.until) { drop(s.mesh); smokes.splice(i, 1); }
  }

  for (let i = pools.length - 1; i >= 0; i--) {
    const p = pools[i];
    p.mesh.material.opacity = 0.35 + Math.sin(t * 8) * 0.08;
    for (const e of enemiesOf(p.owner)) {
      if (Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) < p.r && Math.abs(e.pos.y - p.pos.y) < 1.5) {
        applyDamage(e, 30 * dt, p.owner, { ability: 'Gas Grenade' });
        e.slowUntil = t + 0.25;
        if (Math.random() < dt * 6) spark(_a.set(e.pos.x, e.pos.y + 0.2, e.pos.z), 0x8cff4a);
      }
    }
    if (t >= p.until) { drop(p.mesh); pools.splice(i, 1); }
  }

  for (let i = barriers.length - 1; i >= 0; i--) {
    const b = barriers[i];
    if (t >= b.until) { removeDynamicBox(b.box); drop(b.mesh); barriers.splice(i, 1); }
  }
}

export function inPool(f) {
  return pools.some((p) => p.owner.team !== f.team && Math.hypot(f.pos.x - p.pos.x, f.pos.z - p.pos.z) < p.r + 0.5);
}

export function clearAbilities() {
  for (const p of projectiles) drop(p.mesh);
  for (const s of smokes) drop(s.mesh);
  for (const p of pools) drop(p.mesh);
  for (const b of barriers) { removeDynamicBox(b.box); drop(b.mesh); }
  projectiles.length = smokes.length = pools.length = barriers.length = timers.length = 0;
}
