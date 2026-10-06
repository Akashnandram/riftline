import * as THREE from 'three';
import { game, now } from './state.js';
import { MAP, snapWalkable, navHeight } from './world.js';
import { sfx } from './audio.js';

// Capture nodes for the two objective modes (both non-stop, with respawns):
//  Uplink     — one Rift Node is live at a time (North, Core or South) and moves every
//               UPLINK.rotate seconds; owning it scores a point per second. First to UPLINK.target.
//  Domination — all three nodes are live; every node your team owns scores DOM.rate points per
//               second. First to DOM.target.
// Standing in a node's ring with nobody from the other team swings it to your side.
export const UPLINK = { radius: 4.5, capture: 4, rotate: 60, target: 150, time: 480 };
export const DOM = { rate: 0.5, target: 200, time: 480 };
export const NODE_NAMES = { N: 'NORTH', C: 'CORE', S: 'SOUTH' };
const TEAM_HEX = [0x3d8bff, 0xff8a1f], NEUTRAL = 0xe8eaed;
export const nodeMode = () => game.config?.mode === 'uplink' || game.config?.mode === 'dom';

/**
 * Where nodes can appear: on the centre line (x = 0) of the A lane, mid and the B lane. Every
 * point there is the same distance from both spawns, so no team gets there first.
 */
export function nodeSpots() {
  const lanes = MAP.lanes || [-20, 0, 20];
  return lanes.map((z) => {
    const p = snapWalkable({ x: 0, z: (MAP.nodes?.[z] ?? z) });
    return { key: z < 0 ? 'N' : z > 0 ? 'S' : 'C', x: p.x, z: p.z };
  });
}

function makeVisuals(beam) {
  const root = new THREE.Group();
  const add = (geo, mat, y = 0) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; root.add(m); return m; };
  const ringMat = new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const fillMat = new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
  const beamMat = new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: beam, depthWrite: false, blending: THREE.AdditiveBlending });
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x20242b, metalness: 0.7, roughness: 0.35 });
  const glowMat = new THREE.MeshStandardMaterial({ color: NEUTRAL, emissive: NEUTRAL, emissiveIntensity: 1.6 });
  const ring = add(new THREE.RingGeometry(UPLINK.radius - 0.18, UPLINK.radius, 64), ringMat, 0.04); ring.rotation.x = -Math.PI / 2;
  const fill = add(new THREE.CircleGeometry(UPLINK.radius - 0.18, 64), fillMat, 0.035); fill.rotation.x = -Math.PI / 2;
  add(new THREE.CylinderGeometry(0.35, 0.5, 0.3, 8), coreMat, 0.15);
  const core = add(new THREE.OctahedronGeometry(0.32), glowMat, 1.2);
  add(new THREE.CylinderGeometry(0.12, 0.12, 40, 10, 1, true), beamMat, 20);
  game.scene.add(root);
  return { root, ringMat, fillMat, beamMat, glowMat, core };
}
function freeVisuals(v) {
  if (!v) return;
  v.root.parent?.remove(v.root);
  v.root.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
}

function makeNode(spot, beam = 0.18) {
  const y = navHeight(spot.x, spot.z);
  const n = { key: spot.key, pos: new THREE.Vector3(spot.x, y, spot.z), c: 0, owner: -1, contested: false, inside: [0, 0], until: game.time + UPLINK.rotate, vis: makeVisuals(beam) };
  n.vis.root.position.copy(n.pos);
  return n;
}

/** Uplink: pick (or set, on clients) the live node. */
export function resetNode(key = null) {
  const spots = nodeSpots();
  const prev = game.node?.key;
  const spot = key ? spots.find((s) => s.key === key) : (() => { const c = spots.filter((s) => s.key !== prev); return c[Math.floor(Math.random() * c.length)]; })();
  for (const n of game.nodes || []) freeVisuals(n.vis);
  game.node = makeNode(spot);
  game.nodes = [game.node];
  paint(game.node);
}

/** Domination: all three nodes at once. */
export function setupDomination() {
  for (const n of game.nodes || []) freeVisuals(n.vis);
  game.nodes = nodeSpots().map((s) => makeNode(s, 0.12));
  game.node = null;
  for (const n of game.nodes) paint(n);
}

export function hideNode() {
  for (const n of game.nodes || []) freeVisuals(n.vis);
  game.nodes = []; game.node = null;
}

function paint(n) {
  const v = n?.vis;
  if (!v) return;
  const col = n.owner >= 0 ? TEAM_HEX[n.owner] : NEUTRAL;
  v.ringMat.color.setHex(n.contested ? 0xffffff : col);
  v.beamMat.color.setHex(col); v.glowMat.color.setHex(col); v.glowMat.emissive.setHex(col);
  // the floor disc tints toward whoever is pulling it
  const lean = n.c < 0 ? 0 : 1;
  v.fillMat.color.setHex(Math.abs(n.c) > 0.02 ? TEAM_HEX[lean] : NEUTRAL);
  v.fillMat.opacity = 0.08 + Math.abs(n.c) * 0.22;
}

