import * as THREE from 'three';
import { buildMaterials, TILE, softTexture, floorTextures } from './textures.js';
import { buildProps, mergeByMaterial } from './props.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAPS, MAP_IDS, DEFAULT_MAP } from './maps/index.js';

// ---------------------------------------------------------------------------
// The arena is always 80 x 60 m with spawns behind x = ±30; each map (src/maps/*.js) fills it
// with axis-aligned boxes, so collision + raycasts stay simple. Maps are point-symmetric around
// (0,0) so both sides get identical cover. Raised areas are solid boxes flagged `walk`, reached
// by stairs; the nav grid stores a floor height per cell so bots can use them too.
// ---------------------------------------------------------------------------
export const BOUNDS = { minX: -40, maxX: 40, minZ: -30, maxZ: 30 };
export const SPAWN_LINE = 30;
export const boxes = [];
export { MAPS, MAP_IDS };
export let MAP = null;
export let STATIC_COUNT = 0;
// plant site rectangles [minX, minZ, maxX, maxZ] for the current map (A, B)
export const SITE_RECTS = [];

const LISTS = ['houses', 'vehicles', 'trees', 'lamps', 'barrels', 'sandbags', 'fences', 'stalls', 'stairs', 'containers', 'decor'];
export const MAPDEF = {};
const WALL_T = 0.3;
export const HOUSE_H = 3.2;
export const STEP_UP = 0.32;        // highest ledge you walk up without jumping (stairs are 0.25)

function add(cx, cz, w, d, h, kind = 'wall', y0 = 0, extra = null) {
  const b = { minX: cx - w / 2, maxX: cx + w / 2, minY: y0, maxY: y0 + h, minZ: cz - d / 2, maxZ: cz + d / 2, kind };
  if (extra) Object.assign(b, extra);
  boxes.push(b);
  return b;
}

const mirrorRect = ([x0, z0, x1, z1]) => [-x1, -z1, -x0, -z0];
const FLIP = { n: 's', s: 'n', e: 'w', w: 'e' };
const FLIPDIR = { 'x+': 'x-', 'x-': 'x+', 'z+': 'z-', 'z-': 'z+' };
const mirrorOpenings = (list) => (list || []).map((o) => ({ ...o, side: FLIP[o.side], a: -o.b, b: -o.a }));

function mirrorHouse(h) {
  return {
    ...h, rect: mirrorRect(h.rect),
    openings: mirrorOpenings(h.openings),
    inner: (h.inner || []).map(mirrorRect),
    furniture: (h.furniture || []).map(([cx, cz, w, d, hh, k]) => [-cx, -cz, w, d, hh, k]),
    lamp: h.lamp && [-h.lamp[0], -h.lamp[1]],
  };
}

/** Walls around a rect with doors/windows (houses) or gaps (parapets). Returns nothing. */
function perimeter(rect, openings, H, kind, tint, y0 = 0, T = WALL_T, extra = null) {
  const [x0, z0, x1, z1] = rect;
  const sides = {
    n: { fixed: z0 + (y0 ? T / 2 : 0), lo: x0 - (y0 ? 0 : T / 2), hi: x1 + (y0 ? 0 : T / 2), alongX: true },
    s: { fixed: z1 - (y0 ? T / 2 : 0), lo: x0 - (y0 ? 0 : T / 2), hi: x1 + (y0 ? 0 : T / 2), alongX: true },
    w: { fixed: x0 + (y0 ? T / 2 : 0), lo: z0 + T / 2, hi: z1 - T / 2, alongX: false },
    e: { fixed: x1 - (y0 ? T / 2 : 0), lo: z0 + T / 2, hi: z1 - T / 2, alongX: false },
  };
  for (const [k, sd] of Object.entries(sides)) {
    const seg = (a, b, ya, yb) => {
      if (b - a < 0.01 || yb - ya < 0.01) return;
      const box = sd.alongX ? add((a + b) / 2, sd.fixed, b - a, T, yb - ya, kind, y0 + ya, extra) : add(sd.fixed, (a + b) / 2, T, b - a, yb - ya, kind, y0 + ya, extra);
      if (tint != null) box.tint = tint;
    };
    let cur = sd.lo;
    for (const o of openings.filter((o) => o.side === k).sort((p, q) => p.a - q.a)) {
      seg(cur, o.a, 0, H);
      if (o.type === 'door') seg(o.a, o.b, 2.3, H);
      else if (o.type === 'window') { seg(o.a, o.b, 0, 1.0); seg(o.a, o.b, 2.1, H); }
      cur = o.b;
    }
    seg(cur, sd.hi, 0, H);
  }
}

