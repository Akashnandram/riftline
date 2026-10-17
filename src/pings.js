import * as THREE from 'three';
import { game, now, enemiesOf } from './state.js';
import { raycastWorld, hasLOS } from './world.js';
import { NODE_NAMES, UPLINK } from './uplink.js';

// Pings: point at something and press Z / middle mouse (PING on phones). An enemy under the
// crosshair is marked for your team; otherwise the spot you're looking at (or the Rift Node there)
// gets a marker. Pings show on screen and on the minimap for your team only.
export const PING = { life: 7, enemyLife: 5, perPlayer: 2 };
const list = [];
const _e = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3(), _p = new THREE.Vector3();
let nextId = 1;

/** What f is pointing at: { kind: 'enemy' | 'node' | 'spot', pos, target? }. */
export function pingTarget(f) {
  f.eye(_e);
  f.lookDir(_d, false);
  // an enemy close to the crosshair ray (and actually visible) wins
  let best = null, bestErr = 0.07;
  for (const e of enemiesOf(f)) {
    if (!e.alive) continue;
    _t.set(e.pos.x, e.pos.y + 1.1, e.pos.z).sub(_e);
    const dist = _t.length();
    if (dist > 90) continue;
    const err = _t.normalize().angleTo(_d) - Math.atan(0.6 / dist);
    if (err < bestErr && hasLOS(_e, _p.set(e.pos.x, e.pos.y + 1.1, e.pos.z))) { bestErr = err; best = e; }
  }
  if (best) return { kind: 'enemy', pos: best.pos.clone(), target: best };
  const hit = Math.min(120, raycastWorld(_e, _d, 120));
  const pos = _e.clone().addScaledVector(_d, Math.max(1, hit - 0.2));
  for (const n of game.nodes || []) {
    if (Math.hypot(n.pos.x - pos.x, n.pos.z - pos.z) < UPLINK.radius + 1.5) return { kind: 'node', pos: n.pos.clone(), node: n.key };
  }
  return { kind: 'spot', pos };
}

/** Show a ping (from `by`, a fighter). Returns it. */
export function addPing(by, kind, pos, target = null, node = null) {
  // each player keeps only their latest couple of pings
  const mine = list.filter((p) => p.by === by);
  while (mine.length >= PING.perPlayer) removePing(mine.shift());
  const el = document.createElement('div');
  el.className = 'ping ' + kind;
  el.innerHTML = '<i></i><span></span>';
  document.getElementById('pings')?.appendChild(el);
  const label = kind === 'enemy' ? 'ENEMY' : kind === 'node' ? (game.config?.mode === 'uplink' ? 'NODE' : NODE_NAMES[node] || 'NODE') : (by === game.player ? 'GO HERE' : by.name.toUpperCase());
  const p = { id: nextId++, by, kind, pos: pos.clone(), target, label, until: now() + (kind === 'enemy' ? PING.enemyLife : PING.life), el };
  list.push(p);
  return p;
}

function removePing(p) {
  const i = list.indexOf(p);
  if (i >= 0) list.splice(i, 1);
  p.el.remove();
}
export function clearPings() { for (const p of [...list]) removePing(p); }
export const activePings = () => list;

/** Per frame: expire pings and place their markers over the 3D view (clamped to the screen edge). */
export function updatePings(camera, viewer) {
  const t = now(), W = innerWidth, H = innerHeight;
  for (const p of [...list]) {
    if (t > p.until || (p.target && !p.target.alive)) { removePing(p); continue; }
    if (p.target) p.pos.copy(p.target.pos);
    _p.set(p.pos.x, p.pos.y + (p.kind === 'enemy' ? 2.2 : p.kind === 'node' ? 2.5 : 0.6), p.pos.z).project(camera);
    let x = (_p.x * 0.5 + 0.5) * W, y = (-_p.y * 0.5 + 0.5) * H;
    const behind = _p.z > 1;
    if (behind) { x = W - x; y = H - 40; }
    const m = 30;
    x = Math.max(m, Math.min(W - m, x)); y = Math.max(m + 40, Math.min(H - m, y));
    p.el.style.transform = `translate(${x}px, ${y}px)`;
    p.el.classList.toggle('edge', behind || x <= m || x >= W - m);
    const dist = viewer ? Math.round(viewer.pos.distanceTo(p.pos)) : 0;
    const txt = `${p.label} ${dist}m`;
    if (p.el.lastChild.textContent !== txt) p.el.lastChild.textContent = txt;
  }
}
