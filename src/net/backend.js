// Accounts, friends, presence and invites. Uses Supabase when configured (src/net/config.js),
// otherwise a local guest identity + BroadcastChannel so everything can be tested in two tabs.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { LocalChannel, SupabaseChannel } from './signal.js';
import { profile as localProfile, saveProfile, thisWeek } from '../progress.js';

export const configured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
let sb = null;

/** Current identity: { id, username, guest } — username may be null until chosen. */
export const me = { id: null, username: null, guest: true, email: null };
const listeners = new Set();
export const onAuthChange = (fn) => listeners.add(fn);
const emit = () => { for (const fn of listeners) fn(me); };

function guestIdentity() {
  let g;
  try { g = JSON.parse(localStorage.getItem('riftline.guest') || 'null'); } catch { g = null; }
  if (!g) g = { id: 'g_' + Math.random().toString(36).slice(2, 10), username: null };
  // tabs of the same browser need distinct ids to play each other in local test mode
  const tabId = sessionStorage.getItem('riftline.tab') || (sessionStorage.setItem('riftline.tab', Math.random().toString(36).slice(2, 6)), sessionStorage.getItem('riftline.tab'));
  return { ...g, id: configured ? g.id : g.id + '_' + tabId };
}
function saveGuest() {
  try { localStorage.setItem('riftline.guest', JSON.stringify({ id: me.id.replace(/_[a-z0-9]{4}$/, ''), username: me.username })); } catch { /* ignore */ }
}

export async function initBackend() {
  if (configured) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, detectSessionInUrl: true } });
    sb.auth.onAuthStateChange((_e, session) => { applySession(session); });
    const { data } = await sb.auth.getSession();
    await applySession(data.session);
  } else {
    Object.assign(me, guestIdentity(), { guest: true });
    emit();
  }
  return me;
}

