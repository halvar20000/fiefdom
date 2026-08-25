/**
 * Durable storage for saves and custom maps.
 *
 * The game shipped as a static site, so both lived in the browser's
 * localStorage -- which is tied to one browser AND one exact URL, and looked
 * like it vanished the moment you opened the game from a different address. On a
 * self-hosted server the fix is to keep them on the SERVER: the container now
 * carries a tiny key/value API (see docker/server.mjs) writing to a mounted
 * /data volume, so the data survives updates and is the same in every browser.
 *
 * This module is a localStorage-shaped front for that API, which is why the rest
 * of the code changes by one import. Three properties make it safe:
 *
 *  - It MIRRORS every write to real localStorage too, so there is always a local
 *    copy and nothing is lost if the server is later removed.
 *  - It FALLS BACK to plain localStorage when no server answers, so the game
 *    still runs on the old static image, offline, or before `hydrate` finishes.
 *  - On first contact it MIGRATES any local-only saves up to an empty server,
 *    so upgrading to this image adopts the saves you already had.
 */

/** True once a real backend has answered; until then we are localStorage-only. */
let serverUp = false;

/** Who the server says we are: an email when signed in via Access, else null. */
let user: string | null = null;
let authed = false;

/** The server's view, loaded once at boot. Authoritative while `serverUp`. */
const cache = new Map<string, string>();

/** Game data that belongs on the server. Browser-only prefs (volume, last-seen
 *  version) are deliberately NOT here -- those are per-browser by nature. */
const OWNED = /^fiefdom\.(save\.|maps)/;

async function push(key: string, value: string): Promise<void> {
  try {
    await fetch(`/api/kv/${encodeURIComponent(key)}`, {
      method: 'PUT', headers: { 'content-type': 'text/plain' }, body: value,
    });
  } catch (e) {
    console.warn('[store] could not save to the server:', key, e);
  }
}

async function drop(key: string): Promise<void> {
  try {
    await fetch(`/api/kv/${encodeURIComponent(key)}`, { method: 'DELETE' });
  } catch (e) {
    console.warn('[store] could not delete on the server:', key, e);
  }
}

/** Copy any local-only game data onto a server that does not have it yet. */
function migrateUp(): void {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !OWNED.test(k) || cache.has(k)) continue;   // server wins on conflict
      const v = localStorage.getItem(k);
      if (v == null) continue;
      cache.set(k, v);
      void push(k, v);
    }
  } catch { /* localStorage blocked -- nothing to migrate */ }
}

/**
 * Contact the backend and load its store. Call once, and await it, before
 * anything reads a save. Never throws: a missing or slow server just leaves us
 * in localStorage-only mode.
 */
export async function hydrate(): Promise<void> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);   // never hang the boot
    const res = await fetch('/api/kv', {
      headers: { accept: 'application/json' }, signal: ctrl.signal,
    });
    clearTimeout(timer);
    // The old static image answers /api/kv with the SPA's index.html at 200, so
    // a JSON body with ok:true is the only proof a real backend is present.
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || !ct.includes('application/json')) throw new Error('no backend');
    const body = await res.json() as {
      ok?: boolean; data?: Record<string, unknown>; user?: string; authed?: boolean;
    };
    if (body.ok !== true || typeof body.data !== 'object' || !body.data) {
      throw new Error('bad response');
    }
    serverUp = true;
    user = typeof body.user === 'string' && body.user !== 'local' ? body.user : null;
    authed = body.authed === true;
    for (const [k, v] of Object.entries(body.data)) {
      if (typeof v === 'string') cache.set(k, v);
    }
    // Only fold a browser's local saves up into a SHARED (local) profile. A
    // signed-in player gets their own private bucket and must not inherit
    // whatever happened to be in this browser -- that could be someone else's.
    if (!authed) migrateUp();
    console.log(`[store] server-backed storage active${user ? ` as ${user}` : ''}`);
  } catch {
    serverUp = false;   // localStorage-only, exactly as before
  }
}

/** Whether saves are being kept on the server. For the UI to reassure the user. */
export function isServerBacked(): boolean {
  return serverUp;
}

/** The signed-in player's email, or null when playing the shared local profile. */
export function currentUser(): string | null {
  return user;
}

/** True when a real per-person login (Cloudflare Access) is in force. */
export function isSignedIn(): boolean {
  return authed;
}

/**
 * A drop-in for the parts of `localStorage` the game uses for saves and maps.
 * Reads come from the server's cache when it is up, else from localStorage;
 * writes always mirror to localStorage and additionally push to the server.
 */
export const store = {
  getItem(key: string): string | null {
    if (serverUp) return cache.has(key) ? cache.get(key)! : null;
    try { return localStorage.getItem(key); } catch { return null; }
  },
  setItem(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* mirror is best-effort */ }
    if (serverUp) { cache.set(key, value); void push(key, value); }
  },
  removeItem(key: string): void {
    try { localStorage.removeItem(key); } catch { /* mirror is best-effort */ }
    if (serverUp) { cache.delete(key); void drop(key); }
  },
};
