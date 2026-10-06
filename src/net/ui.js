// Online UI: account chip + login, username, "Play online" (create/join, friends), lobby screen,
// invite toasts. Talks to the game through the small `api` passed to initOnlineUI().
import { MAP_LIST } from '../maps/index.js';
import { AGENTS } from '../config.js';
import {
  configured, me, initBackend, onAuthChange, signIn, signUp, signInGoogle, signOut, setUsername, pushProgress,
  listFriends, addFriend, acceptFriend, removeFriend, startPresence, setPresence, onlineUsers, onOnlineChange,
  startInbox, onInbox, sendInvite,
} from './backend.js';
import { Lobby } from './lobby.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let googleOn = null;
async function googleEnabled() {
  if (googleOn !== null) return googleOn;
  try { const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } }); googleOn = !!(await r.json()).external?.google; } catch { googleOn = false; }
  return googleOn;
}

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let api = null;
let lobby = null;
let friends = [];
let pendingJoin = new URLSearchParams(location.search).get('join');

function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
function screen(id) { let s = $(id); if (!s) { s = el(`<div id="${id}" class="screen dim" hidden></div>`); document.body.appendChild(s); } return s; }

export async function initOnlineUI(gameApi) {
  api = gameApi;
  // menu additions: account chip + PLAY ONLINE button
  $('profileBadge').insertAdjacentHTML('afterend', '<div id="account" class="account"></div>');
  $('lockIn').insertAdjacentHTML('afterend', ' <button id="playOnline" class="big online">PLAY ONLINE</button>');
  $('playOnline').onclick = () => openOnline();
  document.body.appendChild(el('<div id="toasts"></div>'));
  onAuthChange(() => { renderAccount(); afterIdentity(); });
  await initBackend();
}

let started = false;
function afterIdentity() {
  if (!me.guest && !me.username) { askUsername(); return; }
  if (!me.username && !pendingJoin) return;
  if (!me.username) { askUsername(); return; }
  if (!started) { started = true; startPresence(); startInbox(); onInbox(onInboxMsg); onOnlineChange(() => { renderFriends(); renderLobbyInvites(); }); }
  else { startPresence(); startInbox(); }
  pushProgress().catch(() => {});
  if (pendingJoin) { const code = pendingJoin; pendingJoin = null; history.replaceState(null, '', location.pathname); joinLobby(code); }
}

// ---------------------------------------------------------------------------
// Account chip, login, username
// ---------------------------------------------------------------------------
function renderAccount() {
  const a = $('account');
  if (!a) return;
  if (me.guest) {
    a.innerHTML = `<span class="who">${me.username ? esc(me.username) + ' <small>guest</small>' : 'Guest'}</span><button class="ghost sm" id="accBtn">${configured ? 'Sign in' : 'Set name'}</button>`;
    $('accBtn').onclick = () => (configured ? openLogin() : askUsername());
  } else {
    a.innerHTML = `<span class="who">${esc(me.username || me.email)}</span><button class="ghost sm" id="accOut">Sign out</button>`;
    $('accOut').onclick = async () => { await signOut(); toast('Signed out'); };
  }
}

function openLogin() {
  const s = screen('authScreen');
  s.hidden = false;
  s.innerHTML = `<div class="menuInner small auth">
    <h2>SIGN IN</h2>
    <p class="hint">Sign in to add friends, invite them and keep your level and skins on any device.</p>
    <button class="google" id="gBtn"><b>G</b> Continue with Google</button>
    <div class="or">or</div>
    <input id="aEmail" type="email" placeholder="Email" autocomplete="email">
    <input id="aPass" type="password" placeholder="Password (6+ characters)" autocomplete="current-password">
    <div class="err" id="aErr"></div>
    <div class="row"><button class="big" id="aIn">SIGN IN</button><button class="ghost" id="aUp">Create account</button></div>
    <button class="ghost" id="aGuest">Keep playing as guest</button>
  </div>`;
  const err = (e) => { $('aErr').textContent = e?.message || String(e); };
  $('gBtn').onclick = () => signInGoogle().catch(err);
  // only offer Google if it's enabled in the Supabase project
  googleEnabled().then((on) => { if (!on && $('gBtn')) { $('gBtn').remove(); s.querySelector('.or')?.remove(); } });
  $('aIn').onclick = async () => { try { await signIn($('aEmail').value.trim(), $('aPass').value); s.hidden = true; toast('Signed in'); } catch (e) { err(e); } };
  $('aUp').onclick = async () => {
    try {
      const r = await signUp($('aEmail').value.trim(), $('aPass').value);
      if (r === 'check-email') $('aErr').innerHTML = '<span style="color:#6effc4">Check your email to confirm your account, then sign in.</span>';
      else { s.hidden = true; toast('Account created'); }
    } catch (e) { err(e); }
  };
  $('aGuest').onclick = () => { s.hidden = true; };
}

