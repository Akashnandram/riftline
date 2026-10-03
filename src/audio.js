// Sound engine: 3D HRTF positioning, wall occlusion, distance air-absorption, convolution reverb,
// layered synthesised weapons. Drop real recordings into assets/sfx/ (listed in manifest.json)
// and they replace the synth for that sound name automatically.
import { hasLOS } from './world.js';

let ctx = null, master = null, reverbIn = null, noise = null;
let muted = false;
const samples = {};
const L = { x: 0, y: 1.6, z: 0 };
const _a = { x: 0, y: 0, z: 0 }, _b = { x: 0, y: 0, z: 0 };

function impulse(seconds, decay) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // early reflections in the first 60ms, then a smooth tail
      const early = i < rate * 0.06 && Math.random() < 0.004 ? 2 : 0;
      d[i] = ((Math.random() * 2 - 1) + early) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4;
  comp.connect(ctx.destination);
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.6;
  master.connect(comp);
  const conv = ctx.createConvolver();
  conv.buffer = impulse(1.8, 3.2);
  const wet = ctx.createGain(); wet.gain.value = 0.5;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180;
  reverbIn = hp;
  hp.connect(conv); conv.connect(wet); wet.connect(master);
  const len = ctx.sampleRate * 2;
  noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  loadSamples();
}

async function loadSamples() {
  try {
    const list = await (await fetch('assets/sfx/manifest.json')).json();
    for (const [name, files] of Object.entries(list)) {
      samples[name] = [];
      for (const file of [].concat(files)) {
        const buf = await (await fetch('assets/sfx/' + file)).arrayBuffer();
        samples[name].push(await ctx.decodeAudioData(buf));
      }
    }
  } catch { /* no recordings shipped — synth only */ }
}

export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.6; }
export const isMuted = () => muted;

/** Call every frame with camera position + forward vector. */
export function updateListener(pos, fwd) {
  L.x = pos.x; L.y = pos.y; L.z = pos.z;
  if (!ctx) return;
  const l = ctx.listener;
  if (l.positionX) {
    const t = ctx.currentTime;
    l.positionX.setTargetAtTime(pos.x, t, 0.01); l.positionY.setTargetAtTime(pos.y, t, 0.01); l.positionZ.setTargetAtTime(pos.z, t, 0.01);
    l.forwardX.setTargetAtTime(fwd.x, t, 0.01); l.forwardY.setTargetAtTime(fwd.y, t, 0.01); l.forwardZ.setTargetAtTime(fwd.z, t, 0.01);
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  } else {
    l.setPosition(pos.x, pos.y, pos.z);
    l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
  }
}

/**
 * Build the output chain for one sound. Returns the node to connect sources to.
 * pos = null → plays "in your head" (your own gun, UI).
 */
function voice(pos, vol, reverbAmt = 0.2) {
  const g = ctx.createGain();
  g.gain.value = vol;
  if (!pos) {
    g.connect(master);
    const s = ctx.createGain(); s.gain.value = reverbAmt; g.connect(s); s.connect(reverbIn);
    return g;
  }
  const dist = Math.hypot(pos.x - L.x, pos.y - L.y, pos.z - L.z);
  _a.x = L.x; _a.y = L.y; _a.z = L.z; _b.x = pos.x; _b.y = pos.y; _b.z = pos.z;
  const occluded = dist > 1.5 && !hasLOS(_a, _b, true);
  // air absorption + wall muffling
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.max(600, 18000 / (1 + dist / 18)) * (occluded ? 0.12 : 1);
  const p = ctx.createPanner();
  p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
  p.refDistance = 3; p.rolloffFactor = 1.1; p.maxDistance = 200;
  if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
  g.connect(lp); lp.connect(p); p.connect(master);
  if (occluded) g.gain.value = vol * 0.6;
  // distant / hidden sounds are mostly room
  const s = ctx.createGain();
  s.gain.value = reverbAmt * (0.6 + Math.min(1.5, dist / 20)) * (occluded ? 1.5 : 1) * vol;
  g.connect(s); s.connect(reverbIn);
  return g;
}

