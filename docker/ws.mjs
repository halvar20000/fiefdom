// A WebSocket server, in about two hundred lines of Node built-ins.
//
// The lobby and a running match need the server to PUSH -- a player joining,
// another player's army moving -- and polling an HTTP endpoint ten times a
// second for four players is both slower and more traffic than the game itself.
// So: WebSockets.
//
// Every library that does this would be the first npm dependency this server
// has ever had, on a container whose whole promise is that its owner can read
// it. RFC 6455 is small enough to implement honestly: an HTTP upgrade with one
// SHA-1, and a frame format with a four-byte mask. That is all that is below.
//
// Deliberately unimplemented, because the browser never sends them to us:
//   - compression (permessage-deflate) -- we simply never negotiate it;
//   - fragmented frames longer than the buffer cap, which are dropped.
// Both are refusals, not silent mis-parses.

import { createHash } from 'node:crypto';

/**
 * The constant RFC 6455 requires in the handshake. Not a secret, not a choice.
 *
 * Worth one line of warning: a WRONG one here fails in the least helpful way
 * available. The handshake completes, the server logs a connection, curl is
 * perfectly happy -- and every browser refuses with "Incorrect
 * 'Sec-WebSocket-Accept' header value", which reads like an authentication
 * problem and is not one. The check is `sha1("dGhlIHNhbXBsZSBub25jZQ==" +
 * GUID)` in base64 equalling `s3pPLMBiTxaQ9kYGzzhZRbK+xOo=`, the worked example
 * in section 1.3 of the RFC.
 */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OP_CONT = 0x0, OP_TEXT = 0x1, OP_BIN = 0x2;
const OP_CLOSE = 0x8, OP_PING = 0x9, OP_PONG = 0xa;

/** One message ceiling. A match snapshot is kilobytes; this is abuse protection. */
const MAX_MESSAGE = 4 * 1024 * 1024;
/** A socket that has not answered a ping in this long is gone, whatever TCP thinks. */
const HEARTBEAT_MS = 25_000;

/**
 * One connected browser.
 *
 * `send` takes an object and writes it as JSON: every message this game sends
 * is JSON, and having one place that stringifies means a socket that has gone
 * away is handled once rather than at forty call sites.
 */
export class WSConnection {
  #socket;
  #buf = Buffer.alloc(0);
  /** Payload of a fragmented message being assembled, and its opcode. */
  #fragments = [];
  #fragOp = 0;
  #alive = true;
  #timer;

  /** Anything the application wants to hang off the connection. */
  data = {};
  onMessage = null;
  onClose = null;

