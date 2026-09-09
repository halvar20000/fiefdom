// Fiefdom's runtime server.
//
// The game is still a client-side simulation -- every world is built and run in
// a browser. This server does the three things a browser cannot do alone:
//
//   1. serve the built files, with the cache headers nginx used to set;
//   2. keep saved games and custom maps in a mapped /data volume, so they
//      survive a container update instead of hiding in one browser's
//      localStorage;
//   3. know who each player is, and put two to four of them in the same match.
//
// (3) is the new one. Accounts live in accounts.mjs, the WebSocket protocol in
// ws.mjs, and the matchmaking in lobby.mjs -- see each for why it is written by
// hand. Nothing here simulates a castle: the players' browsers do that and tell
// each other about it through the relay in lobby.mjs.
//
// Deliberately dependency-free: Node's own http/fs/zlib, nothing from npm. A
// self-hosted game's server should be something its owner can read in one
// sitting and trust, and every dependency is a thing that can rot or bite.
//
// The storage API is a tiny key/value store. The client already thinks in
// localStorage keys (`fiefdom.save.0`, `fiefdom.maps`), so mirroring that exact
// shape means the client change is a one-line swap and the fallback to real
// localStorage stays trivial when this server is absent.

import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join, normalize, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { Accounts } from './accounts.mjs';
import { Lobby } from './lobby.mjs';
import { accept } from './ws.mjs';

const PORT = Number(process.env.PORT || 80);
const STATIC_DIR = process.env.STATIC_DIR || '/app/dist';
const DATA_DIR = process.env.DATA_DIR || '/data';
const USERS_DIR = join(DATA_DIR, 'users');
const LEGACY_FILE = join(DATA_DIR, 'store.json');   // the old single shared store
/** A save or a map bundle is kilobytes; this ceiling is pure abuse-protection. */
const MAX_BODY = 16 * 1024 * 1024;

// --- who is playing ---------------------------------------------------------
//
// Fiefdom used to borrow its identity from Cloudflare Access: put Access in
// front of the hostname, set two environment variables, and the server trusted
// the signed token at the edge. It worked, but it asked every self-hoster to
// stand up a Zero Trust application before two people could have separate
// saves -- and multiplayer needs names in a lobby, which Access was never going
// to supply.
//
// So the server keeps its own accounts now (accounts.mjs): a username, an email
// and a password, and a signed cookie that says who you are. Nothing to
// configure, nothing external to depend on. A visitor who has not signed in is
// still served the game and still gets the shared `local` save profile, exactly
// as an unauthenticated visit always did -- they just cannot join a match.
const accounts = new Accounts(DATA_DIR);
const lobby = new Lobby();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};
const GZIP_TYPES = new Set(['.js', '.css', '.json', '.svg', '.html']);

/**
 * The exact cache policy the old nginx image carried, reproduced here so an
 * update never quietly serves a stale build or a stale game asset.
 */
function cacheControl(pathname) {
  if (/^\/assets\/(tiles|sprites)\//.test(pathname)) {
    // Fixed-name game assets: a stale copy renders the WRONG world in silence,
    // so always revalidate however cheap the request.
    return 'public, max-age=0, must-revalidate';
  }
  if (pathname.startsWith('/assets/')) {
    return 'public, max-age=31536000, immutable';   // Vite-fingerprinted
  }
  if (pathname === '/' || pathname === '/index.html') {
    return 'no-cache, must-revalidate';             // or updates never take
  }
  const ext = extname(pathname).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.woff', '.woff2'].includes(ext)) {
    return 'public, max-age=2592000';
  }
  return 'no-cache';
}

// --- per-user key/value store, one JSON file each, written atomically -------

/** In-memory mirror of each user's store, so a read never touches the disk. */
const buckets = new Map();   // userId -> plain object of key -> string

/** A safe, private filename for a user: "local" as-is, an email as its hash. */
function bucketFile(userId) {
  const safe = userId === 'local'
    ? 'local'
    : createHash('sha256').update(userId).digest('hex');
  return join(USERS_DIR, `${safe}.json`);
}

async function loadBucket(userId) {
  if (buckets.has(userId)) return buckets.get(userId);
  let obj = {};
  try {
    obj = JSON.parse(await readFile(bucketFile(userId), 'utf8'));
    if (typeof obj !== 'object' || obj === null) obj = {};
  } catch { obj = {}; }
  buckets.set(userId, obj);
  return obj;
}

