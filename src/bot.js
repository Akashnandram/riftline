import * as THREE from 'three';
import { game, now, enemiesOf, sideSign } from './state.js';
import { DIFFICULTY, MOVE } from './config.js';
import { hasLOS, findPath } from './world.js';
import { moveFighter, tryFire, startReload, switchWeapon, penetrable } from './entities.js';
import { tacticalGoal, onSpotted, cornerToCheck } from './tactics.js';
import { tickAction } from './objective.js';
import { useAbility, abilityReady, fireFury, inPool } from './abilities.js';

const _eye = new THREE.Vector3(), _tp = new THREE.Vector3(), _v = new THREE.Vector3();
const LANES = [-20, 0, 20];
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class BotBrain {
  constructor(f, diff) {
    this.f = f;
    this.d = DIFFICULTY[diff];
    f.brain = this;
    this.reset();
  }

  reset() {
    Object.assign(this, {
      path: null, pathI: 0, pathGoal: null, repathT: 0,
      target: null, visible: false, reactAt: 0, aimHead: false, errYaw: 0, errPitch: 0,
      lastSeen: null, lastSeenT: -99, intelPos: null, intelT: -99,
      visionT: Math.random() * 0.1, strafe: 0, strafeT: 0, still: false,
      holdUntil: 0, holdYaw: 0, wpI: 0, burst: 0, burstPauseUntil: 0,
      stuckT: 0, stuckPos: new THREE.Vector3(), sidestepUntil: 0, sidestep: 0,
      abilityT: rand(2, 6), noiseSeen: now(), lookYaw: this.f.yaw,
      crouchShoot: false, wallbangUntil: 0, checkPt: null, checkT: 0, plan: null,
    });
    this.f.wantCrouch = false;
  }

  planRound() {
    this.reset();
    const s = -sideSign(this.f.team);
    const lane = LANES[Math.floor(Math.random() * 3)];
    const j = () => rand(-2.5, 2.5);
    this.waypoints = [
      { x: -27 * s, z: lane * 0.975 + j() * 0.3 },
      { x: -14 * s, z: lane + j() },
      { x: 0, z: lane + j() + (lane === 0 ? 5 * (Math.random() < 0.5 ? 1 : -1) : 0) },
      { x: 14 * s, z: lane + j() },
      { x: 26 * s, z: lane + j() },
      { x: 36 * s, z: rand(-8, 8) },
    ];
  }

  intel(e) {
    if (!this.visible) { this.intelPos = e.pos.clone(); this.intelT = now(); }
  }

  onDamaged(attacker) {
    if (!attacker || attacker.team === this.f.team) return;
    this.lastSeen = attacker.pos.clone();
    this.lastSeenT = now();
    this.holdUntil = 0;
    if (!this.visible) this.target = attacker;
    // Haze: smoke off a long-range attacker we can't see
    const f = this.f;
    if (f.agent.key === 'haze' && !this.visible && f.pos.distanceTo(attacker.pos) > 18 && Math.random() < this.d.abilityChance) {
      const mid = f.pos.clone().lerp(attacker.pos, 0.35);
      useAbility(f, 'q', mid);
    }
  }

  canSee(e, wide) {
    const f = this.f, t = now();
    if (t < f.blindUntil) return false;
    f.eye(_eye);
    const dx = e.pos.x - f.pos.x, dz = e.pos.z - f.pos.z;
    const dist = Math.hypot(dx, dz);
    if (t < f.nearsightUntil && dist > 6) return false;
    if (dist > 80) return false;
    if (dist > 3.5) {
      const yawTo = Math.atan2(-dx, -dz);
      if (Math.abs(wrap(yawTo - f.yaw)) > (wide ? 1.4 : 1.0)) return false;
    }
    if (hasLOS(_eye, _tp.set(e.pos.x, e.pos.y + 1.6, e.pos.z))) return true;
    return hasLOS(_eye, _tp.set(e.pos.x, e.pos.y + 1.0, e.pos.z));
  }

  scan() {
    const f = this.f, t = now();
    let best = null, bestD = Infinity;
    for (const e of enemiesOf(f)) {
      if (!this.canSee(e, e === this.target)) continue;
      const d = f.pos.distanceTo(e.pos);
      e.spottedUntil = Math.max(e.spottedUntil, f.team === game.player.team ? t + 0.3 : e.spottedUntil);
      onSpotted(this, e);
      for (const a of game.fighters) if (a !== f && a.team === f.team && a.brain) a.brain.intel(e);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) {
      if (best !== this.target || !this.visible) {
        const recent = t - this.lastSeenT < 1.5 && best === this.target;
        // enemies that appear off to the side take longer to react to
        const yawTo = Math.atan2(-(best.pos.x - f.pos.x), -(best.pos.z - f.pos.z));
        const off = Math.abs(wrap(yawTo - f.yaw));
        const surprise = off > 0.6 ? 1 + (off - 0.6) * 0.8 : 1;
        this.reactAt = t + this.d.reaction * rand(0.8, 1.25) * (recent ? 0.4 : surprise);
        this.aimHead = Math.random() < this.d.headChance;
        const err = this.d.aimErr * (1 + bestD / 35) * (recent ? 0.5 : 1);
        // flicks overshoot in the direction of the turn, then settle
        const turnSign = Math.sign(wrap(yawTo - f.yaw)) || 1;
        this.errYaw = (off > 0.25 ? turnSign * rand(0.4, 1.2) : rand(-1, 1)) * err;
        this.errPitch = rand(-0.6, 1) * err;
        this.still = Math.random() < this.d.still;
        this.crouchShoot = this.still && bestD > 12 && Math.random() < this.d.crouch;
      }
      this.target = best; this.visible = true;
      this.lastSeen = best.pos.clone(); this.lastSeenT = t;
      this.holdUntil = 0;
    } else {
      // just lost sight: maybe keep shooting through the cover they ducked behind
      if (this.visible && this.target?.alive) {
        const w = f.weapon();
        const chest = _tp.set(this.lastSeen.x, this.lastSeen.y + 1.1, this.lastSeen.z);
        if ((w.pen || 0) >= 0.6 && Math.random() < this.d.wallbang && penetrable(f.eye(_eye), chest, w.pen)) this.wallbangUntil = t + rand(0.6, 1.1);
      }
      this.visible = false;
      if (this.target && !this.target.alive) this.target = null;
    }
    // gunfire we can hear
    for (const n of game.noises) {
      if (n.t <= this.noiseSeen || n.team === f.team) continue;
      if (n.pos.distanceTo(f.pos) < 32 && !this.visible) { this.intelPos = n.pos.clone(); this.intelT = n.t; }
    }
    this.noiseSeen = t;
  }

  think(dt) {
    const f = this.f;
    if (!f.alive) return;
    const t = now(), d = this.d;
    if ((this.visionT -= dt) <= 0) { this.visionT = 0.1; this.scan(); }
    if (f.primary && f.cur !== 'primary') switchWeapon(f, 'primary');
    if (this.target && !this.target.alive) { this.target = null; this.visible = false; }

    const live = game.phase === 'live';
    const hunt = live && t - game.roundStartTime > 45;

    // ---------------- goal selection ----------------
    let goal = null, lookAt = null, walk = false, action = null, holding = false;
    const plantMode = game.config.mode === 'plant' && this.plan;
    const tg = plantMode && live && !this.visible ? tacticalGoal(this) : null;
    const anchored = tg && this.plan.side === 'def' && game.charge?.state !== 'planted';
    const carrying = game.charge?.carrier === f;
    if (!live) {
      goal = null;
    } else if (this.visible) {
      lookAt = null;
    } else if (plantMode && tg) {
      if (this.lastSeen && t - this.lastSeenT < 3 && (anchored || carrying || tg.action)) {
        // hold position and watch where they were instead of chasing
        goal = tg.action ? tg.goal : null; lookAt = this.lastSeen; action = tg.action;
      } else if (this.lastSeen && t - this.lastSeenT < 3 && !anchored) {
        goal = this.lastSeen; lookAt = this.lastSeen; walk = true;
      } else {
        goal = tg.goal; lookAt = tg.look; walk = tg.walk; action = tg.action; holding = !!tg.hold;
      }
    } else if (this.lastSeen && t - this.lastSeenT < 5) {
      goal = this.lastSeen; lookAt = this.lastSeen;
    } else if (this.intelPos && t - this.intelT < 8) {
      goal = this.intelPos;
    } else if (hunt) {
      let best = null, bd = Infinity;
      for (const e of enemiesOf(f)) { const dd = e.pos.distanceTo(f.pos); if (dd < bd) { bd = dd; best = e; } }
      goal = best ? best.pos : null;
    } else if (t < this.holdUntil) {
      goal = null;
    } else if (this.waypoints && this.wpI < this.waypoints.length) {
      const wp = this.waypoints[this.wpI];
      if (Math.hypot(wp.x - f.pos.x, wp.z - f.pos.z) < 2.5) {
        this.wpI++;
        if ((this.wpI === 2 || this.wpI === 3) && Math.random() < 0.45) {
          this.holdUntil = t + rand(3, 9);
          const nx = this.waypoints[Math.min(this.wpI, this.waypoints.length - 1)];
          this.holdYaw = Math.atan2(-(nx.x - f.pos.x), -(nx.z - f.pos.z)) + rand(-0.4, 0.4);
        }
        this.onWaypoint?.();
        this.botAbilityOnAdvance();
      }
      goal = this.waypoints[Math.min(this.wpI, this.waypoints.length - 1)];
    }

    // ---------------- movement ----------------
    let wx = 0, wz = 0;
    let speed = MOVE.run * f.speedMul;
    if (this.visible && this.target) {
      const tx = this.target.pos.x - f.pos.x, tz = this.target.pos.z - f.pos.z;
      const dist = Math.hypot(tx, tz) || 1;
      const px = -tz / dist, pz = tx / dist;
      if ((this.strafeT -= dt) <= 0) { this.strafe = [-1, 0, 1][Math.floor(Math.random() * 3)]; this.strafeT = rand(0.25, 0.8); }
      wx = px * this.strafe; wz = pz * this.strafe;
      if (f.reloadT > 0) { wx -= tx / dist * 0.8; wz -= tz / dist * 0.8; }
      else if (dist > 22 && Math.random() < 0.02) { this.strafe = 0; }
      if (this.still && f.reloadT <= 0 && t > this.reactAt) { wx = 0; wz = 0; }
    } else if (goal) {
      const gm = this.pathGoal ? Math.hypot(goal.x - this.pathGoal.x, goal.z - this.pathGoal.z) : 99;
      if (!this.path || (this.repathT -= dt) <= 0 || gm > 2) {
        this.path = findPath(f.pos.x, f.pos.z, goal.x, goal.z);
        this.pathI = 0; this.pathGoal = { x: goal.x, z: goal.z };
        this.repathT = rand(0.8, 1.3);
      }
      if (this.path && this.pathI < this.path.length) {
        let p = this.path[this.pathI];
        if (Math.hypot(p.x - f.pos.x, p.z - f.pos.z) < 0.6 && this.pathI < this.path.length - 1) p = this.path[++this.pathI];
        const dx = p.x - f.pos.x, dz = p.z - f.pos.z, dl = Math.hypot(dx, dz);
        if (dl > 0.3) { wx = dx / dl; wz = dz / dl; }
      }
      // walk (quiet, accurate) when close to where we expect an enemy
      if (walk || (lookAt && f.pos.distanceTo(lookAt) < 12)) speed = MOVE.walk * f.speedMul;
    }
    if (action) { wx = 0; wz = 0; }
    if (inPool(f)) { wx = -wx || rand(-1, 1); wz = -wz || rand(-1, 1); }

    // stuck detection
    if ((this.stuckT += dt) > 0.8) {
      if ((wx || wz) && this.stuckPos.distanceTo(f.pos) < 0.3) {
        this.sidestepUntil = t + 0.5; this.sidestep = Math.random() < 0.5 ? 1 : -1; this.repathT = 0;
      }
      this.stuckPos.copy(f.pos); this.stuckT = 0;
    }
    if (t < this.sidestepUntil) { const ox = wx; wx = -wz * this.sidestep + wx * 0.3; wz = ox * this.sidestep + wz * 0.3; }
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    f.wish = { x: wx, z: wz };
    f.wantCrouch = this.visible && this.crouchShoot && f.reloadT <= 0 && t > this.reactAt;
    moveFighter(f, wx, wz, speed, false, dt);
    if (action && !this.visible) tickAction(f, dt);

    // ---------------- aim ----------------
    let dYaw = f.yaw, dPitch = 0;
    const furyTarget = f.furyShots > 0 && this.lastSeen && t - this.lastSeenT < 3;
    const wallbanging = !this.visible && t < this.wallbangUntil && this.lastSeen;
    if ((this.visible && this.target) || furyTarget || wallbanging) {
      const tgt = this.visible ? this.target.pos : this.lastSeen;
      const vel = this.visible ? this.target.vel : _v.set(0, 0, 0);
      f.eye(_eye);
      _tp.set(tgt.x + vel.x * 0.06, tgt.y + (this.aimHead ? 1.6 : 1.15), tgt.z + vel.z * 0.06);
      const dx = _tp.x - _eye.x, dy = _tp.y - _eye.y, dz = _tp.z - _eye.z;
      dYaw = Math.atan2(-dx, -dz) + this.errYaw;
      dPitch = Math.atan2(dy, Math.hypot(dx, dz)) + this.errPitch;
      // aim error shrinks while tracking
      const decay = Math.exp(-2.2 * dt);
      this.errYaw *= decay; this.errPitch *= decay;
    } else if (lookAt) {
      dYaw = Math.atan2(-(lookAt.x - f.pos.x), -(lookAt.z - f.pos.z));
    } else if (t < this.holdUntil) {
      dYaw = this.holdYaw + Math.sin(t * 0.7 + f.id) * 0.25;
    } else if (wx || wz) {
      // moving: pre-aim the nearest corner ahead instead of staring along the path
      if ((this.checkT -= dt) <= 0) { this.checkT = 0.35; this.checkPt = cornerToCheck(f, wx, wz); }
      if (this.checkPt) {
        f.eye(_eye);
        const dx = this.checkPt.x - _eye.x, dz = this.checkPt.z - _eye.z;
        dYaw = Math.atan2(-dx, -dz);
        dPitch = Math.atan2(this.checkPt.y - _eye.y, Math.hypot(dx, dz));
      } else dYaw = Math.atan2(-wx, -wz);
    }
    if (holding && lookAt && !this.visible) dYaw += Math.sin(t * 0.6 + f.id * 1.7) * 0.22; // sweep the angle
    const blindWobble = t < f.blindUntil ? Math.sin(t * 9 + f.id) * 0.8 : 0;
    const k = Math.min(1, d.turn * dt);
    f.yaw += wrap(dYaw + blindWobble - f.yaw) * k;
    f.pitch += (dPitch - f.pitch) * k;

    // ---------------- shoot ----------------
    if (live && t >= this.reactAt && t >= f.blindUntil) {
      if (furyTarget || (f.furyShots > 0 && this.visible)) {
        if (Math.abs(wrap(dYaw - f.yaw)) < 0.05) fireFury(f);
      } else if (wallbanging) {
        if (Math.abs(wrap(dYaw - f.yaw)) < 0.04 && t >= this.burstPauseUntil) tryFire(f);
      } else if (this.visible && this.target) {
        const dist = f.pos.distanceTo(this.target.pos);
        const tol = Math.atan(0.3 / Math.max(1, dist)) + 0.012;
        const err = Math.abs(wrap(dYaw - this.errYaw - f.yaw)) + Math.abs(dPitch - this.errPitch - f.pitch) * 0.5;
        const w = f.weapon();
        if (err < tol * 2.2 && t >= this.burstPauseUntil) {
          if (tryFire(f)) {
            if (!w.auto) f.fireCD += d.reaction * 0.35;
            else if (dist > 14 && ++this.burst >= 3 + Math.floor(Math.random() * 3)) {
              this.burst = 0; this.burstPauseUntil = t + rand(0.2, 0.4);
            }
          }
        }
      }
    }
    if (!this.visible && f.reloadT <= 0) {
      const w = f.weapon();
      if (f.ammo[w.key] < w.mag * 0.5) startReload(f);
    }

    if ((this.abilityT -= dt) <= 0) { this.abilityT = rand(0.8, 1.6); this.botAbility(); }
  }

  // ---------------- ability heuristics ----------------
  botAbility() {
    const f = this.f, t = now(), d = this.d;
    if (game.phase !== 'live' || Math.random() > d.abilityChance) return;
    const key = f.agent.key;
    const hidden = !this.visible && this.lastSeen && t - this.lastSeenT < 4;
    const distLS = this.lastSeen ? f.pos.distanceTo(this.lastSeen) : 99;
    const lsTarget = this.lastSeen ? new THREE.Vector3(this.lastSeen.x, this.lastSeen.y + 0.5, this.lastSeen.z) : null;

    if (key === 'volt') {
      if (hidden && distLS > 5 && distLS < 25 && abilityReady(f, 'e')) useAbility(f, 'e', lsTarget);
      else if (this.visible && f.hp < 45 && abilityReady(f, 'q')) {
        const tx = this.target.pos.x - f.pos.x, tz = this.target.pos.z - f.pos.z, l = Math.hypot(tx, tz) || 1;
        f.wish = { x: -tz / l, z: tx / l };
        useAbility(f, 'q');
      } else if (this.visible && abilityReady(f, 'x')) useAbility(f, 'x');
    } else if (key === 'haze') {
      if (hidden && distLS > 6 && distLS < 22 && abilityReady(f, 'e')) useAbility(f, 'e', lsTarget);
      else if ((this.visible || game.phase === 'live' && t - game.roundStartTime > 30) && abilityReady(f, 'x')) useAbility(f, 'x');
    } else if (key === 'aegis') {
      if (!this.visible && f.hp < 60 && abilityReady(f, 'e')) useAbility(f, 'e');
      else if (this.visible && f.hp < 50 && abilityReady(f, 'q')) useAbility(f, 'q');
      else if (this.visible && f.hp < 40 && abilityReady(f, 'x')) useAbility(f, 'x');
    } else if (key === 'hawk') {
      if (hidden && distLS > 6 && distLS < 24 && abilityReady(f, 'e')) useAbility(f, 'e', lsTarget);
      else if (hidden && abilityReady(f, 'x')) useAbility(f, 'x');
    }
  }

  botAbilityOnAdvance() {
    const f = this.f;
    if (game.phase !== 'live' || Math.random() > this.d.abilityChance) return;
    const ahead = this.waypoints[Math.min(this.wpI + 1, this.waypoints.length - 1)];
    const pt = new THREE.Vector3(ahead.x, 1.5, ahead.z);
    if (f.agent.key === 'hawk' && this.wpI === 2 && abilityReady(f, 'q')) useAbility(f, 'q', pt);
    if (f.agent.key === 'haze' && this.wpI === 2 && abilityReady(f, 'q') && Math.random() < 0.5) useAbility(f, 'q', pt);
  }
}
