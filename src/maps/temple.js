// Temple: jungle ruins. A three-tier stepped pyramid towers over mid, A site is an altar court
// ringed by broken pillars, B site a ruined library with a high ledge.

const MOSS = 0xb8b49c;

export default {
  id: 'temple', name: 'Temple', desc: 'Jungle ruins around a stepped pyramid',
  theme: {
    sky: { zenith: [0.15, 0.32, 0.5], mid: [0.4, 0.55, 0.62], horizon: [0.75, 0.8, 0.7], ground: [0.25, 0.3, 0.2], clouds: 0.7, cloudDark: [0.6, 0.66, 0.64], cloudLight: [0.92, 0.94, 0.88] },
    sun: { elev: 48, azim: -60, color: 0xfff0c8, intensity: 2.0, disc: [1, 0.96, 0.85] },
    hemi: [0xd8f0c8, 0x3a4a2a, 0.3],
    env: { top: [0.25, 0.42, 0.5], hor: [0.6, 0.7, 0.6], gnd: [0.2, 0.25, 0.15], intensity: 0.65 },
    fog: [0x9fb09a, 60, 200],
    floor: 'jungle', floorSurface: 'grass',
    mat: { wall: 'moss', block: 'moss', plat: 'moss', step: 'moss', outer: 'moss', pillar: 'moss' },
    tint: { wall: MOSS, block: 0xa9a58e, plat: 0xc2bda4, step: 0xb5b09a, outer: 0x8f8d7a, pillar: 0xc0bba2 },
    trims: false, rails: false,
    particles: { color: 0xe8ffc0, mode: 'dust', count: 900 },
    backdrop: { color: 0x1f3a22, top: 0x355a33, height: 28, base: 2, waves: [[5, 0.4], [13, 0.35], [31, 0.25]] },
  },
  sites: {
    A: { min: { x: 12, z: -29 }, max: { x: 28, z: -11 }, center: { x: 21, z: -20 },
      plants: [{ x: 21, z: -20 }, { x: 17.5, z: -27 }, { x: 24.5, z: -14.8 }],
      entries: [{ x: 7, z: -20 }, { x: 15, z: -8.5 }] },
    B: { min: { x: 12, z: 11 }, max: { x: 28, z: 29 }, center: { x: 18, z: 17 },
      plants: [{ x: 17, z: 17 }, { x: 25, z: 23 }, { x: 25, z: 15 }],
      entries: [{ x: 6, z: 19 }, { x: 15, z: 8.5 }] },
  },
  mid: { area: { min: { x: 8, z: -8 }, max: { x: 18, z: 8 } }, center: { x: 12, z: 0 }, entries: [{ x: -9, z: 0 }, { x: -10, z: 7.5 }, { x: -10, z: -7.5 }] },
  retake: { A: [{ x: 30, z: -21 }, { x: 15, z: -8.5 }], B: [{ x: 30, z: 21 }, { x: 15, z: 8.5 }] },
  routes: {
    A: { main: [{ x: -5, z: -20 }, { x: 5, z: -20 }], split: [{ x: -10, z: -7.5 }, { x: 10, z: -7.5 }, { x: 15, z: -12 }] },
    B: { main: [{ x: -5, z: 19 }, { x: 5, z: 19 }], split: [{ x: -10, z: 7.5 }, { x: 10, z: 7.5 }, { x: 15, z: 12 }] },
  },

  build(A) {
    A.outer();
    A.spawnWalls([[-24, -18], [-3, 3], [18, 24]], 5);
    for (const z of [-10, 10]) {
      for (const [a, b, h] of [[-30, -17, 5], [-13, -7, 3.4], [7, 13, 3.4], [17, 30, 5]]) A.box((a + b) / 2, z, b - a, 1.2, h, 'wall');
    }

    // mid: stepped pyramid (1 m, 2 m, 3 m tiers) with an idol on top
    A.platform([-6, -6, 6, 6], 1.0);
    A.platform([-4, -4, 4, 4], 2.0);
    A.platform([-2, -2, 2, 2], 3.0);
    A.decor({ type: 'statue', x: 0, z: 0, y: 3 });
    A.box(0, 0, 1.2, 1.2, 2.9, 'block', 3, { hidden: true });

    A.both((a) => {
      a.stairs([-8.5, -1.25, -6, 1.25], 'x+', 1.0);
      a.stairs([-6, -1.25, -4, 1.25], 'x+', 2.0, 1.0);
      a.stairs([-4, -1.25, -2, 1.25], 'x+', 3.0, 2.0);
      for (const [x, z] of [[-5.4, -5.4], [-5.4, 5.4]]) a.decor({ type: 'torch', x, z, y: 1.0 });
      // mid square: broken columns, a fallen pillar, big trees
      a.box(-25, 0, 1.2, 5, 2.6, 'wall');
      a.box(-13, -5.5, 1.0, 1.0, 2.4, 'pillar');
      a.box(-13, 5.5, 1.0, 1.0, 4.0, 'pillar');
      a.box(-18.5, -6.2, 4, 0.9, 0.9, 'block');
      a.tree(-20.5, 7.4, 'jungle');
      a.decor({ type: 'bush', x: -16, z: 2, s: 1.1 });
      a.decor({ type: 'vine', x: -10, z: -9.35, n: 6, h: 2.6 });

      // ---- A lane (east half is A site): the altar court ----
      a.platform([18, -23, 24, -17], 1.0);
      a.stairs([15.5, -21.25, 18, -18.75], 'x+', 1.0);
      a.stairs([19.75, -17, 22.25, -14.5], 'z-', 1.0);
      a.decor({ type: 'torch', x: 18.6, z: -22.4, y: 1 }); a.decor({ type: 'torch', x: 23.4, z: -17.6, y: 1 });
      for (const [x, z, h] of [[15, -26, 3.6], [26.5, -27.5, 2.2], [26.5, -13, 3.6], [15, -14.5, 1.6]]) a.box(x, z, 1.0, 1.0, h, 'pillar');
      a.box(13, -24.5, 1.0, 4, 2.2, 'block');
      a.box(22, -12.4, 4, 1.0, 2.6, 'block');
      a.tree(27.5, -21, 'jungle');
      // A main: ruined wall + idol
      a.box(6, -22, 1.0, 6, 2.8, 'block');
      a.box(6, -22, 1.0, 2, 1.0, 'block', 2.8);
      a.tree(3, -14.5, 'jungle'); a.tree(9.5, -27.5, 'jungle');
      a.decor({ type: 'statue', x: 2.2, z: -27.6 });
      a.box(2.2, -27.6, 1.2, 1.2, 3.1, 'block', 0, { hidden: true });

      // ---- B lane (east half is B site): the library ----
      a.house({
        rect: [19, 21, 27, 29.6], color: MOSS, flat: true, mat: 'moss', roofMat: 'moss', roofUnit: false, kind: 'block',
        openings: [
          { side: 'n', type: 'door', a: 20.9, b: 23.1 }, { side: 'n', type: 'window', a: 24.4, b: 25.9 },
          { side: 'w', type: 'window', a: 24, b: 25.5 }, { side: 'e', type: 'door', a: 23.9, b: 26.3 },
        ],
        inner: [[22.9, 25, 23.2, 29.45]],
        furniture: [[20.6, 28.6, 1.6, 0.9, 0.8], [25.6, 28.8, 1.6, 0.7, 1.9]],
      });
      // B heaven: a high ledge with a low wall
      a.platform([12, 26, 18, 29.5], 2.0, { parapet: { h: 0.9, gaps: [{ side: 'n', a: 12, b: 14.5 }] } });
      a.stairs([12, 22.5, 14.5, 26], 'z+', 2.0);
      a.box(17, 15, 3, 1.2, 1.1, 'block');
      a.box(24, 14, 1.0, 1.0, 3.0, 'pillar');
      a.tree(23.5, 17.6, 'jungle');
      a.decor({ type: 'bush', x: 13.5, z: 19.5 });
      // B main
      a.box(6, 18, 1.0, 6, 2.8, 'block');
      a.tree(3, 26.5, 'jungle'); a.tree(9.5, 13.5, 'jungle');
      a.decor({ type: 'vine', x: 10, z: 9.35, n: 5, h: 2.4 });
      a.decor({ type: 'bush', x: 2, z: 12.5, s: 1.2 });
    });
  },
};
