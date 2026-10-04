import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Visual detail for the map. Collision lives in world.js as plain boxes; this module draws what
// those boxes represent (roof gables, frames, vehicle bodies, trees, ...). Nothing here collides.

const std = (color, rough = 0.8, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
const P = {
  frame: std(0x5a3d26, 0.7),
  sill: std(0xcfc7b8, 0.8),
  glass: std(0x23303c, 0.08, 0.6, { transparent: true, opacity: 0.55 }),
  darkGlass: std(0x1a2129, 0.1, 0.7),
  tyre: std(0x16171a, 0.9),
  rim: std(0x8a8f96, 0.35, 0.9),
  chrome: std(0xb7bcc3, 0.25, 1),
  bark: std(0x5b4331, 0.95),
  leaf: [std(0x3f6b34, 0.9), std(0x4f7d3b, 0.9), std(0x36592f, 0.9)],
  pole: std(0x5c6168, 0.5, 0.7),
  bulb: std(0xfff1c8, 0.4, 0, { emissive: 0xffd58a, emissiveIntensity: 1.4 }),
  cloth: [std(0xb5413a, 0.9, 0, { side: THREE.DoubleSide }), std(0xe8dcc0, 0.9, 0, { side: THREE.DoubleSide })],
  barrel: [std(0x2f5d8a, 0.55, 0.5), std(0xa33a2a, 0.55, 0.5), std(0x6b5a3a, 0.7, 0.6)],
  wire: new THREE.LineBasicMaterial({ color: 0x1a1a1a }),
  chimney: std(0x8a5a45, 0.9),
  fenceWood: std(0x8b6a47, 0.85),
  light: std(0xfff5d0, 0.3, 0, { emissive: 0xffe2a0, emissiveIntensity: 0.6 }),
  redLight: std(0x8a1010, 0.4, 0, { emissive: 0x6a0000, emissiveIntensity: 0.6 }),
  palmLeaf: std(0x5f8a3a, 0.85, 0, { side: THREE.DoubleSide }),
  palmBark: std(0x8a6a48, 0.95),
  pine: [std(0x2f4f3a, 0.9), std(0x3a5d43, 0.9)],
  jungle: [std(0x2d5a2a, 0.9), std(0x3d6e2e, 0.9), std(0x244a26, 0.9)],
  cactus: std(0x4f7a45, 0.8),
  rail: std(0x30343a, 0.45, 0.8),
  steel: std(0x6c737c, 0.5, 0.7),
  yellow: std(0xd9a21b, 0.55, 0.4),
  white: std(0xe7e9ec, 0.6, 0.2),
  dish: std(0xe7e9ec, 0.5, 0.3, { side: THREE.DoubleSide }),
  flame: std(0xffb347, 0.4, 0, { emissive: 0xff8a20, emissiveIntensity: 2.2 }),
  gold: std(0xc9a24a, 0.35, 0.8),
  snow: std(0xf2f6fb, 0.7),
};
for (const m of Object.values(P)) (Array.isArray(m) ? m : [m]).forEach((x) => { x.userData.shared = true; });

function mesh(parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const RB = (w, h, d, r = 0.06) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, Math.min(w, h, d) / 2.01));

// ---------------------------------------------------------------------------
// Houses
// ---------------------------------------------------------------------------
function gable(g, x0, z0, x1, z1, y, mat) {
  // triangular prism along the long axis, with a little overhang
  const alongX = x1 - x0 >= z1 - z0;
  const span = (alongX ? z1 - z0 : x1 - x0) + 0.8, len = (alongX ? x1 - x0 : z1 - z0) + 0.8;
  const rise = Math.min(1.6, span * 0.28);
  const shape = new THREE.Shape();
  shape.moveTo(-span / 2, 0); shape.lineTo(span / 2, 0); shape.lineTo(0, rise); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
  geo.translate(0, 0, -len / 2);
  // world-scale UVs for the tile texture on the slopes
  const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2);
  const m = mesh(g, geo, mat, (x0 + x1) / 2, y, (z0 + z1) / 2);
  if (alongX) m.rotation.y = Math.PI / 2;
  // ridge cap
  mesh(g, B(alongX ? len : 0.18, 0.12, alongX ? 0.18 : len), P.chimney, (x0 + x1) / 2, y + rise, (z0 + z1) / 2);
  return { rise, alongX };
}

