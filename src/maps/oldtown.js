// Old Town: the original village — houses, parked cars, a market square in mid, a raised
// lookout terrace at each end of mid.

const HOUSES = [
  { // lane A west (mirrors onto B site)
    rect: [-22, -29.6, -14, -23.6], color: 0xd8c6a2,
    openings: [
      { side: 'n', type: 'door', a: -19.2, b: -17.0 }, { side: 'n', type: 'window', a: -21.6, b: -20.4 },
      { side: 'n', type: 'window', a: -16.2, b: -15.0 }, { side: 'e', type: 'door', a: -27.2, b: -25.0 },
      { side: 'w', type: 'window', a: -27.6, b: -26.2 },
    ],
    inner: [[-18.15, -29.45, -17.85, -26.6]],
    furniture: [[-20.3, -27.6, 1.4, 0.8, 0.78], [-16, -29.05, 1.6, 0.45, 1.9], [-15.2, -24.4, 0.8, 0.8, 0.8]],
    lamp: [-18, -25.4],
  },
  { // lane B west (mirrors onto A site)
    rect: [-23, 22.6, -15, 29.6], color: 0xa2b39a,
    openings: [
      { side: 'n', type: 'door', a: -20.2, b: -18.0 }, { side: 'n', type: 'window', a: -17.2, b: -16.0 },
      { side: 'e', type: 'door', a: 24.8, b: 27.0 }, { side: 'w', type: 'window', a: 25.0, b: 26.4 },
      { side: 's', type: 'window', a: -18.6, b: -17.2 },
    ],
    inner: [[-22.85, 26.05, -19.8, 26.35]],
    furniture: [[-21.4, 28.7, 1.8, 0.8, 0.65], [-17.2, 27.6, 1.2, 0.8, 0.78], [-22.3, 23.3, 0.8, 0.5, 1.6]],
    lamp: [-19, 24.8],
  },
];

// two-door shop in the middle (point-symmetric on its own, so it isn't mirrored)
const CENTER_HOUSE = {
  rect: [-3, -3, 3, 3], color: 0xc98f6b,
  openings: [
    { side: 'w', type: 'door', a: -1.2, b: 1.0 }, { side: 'e', type: 'door', a: -1.0, b: 1.2 },
    { side: 'n', type: 'window', a: -2.3, b: -0.9 }, { side: 's', type: 'window', a: 0.9, b: 2.3 },
    { side: 'n', type: 'window', a: 0.6, b: 1.8 }, { side: 's', type: 'window', a: -1.8, b: -0.6 },
  ],
  inner: [],
  furniture: [[-1.3, -2.45, 1.8, 0.5, 1.0], [1.3, 2.45, 1.8, 0.5, 1.0]],
  lamp: [0, 0],
};

export default {
  id: 'oldtown', name: 'Old Town', desc: 'Village streets, houses and a market square',
  theme: { floorSurface: 'concrete' },
  plaza: true, powerLines: true,
  sites: {
    A: { min: { x: 12, z: -29 }, max: { x: 28, z: -11 }, center: { x: 21, z: -21 },
      plants: [{ x: 18, z: -19 }, { x: 14.5, z: -14 }, { x: 26.5, z: -25.5 }],
      entries: [{ x: 6, z: -20 }, { x: 18, z: -8.5 }] },
    B: { min: { x: 12, z: 11 }, max: { x: 28, z: 29 }, center: { x: 21, z: 21 },
      plants: [{ x: 18, z: 19.5 }, { x: 15, z: 14 }, { x: 26.3, z: 25.5 }],
      entries: [{ x: 6, z: 20 }, { x: 18, z: 8.5 }] },
  },
  mid: { area: { min: { x: 6, z: -8 }, max: { x: 16, z: 8 } }, center: { x: 11, z: 0 }, entries: [{ x: -6, z: 0 }, { x: -6, z: 5 }, { x: -6, z: -5 }] },
  retake: { A: [{ x: 30, z: -19.5 }, { x: 18, z: -8.5 }], B: [{ x: 30, z: 19.5 }, { x: 18, z: 8.5 }] },
  routes: {
    A: { main: [{ x: -8, z: -21 }, { x: 7, z: -20 }], split: [{ x: -10, z: -1 }, { x: 13, z: -5 }, { x: 18, z: -13 }] },
    B: { main: [{ x: -9, z: 21 }, { x: 7, z: 20 }], split: [{ x: -10, z: 1 }, { x: 13, z: 5 }, { x: 18, z: 13 }] },
  },

  build(A) {
    A.outer();
    // lane dividers (z = ±10) with a mid gap and two connectors
    for (const z of [-10, 10]) {
      for (const [a, b] of [[-30, -19.5], [-16.5, -5], [5, 16.5], [19.5, 30]]) A.box((a + b) / 2, z, b - a, 1.2, 5, 'wall');
    }
    A.spawnWalls([[-22, -17], [-2.5, 2.5], [17, 22]]);
    A.house(CENTER_HOUSE);

    A.both((a) => {
      // spawn exit cover
      a.box(-25, -19.5, 1.2, 4, 2.6, 'wall');
      a.box(-25, 19.5, 1.2, 4, 2.6, 'wall');
      a.box(-22, 0, 1.2, 5, 2.6, 'wall');
      for (const h of HOUSES) a.house(h);
      a.vehicle({ type: 'truck', rect: [-5, -22.2, 2.6, -19.8], dir: 1, color: 0x456a8c });
      a.vehicle({ type: 'car', rect: [-11.1, 24.6, -6.9, 26.4], color: 0xa3392d });
      a.vehicle({ type: 'car', rect: [-25, 3, -23.2, 7.2], color: 0xd6d4cc });
      // solid cover
      a.box(-7, -15, 1.2, 5, 4, 'wall');
      a.box(-15, -5.5, 1.6, 1.6, 2.2, 'crate');
      a.box(-11, 14, 1.6, 1.6, 2.2, 'crate');
      a.box(-12, -19, 1.5, 1.5, 1.5, 'crate');
      a.box(-12, -19, 1.1, 1.1, 1.0, 'crate', 1.5);       // smaller crate stacked on top
      // lookout terrace at each end of mid: stone deck reached by stairs, low wall to peek over
      a.platform([-20.5, -8.6, -16, -5.2], 1.75, { parapet: { h: 0.95, gaps: [{ side: 'e', a: -8.6, b: -6.1 }] }, tint: 0xb9ab95 });
      a.stairs([-16, -8.6, -12.8, -6.1], 'x-', 1.75, 0, { tint: 0xb9ab95 });
      for (const [x, z] of [[-27, -27], [-6, -27.5], [-27, 13], [-2, 27.5]]) a.tree(x, z);
      for (const [x, z] of [[-3, -25], [-14, 21], [-8, -8.4]]) a.lamp(x, z);
      for (const [x, z] of [[-26, -13], [-25.25, -13.5], [-6.5, -6.2], [-20.5, 14.5]]) a.barrel(x, z);
      a.sandbag(-11, -15, 3.2, 0.9); a.sandbag(-4.5, 17.5, 3.2, 0.9);
      a.fence(-13, 17.5, 4, 0.12);
      a.stall(-11, 5, 2.4, 0.9);
    });
  },
};
