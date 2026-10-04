// Dunes: a sun-baked desert town. Mid is a raised mesa with stairs at both ends; A site has a
// stone dais and a rooftop "heaven", B site a walled terrace above the market.

const STONE = 0xe3c79d, SAND = 0xf0d9b5;

export default {
  id: 'dunes', name: 'Dunes', desc: 'Desert town around a raised mesa',
  theme: {
    sky: { zenith: [0.16, 0.33, 0.6], mid: [0.42, 0.56, 0.74], horizon: [0.86, 0.78, 0.64], ground: [0.6, 0.5, 0.36], clouds: 0.3, cloudDark: [0.78, 0.72, 0.66], cloudLight: [0.98, 0.95, 0.9] },
    sun: { elev: 42, azim: -115, color: 0xffd9a6, intensity: 2.3, disc: [1, 0.93, 0.8] },
    hemi: [0xffe6c4, 0x8f6c44, 0.25],
    env: { top: [0.32, 0.44, 0.62], hor: [0.86, 0.76, 0.6], gnd: [0.5, 0.4, 0.26], intensity: 0.7 },
    fog: [0xd9c6a2, 85, 240],
    floor: 'sand', floorSurface: 'floor',
    mat: { outer: 'block', plat: 'block', step: 'block' },
    tint: { outer: 0xc9a77a, wall: SAND, plat: STONE, step: 0xd8ba8f, crate: 0xd2a874 },
    trims: false,
    particles: { color: 0xffe0b0, mode: 'dust', count: 900 },
    backdrop: { color: 0xbf9a68, top: 0xe8c690, height: 34, base: 1, waves: [[2, 0.5], [5, 0.35], [11, 0.12]] },
  },
  sites: {
    A: { min: { x: 12, z: -29 }, max: { x: 28, z: -11 }, center: { x: 20, z: -21.5 },
      plants: [{ x: 20, z: -21.5 }, { x: 14, z: -13 }, { x: 26.5, z: -17.5 }],
      entries: [{ x: 6, z: -20 }, { x: 14, z: -8.5 }] },
    B: { min: { x: 12, z: 11 }, max: { x: 28, z: 29 }, center: { x: 19, z: 19 },
      plants: [{ x: 17.5, z: 18.5 }, { x: 24, z: 19.5 }, { x: 15.5, z: 26 }],
      entries: [{ x: 6, z: 18 }, { x: 14, z: 8.5 }] },
  },
  mid: { area: { min: { x: 7, z: -8 }, max: { x: 18, z: 8 } }, center: { x: 12, z: 0 }, entries: [{ x: -7, z: 0 }, { x: -10, z: 7 }, { x: -10, z: -7 }] },
  retake: { A: [{ x: 30, z: -21 }, { x: 14, z: -8.5 }], B: [{ x: 30, z: 20 }, { x: 14, z: 8.5 }] },
  routes: {
    A: { main: [{ x: -6, z: -19 }, { x: 5, z: -20 }], split: [{ x: -11, z: -7 }, { x: 10, z: -7 }, { x: 14, z: -12 }] },
    B: { main: [{ x: -6, z: 16 }, { x: 5, z: 17 }], split: [{ x: -11, z: 7 }, { x: 10, z: 7 }, { x: 14, z: 12 }] },
  },

  build(A) {
    A.outer();
    A.spawnWalls([[-24, -18], [-3, 3], [18, 24]], 5);
    for (const z of [-10, 10]) for (const [a, b] of [[-30, -16], [-12, -3], [3, 12], [16, 30]]) A.box((a + b) / 2, z, b - a, 1.2, 4.5, 'wall');

    // mid: the mesa — a 2 m stone plateau with a low wall, climbed from either end
    A.platform([-6, -5, 6, 5], 2, { parapet: { h: 1.0, gaps: [{ side: 'w', a: -1.5, b: 1.5 }, { side: 'e', a: -1.5, b: 1.5 }] } });
    A.decor({ type: 'statue', x: 0, z: 0, y: 2 });
    A.box(0, 0, 1.2, 1.2, 3.2, 'block', 2, { hidden: true });

    A.both((a) => {
      a.stairs([-9, -1.5, -6, 1.5], 'x+', 2);
      a.crate(-3.2, 2.6, 1.2, 2); a.crate(-3.2, -2.9, 1.0, 2);
      // mid square
      a.box(-25, 0, 1.2, 5, 2.6, 'wall');
      a.box(-17, 4, 1.6, 1.6, 2.2, 'crate');
      a.stall(-19, -6.5, 2.4, 0.9);
      a.vehicle({ type: 'car', rect: [-22, 4.5, -20.2, 8.7], color: 0x8a6a4a });
      a.tree(-12, 7.6, 'palm'); a.tree(-12, -7.6, 'palm');
      a.barrel(-14.5, -8.2); a.barrel(-13.8, -8.6);

      // ---- A lane (east half is A site; mirrored it becomes the attackers' B lobby) ----
      // stone dais with two stairways
      a.platform([16, -25, 24, -18], 1.25);
      a.stairs([13.5, -23, 16, -20], 'x+', 1.25);
      a.stairs([18.5, -18, 21.5, -15.5], 'z-', 1.25);
      a.crate(17.6, -23.6, 1.2, 1.25); a.crate(22.6, -19.4, 1.2, 1.25);
      // A heaven: a walled rooftop above the site
      a.platform([24, -29.5, 29.4, -25.5], 3, { parapet: { h: 1.0, gaps: [{ side: 'w', a: -29.5, b: -27 }] }, mat: 'wall', tint: SAND });
      a.stairs([20, -29.5, 24, -27], 'x+', 3, 0, { mat: 'wall', tint: SAND });
      a.sandbag(26.3, -14, 0.9, 3.2);
      a.barrel(14, -27); a.barrel(14.7, -27.6);
      // A main: a gatehouse arch narrows the lane
      a.box(8, -27, 1.2, 6, 4.5, 'wall');
      a.box(8, -13.3, 1.2, 5.4, 4.5, 'wall');
      a.box(8, -20, 1.2, 8, 1.1, 'wall', 3.3);
      a.vehicle({ type: 'car', rect: [2, -27.6, 6.2, -25.8], color: 0x7a5a3a });
      a.barrel(5, -14);
      a.tree(1.5, -12.2, 'palm');

      // ---- B lane (east half is B site) ----
      // B main: a flat-roofed house
      a.house({
        rect: [2, 21, 10, 29.6], color: 0xe9d2aa, flat: true,
        openings: [
          { side: 'n', type: 'door', a: 3.9, b: 6.1 }, { side: 'n', type: 'window', a: 7.4, b: 8.8 },
          { side: 'e', type: 'door', a: 24.9, b: 27.1 }, { side: 'w', type: 'window', a: 24, b: 25.5 },
        ],
        inner: [[2.15, 25.6, 5.5, 25.9]],
        furniture: [[8.5, 28.8, 1.6, 0.8, 0.8], [3.2, 28.6, 1.2, 1.2, 0.6]],
        lamp: [6, 24],
      });
      a.crate(6, 14, 1.5); a.crate(6, 14, 1.0, 1.5);
      a.vehicle({ type: 'car', rect: [0.6, 12.2, 2.4, 16.4], color: 0x9c7b52 });
      // B site: terrace with a low wall above the market
      a.platform([22, 22.5, 29.4, 29.5], 1.75, { parapet: { h: 1.0, gaps: [{ side: 'w', a: 25, b: 28 }] } });
      a.stairs([19, 25, 22, 28], 'x+', 1.75);
      a.stall(16, 15.5, 2.4, 0.9);
      a.stall(21, 13.5, 2.4, 0.9);
      a.crate(25, 15, 1.5); a.crate(25, 15, 1.0, 1.5);
      a.crate(15, 25.5, 1.5);
      a.tree(27.5, 12, 'palm'); a.tree(13, 28.3, 'palm');

      a.decor({ type: 'cactus', x: -38, z: -28.5, s: 1.2 });
      a.decor({ type: 'cactus', x: -39, z: 27.5, s: 0.9 });
      a.decor({ type: 'cactus', x: 3, z: -29.2, s: 1.0 });
    });
  },
};