function openingFrame(g, h, o) {
  const [x0, z0, x1, z1] = h.rect;
  const T = 0.42, t = 0.08;
  const onX = o.side === 'n' || o.side === 's';
  const fixed = { n: z0, s: z1, w: x0, e: x1 }[o.side];
  const mid = (o.a + o.b) / 2, w = o.b - o.a;
  const put = (along, y, sw, sh, mat) => {
    if (onX) mesh(g, B(sw, sh, T), mat, along, y, fixed);
    else mesh(g, B(T, sh, sw), mat, fixed, y, along);
  };
  if (o.type === 'door') {
    put(o.a + t / 2, 1.15, t, 2.3, P.frame); put(o.b - t / 2, 1.15, t, 2.3, P.frame);
    put(mid, 2.3 - t / 2, w, t, P.frame);
    put(mid, 0.03, w, 0.06, P.sill);
  } else {
    put(o.a + t / 2, 1.55, t, 1.1, P.frame); put(o.b - t / 2, 1.55, t, 1.1, P.frame);
    put(mid, 2.1 - t / 2, w, t, P.frame);
    put(mid, 1.0, w + 0.12, 0.07, P.sill);
    // cross muntins (thin, decorative; you can still see and shoot through the window)
    put(mid, 1.55, 0.035, 1.1, P.frame);
    put(mid, 1.55, w, 0.035, P.frame);
  }
}

function buildHouse(scene, h, mats, quality) {
  const g = new THREE.Group(); scene.add(g);
  const [x0, z0, x1, z1] = h.rect;
  const roofY = h.height;
  // wooden floor inside
  const rep = (t) => { const c = t.clone(); c.repeat.set((x1 - x0) / 2, (z1 - z0) / 2); c.needsUpdate = true; return c; };
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 0.3, z1 - z0 - 0.3), new THREE.MeshStandardMaterial({
    map: rep(mats.planks.map), normalMap: rep(mats.planks.normalMap), roughnessMap: rep(mats.planks.roughnessMap), roughness: 1 }));
  fl.rotation.x = -Math.PI / 2; fl.position.set((x0 + x1) / 2, 0.012, (z0 + z1) / 2); fl.receiveShadow = true;
  g.add(fl);
  // plaster ceiling under the (tiled) roof slab
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 0.3, z1 - z0 - 0.3), mats.iwall);
  ceil.rotation.x = Math.PI / 2; ceil.position.set((x0 + x1) / 2, roofY - 0.005, (z0 + z1) / 2); ceil.receiveShadow = true;
  g.add(ceil);
  // corner posts
  for (const [cx, cz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) mesh(g, B(0.42, roofY, 0.42), P.frame, cx, roofY / 2, cz);
  for (const o of h.openings) openingFrame(g, h, o);
  if (!h.flat) {
    // gable roof on top of the flat (collision) roof slab, plus a chimney
    const { rise, alongX } = gable(g, x0, z0, x1, z1, roofY + 0.22, mats.roof);
    const cx = alongX ? x0 + (x1 - x0) * 0.25 : (x0 + x1) / 2 + (x1 - x0) * 0.2, cz = alongX ? (z0 + z1) / 2 + (z1 - z0) * 0.2 : z0 + (z1 - z0) * 0.25;
    mesh(g, B(0.6, rise + 0.9, 0.6), P.chimney, cx, roofY + 0.22 + (rise + 0.9) / 2, cz);
  } else {
    // flat roof: a low lip and a couple of rooftop units
    for (const [cx, cz, w, d] of [[(x0 + x1) / 2, z0 - 0.27, x1 - x0 + 0.6, 0.06], [(x0 + x1) / 2, z1 + 0.27, x1 - x0 + 0.6, 0.06], [x0 - 0.27, (z0 + z1) / 2, 0.06, z1 - z0 + 0.6], [x1 + 0.27, (z0 + z1) / 2, 0.06, z1 - z0 + 0.6]]) mesh(g, B(w, 0.18, d), P.sill, cx, roofY + 0.31, cz);
    if (h.roofUnit !== false) mesh(g, RB(1.2, 0.7, 0.9, 0.05), P.steel, x0 + (x1 - x0) * 0.7, roofY + 0.57, z0 + (z1 - z0) * 0.3);
  }
  // ceiling lamp (real light on Medium/High)
  if (h.lamp) {
    const [lx, lz] = h.lamp;
    mesh(g, new THREE.CylinderGeometry(0.01, 0.01, 0.5), P.pole, lx, roofY - 0.25, lz);
    mesh(g, new THREE.SphereGeometry(0.12, 12, 8), P.bulb, lx, roofY - 0.55, lz).castShadow = false;
    if (quality === 'high') {
      const L = new THREE.PointLight(0xffd59a, 4, 9, 2);
      L.position.set(lx, roofY - 0.65, lz);
      g.add(L);
    }
  }
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------
function wheels(g, positions, r, w) {
  const tyre = new THREE.CylinderGeometry(r, r, w, 18), rim = new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 12);
  for (const [x, z, alongX] of positions) {
    const rot = alongX ? [Math.PI / 2, 0, 0] : [0, 0, Math.PI / 2];
    mesh(g, tyre, P.tyre, x, r, z, ...rot);
    mesh(g, rim, P.rim, x, r, z, ...rot);
  }
}

