import * as THREE from 'three';
import { game, now, sideSign } from './state.js';
import { WEAPONS, AGENTS, MOVE, ECON, MATCH, HIT_ZONES, PENETRATION } from './config.js';
import { rayBox, rayBoxRange, boxNormalAt, raySphere, surfaceOf, boxesNear, boxesAlongRay, STEP_UP } from './world.js';
import { tracer, blood, impact, bulletHole, muzzleSprite } from './fx.js';
import { sfx } from './audio.js';
import { buildCharacter, setCharacterGun, animateCharacter, startRagdoll, flinch, removeRagdoll, disposeCharacter } from './characters.js';
import { skinFor } from './progress.js';

export const RADIUS = 0.35, HEIGHT = 1.8, EYE = 1.62;
export const TEAM_COLORS = [0x3d8bff, 0xff4655];

export class Fighter {
  constructor({ id, name, team, agent, isPlayer = false }) {
    Object.assign(this, { id, name, team, isPlayer });
    this.agent = AGENTS[agent];
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = true;
    this.hp = 100; this.armor = 0; this.alive = true;
    this.credits = ECON.start;
    this.primary = null; this.secondary = 'p9'; this.cur = 'secondary';
    this.ammo = { p9: WEAPONS.p9.mag };
    this.reloadT = 0; this.fireCD = 0; this.bloom = 0;
    this.recoil = 0; this.recoilYaw = 0; this.shotsInRow = 0;
    this.scoped = false;
    this.kills = 0; this.deaths = 0; this.assists = 0; this.damage = 0;
    this.ult = 0;
    this.abil = {};
    this.damagedBy = new Map();
    this.bought = [];
    // timed states (absolute game-time)
    this.blindUntil = 0; this.revealedUntil = 0; this.spottedUntil = 0;
    this.overchargeUntil = 0; this.slowUntil = 0; this.furyUntil = 0; this.furyShots = 0;
    this.healLeft = 0;
    this.dashT = 0; this.dashDir = new THREE.Vector3();
    this.crouch = 0; this.wantCrouch = false;
    this.burstLeft = 0; this.burstT = 0;
    this.mesh = buildCharacter(TEAM_COLORS[team], this.agent);
    this.resetAbilities();
  }

  resetAbilities() {
    for (const s of ['q', 'e']) this.abil[s] = { charges: this.agent[s].charges, cd: 0 };
  }

  weapon() { return WEAPONS[this.cur === 'primary' && this.primary ? this.primary : this.secondary]; }
  weaponKey() { return this.weapon().key; }

  get drop() { return MOVE.crouchDrop * this.crouch; }
  get height() { return HEIGHT - this.drop; }
  eye(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + EYE - this.drop, this.pos.z); }
  /** Eye for the camera: smoothed over stair steps. */
  viewEye(out = new THREE.Vector3()) { return this.eye(out).setY(out.y + (this.stepOff || 0)); }

  lookDir(out = new THREE.Vector3(), withRecoil = true) {
    const p = this.pitch + (withRecoil ? this.recoil : 0);
    const y = this.yaw + (withRecoil ? this.recoilYaw : 0);
    return out.set(-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
  }

  muzzle(out = new THREE.Vector3()) {
    if (this.isPlayer && !game.spectating) {
      const f = this.lookDir(new THREE.Vector3());
      const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      return this.eye(out).addScaledVector(f, 0.7).addScaledVector(r, 0.18).add(new THREE.Vector3(0, -0.14, 0));
    }
    const g = this.mesh.userData.gun;
    if (g && this.mesh.visible) return g.localToWorld(out.copy(g.userData.tip));
    const f = this.lookDir(new THREE.Vector3());
    return this.eye(out).addScaledVector(f, 0.75).add(new THREE.Vector3(0, -0.3, 0));
  }

  give(key) {
    const w = WEAPONS[key];
    if (w.slot === 'primary') { this.primary = key; this.cur = 'primary'; } else { this.secondary = key; if (!this.primary) this.cur = 'secondary'; }
    this.ammo[key] = w.mag;
    this.reloadT = 0;
    setGunLook(this);
  }

  get speedMul() {
    let m = this.weapon().speedMul;
    if (this.scoped) m *= 0.6;
    if (now() < this.overchargeUntil) m *= 1.2;
    if (now() < this.slowUntil) m *= 0.6;
    return m;
  }
}

