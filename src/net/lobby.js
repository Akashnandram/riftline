// Lobbies: the host owns the lobby state; clients find it through a realtime channel
// ('lobby:CODE'), connect to the host over WebRTC and then talk to it directly.
import { channel, me } from './backend.js';
import { Peer } from './peer.js';
import { MAX_PLAYERS } from './config.js';
import { AGENTS, BOT_NAMES } from '../config.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

export class Lobby {
  constructor(code, isHost) {
    this.code = code;
    this.isHost = isHost;
    this.peers = new Map();        // peerId -> Peer
    this.members = [];             // [{ id, name, team, agent, ready, host }]
    this.settings = { mode: 'plant', teamSize: 5, difficulty: 'normal' };
    this.chat = [];
    this.fns = {};
    this.started = false;
    this.ch = channel('lobby:' + code);
  }
  on(ev, fn) { (this.fns[ev] ??= []).push(fn); }
  off(ev) { delete this.fns[ev]; }
  _emit(ev, ...a) { for (const fn of this.fns[ev] || []) fn(...a); }

  // -------------------------------------------------------------- host
  static async host(settings, agent) {
    const L = new Lobby(newCode(), true);
    Object.assign(L.settings, settings);
    L.members.push({ id: me.id, name: me.username || 'Host', team: 0, agent, ready: true, host: true });
    L.ch.on('sig', (m, from) => { if (m.to === me.id) L.peers.get(from)?.handleSignal(m.data); });
    L.ch.onPresence((list) => L._hostPresence(list));
    await L.ch.ready();
    L.ch.track({ role: 'host', name: me.username, open: true });
    return L;
  }
  _hostPresence(list) {
    for (const p of list) {
      if (p.id === me.id || p.role !== 'client' || this.peers.has(p.id)) continue;
      if (this.members.length >= Math.min(MAX_PLAYERS, this.settings.teamSize * 2) || this.started) continue;
      const peer = new Peer(true, (data) => this.ch.send('sig', { to: p.id, data }));
      this.peers.set(p.id, peer);
      peer.on('open', () => {
        const team = this._teamWithRoom();
        this.members.push({ id: p.id, name: p.name || 'Player', team, agent: p.agent || 'volt', ready: false, host: false });
        this.systemChat(`${p.name || 'A player'} joined`);
        this.broadcastState();
      });
      peer.on('message', (m) => this._hostMsg(p.id, m));
      peer.on('close', () => this._dropPeer(p.id));
    }
  }
  _teamWithRoom() {
    const n = [0, 1].map((t) => this.members.filter((m) => m.team === t).length);
    return n[0] <= n[1] ? 0 : 1;
  }
  _dropPeer(id) {
    this.peers.get(id)?.close();
    this.peers.delete(id);
    const m = this.members.find((x) => x.id === id);
    this.members = this.members.filter((x) => x.id !== id);
    if (m) { this.systemChat(`${m.name} left`); this.broadcastState(); this._emit('left', m); }
  }
  _hostMsg(id, m) {
    const mem = this.members.find((x) => x.id === id);
    if (m.t === 'req' && mem) {
      if (m.kind === 'team') {
        const full = this.members.filter((x) => x.team === m.value).length >= this.settings.teamSize;
        if (!full) mem.team = m.value;
      } else if (m.kind === 'agent' && AGENTS[m.value]) mem.agent = m.value;
      else if (m.kind === 'ready') mem.ready = !!m.value;
      else if (m.kind === 'chat') this._chat(mem.name, String(m.value).slice(0, 140));
      this.broadcastState();
      return;
    }
    this._emit('game', m, id);
  }
  _chat(name, text) { this.chat.push({ name, text }); if (this.chat.length > 40) this.chat.shift(); }
  systemChat(text) { this._chat('', text); }
  setSetting(k, v) {
    this.settings[k] = v;
    // shrink teams if needed
    for (const t of [0, 1]) {
      const list = this.members.filter((m) => m.team === t);
      while (list.length > this.settings.teamSize) { const m = list.pop(); m.team = 1 - t; }
    }
    this.broadcastState();
  }
  hostRequest(kind, value) {
    const mem = this.members.find((x) => x.id === me.id);
    this._hostMsg(me.id, { t: 'req', kind, value });
    return mem;
  }
  broadcastState() {
    const st = { t: 'state', members: this.members, settings: this.settings, chat: this.chat, code: this.code };
    for (const p of this.peers.values()) p.send(st);
    this._emit('update', this);
  }
  /** Build the match roster (humans + bots filling empty slots) and tell everyone to start. */
  start() {
    this.started = true;
    this.ch.track({ role: 'host', name: me.username, open: false });
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const agentKeys = Object.keys(AGENTS);
    const roster = [];
    let fid = 0;
    for (const team of [0, 1]) {
      const humans = this.members.filter((m) => m.team === team);
      for (const m of humans) roster.push({ fid: fid++, name: m.name, team, agent: m.agent, owner: m.id });
      for (let i = humans.length; i < this.settings.teamSize; i++) {
        roster.push({ fid: fid++, name: names.pop(), team, agent: agentKeys[Math.floor(Math.random() * agentKeys.length)], owner: null });
      }
    }
    const msg = { t: 'start', settings: { ...this.settings }, roster, host: me.id };
    for (const p of this.peers.values()) p.send(msg);
    return msg;
  }
  backToLobby() {
    this.started = false;
    this.ch.track({ role: 'host', name: me.username, open: true });
    for (const p of this.peers.values()) p.send({ t: 'lobby' });
    this.broadcastState();
  }
  /** host → all clients (optionally except one); fast = unreliable channel */
  broadcast(obj, fast = false, except = null) {
    for (const [id, p] of this.peers) if (id !== except) (fast ? p.sendFast(obj) : p.send(obj));
  }
  sendTo(id, obj, fast = false) { const p = this.peers.get(id); if (p) (fast ? p.sendFast(obj) : p.send(obj)); }
  rttOf(id) { return this.peers.get(id)?.rtt ?? 0.1; }