function buildVehicle(scene, v) {
  const g = new THREE.Group(); scene.add(g);
  const [x0, z0, x1, z1] = v.rect;
  const alongX = x1 - x0 > z1 - z0;
  const L = alongX ? x1 - x0 : z1 - z0, W = alongX ? z1 - z0 : x1 - x0;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // local frame: build along +X then rotate
  const body = new THREE.Group(); body.position.set(cx, 0, cz); g.add(body);
  // the body is modelled with its front at local +X; turn it so the front faces the `dir` end
  const dir = v.dir || 1;
  body.rotation.y = alongX ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? -Math.PI / 2 : Math.PI / 2);
  const paint = std(v.color, 0.35, 0.6);
  if (v.type === 'car') {
    mesh(body, RB(L, 0.7, W, 0.15), paint, 0, 0.6, 0);                          // lower body
    mesh(body, RB(L * 0.52, 0.52, W * 0.88, 0.12), P.darkGlass, -L * 0.05, 1.18, 0); // cabin glass
    mesh(body, RB(L * 0.5, 0.06, W * 0.86, 0.03), paint, -L * 0.05, 1.45, 0);    // roof
    for (const s of [-1, 1]) {
      mesh(body, B(0.06, 0.5, 0.06), paint, -L * 0.05 + s * L * 0.24, 1.18, W * 0.42);
      mesh(body, B(0.06, 0.5, 0.06), paint, -L * 0.05 + s * L * 0.24, 1.18, -W * 0.42);
    }
    mesh(body, B(0.05, 0.12, W * 0.7), P.chrome, L / 2, 0.45, 0);              // bumpers
    mesh(body, B(0.05, 0.12, W * 0.7), P.chrome, -L / 2, 0.45, 0);
    for (const s of [-1, 1]) { mesh(body, B(0.04, 0.1, 0.3), P.light, L / 2 + 0.01, 0.72, s * W * 0.33); mesh(body, B(0.04, 0.1, 0.3), P.redLight, -L / 2 - 0.01, 0.72, s * W * 0.33); }
    wheels(body, [[L * 0.32, W / 2 - 0.12, true], [-L * 0.32, W / 2 - 0.12, true], [L * 0.32, -W / 2 + 0.12, true], [-L * 0.32, -W / 2 + 0.12, true]], 0.33, 0.24);
  } else {
    const cab = 2.0, cargo = L - cab;
    // container with ribs
    const box = std(0x9aa3ab, 0.6, 0.4);
    mesh(body, B(cargo, 2.4, W), box, -L / 2 + cargo / 2, 1.85, 0);
    for (let i = 0; i <= 8; i++) mesh(body, B(0.06, 2.3, W + 0.04), box, -L / 2 + 0.1 + i * (cargo - 0.2) / 8, 1.85, 0);
    mesh(body, B(cargo, 0.25, W - 0.2), P.tyre, -L / 2 + cargo / 2, 0.55, 0);   // chassis
    // cab
    mesh(body, RB(cab, 1.5, W - 0.1, 0.12), paint, L / 2 - cab / 2, 1.35, 0);
    mesh(body, RB(cab * 0.7, 0.6, W - 0.12, 0.06), P.darkGlass, L / 2 - cab * 0.45, 1.85, 0);
    mesh(body, B(0.08, 0.25, W * 0.8), P.chrome, L / 2 + 0.02, 0.6, 0);
    for (const s of [-1, 1]) mesh(body, B(0.04, 0.14, 0.32), P.light, L / 2 + 0.03, 0.95, s * W * 0.32);
    const wz = W / 2 - 0.15;
    wheels(body, [[L / 2 - 0.7, wz, true], [L / 2 - 0.7, -wz, true], [-L / 2 + 0.9, wz, true], [-L / 2 + 0.9, -wz, true], [-L / 2 + 2, wz, true], [-L / 2 + 2, -wz, true]], 0.45, 0.32);
  }
}