function noiseSrc(rate = 1) {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  s.playbackRate.value = rate * (0.9 + Math.random() * 0.2);
  return s;
}

function env(out, t, attack, peak, dur, curve = 'exp') {
  const e = ctx.createGain();
  e.gain.setValueAtTime(0.0001, t);
  e.gain.linearRampToValueAtTime(peak, t + attack);
  if (curve === 'exp') e.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  else e.gain.linearRampToValueAtTime(0, t + attack + dur);
  e.connect(out);
  return e;
}

/** Filtered noise burst. */
function hiss(out, t, { dur, freq, q = 0.7, type = 'bandpass', peak = 1, attack = 0.001, rate = 1, sweepTo = 0 }) {
  const src = noiseSrc(rate);
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  src.connect(f); f.connect(env(out, t, attack, peak, dur));
  src.start(t, Math.random() * 1.5, dur + attack + 0.05);
}

/** Pitched tone with optional slide. */
function osc(out, t, { freq, dur, type = 'sine', peak = 1, slide = 0, attack = 0.001 }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  o.connect(env(out, t, attack, peak, dur));
  o.start(t); o.stop(t + attack + dur + 0.05);
}

// weapon profiles: crack (supersonic snap), body (mid bark), thump (low punch), tail (outdoor echo), mech
const GUN = {
  p9:      { crack: 0.5, crackF: 4200, body: 0.9, bodyF: 1500, bodyD: 0.07, thump: 0.6, thumpF: 160, tail: 0.25, tailD: 0.35, mech: 0.25 },
  magnum:  { crack: 0.9, crackF: 3200, body: 1.2, bodyF: 900, bodyD: 0.14, thump: 1.1, thumpF: 110, tail: 0.5, tailD: 0.7, mech: 0.35 },
  hornet:  { crack: 0.4, crackF: 5000, body: 0.75, bodyF: 1900, bodyD: 0.05, thump: 0.45, thumpF: 180, tail: 0.2, tailD: 0.3, mech: 0.3 },
  raptor:  { crack: 0.8, crackF: 3600, body: 1.1, bodyF: 1150, bodyD: 0.09, thump: 0.9, thumpF: 120, tail: 0.4, tailD: 0.6, mech: 0.3 },
  longbow: { crack: 1.2, crackF: 2800, body: 1.4, bodyF: 700, bodyD: 0.2, thump: 1.4, thumpF: 85, tail: 0.7, tailD: 1.2, mech: 0.5 },
};

function gunshot(out, t, g, close) {
  hiss(out, t, { dur: 0.012, freq: g.crackF, type: 'highpass', peak: g.crack * (close ? 1 : 1.3) });
  hiss(out, t, { dur: g.bodyD, freq: g.bodyF, q: 0.9, peak: g.body, sweepTo: g.bodyF * 0.55 });
  osc(out, t, { freq: g.thumpF, dur: g.bodyD * 1.6, peak: g.thump * (close ? 1 : 0.6), slide: 0.35 });
  hiss(out, t + 0.01, { dur: g.tailD, freq: 700, type: 'lowpass', peak: g.tail, attack: 0.01, sweepTo: 250 });
  if (close) {
    // action cycling: tiny metallic clicks
    osc(out, t + 0.025, { freq: 2600, dur: 0.012, type: 'square', peak: g.mech * 0.25 });
    hiss(out, t + 0.04, { dur: 0.02, freq: 5200, q: 4, peak: g.mech * 0.4 });
  }
}

const STEP = {
  concrete: (o, t, v) => { hiss(o, t, { dur: 0.05, freq: 380, type: 'lowpass', peak: 0.7 * v }); hiss(o, t + 0.008, { dur: 0.025, freq: 3500, q: 1.5, peak: 0.18 * v }); },
  wood: (o, t, v) => { hiss(o, t, { dur: 0.08, freq: 260, q: 4, peak: 1.1 * v }); osc(o, t, { freq: 140, dur: 0.07, peak: 0.25 * v }); },
  metal: (o, t, v) => { hiss(o, t, { dur: 0.04, freq: 500, type: 'lowpass', peak: 0.6 * v }); osc(o, t, { freq: 920 + Math.random() * 80, dur: 0.18, type: 'triangle', peak: 0.07 * v }); osc(o, t, { freq: 1530, dur: 0.12, peak: 0.04 * v }); },
};