function askUsername() {
  const s = screen('nameScreen');
  s.hidden = false;
  s.innerHTML = `<div class="menuInner small auth">
    <h2>PICK A NAME</h2>
    <p class="hint">${me.guest ? 'Shown to other players in online lobbies.' : 'Your unique username — friends add you with it.'}</p>
    <input id="uName" maxlength="16" placeholder="3–16 letters, numbers or _" value="${esc(me.username || '')}">
    <div class="err" id="uErr"></div>
    <button class="big" id="uOk">SAVE</button>
  </div>`;
  $('uName').focus();
  $('uOk').onclick = async () => {
    try { await setUsername($('uName').value.trim()); s.hidden = true; } catch (e) { $('uErr').textContent = e.message; }
  };
  $('uName').onkeydown = (e) => { if (e.key === 'Enter') $('uOk').click(); };
}

async function needName() {
  if (me.username) return true;
  askUsername();
  return false;
}

// ---------------------------------------------------------------------------
// Play online: create / join + friends
// ---------------------------------------------------------------------------
async function openOnline() {
  if (!(await needName())) return;
  const s = screen('onlineScreen');
  s.hidden = false;
  s.innerHTML = `<div class="menuInner online-wrap">
    <div class="set-head"><h2>PLAY ONLINE</h2><button class="ghost" id="olBack">Back</button></div>
    ${configured ? '' : '<p class="notice">Local test mode: online accounts are not set up yet, so lobbies only work between tabs of this browser. Add your Supabase keys in <code>src/net/config.js</code> to play with friends anywhere.</p>'}
    <div class="ol-grid">
      <section><h3>CREATE A LOBBY</h3><p class="hint">You host the match — friends join with your code or invite link. Empty slots are filled with bots.</p>
        <button class="big" id="olCreate">CREATE LOBBY</button></section>
      <section><h3>JOIN A LOBBY</h3><input id="olCode" maxlength="6" placeholder="CODE" style="text-transform:uppercase">
        <button class="big" id="olJoin">JOIN</button><div class="err" id="olErr"></div></section>
      <section class="friends"><h3>FRIENDS</h3><div id="frBox"></div></section>
    </div>
  </div>`;
  $('olBack').onclick = () => { s.hidden = true; };
  $('olCreate').onclick = () => createLobby();
  $('olJoin').onclick = () => joinLobby($('olCode').value.trim());
  $('olCode').onkeydown = (e) => { if (e.key === 'Enter') $('olJoin').click(); };
  refreshFriends();
}

async function refreshFriends() {
  try { friends = await listFriends(); } catch { friends = []; }
  renderFriends();
}