/** House: perimeter walls with doors/windows, interior walls, furniture and a roof slab. */
function buildHouse(h) {
  const [x0, z0, x1, z1] = h.rect;
  const H = h.height || HOUSE_H;
  perimeter(h.rect, h.openings, H, h.kind || 'hwall', h.color, 0, WALL_T, h.mat ? { mat: h.mat } : null);
  for (const [ax0, az0, ax1, az1] of h.inner || []) add((ax0 + ax1) / 2, (az0 + az1) / 2, ax1 - ax0, az1 - az0, H, 'iwall');
  const roof = add((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0 + 0.6, z1 - z0 + 0.6, 0.22, 'roof', H);
  if (h.flat) { roof.mat = h.roofMat || 'plat'; roof.tint = h.roofTint ?? h.color; }
  for (const [cx, cz, w, d, hh] of h.furniture || []) add(cx, cz, w, d, hh, 'furniture');
  MAPDEF.houses.push({ ...h, height: H });
}

/** Vehicles: car = one low box; truck = tall cargo box + cab at the `dir` end of its long axis. */
function buildVehicle(v) {
  const [x0, z0, x1, z1] = v.rect;
  const alongX = x1 - x0 > z1 - z0;
  if (v.type === 'car') add((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 1.35, 'car');
  else {
    const cab = 2.0;
    const r = alongX
      ? (v.dir > 0 ? [[x0, x1 - cab], [x1 - cab, x1]] : [[x0 + cab, x1], [x0, x0 + cab]])
      : (v.dir > 0 ? [[z0, z1 - cab], [z1 - cab, z1]] : [[z0 + cab, z1], [z0, z0 + cab]]);
    const [[c0, c1], [k0, k1]] = r;
    if (alongX) { add((c0 + c1) / 2, (z0 + z1) / 2, c1 - c0, z1 - z0, 2.9, 'car'); add((k0 + k1) / 2, (z0 + z1) / 2, k1 - k0, z1 - z0 - 0.1, 2.3, 'car'); }
    else { add((x0 + x1) / 2, (c0 + c1) / 2, x1 - x0, c1 - c0, 2.9, 'car'); add((x0 + x1) / 2, (k0 + k1) / 2, x1 - x0 - 0.1, k1 - k0, 2.3, 'car'); }
  }
  MAPDEF.vehicles.push(v);
}

/** Solid staircase inside rect, climbing toward `dir` from h0 to h1 in 0.25 m steps. */
function buildStairs(rect, dir, h1, h0 = 0, opts = {}) {
  const [x0, z0, x1, z1] = rect;
  const n = Math.max(1, Math.round((h1 - h0) / 0.25));
  const alongX = dir[0] === 'x', up = dir[1] === '+';
  const lo = alongX ? x0 : z0, len = alongX ? x1 - x0 : z1 - z0, run = len / n;
  for (let i = 0; i < n; i++) {
    const k = up ? i : n - 1 - i;
    const a = lo + k * run, top = h0 + (i + 1) * (h1 - h0) / n;
    const b = alongX
      ? add(a + run / 2, (z0 + z1) / 2, run, z1 - z0, top, 'step', 0, { walk: true })
      : add((x0 + x1) / 2, a + run / 2, x1 - x0, run, top, 'step', 0, { walk: true });
    if (opts.mat) b.mat = opts.mat;
    if (opts.tint != null) b.tint = opts.tint;
  }
  MAPDEF.stairs.push({ rect, dir, h0, h1, rail: opts.rail ?? MAP.theme.rails !== false });
}

// ---------------------------------------------------------------------------
// Builder API handed to map definitions. `both(fn)` runs fn on the normal and the mirrored API.
// ---------------------------------------------------------------------------
function makeApi(m) {
  const P = (x, z) => (m ? [-x, -z] : [x, z]);
  const R = (r) => (m ? mirrorRect(r) : r);
  const api = {
    mirror: m,
    box(cx, cz, w, d, h, kind = 'wall', y0 = 0, extra = null) { const [x, z] = P(cx, cz); return add(x, z, w, d, h, kind, y0, extra); },
    rect(r, h, kind = 'wall', y0 = 0, extra = null) { const [x0, z0, x1, z1] = R(r); return add((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, h, kind, y0, extra); },
    /** Raised walkable block; opts: { mat, tint, parapet: { h, gaps: [{ side, a, b }] } } */
    platform(r, h, opts = {}) {
      const rr = R(r);
      const b = add((rr[0] + rr[2]) / 2, (rr[1] + rr[3]) / 2, rr[2] - rr[0], rr[3] - rr[1], h, 'plat', opts.y0 || 0, { walk: true });
      if (opts.mat) b.mat = opts.mat;
      if (opts.tint != null) b.tint = opts.tint;
      if (opts.parapet) {
        const gaps = (opts.parapet.gaps || []).map((g) => ({ ...g, type: 'gap' }));
        perimeter(rr, m ? mirrorOpenings(gaps) : gaps, opts.parapet.h || 1.0, 'wall', opts.parapet.tint ?? opts.tint, h + (opts.y0 || 0), 0.3, { mat: opts.parapet.mat || opts.mat || 'plat' });
      }
      return b;
    },
    stairs(r, dir, h1, h0 = 0, opts = {}) { buildStairs(R(r), m ? FLIPDIR[dir] : dir, h1, h0, opts); },
    house(h) { buildHouse(m ? mirrorHouse(h) : h); },
    vehicle(v) { buildVehicle(m ? { ...v, rect: mirrorRect(v.rect), dir: -(v.dir || 1) } : v); },
    tree(x, z, type = 'oak') { const [a, b] = P(x, z); add(a, b, type === 'palm' ? 0.4 : 0.5, type === 'palm' ? 0.4 : 0.5, 3, 'tree'); MAPDEF.trees.push([a, b, type]); },
    lamp(x, z) { const [a, b] = P(x, z); add(a, b, 0.22, 0.22, 4.4, 'pole'); MAPDEF.lamps.push([a, b]); },
    barrel(x, z, y0 = 0) { const [a, b] = P(x, z); add(a, b, 0.7, 0.7, 1.0, 'barrel', y0); MAPDEF.barrels.push([a, b, y0]); },
    sandbag(x, z, w, d, y0 = 0) { const [a, b] = P(x, z); add(a, b, w, d, 1.05, 'sandbag', y0); MAPDEF.sandbags.push([a, b, w, d, y0]); },
    fence(x, z, w, d) { const [a, b] = P(x, z); add(a, b, w, d, 1.2, 'fence'); MAPDEF.fences.push([a, b, w, d]); },
    stall(x, z, w, d) { const [a, b] = P(x, z); add(a, b, w, d, 1.0, 'furniture'); MAPDEF.stalls.push([a, b, w, d]); },
    crate(x, z, s = 1.5, y0 = 0) { const [a, b] = P(x, z); return add(a, b, s, s, s, 'crate', y0); },
    /** Shipping container (2.6 m tall). opts: { y0, walk, color, doors: 'x+'... } */
    container(r, color, opts = {}) {
      const rr = R(r);
      const b = add((rr[0] + rr[2]) / 2, (rr[1] + rr[3]) / 2, rr[2] - rr[0], rr[3] - rr[1], opts.h || 2.6, 'container', opts.y0 || 0, { tint: color, mat: 'container' });
      if (opts.walk) b.walk = true;
      MAPDEF.containers.push({ rect: rr, y0: opts.y0 || 0, h: opts.h || 2.6, color });
      return b;
    },
    rock(x, z, w, d, h, y0 = 0) { const [a, b] = P(x, z); return add(a, b, w, d, h, 'rock', y0, { mat: 'rock' }); },
    /** Visual-only decoration drawn by props.js ({ type, x, z, ... }). */
    decor(o) { const [a, b] = P(o.x || 0, o.z || 0); MAPDEF.decor.push({ ...o, x: a, z: b, rot: (o.rot || 0) + (m ? Math.PI : 0) }); },
  };
  return api;
}

function baseApi() {
  const A = makeApi(false), M = makeApi(true);
  A.both = (fn) => { fn(A); fn(M); };
  /** Perimeter walls (7 m). */
  A.outer = () => {
    add(0, -31, 84, 2, 7, 'outer'); add(0, 31, 84, 2, 7, 'outer');
    add(-41, 0, 2, 64, 7, 'outer'); add(41, 0, 2, 64, 7, 'outer');
  };
  /** Spawn walls at x = ±30 with exits; `exits` are [z0, z1] gaps on the west wall (mirrored east). */
  A.spawnWalls = (exits, h = 5, extra = null) => {
    const cuts = [...exits].sort((a, b) => a[0] - b[0]);
    let cur = -30;
    const segs = [];
    for (const [a, b] of cuts) { if (a > cur) segs.push([cur, a]); cur = b; }
    if (cur < 30) segs.push([cur, 30]);
    A.both((a) => { for (const [z0, z1] of segs) a.box(-30, (z0 + z1) / 2, 1.2, z1 - z0, h, 'wall', 0, extra); });
  };
  return A;
}

// ---------------------------------------------------------------------------
// Spatial grid (4 m cells) so rays and movement only test nearby boxes
// ---------------------------------------------------------------------------
const GS = 4, GX0 = -44, GZ0 = -36, GNX = 22, GNZ = 18, GX1 = GX0 + GS * GNX, GZ1 = GZ0 + GS * GNZ;
const grid = Array.from({ length: GNX * GNZ }, () => []);
let stampN = 1;
const gcx = (x) => Math.max(0, Math.min(GNX - 1, Math.floor((x - GX0) / GS)));
const gcz = (z) => Math.max(0, Math.min(GNZ - 1, Math.floor((z - GZ0) / GS)));
function gridInsert(b) {
  for (let j = gcz(b.minZ); j <= gcz(b.maxZ); j++) for (let i = gcx(b.minX); i <= gcx(b.maxX); i++) grid[j * GNX + i].push(b);
}
function gridRemove(b) {
  for (let j = gcz(b.minZ); j <= gcz(b.maxZ); j++) for (let i = gcx(b.minX); i <= gcx(b.maxX); i++) {
    const c = grid[j * GNX + i], k = c.indexOf(b);
    if (k >= 0) c.splice(k, 1);
  }
}

const NEAR = [];
/** Boxes overlapping the xz rectangle (shared array, valid until the next call). */
export function boxesNear(x0, z0, x1, z1) {
  NEAR.length = 0;
  const s = ++stampN;
  for (let j = gcz(z0); j <= gcz(z1); j++) for (let i = gcx(x0); i <= gcx(x1); i++) {
    const c = grid[j * GNX + i];
    for (let k = 0; k < c.length; k++) { const b = c[k]; if (b._s !== s) { b._s = s; NEAR.push(b); } }
  }
  return NEAR;
}

// cells a ray passes through, with the ray distance where it leaves each one
const RAY_CELLS = new Int32Array(GNX + GNZ + 4), RAY_EXIT = new Float32Array(GNX + GNZ + 4);
function rayCells(o, d, maxT) {
  let t0 = 0, t1 = maxT;
  if (Math.abs(d.x) < 1e-9) { if (o.x < GX0 || o.x > GX1) return 0; }
  else { let a = (GX0 - o.x) / d.x, b = (GX1 - o.x) / d.x; if (a > b) { const t = a; a = b; b = t; } if (a > t0) t0 = a; if (b < t1) t1 = b; }
  if (Math.abs(d.z) < 1e-9) { if (o.z < GZ0 || o.z > GZ1) return 0; }
  else { let a = (GZ0 - o.z) / d.z, b = (GZ1 - o.z) / d.z; if (a > b) { const t = a; a = b; b = t; } if (a > t0) t0 = a; if (b < t1) t1 = b; }
  if (t0 > t1) return 0;
  let ix = gcx(o.x + d.x * t0), iz = gcz(o.z + d.z * t0);
  const sx = d.x > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
  const dtx = Math.abs(d.x) < 1e-9 ? Infinity : GS / Math.abs(d.x), dtz = Math.abs(d.z) < 1e-9 ? Infinity : GS / Math.abs(d.z);
  let tx = Math.abs(d.x) < 1e-9 ? Infinity : ((GX0 + (ix + (d.x > 0 ? 1 : 0)) * GS) - o.x) / d.x;
  let tz = Math.abs(d.z) < 1e-9 ? Infinity : ((GZ0 + (iz + (d.z > 0 ? 1 : 0)) * GS) - o.z) / d.z;
  let n = 0;
  while (n < RAY_CELLS.length) {
    const exit = Math.min(tx, tz, t1);
    RAY_CELLS[n] = iz * GNX + ix; RAY_EXIT[n] = exit; n++;
    if (exit >= t1) break;
    if (tx < tz) { ix += sx; tx += dtx; if (ix < 0 || ix >= GNX) break; } else { iz += sz; tz += dtz; if (iz < 0 || iz >= GNZ) break; }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Map loading
// ---------------------------------------------------------------------------
const listeners = [];
/** Run fn after every map load (sites, tactics, spawn tables recompute from the new layout). */
export function onMapLoad(fn) { listeners.push(fn); if (MAP) fn(MAP); }

export function loadMap(id) {
  const def = MAPS[id] || MAPS[DEFAULT_MAP];
  if (MAP === def) return false;
  MAP = def;
  boxes.length = 0;
  for (const k of LISTS) MAPDEF[k] = [];
  for (const c of grid) c.length = 0;
  def.build(baseApi());
  STATIC_COUNT = boxes.length;
  for (const b of boxes) gridInsert(b);
  SITE_RECTS.length = 0;
  for (const k of ['A', 'B']) { const s = def.sites[k]; SITE_RECTS.push([s.min.x, s.min.z, s.max.x, s.max.z]); }
  rebuildNav();
  mmCache = null;
  for (const fn of listeners) fn(def);
  return true;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
let MATS = null;
const FALLBACK = { outer: 0x283044, wall: 0xcdb99a, block: 0x8e8577, crate: 0xa8743d, pillar: 0x697a91, barrier: 0x3ee6d6 };
const DEFAULT_MAT = { plat: 'block', step: 'block' };

/** Box geometry whose UVs are in world metres / tile, so textures keep their scale on any box size. */
function worldUVBox(w, h, d, tile, seg = 1) {
  const geo = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  if (!tile) return geo;
  const uv = geo.attributes.uv;
  const per = geo.attributes.uv.count / 6;
  // face order: +x, -x, +y, -y, +z, -z
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < per; k++) {
      const i = f * per + k;
      uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
    }
  }
  return geo;
}

const tintCache = new Map();
function matName(b) {
  const n = b.mat || b.kind;
  return MAP?.theme?.mat?.[n] || DEFAULT_MAT[n] || n;
}
function baseMat(name) { return MATS[name]?.isMaterial ? MATS[name] : MATS.extra(name); }
function tinted(name, tint) {
  const base = baseMat(name);
  if (tint == null || !base) return base;
  const k = name + tint;
  if (!tintCache.has(k)) { const m = base.clone(); m.color.setHex(tint); tintCache.set(k, m); }
  return tintCache.get(k);
}
// kinds drawn by props.js instead of as plain boxes
const PROP_KINDS = new Set(['car', 'tree', 'pole', 'barrel', 'sandbag', 'fence']);

export function boxMesh(b, color, opts = {}) {
  const w = b.maxX - b.minX, h = b.maxY - b.minY, d = b.maxZ - b.minZ;
  const name = matName(b);
  const mat0 = !opts.transparent && MATS && baseMat(name);
  const rocky = b.kind === 'rock' && !opts.transparent;
  const geo = worldUVBox(w, h, d, mat0 ? TILE[name] : 0, rocky ? 3 : 1);
  if (rocky) roughen(geo, w, h, d);
  const mat = mat0 ? tinted(name, b.tint ?? (b.mat && MAP?.theme?.tint?.[b.mat]) ?? MAP?.theme?.tint?.[b.kind]) : new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...opts });
  const m = new THREE.Mesh(geo, mat);
  m.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
  m.castShadow = !opts.transparent;
  m.receiveShadow = true;
  if (opts.transparent) {
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    m.add(edges);
  }
  return m;
}

/** Push a subdivided box's vertices around so boulders look chiselled (stays close to the collider). */
function roughen(geo, w, h, d) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * 3.1 + z * 1.7) * Math.cos(y * 2.3 + x * 0.7) + Math.sin(z * 4.3 - y * 1.1) * 0.5;
    const k = 1 + n * 0.06;
    const top = y > h / 2 - 1e-3 ? 0.92 : 1;           // round the top edge a little
    p.setXYZ(i, x * k * (y > 0 ? top : 1), y * (1 + n * 0.03), z * k * (y > 0 ? top : 1));
  }
  geo.computeVertexNormals();
}