function spin(n) {
  const t = now();
  n.vis.core.rotation.y = t * 1.5; n.vis.core.position.y = 1.2 + Math.sin(t * 2 + n.pos.z) * 0.1;
}

/** Host/offline per-frame update: capture, scoring (game.score) and moving the Uplink node. */
export function updateNode(dt) {
  if (!game.nodes?.length) return;
  const uplink = game.config.mode === 'uplink';
  if (uplink && game.phase === 'live' && game.time >= game.node.until) { resetNode(); game.onNodeMoved?.(game.node); }
  for (const n of game.nodes) {
    spin(n);
    if (game.phase !== 'live') continue;
    n.inside = [0, 0];
    for (const f of game.fighters) {
      if (!f.alive) continue;
      if (Math.hypot(f.pos.x - n.pos.x, f.pos.z - n.pos.z) < UPLINK.radius && Math.abs(f.pos.y - n.pos.y) < 2.5) n.inside[f.team]++;
    }
    const [a, b] = n.inside;
    n.contested = a > 0 && b > 0;
    const before = n.owner;
    if (!n.contested && (a || b)) {
      // c runs from -1 (team 0 owns) to +1 (team 1 owns); more people capture faster
      const dir = a ? -1 : 1, rate = (1 + 0.25 * (Math.max(a, b) - 1)) / UPLINK.capture;
      n.c = Math.max(-1, Math.min(1, n.c + dir * rate * dt));
      if (n.owner >= 0 && Math.sign(n.c) !== (n.owner ? 1 : -1)) n.owner = -1;     // knocked back to neutral
      if (n.c <= -1) n.owner = 0; else if (n.c >= 1) n.owner = 1;
    }
    if (n.owner >= 0 && !n.contested) {
      game.uplinkPts[n.owner] += dt * (uplink ? 1 : DOM.rate);
      game.score[n.owner] = Math.floor(game.uplinkPts[n.owner]);
    }
    if (before !== n.owner && n.owner >= 0) { game.onNodeCaptured?.(n.owner, n); sfx('capture', { vol: 0.8 }); }
    paint(n);
  }
}

/** Clients: mirror the host's node state from a snapshot. */
export function applyNodeSnapshot(list) {
  if (!list || !list.length) { if (game.nodes?.length) hideNode(); return; }
  const keys = list.map((s) => s[0]).join();
  if ((game.nodes || []).map((n) => n.key).join() !== keys) {
    if (list.length === 1) resetNode(list[0][0]);
    else setupDomination();
  }
  list.forEach(([key, owner, c, until, contested], i) => {
    const n = game.nodes[i];
    if (n.owner !== owner && owner >= 0) sfx('capture', { vol: 0.8 });
    Object.assign(n, { owner, c, until, contested: !!contested });
    paint(n); spin(n);
  });
}
export const packNodes = (nodes) => nodes?.length ? nodes.map((n) => [n.key, n.owner, Math.round(n.c * 100) / 100, Math.round(n.until * 10) / 10, n.contested ? 1 : 0]) : null;

/** Which node a bot should go for in Domination: one its team doesn't own, near it, sticky for a while. */
function domTarget(f) {
  const b = f.brain, t = now();
  if (b.domNode && t < b.domUntil && game.nodes.includes(b.domNode)) return b.domNode;
  let best = null, bs = Infinity;
  for (const n of game.nodes) {
    const d = Math.hypot(n.pos.x - f.pos.x, n.pos.z - f.pos.z);
    // prefer nodes we don't own; spread out by id; contested ones are urgent
    const s = d + (n.owner === f.team && !n.contested ? 35 : 0) + ((f.id * 7 + n.key.charCodeAt(0)) % 3) * 6 - (n.contested ? 10 : 0);
    if (s < bs) { bs = s; best = n; }
  }
  b.domNode = best; b.domUntil = t + 6 + Math.random() * 6;
  return best;
}

/** Bot goal in the node modes: a spot around the node (spread by id), looking outward. */
export function uplinkGoal(f) {
  const n = game.config.mode === 'dom' ? domTarget(f) : game.node;
  if (!n) return null;
  const ang = f.id * 2.399 + (f.team ? Math.PI : 0), r = 1.2 + (f.id % 3) * 0.9;
  const spot = snapWalkable({ x: n.pos.x + Math.cos(ang) * r, z: n.pos.z + Math.sin(ang) * r });
  const there = Math.hypot(spot.x - f.pos.x, spot.z - f.pos.z) < 1;
  const look = new THREE.Vector3(n.pos.x + Math.cos(ang) * 14, n.pos.y + 1.4, n.pos.z + Math.sin(ang) * 14);
  return { goal: there ? null : spot, look: there ? look : null, walk: false, hold: there };
}
