import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Map layout. Axis-aligned boxes only, so collision + raycasts stay simple.
// The map is point-symmetric around (0,0) so both spawns are equally fair.
// ---------------------------------------------------------------------------
export const BOUNDS = { minX: -40, maxX: 40, minZ: -30, maxZ: 30 };
export const SPAWN_LINE = 30; // spawn walls sit at x = ±30
export const boxes = [];

function add(cx, cz, w, d, h, kind = 'wall', y0 = 0) {
  const b = { minX: cx - w / 2, maxX: cx + w / 2, minY: y0, maxY: y0 + h, minZ: cz - d / 2, maxZ: cz + d / 2, kind };
  boxes.push(b);
  return b;
}
function sym(cx, cz, w, d, h, kind, y0) {
  add(cx, cz, w, d, h, kind, y0);
  if (cx !== 0 || cz !== 0) add(-cx, -cz, w, d, h, kind, y0);
}

function buildLayout() {
  // outer walls
  add(0, -31, 84, 2, 7, 'outer'); add(0, 31, 84, 2, 7, 'outer');
  add(-41, 0, 2, 64, 7, 'outer'); add(41, 0, 2, 64, 7, 'outer');

  // lane dividers (z = ±10) with a mid gap and two connectors
  for (const z of [-10, 10]) {
    for (const [a, b] of [[-30, -19.5], [-16.5, -5], [5, 16.5], [19.5, 30]]) add((a + b) / 2, z, b - a, 1.2, 5, 'wall');
  }
  // spawn walls with three exits each
  for (const x of [-30, 30]) {
    for (const [a, b] of [[-30, -22], [-17, -2.5], [2.5, 17], [22, 30]]) add(x, (a + b) / 2, 1.2, b - a, 5, 'wall');
  }

  // mid
  add(0, 0, 4, 6, 3, 'block');
  sym(-10, 4, 2, 2, 1, 'crate');
  sym(-14, -5, 1.6, 1.6, 2.2, 'crate');
  sym(-22, 0, 1.2, 5, 2.6, 'wall');
  sym(-6, -6, 1.5, 1.5, 1, 'crate');

  // spawn exit cover
  sym(-25, -19.5, 1.2, 4, 2.6, 'wall');
  sym(-25, 19.5, 1.2, 4, 2.6, 'wall');

  // lane A (z < -10) — mirrored into lane B on the other side
  sym(-18, -21, 2.2, 2.2, 2.2, 'crate');
  sym(-16.2, -19.4, 1.2, 1.2, 1, 'crate');
  sym(-10, -25, 3, 1.2, 1.1, 'crate');
  sym(-7, -15, 1.2, 5, 4, 'wall');
  sym(-3, -25, 1.6, 1.6, 5, 'pillar');
  sym(0, -21, 3, 3, 2.4, 'block');

  // lane B (z > 10) — mirrored into lane A on the other side
  sym(-18, 20, 1.6, 4, 2.4, 'wall');
  sym(-12, 24, 2, 2, 1, 'crate');
  sym(-11, 14, 1.6, 1.6, 2.2, 'crate');
  sym(-5, 18, 4, 1.2, 1.1, 'crate');
  sym(-3, 26, 1.6, 1.6, 5, 'pillar');
}
buildLayout();
const STATIC_COUNT = boxes.length;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const KIND_COLORS = { outer: 0x283044, wall: 0xcdb99a, block: 0x8e8577, crate: 0xa8743d, pillar: 0x697a91, barrier: 0x3ee6d6 };

function gridTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#5d6470'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 6, 6);
  }
  g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 3;
  g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(21, 16);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function boxMesh(b, color, opts = {}) {
  const w = b.maxX - b.minX, h = b.maxY - b.minY, d = b.maxZ - b.minZ;
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...opts });
  const m = new THREE.Mesh(geo, mat);
  m.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
  m.castShadow = !opts.transparent;
  m.receiveShadow = true;
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }),
  );
  m.add(edges);
  return m;
}

export function buildWorld(scene) {
  scene.background = new THREE.Color(0x9cb8d8);
  scene.fog = new THREE.Fog(0x9cb8d8, 60, 140);

  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x544a3c, 0.9));
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
  sun.position.set(-30, 50, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 40, bottom: -40, near: 1, far: 140 });
  sun.shadow.bias = -0.0008;
  scene.add(sun);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(84, 64),
    new THREE.MeshStandardMaterial({ map: gridTexture(), roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // tinted spawn zones
  for (const [x, color] of [[-35, 0x3d8bff], [35, 0xff4655]]) {
    const z = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 60),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false }),
    );
    z.rotation.x = -Math.PI / 2;
    z.position.set(x, 0.02, 0);
    scene.add(z);
  }
  // lane labels painted on the floor
  for (const [x, z, text] of [[0, -20, 'A'], [0, 20, 'B'], [0, -6, 'MID']]) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.font = 'bold 90px sans-serif'; g.textAlign = 'center';
    g.fillText(text, 128, 100);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    p.rotation.x = -Math.PI / 2; p.position.set(x + (text === 'MID' ? 0 : 7), 0.03, z);
    scene.add(p);
  }

  for (let i = 0; i < STATIC_COUNT; i++) {
    const b = boxes[i];
    scene.add(boxMesh(b, KIND_COLORS[b.kind]));
  }
}

