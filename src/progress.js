// Player profile: XP / levels, weapon-skin unlocks + loadout, daily challenges. Saved in localStorage.
import { WEAPONS } from './config.js';
import { SKINS, SKIN_BY_KEY } from './skins.js';

import { OUTFIT_SLOTS } from './outfits.js';

const KEY = 'riftline.profile';

export const XP = { kill: 100, headshot: 25, assist: 40, round: 150, win: 600, objective: 150, played: 200, tutorial: 500 };

const CATEGORY = { p9: 'secondary', wasp: 'secondary', magnum: 'secondary', hornet: 'close', warden: 'close',
  talon: 'rifle', raptor: 'rifle', wraith: 'rifle', sentry: 'heavy', hammer: 'heavy', longbow: 'heavy' };
export const categoryOf = (w) => CATEGORY[w] || 'rifle';

// Daily challenges: 3 a day (one free reroll). Weekly: 3 bigger ones, reset Monday 00:00 UTC.
// 'on' is the event that counts towards it (see bump()).
const TEMPLATES = [
  { id: 'kills', desc: 'Get 20 kills', goal: 20, xp: 400, on: 'kill' },
  { id: 'heads', desc: 'Get 6 headshot kills', goal: 6, xp: 400, on: 'head' },
  { id: 'rifle', desc: 'Get 10 kills with rifles', goal: 10, xp: 350, on: 'cat:rifle' },
  { id: 'close', desc: 'Get 8 kills with an SMG or shotgun', goal: 8, xp: 350, on: 'cat:close' },
  { id: 'side', desc: 'Get 5 kills with sidearms', goal: 5, xp: 350, on: 'cat:secondary' },
  { id: 'heavy', desc: 'Get 5 kills with a DMR, LMG or sniper', goal: 5, xp: 350, on: 'cat:heavy' },
  { id: 'win', desc: 'Win 2 matches', goal: 2, xp: 500, on: 'win' },
  { id: 'obj', desc: 'Capture 3 Rift Nodes (Uplink or Domination)', goal: 3, xp: 400, on: 'objective' },
  { id: 'gadget', desc: 'Get 2 kills with gadgets', goal: 2, xp: 400, on: 'gadget' },
  { id: 'long', desc: 'Get 5 kills from over 30 m away', goal: 5, xp: 400, on: 'long' },
  { id: 'streak', desc: 'Reach a 3-kill streak twice', goal: 2, xp: 400, on: 'streak3' },
  { id: 'assist', desc: 'Get 5 assists', goal: 5, xp: 350, on: 'assist' },
  { id: 'played', desc: 'Play 3 matches', goal: 3, xp: 300, on: 'played' },
  { id: 'dom', desc: 'Win a Domination match', goal: 1, xp: 450, on: 'win:dom' },
  { id: 'tdm', desc: 'Win a Team Deathmatch', goal: 1, xp: 450, on: 'win:tdm' },
];
const WEEKLY = [
  { id: 'w-kills', desc: 'Get 120 kills', goal: 120, xp: 2000, on: 'kill' },
  { id: 'w-heads', desc: 'Get 35 headshot kills', goal: 35, xp: 1800, on: 'head' },
  { id: 'w-win', desc: 'Win 8 matches', goal: 8, xp: 2200, on: 'win' },
  { id: 'w-obj', desc: 'Capture 15 Rift Nodes', goal: 15, xp: 1800, on: 'objective' },
  { id: 'w-gadget', desc: 'Get 10 kills with gadgets', goal: 10, xp: 1800, on: 'gadget' },
  { id: 'w-streak', desc: 'Reach a 5-kill streak 3 times', goal: 3, xp: 2000, on: 'streak5' },
  { id: 'w-long', desc: 'Get 25 kills from over 30 m away', goal: 25, xp: 1800, on: 'long' },
  { id: 'w-drop', desc: 'Grab 3 supply drops', goal: 3, xp: 1600, on: 'drop' },
  { id: 'w-played', desc: 'Play 12 matches', goal: 12, xp: 1500, on: 'played' },
];
const BY_ID = Object.fromEntries([...TEMPLATES, ...WEEKLY].map((c) => [c.id, c]));

