import * as THREE from 'three';
import { buildMaterials, TILE, softTexture } from './textures.js';

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
let MATS = null;
const FALLBACK = { outer: 0x283044, wall: 0xcdb99a, block: 0x8e8577, crate: 0xa8743d, pillar: 0x697a91, barrier: 0x3ee6d6 };

/** Box geometry whose UVs are in world metres / tile, so textures keep their scale on any box size. */
function worldUVBox(w, h, d, tile) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (!tile) return geo;
  const uv = geo.attributes.uv;
  // face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
    }
  }
  return geo;
}

export function boxMesh(b, color, opts = {}) {
  const w = b.maxX - b.minX, h = b.maxY - b.minY, d = b.maxZ - b.minZ;
  const tex = !opts.transparent && MATS && MATS[b.kind];
  const geo = worldUVBox(w, h, d, tex ? TILE[b.kind] : 0);
  const mat = tex ? MATS[b.kind] : new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...opts });
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

function addTrims(scene, b) {
  const w = b.maxX - b.minX, h = b.maxY - b.minY, d = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const add = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.set(cx, y, cz); m.castShadow = m.receiveShadow = true; scene.add(m); };
  if (b.kind === 'wall' || b.kind === 'block') {
    add(new THREE.BoxGeometry(w + 0.08, 0.1, d + 0.08), MATS.trim, b.maxY + 0.05);
    add(new THREE.BoxGeometry(w + 0.04, 0.22, d + 0.04), MATS.base, 0.11);
  } else if (b.kind === 'pillar') {
    add(new THREE.BoxGeometry(w + 0.12, 0.25, d + 0.12), MATS.trim, 0.125);
    add(new THREE.BoxGeometry(w + 0.12, 0.2, d + 0.12), MATS.trim, b.maxY - 0.1);
  } else if (b.kind === 'outer') {
    add(new THREE.BoxGeometry(w, 0.3, d + 0.1), MATS.trim, 0.15);
  }
}

let dust = null, skyMat = null;
const spawnMats = [];
// plant site rectangles [minX, minZ, maxX, maxZ] (kept in sync with objective.js SITES)
export const SITE_RECTS = [[12, -29, 28, -11], [12, 11, 28, 29]];
export function setSpawnColors(west, east) {
  for (const s of spawnMats) { const c = s.side < 0 ? west : east; s.zoneMat.color.setHex(c); s.lineMat.color.setHex(c); }
}
export function updateWorldFx(t) {
  if (skyMat) skyMat.uniforms.time.value = t;
  if (!dust) return;
  dust.rotation.y = t * 0.004;
  dust.position.y = Math.sin(t * 0.2) * 0.3;
}

