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

const PORT = Number(process.env.PORT || 80);
const STATIC_DIR = process.env.STATIC_DIR || '/app/dist';
const DATA_DIR = process.env.DATA_DIR || '/data';
const KV_FILE = join(DATA_DIR, 'store.json');
/** A save or a map bundle is kilobytes; this ceiling is pure abuse-protection. */
const MAX_BODY = 16 * 1024 * 1024;

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

// --- key/value store, one JSON file, written atomically ---------------------

/** In-memory mirror of the store, so a read never touches the disk. */
let kv = {};

async function loadKv() {
  try {
    kv = JSON.parse(await readFile(KV_FILE, 'utf8'));
    if (typeof kv !== 'object' || kv === null) kv = {};
  } catch {
    kv = {};   // first run, or the file was removed -- an empty store is fine
  }
}

let writing = Promise.resolve();
/** Serialise writes and rename into place, so a crash never leaves half a file. */
function persistKv() {
  writing = writing.then(async () => {
    const tmp = `${KV_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(kv));
    await rename(tmp, KV_FILE);
  }).catch(err => console.error('[store] write failed:', err.message));
  return writing;
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

    // Whole store, for the client to hydrate from on boot.
    if (p === '/api/kv' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, data: kv });
      return;
    }

    // One key. The key rides in the path, encoded, e.g. /api/kv/fiefdom.save.0
    const m = p.match(/^\/api\/kv\/(.+)$/);
    if (m) {
      const key = decodeURIComponent(m[1]);
      if (req.method === 'PUT') {
        const body = await readBody(req);
        kv[key] = body;
        await persistKv();
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === 'DELETE') {
        delete kv[key];
        await persistKv();
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === 'GET') {
        sendJson(res, 200, { ok: true, value: kv[key] ?? null });
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
await loadKv();
server.listen(PORT, () => {
  console.log(`[fiefdom] serving ${STATIC_DIR} on :${PORT}, data in ${DATA_DIR}`);
});