// ---------------------------------------------------------------------------
// Small props
// ---------------------------------------------------------------------------
function buildTree(scene, [x, z, type = 'oak']) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  const s = 0.85 + ((Math.abs(x * 7 + z * 3) % 10) / 10) * 0.4;
  if (type === 'pine') {
    mesh(g, new THREE.CylinderGeometry(0.12, 0.2, 2.2, 7), P.bark, 0, 1.1, 0);
    for (let i = 0; i < 4; i++) {
      const r = (1.5 - i * 0.3) * s, h = 1.5 * s;
      mesh(g, new THREE.ConeGeometry(r, h, 9), P.pine[i % 2], 0, (1.4 + i * 0.85) * s, 0, 0, i, 0);
      if (MAPTHEME?.snowCaps) mesh(g, new THREE.ConeGeometry(r * 0.55, h * 0.4, 9), P.snow, 0, (1.4 + i * 0.85) * s + h * 0.3, 0, 0, i, 0);
    }
    return;
  }
  if (type === 'palm') {
    // curved trunk from stacked segments, then a crown of drooping fronds
    let px = 0, py = 0;
    const lean = ((x * 13 + z * 7) % 6) / 6 - 0.5;
    for (let i = 0; i < 7; i++) {
      const r = 0.17 - i * 0.012;
      mesh(g, new THREE.CylinderGeometry(r * 0.9, r, 0.75, 7), P.palmBark, px, py + 0.37, 0, 0, 0, -lean * 0.12 * i);
      px += Math.sin(lean * 0.12 * i) * 0.75; py += 0.72;
    }
    const frond = new THREE.PlaneGeometry(0.7, 2.6, 1, 4);
    const fp = frond.attributes.position;
    for (let i = 0; i < fp.count; i++) { const y = fp.getY(i) + 1.3; fp.setZ(i, -(y * y) * 0.18); fp.setX(i, fp.getX(i) * (1 - y / 3)); fp.setY(i, y); }
    frond.computeVertexNormals();
    for (let i = 0; i < 8; i++) {
      const f = mesh(g, frond, P.palmLeaf, px, py, 0, 0, (i / 8) * Math.PI * 2, 0);
      f.rotation.order = 'YXZ'; f.rotation.x = -1.0;
    }
    mesh(g, new THREE.SphereGeometry(0.22, 8, 6), P.palmBark, px, py, 0);
    return;
  }
  if (type === 'jungle') {
    mesh(g, new THREE.CylinderGeometry(0.22, 0.38, 4.6, 8), P.bark, 0, 2.3, 0);
    for (const [rx, rz] of [[0.35, 0], [-0.3, 0.2], [0, -0.35]]) mesh(g, new THREE.CylinderGeometry(0.05, 0.16, 1.2, 5), P.bark, rx, 0.45, rz, rz * 1.4, 0, -rx * 1.4);
    const blobs = [[0, 5.2, 0, 2.1], [1.3, 4.6, 0.5, 1.4], [-1.2, 4.8, -0.6, 1.5], [0.4, 6.1, -0.4, 1.3], [-0.5, 4.3, 1.2, 1.2]];
    blobs.forEach(([bx, by, bz, r], i) => mesh(g, new THREE.IcosahedronGeometry(r * s, 1), P.jungle[i % 3], bx * s, by * s, bz * s, i, i * 2, 0));
    return;
  }
  mesh(g, new THREE.CylinderGeometry(0.16, 0.24, 3.2, 8), P.bark, 0, 1.6, 0);
  const blobs = [[0, 3.6, 0, 1.5], [0.7, 3.2, 0.3, 1.0], [-0.6, 3.3, -0.4, 1.05], [0.1, 4.4, -0.2, 1.0], [-0.3, 3.0, 0.7, 0.85]];
  blobs.forEach(([bx, by, bz, r], i) => mesh(g, new THREE.IcosahedronGeometry(r * s, 1), P.leaf[i % 3], bx * s, by * s, bz * s, i, i * 2, 0));
}

