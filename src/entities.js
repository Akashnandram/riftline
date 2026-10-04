import * as THREE from 'three';
import { game, now, sideSign } from './state.js';
import { WEAPONS, AGENTS, MOVE, ECON, MATCH, HIT_ZONES, PENETRATION } from './config.js';
import { boxes, rayBox, rayBoxRange, boxNormalAt, raySphere, surfaceOf } from './world.js';
import { tracer, blood, impact, bulletHole, muzzleSprite } from './fx.js';
import { sfx } from './audio.js';
import { buildCharacter, setCharacterGun, animateCharacter, startRagdoll, flinch, removeRagdoll } from './characters.js';
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
  f.mesh = buildCharacter(TEAM_COLORS[f.team], f.agent);
  game.scene.add(f.mesh);
  setGunLook(f);
}

export function updateFighterMesh(f, dt, viewer) {
  const m = f.mesh, u = m.userData;
  if (!f.alive) { if (!u.ragdoll) startRagdoll(m, game.scene, f.vel, f.lastHitDir, f.lastHitHead); return; }
  m.position.copy(f.pos);
  m.rotation.y = f.yaw;
  m.visible = !(f.isPlayer && !game.spectating);
  if (!m.visible) return;
  const w = f.weapon();
  animateCharacter(m, {
    yaw: f.yaw, pitch: f.pitch + f.recoil * 0.5, vel: f.vel, onGround: f.onGround,
    kick: f.kickT || 0, reload: f.reloadT > 0 ? 1 - f.reloadT / w.reload : -1, crouch: f.crouch,
  }, dt);
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

function resolveAxis(f, axis) {
  const minY = f.pos.y + 0.05;
  for (const b of boxes) {
    if (!overlaps(f, b, minY)) continue;
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
  for (const b of boxes) {
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

  const prevY = f.pos.y;
  f.vel.y -= MOVE.gravity * dt;
  f.pos.y += f.vel.y * dt;
  f.onGround = false;
  if (f.pos.y <= 0) { f.pos.y = 0; f.vel.y = 0; f.onGround = true; }
  for (const b of boxes) {
    if (!(f.pos.x + RADIUS > b.minX && f.pos.x - RADIUS < b.maxX && f.pos.z + RADIUS > b.minZ && f.pos.z - RADIUS < b.maxZ)) continue;
    if (f.pos.y < b.maxY && f.pos.y + f.height > b.minY) {
      if (f.vel.y <= 0 && prevY >= b.maxY - 0.06) { f.pos.y = b.maxY; f.vel.y = 0; f.onGround = true; }
      else if (f.vel.y > 0) { f.pos.y = b.minY - f.height; f.vel.y = 0; }
    } else if (f.vel.y <= 0 && Math.abs(f.pos.y - b.maxY) < 0.02) f.onGround = true;
  }

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
  for (const b of boxes) {
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
  return (base + f.bloom + w.move * moveK) * crouchK + (f.onGround ? 0 : 0.12);
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
  const hits = new Map(); // target -> { dmg, head, zone, wallbang }
  let firstEnd = null, impactsSounded = 0;
  for (let i = 0; i < pellets; i++) {
    spreadDir(_pd, _aim, spread);
    if (pellets > 1) spreadDir(_pd, _pd, w.pelletSpread);
    const { target, zone, head, t, wall, mul, pens } = traceShot(f, _o, _pd, 150, false, w.pen || 0);
    _end.copy(_o).addScaledVector(_pd, t);
    if (!firstEnd) { firstEnd = _end.clone(); _d.copy(_pd); }
    // entry + exit holes on every wall the round punched through
    for (const p of pens) {
      const surf = surfaceOf(p.kind);
      for (const [tt, sign] of [[p.t0, 1], [p.t1, -1]]) {
        const pt = _o.clone().addScaledVector(_pd, tt);
        const n = boxNormalAt(p.box, pt);
        impact(pt, n, surf);
        bulletHole(pt, n, surf);
        if (sign > 0 && impactsSounded++ < 2 && Math.random() < 0.6) sfx('impact', { pos: pt, surface: surf, vol: 0.6 });
      }
    }
    if (target) {
      const dmg = (head ? w.head : w.dmg * HIT_ZONES[zone]) * falloffMul(w, t) * mul;
      const h = hits.get(target) || { dmg: 0, head: false, zone, wallbang: false, dir: _pd.clone() };
      h.dmg += dmg; h.head ||= head; h.wallbang ||= pens.length > 0;
      if (head) h.zone = 'head';
      hits.set(target, h);
      blood(_end, _pd);
    } else if (wall && wall.t < 150) {
      const surf = wall.kind === 'floor' ? 'floor' : surfaceOf(wall.kind);
      impact(_end, wall.n, surf);
      bulletHole(_end, wall.n, surf);
      if (impactsSounded++ < 2 && Math.random() < 0.6) sfx('impact', { pos: _end, surface: surf, vol: 0.6 });
    }
    const muz = f.muzzle(_m);
    // suppressed guns leave no tracers; shotguns show a couple of pellet streaks
    if (!w.suppressed && (pellets > 1 ? i < 3 : Math.random() < (w.auto ? 0.5 : 1) || !f.isPlayer)) tracer(muz, _end, 0xffe6b0);
  }
  // pellets that hit the same target land as one hit (one hit marker / damage number)
  for (const [target, h] of hits) {
    applyDamage(target, Math.round(h.dmg), f, { head: h.head, zone: h.zone, weapon: w.key, dir: h.dir, wallbang: h.wallbang });
  }
  f.bloom = Math.min(w.maxBloom, f.bloom + w.bloom);
  applyRecoil(f, w);
  const muz = f.muzzle(_m);
  if (!f.isPlayer || game.spectating) muzzleSprite(muz, (w.slot === 'primary' ? 0.5 : 0.35) * (w.suppressed ? 0.35 : 1));
  bulletPassBy(f, _o, _d, _o.distanceTo(firstEnd));
  f.lastShotT = now();
  if (f.isPlayer) game.onPlayerShot?.(f, w);
  game.onAnyShot?.(f, muz);

  emitSound(f, w.key);
  game.noises.push({ pos: f.pos.clone(), team: f.team, t: now(), shooter: f, quiet: !!w.suppressed });
  if (w.key === 'longbow' && f.isPlayer) f.scoped = false;
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
  if (!target.alive || game.phase === 'end' || game.phase === 'over') return;
  if (now() < (target.protectUntil || 0)) return;   // respawn protection
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
