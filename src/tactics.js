import * as THREE from 'three';
import { game, now } from './state.js';
import { boxes, isWalkable, hasLOS, BOUNDS, onMapLoad, navHeight, snapWalkable } from './world.js';
import { SITES, siteAt, zoneName } from './objective.js';
import { uplinkGoal } from './uplink.js';

// Team-level bot strategy for plant mode:
//  attack  — pick a site + strategy (full execute or split through mid), gather at a staging
//            point, push together, carrier plants, everyone else holds post-plant angles.
//  defense — spread across A / B / mid holding computed angles, rotate on callouts,
//            retake + defuse after a plant.
// Also: callouts to the player's team and corner points bots pre-aim while moving.

const rand = (a, b) => a + Math.random() * (b - a);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// Static analysis of the map (redone whenever a map loads)
// ---------------------------------------------------------------------------
/** Point at standing/aim height above whatever floor is at (x, z). */
const at = (x, z, h = 1.4) => V(x, navHeight(x, z) + h, z);

/** Corners of tall cover that bots "check" (pre-aim) while moving. */
export const CORNERS = [];
function findCorners() {
  CORNERS.length = 0;
  for (const b of boxes) {
    if (b.walk || b.maxY - b.minY < 1.6 || b.kind === 'outer' || b.kind === 'roof') continue;
    for (const [x, z] of [[b.minX - 0.45, b.minZ - 0.45], [b.maxX + 0.45, b.minZ - 0.45], [b.minX - 0.45, b.maxZ + 0.45], [b.maxX + 0.45, b.maxZ + 0.45]]) {
      if (x > BOUNDS.minX + 1 && x < BOUNDS.maxX - 1 && z > BOUNDS.minZ + 1 && z < BOUNDS.maxZ - 1 && isWalkable(x, z) && Math.abs(navHeight(x, z) - b.minY) < 0.5) CORNERS.push(at(x, z));
    }
  }
}

function nearCover(x, z) {
  const h = navHeight(x, z);
  for (const b of boxes) {
    if (b.maxY < h + 1.0 || b.minY > h + 1 || b.kind === 'outer') continue;
    const dx = Math.max(b.minX - x, 0, x - b.maxX), dz = Math.max(b.minZ - z, 0, z - b.maxZ);
    if (Math.hypot(dx, dz) < 1.2) return true;
  }
  return false;
}