function buildLamp(scene, [x, z]) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  mesh(g, new THREE.CylinderGeometry(0.07, 0.11, 4.4, 10), P.pole, 0, 2.2, 0);
  const toward = Math.sign(-z || 1);   // arm leans toward the lane centre
  mesh(g, B(0.08, 0.08, 0.9), P.pole, 0, 4.3, toward * 0.42);
  mesh(g, RB(0.32, 0.12, 0.5, 0.04), P.pole, 0, 4.24, toward * 0.85);
  mesh(g, B(0.24, 0.03, 0.4), P.bulb, 0, 4.17, toward * 0.85).castShadow = false;
}

function buildBarrel(scene, [x, z, y0 = 0], i) {
  const g = new THREE.Group(); g.position.set(x, y0, z); scene.add(g);
  const mat = P.barrel[Math.abs(Math.round(x * 3 + z)) % 3];
  mesh(g, new THREE.CylinderGeometry(0.33, 0.33, 0.98, 16), mat, 0, 0.49, 0);
  for (const y of [0.12, 0.49, 0.86]) mesh(g, new THREE.TorusGeometry(0.335, 0.02, 6, 20), mat, 0, y, 0, Math.PI / 2);
  mesh(g, new THREE.CylinderGeometry(0.3, 0.3, 0.02, 16), P.tyre, 0, 0.985, 0);
}

function buildSandbags(scene, [x, z, w, d, y0 = 0], mats) {
  const g = new THREE.Group(); g.position.set(x, y0, z); scene.add(g);
  const alongX = w >= d, len = alongX ? w : d, depth = alongX ? d : w;
  const bag = RB(0.58, 0.3, Math.min(0.4, depth / 2.1), 0.12);
  for (let row = 0; row < 3; row++) {
    const n = Math.floor(len / 0.56) - (row % 2);
    for (let i = 0; i < n; i++) {
      const a = -len / 2 + 0.3 + (row % 2) * 0.28 + i * 0.56;
      for (const side of [-1, 1]) {
        if (row === 2 && side > 0) continue;
        const off = side * depth * 0.24;
        const m = alongX ? mesh(g, bag, mats.burlap, a, 0.16 + row * 0.33, off) : mesh(g, bag, mats.burlap, off, 0.16 + row * 0.33, a, 0, Math.PI / 2, 0);
        m.rotation.z += (Math.random() - 0.5) * 0.08;
      }
    }
  }
}

function buildFence(scene, [x, z, w, d]) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  const alongX = w >= d, len = alongX ? w : d;
  const n = Math.floor(len / 0.16);
  for (let i = 0; i < n; i++) {
    const a = -len / 2 + 0.08 + i * (len - 0.16) / (n - 1);
    const h = 1.15 + (i % 2) * 0.05;
    if (alongX) mesh(g, B(0.12, h, 0.03), P.fenceWood, a, h / 2, 0); else mesh(g, B(0.03, h, 0.12), P.fenceWood, 0, h / 2, a);
  }
  for (const y of [0.3, 0.9]) alongX ? mesh(g, B(len, 0.08, 0.05), P.fenceWood, 0, y, -0.04) : mesh(g, B(0.05, 0.08, len), P.fenceWood, -0.04, y, 0);
}

function buildStall(scene, [x, z, w, d], mats) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  // table top (the collision box) with a cloth, four posts and a striped canopy
  mesh(g, B(w, 0.06, d), mats.furniture, 0, 0.97, 0);
  mesh(g, B(w + 0.05, 0.6, d + 0.05), P.cloth[1], 0, 0.62, 0);
  const cw = w + 0.8, cd = d + 1.4;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mesh(g, new THREE.CylinderGeometry(0.035, 0.035, 2.4, 6), P.pole, sx * cw / 2, 1.2, sz * cd / 2);
  for (let i = 0; i < 6; i++) {
    const m = mesh(g, B(cw / 6, 0.03, cd + 0.2), P.cloth[i % 2], -cw / 2 + cw / 12 + i * cw / 6, 2.45, 0, 0.12, 0, 0);
    m.castShadow = true;
  }
  // a few goods on the table
  for (let i = 0; i < 4; i++) mesh(g, RB(0.3, 0.22, 0.3, 0.05), mats.crate, -w / 2 + 0.35 + i * (w - 0.7) / 3, 1.11, (i % 2 - 0.5) * 0.3);
}

