import * as THREE from 'three';
import { game, now } from './state.js';
import { WEAPONS, AGENTS, MOVE, ECON, MATCH } from './config.js';
import { boxes, raycastWorld, rayBox, raySphere } from './world.js';
import { tracer, spark, blood } from './fx.js';
import { sfx } from './audio.js';

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
    this.walkPhase = 0; this.deathT = 0;
    this.mesh = buildFighterMesh(this);
    this.resetAbilities();
  }

  resetAbilities() {
    for (const s of ['q', 'e']) this.abil[s] = { charges: this.agent[s].charges, cd: 0 };
  }

  weapon() { return WEAPONS[this.cur === 'primary' && this.primary ? this.primary : this.secondary]; }
  weaponKey() { return this.weapon().key; }

  eye(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + EYE, this.pos.z); }

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
    const f = this.lookDir(new THREE.Vector3());
    return this.eye(out).addScaledVector(f, 0.75).add(new THREE.Vector3(0, -0.3, 0));
  }

  give(key) {
    const w = WEAPONS[key];
    if (w.slot === 'primary') { this.primary = key; this.cur = 'primary'; } else { this.secondary = key; if (!this.primary) this.cur = 'secondary'; }
    this.ammo[key] = w.mag;
    this.reloadT = 0;
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
// Mesh
// ---------------------------------------------------------------------------
const boxGeo = (w, h, d) => new THREE.BoxGeometry(w, h, d);

function buildFighterMesh(f) {
  const g = new THREE.Group();
  const teamCol = TEAM_COLORS[f.team];
  const accent = new THREE.Color(f.agent.color);
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });

  const legMat = mat(0x2a2e38);
  const legL = new THREE.Mesh(boxGeo(0.22, 0.85, 0.26), legMat);
  const legR = legL.clone();
  legL.geometry = legL.geometry.clone(); legL.geometry.translate(0, -0.425, 0);
  legR.geometry = legL.geometry;
  legL.position.set(-0.13, 0.85, 0); legR.position.set(0.13, 0.85, 0);

  const torso = new THREE.Mesh(boxGeo(0.6, 0.62, 0.36), mat(teamCol));
  torso.position.y = 1.15;
  const vest = new THREE.Mesh(boxGeo(0.62, 0.18, 0.38), mat(accent, { emissive: accent, emissiveIntensity: 0.25 }));
  vest.position.y = 1.32;
  const head = new THREE.Mesh(boxGeo(0.32, 0.34, 0.32), mat(0xe2c4a6));
  head.position.y = 1.62;
  const visor = new THREE.Mesh(boxGeo(0.3, 0.09, 0.06), mat(accent, { emissive: accent, emissiveIntensity: 0.9 }));
  visor.position.set(0, 1.66, -0.16);
  const hair = new THREE.Mesh(boxGeo(0.34, 0.1, 0.34), mat(0x1d1f26));
  hair.position.y = 1.82;

  const arms = new THREE.Group();
  arms.position.set(0, 1.3, 0);
  const arm = new THREE.Mesh(boxGeo(0.12, 0.12, 0.45), mat(teamCol));
  arm.position.set(0.22, -0.05, -0.2);
  const arm2 = arm.clone(); arm2.position.set(-0.12, -0.05, -0.28); arm2.rotation.y = -0.5;
  const gun = new THREE.Mesh(boxGeo(0.08, 0.12, 0.7), mat(0x22252b));
  gun.position.set(0.15, 0.02, -0.5);
  arms.add(arm, arm2, gun);

  const body = new THREE.Group();
  body.add(legL, legR, torso, vest, head, visor, hair, arms);
  body.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.add(body);

  // through-wall reveal silhouette
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0xff3355, transparent: true, opacity: 0.55, depthTest: false });
  const ghost = new THREE.Group();
  const gb = new THREE.Mesh(boxGeo(0.62, 1.45, 0.38), ghostMat); gb.position.y = 0.72;
  const gh = new THREE.Mesh(boxGeo(0.34, 0.34, 0.34), ghostMat); gh.position.y = 1.62;
  ghost.add(gb, gh);
  ghost.renderOrder = 999; gb.renderOrder = gh.renderOrder = 999;
  ghost.visible = false;
  g.add(ghost);

  // ally marker
  const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.1), new THREE.MeshBasicMaterial({ color: teamCol, depthTest: false, transparent: true, opacity: 0.85 }));
  marker.position.y = 2.15; marker.renderOrder = 998;
  marker.visible = false;
  g.add(marker);

  g.userData = { body, legL, legR, arms, gun, ghost, marker, head };
  return g;
}