function friendRows(withInvite) {
  const online = onlineUsers();
  const rows = [];
  const fr = friends.filter((f) => f.status === 'friend');
  // in local test mode there are no accounts: list whoever is online in other tabs
  const people = configured ? fr : [...online.entries()].map(([id, p]) => ({ id, username: p.username, status: 'friend' }));
  for (const f of people) {
    const on = online.get(f.id);
    const where = on ? (on.status === 'lobby' ? 'In a lobby' : on.status === 'in match' ? 'In a match' : 'Online') : 'Offline';
    const canJoin = on && on.status === 'lobby' && on.lobby && on.open !== false && !withInvite;
    rows.push(`<div class="fr"><span class="dot ${on ? 'on' : ''}"></span><b>${esc(f.username)}</b><small>${where}</small>
      ${withInvite && on && lobby ? `<button class="ghost sm" data-inv="${esc(f.id)}">Invite</button>` : ''}
      ${canJoin ? `<button class="ghost sm" data-join="${esc(on.lobby)}">Join</button>` : ''}
      ${configured && !withInvite ? `<button class="ghost sm x" data-del="${f.rowId}">✕</button>` : ''}</div>`);
  }
  return rows;
}

function renderFriends() {
  const box = $('frBox');
  if (!box) return;
  if (configured && me.guest) {
    box.innerHTML = '<p class="hint">Sign in to add friends and invite them.</p><button class="ghost" id="frSign">Sign in</button>';
    $('frSign').onclick = openLogin;
    return;
  }
  const incoming = friends.filter((f) => f.status === 'incoming');
  const outgoing = friends.filter((f) => f.status === 'outgoing');
  const rows = friendRows(false);
  box.innerHTML = `${configured ? `<div class="fr-add"><input id="frName" placeholder="Add by username"><button class="ghost sm" id="frAdd">Add</button></div><div class="err" id="frErr"></div>` : '<p class="hint">Players online in other tabs:</p>'}
    ${incoming.map((f) => `<div class="fr req"><b>${esc(f.username)}</b><small>wants to be friends</small><button class="ghost sm" data-acc="${f.rowId}">Accept</button><button class="ghost sm x" data-del="${f.rowId}">✕</button></div>`).join('')}
    ${rows.join('') || '<p class="hint">No friends online yet.</p>'}
    ${outgoing.map((f) => `<div class="fr"><b>${esc(f.username)}</b><small>request sent</small></div>`).join('')}`;
  if ($('frAdd')) {
    $('frAdd').onclick = async () => { try { await addFriend($('frName').value.trim()); toast('Friend request sent'); refreshFriends(); } catch (e) { $('frErr').textContent = e.message; } };
  }
  box.querySelectorAll('[data-acc]').forEach((b) => { b.onclick = async () => { await acceptFriend(+b.dataset.acc); refreshFriends(); }; });
  box.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { await removeFriend(+b.dataset.del); refreshFriends(); }; });
  box.querySelectorAll('[data-join]').forEach((b) => { b.onclick = () => joinLobby(b.dataset.join); });
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------
async function createLobby() {
  if (!(await needName())) return;
  const c = api.choice();
  lobby = await Lobby.host({ mode: c.mode, teamSize: c.teamSize, difficulty: c.difficulty, map: c.map || 'random' }, c.agent);
  lobby.systemChat(`Lobby created — share code ${lobby.code}`);
  wireLobby();
  showLobby();
}

let joinAttempt = 0;
async function joinLobby(code) {
  if (!code || code.length < 6) { const e = $('olErr'); if (e) e.textContent = 'Enter the 6-character code'; return; }
  if (!(await needName())) { pendingJoin = code; return; }
  if (lobby) leaveLobby(false);
  const e = $('olErr'); if (e) e.textContent = 'Connecting…';
  const attempt = ++joinAttempt;
  let joined;
  try {
    joined = await Lobby.join(code, api.choice().agent);
  } catch (err) {
    // an older attempt failing late (e.g. a mistyped code timing out) must not cancel a newer one
    if (attempt !== joinAttempt) return;
    if ($('olErr')) $('olErr').textContent = err.message; else toast(err.message);
    lobby = null;
    return;
  }
  if (attempt !== joinAttempt) { joined.leave?.(false); return; }
  lobby = joined;
  wireLobby();
  showLobby();
}

