// One WebRTC connection between the host and a client, with two data channels:
//   'r' reliable + ordered  — lobby state, game events (kills, abilities, buys, rounds)
//   'u' unreliable          — snapshots (host → client) and inputs (client → host), 20–30 Hz
import { ICE_SERVERS } from './config.js';

export class Peer {
  /**
   * @param {boolean} initiator  host side creates the channels and the offer
   * @param {(msg) => void} signal  sends { sdp } / { ice } to the other side via the lobby channel
   */
  constructor(initiator, signal) {
    this.initiator = initiator;
    this.signal = signal;
    this.handlers = {};
    this.open = false;
    this.rtt = 0.08;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc.onicecandidate = (e) => { if (e.candidate) signal({ ice: e.candidate.toJSON() }); };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'failed' || s === 'closed' || s === 'disconnected') this._closed(s);
    };
    if (initiator) {
      this._setup(this.pc.createDataChannel('r', { ordered: true }));
      this._setup(this.pc.createDataChannel('u', { ordered: false, maxRetransmits: 0 }));
      this.pc.createOffer().then((o) => this.pc.setLocalDescription(o)).then(() => signal({ sdp: this.pc.localDescription.toJSON() }));
    } else {
      this.pc.ondatachannel = (e) => this._setup(e.channel);
    }
    this.pendingIce = [];
  }

  _setup(ch) {
    ch.binaryType = 'arraybuffer';
    if (ch.label === 'r') this.r = ch; else this.u = ch;
    ch.onopen = () => {
      if (this.r?.readyState === 'open' && this.u?.readyState === 'open' && !this.open) {
        this.open = true;
        this._pingTimer = setInterval(() => this.send({ t: 'ping', at: performance.now() }), 1000);
        this.handlers.open?.();
      }
    };
    ch.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'ping') { this.send({ t: 'pong', at: m.at }); return; }
      if (m.t === 'pong') { this.rtt = this.rtt * 0.7 + ((performance.now() - m.at) / 1000) * 0.3; return; }
      this.handlers.message?.(m);
    };
    ch.onclose = () => this._closed('channel closed');
  }

  async handleSignal(msg) {
    try {
      if (msg.sdp) {
        await this.pc.setRemoteDescription(msg.sdp);
        for (const c of this.pendingIce) await this.pc.addIceCandidate(c);
        this.pendingIce = [];
        if (msg.sdp.type === 'offer') {
          await this.pc.setLocalDescription(await this.pc.createAnswer());
          this.signal({ sdp: this.pc.localDescription.toJSON() });
        }
      } else if (msg.ice) {
        if (this.pc.remoteDescription) await this.pc.addIceCandidate(msg.ice);
        else this.pendingIce.push(msg.ice);
      }
    } catch (err) { console.warn('[peer] signal error', err); }
  }

  on(event, fn) { this.handlers[event] = fn; }
  /** Reliable send (events). */
  send(obj) { if (this.r?.readyState === 'open') this.r.send(JSON.stringify(obj)); }
  /** Unreliable send (snapshots / inputs); drops if the buffer is backing up. */
  sendFast(obj) { if (this.u?.readyState === 'open' && this.u.bufferedAmount < 64000) this.u.send(JSON.stringify(obj)); }

  _closed(why) {
    if (this._dead) return;
    this._dead = true;
    clearInterval(this._pingTimer);
    this.open = false;
    this.handlers.close?.(why);
  }
  close() { try { this.pc.close(); } catch { /* ignore */ } this._closed('closed'); }
}