const IMPACT = {
  concrete: (o, t) => { hiss(o, t, { dur: 0.06, freq: 1800, q: 0.8, peak: 0.6 }); hiss(o, t + 0.01, { dur: 0.12, freq: 600, type: 'lowpass', peak: 0.25 }); },
  floor: (o, t) => IMPACT.concrete(o, t),
  wood: (o, t) => { hiss(o, t, { dur: 0.09, freq: 420, q: 3, peak: 0.9 }); osc(o, t, { freq: 220, dur: 0.06, peak: 0.25 }); },
  metal: (o, t) => { hiss(o, t, { dur: 0.03, freq: 4000, type: 'highpass', peak: 0.5 }); osc(o, t, { freq: 1700 + Math.random() * 600, dur: 0.35, type: 'triangle', peak: 0.12 }); osc(o, t, { freq: 3100 + Math.random() * 400, dur: 0.2, peak: 0.06 }); },
  energy: (o, t) => { osc(o, t, { freq: 1200, dur: 0.15, type: 'sawtooth', peak: 0.12, slide: 0.5 }); },
  flesh: (o, t) => { hiss(o, t, { dur: 0.06, freq: 900, type: 'lowpass', peak: 0.7 }); osc(o, t, { freq: 90, dur: 0.06, peak: 0.4 }); },
};

function playSample(name, out) {
  const list = samples[name];
  if (!list || !list.length) return false;
  const s = ctx.createBufferSource();
  s.buffer = list[Math.floor(Math.random() * list.length)];
  s.playbackRate.value = 0.95 + Math.random() * 0.1;
  s.connect(out); s.start();
  return true;
}

/**
 * Play a sound. opts: { pos (world point; omit for 2D), vol, surface }
 */