// ---------------------------------------------------------------------------
// Mesh (articulated character rig — see characters.js)
// ---------------------------------------------------------------------------
export function setGunLook(f) {
  if (!f.mesh.userData.ragdoll) setCharacterGun(f.mesh, f.weaponKey(), f.isPlayer ? skinFor(f.weaponKey()) : f.skin);
}

/** Swap in a fresh rig after a ragdoll death (called at round start). */
export function resetFighterMesh(f) {
  if (!f.mesh.userData.ragdoll) return;
  removeRagdoll(f.mesh, game.scene);
  game.scene.remove(f.mesh);
  disposeCharacter(f.mesh);
  f.mesh = buildCharacter(TEAM_COLORS[f.team], f.agent);
  game.scene.add(f.mesh);
  setGunLook(f);
}

const _sph = new THREE.Sphere(), _sc = new THREE.Vector3();
export function updateFighterMesh(f, dt, viewer) {
  const m = f.mesh, u = m.userData;
  if (!f.alive) { if (!u.ragdoll) startRagdoll(m, game.scene, f.vel, f.lastHitDir, f.lastHitHead); return; }
  m.position.copy(f.pos);
  if (f.stepOff) m.position.y += f.stepOff;
  m.rotation.y = f.yaw;
  m.visible = !(f.isPlayer && !game.spectating);
  if (!m.visible) return;
  // animation LOD: skip rigs that are off-screen, update far ones at half rate
  const u0 = m.userData;
  u0.animAcc += dt;
  const cam = game.camera;
  const dist = cam ? cam.position.distanceTo(f.pos) : 0;
  if (game.frustum && dist > 3 && !game.frustum.intersectsSphere(_sph.set(_sc.set(f.pos.x, f.pos.y + 1, f.pos.z), 1.3))) return;
  if (dist > 35 && (u0.animTick = (u0.animTick || 0) + 1) % 2) return;
  const adt = Math.min(0.1, u0.animAcc);
  u0.animAcc = 0;
  const w = f.weapon();
  animateCharacter(m, {
    yaw: f.yaw, pitch: f.pitch + f.recoil * 0.5, vel: f.vel, onGround: f.onGround,
    kick: f.kickT || 0, reload: f.reloadT > 0 ? 1 - f.reloadT / w.reload : -1, crouch: f.crouch,
  }, adt);
  const t = now();
  u.ghost.visible = viewer && f.team !== viewer.team && t < f.revealedUntil;
  u.marker.visible = viewer && f.team === viewer.team && !f.isPlayer;
}

// ---------------------------------------------------------------------------
// Movement + collision
// ---------------------------------------------------------------------------
function overlaps(f, b, minY) {
  return f.pos.x + RADIUS > b.minX && f.pos.x - RADIUS < b.maxX
    && f.pos.z + RADIUS > b.minZ && f.pos.z - RADIUS < b.maxZ
    && minY < b.maxY && f.pos.y + f.height > b.minY;
}

/** Nothing solid in the fighter's body volume if it stood with its feet at y? */
function clearAt(f, y, list) {
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (f.pos.x + RADIUS > b.minX && f.pos.x - RADIUS < b.maxX && f.pos.z + RADIUS > b.minZ && f.pos.z - RADIUS < b.maxZ
      && y + 0.02 < b.maxY && y + f.height > b.minY) return false;
  }
  return true;
}

const near = (f) => boxesNear(f.pos.x - RADIUS - 0.3, f.pos.z - RADIUS - 0.3, f.pos.x + RADIUS + 0.3, f.pos.z + RADIUS + 0.3);

