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
  // 'balanced' gives the audio thread a little more buffer, which avoids crackles when many sounds overlap
  const AC = window.AudioContext || window.webkitAudioContext;
  try { ctx = new AC({ latencyHint: 'balanced' }); } catch { ctx = new AC(); }
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4;
  comp.connect(ctx.destination);
  master = ctx.createGain();
  master.gain.value = muted ? 0 : volume;
  master.connect(comp);
  const conv = ctx.createConvolver();
  conv.buffer = impulse(1.3, 3.2);
  const wet = ctx.createGain(); wet.gain.value = 0.5;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180;
  reverbIn = hp;
  hp.connect(conv); conv.connect(wet); wet.connect(master);
  const len = ctx.sampleRate * 2;
  noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  loadSamples();
  prerenderGuns().catch(() => { /* falls back to live synthesis */ });
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

let volume = 0.6;
export function setVolume(v) { volume = v * 0.85; if (master) master.gain.value = muted ? 0 : volume; }
export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : volume; }
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
// ---- voice budget: too many simultaneous sounds overload the audio thread (crackles/dropouts) ----
const MAX_VOICES = 26;
let active = 0;
const PRIORITY = { step: 0, shell: 0, impact: 1, whizz: 1, land: 1, magout: 1, magin: 1, bolt: 1, equip: 1, pump: 1, beep: 2 };

/**
 * Build the output chain for one sound. Returns the node to connect sources to, or null if the
 * sound isn't worth playing (too quiet / over budget). pos = null → plays "in your head".
 */
