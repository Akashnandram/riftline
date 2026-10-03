// Synthesised sounds (Web Audio) — no asset files.
let ctx = null, master = null, noise = null;
let muted = false;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  const len = ctx.sampleRate;
  noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
}

export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.5; }
export const isMuted = () => muted;

function out(vol, pan) {
  const g = ctx.createGain();
  g.gain.value = vol;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p); p.connect(master);
  } else g.connect(master);
  return g;
}

function burst(vol, pan, dur, freq, q = 0.8, type = 'lowpass') {
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = out(vol, pan);
  const env = ctx.createGain();
  env.gain.setValueAtTime(1, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(env); env.connect(g);
  src.start(t, Math.random() * 0.5, dur + 0.05);
}

function tone(vol, pan, freq, dur, type = 'sine', slide = 0) {
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(vol, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(env); env.connect(out(1, pan));
  o.start(t); o.stop(t + dur + 0.02);
}

const SHOT = {
  p9: [0.5, 0.12, 2600], magnum: [0.8, 0.25, 1600], hornet: [0.4, 0.09, 3200],
  raptor: [0.65, 0.16, 1900], longbow: [1, 0.45, 1100],
};

export function sfx(name, vol = 1, pan = 0) {
  if (!ctx || muted || vol < 0.02) return;
  switch (name) {
    case 'p9': case 'magnum': case 'hornet': case 'raptor': case 'longbow': {
      const [v, d, f] = SHOT[name];
      burst(v * vol, pan, d, f);
      tone(0.25 * v * vol, pan, 140, d * 0.8, 'triangle', 0.4);
      break;
    }
    case 'hit': tone(0.18 * vol, 0, 1400, 0.06, 'square'); break;
    case 'head': tone(0.25 * vol, 0, 2200, 0.12, 'sine'); tone(0.15 * vol, 0, 3300, 0.1, 'sine'); break;
    case 'kill': tone(0.25 * vol, 0, 660, 0.12, 'triangle'); setTimeout(() => tone(0.25 * vol, 0, 990, 0.18, 'triangle'), 70); break;
    case 'hurt': burst(0.4 * vol, pan, 0.12, 500); break;
    case 'reload': tone(0.12 * vol, pan, 380, 0.05, 'square'); setTimeout(() => tone(0.12 * vol, pan, 520, 0.05, 'square'), 140); break;
    case 'empty': tone(0.1 * vol, pan, 900, 0.03, 'square'); break;
    case 'dash': burst(0.35 * vol, pan, 0.25, 900, 1, 'bandpass'); break;
    case 'flash': tone(0.4 * vol, pan, 3000, 0.6, 'sine', 0.3); burst(0.4 * vol, pan, 0.3, 4000, 0.5, 'highpass'); break;
    case 'boom': burst(0.9 * vol, pan, 0.6, 600); tone(0.5 * vol, pan, 90, 0.5, 'sine', 0.5); break;
    case 'smoke': burst(0.35 * vol, pan, 0.8, 700, 0.5); break;
    case 'ability': tone(0.2 * vol, pan, 520, 0.15, 'sine', 1.8); break;
    case 'ult': tone(0.3 * vol, 0, 220, 0.6, 'sawtooth', 3); tone(0.2 * vol, 0, 440, 0.6, 'sine', 2); break;
    case 'beam': tone(0.45 * vol, pan, 900, 0.5, 'sawtooth', 0.2); burst(0.5 * vol, pan, 0.4, 2500, 1, 'bandpass'); break;
    case 'ping': tone(0.2 * vol, pan, 1800, 0.25, 'sine', 0.7); break;
    case 'buy': tone(0.15 * vol, 0, 880, 0.08, 'triangle'); break;
    case 'round': tone(0.25 * vol, 0, 440, 0.3, 'triangle'); setTimeout(() => tone(0.25 * vol, 0, 660, 0.4, 'triangle'), 180); break;
    case 'lose': tone(0.25 * vol, 0, 330, 0.3, 'triangle'); setTimeout(() => tone(0.25 * vol, 0, 220, 0.5, 'triangle'), 180); break;
    case 'step': burst(0.06 * vol, pan, 0.05, 400); break;
  }
}