function resolveAxis(f, axis) {
  const list = near(f);
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (!overlaps(f, b, f.pos.y + 0.05)) continue;
    // a low ledge (stair step, kerb): walk up onto it instead of stopping
    const rise = b.maxY - f.pos.y;
    if (rise > 0 && rise <= STEP_UP && (f.onGround || f.vel.y <= 0) && clearAt(f, b.maxY, list)) {
      f.stepOff = (f.stepOff || 0) - rise;
      f.pos.y = b.maxY; f.vel.y = Math.max(0, f.vel.y); f.onGround = true;
      continue;
    }
    if (axis === 'x') {
      f.pos.x = f.pos.x < (b.minX + b.maxX) / 2 ? b.minX - RADIUS - 1e-4 : b.maxX + RADIUS + 1e-4;
      f.vel.x = 0;
    } else {
      f.pos.z = f.pos.z < (b.minZ + b.maxZ) / 2 ? b.minZ - RADIUS - 1e-4 : b.maxZ + RADIUS + 1e-4;
      f.vel.z = 0;
    }
  }
}

function blockedAbove(f) {
  for (const b of near(f)) {
    if (f.pos.x + RADIUS > b.minX && f.pos.x - RADIUS < b.maxX && f.pos.z + RADIUS > b.minZ && f.pos.z - RADIUS < b.maxZ
      && b.minY > f.pos.y + f.height - 0.05 && b.minY < f.pos.y + HEIGHT) return true;
  }
  return false;
}

/** wishX/wishZ: desired horizontal direction (unit or zero). */
export function moveFighter(f, wishX, wishZ, speed, jump, dt) {
  if (f.dashT > 0) {
    f.dashT -= dt;
    f.vel.x = f.dashDir.x * 21; f.vel.z = f.dashDir.z * 21;
  } else {
    const a = (f.onGround ? MOVE.accel : MOVE.airAccel) * dt;
    let dx = wishX * speed - f.vel.x, dz = wishZ * speed - f.vel.z;
    const dl = Math.hypot(dx, dz);
    if (dl > a) { dx *= a / dl; dz *= a / dl; }
    f.vel.x += dx; f.vel.z += dz;
  }
  if (jump && f.onGround && f.crouch < 0.5) { f.vel.y = MOVE.jump; f.onGround = false; }
  // crouch blends in/out; can't stand up under something
  let want = f.wantCrouch ? 1 : 0;
  if (!want && f.crouch > 0 && blockedAbove(f)) want = f.crouch;
  f.crouch += (want - f.crouch) * Math.min(1, dt * 12);

  const steps = Math.max(1, Math.ceil(Math.hypot(f.vel.x, f.vel.z) * dt / 0.25));
  const h = dt / steps;
  for (let s = 0; s < steps; s++) {
    f.pos.x += f.vel.x * h; resolveAxis(f, 'x');
    f.pos.z += f.vel.z * h; resolveAxis(f, 'z');
  }

  const prevY = f.pos.y, wasGround = f.onGround;
  f.vel.y -= MOVE.gravity * dt;
  f.pos.y += f.vel.y * dt;
  f.onGround = false;
  if (f.pos.y <= 0) { f.pos.y = 0; f.vel.y = 0; f.onGround = true; }
  const list = near(f);
  for (const b of list) {
    if (!(f.pos.x + RADIUS > b.minX && f.pos.x - RADIUS < b.maxX && f.pos.z + RADIUS > b.minZ && f.pos.z - RADIUS < b.maxZ)) continue;
    if (f.pos.y < b.maxY && f.pos.y + f.height > b.minY) {
      if (f.vel.y <= 0 && prevY >= b.maxY - 0.06) { f.pos.y = b.maxY; f.vel.y = 0; f.onGround = true; }
      else if (f.vel.y > 0) { f.pos.y = b.minY - f.height; f.vel.y = 0; }
    } else if (f.vel.y <= 0 && Math.abs(f.pos.y - b.maxY) < 0.02) f.onGround = true;
  }
  // walking down stairs: stick to the next step instead of hopping off each one
  if (!f.onGround && wasGround && f.vel.y <= 0 && f.dashT <= 0) {
    let top = 0;
    for (const b of list) {
      if (f.pos.x + RADIUS > b.minX && f.pos.x - RADIUS < b.maxX && f.pos.z + RADIUS > b.minZ && f.pos.z - RADIUS < b.maxZ && b.maxY <= prevY + 0.01 && b.maxY > top) top = b.maxY;
    }
    if (prevY - top <= STEP_UP + 0.05) { f.stepOff = (f.stepOff || 0) + (prevY - top) - (prevY - f.pos.y); f.pos.y = top; f.vel.y = 0; f.onGround = true; }
  }
  // smooth the visual/eye height over steps
  if (f.stepOff) { f.stepOff *= Math.exp(-14 * dt); if (Math.abs(f.stepOff) < 0.002) f.stepOff = 0; }

  if (game.phase === 'buy') {
    if (sideSign(f.team) < 0) f.pos.x = Math.min(f.pos.x, -31);
    else f.pos.x = Math.max(f.pos.x, 31);
  }
}

