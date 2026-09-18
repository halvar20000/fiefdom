// A minimal Chrome DevTools Protocol client: JSON over a hand-rolled WebSocket,
// so the smoke test needs nothing from npm. Two things it gets right that cost
// an hour to learn: it waits for the 101 before sending the first frame (Chrome
// discards anything written earlier), and it does not verify the
// Sec-WebSocket-Accept, which Chrome computes non-conformingly.
import net from 'node:net';
import crypto from 'node:crypto';
import http from 'node:http';

export function getJSON(url) {
  return new Promise((res, rej) => http.get(url, r => {
    let s = ''; r.on('data', d => s += d); r.on('end', () => res(JSON.parse(s)));
  }).on('error', rej));
}

export class CDP {
  constructor() { this.id = 0; this.pending = new Map(); this.buf = Buffer.alloc(0); this.onEvent = () => {}; }
  connect(wsUrl) {
    const u = new URL(wsUrl);
    return new Promise((resolve, reject) => {
      const sock = net.connect(+u.port, u.hostname);
      this.sock = sock;
      const key = crypto.randomBytes(16).toString('base64');
      sock.on('connect', () => {
        sock.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      });
      let upgraded = false;
      sock.on('data', d => {
        this.buf = Buffer.concat([this.buf, d]);
        if (!upgraded) {
          const i = this.buf.indexOf('\r\n\r\n');
          if (i < 0) return;
          const head = this.buf.slice(0, i).toString();
          if (!head.startsWith('HTTP/1.1 101')) return reject(new Error(head));
          this.buf = this.buf.slice(i + 4); upgraded = true; resolve();
        }
        this.drain();
      });
      sock.on('error', reject);
    });
  }
  drain() {
    for (;;) {
      if (this.buf.length < 2) return;
      let len = this.buf[1] & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (this.buf.length < off + len) return;
      const payload = this.buf.slice(off, off + len).toString();
      this.buf = this.buf.slice(off + len);
      let m; try { m = JSON.parse(payload); } catch { continue; }
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
      else if (m.method) this.onEvent(m);
    }
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const msg = Buffer.from(JSON.stringify({ id, method, params, sessionId }));
    const mask = crypto.randomBytes(4);
    let head;
    if (msg.length < 126) head = Buffer.from([0x81, 0x80 | msg.length]);
    else if (msg.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(msg.length, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(msg.length), 2); }
    const body = Buffer.alloc(msg.length);
    for (let i = 0; i < msg.length; i++) body[i] = msg[i] ^ mask[i & 3];
    this.sock.write(Buffer.concat([head, mask, body]));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
}