let writing = Promise.resolve();
/** Serialise writes and rename into place, so a crash never leaves half a file. */
function persist(userId) {
  const data = buckets.get(userId) ?? {};
  writing = writing.then(async () => {
    const file = bucketFile(userId);
    // The email is kept inside the file so a folder of hashes is still legible.
    const out = { _user: userId, ...data };
    await writeFile(`${file}.tmp`, JSON.stringify(out));
    await rename(`${file}.tmp`, file);
  }).catch(err => console.error('[store] write failed:', err.message));
  return writing;
}

/** The reserved bookkeeping key, never handed back to the client as data. */
function publicData(userId) {
  const { _user, ...rest } = buckets.get(userId) ?? {};
  void _user;
  return rest;
}

/** Move the old single shared store into the "local" bucket, once. */
async function migrateLegacy() {
  await mkdir(USERS_DIR, { recursive: true }).catch(() => {});
  try {
    await stat(bucketFile('local'));
    return;   // already have a local bucket -- nothing to migrate
  } catch { /* no local bucket yet */ }
  try {
    const old = await readFile(LEGACY_FILE, 'utf8');
    await writeFile(bucketFile('local'), old);
    await rename(LEGACY_FILE, `${LEGACY_FILE}.migrated`);
    console.log('[store] migrated the old shared store into the local profile');
  } catch { /* no legacy file -- fresh install */ }
}

// --- identity ---------------------------------------------------------------

/** The signed-in account for this request, or null. */
function accountFor(req) {
  return accounts.verifyToken(Accounts.readCookie(req));
}

/**
 * Which save bucket a request reads and writes.
 *
 * A signed-in player gets a private one keyed by account id; everyone else
 * shares `local`, which is also where the old single store was migrated to.
 * Keying on the id rather than the email means changing an address later would
 * not orphan a player's saves.
 */
function bucketFor(req) {
  const a = accountFor(req);
  return a ? `u_${a.id}` : 'local';
}

/** Cookies only get the Secure flag where the browser actually used https. */
function isSecure(req) {
  const proto = req.headers['x-forwarded-proto'];
  return String(Array.isArray(proto) ? proto[0] : proto || '').includes('https');
}

// --- helpers ----------------------------------------------------------------

function send(res, code, body, headers = {}) {
  res.writeHead(code, headers);
  res.end(body);
}

function sendJson(res, code, obj) {
  send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** A POSTed JSON body, or an empty object if it is missing or malformed. */
async function readJsonBody(req) {
  try {
    const raw = await readBody(req);
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}

/**
 * The address a request came from, for rate limiting sign-in attempts.
 *
 * Behind a Cloudflare tunnel every request arrives from the tunnel itself, so
 * the socket address would put every player in the world in one bucket. The
 * forwarded headers are trusted for this ONE purpose: the worst a spoofed value
 * can do is spread an attacker's own guesses across more buckets, which is a
 * weaker rate limit and never someone else's lockout.
 */
function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(Array.isArray(cf) ? cf[0] : cf);
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(Array.isArray(fwd) ? fwd[0] : fwd).split(',')[0].trim();
  return req.socket.remoteAddress || '?';
}

async function serveStatic(req, res, pathname) {
  // The path actually served, with a trailing slash resolved to index.html, so
  // the MIME type and cache policy below key off the real file rather than "/".
  let servePath = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  // Resolve within STATIC_DIR only -- normalize collapses any ../ climb, and a
  // path that still escapes the root is refused rather than served.
  const full = normalize(join(STATIC_DIR, decodeURIComponent(servePath)));
  if (!full.startsWith(normalize(STATIC_DIR))) { send(res, 403, 'forbidden'); return; }

  let data;
  try {
    const s = await stat(full);
    if (s.isDirectory()) throw new Error('is dir');
    data = await readFile(full);
  } catch {
    // SPA fallback: any unknown non-file path is the client router's to handle,
    // so hand back index.html -- EXCEPT /api, which must 404 as JSON so the
    // client can tell "no backend here" from "the app shell".
    if (pathname.startsWith('/api/')) { sendJson(res, 404, { ok: false, error: 'not found' }); return; }
    try { data = await readFile(join(STATIC_DIR, 'index.html')); servePath = '/index.html'; }
    catch { send(res, 404, 'not found'); return; }
  }

  const ext = extname(servePath).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': cacheControl(servePath),
  };
  // Gzip the compressible text types; the sprite PNGs gain nothing and are left
  // alone. Encoded per request -- simple, and these files are small or cached
  // hard by the browser after the first hit anyway.
  if (GZIP_TYPES.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    data = gzipSync(data);
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
  }
  send(res, 200, data, headers);
}