export function separateFighters() {
  const fs = game.fighters;
  for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
    const a = fs[i], b = fs[j];
    if (!a.alive || !b.alive) continue;
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
    const d = Math.hypot(dx, dz), min = RADIUS * 2;
    if (d < min && d > 1e-4 && Math.abs(a.pos.y - b.pos.y) < a.height) {
      const push = (min - d) / 2, nx = dx / d, nz = dz / d;
      a.pos.x -= nx * push; a.pos.z -= nz * push;
      b.pos.x += nx * push; b.pos.z += nz * push;
    }
  }
}

// ---------------------------------------------------------------------------
// Shooting
// ---------------------------------------------------------------------------
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3(), _end = new THREE.Vector3();
const _hc = new THREE.Vector3();

/** Enemy hitboxes (crouch-aware): head sphere, torso box, legs box. Returns { t, zone } or null. */
function hitFighter(e, o, d) {
  const drop = e.drop, y = e.pos.y;
  _hc.set(e.pos.x, y + 1.62 - drop, e.pos.z);
  const th = raySphere(o, d, _hc, 0.21);
  const legsTop = y + 0.9 - drop * 0.55;
  const tb = rayBox(o, d, { minX: e.pos.x - 0.3, maxX: e.pos.x + 0.3, minY: legsTop, maxY: y + 1.44 - drop, minZ: e.pos.z - 0.3, maxZ: e.pos.z + 0.3 });
  const tl = rayBox(o, d, { minX: e.pos.x - 0.25, maxX: e.pos.x + 0.25, minY: y, maxY: legsTop, minZ: e.pos.z - 0.25, maxZ: e.pos.z + 0.25 });
  const t = Math.min(th, tb, tl);
  if (t === Infinity) return null;
  return { t, zone: t === th ? 'head' : t === tb ? 'body' : 'legs' };
}

/** Solid surfaces along a ray, sorted: [{ t0, t1, kind, box }] (floor has t1 = Infinity). */
function wallsAlong(o, d, maxT) {
  const out = [];
  for (const b of boxesAlongRay(o, d, maxT)) {
    const r = rayBoxRange(o, d, b);
    if (r && r[0] < maxT) out.push({ t0: r[0], t1: r[1], kind: b.kind, box: b });
  }
  if (d.y < 0) { const tf = -o.y / d.y; if (tf < maxT) out.push({ t0: tf, t1: Infinity, kind: 'floor', box: null }); }
  out.sort((x, y) => x.t0 - y.t0);
  return out;
}

/**
 * Trace a bullet. `pen` = metres of wood the round can punch through (see PENETRATION).
 * Returns { target, zone, head, t, mul (damage multiplier from walls), hits (pierce mode), wall (stop surface), pens }.
 */
export function traceShot(shooter, o, d, maxT = 150, pierce = false, pen = 0) {
  let stopT = maxT, stop = null;
  const pens = []; // penetrated walls: { t0, t1, kind, box, mul }
  if (!pierce) {
    let left = pen, mul = 1;
    for (const w of wallsAlong(o, d, maxT)) {
      const cost = (w.t1 - w.t0) * (PENETRATION[w.kind] ?? Infinity);
      if (pen > 0 && cost <= left && w.t1 < maxT) {
        left -= cost;
        mul *= Math.max(0.35, 0.75 - 0.35 * cost / pen);
        pens.push({ ...w, mul });
      } else { stopT = w.t0; stop = w; break; }
    }
  }
  let best = stopT, target = null, zone = null;
  const hits = [];
  for (const e of game.fighters) {
    if (!e.alive || e.team === shooter.team) continue;
    const h = hitFighter(e, o, d);
    if (!h) continue;
    if (pierce && h.t < maxT) hits.push({ target: e, head: h.zone === 'head', zone: h.zone, t: h.t });
    if (h.t < best) { best = h.t; target = e; zone = h.zone; }
  }
  let mul = 1;
  for (const p of pens) if (p.t1 <= best) mul = p.mul;
  let wall = null;
  if (!target && stop) {
    const point = o.clone().addScaledVector(d, stop.t0);
    wall = { t: stop.t0, kind: stop.kind, n: stop.box ? boxNormalAt(stop.box, point) : new THREE.Vector3(0, 1, 0) };
  }
  return { target, zone, head: zone === 'head', t: best, mul, hits, wall, pens: pens.filter((p) => p.t1 <= best) };
}

