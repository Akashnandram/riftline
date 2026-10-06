// In-match networking (host-authoritative, star topology).
//
// HOST  runs the whole simulation (bots, damage, rounds, the charge). Every 50 ms it broadcasts a
//       snapshot; it streams events (shots, kills, abilities, rounds...) on the reliable channel.
// CLIENT moves its own fighter locally (instant response) and sends its pose 30×/s; shots are
//       sent as origin + directions and resolved by the host with lag compensation. Everything
//       else (other players, bots, phase, score, charge) comes from snapshots, interpolated 100 ms
//       behind so remote movement is smooth.
import * as THREE from 'three';
import { game, sideSign } from '../state.js';
import { WEAPONS, MATCH, GADGETS } from '../config.js';
import { SNAPSHOT_HZ, INPUT_HZ } from './config.js';
import { packNode } from '../uplink.js';

export const WKEYS = Object.keys(WEAPONS);
const wi = (k) => (k ? WKEYS.indexOf(k) : -1);
const wk = (i) => (i >= 0 ? WKEYS[i] : null);
const GKEYS = Object.keys(GADGETS);
const gi = (k) => (k ? GKEYS.indexOf(k) : -1);
const gk = (i) => (i >= 0 ? GKEYS[i] : null);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const clock = () => performance.now() / 1000;

export const net = {
  role: null,          // 'host' | 'client' | null
  lobby: null,
  myFid: -1,
  byFid: new Map(),
  // client
  offset: 0, haveOffset: false, interpDelay: 0.1, snaps: [], spawnSeq: 0, lastSnap: null,
  // host
  hist: new Map(),
};

export function isClient() { return net.role === 'client'; }
export function isHost() { return net.role === 'host'; }
export function resetNet() {
  Object.assign(net, { role: null, lobby: null, myFid: -1, offset: 0, haveOffset: false, snaps: [], lastSnap: null, spawnSeq: 0 });
  net.byFid.clear(); net.hist.clear();
  net.sendFire = net.sendAbility = null;
  game.onShotFx = game.onAbilityUsed = game.onDamage = null;
  game.net = null;
}
export function setupNet(role, lobby) {
  resetNet();
  net.role = role; net.lobby = lobby;
  net.rewindPos = rewindPos;
  game.net = net;
}
export const fighterByFid = (fid) => net.byFid.get(fid);

// ---------------------------------------------------------------------------
// HOST
// ---------------------------------------------------------------------------
let snapT = 0;
export function hostTick(dt) {
  const t = game.time;
  // position history for lag compensation (~1 s)
  for (const f of game.fighters) {
    let h = net.hist.get(f.id);
    if (!h) net.hist.set(f.id, h = []);
    h.push([t, f.pos.x, f.pos.y, f.pos.z, f.crouch]);
    if (h.length > 70) h.shift();
  }
  if ((snapT -= dt) <= 0) { snapT = 1 / SNAPSHOT_HZ; net.lobby.broadcast(buildSnapshot(), true); }
}

function buildSnapshot() {
  const c = game.charge;
  return {
    t: 's', time: r3(game.time), phase: game.phase, phaseT: r2(game.phaseT), round: game.round, score: game.score, attackers: game.attackers,
    nd: game.config?.mode === 'uplink' ? packNode(game.node) : null,
    ch: c ? [c.state, r2(c.pos.x), r2(c.pos.y), r2(c.pos.z), c.carrier ? c.carrier.id : -1, r2(c.timer), r2(c.progress), c.actor ? c.actor.id : -1, c.site, c.half ? 1 : 0] : null,
    f: game.fighters.map((f) => [
      f.id, r2(f.pos.x), r2(f.pos.y), r2(f.pos.z), r2(f.vel.x), r2(f.vel.y), r2(f.vel.z), r3(f.yaw), r3(f.pitch), r2(f.crouch),
      (f.alive ? 1 : 0) | (f.onGround ? 2 : 0) | (f.reloadT > 0 ? 4 : 0) | (f.cur === 'primary' ? 8 : 0) | (f.sprinting ? 16 : 0) | (f.slideT > 0 ? 32 : 0),
      Math.ceil(f.hp), Math.ceil(f.armor), wi(f.primary), wi(f.secondary), f.credits, r2(f.spottedUntil),
      f.abil.q.charges, f.abil.e.charges, gi(f.abil.q.key), gi(f.abil.e.key), 0,
      r2(f.overchargeUntil), r2(f.revealedUntil), f.kills, f.deaths, f.assists, Math.round(f.damage),
      f.reloadT > 0 ? r2(1 - f.reloadT / f.weapon().reload) : -1,
    ]),
  };
}

/** Where a fighter was `back` seconds ago (for hit detection of laggy shooters). */
export function rewindPos(f, back) {
  const h = net.hist.get(f.id);
  if (!h || !h.length) return null;
  const t = game.time - back;
  for (let i = h.length - 1; i > 0; i--) {
    if (h[i - 1][0] <= t) {
      const a = h[i - 1], b = h[i], k = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k, a[4] + (b[4] - a[4]) * k];
    }
  }
  return h[0].slice(1);
}