function wireLobby() {
  // tell the host what this player looks like
  setTimeout(() => lobby?.request('outfit', api.outfitFor(api.choice().agent)), 800);
  lobby.on('update', () => { if (!$('lobbyScreen')?.hidden) renderLobby(); });
  lobby.on('start', (msg) => { $('lobbyScreen').hidden = true; api.startOnline(lobby, msg); });
  lobby.on('lobby', () => { api.exitToLobby(); showLobby(); });
  lobby.on('closed', (why) => { toast(why || 'Lobby closed'); leaveLobby(false); api.toMenu(); });
  setPresence({ status: 'lobby', lobby: lobby.code, open: true });
}

function showLobby() {
  for (const id of ['onlineScreen', 'over']) if ($(id)) $(id).hidden = true;
  screen('lobbyScreen').hidden = false;
  renderLobby();
}

function renderLobby() {
  const s = $('lobbyScreen');
  if (!lobby || !s) return;
  const st = lobby.settings, mine = lobby.members.find((m) => m.id === me.id);
  const link = `${location.origin}${location.pathname}?join=${lobby.code}`;
  const team = (t) => {
    const ms = lobby.members.filter((m) => m.team === t);
    const slots = ms.map((m) => `<div class="slot ${m.id === me.id ? 'me' : ''}"><span class="ag" style="background:${AGENTS[m.agent]?.color}">${AGENTS[m.agent]?.name[0]}</span>
      <b>${esc(m.name)}</b>${m.host ? '<small>HOST</small>' : m.ready ? '<small class="ok">READY</small>' : ''}</div>`);
    for (let i = ms.length; i < st.teamSize; i++) slots.push('<div class="slot bot"><span class="ag">·</span><i>Bot</i></div>');
    const canJoin = mine && mine.team !== t && ms.length < st.teamSize;
    return `<div class="team t${t}"><h3>${t === 0 ? 'BLUE' : 'ORANGE'} TEAM</h3>${slots.join('')}${canJoin ? `<button class="ghost sm" data-team="${t}">Join ${t === 0 ? 'Blue' : 'Red'}</button>` : ''}</div>`;
  };
  const seg = (k, opts) => `<div class="seg" data-set="${k}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(st[k]) === String(v) ? 'on' : ''}" ${lobby.isHost ? '' : 'disabled'}>${l}</button>`).join('')}</div>`;
  s.innerHTML = `<div class="menuInner lobby">
    <div class="set-head"><h2>LOBBY <span class="code">${lobby.code}</span></h2>
      <button class="ghost" id="lbCopy">Copy invite link</button><button class="ghost" id="lbLeave">Leave</button></div>
    <div class="lb-grid">
      <div class="teams">${team(0)}${team(1)}</div>
      <div class="side">
        <section><h3>YOUR OPERATIVE</h3><div class="agents">${Object.values(AGENTS).map((a) => `<button data-agent="${a.key}" class="${mine?.agent === a.key ? 'on' : ''}" style="--acc:${a.color}">${a.name}</button>`).join('')}</div></section>
        <section><h3>MATCH ${lobby.isHost ? '' : '<small>(host decides)</small>'}</h3>
          ${seg('mode', [['uplink', 'Uplink'], ['dom', 'Domination'], ['tdm', 'Team DM']])}
          ${seg('teamSize', [[2, '2v2'], [3, '3v3'], [4, '4v4'], [6, '6v6']])}
          ${seg('difficulty', [['veryeasy', 'Super easy bots'], ['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']])}
          ${seg('map', [['random', 'Random map'], ...MAP_LIST.map((m) => [m.id, m.name])])}</section>
        <section><h3>INVITE</h3><div id="lbInv"></div></section>
        <section class="chat"><h3>CHAT</h3><div class="log" id="lbLog">${lobby.chat.map((c) => c.name ? `<div><b>${esc(c.name)}:</b> ${esc(c.text)}</div>` : `<div class="sys">${esc(c.text)}</div>`).join('')}</div>
          <input id="lbMsg" maxlength="140" placeholder="Say something…"></section>
      </div>
    </div>
    <div class="row">${lobby.isHost ? `<button class="big" id="lbStart">START MATCH</button>` : `<button class="big" id="lbReady">${mine?.ready ? 'NOT READY' : 'READY'}</button><p class="hint">Waiting for the host to start…</p>`}</div>
  </div>`;
  const log = $('lbLog'); log.scrollTop = log.scrollHeight;
  $('lbCopy').onclick = () => { navigator.clipboard?.writeText(link).then(() => toast('Invite link copied'), () => prompt('Invite link', link)); };
  $('lbLeave').onclick = () => { leaveLobby(true); s.hidden = true; };
  s.querySelectorAll('[data-team]').forEach((b) => { b.onclick = () => lobby.request('team', +b.dataset.team); });
  s.querySelectorAll('[data-agent]').forEach((b) => { b.onclick = () => { lobby.request('agent', b.dataset.agent); lobby.request('outfit', api.outfitFor(b.dataset.agent)); api.setAgent(b.dataset.agent); }; });
  s.querySelectorAll('[data-set] button').forEach((b) => {
    b.onclick = () => { if (!lobby.isHost) return; const k = b.parentElement.dataset.set; lobby.setSetting(k, k === 'teamSize' ? +b.dataset.v : b.dataset.v); };
  });
  $('lbMsg').onkeydown = (e) => { if (e.key === 'Enter' && e.target.value.trim()) { lobby.request('chat', e.target.value.trim()); e.target.value = ''; } };
  if ($('lbStart')) $('lbStart').onclick = () => { const msg = lobby.start(); $('lobbyScreen').hidden = true; api.startOnline(lobby, msg); };
  if ($('lbReady')) $('lbReady').onclick = () => lobby.request('ready', !mine?.ready);
  renderLobbyInvites();
}

function renderLobbyInvites() {
  const box = $('lbInv');
  if (!box || !lobby) return;
  const rows = friendRows(true);
  box.innerHTML = rows.join('') || `<p class="hint">${configured ? (me.guest ? 'Sign in to invite friends — or share the invite link.' : 'No friends online — share the invite link.') : 'Open the game in another tab to test invites, or share the code.'}</p>`;
  box.querySelectorAll('[data-inv]').forEach((b) => { b.onclick = () => { sendInvite(b.dataset.inv, lobby.code); b.textContent = 'Sent'; b.disabled = true; }; });
}

function leaveLobby(announce) {
  lobby?.leave();
  lobby = null;
  setPresence({ status: 'menu', lobby: null });
  if (announce) toast('Left the lobby');
}

/** Called by the game when an online match ends (configures the results screen buttons). */
export function onlineMatchOver() {
  if (!lobby) return;
  const again = $('again'), back = $('toMenu');
  if (lobby.isHost) { again.textContent = 'BACK TO LOBBY'; again.onclick = () => { lobby.backToLobby(); api.exitToLobby(); showLobby(); }; }
  else { again.textContent = 'WAITING FOR HOST…'; again.onclick = null; }
  back.textContent = 'Leave lobby';
  back.onclick = () => { leaveLobby(true); api.toMenu(); };
  pushProgress().catch(() => {});
}
export const inLobby = () => !!lobby;
export function leaveOnline() { if (lobby) leaveLobby(false); }

// ---------------------------------------------------------------------------
// Invites + toasts
// ---------------------------------------------------------------------------
function onInboxMsg(m) {
  if (m.type === 'invite') {
    toast(`<b>${esc(m.username)}</b> invited you to a lobby`, [['Join', () => joinLobby(m.code)]], 15000);
  } else if (m.type === 'friend') {
    toast(`<b>${esc(m.username)}</b> sent you a friend request`, [['View', () => { openOnline(); }]], 10000);
    refreshFriends();
  }
}

export function toast(html, actions = [], ms = 3500) {
  const box = $('toasts');
  if (!box) return;
  const t = el(`<div class="toast"><span>${html}</span></div>`);
  for (const [label, fn] of actions) {
    const b = document.createElement('button'); b.textContent = label; b.className = 'ghost sm';
    b.onclick = () => { t.remove(); fn(); };
    t.appendChild(b);
  }
  const x = document.createElement('button'); x.textContent = '✕'; x.className = 'ghost sm x'; x.onclick = () => t.remove(); t.appendChild(x);
  box.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