/** Can a round with `pen` reach from a to b through the walls in between? */
export function penetrable(a, b, pen) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length(); d.divideScalar(len || 1);
  let cost = 0;
  for (const w of wallsAlong(a, d, len)) {
    if (w.kind === 'floor') return false;
    cost += (Math.min(w.t1, len) - w.t0) * (PENETRATION[w.kind] ?? Infinity);
    if (cost > pen) return false;
  }
  return true;
}

export function spreadDir(out, dir, spread) {
  if (spread <= 0) return out.copy(dir);
  // random point in a disk perpendicular to dir (biased toward center)
  const r = spread * Math.sqrt(Math.random()) * 0.85 + spread * 0.15 * Math.random();
  const a = Math.random() * Math.PI * 2;
  const up = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(dir, up).normalize();
  const v = new THREE.Vector3().crossVectors(u, dir).normalize();
  return out.copy(dir).addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r).normalize();
}

export function currentSpread(f) {
  const w = f.weapon();
  const hs = Math.hypot(f.vel.x, f.vel.z);
  const moveK = Math.max(0, Math.min(1, (hs - 1.2) / (MOVE.run - 1.2)));
  const base = w.scope && f.scoped ? w.scopedSpread : w.spread;
  const crouchK = f.onGround ? 1 - 0.3 * f.crouch : 1;
  return ((base + f.bloom + w.move * moveK) * crouchK + (f.onGround ? 0 : 0.12)) * (f.brain?.d.spreadMul ?? 1);
}

/** Damage multiplier at range t. falloff is [dist, mul] or a list of such steps. */
function falloffMul(w, t) {
  if (!w.falloff) return 1;
  const steps = Array.isArray(w.falloff[0]) ? w.falloff : [w.falloff];
  let m = 1;
  for (const [d, mul] of steps) if (t > d) m = mul;
  return m;
}

export function tryFire(f) {
  const w = f.weapon();
  if (!f.alive || f.reloadT > 0 || f.fireCD > 0 || f.burstLeft > 0 || game.phase === 'buy' || game.phase === 'end') return false;
  if ((f.ammo[w.key] ?? 0) <= 0) { startReload(f); if (f.isPlayer) sfx('empty'); return false; }
  const rateMul = now() < f.overchargeUntil ? 1.25 : 1;
  f.fireCD = 1 / (w.rate * rateMul);
  // burst weapons: one trigger pull queues the rest of the burst (fired from updateWeapon)
  if (w.burst) { f.burstLeft = w.burst - 1; f.burstT = w.burstInterval; }
  fireRound(f, w);
  return true;
}

const _pd = new THREE.Vector3(), _aim = new THREE.Vector3();
/** One trigger "round": a bullet, or a spread of shotgun pellets. */
function fireRound(f, w) {
  f.ammo[w.key]--;
  f.shotsInRow++;
  f.eye(_o);
  f.lookDir(_aim);
  const spread = currentSpread(f);
  const pellets = w.pellets || 1;
  const dirs = [];
  for (let i = 0; i < pellets; i++) {
    spreadDir(_pd, _aim, spread);
    if (pellets > 1) spreadDir(_pd, _pd, w.pelletSpread);
    dirs.push(_pd.clone());
  }
  // online client: draw everything locally right away, let the host decide the damage
  const client = game.net?.role === 'client';
  const fx = resolveRound(f, w, _o, dirs, { damage: !client });
  f.bloom = Math.min(w.maxBloom, f.bloom + w.bloom);
  applyRecoil(f, w);
  afterShot(f, w, fx);
  if (client) game.net.sendFire?.(_o, dirs, w.key);
  if (w.key === 'longbow' && f.isPlayer) f.scoped = false;
}