export function sfx(name, opts = {}) {
  if (!ctx || muted) return;
  const vol = opts.vol ?? 1;
  if (vol < 0.01) return;
  const pos = opts.pos || null;
  if (pos && Math.hypot(pos.x - L.x, pos.z - L.z) > 140) return;
  const t = ctx.currentTime;
  const reverb = GUN[name] ? 0.35 : 0.15;
  const out = voice(pos, vol, reverb);
  if (playSample(name, out)) return;
  switch (name) {
    case 'p9': case 'magnum': case 'hornet': case 'raptor': case 'longbow':
      gunshot(out, t, GUN[name], !pos); break;
    case 'step': (STEP[opts.surface] || STEP.concrete)(out, t, 1); break;
    case 'land': hiss(out, t, { dur: 0.1, freq: 300, type: 'lowpass', peak: 1 }); break;
    case 'impact': (IMPACT[opts.surface] || IMPACT.concrete)(out, t); break;
    case 'whizz':
      hiss(out, t, { dur: 0.09, freq: 5000, q: 2, peak: 0.8, sweepTo: 1800, attack: 0.01 });
      hiss(out, t, { dur: 0.01, freq: 6000, type: 'highpass', peak: 0.9 }); break;
    case 'hit': osc(out, t, { freq: 1500, dur: 0.05, type: 'square', peak: 0.12 }); IMPACT.flesh(out, t); break;
    case 'head': osc(out, t, { freq: 2300, dur: 0.14, peak: 0.25 }); osc(out, t, { freq: 3450, dur: 0.1, peak: 0.12 }); hiss(out, t, { dur: 0.04, freq: 3000, q: 3, peak: 0.4 }); break;
    case 'kill': osc(out, t, { freq: 660, dur: 0.12, type: 'triangle', peak: 0.25 }); osc(out, t + 0.07, { freq: 990, dur: 0.2, type: 'triangle', peak: 0.25 }); break;
    case 'hurt': IMPACT.flesh(out, t); hiss(out, t, { dur: 0.15, freq: 400, type: 'lowpass', peak: 0.5 }); break;
    case 'magout': osc(out, t, { freq: 700, dur: 0.03, type: 'square', peak: 0.12 }); hiss(out, t, { dur: 0.05, freq: 2500, q: 3, peak: 0.4 }); break;
    case 'magin': hiss(out, t, { dur: 0.04, freq: 1800, q: 2, peak: 0.6 }); osc(out, t + 0.02, { freq: 420, dur: 0.05, type: 'square', peak: 0.12 }); break;
    case 'bolt': hiss(out, t, { dur: 0.05, freq: 3200, q: 3, peak: 0.5 }); hiss(out, t + 0.09, { dur: 0.04, freq: 2200, q: 3, peak: 0.6 }); osc(out, t + 0.09, { freq: 900, dur: 0.03, type: 'square', peak: 0.1 }); break;
    case 'empty': osc(out, t, { freq: 1100, dur: 0.025, type: 'square', peak: 0.1 }); break;
    case 'equip': hiss(out, t, { dur: 0.08, freq: 2000, q: 1.5, peak: 0.35 }); osc(out, t + 0.05, { freq: 600, dur: 0.03, type: 'square', peak: 0.06 }); break;
    case 'shell': osc(out, t, { freq: 3800 + Math.random() * 900, dur: 0.06, type: 'triangle', peak: 0.04 }); osc(out, t + 0.07, { freq: 4200 + Math.random() * 600, dur: 0.04, type: 'triangle', peak: 0.025 }); break;
    case 'dash': hiss(out, t, { dur: 0.25, freq: 900, q: 1, peak: 0.6, sweepTo: 3000 }); break;
    case 'flash': osc(out, t, { freq: 3000, dur: 0.6, peak: 0.3, slide: 0.3 }); hiss(out, t, { dur: 0.3, freq: 4000, type: 'highpass', peak: 0.6 }); break;
    case 'boom': hiss(out, t, { dur: 0.8, freq: 500, type: 'lowpass', peak: 1.4, sweepTo: 120 }); osc(out, t, { freq: 80, dur: 0.6, peak: 0.9, slide: 0.4 }); hiss(out, t, { dur: 0.02, freq: 3000, type: 'highpass', peak: 0.8 }); break;
    case 'smoke': hiss(out, t, { dur: 1.2, freq: 700, q: 0.4, peak: 0.6, attack: 0.05, sweepTo: 300 }); break;
    case 'ability': osc(out, t, { freq: 520, dur: 0.15, peak: 0.2, slide: 1.8 }); hiss(out, t, { dur: 0.1, freq: 1500, q: 1, peak: 0.3 }); break;
    case 'ult': osc(out, t, { freq: 220, dur: 0.6, type: 'sawtooth', peak: 0.2, slide: 3 }); osc(out, t, { freq: 440, dur: 0.6, peak: 0.2, slide: 2 }); break;
    case 'beam': osc(out, t, { freq: 900, dur: 0.5, type: 'sawtooth', peak: 0.35, slide: 0.2 }); hiss(out, t, { dur: 0.4, freq: 2500, q: 1, peak: 0.6 }); osc(out, t, { freq: 70, dur: 0.4, peak: 0.7, slide: 0.5 }); break;
    case 'ping': osc(out, t, { freq: 1800, dur: 0.3, peak: 0.25, slide: 0.7 }); break;
    case 'buy': osc(out, t, { freq: 880, dur: 0.08, type: 'triangle', peak: 0.15 }); break;
    case 'round': osc(out, t, { freq: 440, dur: 0.3, type: 'triangle', peak: 0.25 }); osc(out, t + 0.18, { freq: 660, dur: 0.4, type: 'triangle', peak: 0.25 }); break;
    case 'lose': osc(out, t, { freq: 330, dur: 0.3, type: 'triangle', peak: 0.25 }); osc(out, t + 0.18, { freq: 220, dur: 0.5, type: 'triangle', peak: 0.25 }); break;
  }
}