function voice(pos, vol, reverbAmt, important) {
  const g = ctx.createGain();
  g.gain.value = vol;
  const chain = [g];
  if (!pos) {
    g.connect(master);
    const s = ctx.createGain(); s.gain.value = reverbAmt; g.connect(s); s.connect(reverbIn);
    chain.push(s);
    g._chain = chain;
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
  // HRTF is the expensive part: only nearby important sounds get it
  p.panningModel = important && dist < 14 ? 'HRTF' : 'equalpower';
  p.distanceModel = 'inverse';
  p.refDistance = 3; p.rolloffFactor = 1.1; p.maxDistance = 200;
  if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
  g.connect(lp); lp.connect(p); p.connect(master);
  if (occluded) g.gain.value = vol * 0.6;
  // distant / hidden sounds are mostly room
  const s = ctx.createGain();
  s.gain.value = reverbAmt * (0.6 + Math.min(1.5, dist / 20)) * (occluded ? 1.5 : 1) * vol;
  g.connect(s); s.connect(reverbIn);
  chain.push(lp, p, s);
  g._chain = chain;
  return g;
}

/** Disconnect a finished sound's nodes so the audio graph doesn't keep growing. */
function release(out, seconds) {
  active++;
  setTimeout(() => {
    active--;
    for (const n of out._chain) { try { n.disconnect(); } catch { /* already gone */ } }
  }, seconds * 1000);
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
  wasp:    { crack: 0.35, crackF: 4800, body: 0.7, bodyF: 2100, bodyD: 0.05, thump: 0.4, thumpF: 190, tail: 0.18, tailD: 0.28, mech: 0.3 },
  warden:  { crack: 0.9, crackF: 2400, body: 1.5, bodyF: 600, bodyD: 0.22, thump: 1.5, thumpF: 75, tail: 0.75, tailD: 1.0, mech: 0.2 },
  talon:   { crack: 0.7, crackF: 3800, body: 1.0, bodyF: 1250, bodyD: 0.08, thump: 0.8, thumpF: 125, tail: 0.35, tailD: 0.5, mech: 0.3 },
  sentry:  { crack: 1.0, crackF: 3100, body: 1.2, bodyF: 950, bodyD: 0.13, thump: 1.1, thumpF: 100, tail: 0.55, tailD: 0.85, mech: 0.35 },
  wraith:  { crack: 0.15, crackF: 2600, body: 0.55, bodyF: 520, bodyD: 0.07, thump: 0.5, thumpF: 140, tail: 0.08, tailD: 0.2, mech: 0.55, quiet: true },
  hammer:  { crack: 0.85, crackF: 3300, body: 1.15, bodyF: 1000, bodyD: 0.1, thump: 1.0, thumpF: 105, tail: 0.45, tailD: 0.7, mech: 0.25 },
};

/**
 * One gunshot, layered: transient click, supersonic crack (tamed, no harsh fizz), mid "bark",
 * low thump + sub punch (close only), and an outdoor tail. kind: 'close' (your gun), 'mid', 'far'.
 */
function gunshot(out, t, g, kind) {
  const close = kind === 'close', far = kind === 'far';
  const tame = ctx.createBiquadFilter(); tame.type = 'lowpass'; tame.frequency.value = close ? 9000 : far ? 2600 : 6500; tame.Q.value = 0.5;
  tame.connect(out);
  if (!far) {
    hiss(tame, t, { dur: 0.006, freq: 1800, q: 0.6, peak: g.crack * 0.9 });                                 // click
    hiss(tame, t, { dur: 0.014, freq: g.crackF, type: 'highpass', peak: g.crack * (close ? 0.55 : 0.75) });   // crack
  }
  hiss(tame, t, { dur: g.bodyD, freq: far ? g.bodyF * 0.6 : g.bodyF, q: 0.9, peak: g.body * (far ? 0.9 : 1), sweepTo: g.bodyF * 0.5 });
  osc(tame, t, { freq: g.thumpF, dur: g.bodyD * 1.7, peak: g.thump * (close ? 1.15 : far ? 0.35 : 0.7), slide: 0.35 });
  if (close) {
    osc(tame, t, { freq: 55, dur: 0.09, peak: g.thump * 0.6, slide: 0.6 });                                  // sub punch
    osc(tame, t + 0.025, { freq: 2600, dur: 0.012, type: 'square', peak: g.mech * 0.18 });                 // action
    hiss(tame, t + 0.04, { dur: 0.02, freq: 5200, q: 4, peak: g.mech * 0.3 });
  }
  hiss(tame, t + 0.01, { dur: g.tailD * (far ? 1.3 : 1), freq: far ? 500 : 700, type: 'lowpass', peak: g.tail * (far ? 1.3 : close ? 0.9 : 1.1), attack: 0.012, sweepTo: 220 });
}

// ---- pre-rendered gunshots: each gun is rendered once (3 variations × close/mid/far) when the
// game loads, so a shot is a single buffer playback instead of ~6 live sound generators ----
const bank = {};
const VARIANTS = 3;
async function prerenderGuns() {
  const sr = ctx.sampleRate;
  for (const [name, g] of Object.entries(GUN)) {
    bank[name] = { close: [], mid: [], far: [] };
    for (const kind of ['close', 'mid', 'far']) {
      for (let v = 0; v < VARIANTS; v++) {
        const len = Math.ceil((g.tailD * 1.3 + 0.35) * sr);
        const off = new OfflineAudioContext(1, len, sr);
        const real = ctx;
        ctx = off;                       // the synth helpers build their graph on the offline context
        try { gunshot(off.destination, 0, g, kind); } finally { ctx = real; }
        const buf = await off.startRendering();
        // keep relative loudness, only prevent clipping
        const d = buf.getChannelData(0);
        let peak = 0; for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
        if (peak > 0.95) { const k = 0.95 / peak; for (let i = 0; i < d.length; i++) d[i] *= k; }
        bank[name][kind].push(buf);
      }
    }
    await new Promise((r) => setTimeout(r, 0));   // stay responsive while rendering
  }
}

/** How many pre-rendered gunshot clips are ready (for diagnostics). */
export const gunBankSize = () => Object.values(bank).reduce((n, b) => n + b.close.length + b.mid.length + b.far.length, 0);

function playGun(name, out, kind) {
  const list = bank[name]?.[kind];
  if (!list || list.length < VARIANTS) return false;
  const s = ctx.createBufferSource();
  s.buffer = list[Math.floor(Math.random() * list.length)];
  s.playbackRate.value = 0.96 + Math.random() * 0.08;
  s.connect(out);
  s.start();
  return true;
}

const STEP = {
  concrete: (o, t, v) => { hiss(o, t, { dur: 0.05, freq: 380, type: 'lowpass', peak: 0.7 * v }); hiss(o, t + 0.008, { dur: 0.025, freq: 3500, q: 1.5, peak: 0.18 * v }); },
  wood: (o, t, v) => { hiss(o, t, { dur: 0.08, freq: 260, q: 4, peak: 1.1 * v }); osc(o, t, { freq: 140, dur: 0.07, peak: 0.25 * v }); },
  metal: (o, t, v) => { hiss(o, t, { dur: 0.04, freq: 500, type: 'lowpass', peak: 0.6 * v }); osc(o, t, { freq: 920 + Math.random() * 80, dur: 0.18, type: 'triangle', peak: 0.07 * v }); osc(o, t, { freq: 1530, dur: 0.12, peak: 0.04 * v }); },
  // soft, shifting sand: a muffled push and a dry trickle
  sand: (o, t, v) => { hiss(o, t, { dur: 0.09, freq: 520, type: 'lowpass', peak: 0.55 * v, attack: 0.01 }); hiss(o, t + 0.02, { dur: 0.08, freq: 2600, q: 0.8, peak: 0.12 * v }); },
  // packed snow: a short crunch made of a few grainy clicks
  snow: (o, t, v) => { for (let i = 0; i < 3; i++) hiss(o, t + i * 0.018, { dur: 0.03, freq: 1300 + i * 400, q: 2.5, peak: (0.35 - i * 0.08) * v }); hiss(o, t, { dur: 0.07, freq: 300, type: 'lowpass', peak: 0.4 * v }); },
  // grass / leaf litter: a light swish
  grass: (o, t, v) => { hiss(o, t, { dur: 0.11, freq: 3200, q: 0.6, peak: 0.2 * v, attack: 0.015 }); hiss(o, t, { dur: 0.05, freq: 260, type: 'lowpass', peak: 0.45 * v }); },
};
STEP.floor = STEP.concrete;

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
  const own = !pos;
  const pri = own ? 3 : PRIORITY[name] ?? 2;
  let dist = 0;
  if (pos) {
    dist = Math.hypot(pos.x - L.x, pos.y - L.y, pos.z - L.z);
    // skip sounds that would be inaudible anyway (inverse distance falloff, ref 3 m)
    if (vol * 3 / (3 + 1.1 * Math.max(0, dist - 3)) < (pri === 0 ? 0.08 : 0.025)) return;
  }
  // over budget: drop the least important sounds first; your own sounds always play
  if (active >= MAX_VOICES && pri < 2) return;
  if (active >= MAX_VOICES + 10 && pri < 3) return;
  const t = ctx.currentTime;
  const reverb = GUN[name] ? (GUN[name].quiet ? 0.12 : 0.35) : 0.15;
  const out = voice(pos, vol, reverb, pri >= 2);
  release(out, GUN[name] ? 2.2 : name === 'boom' || name === 'smoke' ? 2 : 1.2);
  if (playSample(name, out)) return;
  switch (name) {
    case 'p9': case 'magnum': case 'hornet': case 'raptor': case 'longbow':
    case 'wasp': case 'warden': case 'talon': case 'sentry': case 'wraith': case 'hammer':
      {
        const kind = !pos ? 'close' : dist > 22 ? 'far' : 'mid';
        if (!playGun(name, out, kind)) gunshot(out, t, GUN[name], kind);
      }
      break;
    case 'step': (STEP[opts.surface] || STEP.concrete)(out, t, 1); break;
    case 'land': hiss(out, t, { dur: 0.1, freq: 300, type: 'lowpass', peak: 1 }); break;
    case 'streak': for (let i = 0; i < 4; i++) osc(out, t + i * 0.07, { freq: 520 * Math.pow(1.26, i), dur: 0.16, type: 'triangle', peak: 0.22 }); break;
    case 'nodeLost': osc(out, t, { freq: 620, dur: 0.22, type: 'triangle', peak: 0.25, slide: 0.7 }); osc(out, t + 0.16, { freq: 410, dur: 0.3, type: 'triangle', peak: 0.22, slide: 0.8 }); break;
    case 'nodeMove': for (let i = 0; i < 3; i++) osc(out, t + i * 0.16, { freq: 1180, dur: 0.08, type: 'square', peak: 0.08 }); break;
    case 'medal': osc(out, t, { freq: 1320, dur: 0.06, type: 'triangle', peak: 0.12 }); break;
    case 'capture': osc(out, t, { freq: 520, dur: 0.18, peak: 0.5, slide: 1.5 }); osc(out, t + 0.12, { freq: 780, dur: 0.25, peak: 0.45, slide: 1.3 }); break;
    case 'slide': hiss(out, t, { dur: 0.6, freq: 700, type: 'lowpass', peak: 0.7, sweepTo: 250 }); break;
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
    case 'pump': hiss(out, t, { dur: 0.06, freq: 1400, q: 2, peak: 0.7 }); osc(out, t + 0.01, { freq: 300, dur: 0.05, type: 'square', peak: 0.12 }); hiss(out, t + 0.16, { dur: 0.06, freq: 1900, q: 2, peak: 0.8 }); osc(out, t + 0.17, { freq: 420, dur: 0.05, type: 'square', peak: 0.12 }); break;
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
    case 'beep': osc(out, t, { freq: 1950, dur: 0.07, type: 'square', peak: 0.12 }); osc(out, t, { freq: 3900, dur: 0.05, peak: 0.05 }); break;
    case 'plantStart': for (let i = 0; i < 4; i++) osc(out, t + i * 0.18, { freq: 900 + i * 220, dur: 0.06, type: 'square', peak: 0.09 }); break;
    case 'defuseStart': hiss(out, t, { dur: 0.25, freq: 3000, q: 3, peak: 0.4 }); osc(out, t + 0.1, { freq: 600, dur: 0.1, type: 'square', peak: 0.08 }); break;
    case 'planted': osc(out, t, { freq: 440, dur: 0.25, type: 'sawtooth', peak: 0.2 }); osc(out, t + 0.25, { freq: 660, dur: 0.35, type: 'sawtooth', peak: 0.2 }); hiss(out, t, { dur: 0.6, freq: 900, q: 0.6, peak: 0.4, sweepTo: 3000 }); break;
    case 'defused': osc(out, t, { freq: 880, dur: 0.6, peak: 0.2, slide: 0.25 }); hiss(out, t, { dur: 0.4, freq: 2000, q: 1, peak: 0.3, sweepTo: 300 }); break;
    case 'buy': osc(out, t, { freq: 880, dur: 0.08, type: 'triangle', peak: 0.15 }); break;
    case 'round': osc(out, t, { freq: 440, dur: 0.3, type: 'triangle', peak: 0.25 }); osc(out, t + 0.18, { freq: 660, dur: 0.4, type: 'triangle', peak: 0.25 }); break;
    case 'lose': osc(out, t, { freq: 330, dur: 0.3, type: 'triangle', peak: 0.25 }); osc(out, t + 0.18, { freq: 220, dur: 0.5, type: 'triangle', peak: 0.25 }); break;
  }
}