async function applySession(session) {
  if (!session) {
    Object.assign(me, guestIdentity(), { guest: true, email: null });
    emit();
    return;
  }
  me.id = session.user.id; me.guest = false; me.email = session.user.email;
  const { data } = await sb.from('profiles').select('*').eq('id', me.id).maybeSingle();
  me.username = data?.username || null;
  if (data) mergeProgress(data);
  emit();
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
const need = () => { if (!sb) throw new Error('Online accounts are not set up yet (add your Supabase keys in src/net/config.js).'); };
export async function signUp(email, password) {
  need();
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
  if (error) throw error;
  return data.session ? 'signed-in' : 'check-email';
}
export async function signIn(email, password) {
  need();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export async function signInGoogle() {
  need();
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
  if (error) throw error;
}
export async function signOut() { if (sb) await sb.auth.signOut(); else { Object.assign(me, guestIdentity(), { guest: true }); emit(); } }

export async function setUsername(name) {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('3–16 letters, numbers or _');
  if (me.guest) { me.username = name; saveGuest(); emit(); return; }
  const row = { id: me.id, username: name, xp: localProfile.xp, equip: localProfile.equip, tutorial_done: localProfile.tutorialDone };
  const { error } = await sb.from('profiles').upsert(row);
  if (error) throw new Error(error.code === '23505' ? 'That username is taken' : error.message);
  me.username = name; emit();
}

// ---------------------------------------------------------------------------
// Progress sync (XP, skins, tutorial) — keeps the best of local and cloud
// ---------------------------------------------------------------------------
function mergeProgress(row) {
  let changed = false;
  if (row.xp > localProfile.xp) { localProfile.xp = row.xp; changed = true; }
  for (const [w, s] of Object.entries(row.equip || {})) if (!localProfile.equip[w]) { localProfile.equip[w] = s; changed = true; }
  if (row.tutorial_done && !localProfile.tutorialDone) { localProfile.tutorialDone = true; changed = true; }
  if (changed) saveProfile();
}
// leaderboard columns (kills, wins, matches, week, week_xp) exist once supabase/schema.sql has been re-run
let statsColumns = true;
export async function pushProgress() {
  if (!sb || me.guest || !me.username) return;
  const base = { xp: localProfile.xp, equip: localProfile.equip, tutorial_done: localProfile.tutorialDone, updated_at: new Date().toISOString() };
  if (statsColumns) {
    const T = localProfile.totals, wk = localProfile.week?.key === thisWeek() ? localProfile.week.xp : 0;
    const { error } = await sb.from('profiles').update({ ...base, kills: T.kills, wins: T.wins, matches: T.matches, week: thisWeek(), week_xp: wk }).eq('id', me.id);
    if (!error) return;
    statsColumns = false;          // older database: keep syncing XP at least
  }
  await sb.from('profiles').update(base).eq('id', me.id);
}
// sync after every match (debounced)
let pushT = 0;
addEventListener('riftline:progress', () => { clearTimeout(pushT); pushT = setTimeout(() => pushProgress().catch(() => {}), 1500); });

/**
 * Leaderboard rows for kind = 'xp' | 'week' | 'kills' | 'wins', everyone or friends only.
 * Returns { rows: [{ id, username, xp, value }], me: { rank, value } | null, needsUpdate?, offline? }.
 */
export async function leaderboard(kind, friendsOnly = false) {
  if (!sb) return { rows: [], offline: true };
  const col = { xp: 'xp', week: 'week_xp', kills: 'kills', wins: 'wins' }[kind] || 'xp';
  let ids = null;
  if (friendsOnly) {
    if (me.guest) return { rows: [], needsAccount: true };
    ids = [me.id, ...(await listFriends()).filter((f) => f.status === 'friend').map((f) => f.id)];
  }
  const run = (q) => { if (kind === 'week') q = q.eq('week', thisWeek()); if (ids) q = q.in('id', ids); return q; };
  const { data, error } = await run(sb.from('profiles').select(`id, username, xp${col === 'xp' ? '' : ', ' + col}`)).order(col, { ascending: false }).limit(50);
  if (error) return { rows: [], needsUpdate: col !== 'xp' };
  const rows = data.map((r) => ({ id: r.id, username: r.username, xp: r.xp, value: r[col] }));
  let mine = null;
  if (!me.guest) {
    const i = rows.findIndex((r) => r.id === me.id);
    if (i >= 0) mine = { rank: i + 1, value: rows[i].value };
    else {
      const value = col === 'xp' ? localProfile.xp : col === 'week_xp' ? (localProfile.week?.key === thisWeek() ? localProfile.week.xp : 0) : localProfile.totals[col];
      const { count } = await run(sb.from('profiles').select('id', { count: 'exact', head: true })).gt(col, value);
      mine = { rank: (count ?? 0) + 1, value };
    }
  }
  return { rows, me: mine };
}

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------
export async function listFriends() {
  if (!sb || me.guest) return [];
  const { data, error } = await sb.from('friendships').select('id, requester, addressee, status');
  if (error) throw error;
  const ids = [...new Set(data.flatMap((r) => [r.requester, r.addressee]).filter((i) => i !== me.id))];
  const { data: profs } = ids.length ? await sb.from('profiles').select('id, username, xp').in('id', ids) : { data: [] };
  const byId = Object.fromEntries((profs || []).map((p) => [p.id, p]));
  return data.map((r) => {
    const other = r.requester === me.id ? r.addressee : r.requester;
    return { rowId: r.id, id: other, username: byId[other]?.username || '?', xp: byId[other]?.xp || 0,
      status: r.status === 'accepted' ? 'friend' : r.requester === me.id ? 'outgoing' : 'incoming' };
  });
}
export async function addFriend(username) {
  need();
  if (me.guest) throw new Error('Sign in to add friends');
  const { data } = await sb.from('profiles').select('id, username').ilike('username', username).maybeSingle();
  if (!data) throw new Error('No player with that username');
  if (data.id === me.id) throw new Error("That's you!");
  const { error } = await sb.from('friendships').insert({ requester: me.id, addressee: data.id });
  if (error) throw new Error(error.code === '23505' ? 'Request already sent' : error.message);
  inboxSend(data.id, 'friend', { from: me.id, username: me.username });
}
export async function acceptFriend(rowId) { need(); const { error } = await sb.from('friendships').update({ status: 'accepted' }).eq('id', rowId); if (error) throw error; }
export async function removeFriend(rowId) { need(); const { error } = await sb.from('friendships').delete().eq('id', rowId); if (error) throw error; }

// ---------------------------------------------------------------------------
// Realtime: channels, global presence, personal inbox
// ---------------------------------------------------------------------------
export function channel(name) { return sb ? new SupabaseChannel(sb, name, me) : new LocalChannel(name, me); }

let presence = null;
const online = new Map(); // id -> { username, status, lobby }
const presenceFns = new Set();
export const onOnlineChange = (fn) => presenceFns.add(fn);
export const onlineUsers = () => online;
export function startPresence() {
  if (presence) presence.close();
  presence = channel('presence');
  presence.onPresence((list) => {
    online.clear();
    for (const p of list) if (p.id !== me.id) online.set(p.id, p);
    for (const fn of presenceFns) fn(online);
  });
  setPresence({ status: 'menu' });
}
let presState = { status: 'menu' };
export function setPresence(st) {
  presState = { ...presState, ...st };
  presence?.track({ username: me.username || 'Guest', ...presState });
}

let inbox = null;
const inboxFns = new Set();
export const onInbox = (fn) => inboxFns.add(fn);
export function startInbox() {
  inbox?.close();
  inbox = channel('inbox:' + me.id);
  inbox.on('invite', (p) => { for (const fn of inboxFns) fn({ type: 'invite', ...p }); });
  inbox.on('friend', (p) => { for (const fn of inboxFns) fn({ type: 'friend', ...p }); });
  inbox.track({ username: me.username });
}
function inboxSend(userId, event, payload) {
  const ch = channel('inbox:' + userId);
  ch.ready().then(() => { ch.send(event, payload); setTimeout(() => ch.close(), 1500); });
}
export function sendInvite(userId, code) { inboxSend(userId, 'invite', { from: me.id, username: me.username, code }); }
