import * as THREE from 'three';
import { game } from './state.js';
import { sfx } from './audio.js';

// Map events: once per match, about a third of the way in, each map gets its own twist for ~45 s.
//  Dunes — sandstorm · Frostpeak — blizzard · Temple — mist rolls in (fog closes in, everyone sees less)
//  Harbor — power cut (the lights go down)  · Old Town — supply crate dropped in the middle for anyone
// The host / offline game decides when (game.onMapEvent); every peer plays the visuals.
export const MAP_EVENTS = {
  dunes: { kind: 'sandstorm', name: 'SANDSTORM', sub: 'visibility is dropping, stay close to cover', fog: 0xc9a46a, far: 30, light: 0.75 },
  frostpeak: { kind: 'blizzard', name: 'BLIZZARD', sub: 'whiteout incoming, you won’t see far', fog: 0xe3e9ef, far: 26, light: 0.9 },
  temple: { kind: 'mist', name: 'JUNGLE MIST', sub: 'thick mist is rolling through the ruins', fog: 0xaebbb5, far: 32, light: 0.8 },
  harbor: { kind: 'blackout', name: 'POWER CUT', sub: 'the harbor lights just went out', fog: 0x10141c, far: 46, light: 0.28 },
  skyline: { kind: 'storm', name: 'THUNDERSTORM', sub: 'rain and lightning over the rooftops', fog: 0x232a40, far: 38, light: 0.6, lightning: true },
  oldtown: { kind: 'airdrop', name: 'SUPPLY CRATE', sub: 'a crate is dropping in the middle, first to reach it gets it' },
};
export const EVENT_LEN = 45;
const FADE = 4;

let base = null, cur = 0, target = 0, def = null, sky = null, flashT = 0;
const _c = new THREE.Color();

/** Remember the map's normal look (call after the world is built). */
function capture() {
  const s = game.scene;
  if (!s?.fog) return null;
  const lights = [];
  s.traverse((o) => { if (o.isDirectionalLight || o.isHemisphereLight) lights.push([o, o.intensity]); if (o.isMesh && o.geometry?.parameters?.radius === 200) sky = o; });
  return { near: s.fog.near, far: s.fog.far, color: s.fog.color.clone(), bg: s.background, lights, env: s.environmentIntensity };
}

/** Turn the event's look on or off (fades over a few seconds). */
export function setEventVisual(mapId, on) {
  const d = MAP_EVENTS[mapId];
  if (!d || d.kind === 'airdrop') return;
  if (on && !base) base = capture();
  def = d; target = on ? 1 : 0;
}

/** Per frame: fade fog, light and how far bots can see. */
export function updateEventVisual(dt) {
  if (!base || !def) return;
  // thunderstorm: now and then a lightning flash lights everything up for a moment
  if (def.lightning && cur > 0.5) {
    if (flashT > 0) { flashT -= dt; if (flashT <= 0) for (const [l, i] of base.lights) l.intensity = i * def.light; }
    else if (Math.random() < dt * 0.18) { flashT = 0.12; for (const [l, i] of base.lights) l.intensity = i * 2.2; sfx('boom', { vol: 0.25 }); }
  }
  if (cur === target) return;
  cur = target > cur ? Math.min(target, cur + dt / FADE) : Math.max(target, cur - dt / FADE);
  const s = game.scene, k = cur * cur * (3 - 2 * cur);
  s.fog.far = base.far + (def.far - base.far) * k;
  s.fog.near = base.near + (Math.min(base.near, def.far * 0.15) - base.near) * k;
  s.fog.color.copy(base.color).lerp(_c.setHex(def.fog), k);
  for (const [l, i] of base.lights) l.intensity = i * (1 + (def.light - 1) * k);
  s.environmentIntensity = base.env * (1 + (def.light - 1) * k);
  // the sky dome ignores fog: swap it for the fog colour once the weather is thick
  if (sky) sky.visible = k < 0.5;
  s.background = k >= 0.5 ? s.fog.color : base.bg;
  game.visRange = k > 0.05 ? Math.max(def.far * 1.15, 80 - (80 - def.far * 1.15) * k) : null;
  if (cur === 0) { resetEventVisual(); }
}

/** Back to normal immediately (new match / map). */
export function resetEventVisual() {
  if (base) {
    const s = game.scene;
    if (s.fog) { s.fog.near = base.near; s.fog.far = base.far; s.fog.color.copy(base.color); }
    for (const [l, i] of base.lights) l.intensity = i;
    s.environmentIntensity = base.env;
    s.background = base.bg;
    if (sky) sky.visible = true;
  }
  base = null; def = null; sky = null; cur = 0; target = 0; game.visRange = null;
}