/** Apply a client's latest pose to its fighter on the host. */
export function applyRemoteInput(f, dt) {
  const inp = f.netInput;
  if (!inp || !f.alive) return;
  if (inp.seq !== f.spawnSeq) return;   // stale pose from before a respawn / round reset
  const [x, y, z] = inp.p;
  // light sanity check: the allowed jump grows with the time since the last accepted pose,
  // so a laggy client resyncs instead of getting stuck
  const jump = Math.hypot(x - f.pos.x, z - f.pos.z);
  const since = game.time - (f.netAcceptT ?? game.time);
  if (jump < 3 + 25 * Math.max(dt, since)) { f.pos.set(x, y, z); f.netAcceptT = game.time; }
  f.vel.set(...inp.v);
  f.yaw = inp.yaw; f.pitch = inp.pitch;
  f.wantCrouch = !!inp.cr; f.crouch = inp.c;
  f.onGround = !!inp.g;
  f.sprinting = !!inp.sp; f.slideT = inp.sl ? Math.max(f.slideT, 0.05) : 0;
  f.wish = { x: inp.v[0], z: inp.v[2] };
  if (game.phase === 'buy') f.pos.x = sideSign(f.team) < 0 ? Math.min(f.pos.x, -31) : Math.max(f.pos.x, 31);
}

/** Tell one remote player where they (re)spawned. */
export function sendSpawn(f) {
  if (!f.netOwner) return;
  f.spawnSeq = (f.spawnSeq || 0) + 1;
  f.netAcceptT = game.time;
  net.lobby.sendTo(f.netOwner, { t: 'spawn', fid: f.id, p: [r2(f.pos.x), r2(f.pos.y), r2(f.pos.z)], yaw: r3(f.yaw), seq: f.spawnSeq });
}

export function hostEvent(obj, except = null) { if (isHost()) net.lobby.broadcast(obj, false, except); }
export function hostEventTo(fid, obj) {
  const f = fighterByFid(fid);
  if (isHost() && f?.netOwner) net.lobby.sendTo(f.netOwner, obj);
}

// ---------------------------------------------------------------------------
// CLIENT
// ---------------------------------------------------------------------------
let inputT = 0;
export function clientTick(dt, me) {
  // keep the shared clock in sync with the host so absolute timers (blind, overcharge...) line up
  if (net.haveOffset) game.time = clock() + net.offset;
  if ((inputT -= dt) <= 0 && me) {
    inputT = 1 / INPUT_HZ;
    net.lobby.toHost({
      t: 'i', seq: net.spawnSeq,
      p: [r3(me.pos.x), r3(me.pos.y), r3(me.pos.z)], v: [r2(me.vel.x), r2(me.vel.y), r2(me.vel.z)],
      yaw: r3(me.yaw), pitch: r3(me.pitch), c: r2(me.crouch), cr: me.wantCrouch ? 1 : 0, g: me.onGround ? 1 : 0,
      use: me.netUse ? 1 : 0, sp: me.sprinting ? 1 : 0, sl: me.slideT > 0 ? 1 : 0,
    }, true);
  }
}

export function clientSnapshot(s) {
  const recvClock = clock();
  const off = s.time - recvClock;
  // the offset only ever moves forward quickly or drifts back slowly (absorbs jitter)
  if (!net.haveOffset) { net.offset = off; net.haveOffset = true; } else net.offset = off > net.offset ? net.offset * 0.7 + off * 0.3 : net.offset * 0.98 + off * 0.02;
  net.snaps.push(s);
  if (net.snaps.length > 30) net.snaps.shift();
  net.lastSnap = s;
}

/** Interpolated state for every fighter except our own, ~100 ms behind the host. */
export function interpolate() {
  const snaps = net.snaps;
  if (snaps.length < 2) return null;
  const rt = clock() + net.offset - net.interpDelay;
  let a = snaps[0], b = snaps[1];
  for (let i = 1; i < snaps.length; i++) { if (snaps[i].time >= rt) { a = snaps[i - 1]; b = snaps[i]; break; } a = snaps[i - 1]; b = snaps[i]; }
  const k = Math.max(0, Math.min(1.2, (rt - a.time) / Math.max(1e-3, b.time - a.time)));
  const byA = new Map(a.f.map((x) => [x[0], x]));
  const out = [];
  for (const fb of b.f) {
    const fa = byA.get(fb[0]) || fb;
    const lerp = (i) => fa[i] + (fb[i] - fa[i]) * k;
    const ly = fa[7] + Math.atan2(Math.sin(fb[7] - fa[7]), Math.cos(fb[7] - fa[7])) * k;
    out.push({ fid: fb[0], pos: [lerp(1), lerp(2), lerp(3)], vel: [fb[4], fb[5], fb[6]], yaw: ly, pitch: lerp(8), crouch: lerp(9), raw: fb });
  }
  return out;
}

export const unpackFighter = (x) => ({
  fid: x[0], alive: !!(x[10] & 1), onGround: !!(x[10] & 2), reloading: !!(x[10] & 4), curPrimary: !!(x[10] & 8), sprint: !!(x[10] & 16), slide: !!(x[10] & 32),
  hp: x[11], armor: x[12], primary: wk(x[13]), secondary: wk(x[14]), credits: x[15], spotted: x[16],
  q: x[17], e: x[18], qk: gk(x[19]), ek: gk(x[20]), overcharge: x[22], revealed: x[23],
  kills: x[24], deaths: x[25], assists: x[26], damage: x[27], reload: x[28],
});
export const unpackCharge = (c) => c && ({ state: c[0], pos: [c[1], c[2], c[3]], carrier: c[4], timer: c[5], progress: c[6], actor: c[7], site: c[8], half: !!c[9] });
export { MATCH };