/** Muzzle flash, sound, noise for bots, whizz past the listener. */
function afterShot(f, w, fx) {
  const muz = f.muzzle(_m);
  if (!f.isPlayer || game.spectating) muzzleSprite(muz, (w.slot === 'primary' ? 0.5 : 0.35) * (w.suppressed ? 0.35 : 1));
  if (fx.length) { _d.copy(fx[0].dir); bulletPassBy(f, fx[0].o, _d, fx[0].o.distanceTo(fx[0].end)); }
  f.lastShotT = now();
  f.kickT = 1;
  if (f.isPlayer) game.onPlayerShot?.(f, w);
  game.onAnyShot?.(f, muz);
  emitSound(f, w.key);
  game.noises.push({ pos: f.pos.clone(), team: f.team, t: now(), shooter: f, quiet: !!w.suppressed });
}

/**
 * Trace one trigger pull (1 bullet or N pellets) from o along dirs: effects, optional damage.
 * opts.rewind: seconds to rewind enemy positions (host resolving a laggy client's shot).
 * Returns fx records [{ o, dir, end, hit: 'flesh'|surface|null, n }] so the host can replay them on clients.
 */
export function resolveRound(f, w, o, dirs, opts = {}) {
  const rewound = [];
  if (opts.rewind && game.net?.rewindPos) {
    for (const e of game.fighters) {
      if (!e.alive || e.team === f.team) continue;
      const r = game.net.rewindPos(e, opts.rewind);
      if (r) { rewound.push([e, e.pos.clone(), e.crouch]); e.pos.set(r[0], r[1], r[2]); e.crouch = r[3]; }
    }
  }
  const hits = new Map(); // target -> { dmg, head, zone, wallbang }
  const fx = [];
  let impactsSounded = 0;
  dirs.forEach((dir, i) => {
    const { target, zone, head, t, wall, mul, pens } = traceShot(f, o, dir, 150, false, w.pen || 0);
    const end = o.clone().addScaledVector(dir, t);
    const rec = { o: o.clone(), dir: dir.clone(), end, hit: null, n: null, pens: [] };
    // entry + exit holes on every wall the round punched through
    for (const p of pens) {
      const surf = surfaceOf(p.kind);
      for (const [tt, sign] of [[p.t0, 1], [p.t1, -1]]) {
        const pt = o.clone().addScaledVector(dir, tt);
        const n = boxNormalAt(p.box, pt);
        impact(pt, n, surf);
        bulletHole(pt, n, surf);
        rec.pens.push([pt, n, surf]);
        if (sign > 0 && impactsSounded++ < 2 && Math.random() < 0.6) sfx('impact', { pos: pt, surface: surf, vol: 0.6 });
      }
    }
    if (target) {
      const dmg = (head ? w.head : w.dmg * HIT_ZONES[zone]) * falloffMul(w, t) * mul;
      const h = hits.get(target) || { dmg: 0, head: false, zone, wallbang: false, dir: dir.clone() };
      h.dmg += dmg; h.head ||= head; h.wallbang ||= pens.length > 0;
      if (head) h.zone = 'head';
      hits.set(target, h);
      blood(end, dir);
      rec.hit = 'flesh';
    } else if (wall && wall.t < 150) {
      const surf = wall.kind === 'floor' ? 'floor' : surfaceOf(wall.kind);
      impact(end, wall.n, surf);
      bulletHole(end, wall.n, surf);
      rec.hit = surf; rec.n = wall.n.clone();
      if (impactsSounded++ < 2 && Math.random() < 0.6) sfx('impact', { pos: end, surface: surf, vol: 0.6 });
    }
    const muz = f.muzzle(_m);
    // suppressed guns leave no tracers; shotguns show a couple of pellet streaks
    if (!w.suppressed && (dirs.length > 1 ? i < 3 : Math.random() < (w.auto ? 0.5 : 1) || !f.isPlayer)) tracer(muz, end, 0xffe6b0);
    fx.push(rec);
  });
  for (const [e, pos, c] of rewound) { e.pos.copy(pos); e.crouch = c; }
  // pellets that hit the same target land as one hit (one hit marker / damage number)
  if (opts.damage !== false) {
    for (const [target, h] of hits) {
      applyDamage(target, Math.round(h.dmg), f, { head: h.head, zone: h.zone, weapon: w.key, dir: h.dir, wallbang: h.wallbang });
    }
  }
  game.onShotFx?.(f, w, fx);
  return fx;
}

