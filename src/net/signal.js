// Realtime channel abstraction used for presence, lobby discovery, invites and WebRTC signalling.
// Two backends with the same interface:
//   SupabaseChannel — Supabase Realtime (broadcast + presence) when the project is configured
//   LocalChannel    — BroadcastChannel between tabs of the same browser (local test mode)
//
// interface: on(event, fn) · send(event, payload) · track(state) · onPresence(fn(list)) · close()
// presence list entries: { id, ...state }

export class LocalChannel {
  constructor(name, me) {
    this.me = me;
    this.bc = new BroadcastChannel('riftline:' + name);
    this.handlers = new Map();
    this.presenceFns = [];
    this.peers = new Map();   // id -> { state, seen }
    this.state = null;
    this.bc.onmessage = (e) => this._recv(e.data);
    this.hb = setInterval(() => this._heartbeat(), 1500);
    this.gc = setInterval(() => this._prune(), 1000);
  }
  _recv(m) {
    if (!m || m.from === this.me.id) return;
    if (m.kind === 'pres') {
      const had = this.peers.has(m.from);
      this.peers.set(m.from, { state: m.state, seen: Date.now() });
      if (!had || m.changed) this._emitPresence();
      if (m.ask) this._heartbeat();
    } else if (m.kind === 'leave') {
      if (this.peers.delete(m.from)) this._emitPresence();
    } else if (m.kind === 'bc') {
      for (const fn of this.handlers.get(m.event) || []) fn(m.payload, m.from);
    }
  }
  _heartbeat(changed = false, ask = false) {
    if (this.state) this.bc.postMessage({ kind: 'pres', from: this.me.id, state: this.state, changed, ask });
  }
  _prune() {
    let changed = false;
    for (const [id, p] of this.peers) if (Date.now() - p.seen > 5000) { this.peers.delete(id); changed = true; }
    if (changed) this._emitPresence();
  }
  _emitPresence() { const list = this.list(); for (const fn of this.presenceFns) fn(list); }
  list() {
    const out = [...this.peers].map(([id, p]) => ({ id, ...p.state }));
    if (this.state) out.push({ id: this.me.id, ...this.state });
    return out;
  }
  async ready() { return true; }
  on(event, fn) { if (!this.handlers.has(event)) this.handlers.set(event, []); this.handlers.get(event).push(fn); }
  send(event, payload) { this.bc.postMessage({ kind: 'bc', event, payload, from: this.me.id }); }
  track(state) { this.state = state; this._heartbeat(true, true); this._emitPresence(); }
  onPresence(fn) { this.presenceFns.push(fn); }
  close() {
    clearInterval(this.hb); clearInterval(this.gc);
    try { this.bc.postMessage({ kind: 'leave', from: this.me.id }); } catch { /* closed */ }
    this.bc.close();
  }
}

export class SupabaseChannel {
  constructor(sb, name, me) {
    this.me = me;
    this.handlers = new Map();
    this.presenceFns = [];
    this.ch = sb.channel(name, { config: { broadcast: { self: false }, presence: { key: me.id } } });
    this.ch.on('broadcast', { event: 'm' }, ({ payload }) => {
      if (!payload || payload.from === me.id) return;
      for (const fn of this.handlers.get(payload.event) || []) fn(payload.data, payload.from);
    });
    this.ch.on('presence', { event: 'sync' }, () => { const l = this.list(); for (const fn of this.presenceFns) fn(l); });
    this._ready = new Promise((res) => this.ch.subscribe((status) => { if (status === 'SUBSCRIBED') res(true); }));
  }
  ready() { return this._ready; }
  list() {
    const st = this.ch.presenceState();
    return Object.entries(st).map(([id, metas]) => ({ id, ...(metas[metas.length - 1] || {}) }));
  }
  on(event, fn) { if (!this.handlers.has(event)) this.handlers.set(event, []); this.handlers.get(event).push(fn); }
  async send(event, data) { await this._ready; this.ch.send({ type: 'broadcast', event: 'm', payload: { event, data, from: this.me.id } }); }
  async track(state) { await this._ready; this.ch.track(state); }
  onPresence(fn) { this.presenceFns.push(fn); }
  close() { try { this.ch.untrack(); this.ch.unsubscribe(); } catch { /* ignore */ } }
}
