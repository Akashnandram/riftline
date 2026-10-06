import * as THREE from 'three';
import { game, now } from './state.js';
import { MAP, snapWalkable, navHeight } from './world.js';
import { sfx } from './audio.js';

// Uplink: each round one Rift Node switches on at A, B or mid. Standing in its ring with nobody
// from the other team swings it to your side; while your team owns it you bank hold time.
// First team to bank UPLINK.hold seconds (or to wipe the other team) wins the round.
export const UPLINK = { radius: 4.5, capture: 5, hold: 20 };
const TEAM_HEX = [0x3d8bff, 0xff8a1f], NEUTRAL = 0xe8eaed;

/**
 * Where nodes can appear: on the centre line (x = 0) of the A lane, mid and the B lane. Every
 * point there is the same distance from both spawns, so no team gets there first.
 */
export function nodeSpots() {
  const lanes = MAP.lanes || [-20, 0, 20];
  return lanes.map((z) => {
    const p = snapWalkable({ x: 0, z: (MAP.nodes?.[z] ?? z) });
    return { key: z < 0 ? 'A' : z > 0 ? 'B' : 'MID', x: p.x, z: p.z };
  });
}

let vis = null;
function visuals() {
  if (vis && vis.root.parent) return vis;
  const root = new THREE.Group();
  const add = (geo, mat, y = 0) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; root.add(m); return m; };
  const ringMat = new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const fillMat = new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
  const beamMat = new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending });
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x20242b, metalness: 0.7, roughness: 0.35 });
  const glowMat = new THREE.MeshStandardMaterial({ color: NEUTRAL, emissive: NEUTRAL, emissiveIntensity: 1.6 });
  const ring = add(new THREE.RingGeometry(UPLINK.radius - 0.18, UPLINK.radius, 64), ringMat, 0.04); ring.rotation.x = -Math.PI / 2;
  const fill = add(new THREE.CircleGeometry(UPLINK.radius - 0.18, 64), fillMat, 0.035); fill.rotation.x = -Math.PI / 2;
  add(new THREE.CylinderGeometry(0.35, 0.5, 0.3, 8), coreMat, 0.15);
  const core = add(new THREE.OctahedronGeometry(0.32), glowMat, 1.2);
  add(new THREE.CylinderGeometry(0.12, 0.12, 40, 10, 1, true), beamMat, 20);
  vis = { root, ringMat, fillMat, beamMat, glowMat, core, fill };
  return vis;
}

/** Pick (or set, on clients) this round's node. */
export function resetNode(key = null) {
  const spots = nodeSpots();
  const prev = game.node?.key;
  const spot = key ? spots.find((s) => s.key === key) : (() => { const c = spots.filter((s) => s.key !== prev); return c[Math.floor(Math.random() * c.length)]; })();
  const y = navHeight(spot.x, spot.z);
  game.node = { key: spot.key, pos: new THREE.Vector3(spot.x, y, spot.z), c: 0, owner: -1, hold: [0, 0], contested: false, inside: [0, 0] };
  const v = visuals();
  if (!v.root.parent) game.scene.add(v.root);
  v.root.position.copy(game.node.pos);
  v.root.visible = true;
  paint();
}

export function hideNode() { if (vis) vis.root.visible = false; game.node = null; }

function paint() {
  const n = game.node, v = vis;
  if (!n || !v) return;
  const col = n.owner >= 0 ? TEAM_HEX[n.owner] : NEUTRAL;
  v.ringMat.color.setHex(n.contested ? 0xffffff : col);
  v.beamMat.color.setHex(col); v.glowMat.color.setHex(col); v.glowMat.emissive.setHex(col);
  // the floor disc tints toward whoever is pulling it
  const lean = n.c < 0 ? 0 : 1;
  v.fillMat.color.setHex(Math.abs(n.c) > 0.02 ? TEAM_HEX[lean] : NEUTRAL);
  v.fillMat.opacity = 0.08 + Math.abs(n.c) * 0.22;
}

/** Host/offline per-frame update. Returns the winning team when the round is decided by holding. */
export function updateNode(dt) {
  const n = game.node;
  if (!n) return -1;
  const t = now();
  vis.core.rotation.y = t * 1.5; vis.core.position.y = 1.2 + Math.sin(t * 2) * 0.1;
  if (game.phase !== 'live') return -1;
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
  if (n.owner >= 0 && !n.contested) n.hold[n.owner] += dt;
  if (before !== n.owner && n.owner >= 0) { game.onNodeCaptured?.(n.owner); sfx('capture', { vol: 0.8 }); }
  paint();
  return n.hold[0] >= UPLINK.hold ? 0 : n.hold[1] >= UPLINK.hold ? 1 : -1;
}

/** Clients: mirror the host's node state from a snapshot. */
export function applyNodeSnapshot(s) {
  if (!s) { if (game.node) hideNode(); return; }
  const [key, owner, c, h0, h1, contested] = s;
  if (!game.node || game.node.key !== key) resetNode(key);
  const n = game.node;
  if (n.owner !== owner && owner >= 0) sfx('capture', { vol: 0.8 });
  Object.assign(n, { owner, c, contested: !!contested }); n.hold = [h0, h1];
  paint();
  vis.core.rotation.y = now() * 1.5;
}
export const packNode = (n) => n && [n.key, n.owner, Math.round(n.c * 100) / 100, Math.round(n.hold[0] * 10) / 10, Math.round(n.hold[1] * 10) / 10, n.contested ? 1 : 0];

/** Bot goal in Uplink: a spot around the node (spread by id), looking outward. */
export function uplinkGoal(f) {
  const n = game.node;
  if (!n) return null;
  const ang = f.id * 2.399 + (f.team ? Math.PI : 0), r = 1.2 + (f.id % 3) * 0.9;
  const spot = snapWalkable({ x: n.pos.x + Math.cos(ang) * r, z: n.pos.z + Math.sin(ang) * r });
  const there = Math.hypot(spot.x - f.pos.x, spot.z - f.pos.z) < 1;
  const look = new THREE.Vector3(n.pos.x + Math.cos(ang) * 14, n.pos.y + 1.4, n.pos.z + Math.sin(ang) * 14);
  return { goal: there ? null : spot, look: there ? look : null, walk: false, hold: there };
}