function powerLines(scene) {
  const poles = [-34, -12, 12, 34];
  for (const zLine of [-29.2, 29.2]) {
    const tops = [];
    for (const x of poles) {
      const g = new THREE.Group(); g.position.set(x, 0, zLine); scene.add(g);
      mesh(g, new THREE.CylinderGeometry(0.12, 0.16, 9, 8), P.bark, 0, 4.5, 0);
      mesh(g, B(1.6, 0.1, 0.1), P.bark, 0, 8.6, 0);
      for (const s of [-0.7, 0, 0.7]) { mesh(g, new THREE.CylinderGeometry(0.04, 0.05, 0.14, 6), P.sill, s, 8.72, 0); tops.push([x + s, s]); }
    }
    for (const s of [-0.7, 0, 0.7]) {
      for (let i = 0; i < poles.length - 1; i++) {
        const a = new THREE.Vector3(poles[i] + s, 8.78, zLine), b = new THREE.Vector3(poles[i + 1] + s, 8.78, zLine);
        const pts = [];
        for (let k = 0; k <= 16; k++) { const t = k / 16; pts.push(new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -Math.sin(t * Math.PI) * 0.9, 0))); }
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), P.wire));
      }
    }
  }
}

function plaza(scene, mats) {
  const t = mats.pavers.map.clone(); t.repeat.set(9, 9); t.needsUpdate = true;
  const n = mats.pavers.normalMap.clone(); n.repeat.set(9, 9); n.needsUpdate = true;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), new THREE.MeshStandardMaterial({ map: t, normalMap: n, roughness: 0.9 }));
  m.rotation.x = -Math.PI / 2; m.position.set(0, 0.008, 0); m.receiveShadow = true;
  scene.add(m);
  // curb
  for (const [cx, cz, w, d] of [[0, -9, 18, 0.25], [0, 9, 18, 0.25], [-9, 0, 0.25, 18], [9, 0, 0.25, 18]]) mesh(scene, B(w, 0.08, d), P.sill, cx, 0.04, cz);
}

// ---------------------------------------------------------------------------
// Raised-area details: stair rails, containers, decoration
// ---------------------------------------------------------------------------
function buildStairRails(scene, st) {
  if (!st.rail) return;
  const [x0, z0, x1, z1] = st.rect;
  const alongX = st.dir[0] === 'x', up = st.dir[1] === '+';
  const len = alongX ? x1 - x0 : z1 - z0;
  const n = Math.max(2, Math.ceil(len / 1.4));
  for (const side of [0, 1]) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = (alongX ? x0 : z0) + t * len;
      const k = up ? t : 1 - t, y = st.h0 + (st.h1 - st.h0) * k;
      const sx = alongX ? a : side ? x1 - 0.05 : x0 + 0.05, sz = alongX ? (side ? z1 - 0.05 : z0 + 0.05) : a;
      mesh(scene, new THREE.CylinderGeometry(0.025, 0.025, 0.95, 6), P.rail, sx, y + 0.47, sz);
      pts.push(new THREE.Vector3(sx, y + 0.95, sz));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    mesh(scene, new THREE.TubeGeometry(curve, n * 2, 0.03, 5), P.rail, 0, 0, 0);
  }
}