// ---------------------------------------------------------------------------
// Music: an 8-bar loop (Am – F – C – G, 104 bpm) rendered once offline from synth parts —
// pad, bass, arpeggio and drums — then looped. Plays in the menus (and quietly in matches if
// the player turns that on).
// ---------------------------------------------------------------------------
let musicBuf = null, musicSrc = null, musicGain = null, musicLevel = 0.5, musicWant = 0, musicRendering = false;
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

async function renderMusic() {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return null;
  const bpm = 104, beat = 60 / bpm, bar = beat * 4, bars = 8, rate = 32000;
  const oc = new OAC(2, Math.ceil(bar * bars * rate), rate);
  const out = oc.createDynamicsCompressor(); out.threshold.value = -18; out.ratio.value = 3; out.connect(oc.destination);
  const nbuf = oc.createBuffer(1, rate, rate); const nd = nbuf.getChannelData(0); for (let i = 0; i < rate; i++) nd[i] = Math.random() * 2 - 1;
  const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];       // Am F C G
  const tone = (type, f, t0, dur, peak, dest, attack = 0.005, release = 0.08) => {
    const o = oc.createOscillator(), g = oc.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.setValueAtTime(peak, Math.max(t0 + attack, t0 + dur - release)); g.gain.linearRampToValueAtTime(0, t0 + dur);
    o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.02);
  };
  const noiseHit = (t0, dur, peak, type, freq, dest) => {
    const s = oc.createBufferSource(); s.buffer = nbuf;
    const f = oc.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = oc.createGain(); g.gain.setValueAtTime(peak, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t0); s.stop(t0 + dur + 0.02);
  };
  const padBus = oc.createBiquadFilter(); padBus.type = 'lowpass'; padBus.frequency.value = 1400; padBus.connect(out);
  const arpBus = oc.createBiquadFilter(); arpBus.type = 'lowpass'; arpBus.frequency.value = 2600; arpBus.connect(out);
  for (let b = 0; b < bars; b++) {
    const t0 = b * bar, ch = chords[b % 4];
    // pad: detuned saws, slow swell
    for (const n of ch) for (const det of [-6, 6]) { const o = NOTE(n) * Math.pow(2, det / 1200); tone('sawtooth', o, t0, bar, 0.035, padBus, 0.35, 0.4); }
    // bass: driving eighths on the root
    for (let i = 0; i < 8; i++) tone('triangle', NOTE(ch[0] - 24), t0 + i * beat / 2, beat / 2 * 0.9, i % 2 ? 0.16 : 0.22, out, 0.004, 0.05);
    // arpeggio from bar 3 on: sixteenths over the chord, up an octave
    if (b >= 2) for (let i = 0; i < 16; i++) tone('square', NOTE(ch[i % 3] + 12 + (i % 8 > 5 ? 12 : 0)), t0 + i * beat / 4, beat / 4 * 0.6, 0.03, arpBus, 0.002, 0.04);
    // drums: kick on every beat, snare on 2 & 4, off-beat hats
    for (let i = 0; i < 4; i++) {
      const tk = t0 + i * beat;
      const k = oc.createOscillator(), kg = oc.createGain();
      k.frequency.setValueAtTime(120, tk); k.frequency.exponentialRampToValueAtTime(42, tk + 0.18);
      kg.gain.setValueAtTime(0.55, tk); kg.gain.exponentialRampToValueAtTime(0.001, tk + 0.25);
      k.connect(kg); kg.connect(out); k.start(tk); k.stop(tk + 0.3);
      if (i % 2) { noiseHit(tk, 0.16, 0.22, 'bandpass', 1800, out); tone('triangle', 190, tk, 0.08, 0.12, out, 0.001, 0.05); }
      noiseHit(tk + beat / 2, 0.05, 0.07, 'highpass', 7000, out);
    }
  }
  return oc.startRendering();
}

