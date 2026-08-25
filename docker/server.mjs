// Fiefdom's runtime server.
//
// The game is still a pure client-side simulation; this server exists for ONE
// reason the static nginx image could not serve: durable, server-side storage
// for saved games and custom maps, so they live in a mapped /data volume on the
// host and survive a container update instead of hiding in one browser's
// localStorage. Everything else it does -- serving the built files with the
// right cache headers -- is what nginx did before, reproduced here so there is
// only one process in the container.
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
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';

const PORT = Number(process.env.PORT || 80);
const STATIC_DIR = process.env.STATIC_DIR || '/app/dist';
const DATA_DIR = process.env.DATA_DIR || '/data';
const USERS_DIR = join(DATA_DIR, 'users');
const LEGACY_FILE = join(DATA_DIR, 'store.json');   // the old single shared store
/** A save or a map bundle is kilobytes; this ceiling is pure abuse-protection. */
const MAX_BODY = 16 * 1024 * 1024;

// --- Cloudflare Access identity ---------------------------------------------
//
// When these are set (see the Unraid template / README), the server trusts only
// a Cloudflare-signed identity token, verifies its signature against the team's
// public keys, and gives each authenticated email its own private save bucket.
// A request WITHOUT a valid token -- e.g. reached over the LAN, bypassing
// Cloudflare -- falls back to the shared "local" bucket, which is also where the
// old single store migrates to. With these unset, everyone shares "local",
// exactly as before Access existed.
const ACCESS_TEAM = process.env.ACCESS_TEAM_DOMAIN || '';   // e.g. "smarthomeworld68"
const ACCESS_AUD = process.env.ACCESS_AUD || '';            // the Access app's AUD tag
const ACCESS_ISS = ACCESS_TEAM ? `https://${ACCESS_TEAM}.cloudflareaccess.com` : '';
const ACCESS_CERTS = process.env.ACCESS_CERTS_URL
  || (ACCESS_ISS ? `${ACCESS_ISS}/cdn-cgi/access/certs` : '');
/** Dev/testing ONLY: trust an `x-dev-user` header. Never enable when public. */
const DEV_ID_HEADER = process.env.DEV_IDENTITY_HEADER === '1';

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

// --- Cloudflare Access JWT verification -------------------------------------

let jwks = [];          // cached public keys
let jwksAt = 0;

function b64url(s) { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }

async function refreshJwks() {
  try {
    const res = await fetch(ACCESS_CERTS);
    const j = await res.json();
    if (Array.isArray(j.keys)) { jwks = j.keys; jwksAt = Date.now(); }
  } catch (e) {
    console.warn('[access] could not fetch certs:', e.message);
  }
}

/**
 * Verify a Cloudflare Access token and return the authenticated email, or null.
 *
 * Checks the RS256 signature against Cloudflare's published keys and the token's
 * expiry, issuer and (when set) audience. Anything that does not check out is
 * null, which the caller reads as "not this user" and falls back to local.
 */
async function verifyAccessJwt(token) {
  try {
    const [h, p, s] = token.split('.');
    if (!s) return null;
    const header = JSON.parse(b64url(h).toString('utf8'));
    const payload = JSON.parse(b64url(p).toString('utf8'));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    if (ACCESS_ISS && payload.iss !== ACCESS_ISS) return null;
    if (ACCESS_AUD) {
      const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!aud.includes(ACCESS_AUD)) return null;
    }
    const find = () => jwks.find(k => k.kid === header.kid);
    if (!find() || Date.now() - jwksAt > 3_600_000) await refreshJwks();
    const jwk = find();
    if (!jwk) return null;
    const pub = createPublicKey({ key: jwk, format: 'jwk' });
    const ok = cryptoVerify('RSA-SHA256', Buffer.from(`${h}.${p}`), pub, b64url(s));
    if (!ok) return null;
    const email = (payload.email || payload.identity || '').toLowerCase();
    return email || null;
  } catch {
    return null;
  }
}

/** The Access token, from the header Cloudflare sets or the cookie it drops. */
function accessToken(req) {
  const h = req.headers['cf-access-jwt-assertion'];
  if (h) return Array.isArray(h) ? h[0] : h;
  const m = (req.headers.cookie || '').match(/CF_Authorization=([^;]+)/);
  return m ? m[1] : null;
}

/** Who is making this request. An email when signed in, else "local". */
async function identify(req) {
  if (ACCESS_ISS) {
    const tok = accessToken(req);
    if (tok) { const email = await verifyAccessJwt(tok); if (email) return email; }
    return 'local';
  }
  if (DEV_ID_HEADER && req.headers['x-dev-user']) {
    return String(req.headers['x-dev-user']).toLowerCase();
  }
  return 'local';
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

    // Whole store, for the client to hydrate from on boot. Also tells the client
    // who it is signed in as, so it can show that and offer a log-out.
    if (p === '/api/kv' && req.method === 'GET') {
      const user = await identify(req);
      await loadBucket(user);
      sendJson(res, 200, {
        ok: true, data: publicData(user),
        user, authed: user !== 'local',
      });
      return;
    }

    // One key, in the requester's own bucket. The key rides in the path,
    // encoded, e.g. /api/kv/fiefdom.save.0
    const m = p.match(/^\/api\/kv\/(.+)$/);
    if (m) {
      const key = decodeURIComponent(m[1]);
      if (key === '_user') { sendJson(res, 403, { ok: false, error: 'reserved' }); return; }
      const user = await identify(req);
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

await mkdir(DATA_DIR, { recursive: true }).catch(() => {});
await migrateLegacy();
if (ACCESS_ISS) await refreshJwks();   // warm the key cache when Access is on
server.listen(PORT, () => {
  const mode = ACCESS_ISS ? `Cloudflare Access (${ACCESS_TEAM})`
    : DEV_ID_HEADER ? 'dev identity header' : 'single shared profile';
  console.log(`[fiefdom] serving ${STATIC_DIR} on :${PORT}, data in ${DATA_DIR}`);
  console.log(`[fiefdom] logins: ${mode}`);
});