function addTrims(group, b) {
  const w = b.maxX - b.minX, h = b.maxY - b.minY, d = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const add = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.set(cx, y, cz); m.castShadow = m.receiveShadow = true; group.add(m); };
  const trims = MAP.theme.trims !== false;
  if (trims && ((b.kind === 'wall' && !b.mat) || b.kind === 'block')) {
    add(new THREE.BoxGeometry(w + 0.08, 0.1, d + 0.08), MATS.trim, b.maxY + 0.05);
    if (b.minY < 0.1) add(new THREE.BoxGeometry(w + 0.04, 0.22, d + 0.04), MATS.base, 0.11);
  } else if (b.kind === 'pillar' && trims) {
    add(new THREE.BoxGeometry(w + 0.12, 0.25, d + 0.12), MATS.trim, b.minY + 0.125);
    add(new THREE.BoxGeometry(w + 0.12, 0.2, d + 0.12), MATS.trim, b.maxY - 0.1);
  } else if (b.kind === 'outer') {
    add(new THREE.BoxGeometry(w, 0.3, d + 0.1), MATS.trim, 0.15);
  } else if (b.kind === 'plat' && trims) {
    // coping stone around the top edge of raised areas
    add(new THREE.BoxGeometry(w + 0.1, 0.12, d + 0.1), MATS.trim, b.maxY - 0.04);
  }
  if (MAP.theme.snowCaps && b.kind !== 'roof' && b.kind !== 'step' && b.kind !== 'iwall' && b.kind !== 'furniture' && b.maxY > 0.4) {
    add(new THREE.BoxGeometry(w + 0.06, 0.07, d + 0.06), MATS.snowcap, b.maxY + 0.035);
  }
}