/** Host: resolve a shot fired by a remote player (origin + directions sent by their client). */
export function remoteFire(f, o, dirs, wkey, rewind) {
  const w = WEAPONS[wkey];
  if (!w || !f.alive || (f.primary !== wkey && f.secondary !== wkey)) return;
  if (game.phase === 'buy' || game.phase === 'end') return;
  if (f.weaponKey() !== wkey) { f.cur = w.slot; setGunLook(f); }
  f.ammo[wkey] = Math.max(0, (f.ammo[wkey] ?? w.mag) - 1);
  const fx = resolveRound(f, w, o, dirs, { damage: true, rewind });
  afterShot(f, w, fx);
}

/** Client: replay a shot that happened on the host (tracers, impacts, sound) without tracing. */
export function playShotFx(f, wkey, recs) {
  const w = WEAPONS[wkey];
  if (!w || !f) return;
  const muz = f.muzzle(_m);
  recs.forEach((r, i) => {
    const end = new THREE.Vector3(...r.e);
    for (const [p, n, surf] of r.p || []) { const pt = new THREE.Vector3(...p), nn = new THREE.Vector3(...n); impact(pt, nn, surf); bulletHole(pt, nn, surf); }
    if (r.h === 'flesh') blood(end, new THREE.Vector3().subVectors(end, muz).normalize());
    else if (r.h) { const n = new THREE.Vector3(...r.n); impact(end, n, r.h); bulletHole(end, n, r.h); }
    if (!w.suppressed && (recs.length > 1 ? i < 3 : true)) tracer(muz, end, 0xffe6b0);
  });
  muzzleSprite(muz, (w.slot === 'primary' ? 0.5 : 0.35) * (w.suppressed ? 0.35 : 1));
  if (recs[0]) bulletPassBy(f, muz, new THREE.Vector3().subVectors(new THREE.Vector3(...recs[0].e), muz).normalize(), muz.distanceTo(new THREE.Vector3(...recs[0].e)));
  f.kickT = 1; f.lastShotT = now();
  game.onAnyShot?.(f, muz);
  emitSound(f, wkey);
}

/** Recoil pattern: climb for `climb` shots, then plateau with a left/right sway. */
function applyRecoil(f, w) {
  const n = f.shotsInRow;
  const climbing = n <= w.climb;
  f.recoil = Math.min(w.kick * w.climb * 1.05 + 0.01, f.recoil + w.kick * (climbing ? 1 : 0.12));
  const side = climbing ? (n > w.climb * 0.6 ? 0.25 : 0) : Math.sin((n - w.climb) * 0.55) * 1.6;
  f.recoilYaw += w.sway * side + (Math.random() - 0.5) * w.kick * 0.15;
  f.kickT = 1;
}

/** If an enemy round passes close to the listener's head, play a supersonic crack there. */
const _hp = new THREE.Vector3(), _cp = new THREE.Vector3();
function bulletPassBy(f, o, d, t) {
  const p = game.player;
  if (!p || f === p || !p.alive || game.spectating || f.team === p.team) return;
  _hp.set(p.pos.x, p.pos.y + 1.5, p.pos.z);
  const along = _cp.subVectors(_hp, o).dot(d);
  if (along < 2 || along > t) return;
  _cp.copy(o).addScaledVector(d, along);
  if (_cp.distanceTo(_hp) < 2.2) sfx('whizz', { pos: _cp, vol: 0.9 });
}

/** Play a sound at a fighter's (or any {pos}) location; your own sounds play "in your head". */
const _sp = new THREE.Vector3();
export function emitSound(src, name, vol = 1, surface) {
  if (src === game.player && !game.spectating) { sfx(name, { vol, surface }); return; }
  _sp.set(src.pos.x, src.pos.y + (src instanceof Fighter ? 1.2 : 0), src.pos.z);
  sfx(name, { pos: _sp, vol, surface });
}