  constructor(socket) {
    this.#socket = socket;
    socket.setNoDelay(true);
    socket.on('data', c => this.#feed(c));
    socket.on('error', () => this.close());
    socket.on('close', () => this.#died());
    // A browser tab that is closed abruptly, or a laptop that sleeps, leaves a
    // socket that looks open for minutes. Pinging turns that into a prompt
    // "player left" instead of an empty chair in the lobby.
    let waiting = false;
    this.#timer = setInterval(() => {
      if (!this.#alive) return;
      if (waiting) { this.close(); return; }
      waiting = true;
      this.#frame(OP_PING, Buffer.alloc(0));
      this.#onPong = () => { waiting = false; };
    }, HEARTBEAT_MS);
  }

  #onPong = null;

  get open() { return this.#alive; }

  send(obj) {
    if (!this.#alive) return;
    this.#frame(OP_TEXT, Buffer.from(JSON.stringify(obj), 'utf8'));
  }

  /** Forward an already-encoded payload, without re-stringifying it per recipient. */
  sendRaw(text) {
    if (!this.#alive) return;
    this.#frame(OP_TEXT, Buffer.from(text, 'utf8'));
  }

  close(code = 1000) {
    if (!this.#alive) return;
    const b = Buffer.alloc(2);
    b.writeUInt16BE(code);
    try { this.#frame(OP_CLOSE, b); } catch { /* already gone */ }
    this.#socket.end();
    this.#died();
  }

  #died() {
    if (!this.#alive) return;
    this.#alive = false;
    clearInterval(this.#timer);
    try { this.onClose?.(); } catch (e) { console.error('[ws] close handler:', e.message); }
  }

  // --- writing --------------------------------------------------------------

  #frame(opcode, payload) {
    const len = payload.length;
    // Server-to-client frames are never masked, so the header is 2, 4 or 10
    // bytes depending only on how long the payload is.
    let head;
    if (len < 126) {
      head = Buffer.alloc(2);
      head[1] = len;
    } else if (len < 65536) {
      head = Buffer.alloc(4);
      head[1] = 126;
      head.writeUInt16BE(len, 2);
    } else {
      head = Buffer.alloc(10);
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(len), 2);
    }
    head[0] = 0x80 | opcode;   // FIN set: we never fragment outgoing messages
    try { this.#socket.write(Buffer.concat([head, payload])); }
    catch { this.#died(); }
  }

  // --- reading --------------------------------------------------------------

  #feed(chunk) {
    this.#buf = this.#buf.length ? Buffer.concat([this.#buf, chunk]) : chunk;
    // A client that sends garbage faster than we can parse it is refused rather
    // than allowed to grow this buffer without bound.
    if (this.#buf.length > MAX_MESSAGE) { this.close(1009); return; }
    for (;;) {
      const frame = this.#read();
      if (!frame) return;
      this.#handle(frame);
      if (!this.#alive) return;
    }
  }

  /** Pull one whole frame off the buffer, or null if it has not all arrived. */
  #read() {
    const b = this.#buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < off + 2) return null;
      len = b.readUInt16BE(off); off += 2;
    } else if (len === 127) {
      if (b.length < off + 8) return null;
      const big = b.readBigUInt64BE(off); off += 8;
      if (big > BigInt(MAX_MESSAGE)) { this.close(1009); return null; }
      len = Number(big);
    }
    // Every frame from a browser is masked; an unmasked one is a protocol error.
    if (!masked) { this.close(1002); return null; }
    if (b.length < off + 4 + len) return null;
    const mask = b.subarray(off, off + 4); off += 4;
    const payload = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) payload[i] = b[off + i] ^ mask[i & 3];
    this.#buf = b.subarray(off + len);
    return { fin, opcode, payload };
  }

  #handle({ fin, opcode, payload }) {
    switch (opcode) {
      case OP_PING: this.#frame(OP_PONG, payload); return;
      case OP_PONG: this.#onPong?.(); return;
      case OP_CLOSE: this.close(1000); return;
      case OP_CONT: {
        if (!this.#fragOp) { this.close(1002); return; }
        this.#fragments.push(payload);
        if (!fin) return;
        const whole = Buffer.concat(this.#fragments);
        this.#fragments = []; const op = this.#fragOp; this.#fragOp = 0;
        this.#deliver(op, whole);
        return;
      }
      case OP_TEXT:
      case OP_BIN: {
        if (!fin) { this.#fragOp = opcode; this.#fragments = [payload]; return; }
        this.#deliver(opcode, payload);
        return;
      }
      default: this.close(1002);
    }
  }

  #deliver(opcode, payload) {
    if (opcode !== OP_TEXT) return;   // the game speaks JSON and nothing else
    let msg;
    try { msg = JSON.parse(payload.toString('utf8')); }
    catch { return; }                 // a malformed message is dropped, not fatal
    if (!msg || typeof msg !== 'object') return;
    try { this.onMessage?.(msg); }
    catch (e) { console.error('[ws] message handler:', e.message); }
  }
}

/**
 * Complete the HTTP upgrade and hand back a live connection, or null if the
 * request was not a WebSocket handshake we can answer.
 */
export function accept(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  const version = req.headers['sec-websocket-version'];
  if (!key || String(version) !== '13') {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return null;
  }
  const digest = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${digest}\r\n\r\n`);
  const conn = new WSConnection(socket);
  // Bytes that arrived glued to the handshake are the start of the first frame.
  if (head?.length) socket.emit('data', head);
  return conn;
}