let root = null, dust = null, skyMat = null, envTex = null, dustMode = 'dust';
const spawnMats = [];
export function setSpawnColors(west, east) {
  for (const s of spawnMats) { const c = s.side < 0 ? west : east; s.zoneMat.color.setHex(c); s.lineMat.color.setHex(c); }
}
export function updateWorldFx(t) {
  if (skyMat) skyMat.uniforms.time.value = t;
  if (!dust) return;
  if (dustMode === 'snow') {
    const p = dust.geometry.attributes.position, a = p.array;
    const dt = Math.min(0.1, t - (dust.userData.t ?? t)); dust.userData.t = t;
    for (let i = 0; i < a.length; i += 3) {
      a[i + 1] -= dt * (1.2 + (i % 7) * 0.12);
      a[i] += Math.sin(t * 0.7 + i) * dt * 0.3;
      if (a[i + 1] < 0) a[i + 1] += 14;
    }
    p.needsUpdate = true;
    return;
  }
  dust.rotation.y = t * 0.004;
  dust.position.y = Math.sin(t * 0.2) * 0.3;
}

const col = (a) => new THREE.Vector3(...a);
const THEME_DEFAULT = {
  sky: { zenith: [0.10, 0.25, 0.55], mid: [0.26, 0.45, 0.72], horizon: [0.56, 0.66, 0.78], ground: [0.32, 0.34, 0.36], clouds: 0.85, cloudDark: [0.62, 0.66, 0.72], cloudLight: [0.92, 0.92, 0.9] },
  sun: { elev: 55, azim: -130, color: 0xffe9cf, intensity: 2.0, disc: [0.98, 0.95, 0.86] },
  hemi: [0xcfe0ff, 0x5a4e40, 0.15],
  env: { top: [0.26, 0.42, 0.68], hor: [0.6, 0.68, 0.76], gnd: [0.22, 0.2, 0.18], intensity: 0.6 },
  fog: [0x9fb0c2, 95, 260],
  floor: 'concrete', floorTint: 0xffffff,
  particles: { color: 0xfff4e0, mode: 'dust', count: 700 },
  backdrop: null,
};

/** Free the previous map's meshes, materials and environment map. */
function disposeWorld(scene) {
  if (!root) return;
  // shared (cached) materials survive map changes; per-map ones are freed
  for (const m of Object.values(MATS || {})) if (m?.isMaterial) m.userData.shared = true;
  for (const m of tintCache.values()) m.userData.shared = true;
  scene.remove(root);
  root.traverse((o) => {
    o.geometry?.dispose();
    if (o.material && !o.material.userData?.shared) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    if (o.isLight && o.shadow?.map) o.shadow.map.dispose();
  });
  envTex?.dispose(); envTex = null;
  root = null; dust = null; skyMat = null;
  spawnMats.length = 0;
}