export function buildWorld(scene, renderer, quality = 'medium') {
  MATS = buildMaterials(quality);

  // custom sky dome: deep-blue gradient, small soft sun (no glare halo) and drifting clouds.
  // Values stay below the bloom threshold so the sky never blooms or washes out the view.
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(55), THREE.MathUtils.degToRad(-130));
  skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sun: { value: sunDir }, time: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = vec4(p.xy, p.w * 0.99999, p.w); }',
    fragmentShader: `uniform vec3 sun; uniform float time; varying vec3 vDir;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a*n(p); p *= 2.03; a *= 0.5; } return v; }
      void main(){
        vec3 d = normalize(vDir);
        float y = max(d.y, 0.0);
        vec3 zenith = vec3(0.10, 0.25, 0.55), mid = vec3(0.26, 0.45, 0.72), horizon = vec3(0.56, 0.66, 0.78);
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.25, y));
        c = mix(c, zenith, smoothstep(0.25, 0.9, y));
        float s = max(dot(d, sun), 0.0);
        c += vec3(1.0, 0.85, 0.6) * pow(s, 24.0) * 0.12;           // faint warm sky near the sun
        // clouds projected onto a flat layer, fading toward the horizon
        vec2 uv = d.xz / (d.y + 0.12) * 1.4 + vec2(time * 0.004, time * 0.0015);
        float cl = smoothstep(0.52, 0.78, fbm(uv));
        float edge = smoothstep(0.02, 0.22, d.y);
        vec3 cloudCol = mix(vec3(0.62, 0.66, 0.72), vec3(0.92, 0.92, 0.9), fbm(uv * 2.0 + 3.0));
        cloudCol += vec3(0.12, 0.09, 0.05) * pow(s, 6.0);
        c = mix(c, cloudCol, cl * edge * 0.85);
        float disc = smoothstep(0.9993, 0.9997, s);                    // small sun disc, no bloom halo
        c = mix(c, vec3(0.98, 0.95, 0.86), disc * (1.0 - cl * 0.8));
        if (d.y < 0.0) c = mix(horizon, vec3(0.32, 0.34, 0.36), smoothstep(0.0, 0.3, -d.y));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);
  // image-based lighting from a controlled gradient sky (the Sky shader's HDR values are far too hot)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { sun: { value: sunDir } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform vec3 sun; varying vec3 vDir;
      void main(){
        float y = vDir.y;
        vec3 top = vec3(0.26, 0.42, 0.68), hor = vec3(0.6, 0.68, 0.76), gnd = vec3(0.22, 0.2, 0.18);
        vec3 c = y > 0.0 ? mix(hor, top, pow(y, 0.6)) : mix(hor, gnd, pow(-y, 0.4));
        c += vec3(1.0, 0.9, 0.75) * pow(max(dot(vDir, sun), 0.0), 64.0) * 4.0;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envMat));
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.6;
  // light haze only, tinted to the horizon colour so distant walls aren't bleached
  scene.fog = new THREE.Fog(0x9fb0c2, 95, 260);

  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x5a4e40, 0.15));
  const sun = new THREE.DirectionalLight(0xffe9cf, 2.0);
  sun.position.copy(sunDir).multiplyScalar(70);
  sun.castShadow = quality !== 'low';
  sun.shadow.mapSize.set(quality === 'high' ? 4096 : 2048, quality === 'high' ? 4096 : 2048);
  Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 44, bottom: -44, near: 1, far: 160 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun);

  const floorTex = MATS.floor;
  for (const t of Object.values(floorTex)) t.repeat.set(21, 16);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(84, 64),
    new THREE.MeshStandardMaterial({ ...floorTex, roughness: 1, normalScale: new THREE.Vector2(0.8, 0.8) }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // painted spawn zones (recoloured when teams swap sides)
  for (const side of [-1, 1]) {
    const zoneMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.045, depthWrite: false });
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
    const z = new THREE.Mesh(new THREE.PlaneGeometry(10, 60), zoneMat);
    z.rotation.x = -Math.PI / 2; z.position.set(side * 35, 0.02, 0);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 60), lineMat);
    line.rotation.x = -Math.PI / 2; line.position.set(side * 31, 0.025, 0);
    scene.add(z, line);
    spawnMats.push({ side, zoneMat, lineMat });
  }
  setSpawnColors(0x3d8bff, 0xff4655);

  // plant sites: yellow boundary + big letter
  const siteMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.55, depthWrite: false });
  for (const [x0, z0, x1, z1] of SITE_RECTS) {
    for (const [cx, cz, w, d] of [[(x0 + x1) / 2, z0, x1 - x0, 0.2], [(x0 + x1) / 2, z1, x1 - x0, 0.2], [x0, (z0 + z1) / 2, 0.2, z1 - z0], [x1, (z0 + z1) / 2, 0.2, z1 - z0]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), siteMat);
      m.rotation.x = -Math.PI / 2; m.position.set(cx, 0.026, cz);
      scene.add(m);
    }
  }
  for (const [x, z, text, size] of [[21, -27, 'A', 5], [21, 27, 'B', 5], [0, -6, 'MID', 4]]) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = text === 'MID' ? 'rgba(255,255,255,0.6)' : 'rgba(255,214,63,0.75)'; g.font = 'bold 110px sans-serif'; g.textAlign = 'center';
    g.fillText(text, 128, 108);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(size, size / 2), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.9 }));
    p.rotation.x = -Math.PI / 2; p.position.set(x, 0.03, z);
    if (z > 0) p.rotation.z = Math.PI;
    p.receiveShadow = true;
    scene.add(p);
  }

  for (let i = 0; i < STATIC_COUNT; i++) {
    const b = boxes[i];
    scene.add(boxMesh(b, FALLBACK[b.kind]));
    addTrims(scene, b);
  }

  // floating dust motes catch the light
  if (quality !== 'low') {
    const n = 700, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 80; pos[i * 3 + 1] = Math.random() * 6; pos[i * 3 + 2] = (Math.random() - 0.5) * 60; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dust = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.035, color: 0xfff4e0, transparent: true, opacity: 0.45, map: softTexture(), depthWrite: false }));
    scene.add(dust);
  }
}

export function surfaceOf(kind) {
  if (kind === 'crate') return 'wood';
  if (kind === 'pillar' || kind === 'outer') return 'metal';
  if (kind === 'barrier') return 'energy';
  return 'concrete';
}

/** Surface under a fighter's feet (for footsteps). */
export function surfaceUnder(p) {
  if (p.y < 0.05) return 'concrete';
  for (const b of boxes) {
    if (p.x > b.minX - 0.4 && p.x < b.maxX + 0.4 && p.z > b.minZ - 0.4 && p.z < b.maxZ + 0.4 && Math.abs(p.y - b.maxY) < 0.1) return surfaceOf(b.kind);
  }
  return 'concrete';
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

/** [entry, exit] distances of a ray through a box, or null. Entry is clamped to 0. */
export function rayBoxRange(o, d, b) {
  let tmin = -Infinity, tmax = Infinity;
  for (const [oa, da, mn, mx] of [[o.x, d.x, b.minX, b.maxX], [o.y, d.y, b.minY, b.maxY], [o.z, d.z, b.minZ, b.maxZ]]) {
    if (Math.abs(da) < 1e-9) {
      if (oa < mn || oa > mx) return null;
    } else {
      let t1 = (mn - oa) / da, t2 = (mx - oa) / da;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  return [Math.max(0, tmin), tmax];
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

/** Like raycastWorld but also returns the hit normal and surface kind. */
export function raycastWorldHit(o, d, maxT = 200) {
  let best = maxT, box = null;
  for (const b of boxes) {
    const t = rayBox(o, d, b);
    if (t < best) { best = t; box = b; }
  }
  const hit = { t: best, n: new THREE.Vector3(), kind: box ? box.kind : null };
  if (d.y < 0) {
    const t = -o.y / d.y;
    if (t >= 0 && t < best) { hit.t = t; hit.kind = 'floor'; hit.n.set(0, 1, 0); return hit; }
  }
  if (box) {
    const px = o.x + d.x * best, py = o.y + d.y * best, pz = o.z + d.z * best;
    const e = [[Math.abs(px - box.minX), -1, 0, 0], [Math.abs(px - box.maxX), 1, 0, 0], [Math.abs(py - box.minY), 0, -1, 0],
      [Math.abs(py - box.maxY), 0, 1, 0], [Math.abs(pz - box.minZ), 0, 0, -1], [Math.abs(pz - box.maxZ), 0, 0, 1]];
    e.sort((a, b) => a[0] - b[0]);
    hit.n.set(e[0][1], e[0][2], e[0][3]);
  }
  return hit;
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
