/**
 * The one socket a client holds open.
 *
 * There is exactly one, shared by the lobby screen and the running game, for a
 * reason worth stating: the match you are playing and the match list you came
 * from are the same conversation on the server, and a second connection would
 * be a second identity in it -- joining, leaving and reconnecting on its own.
 *
 * Reconnection is built in and matters more than it looks. A laptop lid, a
 * dropped tunnel or a sleeping phone kills the socket in the middle of a siege;
 * the server holds the seat open, so all this has to do is dial again and
 * re-announce which match it was in. The game keeps simulating the local castle
 * throughout -- what stops during an outage is only knowing what the others are
 * doing.
 */

import type { ClientMessage, ServerMessage } from './protocol';

type Listener = (msg: ServerMessage) => void;

/** Backoff between redial attempts, in milliseconds. Stops growing at the end. */
const BACKOFF = [500, 1000, 2000, 4000, 8000];

export type NetStatus = 'off' | 'connecting' | 'open' | 'lost';

export class Net {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusFns = new Set<(s: NetStatus, detail?: string) => void>();
  private attempt = 0;
  private timer: number | null = null;
  private wanted = false;
  /** Set once the server has said hello, so a caller can tell open from ready. */
  private greeted = false;
  /** Re-sent on every reconnect: the match we believe we are seated in. */
  private rejoinId: string | null = null;
  private lastError = '';

  status: NetStatus = 'off';

  /** Connect, and keep reconnecting until `close()`. Safe to call twice. */
  open(): void {
    this.wanted = true;
    if (this.ws || this.timer !== null) return;
    this.dial();
  }

  private dial(): void {
    this.timer = null;
    this.setStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}//${location.host}/ws`);
    } catch {
      this.retry('could not open a connection');
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus('open');
      // Re-announce the seat. The server treats a join from an account already
      // in the match as a reconnect, so this is idempotent and cheap.
      if (this.rejoinId) this.send({ t: 'join', id: this.rejoinId });
    };
    ws.onmessage = ev => {
      let msg: ServerMessage;
      try { msg = JSON.parse(String(ev.data)) as ServerMessage; }
      catch { return; }
      if (msg.t === 'hello') this.greeted = true;
      // Remember the seat ourselves, so a reconnect does not depend on the UI
      // still being on screen to tell us.
      if (msg.t === 'match') this.rejoinId = msg.match ? msg.match.id : null;
      if (msg.t === 'begin') this.rejoinId = msg.match.id;
      for (const fn of this.listeners) {
        try { fn(msg); } catch (e) { console.error('[net] listener:', e); }
      }
    };
    ws.onclose = ev => {
      this.ws = null;
      this.greeted = false;
      // 1006 with no reason is what a refused upgrade looks like from inside the
      // browser -- most often "not signed in", since that is the only thing the
      // server refuses before the handshake.
      this.retry(ev.reason || (ev.code === 1006 ? 'connection lost' : `closed (${ev.code})`));
    };
    ws.onerror = () => { /* onclose always follows, and carries the useful part */ };
  }

  private retry(detail: string): void {
    this.lastError = detail;
    if (!this.wanted) { this.setStatus('off'); return; }
    this.setStatus('lost', detail);
    const wait = BACKOFF[Math.min(this.attempt++, BACKOFF.length - 1)];
    this.timer = window.setTimeout(() => this.dial(), wait);
  }

  close(): void {
    this.wanted = false;
    this.rejoinId = null;
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    this.ws?.close();
    this.ws = null;
    this.setStatus('off');
  }

  get ready(): boolean {
    return this.greeted && this.ws?.readyState === WebSocket.OPEN;
  }

  get error(): string { return this.lastError; }

  /**
   * Send, if there is a socket to send on.
   *
   * Messages sent while the line is down are DROPPED, not queued, and that is
   * deliberate: everything the game sends is a statement about the present --
   * where my soldiers are, what my castle looks like -- and replaying a
   * ten-second-old army position on reconnect would be worse than the gap.
   * The one thing that must survive a reconnect is the seat, and the socket
   * re-announces that itself.
   */
  send(msg: ClientMessage): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn: (s: NetStatus, detail?: string) => void): () => void {
    this.statusFns.add(fn);
    fn(this.status, this.lastError);
    return () => this.statusFns.delete(fn);
  }

  private setStatus(s: NetStatus, detail?: string): void {
    if (this.status === s) return;
    this.status = s;
    for (const fn of this.statusFns) {
      try { fn(s, detail); } catch (e) { console.error('[net] status listener:', e); }
    }
  }
}

/** The single connection. Opened by the lobby, handed on to the game. */
export const net = new Net();