/** Music volume (0..1) from settings. */
export function setMusicVolume(v) { musicLevel = v; applyMusic(); }

/** Fade the music in (1), down to a quiet bed (0.3) or out (0). */
export async function music(level) {
  musicWant = level;
  if (!ctx) return;
  if (!musicBuf && !musicRendering) {
    musicRendering = true;
    try { musicBuf = await renderMusic(); } catch { musicBuf = null; }
    musicRendering = false;
  }
  if (!musicBuf) return;
  if (!musicSrc) {
    musicGain = ctx.createGain(); musicGain.gain.value = 0;
    musicGain.connect(master);
    musicSrc = ctx.createBufferSource(); musicSrc.buffer = musicBuf; musicSrc.loop = true;
    musicSrc.connect(musicGain); musicSrc.start();
  }
  applyMusic();
}
function applyMusic() {
  if (!musicGain) return;
  musicGain.gain.setTargetAtTime(musicWant * musicLevel * 0.55, ctx.currentTime, 0.6);
}

// ---------------------------------------------------------------------------
// Announcer: short spoken lines through the browser's built-in speech voice
// ---------------------------------------------------------------------------
let lastLine = 0, announcerOn = true;
export function setAnnouncer(on) { announcerOn = on; }
export function announce(text, important = false) {
  if (!announcerOn || muted || !('speechSynthesis' in window)) return;
  const t = performance.now();
  if (!important && t - lastLine < 1400) return;
  lastLine = t;
  try {
    if (important) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.12; u.pitch = 0.85; u.volume = Math.min(1, volume * 1.2);
    const v = speechSynthesis.getVoices().find((x) => /en[-_](US|GB)/i.test(x.lang) && /male|daniel|david|alex|google uk english male/i.test(x.name)) || speechSynthesis.getVoices().find((x) => /^en/i.test(x.lang));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch { /* speech not available */ }
}
/** Debug/info: duration of the rendered music loop in seconds (0 until ready). */
export function musicInfo() {
  if (!musicBuf) return null;
  const d = musicBuf.getChannelData(0); let peak = 0;
  for (let i = 0; i < d.length; i += 7) peak = Math.max(peak, Math.abs(d[i]));
  return { seconds: musicBuf.duration, peak };
}