/** Score walkable spots in an area by how many entries they watch from cover at a good range. */
function holdSpots(area, entries, n) {
  const cands = [];
  const eye = V(0, 0, 0), tgt = V(0, 0, 0);
  for (let x = area.min.x + 0.5; x < area.max.x; x += 1) {
    for (let z = area.min.z + 0.5; z < area.max.z; z += 1) {
      if (!isWalkable(x, z)) continue;
      let score = 0, watch = null;
      const h = navHeight(x, z);
      eye.set(x, h + 1.6, z);
      for (const e of entries) {
        const d = Math.hypot(e.x - x, e.z - z);
        if (d < 6 || d > 26) continue;
        if (hasLOS(eye, tgt.set(e.x, navHeight(e.x, e.z) + 1.4, e.z), true)) { score += 2 - Math.abs(d - 13) / 13; watch = watch || e; }
      }
      if (!watch) continue;
      if (nearCover(x, z)) score += 0.8;
      if (h > 0.9) score += 0.5;                      // high ground is worth holding
      cands.push({ x, z, score, watch });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const out = [];
  for (const c of cands) {
    if (out.every((o) => Math.hypot(o.x - c.x, o.z - c.z) > 3.5)) out.push(c);
    if (out.length >= n) break;
  }
  return out;
}

export const HOLDS = { A: [], B: [], mid: [] };
let RETAKE_FROM = { A: [], B: [] };
let ROUTES = {};
onMapLoad((m) => {
  findCorners();
  const mid = m.mid || { area: { min: { x: 6, z: -8 }, max: { x: 16, z: 8 } }, center: { x: 11, z: 0 }, entries: [{ x: -6, z: 0 }] };
  const midEntries = mid.entries.map(snapWalkable);
  HOLDS.A = holdSpots(SITES.A, SITES.A.entries, 4);
  HOLDS.B = holdSpots(SITES.B, SITES.B.entries, 4);
  HOLDS.mid = holdSpots(mid.area, midEntries, 2);
  for (const [k, area] of [['A', SITES.A], ['B', SITES.B], ['mid', { center: snapWalkable(mid.center), entries: midEntries }]]) {
    if (!HOLDS[k].length) HOLDS[k].push({ x: area.center.x, z: area.center.z, score: 0, watch: area.entries[0] });
  }
  // angles defenders retake from / attackers watch after the plant
  RETAKE_FROM = { A: m.retake.A.map(snapWalkable), B: m.retake.B.map(snapWalkable) };
  // attack routes (attackers come from -x)
  ROUTES = {};
  for (const k of ['A', 'B']) ROUTES[k] = { main: m.routes[k].main.map(snapWalkable), split: m.routes[k].split.map(snapWalkable) };
});

// ---------------------------------------------------------------------------
// Round planning
// ---------------------------------------------------------------------------
export function planTactics() {
  const t = now();
  const atk = game.fighters.filter((f) => f.team === game.attackers);
  const def = game.fighters.filter((f) => f.team !== game.attackers);
  const site = Math.random() < 0.5 ? 'A' : 'B';
  const split = atk.length >= 3 && Math.random() < 0.35;
  game.tac = {
    site, split, goAt: t + 28, go: false, rotatingTo: null, rotateAt: 0,
    lastCallout: -9, seenAt: new Map(), defuser: null,
  };
  // attackers: one or two take the split route, the rest go main
  let splitters = split ? Math.max(1, Math.floor(atk.length / 3)) : 0;
  for (const f of atk) {
    if (!f.brain) continue;
    const route = splitters-- > 0 ? 'split' : 'main';
    f.brain.plan = { side: 'atk', route: ROUTES[site][route].map((p) => ({ x: p.x + rand(-1, 1), z: p.z + rand(-1.5, 1.5) })), i: 0, staged: false };
  }
  // defenders: spread across sites (+ mid with 3+)
  const bots = def.filter((f) => f.brain);
  const order = def.length === 1 ? [Math.random() < 0.5 ? 'A' : 'B'] : def.length === 2 ? ['A', 'B'] : def.length === 3 ? ['A', 'B', 'mid'] : def.length === 4 ? ['A', 'B', 'B', 'A'] : ['A', 'B', 'mid', 'A', 'B'];
  // the human defender takes a slot too (assume they pick whatever site they want)
  const used = { A: 0, B: 0, mid: 0 };
  bots.forEach((f, i) => {
    const zone = order[(i + (def.length > bots.length ? 1 : 0)) % order.length];
    f.brain.plan = { side: 'def', zone, spot: HOLDS[zone][used[zone]++ % HOLDS[zone].length] };
  });
}

function setDefZone(f, zone) {
  const taken = game.fighters.filter((o) => o !== f && o.brain?.plan?.zone === zone).map((o) => o.brain.plan.spot);
  const spot = HOLDS[zone].find((s) => !taken.includes(s)) || HOLDS[zone][Math.floor(Math.random() * HOLDS[zone].length)];
  f.brain.plan = { side: 'def', zone, spot };
}

// ---------------------------------------------------------------------------
// Events: spotting, plant
// ---------------------------------------------------------------------------
/** A bot saw an enemy: callouts for the player's team, rotations for defenders. */
export function onSpotted(bot, enemy) {
  const tac = game.tac;
  if (!tac || game.config.mode !== 'plant') return;
  const t = now();
  const seen = tac.seenAt.get(enemy) ?? -99;
  tac.seenAt.set(enemy, t);
  if (t - seen > 6 && bot.f.team === game.player.team && t - tac.lastCallout > 2.5) {
    tac.lastCallout = t;
    const count = game.fighters.filter((e) => e.alive && e.team === enemy.team && t - (tac.seenAt.get(e) ?? -99) < 2 && e.pos.distanceTo(enemy.pos) < 8).length;
    game.onCallout?.(bot.f, count > 1 ? `${count} enemies ${zoneName(enemy.pos)}` : `Enemy spotted ${zoneName(enemy.pos)}`);
  }
  // defenders rotate toward a site under pressure
  if (bot.f.team !== game.attackers && game.charge?.state !== 'planted') {
    const z = enemy.pos.z < -10 ? 'A' : enemy.pos.z > 10 ? 'B' : null;
    if (z && enemy.pos.x > -4 && tac.rotatingTo !== z) {
      tac.rotatingTo = z; tac.rotateAt = t + rand(1, 2.2);
      if (bot.f.team === game.player.team) game.onCallout?.(bot.f, `Rotating ${z}`);
    }
  }
}

export function onChargeEvent(kind) {
  const tac = game.tac;
  if (!tac) return;
  if (kind === 'planted') tac.go = true;
}

/** Per-frame team logic: when to execute, when defenders actually move on a rotate. */
export function updateTactics() {
  const tac = game.tac;
  if (!tac || game.phase !== 'live') return;
  const t = now();
  if (!tac.go) {
    // execute once the main group has gathered at the staging point, or the clock forces it
    const atk = game.fighters.filter((f) => f.alive && f.team === game.attackers && f.brain?.plan?.route);
    const ready = atk.length && atk.every((f) => f.brain.plan.staged);
    if (ready || t > tac.goAt || t - game.roundStartTime > 45) {
      tac.go = true;
      if (atk[0] && atk[0].team === game.player.team) game.onCallout?.(atk[0], `Go ${tac.site}! Everyone push`);
    }
  }
  if (tac.rotatingTo && t > tac.rotateAt) {
    const z = tac.rotatingTo;
    const defs = game.fighters.filter((f) => f.alive && f.team !== game.attackers && f.brain?.plan);
    let anchors = 0;
    for (const f of defs) {
      if (f.brain.plan.zone === z) continue;
      // keep one player home on bigger teams so it isn't an empty-site fake
      if (defs.length >= 4 && f.brain.plan.zone !== 'mid' && anchors++ === 0) continue;
      setDefZone(f, z);
    }
    tac.rotatingTo = null;
  }
}

// ---------------------------------------------------------------------------
// What a bot should do right now (when not in a gunfight)
// returns { goal, look, walk, action: 'plant'|'defuse'|null }
// ---------------------------------------------------------------------------
export function tacticalGoal(bot) {
  const f = bot.f, plan = bot.plan, c = game.charge, tac = game.tac;
  if (plan?.side === 'uplink') return uplinkGoal(f);
  if (!plan || !c || !tac) return null;
  const site = c.state === 'planted' ? c.site : tac.site;

  if (plan.side === 'atk') {
    // pick the charge back up
    if (c.state === 'dropped') {
      const carrierless = game.fighters.filter((o) => o.alive && o.team === f.team && o.brain).sort((a, b) => a.pos.distanceTo(c.pos) - b.pos.distanceTo(c.pos));
      if (carrierless[0] === f) return { goal: c.pos, look: null, walk: false };
    }
    if (c.state === 'planted') {
      const h = postPlantSpot(f, c.site);
      return { goal: h, look: at(h.watch.x, h.watch.z), walk: false, hold: true };
    }
    const carrier = c.state === 'carried' && c.carrier === f;
    if (!tac.go) {
      // walk to the staging point and wait there
      const stage = plan.route[0];
      if (Math.hypot(stage.x - f.pos.x, stage.z - f.pos.z) < 3) plan.staged = true;
      const nextLook = plan.route[1] || SITES[site].center;
      return { goal: stage, look: plan.staged ? at(nextLook.x, nextLook.z) : null, walk: false, hold: plan.staged };
    }
    // executing: run the rest of the route, then onto the site
    while (plan.i < plan.route.length && Math.hypot(plan.route[plan.i].x - f.pos.x, plan.route[plan.i].z - f.pos.z) < 2.5) plan.i++;
    if (plan.i < plan.route.length) return { goal: plan.route[plan.i], look: null, walk: false };
    if (carrier) {
      plan.plantSpot ??= SITES[site].plants[Math.floor(Math.random() * SITES[site].plants.length)];
      const p = plan.plantSpot;
      const at = Math.hypot(p.x - f.pos.x, p.z - f.pos.z) < 1 && siteAt(f.pos);
      return { goal: at ? null : p, look: null, walk: false, action: at ? 'plant' : null };
    }
    const h = postPlantSpot(f, site);
    return { goal: h, look: at(h.watch.x, h.watch.z), walk: false, hold: true };
  }

  // defenders
  if (c.state === 'planted') {
    const d = Math.hypot(c.pos.x - f.pos.x, c.pos.z - f.pos.z);
    const enemiesKnown = game.fighters.some((e) => e.alive && e.team === game.attackers && now() - (tac.seenAt.get(e) ?? -99) < 2.5);
    // one defender (sticky choice) goes for the defuse once the site seems clear; the rest cover
    const defs = game.fighters.filter((o) => o.alive && o.team === f.team && o.brain).sort((a, b) => a.pos.distanceTo(c.pos) - b.pos.distanceTo(c.pos));
    if (!tac.defuser?.alive || tac.defuser.team !== f.team) tac.defuser = defs[0];
    if (c.actor && c.actor.team === f.team) tac.defuser = c.actor;
    if (tac.defuser === f && (!enemiesKnown || c.timer < MATCH_SAFETY)) {
      return { goal: d < 1.1 ? null : c.pos, look: null, walk: false, action: d < 1.4 ? 'defuse' : null };
    }
    // cover: stand a few metres off the charge facing away from it
    const k = defs.indexOf(f) + 1;
    const ang = k * 2.1 + (c.site === 'A' ? 0 : Math.PI);
    const cover = { x: c.pos.x + Math.cos(ang) * 4, z: c.pos.z + Math.sin(ang) * 4 };
    const near = Math.hypot(cover.x - f.pos.x, cover.z - f.pos.z) < 1.2;
    const out = V(c.pos.x + Math.cos(ang) * 14, c.pos.y + 1.4, c.pos.z + Math.sin(ang) * 14);
    return { goal: near ? null : (isWalkable(cover.x, cover.z) ? cover : c.pos), look: d < 8 ? out : V(c.pos.x, c.pos.y + 1.2, c.pos.z), walk: d < 14, hold: near };
  }
  const s = plan.spot;
  if (!s) return null;
  const there = Math.hypot(s.x - f.pos.x, s.z - f.pos.z) < 1;
  return { goal: there ? null : s, look: at(s.watch.x, s.watch.z, 1.5), walk: false, hold: there };
}
const MATCH_SAFETY = 9; // seconds left when a defender will gamble on a defuse even with enemies around

function postPlantSpot(f, siteKey) {
  const list = HOLDS[siteKey];
  const mates = game.fighters.filter((o) => o.alive && o.team === f.team && o.brain);
  const idx = Math.max(0, mates.indexOf(f)) % list.length;
  const h = list[idx];
  // after the plant, attackers watch where the retake comes from
  return { x: h.x, z: h.z, watch: RETAKE_FROM[siteKey][idx % 2] };
}

/** Best nearby corner to pre-aim while moving in direction (dx, dz). */
const _e = V(0, 0, 0);
export function cornerToCheck(f, dx, dz) {
  const eye = f.eye(_e);
  let best = null, bd = Infinity;
  for (const c of CORNERS) {
    const vx = c.x - f.pos.x, vz = c.z - f.pos.z;
    const d = Math.hypot(vx, vz);
    if (d < 3 || d > 14) continue;
    if ((vx * dx + vz * dz) / d < 0.35) continue;
    if (d < bd && hasLOS(eye, c, true)) { bd = d; best = c; }
  }
  return best;
}
