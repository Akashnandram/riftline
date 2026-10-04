// Harbor: a container port at sunset. Container rows split the lanes, the mid warehouse roof is
// a high vantage point, A site has a climbable container stack and B site a loading dock.

const RED = 0xb5402f, BLUE = 0x2f6fa8, GREEN = 0x3f8a4f, ORANGE = 0xd18b2a, GREY = 0x7a7f86, WHITE = 0xd9d2c0, TEAL = 0x2f8a8a;
const L = 6.06, W = 2.44;   // 20 ft container footprint

export default {
  id: 'harbor', name: 'Harbor', desc: 'Container port at sunset',
  theme: {
    sky: { zenith: [0.12, 0.16, 0.35], mid: [0.45, 0.38, 0.5], horizon: [0.95, 0.6, 0.38], ground: [0.3, 0.28, 0.3], clouds: 0.6, cloudDark: [0.45, 0.32, 0.35], cloudLight: [1.0, 0.72, 0.52] },
    sun: { elev: 16, azim: -100, color: 0xffb27a, intensity: 2.3, disc: [1, 0.8, 0.55] },
    hemi: [0xffc9a0, 0x3a3f50, 0.28],
    env: { top: [0.3, 0.3, 0.5], hor: [0.95, 0.6, 0.4], gnd: [0.2, 0.2, 0.22], intensity: 0.7 },
    fog: [0xc9937a, 75, 230],
    floor: 'asphalt', floorSurface: 'concrete',
    mat: { wall: 'outer', plat: 'outer', step: 'pillar' },
    tint: { outer: 0x7d8590, wall: 0xb0b6bd, plat: 0x9aa1aa, step: 0x8f969e },
    particles: { color: 0xffd2a8, mode: 'dust', count: 500 },
    backdrop: { city: true, color: 0x2a303d, top: 0x4c5468, height: 60 },
  },
  sites: {
    A: { min: { x: 12, z: -29 }, max: { x: 28, z: -12 }, center: { x: 19, z: -22 },
      plants: [{ x: 18, z: -22.5 }, { x: 22, z: -14.5 }, { x: 27, z: -21 }],
      entries: [{ x: 6, z: -19 }, { x: 11, z: -8.5 }] },
    B: { min: { x: 12, z: 12 }, max: { x: 28, z: 29 }, center: { x: 20, z: 20 },
      plants: [{ x: 19, z: 19.5 }, { x: 15, z: 14 }, { x: 18, z: 27 }],
      entries: [{ x: 6, z: 18 }, { x: 11, z: 8.5 }] },
  },
  mid: { area: { min: { x: 6, z: -8 }, max: { x: 18, z: 8 } }, center: { x: 12, z: 0 }, entries: [{ x: -6, z: 0 }, { x: -8, z: 6.5 }, { x: -8, z: -6.5 }] },
  retake: { A: [{ x: 30, z: -22 }, { x: 11, z: -8.5 }], B: [{ x: 30, z: 22 }, { x: 11, z: 8.5 }] },
  routes: {
    A: { main: [{ x: -6, z: -18 }, { x: 5, z: -19 }], split: [{ x: -10, z: -6.5 }, { x: 10, z: -6.5 }, { x: 13, z: -13 }] },
    B: { main: [{ x: -6, z: 18 }, { x: 5, z: 18 }], split: [{ x: -10, z: 6.5 }, { x: 10, z: 6.5 }, { x: 13, z: 13 }] },
  },

  build(A) {
    A.outer();
    A.spawnWalls([[-25, -19], [-3, 3], [19, 25]], 5);

    // mid: warehouse block with a walled roof, stairs up its north and south faces
    A.platform([-5, -4, 5, 4], 3.4, { parapet: { h: 1.0, gaps: [{ side: 'w', a: -1.25, b: 1.25 }, { side: 'e', a: -1.25, b: 1.25 }] }, mat: 'container', tint: 0x8c939b });

    A.both((a) => {
      // container rows between the lanes (double-stacked next to mid)
      for (const zc of [-10, 10]) {
        const z0 = zc - W / 2, z1 = zc + W / 2;
        a.container([3, z0, 3 + L, z1], zc < 0 ? RED : BLUE);
        a.container([3, z0, 3 + L, z1], zc < 0 ? GREY : WHITE, { y0: 2.6 });
        a.container([13, z0, 13 + L, z1], zc < 0 ? GREEN : ORANGE);
        a.container([13 + L, z0, 13 + 2 * L, z1], zc < 0 ? ORANGE : TEAL);
        a.container([13 + 2 * L, z0, 29.4, z1], GREY);
      }
      a.stairs([-9.6, -1.25, -5, 1.25], 'x+', 3.4);

      // mid square
      a.box(-25, 0, 1.2, 5, 2.6, 'wall');
      a.container([-20, 1.2, -20 + L, 1.2 + W], WHITE);
      a.container([-16.5, -7, -16.5 + W, -7 + L], GREY);
      a.crate(-10, -6.5, 1.5); a.crate(-11.6, -6.5, 1.5); a.crate(-10.8, -6.5, 1.0, 1.5);
      a.barrel(-23.5, -7.5); a.barrel(-22.8, -8);

      // ---- A lane (east half is A site) ----
      // climbable stack: stairs up onto a container
      a.container([20, -27.6, 20 + L, -27.6 + W], RED, { walk: true });
      a.stairs([16, -27.6, 20, -27.6 + W], 'x+', 2.6);
      a.container([14, -20, 14 + L, -20 + W], BLUE);
      a.container([23, -19, 23 + W, -19 + L], GREEN);
      a.crate(15, -13.2, 1.5); a.crate(16.6, -13.2, 1.5);
      a.barrel(27.5, -28.4); a.barrel(26.8, -28.8);
      // A main
      a.vehicle({ type: 'truck', rect: [2, -24, 9.6, -21.6], dir: 1, color: 0x2f5f8a });
      a.container([3, -29.5, 3 + L, -29.5 + W], ORANGE);
      a.crate(10.3, -14, 1.5); a.crate(10.3, -14, 1.0, 1.5);

      // ---- B lane (east half is B site) ----
      // loading dock along the back wall
      a.platform([14, 24.5, 29.4, 29.5], 1.5);
      a.stairs([11.5, 25.5, 14, 28.5], 'x+', 1.5);
      a.stairs([20, 22, 23, 24.5], 'z+', 1.5);
      a.crate(17.5, 27.4, 1.2, 1.5); a.crate(25.5, 26.8, 1.2, 1.5); a.crate(25.5, 26.8, 0.9, 2.7);
      a.container([16, 14, 16 + L, 14 + W], WHITE);
      a.container([24.5, 12.6, 24.5 + W, 12.6 + L], RED);
      // B main: harbour office
      a.house({
        rect: [2, 22, 9, 29.6], color: 0x9aa4ae, flat: true, mat: 'outer',
        openings: [
          { side: 'n', type: 'door', a: 3.9, b: 6.1 }, { side: 'n', type: 'window', a: 7, b: 8.4 },
          { side: 'e', type: 'door', a: 24.1, b: 26.3 }, { side: 'w', type: 'window', a: 25, b: 26.5 },
        ],
        furniture: [[7.6, 28.8, 1.6, 0.8, 0.8], [3, 28.9, 1.2, 0.6, 1.8]],
        lamp: [5.5, 25],
      });
      a.container([2, 12.6, 2 + L, 12.6 + W], GREEN);
      a.lamp(10.8, 20.5);

      // scenery: dock cranes beyond the north wall, floodlights in the spawn corners
      a.decor({ type: 'crane', x: -18, z: -50, h: 28 });
      a.decor({ type: 'crane', x: 14, z: -54, h: 32 });
      a.decor({ type: 'lightpost', x: -38.5, z: -28.5 });
      a.decor({ type: 'bollard', x: -6, z: -29.3 }); a.decor({ type: 'bollard', x: 0, z: -29.3 });
    });
  },
};