// ---------------------------------------------------------------------------
// Raycasting
// ---------------------------------------------------------------------------
export function rayBox(o, d, b) {
  let tmin = -Infinity, tmax = Infinity;
  for (const [oa, da, mn, mx] of [[o.x, d.x, b.minX, b.maxX], [o.y, d.y, b.minY, b.maxY], [o.z, d.z, b.minZ, b.maxZ]]) {
    if (Math.abs(da) < 1e-9) {
      if (oa < mn || oa > mx) return Infinity;
    } else {
      let t1 = (mn - oa) / da, t2 = (mx - oa) / da;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  if (tmax < 0) return Infinity;
  return tmin >= 0 ? tmin : 0;
}

export function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  if (t >= 0) return t;
  const t2 = -b + Math.sqrt(disc);
  return t2 >= 0 ? 0 : Infinity;
}

/** Nearest solid hit along a ray (boxes + floor). */
export function raycastWorld(o, d, maxT = 200) {
  let best = maxT;
  for (const b of boxes) {
    const t = rayBox(o, d, b);
    if (t < best) best = t;
  }
  if (d.y < 0) {
    const t = -o.y / d.y;
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Smoke (blocks vision but not bullets)
// ---------------------------------------------------------------------------
export const smokes = []; // { pos, r, until, mesh }

function segmentHitsSphere(a, b, c, r) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz || 1e-9;
  let t = ((c.x - a.x) * abx + (c.y - a.y) * aby + (c.z - a.z) * abz) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + abx * t - c.x, py = a.y + aby * t - c.y, pz = a.z + abz * t - c.z;
  return px * px + py * py + pz * pz < r * r;
}

export function smokeBlocks(a, b) {
  for (const s of smokes) if (segmentHitsSphere(a, b, s.pos, s.r * s.grow)) return true;
  return false;
}

const _d = new THREE.Vector3();
export function hasLOS(a, b, throughSmoke = false) {
  _d.subVectors(b, a);
  const dist = _d.length();
  _d.divideScalar(dist || 1);
  if (raycastWorld(a, _d, dist) < dist - 0.05) return false;
  return throughSmoke || !smokeBlocks(a, b);
}

// ---------------------------------------------------------------------------
// Collision helpers
// ---------------------------------------------------------------------------
export function pointInSolid(p, pad = 0) {
  if (p.y < 0) return true;
  for (const b of boxes) {
    if (p.x > b.minX - pad && p.x < b.maxX + pad && p.y > b.minY - pad && p.y < b.maxY + pad && p.z > b.minZ - pad && p.z < b.maxZ + pad) return b;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Navigation grid + A*
// ---------------------------------------------------------------------------
const NX = BOUNDS.maxX - BOUNDS.minX, NZ = BOUNDS.maxZ - BOUNDS.minZ;
const N = NX * NZ;
const staticBlocked = new Uint8Array(N);
const dynBlocked = new Uint8Array(N);
const NAV_PAD = 0.55;

const cellIdx = (i, j) => j * NX + i;
const cellOfX = (x) => Math.max(0, Math.min(NX - 1, Math.floor(x - BOUNDS.minX)));
const cellOfZ = (z) => Math.max(0, Math.min(NZ - 1, Math.floor(z - BOUNDS.minZ)));
const cx = (i) => BOUNDS.minX + i + 0.5;
const cz = (j) => BOUNDS.minZ + j + 0.5;

function boxCells(b, fn) {
  const i0 = cellOfX(b.minX - NAV_PAD), i1 = cellOfX(b.maxX + NAV_PAD);
  const j0 = cellOfZ(b.minZ - NAV_PAD), j1 = cellOfZ(b.maxZ + NAV_PAD);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = cx(i), z = cz(j);
    if (x > b.minX - NAV_PAD && x < b.maxX + NAV_PAD && z > b.minZ - NAV_PAD && z < b.maxZ + NAV_PAD) fn(cellIdx(i, j));
  }
}

for (let i = 0; i < STATIC_COUNT; i++) {
  const b = boxes[i];
  if (b.minY < 1.6) boxCells(b, (k) => { staticBlocked[k] = 1; });
}

const blocked = (k) => staticBlocked[k] || dynBlocked[k];

export function addDynamicBox(b) {
  boxes.push(b);
  boxCells(b, (k) => { dynBlocked[k]++; });
}
export function removeDynamicBox(b) {
  const i = boxes.indexOf(b);
  if (i >= 0) boxes.splice(i, 1);
  boxCells(b, (k) => { dynBlocked[k] = Math.max(0, dynBlocked[k] - 1); });
}

export function isWalkable(x, z) {
  return !blocked(cellIdx(cellOfX(x), cellOfZ(z)));
}

export function walkableLine(ax, az, bx, bz) {
  const dist = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(dist / 0.35);
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    if (!isWalkable(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
  }
  return true;
}

function nearestFree(k) {
  if (!blocked(k)) return k;
  const i0 = k % NX, j0 = (k / NX) | 0;
  for (let r = 1; r < 8; r++) {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= NX || j >= NZ) continue;
      const kk = cellIdx(i, j);
      if (!blocked(kk)) return kk;
    }
  }
  return k;
}

const gScore = new Float32Array(N);
const came = new Int32Array(N);
const stamp = new Uint32Array(N);
const closed = new Uint32Array(N);
let curStamp = 0;
const heapK = new Int32Array(N * 4), heapF = new Float32Array(N * 4);

export function findPath(sx, sz, gx, gz) {
  const s = nearestFree(cellIdx(cellOfX(sx), cellOfZ(sz)));
  const g = nearestFree(cellIdx(cellOfX(gx), cellOfZ(gz)));
  curStamp++;
  const gi = g % NX, gj = (g / NX) | 0;
  const h = (k) => {
    const di = Math.abs((k % NX) - gi), dj = Math.abs(((k / NX) | 0) - gj);
    return Math.max(di, dj) + 0.414 * Math.min(di, dj);
  };
  let n = 0;
  const push = (k, f) => {
    let i = n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapF[p] <= f) break;
      heapK[i] = heapK[p]; heapF[i] = heapF[p]; i = p;
    }
    heapK[i] = k; heapF[i] = f;
  };
  const pop = () => {
    const top = heapK[0];
    const lk = heapK[--n], lf = heapF[n];
    let i = 0;
    while (true) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && heapF[c + 1] < heapF[c]) c++;
      if (heapF[c] >= lf) break;
      heapK[i] = heapK[c]; heapF[i] = heapF[c]; i = c;
    }
    heapK[i] = lk; heapF[i] = lf;
    return top;
  };

  stamp[s] = curStamp; gScore[s] = 0; came[s] = -1;
  push(s, h(s));
  let found = false, iter = 0;
  while (n > 0 && iter++ < 6000) {
    const k = pop();
    if (closed[k] === curStamp) continue;
    closed[k] = curStamp;
    if (k === g) { found = true; break; }
    const i = k % NX, j = (k / NX) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= NX || nj >= NZ) continue;
      const nk = cellIdx(ni, nj);
      if (blocked(nk) || closed[nk] === curStamp) continue;
      if (di && dj && (blocked(cellIdx(i + di, j)) || blocked(cellIdx(i, j + dj)))) continue;
      const ng = gScore[k] + (di && dj ? 1.414 : 1);
      if (stamp[nk] !== curStamp || ng < gScore[nk]) {
        stamp[nk] = curStamp; gScore[nk] = ng; came[nk] = k;
        push(nk, ng + h(nk));
      }
    }
  }
  if (!found) return null;

  const cells = [];
  for (let k = g; k !== -1; k = came[k]) cells.push(k);
  cells.reverse();
  const pts = cells.map((k) => ({ x: cx(k % NX), z: cz((k / NX) | 0) }));
  pts[pts.length - 1] = isWalkable(gx, gz) ? { x: gx, z: gz } : pts[pts.length - 1];

  // string-pull: skip intermediate points while a straight walk is clear
  const out = [];
  let cur = { x: sx, z: sz };
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !walkableLine(cur.x, cur.z, pts[j].x, pts[j].z)) j--;
    out.push(pts[j]);
    cur = pts[j];
    i = j + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Minimap geometry
// ---------------------------------------------------------------------------
export function drawMapBoxes(g, toPx) {
  for (const b of boxes) {
    if (b.kind === 'outer') continue;
    const [x0, y0] = toPx(b.minX, b.minZ), [x1, y1] = toPx(b.maxX, b.maxZ);
    g.fillStyle = b.kind === 'barrier' ? 'rgba(62,230,214,0.8)' : b.maxY < 1.5 ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.6)';
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
}