export function buildWorld(scene, renderer, quality = 'medium') {
  if (!MAP) loadMap(DEFAULT_MAP);
  disposeWorld(scene);
  MATS = buildMaterials(quality);
  root = new THREE.Group();
  root.name = 'world';
  scene.add(root);
  const T = { ...THEME_DEFAULT, ...MAP.theme };
  const sky = { ...THEME_DEFAULT.sky, ...(MAP.theme.sky || {}) };
  const sunT = { ...THEME_DEFAULT.sun, ...(MAP.theme.sun || {}) };
  const envT = { ...THEME_DEFAULT.env, ...(MAP.theme.env || {}) };

  // custom sky dome: gradient, small soft sun (no glare halo) and drifting clouds.
  // Values stay below the bloom threshold so the sky never blooms or washes out the view.
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - sunT.elev), THREE.MathUtils.degToRad(sunT.azim));
  skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      sun: { value: sunDir }, time: { value: 0 }, zenith: { value: col(sky.zenith) }, mid: { value: col(sky.mid) }, horizon: { value: col(sky.horizon) },
      ground: { value: col(sky.ground) }, clouds: { value: sky.clouds }, cDark: { value: col(sky.cloudDark) }, cLight: { value: col(sky.cloudLight) }, disc: { value: col(sunT.disc) },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = vec4(p.xy, p.w * 0.99999, p.w); }',
    fragmentShader: `uniform vec3 sun; uniform float time; uniform vec3 zenith, mid, horizon, ground, cDark, cLight, disc; uniform float clouds; varying vec3 vDir;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a*n(p); p *= 2.03; a *= 0.5; } return v; }
      void main(){
        vec3 d = normalize(vDir);
        float y = max(d.y, 0.0);
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.25, y));
        c = mix(c, zenith, smoothstep(0.25, 0.9, y));
        float s = max(dot(d, sun), 0.0);
        c += disc * pow(s, 24.0) * 0.12;                                 // faint warm sky near the sun
        vec2 uv = d.xz / (d.y + 0.12) * 1.4 + vec2(time * 0.004, time * 0.0015);
        float cl = smoothstep(0.52, 0.78, fbm(uv)) * clouds;
        float edge = smoothstep(0.02, 0.22, d.y);
        vec3 cloudCol = mix(cDark, cLight, fbm(uv * 2.0 + 3.0));
        cloudCol += vec3(0.12, 0.09, 0.05) * pow(s, 6.0);
        c = mix(c, cloudCol, cl * edge);
        float dsc = smoothstep(0.9993, 0.9997, s);                       // small sun disc, no bloom halo
        c = mix(c, disc, dsc * (1.0 - cl * 0.8));
        if (d.y < 0.0) c = mix(horizon, ground, smoothstep(0.0, 0.3, -d.y));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), skyMat);
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = -1;
  root.add(skyMesh);
  // image-based lighting from a controlled gradient sky
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { sun: { value: sunDir }, top: { value: col(envT.top) }, hor: { value: col(envT.hor) }, gnd: { value: col(envT.gnd) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform vec3 sun, top, hor, gnd; varying vec3 vDir;
      void main(){
        float y = vDir.y;
        vec3 c = y > 0.0 ? mix(hor, top, pow(y, 0.6)) : mix(hor, gnd, pow(-y, 0.4));
        c += vec3(1.0, 0.9, 0.75) * pow(max(dot(vDir, sun), 0.0), 64.0) * 4.0;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const envSphere = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envMat);
  envScene.add(envSphere);
  envTex = pmrem.fromScene(envScene, 0.02).texture;
  envSphere.geometry.dispose(); envMat.dispose(); pmrem.dispose();
  scene.environment = envTex;
  scene.environmentIntensity = envT.intensity;
  scene.fog = new THREE.Fog(T.fog[0], T.fog[1], T.fog[2]);

  root.add(new THREE.HemisphereLight(T.hemi[0], T.hemi[1], T.hemi[2]));
  const sun = new THREE.DirectionalLight(sunT.color, sunT.intensity);
  sun.position.copy(sunDir).multiplyScalar(70);
  sun.castShadow = quality !== 'low';
  sun.shadow.mapSize.set(quality === 'high' ? 4096 : 2048, quality === 'high' ? 4096 : 2048);
  Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 44, bottom: -44, near: 1, far: 160 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  root.add(sun);

  const floorTex = floorTextures(T.floor, quality);
  for (const t of Object.values(floorTex)) t.repeat.set(21, 16);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(84, 64),
    new THREE.MeshStandardMaterial({ ...floorTex, color: T.floorTint, roughness: 1, normalScale: new THREE.Vector2(0.8, 0.8) }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);

  // painted spawn zones (recoloured when teams swap sides)
  for (const side of [-1, 1]) {
    const zoneMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.045, depthWrite: false });
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
    const z = new THREE.Mesh(new THREE.PlaneGeometry(10, 60), zoneMat);
    z.rotation.x = -Math.PI / 2; z.position.set(side * 35, 0.02, 0);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 60), lineMat);
    line.rotation.x = -Math.PI / 2; line.position.set(side * 31, 0.025, 0);
    root.add(z, line);
    spawnMats.push({ side, zoneMat, lineMat });
  }
  setSpawnColors(0x3d8bff, 0xff4655);

  // plant sites: yellow boundary + big letter
  const siteMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.55, depthWrite: false });
  for (const [x0, z0, x1, z1] of SITE_RECTS) {
    for (const [cx, cz, w, d] of [[(x0 + x1) / 2, z0, x1 - x0, 0.2], [(x0 + x1) / 2, z1, x1 - x0, 0.2], [x0, (z0 + z1) / 2, 0.2, z1 - z0], [x1, (z0 + z1) / 2, 0.2, z1 - z0]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), siteMat);
      m.rotation.x = -Math.PI / 2; m.position.set(cx, groundAt(cx, cz) + 0.026, cz);
      root.add(m);
    }
  }
  const labels = MAP.labels || [[MAP.sites.A.center.x, MAP.sites.A.center.z + 4.5, 'A', 4], [MAP.sites.B.center.x, MAP.sites.B.center.z - 4.5, 'B', 4], [0, -6.5, 'MID', 3.5]];
  for (const [x, z, text, size] of labels) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = text === 'MID' ? 'rgba(255,255,255,0.6)' : 'rgba(255,214,63,0.75)'; g.font = 'bold 110px sans-serif'; g.textAlign = 'center';
    g.fillText(text, 128, 108);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(size, size / 2), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.9 }));
    p.rotation.x = -Math.PI / 2; p.position.set(x, groundAt(x, z) + 0.03, z);
    if (z > 0) p.rotation.z = Math.PI;
    p.receiveShadow = true;
    root.add(p);
  }

  // static map geometry is built into a temp group, then baked into one mesh per material:
  // hundreds of walls/crates/trims become ~20 draw calls (a big win on integrated GPUs)
  const staticGroup = new THREE.Group();
  for (let i = 0; i < STATIC_COUNT; i++) {
    const b = boxes[i];
    if (PROP_KINDS.has(b.kind) || b.hidden) continue;
    staticGroup.add(boxMesh(b, FALLBACK[b.kind]));
    addTrims(staticGroup, b);
  }
  mergeByMaterial(staticGroup, root);
  buildProps(root, MAPDEF, MATS, quality, MAP);
  if (T.backdrop) root.add(backdrop(T.backdrop));

  // floating dust motes / falling snow
  const pt = { ...THEME_DEFAULT.particles, ...(MAP.theme.particles || {}) };
  dustMode = pt.mode;
  if (quality !== 'low' && pt.count) {
    const n = quality === 'high' ? pt.count : Math.round(pt.count * 0.6), pos = new Float32Array(n * 3);
    const H = pt.mode === 'snow' ? 14 : 6;
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 80; pos[i * 3 + 1] = Math.random() * H; pos[i * 3 + 2] = (Math.random() - 0.5) * 60; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dust = new THREE.Points(geo, new THREE.PointsMaterial({ size: pt.mode === 'snow' ? 0.07 : 0.035, color: pt.color, transparent: true, opacity: pt.mode === 'snow' ? 0.85 : 0.45, map: softTexture(), depthWrite: false }));
    dust.frustumCulled = false;
    root.add(dust);
  }
}

/** Ring of distant terrain (hills, dunes, peaks, skyline) so the horizon isn't empty. One draw call. */
function backdrop(o) {
  if (o.city) return skyline(o);
  const segs = 160, rings = 6, R0 = 115, R1 = 190;
  const pos = [], colr = [], idx = [];
  const base = new THREE.Color(o.color), top = new THREE.Color(o.top ?? o.color), snow = new THREE.Color(0xf4f7fb);
  const hAt = (a, r) => {
    const t = a * segs;
    let h = 0;
    for (const [f, w] of o.waves || [[3, 0.5], [7, 0.3], [17, 0.15], [41, 0.06]]) h += (Math.sin(t * f / segs * Math.PI * 2 + f * 1.7) * 0.5 + 0.5) * w;
    return h * o.height * (0.55 + 0.45 * Math.sin(a * Math.PI * 6 + r * 0.02) ** 2) * (r - R0) / (R1 - R0) + (o.base ?? 2);
  };
  for (let j = 0; j <= rings; j++) {
    const r = R0 + (R1 - R0) * (j / rings);
    for (let i = 0; i <= segs; i++) {
      const a = i / segs, ang = a * Math.PI * 2;
      const h = j === 0 ? -2 : hAt(a, r) * (o.sharp ? (1 + Math.abs(Math.sin(a * 97)) * 0.4) : 1);
      pos.push(Math.cos(ang) * r, h, Math.sin(ang) * r);
      const k = Math.min(1, Math.max(0, h / (o.height + 0.01)));
      const c = base.clone().lerp(top, k);
      if (o.snowLine != null && h > o.height * o.snowLine) c.lerp(snow, 0.85);
      colr.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
    const a = j * (segs + 1) + i, b = a + segs + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide, flatShading: !!o.sharp }));
  m.receiveShadow = false;
  return m;
}

/** Distant city blocks + a few lit windows, merged into one vertex-coloured mesh. */
function skyline(o) {
  const geos = [];
  const base = new THREE.Color(o.color), top = new THREE.Color(o.top ?? o.color), lit = new THREE.Color(o.lit ?? 0xffc98a);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 150; i++) {
    const a = (i / 150) * Math.PI * 2 + rnd() * 0.03;
    const r = 105 + rnd() * 70, w = 6 + rnd() * 12, d = 6 + rnd() * 12, h = 10 + rnd() * rnd() * o.height;
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r);
    g.rotateY(0);
    const n = g.attributes.position.count, colr = new Float32Array(n * 3);
    const c = base.clone().lerp(top, rnd() * 0.8);
    for (let k = 0; k < n; k++) {
      const y = g.attributes.position.getY(k);
      const cc = y > h * 0.6 && rnd() < 0.25 ? c.clone().lerp(lit, 0.6) : c;
      colr[k * 3] = cc.r; colr[k * 3 + 1] = cc.g; colr[k * 3 + 2] = cc.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.1 }));
}

export function surfaceOf(kind) {
  if (kind === 'crate' || kind === 'furniture' || kind === 'fence' || kind === 'tree') return 'wood';
  if (kind === 'pillar' || kind === 'outer' || kind === 'car' || kind === 'pole' || kind === 'barrel' || kind === 'container') return 'metal';
  if (kind === 'sandbag') return 'floor';
  if (kind === 'barrier') return 'energy';
  return 'concrete';
}

/** Surface under a fighter's feet (for footsteps). */
export function surfaceUnder(p) {
  if (p.y < 0.05) return MAP?.theme?.floorSurface || 'concrete';
  for (const b of boxesNear(p.x - 0.4, p.z - 0.4, p.x + 0.4, p.z + 0.4)) {
    if (p.x > b.minX - 0.4 && p.x < b.maxX + 0.4 && p.z > b.minZ - 0.4 && p.z < b.maxZ + 0.4 && Math.abs(p.y - b.maxY) < 0.1) return surfaceOf(b.kind);
  }
  return 'concrete';
}

/** Height of the walkable surface at (x, z): the top of a raised area / stair, else 0. */
export function groundAt(x, z) {
  let h = 0;
  for (const b of boxesNear(x, z, x, z)) if (b.walk && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && b.maxY > h) h = b.maxY;
  return h;
}

// ---------------------------------------------------------------------------
// Raycasting
// ---------------------------------------------------------------------------
// Slab tests, unrolled and allocation-free: these run thousands of times per second
// (bullets, bot vision, audio occlusion), so they must not create garbage.
export function rayBox(o, d, b) {
  let tmin = -Infinity, tmax = Infinity, t1, t2, tt;
  if (Math.abs(d.x) < 1e-9) { if (o.x < b.minX || o.x > b.maxX) return Infinity; }
  else { t1 = (b.minX - o.x) / d.x; t2 = (b.maxX - o.x) / d.x; if (t1 > t2) { tt = t1; t1 = t2; t2 = tt; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return Infinity; }
  if (Math.abs(d.y) < 1e-9) { if (o.y < b.minY || o.y > b.maxY) return Infinity; }
  else { t1 = (b.minY - o.y) / d.y; t2 = (b.maxY - o.y) / d.y; if (t1 > t2) { tt = t1; t1 = t2; t2 = tt; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return Infinity; }
  if (Math.abs(d.z) < 1e-9) { if (o.z < b.minZ || o.z > b.maxZ) return Infinity; }
  else { t1 = (b.minZ - o.z) / d.z; t2 = (b.maxZ - o.z) / d.z; if (t1 > t2) { tt = t1; t1 = t2; t2 = tt; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return Infinity; }
  if (tmax < 0) return Infinity;
  return tmin >= 0 ? tmin : 0;
}

/** [entry, exit] distances of a ray through a box, or null. Entry is clamped to 0. */
export function rayBoxRange(o, d, b) {
  let tmin = -Infinity, tmax = Infinity, t1, t2, tt;
  if (Math.abs(d.x) < 1e-9) { if (o.x < b.minX || o.x > b.maxX) return null; }
  else { t1 = (b.minX - o.x) / d.x; t2 = (b.maxX - o.x) / d.x; if (t1 > t2) { tt = t1; t1 = t2; t2 = tt; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return null; }
  if (Math.abs(d.y) < 1e-9) { if (o.y < b.minY || o.y > b.maxY) return null; }
  else { t1 = (b.minY - o.y) / d.y; t2 = (b.maxY - o.y) / d.y; if (t1 > t2) { tt = t1; t1 = t2; t2 = tt; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return null; }
  if (Math.abs(d.z) < 1e-9) { if (o.z < b.minZ || o.z > b.maxZ) return null; }
  else { t1 = (b.minZ - o.z) / d.z; t2 = (b.maxZ - o.z) / d.z; if (t1 > t2) { tt = t1; t1 = t2; t2 = tt; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return null; }
  if (tmax < 0) return null;
  return [Math.max(0, tmin), tmax];
}

/** Every box a ray passes near, in rough order (each once). Shared array. */
const ALONG = [];
export function boxesAlongRay(o, d, maxT) {
  ALONG.length = 0;
  const n = rayCells(o, d, maxT), s = ++stampN;
  for (let c = 0; c < n; c++) {
    const cell = grid[RAY_CELLS[c]];
    for (let k = 0; k < cell.length; k++) { const b = cell[k]; if (b._s !== s) { b._s = s; ALONG.push(b); } }
  }
  return ALONG;
}

/** Outward normal of the box face closest to point p. */
export function boxNormalAt(b, p, out = new THREE.Vector3()) {
  const e = [[Math.abs(p.x - b.minX), -1, 0, 0], [Math.abs(p.x - b.maxX), 1, 0, 0], [Math.abs(p.y - b.minY), 0, -1, 0],
    [Math.abs(p.y - b.maxY), 0, 1, 0], [Math.abs(p.z - b.minZ), 0, 0, -1], [Math.abs(p.z - b.maxZ), 0, 0, 1]];
  let best = e[0];
  for (const c of e) if (c[0] < best[0]) best = c;
  return out.set(best[1], best[2], best[3]);
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

let lastHitBox = null;
/** Nearest box hit along a ray (grid traversal with early exit). */
function nearestBox(o, d, maxT) {
  let best = maxT;
  lastHitBox = null;
  const n = rayCells(o, d, maxT), s = ++stampN;
  for (let c = 0; c < n; c++) {
    const cell = grid[RAY_CELLS[c]];
    for (let k = 0; k < cell.length; k++) {
      const b = cell[k];
      if (b._s === s) continue;
      b._s = s;
      const t = rayBox(o, d, b);
      if (t < best) { best = t; lastHitBox = b; }
    }
    if (best <= RAY_EXIT[c]) break;
  }
  return best;
}

/** Like raycastWorld but also returns the hit normal and surface kind. */
export function raycastWorldHit(o, d, maxT = 200) {
  const best = nearestBox(o, d, maxT), box = lastHitBox;
  const hit = { t: best, n: new THREE.Vector3(), kind: box ? box.kind : null };
  if (d.y < 0) {
    const t = -o.y / d.y;
    if (t >= 0 && t < best) { hit.t = t; hit.kind = 'floor'; hit.n.set(0, 1, 0); return hit; }
  }
  if (box) {
    const px = o.x + d.x * best, py = o.y + d.y * best, pz = o.z + d.z * best;
    boxNormalAt(box, { x: px, y: py, z: pz }, hit.n);
  }
  return hit;
}

/** Nearest solid hit along a ray (boxes + floor). */
export function raycastWorld(o, d, maxT = 200) {
  let best = nearestBox(o, d, maxT);
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
  for (const b of boxesNear(p.x - pad, p.z - pad, p.x + pad, p.z + pad)) {
    if (p.x > b.minX - pad && p.x < b.maxX + pad && p.y > b.minY - pad && p.y < b.maxY + pad && p.z > b.minZ - pad && p.z < b.maxZ + pad) return b;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Navigation grid (1 m cells with a floor height each) + A*
// ---------------------------------------------------------------------------
const NX = BOUNDS.maxX - BOUNDS.minX, NZ = BOUNDS.maxZ - BOUNDS.minZ;
const N = NX * NZ;
const staticBlocked = new Uint8Array(N);
const dynBlocked = new Uint8Array(N);
const navH = new Float32Array(N);
const NAV_PAD = 0.55, LEDGE_PAD = 0.3;
const NAV_UP = 0.8, NAV_DOWN = 4.5;   // max rise between neighbouring cells (stairs), max drop off a ledge

const cellIdx = (i, j) => j * NX + i;
const cellOfX = (x) => Math.max(0, Math.min(NX - 1, Math.floor(x - BOUNDS.minX)));
const cellOfZ = (z) => Math.max(0, Math.min(NZ - 1, Math.floor(z - BOUNDS.minZ)));
const cx = (i) => BOUNDS.minX + i + 0.5;
const cz = (j) => BOUNDS.minZ + j + 0.5;

function boxCells(b, pad, fn) {
  const i0 = cellOfX(b.minX - pad), i1 = cellOfX(b.maxX + pad);
  const j0 = cellOfZ(b.minZ - pad), j1 = cellOfZ(b.maxZ + pad);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = cx(i), z = cz(j);
    if (x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad) fn(cellIdx(i, j));
  }
}
/** Does box b stand in the way of someone on cell k (floor height navH[k])? */
const obstructs = (b, k) => b.maxY > navH[k] + (b.walk ? NAV_UP : STEP_UP) && b.minY < navH[k] + 1.6;

function rebuildNav() {
  navH.fill(0); staticBlocked.fill(0); dynBlocked.fill(0); stairAxis.fill(0);
  // floor height = highest walkable top over the cell centre (edges inclusive, so a cell on the
  // boundary between two stair steps takes the higher one)
  for (let i = 0; i < STATIC_COUNT; i++) {
    const b = boxes[i];
    if (!b.walk) continue;
    for (let j = cellOfZ(b.minZ); j <= cellOfZ(b.maxZ); j++) for (let ii = cellOfX(b.minX); ii <= cellOfX(b.maxX); ii++) {
      const x = cx(ii), z = cz(j), k = cellIdx(ii, j);
      if (x >= b.minX - 1e-6 && x <= b.maxX + 1e-6 && z >= b.minZ - 1e-6 && z <= b.maxZ + 1e-6 && b.maxY > navH[k]) navH[k] = b.maxY;
    }
  }
  for (const st of MAPDEF.stairs) {
    const [x0, z0, x1, z1] = st.rect;
    boxCells({ minX: x0 - 0.5, maxX: x1 + 0.5, minZ: z0, maxZ: z1 }, 0, (k) => { if (st.dir[0] === 'x') stairAxis[k] = 1; });
    boxCells({ minX: x0, maxX: x1, minZ: z0 - 0.5, maxZ: z1 + 0.5 }, 0, (k) => { if (st.dir[0] === 'z') stairAxis[k] = 2; });
  }
  for (let i = 0; i < STATIC_COUNT; i++) {
    const b = boxes[i];
    boxCells(b, b.walk ? LEDGE_PAD : NAV_PAD, (k) => { if (obstructs(b, k)) staticBlocked[k] = 1; });
  }
}

const blocked = (k) => staticBlocked[k] || dynBlocked[k];
// along a staircase's own axis the per-cell rise can be steeper than NAV_UP (it's still small steps)
const stairAxis = new Uint8Array(N);   // 0 none, 1 = climbs along x, 2 = along z
function canStep(k, nk) {
  const dh = navH[nk] - navH[k];
  if (dh < -NAV_DOWN) return false;
  if (dh <= NAV_UP) return true;
  const d = nk - k, ax = (d === 1 || d === -1) ? 1 : (d === NX || d === -NX) ? 2 : 0;
  return ax !== 0 && dh <= 1.25 && (stairAxis[k] === ax || stairAxis[nk] === ax);
}

export function addDynamicBox(b) {
  boxes.push(b);
  gridInsert(b);
  b._navCells = [];
  boxCells(b, NAV_PAD, (k) => { if (obstructs(b, k)) { dynBlocked[k]++; b._navCells.push(k); } });
}
export function removeDynamicBox(b) {
  const i = boxes.indexOf(b);
  if (i >= 0) boxes.splice(i, 1);
  gridRemove(b);
  for (const k of b._navCells || []) dynBlocked[k] = Math.max(0, dynBlocked[k] - 1);
}

export function isWalkable(x, z) {
  return !blocked(cellIdx(cellOfX(x), cellOfZ(z)));
}
/** Floor height the nav grid uses at (x, z). */
export function navHeight(x, z) { return navH[cellIdx(cellOfX(x), cellOfZ(z))]; }

export function walkableLine(ax, az, bx, bz) {
  const dist = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(dist / 0.35);
  let prev = cellIdx(cellOfX(ax), cellOfZ(az));
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const k = cellIdx(cellOfX(ax + (bx - ax) * t), cellOfZ(az + (bz - az) * t));
    if (k === prev) continue;
    if (blocked(k) || !canStep(prev, k)) return false;
    prev = k;
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

/** Nearest walkable spot to p ({x, z}), as a new {x, z}. */
export function snapWalkable(p) {
  const k0 = cellIdx(cellOfX(p.x), cellOfZ(p.z));
  if (!blocked(k0)) return { x: p.x, z: p.z };
  const k = nearestFree(k0);
  return { x: cx(k % NX), z: cz((k / NX) | 0) };
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
  while (n > 0 && iter++ < 8000) {
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
      if (blocked(nk) || closed[nk] === curStamp || !canStep(k, nk)) continue;
      if (di && dj) {
        const a = cellIdx(i + di, j), b = cellIdx(i, j + dj);
        if (blocked(a) || blocked(b) || !canStep(k, a) || !canStep(k, b)) continue;
      }
      const ng = gScore[k] + (di && dj ? 1.414 : 1) + Math.max(0, navH[nk] - navH[k]) * 0.6;
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
  pts[pts.length - 1] = isWalkable(gx, gz) && cellIdx(cellOfX(gx), cellOfZ(gz)) === g ? { x: gx, z: gz } : pts[pts.length - 1];

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
// Minimap geometry (static layer cached per map)
// ---------------------------------------------------------------------------
let mmCache = null;
export function drawMapBoxes(g, toPx) {
  const W = g.canvas.width, H = g.canvas.height;
  if (!mmCache || mmCache.w !== W || mmCache.h !== H) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const cg = c.getContext('2d');
    // raised areas first (shaded by height), then walls on top
    const sorted = boxes.slice(0, STATIC_COUNT).filter((b) => b.kind !== 'outer' && b.kind !== 'roof').sort((a, b) => (a.walk ? 0 : 1) - (b.walk ? 0 : 1) || a.maxY - b.maxY);
    for (const b of sorted) {
      if (!b.walk && b.minY > 1.2 && !(b.minY > 0.5 && navHeight((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2) > 0.5)) continue;
      const [x0, y0] = toPx(b.minX, b.minZ), [x1, y1] = toPx(b.maxX, b.maxZ);
      if (b.walk) cg.fillStyle = `rgba(150,190,255,${Math.min(0.42, 0.1 + b.maxY * 0.08)})`;
      else cg.fillStyle = b.maxY - b.minY < 1.5 ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.6)';
      cg.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    mmCache = { c, w: W, h: H };
  }
  g.drawImage(mmCache.c, 0, 0);
  for (let i = STATIC_COUNT; i < boxes.length; i++) {
    const b = boxes[i];
    const [x0, y0] = toPx(b.minX, b.minZ), [x1, y1] = toPx(b.maxX, b.maxZ);
    g.fillStyle = b.kind === 'barrier' ? 'rgba(62,230,214,0.8)' : 'rgba(255,255,255,0.6)';
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
}

loadMap(DEFAULT_MAP);