const today = () => new Date().toISOString().slice(0, 10);
/** Monday (UTC) of this week, as YYYY-MM-DD. */
const thisWeek = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

function seeded(key) {
  let seed = [...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
}
const fresh = (c) => ({ ...c, prog: 0, done: false });
function pickList(pool, key) {
  // deterministic pick of 3 per day / week
  const rnd = seeded(key), left = [...pool], list = [];
  while (list.length < 3) list.push(fresh(left.splice(Math.floor(rnd() * left.length), 1)[0]));
  return list;
}
const dailyFor = (date) => ({ date, list: pickList(TEMPLATES, date), rerolled: false });
const weeklyFor = (week) => ({ week, list: pickList(WEEKLY, 'w' + week) });

/** Saved challenges keep their progress but take the current wording; retired ones are replaced. */
function refresh(set, pool) {
  set.list = set.list.map((c) => {
    if (BY_ID[c.id] && pool.includes(BY_ID[c.id])) return { ...BY_ID[c.id], prog: Math.min(c.prog || 0, BY_ID[c.id].goal), done: !!c.done };
    const spare = pool.filter((x) => !set.list.some((y) => y.id === x.id));
    return fresh(spare[Math.floor(Math.random() * spare.length)]);
  });
}

/** Make sure today's and this week's challenges are current. */
function rollover(p) {
  if (!p.daily || p.daily.date !== today()) p.daily = dailyFor(today()); else refresh(p.daily, TEMPLATES);
  if (!p.weekly || p.weekly.week !== thisWeek()) p.weekly = weeklyFor(thisWeek()); else refresh(p.weekly, WEEKLY);
}

/** Time until the next daily / weekly reset, e.g. "5h 12m" or "3d 4h". */
export function resetsIn(kind) {
  const n = new Date(), next = new Date(n);
  next.setUTCHours(24, 0, 0, 0);
  if (kind === 'weekly') next.setUTCDate(next.getUTCDate() + ((8 - next.getUTCDay()) % 7));
  const m = Math.max(0, Math.round((next - n) / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h` : `${h}h ${m % 60}m`;
}

/** Swap one unfinished daily challenge for another (once a day). */
export function rerollDaily(i) {
  rollover(profile);
  const c = profile.daily.list[i];
  if (!c || c.done || profile.daily.rerolled) return false;
  const spare = TEMPLATES.filter((x) => !profile.daily.list.some((y) => y.id === x.id));
  profile.daily.list[i] = fresh(spare[Math.floor(Math.random() * spare.length)]);
  profile.daily.rerolled = true;
  saveProfile();
  return true;
}

function load() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* ignore */ }
  p.xp ??= 0; p.equip ??= {}; p.totals ??= { matches: 0, wins: 0, kills: 0, headshots: 0 }; p.tutorialDone ??= false; p.outfits ??= {};
  rollover(p);
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
  rollover(profile);
  M = { mode, kills: 0, heads: 0, rounds: 0, objectives: 0, completed: [] };
}

let onDone = null;
/** Called with each challenge as it is completed (in-match popup). */
export const onChallengeDone = (fn) => { onDone = fn; };

function bump(event, n = 1) {
  if (!M || M.mode === 'range' || !n) return;
  for (const c of [...profile.daily.list, ...profile.weekly.list]) {
    if (c.done || c.on !== event) continue;
    c.prog = Math.min(c.goal, c.prog + n);
    if (c.prog >= c.goal) { c.done = true; M.completed.push(c); onDone?.(c); }
  }
  saveProfile();
}

export function trackKill(weapon, head, { dist = 0, gadget = false } = {}) {
  if (!M || M.mode === 'range') return;
  M.kills++; bump('kill');
  if (head) { M.heads++; bump('head'); }
  if (gadget) bump('gadget');
  else if (weapon && WEAPONS[weapon]) bump('cat:' + categoryOf(weapon));
  if (dist > 30) bump('long');
}
/** The player's kill streak just reached n. */
export function trackStreak(n) { if (n === 3) bump('streak3'); if (n === 5) bump('streak5'); }
export function trackDrop() { bump('drop'); }
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
  bump('assist', assists); bump('played');
  if (won) { lines.push(['Victory', XP.win]); bump('win'); bump('win:' + M.mode); }
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