  // -------------------------------------------------------------- client
  static async join(code, agent) {
    const L = new Lobby(code.toUpperCase(), false);
    L.agent = agent;
    L.ch.on('sig', (m, from) => {
      if (m.to !== me.id) return;
      if (!L.hostPeer) {
        L.hostId = from;
        L.hostPeer = new Peer(false, (data) => L.ch.send('sig', { to: from, data }));
        L.hostPeer.on('message', (msg) => L._clientMsg(msg));
        L.hostPeer.on('open', () => L._emit('connected'));
        L.hostPeer.on('close', () => { if (!L.leaving) L._emit('closed', 'The host left the lobby'); });
      }
      L.hostPeer.handleSignal(m.data);
    });
    await L.ch.ready();
    L.ch.track({ role: 'client', name: me.username || 'Player', agent });
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { if (!L.members.length) { L.leave(); reject(new Error('Lobby not found — check the code, or the host may have closed it')); } }, 12000);
      L.on('update', () => { clearTimeout(t); resolve(L); });
    });
  }
  _clientMsg(m) {
    if (m.t === 'state') {
      this.members = m.members; this.settings = m.settings; this.chat = m.chat;
      this._emit('update', this);
      // the initial 'update' resolves join(); keep firing for later changes
    } else if (m.t === 'start') { this.started = true; this._emit('start', m); }
    else if (m.t === 'lobby') { this.started = false; this._emit('lobby'); }
    else this._emit('game', m, this.hostId);
  }
  request(kind, value) {
    if (this.isHost) return this.hostRequest(kind, value);
    this.hostPeer?.send({ t: 'req', kind, value });
  }
  toHost(obj, fast = false) { if (fast) this.hostPeer?.sendFast(obj); else this.hostPeer?.send(obj); }
  get rtt() { return this.hostPeer?.rtt ?? 0.1; }

  leave() {
    this.leaving = true;
    for (const p of this.peers.values()) p.close();
    this.hostPeer?.close();
    this.ch.close();
  }
}