const frameMats = new Map();
function buildContainer(scene, c) {
  const [x0, z0, x1, z1] = c.rect, y0 = c.y0, h = c.h;
  const alongX = x1 - x0 >= z1 - z0;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // corner posts + top/bottom rails (dark steel frame)
  const fk = new THREE.Color(c.color).multiplyScalar(0.55).getHex();
  if (!frameMats.has(fk)) frameMats.set(fk, std(fk, 0.6, 0.5));
  const frame = frameMats.get(fk);
  for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) mesh(scene, B(0.14, h, 0.14), frame, px + (px < cx ? 0.06 : -0.06), y0 + h / 2, pz + (pz < cz ? 0.06 : -0.06));
  // door end: two lock bars per door
  const endA = alongX ? [x1 + 0.02, cz] : [cx, z1 + 0.02];
  for (const o of [-0.55, -0.25, 0.25, 0.55]) {
    const w = alongX ? z1 - z0 : x1 - x0;
    if (alongX) mesh(scene, B(0.04, h * 0.85, 0.035), P.steel, endA[0], y0 + h / 2, cz + o * w * 0.8);
    else mesh(scene, B(0.035, h * 0.85, 0.04), P.steel, cx + o * w * 0.8, y0 + h / 2, endA[1]);
  }
}

let MAPTHEME = null;
function buildDecor(scene, o) {
  const g = new THREE.Group(); g.position.set(o.x, o.y || 0, o.z); g.rotation.y = o.rot || 0; scene.add(g);
  switch (o.type) {
    case 'crane': { // dockside gantry crane (outside the walls, purely scenery)
      const H = o.h || 26;
      for (const sx of [-4, 4]) for (const sz of [-3, 3]) mesh(g, B(0.6, H, 0.6), P.yellow, sx, H / 2, sz);
      for (const sz of [-3, 3]) mesh(g, B(9, 0.8, 0.8), P.yellow, 0, H, sz);
      mesh(g, B(1.2, 1.2, 30), P.yellow, 0, H + 1, 6);
      mesh(g, B(3, 2.4, 3), P.white, 0, H + 2.6, -2);
      mesh(g, B(0.08, 10, 0.08), P.rail, 0, H - 4, 14);
      break;
    }
    case 'radar': {
      mesh(g, new THREE.CylinderGeometry(0.25, 0.35, 5, 8), P.steel, 0, 2.5, 0);
      mesh(g, new THREE.SphereGeometry(2.2, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.32), P.dish, 0, 6.2, 0, -1.0, 0, 0);
      mesh(g, new THREE.CylinderGeometry(0.05, 0.05, 2, 5), P.rail, 0, 6.4, -0.8, -1.0);
      break;
    }
    case 'tank': { // fuel tank on legs
      const r = o.r || 2;
      mesh(g, new THREE.CylinderGeometry(r, r, o.len || 6, 16), P.white, 0, r + 1, 0, 0, 0, Math.PI / 2);
      for (const sx of [-1.8, 1.8]) mesh(g, B(0.3, r + 1, r * 1.4), P.steel, sx, (r + 1) / 2, 0);
      break;
    }
    case 'mast': { // antenna mast with red lights
      const H = o.h || 18;
      mesh(g, new THREE.CylinderGeometry(0.12, 0.3, H, 6), P.steel, 0, H / 2, 0);
      for (let i = 1; i < 4; i++) mesh(g, B(1.6 - i * 0.3, 0.06, 0.06), P.steel, 0, H * i / 4, 0);
      mesh(g, new THREE.SphereGeometry(0.2, 8, 6), P.redLight, 0, H, 0).castShadow = false;
      break;
    }
    case 'cactus': {
      const s = o.s || 1;
      mesh(g, new THREE.CapsuleGeometry(0.22 * s, 1.6 * s, 4, 8), P.cactus, 0, 1.0 * s, 0);
      mesh(g, new THREE.CapsuleGeometry(0.14 * s, 0.6 * s, 4, 8), P.cactus, 0.38 * s, 1.2 * s, 0);
      mesh(g, B(0.3 * s, 0.12 * s, 0.12 * s), P.cactus, 0.2 * s, 0.85 * s, 0);
      mesh(g, new THREE.CapsuleGeometry(0.12 * s, 0.5 * s, 4, 8), P.cactus, -0.34 * s, 1.5 * s, 0);
      mesh(g, B(0.26 * s, 0.1 * s, 0.1 * s), P.cactus, -0.2 * s, 1.25 * s, 0);
      break;
    }
    case 'bush': {
      const s = o.s || 1, mat = MAPTHEME?.snowCaps ? P.pine[1] : P.jungle[(Math.abs(Math.round(o.x + o.z))) % 3];
      for (const [bx, by, bz, r] of [[0, 0.35, 0, 0.6], [0.5, 0.3, 0.2, 0.45], [-0.45, 0.28, -0.15, 0.42]]) mesh(g, new THREE.IcosahedronGeometry(r * s, 1), mat, bx * s, by * s, bz * s);
      break;
    }
    case 'torch': { // stone brazier with a glowing flame (no real light: cheap)
      mesh(g, new THREE.CylinderGeometry(0.22, 0.3, 1.0, 8), o.mat || P.chimney, 0, 0.5, 0);
      mesh(g, new THREE.CylinderGeometry(0.36, 0.24, 0.25, 8), o.mat || P.chimney, 0, 1.1, 0);
      mesh(g, new THREE.ConeGeometry(0.2, 0.45, 7), P.flame, 0, 1.42, 0).castShadow = false;
      break;
    }
    case 'statue': { // weathered idol on a plinth
      mesh(g, B(1.2, 0.8, 1.2), P.chimney, 0, 0.4, 0);
      mesh(g, B(0.7, 1.4, 0.55), P.gold, 0, 1.5, 0);
      mesh(g, B(0.55, 0.55, 0.5), P.gold, 0, 2.5, 0);
      mesh(g, B(0.9, 0.12, 0.2), P.gold, 0, 1.9, 0);
      break;
    }
    case 'lightpost': { // tall floodlight mast
      mesh(g, new THREE.CylinderGeometry(0.1, 0.18, 9, 8), P.steel, 0, 4.5, 0);
      mesh(g, B(1.6, 0.5, 0.3), P.steel, 0, 9, 0);
      mesh(g, B(1.4, 0.35, 0.05), P.light, 0, 9, -0.17).castShadow = false;
      break;
    }
    case 'bollard': {
      mesh(g, new THREE.CylinderGeometry(0.16, 0.2, 0.6, 10), P.rail, 0, 0.3, 0);
      mesh(g, new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), P.rail, 0, 0.6, 0);
      break;
    }
    case 'vine': { // hanging greenery on a wall face
      const n = o.n || 5;
      for (let i = 0; i < n; i++) mesh(g, B(0.05, (o.h || 2) * (0.5 + ((i * 37) % 10) / 20), 0.18), P.jungle[i % 3], (i - n / 2) * 0.35, (o.h || 2) * 0.6, 0);
      break;
    }
  }
}

