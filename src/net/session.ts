/**
 * The signed-in player.
 *
 * Four calls against /api/auth, and a cached answer to "who am I" so the menu
 * and the lobby do not each ask. The session itself is a cookie the browser
 * carries automatically -- there is no token to keep here, which is the whole
 * reason the server signs one rather than handing out something this file would
 * have to store and refresh.
 */

export interface Account {
  id: string;
  username: string;
  email: string;
  createdAt: number;
}

/** Undefined until asked, then the account or null for a stranger. */
let cached: Account | null | undefined;

/** What the server says went wrong, and which field to point at. */
export interface AuthError {
  error: string;
  field?: 'username' | 'email' | 'password' | 'current' | 'next';
}

async function post(path: string, body: unknown): Promise<Account | AuthError> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // No server at all: the static build, or the container is down. Say that
    // rather than "wrong password", which sends people hunting for the wrong bug.
    return { error: 'Could not reach the server.' };
  }
  let json: { ok?: boolean; account?: Account; error?: string; field?: AuthError['field'] };
  try { json = await res.json(); }
  catch { return { error: 'The server gave an answer we could not read.' }; }
  if (!res.ok || !json.ok) {
    return { error: json.error ?? 'That did not work.', field: json.field };
  }
  if (json.account) cached = json.account;
  return json.account ?? { error: 'That did not work.' };
}

export function isAuthError(x: Account | AuthError): x is AuthError {
  return 'error' in x;
}

/** Who is signed in. Asks the server once, then remembers. */
export async function me(): Promise<Account | null> {
  if (cached !== undefined) return cached;
  try {
    const res = await fetch('/api/auth/me', { headers: { accept: 'application/json' } });
    // The old static image answers any unknown path with index.html at 200, so
    // a JSON content type is the only proof there is a server behind this.
    if (!res.headers.get('content-type')?.includes('application/json')) throw new Error('no api');
    const json = await res.json() as { ok?: boolean; account?: Account | null };
    cached = json.ok ? (json.account ?? null) : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** The answer to `me()` without asking, for code that cannot await. */
export function current(): Account | null {
  return cached ?? null;
}

export function register(username: string, email: string, password: string) {
  return post('/api/auth/register', { username, email, password });
}

export function login(name: string, password: string) {
  return post('/api/auth/login', { name, password });
}

export function changePassword(current_: string, next: string) {
  return post('/api/auth/password', { current: current_, next });
}

export async function logout(): Promise<void> {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* going anyway */ }
  cached = null;
}

/**
 * Whether this server can host a match at all.
 *
 * The game still runs off a plain static folder, and on one there is no /api,
 * no accounts and no lobby. Everything multiplayer is hidden in that case
 * rather than offered and then failing.
 */
export async function multiplayerAvailable(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/me', { headers: { accept: 'application/json' } });
    return !!res.headers.get('content-type')?.includes('application/json');
  } catch {
    return false;
  }
}
