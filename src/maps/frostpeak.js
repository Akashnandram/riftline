// Frostpeak: a research outpost in the mountains. A radar deck rules mid, A site is a concrete
// bunker under a rocky ridge, B site a raised helipad next to the fuel depot. Falling snow.

const ROCK = 0xc3c9d1;

export default {
  id: 'frostpeak', name: 'Frostpeak', desc: 'Snowbound outpost with a radar deck',
  theme: {
    sky: { zenith: [0.35, 0.45, 0.6], mid: [0.55, 0.63, 0.74], horizon: [0.82, 0.86, 0.9], ground: [0.7, 0.72, 0.75], clouds: 1.0, cloudDark: [0.6, 0.64, 0.7], cloudLight: [0.9, 0.92, 0.95] },
    sun: { elev: 30, azim: -140, color: 0xe8f0ff, intensity: 1.7, disc: [0.95, 0.97, 1] },
    hemi: [0xdde8ff, 0x8a96a8, 0.38],
    env: { top: [0.45, 0.55, 0.7], hor: [0.8, 0.85, 0.9], gnd: [0.6, 0.62, 0.66], intensity: 0.8 },
    fog: [0xc8d2de, 60, 200],
    floor: 'snow', floorSurface: 'floor', snowCaps: true,
    mat: { plat: 'rock', step: 'block' },
    tint: { outer: 0xa3adbb, wall: 0xd3dae2, plat: ROCK, step: 0xb9bfc7 },
    particles: { color: 0xffffff, mode: 'snow', count: 1400 },
    backdrop: { color: 0x56606e, top: 0x8e98a6, height: 70, sharp: true, snowLine: 0.4, waves: [[3, 0.5], [8, 0.35], [19, 0.2]] },
  },
  sites: {
    A: { min: { x: 12, z: -29 }, max: { x: 28, z: -11 }, center: { x: 19, z: -17 },
      plants: [{ x: 17, z: -17 }, { x: 23, z: -26 }, { x: 25.5, z: -14 }],
      entries: [{ x: 8, z: -18 }, { x: 16, z: -8.5 }] },
    B: { min: { x: 12, z: 11 }, max: { x: 28, z: 29 }, center: { x: 21, z: 21 },
      plants: [{ x: 21, z: 21 }, { x: 15, z: 26.5 }, { x: 26, z: 16.5 }],
      entries: [{ x: 7, z: 19 }, { x: 16, z: 8.5 }] },
  },
  mid: { area: { min: { x: 7, z: -8 }, max: { x: 18, z: 8 } }, center: { x: 12, z: 0 }, entries: [{ x: -7.5, z: 0 }, { x: -9, z: 7 }, { x: -9, z: -7 }] },
  retake: { A: [{ x: 30, z: -20 }, { x: 16, z: -8.5 }], B: [{ x: 30, z: 20 }, { x: 16, z: 8.5 }] },
  routes: {
    A: { main: [{ x: -6, z: -17 }, { x: 4, z: -18 }], split: [{ x: -10, z: -7 }, { x: 11, z: -7 }, { x: 16, z: -12 }] },
    B: { main: [{ x: -6, z: 18 }, { x: 5, z: 18 }], split: [{ x: -10, z: 7 }, { x: 11, z: 7 }, { x: 16, z: 12 }] },
  },

  build(A) {
    A.outer();
    A.spawnWalls([[-23, -17], [-3, 3], [17, 23]], 5);
    for (const z of [-10, 10]) for (const [a, b] of [[-30, -18], [-14, -4], [4, 14], [18, 30]]) A.box((a + b) / 2, z, b - a, 1.2, 4, 'wall');

    // mid: radar deck
    A.platform([-4.5, -4, 4.5, 4], 1.5, { mat: 'pillar', tint: 0xc4cad2, parapet: { h: 0.9, gaps: [{ side: 'w', a: -1.25, b: 1.25 }, { side: 'e', a: -1.25, b: 1.25 }] } });
    A.decor({ type: 'radar', x: 0, z: 0, y: 1.5 });
    A.box(0, 0, 0.8, 0.8, 5.5, 'pillar', 1.5, { hidden: true });

    A.both((a) => {
      a.stairs([-7, -1.25, -4.5, 1.25], 'x+', 1.5);
      // mid square
      a.box(-25, 0, 1.2, 5, 2.6, 'wall');
      a.rock(-12, -6, 2.4, 1.8, 1.6);
      a.rock(-15.5, 5, 2.0, 2.6, 2.0);
      a.crate(-10.5, 6.8, 1.5);
      a.tree(-20.5, 7.2, 'pine');
      a.barrel(-21, -7.6); a.barrel(-20.3, -8.1);

      // ---- A lane (east half is A site) ----
      a.house({
        rect: [19, -29.6, 27, -23], color: 0xc8d0da, flat: true, roofMat: 'outer',
        openings: [
          { side: 's', type: 'door', a: 21, b: 23.2 }, { side: 's', type: 'window', a: 24.4, b: 25.8 },
          { side: 'w', type: 'window', a: -27.2, b: -25.6 }, { side: 'e', type: 'door', a: -27.5, b: -25.3 },
        ],
        inner: [[22.85, -29.45, 23.15, -26.6]],
        furniture: [[20.6, -28.6, 1.6, 0.8, 0.8], [25.8, -28.9, 1.2, 0.5, 1.8]],
        lamp: [23, -25.5],
      });
      // rocky ridge over A main
      a.platform([5, -29.5, 11, -22], 2.0);
      a.stairs([5, -22, 7.5, -19], 'z-', 2.0);
      a.rock(9.6, -26.5, 1.2, 1.4, 0.9, 2.0);
      a.rock(14.8, -15, 2.0, 1.6, 1.4);
      a.crate(24.5, -16, 1.5);
      a.sandbag(17.5, -20.5, 3.2, 0.9);
      a.barrel(27.6, -13); a.barrel(27.6, -13.8);
      a.tree(14, -28.4, 'pine');
      a.tree(1.5, -14, 'pine');
      a.crate(2.5, -25, 1.5);

      // ---- B lane (east half is B site) ----
      // helipad with stairs on two sides
      a.platform([17, 17, 25, 25], 1.0, { mat: 'pillar', tint: 0x9aa4b0 });
      a.stairs([14.5, 19.5, 17, 22.5], 'x+', 1.0);
      a.stairs([19.5, 14.5, 22.5, 17], 'z+', 1.0);
      // fuel depot
      a.box(26.5, 27, 6, 2.4, 3.2, 'barrel', 0, { hidden: true });
      a.decor({ type: 'tank', x: 26.5, z: 27, r: 1.1, len: 6 });
      a.crate(13.5, 13.5, 1.5); a.crate(26.2, 14, 1.5); a.crate(26.2, 14, 1.0, 1.5);
      a.rock(19, 27.6, 2.2, 1.6, 1.3);
      // B main: radio hut + mast
      a.house({
        rect: [2, 22, 8, 29.6], color: 0xc8d0da, flat: true, roofMat: 'outer',
        openings: [{ side: 'n', type: 'door', a: 3.4, b: 5.6 }, { side: 'e', type: 'window', a: 24.5, b: 26 }, { side: 'n', type: 'window', a: 6.2, b: 7.4 }],
        furniture: [[6.8, 28.8, 1.4, 0.8, 0.8]],
        lamp: [5, 25.5],
      });
      a.box(10.5, 27.5, 0.4, 0.4, 18, 'pole', 0, { hidden: true });
      a.decor({ type: 'mast', x: 10.5, z: 27.5, h: 18 });
      a.tree(11, 13.5, 'pine'); a.tree(3, 15, 'pine');
      a.rock(8, 18.5, 1.6, 1.2, 1.1);
    });
  },
};