/**
 * Bake every static prop mesh into one merged mesh per material (world-space geometry), so the
 * hundreds of small parts (slats, bags, wheels, frames) cost a handful of draw calls.
 */
export function mergeByMaterial(root, scene) {
  root.updateMatrixWorld(true);
  const groups = new Map(), keep = [];
  root.traverse((o) => {
    if (o.isLight || o.isLine) { keep.push(o); return; }
    if (!o.isMesh) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(o.matrixWorld);
    const key = o.material.uuid + (o.castShadow ? 's' : 'n');
    if (!groups.has(key)) groups.set(key, { mat: o.material, cast: o.castShadow, geos: [] });
    groups.get(key).geos.push(g);
  });
  for (const { mat, cast, geos } of groups.values()) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = cast; m.receiveShadow = true;
    scene.add(m);
  }
  for (const o of keep) { const p = new THREE.Vector3(); o.getWorldPosition(p); o.removeFromParent(); o.position.copy(p); scene.add(o); }
}

export function buildProps(target, MAPDEF, mats, quality, map) {
  const scene = new THREE.Group();
  MAPTHEME = map.theme;
  for (const h of MAPDEF.houses) buildHouse(scene, h, mats, quality);
  for (const st of MAPDEF.stairs) buildStairRails(scene, st);
  for (const c of MAPDEF.containers) buildContainer(scene, c);
  for (const d of MAPDEF.decor) buildDecor(scene, d);
  for (const v of MAPDEF.vehicles) buildVehicle(scene, v);
  for (const t of MAPDEF.trees) buildTree(scene, t);
  for (const l of MAPDEF.lamps) buildLamp(scene, l);
  MAPDEF.barrels.forEach((b, i) => buildBarrel(scene, b, i));
  for (const s of MAPDEF.sandbags) buildSandbags(scene, s, mats);
  for (const f of MAPDEF.fences) buildFence(scene, f);
  for (const s of MAPDEF.stalls) buildStall(scene, s, mats);
  if (map.powerLines) powerLines(scene);
  if (map.plaza) plaza(scene, mats);
  mergeByMaterial(scene, target);
}
