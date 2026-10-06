// Player profile: XP / levels, weapon-skin unlocks + loadout, daily challenges. Saved in localStorage.
import { WEAPONS } from './config.js';
import { SKINS, SKIN_BY_KEY } from './skins.js';

import { OUTFIT_SLOTS } from './outfits.js';

const KEY = 'riftline.profile';

export const XP = { kill: 100, headshot: 25, assist: 40, round: 150, win: 600, objective: 150, played: 200, tutorial: 500 };

const CATEGORY = { p9: 'secondary', wasp: 'secondary', magnum: 'secondary', hornet: 'close', warden: 'close',
  talon: 'rifle', raptor: 'rifle', wraith: 'rifle', sentry: 'heavy', hammer: 'heavy', longbow: 'heavy' };
export const categoryOf = (w) => CATEGORY[w] || 'rifle';

const TEMPLATES = [
  { id: 'kills', desc: 'Get 20 kills', goal: 20, xp: 400, on: 'kill' },
  { id: 'heads', desc: 'Get 6 headshot kills', goal: 6, xp: 400, on: 'head' },
  { id: 'rifle', desc: 'Get 10 kills with rifles', goal: 10, xp: 350, on: 'cat:rifle' },
  { id: 'close', desc: 'Get 8 kills with an SMG or shotgun', goal: 8, xp: 350, on: 'cat:close' },
  { id: 'side', desc: 'Get 5 kills with sidearms', goal: 5, xp: 350, on: 'cat:secondary' },
  { id: 'heavy', desc: 'Get 5 kills with a DMR, LMG or sniper', goal: 5, xp: 350, on: 'cat:heavy' },
  { id: 'win', desc: 'Win 2 matches', goal: 2, xp: 500, on: 'win' },
  { id: 'obj', desc: 'Capture the Rift Node 3 times', goal: 3, xp: 400, on: 'objective' },
  { id: 'rounds', desc: 'Win 8 rounds', goal: 8, xp: 400, on: 'round' },
];

const today = () => new Date().toISOString().slice(0, 10);

function dailyFor(date) {
  // deterministic pick of 3 challenges per calendar day
  let seed = [...date].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  const pool = [...TEMPLATES];
  const list = [];
  while (list.length < 3) list.push({ ...pool.splice(Math.floor(rnd() * pool.length), 1)[0], prog: 0, done: false });
  return { date, list };
}

function load() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* ignore */ }
  p.xp ??= 0; p.equip ??= {}; p.totals ??= { matches: 0, wins: 0, kills: 0, headshots: 0 }; p.tutorialDone ??= false; p.outfits ??= {};
  if (!p.daily || p.daily.date !== today()) p.daily = dailyFor(today());
  return p;
}
export const profile = load();
export function saveProfile() { try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* ignore */ } }

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------
export const xpForLevel = (lv) => 800 + 200 * (lv - 1);   // XP needed to go from lv to lv+1
export function levelInfo(xp = profile.xp) {
  let lv = 1, rest = xp;
  while (rest >= xpForLevel(lv)) { rest -= xpForLevel(lv); lv++; }
  return { level: lv, into: rest, need: xpForLevel(lv) };
}
export const unlockedSkins = (lv = levelInfo().level) => SKINS.filter((s) => s.level <= lv);
export const skinFor = (weapon) => {
  const k = profile.equip[weapon];
  return k && SKIN_BY_KEY[k] && SKIN_BY_KEY[k].level <= levelInfo().level ? k : 'default';
};
export function equip(weapon, skin) { profile.equip[weapon] = skin; saveProfile(); }

// ---------------------------------------------------------------------------
// Match tracking
// ---------------------------------------------------------------------------
let M = null;
export function startTracking(mode) {
  if (profile.daily.date !== today()) profile.daily = dailyFor(today());
  M = { mode, kills: 0, heads: 0, rounds: 0, objectives: 0, completed: [] };
}

function bump(event, n = 1) {
  for (const c of profile.daily.list) {
    if (c.done || c.on !== event) continue;
    c.prog = Math.min(c.goal, c.prog + n);
    if (c.prog >= c.goal) { c.done = true; M?.completed.push(c); }
  }
  saveProfile();
}

export function trackKill(weapon, head) {
  if (!M || M.mode === 'range') return;
  M.kills++; bump('kill');
  if (head) { M.heads++; bump('head'); }
  if (weapon && WEAPONS[weapon]) bump('cat:' + categoryOf(weapon));
}
export function trackRound() { if (M && M.mode !== 'range') { M.rounds++; bump('round'); } }
export function trackObjective() { if (M) { M.objectives++; bump('objective'); } }

/** End of match: award XP and return a summary for the results screen. */
export function finishMatch({ won, assists = 0 }) {
  if (!M || M.mode === 'range') return null;
  const before = levelInfo();
  const lines = [['Match played', XP.played]];
  if (M.kills) lines.push([`${M.kills} kill${M.kills > 1 ? 's' : ''}`, M.kills * XP.kill]);
  if (M.heads) lines.push([`${M.heads} headshot${M.heads > 1 ? 's' : ''}`, M.heads * XP.headshot]);
  if (assists) lines.push([`${assists} assist${assists > 1 ? 's' : ''}`, assists * XP.assist]);
  if (M.rounds) lines.push([`${M.rounds} round${M.rounds > 1 ? 's' : ''} won`, M.rounds * XP.round]);
  if (M.objectives) lines.push([`${M.objectives} node captures`, M.objectives * XP.objective]);
  if (won) { lines.push(['Victory', XP.win]); bump('win'); }
  for (const c of M.completed) lines.push([`Challenge: ${c.desc}`, c.xp]);
  const total = lines.reduce((s, l) => s + l[1], 0);
  profile.xp += total;
  profile.totals.matches++; if (won) profile.totals.wins++;
  profile.totals.kills += M.kills; profile.totals.headshots += M.heads;
  saveProfile();
  const after = levelInfo();
  const unlocks = SKINS.filter((s) => s.level > before.level && s.level <= after.level);
  M = null;
  return { lines, total, before, after, unlocks };
}

export function completeTutorial() {
  if (profile.tutorialDone) return 0;
  profile.tutorialDone = true;
  profile.xp += XP.tutorial;
  saveProfile();
  return XP.tutorial;
}

/** Saved outfit for an operative (only options the player has unlocked). */
export function outfitFor(agentKey) {
  const o = profile.outfits?.[agentKey] || {};
  const lv = levelInfo().level, out = {};
  for (const s of OUTFIT_SLOTS) { const id = o[s.key]; const opt = id && s.options.find((x) => x.id === id); if (opt && opt.lv <= lv && id !== 'def') out[s.key] = id; }
  return out;
}
export function setOutfit(agentKey, slot, id) {
  profile.outfits[agentKey] = { ...(profile.outfits[agentKey] || {}), [slot]: id };
  saveProfile();
}