export function startReload(f) {
  const w = f.weapon();
  if (f.reloadT > 0 || f.ammo[w.key] >= w.mag) return;
  f.reloadT = w.reload;
  f.scoped = false;
  if (!f.isPlayer) emitSound(f, 'magout', 0.8);
}

export function updateWeapon(f, dt) {
  f.fireCD = Math.max(0, f.fireCD - dt);
  const w = f.weapon();
  if (f.burstLeft > 0) {
    f.burstT -= dt;
    if (!f.alive || f.reloadT > 0 || !w.burst || (f.ammo[w.key] ?? 0) <= 0 || game.phase !== 'live') f.burstLeft = 0;
    else if (f.burstT <= 0) { fireRound(f, w); f.burstLeft--; f.burstT += w.burstInterval; }
  }
  if (f.reloadT > 0) {
    f.reloadT -= dt;
    if (f.reloadT <= 0) { f.reloadT = 0; f.ammo[w.key] = w.mag; }
  }
  if (now() - (f.lastShotT ?? -9) > 1 / w.rate + 0.06) {
    f.bloom = Math.max(0, f.bloom - (w.maxBloom / 0.35 + 0.01) * dt);
    f.shotsInRow = 0;
  }
  // recoil only recovers once you stop shooting; recovery is quick like tactical shooters
  const firing = now() - (f.lastShotT ?? -9) < 1 / w.rate + 0.05;
  const k = firing ? 0 : Math.min(1, 9 * dt);
  f.recoil -= f.recoil * k; f.recoilYaw -= f.recoilYaw * k;
  f.kickT = Math.max(0, (f.kickT || 0) - dt * 12);
}

export function switchWeapon(f, slot) {
  if (slot === f.cur || (slot === 'primary' && !f.primary)) return;
  f.cur = slot;
  f.reloadT = 0; f.scoped = false; f.burstLeft = 0;
  f.fireCD = Math.max(f.fireCD, 0.35);
  setGunLook(f);
  emitSound(f, 'equip', 0.7);
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------
export function applyDamage(target, amount, attacker, opts = {}) {
  if (game.net?.role === 'client') return;   // the host decides damage online
  if (!target.alive || game.phase === 'end' || game.phase === 'over') return;
  if (now() < (target.protectUntil || 0)) return;   // respawn protection
  if (attacker?.brain) amount *= attacker.brain.d.dmgMul ?? 1;   // easier bots hit softer
  const before = target.hp + target.armor;
  let a = amount;
  if (target.armor > 0) { const ab = Math.min(target.armor, a); target.armor -= ab; a -= ab; }
  target.hp -= a;
  const dealt = Math.min(before, amount);
  if (attacker && attacker.team !== target.team) {
    attacker.damage += dealt;
    target.damagedBy.set(attacker, now());
  }
  target.lastAttacker = attacker;
  if (opts.dir) target.lastHitDir = opts.dir.clone();
  else if (attacker && attacker !== target) target.lastHitDir = new THREE.Vector3().subVectors(target.pos, attacker.pos).setY(0.3).normalize();
  else target.lastHitDir = null;
  target.lastHitHead = !!opts.head;
  if (amount >= 5) flinch(target.mesh, opts.dir, opts.head);
  target.lastHitT = now();
  target.brain?.onDamaged(attacker);
  if (attacker === game.player) game.onPlayerHit?.(target, dealt, opts.head, target.hp <= 0);
  if (target === game.player) game.onPlayerDamaged?.(attacker, dealt);
  game.onDamage?.(target, attacker, dealt, !!opts.head, target.hp <= 0);
  if (target.hp <= 0) kill(target, attacker, opts);
}

export function kill(target, attacker, opts = {}) {
  target.hp = 0; target.alive = false; target.deaths++;
  target.vel.set(0, 0, 0);
  target.healLeft = 0;
  if (attacker && attacker !== target && attacker.team !== target.team) {
    attacker.kills++;
    attacker.credits = Math.min(ECON.max, attacker.credits + ECON.kill);
    attacker.ult = Math.min(MATCH.ultCost, attacker.ult + 1);
  }
  const t = now();
  for (const [f, when] of target.damagedBy) {
    if (f !== attacker && f.team !== target.team && t - when < 8) f.assists++;
  }
  emitSound(target, 'hurt', 1.2);
  game.onKill?.(attacker, target, opts);
}