export function setGunLook(f) {
  const w = f.weapon();
  const gun = f.mesh.userData.gun;
  gun.scale.z = w.len / 0.7;
  gun.position.z = -0.2 - w.len * 0.45;
}

export function updateFighterMesh(f, dt, viewer) {
  const m = f.mesh, u = m.userData;
  m.position.copy(f.pos);
  m.rotation.y = f.yaw;
  m.visible = !(f.isPlayer && !game.spectating);
  if (!f.alive) {
    f.deathT = Math.min(1, f.deathT + dt * 3);
    u.body.rotation.x = -f.deathT * Math.PI / 2;
    u.body.position.y = f.deathT * 0.15;
    u.ghost.visible = false; u.marker.visible = false;
    return;
  }
  u.body.rotation.x = 0; u.body.position.y = 0; f.deathT = 0;
  const hs = Math.hypot(f.vel.x, f.vel.z);
  f.walkPhase += hs * dt * 1.6;
  const swing = Math.sin(f.walkPhase) * Math.min(1, hs / 4) * 0.6;
  u.legL.rotation.x = swing; u.legR.rotation.x = -swing;
  u.arms.rotation.x = f.pitch * 0.8;
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
    && minY < b.maxY && f.pos.y + HEIGHT > b.minY;
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
  if (jump && f.onGround) { f.vel.y = MOVE.jump; f.onGround = false; }

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
    if (f.pos.y < b.maxY && f.pos.y + HEIGHT > b.minY) {
      if (f.vel.y <= 0 && prevY >= b.maxY - 0.06) { f.pos.y = b.maxY; f.vel.y = 0; f.onGround = true; }
      else if (f.vel.y > 0) { f.pos.y = b.minY - HEIGHT; f.vel.y = 0; }
    } else if (f.vel.y <= 0 && Math.abs(f.pos.y - b.maxY) < 0.02) f.onGround = true;
  }

  if (game.phase === 'buy') {
    if (f.team === 0) f.pos.x = Math.min(f.pos.x, -31);
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
    if (d < min && d > 1e-4 && Math.abs(a.pos.y - b.pos.y) < HEIGHT) {
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

/** Find the first enemy hit along a ray before walls. Returns { target, head, t }. */
export function traceShot(shooter, o, d, maxT = 150, pierce = false) {
  const wallT = pierce ? maxT : raycastWorld(o, d, maxT);
  let best = wallT, target = null, head = false;
  const hits = [];
  for (const e of game.fighters) {
    if (!e.alive || e.team === shooter.team) continue;
    _hc.set(e.pos.x, e.pos.y + 1.62, e.pos.z);
    const th = raySphere(o, d, _hc, 0.21);
    const tb = rayBox(o, d, { minX: e.pos.x - 0.31, maxX: e.pos.x + 0.31, minY: e.pos.y, maxY: e.pos.y + 1.44, minZ: e.pos.z - 0.31, maxZ: e.pos.z + 0.31 });
    const t = Math.min(th, tb);
    if (pierce && t < maxT) hits.push({ target: e, head: th <= tb, t });
    if (t < best) { best = t; target = e; head = th <= tb; }
  }
  return { target, head, t: best, hits };
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
  return base + f.bloom + w.move * moveK + (f.onGround ? 0 : 0.12);
}

export function tryFire(f) {
  const w = f.weapon();
  if (!f.alive || f.reloadT > 0 || f.fireCD > 0 || game.phase === 'buy' || game.phase === 'end') return false;
  if ((f.ammo[w.key] ?? 0) <= 0) { startReload(f); if (f.isPlayer) sfx('empty'); return false; }
  const rateMul = now() < f.overchargeUntil ? 1.25 : 1;
  f.fireCD = 1 / (w.rate * rateMul);
  f.ammo[w.key]--;
  f.shotsInRow++;

  f.eye(_o);
  spreadDir(_d, f.lookDir(_m), currentSpread(f));
  f.bloom = Math.min(w.maxBloom, f.bloom + w.bloom);
  f.recoil = Math.min(0.12, f.recoil + w.kick);
  if (w.auto && f.shotsInRow > 4) f.recoilYaw += (Math.random() - 0.5) * w.kick * 1.4;

  const { target, head, t } = traceShot(f, _o, _d);
  _end.copy(_o).addScaledVector(_d, t);
  if (target) {
    let dmg = head ? w.head : w.dmg;
    if (w.key === 'p9' && t > 30) dmg = Math.round(dmg * 0.85);
    applyDamage(target, dmg, f, { head, weapon: w.key });
    blood(_end);
  } else spark(_end);
  tracer(f.muzzle(_m), _end, f.team === 0 ? 0xbfe0ff : 0xffd0c0);
  f.lastShotT = now();
  if (f.isPlayer) game.onPlayerShot?.(f, w);

  emitSound(f, w.key);
  game.noises.push({ pos: f.pos.clone(), team: f.team, t: now(), shooter: f });
  if (w.key === 'longbow' && f.isPlayer) f.scoped = false;
  return true;
}

export function emitSound(f, name, base = 1) {
  const listener = game.listener;
  if (!listener) return;
  if (f === game.player && !game.spectating) { sfx(name, base); return; }
  const dx = f.pos.x - listener.pos.x, dz = f.pos.z - listener.pos.z;
  const d = Math.hypot(dx, dz);
  const vol = base * Math.min(1, 9 / (d + 6));
  // pan relative to listener yaw
  const rx = Math.cos(listener.yaw), rz = -Math.sin(listener.yaw);
  const pan = d > 0.1 ? (dx * rx + dz * rz) / d : 0;
  sfx(name, vol, pan * 0.8);
}

export function startReload(f) {
  const w = f.weapon();
  if (f.reloadT > 0 || f.ammo[w.key] >= w.mag) return;
  f.reloadT = w.reload;
  f.scoped = false;
  if (f.isPlayer) sfx('reload');
}

export function updateWeapon(f, dt) {
  f.fireCD = Math.max(0, f.fireCD - dt);
  const w = f.weapon();
  if (f.reloadT > 0) {
    f.reloadT -= dt;
    if (f.reloadT <= 0) { f.reloadT = 0; f.ammo[w.key] = w.mag; }
  }
  if (now() - (f.lastShotT ?? -9) > 0.12) {
    f.bloom = Math.max(0, f.bloom - (w.maxBloom / 0.35 + 0.01) * dt);
    f.shotsInRow = 0;
  }
  const recover = f.isPlayer && f.shotsInRow > 0 ? 0.15 : 0.6;
  f.recoil = Math.max(0, f.recoil - recover * dt);
  f.recoilYaw *= Math.max(0, 1 - 6 * dt);
}

export function switchWeapon(f, slot) {
  if (slot === f.cur || (slot === 'primary' && !f.primary)) return;
  f.cur = slot;
  f.reloadT = 0; f.scoped = false;
  f.fireCD = Math.max(f.fireCD, 0.35);
  setGunLook(f);
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------
export function applyDamage(target, amount, attacker, opts = {}) {
  if (!target.alive || game.phase === 'end' || game.phase === 'over') return;
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