// --- request routing --------------------------------------------------------

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    // --- accounts ---------------------------------------------------------
    //
    // Four verbs and no more: who am I, register, sign in, sign out -- plus a
    // password change, because the alternative to offering one is a player with
    // no way to fix a password they have given away.
    if (p === '/api/auth/me' && req.method === 'GET') {
      const a = accountFor(req);
      sendJson(res, 200, { ok: true, account: Accounts.publicView(a) });
      return;
    }

    if (p.startsWith('/api/auth/') && req.method === 'POST') {
      const body = await readJsonBody(req);
      const secure = isSecure(req);

      if (p === '/api/auth/register') {
        const out = await accounts.register(body);
        if (out.error) { sendJson(res, 400, { ok: false, ...out }); return; }
        send(res, 200, JSON.stringify({ ok: true, account: Accounts.publicView(out.account) }), {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': Accounts.cookieHeader(accounts.issue(out.account.id), { secure }),
        });
        return;
      }

      if (p === '/api/auth/login') {
        const out = await accounts.login(body, clientIp(req));
        if (out.error) { sendJson(res, 401, { ok: false, ...out }); return; }
        send(res, 200, JSON.stringify({ ok: true, account: Accounts.publicView(out.account) }), {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': Accounts.cookieHeader(accounts.issue(out.account.id), { secure }),
        });
        return;
      }

      if (p === '/api/auth/logout') {
        send(res, 200, JSON.stringify({ ok: true }), {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': Accounts.cookieHeader('', { secure, clear: true }),
        });
        return;
      }

      if (p === '/api/auth/password') {
        const a = accountFor(req);
        if (!a) { sendJson(res, 401, { ok: false, error: 'Not signed in.' }); return; }
        const out = await accounts.changePassword(a.id, body);
        if (out.error) { sendJson(res, 400, { ok: false, ...out }); return; }
        sendJson(res, 200, { ok: true });
        return;
      }
    }

    // Whole store, for the client to hydrate from on boot. Also tells the client
    // who it is signed in as, so it can show that and offer a log-out.
    if (p === '/api/kv' && req.method === 'GET') {
      const account = accountFor(req);
      const user = bucketFor(req);
      await loadBucket(user);
      sendJson(res, 200, {
        ok: true, data: publicData(user),
        user: account ? account.username : 'local',
        authed: !!account,
        account: Accounts.publicView(account),
      });
      return;
    }

    // One key, in the requester's own bucket. The key rides in the path,
    // encoded, e.g. /api/kv/fiefdom.save.0
    const m = p.match(/^\/api\/kv\/(.+)$/);
    if (m) {
      const key = decodeURIComponent(m[1]);
      if (key === '_user') { sendJson(res, 403, { ok: false, error: 'reserved' }); return; }
      const user = bucketFor(req);
      const bucket = await loadBucket(user);
      if (req.method === 'PUT') {
        bucket[key] = await readBody(req);
        await persist(user);
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === 'DELETE') {
        delete bucket[key];
        await persist(user);
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === 'GET') {
        sendJson(res, 200, { ok: true, value: bucket[key] ?? null });
        return;
      }
      sendJson(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }

    if (p.startsWith('/api/')) { sendJson(res, 404, { ok: false, error: 'not found' }); return; }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'method not allowed');
      return;
    }
    await serveStatic(req, res, p);
  } catch (err) {
    console.error('[req]', err.message);
    if (!res.headersSent) send(res, 500, 'server error');
  }
});

// --- the multiplayer socket --------------------------------------------------
//
// One endpoint, /ws, and it is the only place a match is ever spoken to. The
// cookie is checked HERE and nowhere after: a socket is bound to the account
// that opened it for its whole life, so no message it later carries can claim
// to be from somebody else.
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  const account = accountFor(req);
  if (!account) {
    // Refused before the handshake, so the browser sees a plain 401 and the
    // client can say "sign in to play together" rather than "connection lost".
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  const conn = accept(req, socket, head);
  if (conn) lobby.attach(conn, account);
});

await mkdir(DATA_DIR, { recursive: true }).catch(() => {});
await migrateLegacy();
await accounts.load();
server.listen(PORT, () => {
  console.log(`[fiefdom] serving ${STATIC_DIR} on :${PORT}, data in ${DATA_DIR}`);
  console.log(`[fiefdom] accounts: ${accounts.count} registered; multiplayer on /ws`);
});
