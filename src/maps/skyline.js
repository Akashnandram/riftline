// Skyline: city rooftops at night. Mid is a raised helipad; the lanes are split by rooftop
// walkways (3 m up, a gap to jump in the middle); A has an elevator machine room you can climb,
// B a low skylight roof. Lots of height and short sight lines between rooftop clutter.

const ROOF = 0x9aa1b3, DARK = 0x6f7688, TRIM = 0xb4bccc;

export default {
  id: 'skyline', name: 'Skyline', desc: 'City rooftops at night, a helipad in the middle',
  theme: {
    sky: { zenith: [0.03, 0.04, 0.1], mid: [0.08, 0.08, 0.2], horizon: [0.42, 0.24, 0.32], ground: [0.06, 0.06, 0.09], clouds: 0.5, cloudDark: [0.08, 0.08, 0.14], cloudLight: [0.36, 0.26, 0.38] },
    // a bright moon and the city glow keep it readable: night look, daylight-ish visibility
    sun: { elev: 40, azim: 60, color: 0xc8d4ff, intensity: 2.4, disc: [0.85, 0.9, 1] },
    hemi: [0xa8b8ff, 0x50465a, 0.95],
    env: { top: [0.3, 0.33, 0.55], hor: [0.75, 0.5, 0.6], gnd: [0.2, 0.2, 0.25], intensity: 1.1 },
    fog: [0x2a3150, 80, 220],
    floor: 'asphalt', floorSurface: 'concrete',
    mat: { wall: 'outer', plat: 'outer', step: 'pillar' },
    tint: { outer: 0x4a5062, wall: ROOF, plat: ROOF, step: TRIM, crate: 0x9a8670 },
    particles: { color: 0x9fb4ff, mode: 'dust', count: 350 },
    backdrop: { city: true, color: 0x141826, top: 0x2a2f45, height: 70 },
  },
  sites: {
    A: { min: { x: 12, z: -29 }, max: { x: 28, z: -12 }, center: { x: 19, z: -21 },
      plants: [{ x: 19, z: -21 }, { x: 14, z: -15 }, { x: 26.5, z: -16 }],
      entries: [{ x: 6, z: -19 }, { x: 13.5, z: -8 }] },
    B: { min: { x: 12, z: 12 }, max: { x: 28, z: 29 }, center: { x: 19, z: 21 },
      plants: [{ x: 19, z: 17 }, { x: 14.5, z: 25 }, { x: 26, z: 24 }],
      entries: [{ x: 6, z: 19 }, { x: 13.5, z: 8 }] },
  },
  mid: { area: { min: { x: 6, z: -8 }, max: { x: 18, z: 8 } }, center: { x: 12, z: 0 }, entries: [{ x: -6, z: 0 }, { x: -9, z: 6.5 }, { x: -9, z: -6.5 }] },
  retake: { A: [{ x: 30, z: -21 }, { x: 13.5, z: -8 }], B: [{ x: 30, z: 21 }, { x: 13.5, z: 8 }] },
  routes: {
    A: { main: [{ x: -6, z: -19 }, { x: 5, z: -19 }], split: [{ x: -10, z: -6.5 }, { x: 9, z: -6.5 }, { x: 13.5, z: -12 }] },
    B: { main: [{ x: -6, z: 19 }, { x: 5, z: 19 }], split: [{ x: -10, z: 6.5 }, { x: 9, z: 6.5 }, { x: 13.5, z: 12 }] },
  },

  build(A) {
    A.outer();
    A.spawnWalls([[-24, -18], [-3, 3], [18, 24]], 5);

    // mid: the helipad, 3 m up with a low rail; stairs up from both spawns' side
    A.platform([-5, -5, 5, 5], 3, { parapet: { h: 1.0, tint: TRIM, gaps: [{ side: 'w', a: -1.5, b: 1.5 }, { side: 'e', a: -1.5, b: 1.5 }] }, tint: DARK });
    A.decor({ type: 'lightpost', x: 4.2, z: 4.2, y: 3 });

    A.both((a) => {
      a.stairs([-9, -1.5, -5, 1.5], 'x+', 3);
      a.crate(-3, 3.2, 1.0, 3);

      // rooftop walkways between the lanes (z = ±10): 3 m up, with a 3 m gap to walk through or jump
      for (const z of [-10, 10]) {
        a.platform([3, z - 1.2, 12, z + 1.2], 3, { tint: DARK });
        a.platform([15, z - 1.2, 29.4, z + 1.2], 3, { tint: DARK });
        // stairs onto each walkway, from the middle lane
        const s = Math.sign(z);
        a.stairs(s < 0 ? [5, -8.8, 8, -6.2] : [5, 6.2, 8, 8.8], s < 0 ? 'z-' : 'z+', 3);
        a.stairs(s < 0 ? [22, -8.8, 25, -6.2] : [22, 6.2, 25, 8.8], s < 0 ? 'z-' : 'z+', 3);
      }

      // spawn-side square: rooftop clutter
      a.box(-25, 0, 1.2, 5, 2.6, 'wall');
      a.box(-19, 3.5, 2.4, 1.6, 1.5, 'block');       // AC unit
      a.box(-15.5, -4, 1.6, 2.4, 1.5, 'block');
      a.crate(-21, -6, 1.2); a.crate(-21, -6, 0.9, 1.2);
      a.barrel(-12.5, 6.5); a.barrel(-13.2, 7.1);

      // ---- A lane (east half is A site): elevator machine room you can climb ----
      a.platform([16, -27, 22, -22.5], 3.2, { parapet: { h: 1.0, tint: TRIM, gaps: [{ side: 'e', a: -27, b: -24.5 }] }, tint: DARK });
      a.stairs([22, -27, 25.5, -24.5], 'x-', 3.2);
      a.box(19, -16.5, 2.6, 1.6, 1.5, 'block');        // AC units on site
      a.box(26.5, -19, 1.6, 2.6, 1.5, 'block');
      a.crate(14, -14, 1.3); a.crate(14, -14, 0.9, 1.3);
      a.decor({ type: 'tank', x: 13.5, z: -27.6, r: 0.8, len: 2.4 });
      a.box(13.5, -27.6, 3.0, 1.7, 2.6, 'block', 0, { hidden: true });   // the tank is decor: give it a body
      a.decor({ type: 'mast', x: 27.5, z: -28 });
      a.box(27.5, -28, 0.4, 0.4, 6, 'pole', 0, { hidden: true });
      // A main: a billboard frame and vents narrow the lane
      a.box(8, -27.5, 1.0, 4, 4.5, 'wall');
      a.box(8, -15.3, 1.0, 3.2, 3, 'wall');
      a.box(3.5, -24, 2, 2, 1.4, 'block');
      a.crate(4.5, -14.5, 1.2);
      a.lamp(1.5, -27.5);

      // ---- B lane (east half is B site): low skylight roof ----
      a.platform([14, 15, 24, 20.5], 1.2, { parapet: { h: 0.9, tint: TRIM, gaps: [{ side: 'w', a: 16.5, b: 19 }, { side: 'n', a: 20, b: 22.5 }] }, tint: 0x7c9ab8 });
      a.stairs([11.5, 16.5, 14, 19], 'x+', 1.2);
      a.stairs([20, 12.6, 22.5, 15], 'z+', 1.2);
      a.box(16, 26, 2.4, 1.6, 1.5, 'block');
      a.box(25.5, 25.5, 1.6, 2.4, 1.5, 'block');
      a.crate(27, 14, 1.4);
      a.decor({ type: 'lightpost', x: 28, z: 28.5 });
      // B main: stairwell block
      a.box(5, 25.5, 4, 3, 3.2, 'block');
      a.box(9, 14.5, 1.0, 3, 2.6, 'wall');
      a.barrel(2.5, 14); a.barrel(3.2, 13.4);
      a.lamp(1.5, 28.5);
    });
  },
};
