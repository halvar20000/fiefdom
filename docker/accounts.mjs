// Player accounts: registration, login, and the signed cookie that carries a
// session.
//
// Fiefdom was a single-player game served off a folder, so "who are you" was a
// question nobody had to answer -- the optional Cloudflare Access path let the
// edge answer it instead. Multiplayer makes it unavoidable: a lobby needs names
// to show, and a match needs to know that the player who reconnects is the same
// one who left. So the server grew accounts of its own.
//
// Kept as small as the rest of this server: no database, no npm, one JSON file
// under /data, and passwords stored only as a scrypt hash. Sessions are
// STATELESS -- an HMAC-signed cookie -- so there is no session table to grow, to
// prune, or to lose on a restart.
//
// Deliberately NOT here: email verification. The email is an identifier and a
// way to reach a player, nothing more; there is no SMTP server to depend on and
// no unverified-account limbo to explain. If verification is ever wanted, every
// account already carries a `verified` flag for it to set.

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

/** How long a login lasts before the player has to type the password again. */
const SESSION_DAYS = 30;
/** scrypt output length. 64 bytes is the usual comfortable choice. */
const KEY_LEN = 64;

export const USERNAME_RE = /^[a-zA-Z0-9_-]{3,16}$/;
// Deliberately loose. A stricter regex rejects real addresses far more often
// than it catches a typo, and there is no verification mail riding on it.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 8;

/**
 * Everyone who has ever registered, and the secret that signs their sessions.
 *
 * One file for the lot. A self-hosted game has tens of players, not millions,
 * and a single atomic rewrite is both simpler and safer than a directory of
 * files that can go half-written.
 */
export class Accounts {
  #file;
  #secretFile;
  #accounts = [];
  #secret = null;
  #writing = Promise.resolve();
  /** ip -> { n, until }: failed sign-in attempts, so guessing costs something. */
  #attempts = new Map();

  constructor(dataDir) {
    this.#file = join(dataDir, 'accounts.json');
    this.#secretFile = join(dataDir, 'session-secret');
  }

  async load() {
    await mkdir(join(this.#file, '..'), { recursive: true }).catch(() => {});
    try {
      const raw = JSON.parse(await readFile(this.#file, 'utf8'));
      if (Array.isArray(raw?.accounts)) this.#accounts = raw.accounts;
    } catch { /* no accounts yet -- a fresh server */ }
    try {
      this.#secret = Buffer.from((await readFile(this.#secretFile, 'utf8')).trim(), 'hex');
      if (this.#secret.length < 16) throw new Error('short');
    } catch {
      // A NEW secret invalidates every outstanding cookie, which is the right
      // behaviour when the old one could not be read: better everyone signs in
      // again than sessions signed by a secret nobody can verify.
      this.#secret = randomBytes(32);
      await writeFile(this.#secretFile, this.#secret.toString('hex'), { mode: 0o600 })
        .catch(err => console.error('[accounts] could not save the session secret:', err.message));
    }
    console.log(`[accounts] ${this.#accounts.length} registered`);
  }

  #persist() {
    const snapshot = JSON.stringify({ version: 1, accounts: this.#accounts });
    this.#writing = this.#writing.then(async () => {
      await writeFile(`${this.#file}.tmp`, snapshot);
      await rename(`${this.#file}.tmp`, this.#file);
    }).catch(err => console.error('[accounts] write failed:', err.message));
    return this.#writing;
  }

  get count() { return this.#accounts.length; }

  byId(id) { return this.#accounts.find(a => a.id === id) ?? null; }

  /** Sign-in accepts either the username or the email, so nobody has to remember which. */
  #byLogin(name) {
    const k = String(name || '').trim().toLowerCase();
    return this.#accounts.find(a => a.usernameLower === k || a.emailLower === k) ?? null;
  }

  /** What the client is allowed to see about an account -- never the hash. */
  static publicView(a) {
    return a && { id: a.id, username: a.username, email: a.email, createdAt: a.createdAt };
  }

  // --- passwords ------------------------------------------------------------

  async #hash(password, salt) {
    return (await scrypt(password, salt, KEY_LEN)).toString('hex');
  }

  async #verify(account, password) {
    const got = Buffer.from(await this.#hash(password, account.salt), 'hex');
    const want = Buffer.from(account.hash, 'hex');
    // Lengths differ only if the stored hash is corrupt, and timingSafeEqual
    // throws rather than returning false in that case.
    return got.length === want.length && timingSafeEqual(got, want);
  }

  // --- rate limiting --------------------------------------------------------
  //
  // Crude on purpose: a counter per address, cleared on success. It is not
  // trying to stop a botnet, only to make "try the ten thousand worst passwords"
  // slower than giving up.

  #throttled(ip) {
    const rec = this.#attempts.get(ip);
    if (!rec) return 0;
    if (Date.now() > rec.until) { this.#attempts.delete(ip); return 0; }
    return rec.n >= 10 ? Math.ceil((rec.until - Date.now()) / 1000) : 0;
  }

  #failed(ip) {
    const rec = this.#attempts.get(ip) ?? { n: 0, until: 0 };
    rec.n++;
    rec.until = Date.now() + 15 * 60_000;
    this.#attempts.set(ip, rec);
  }

  // --- the three things a player can do -------------------------------------

  /**
   * Register. Returns { error } for anything the player can fix, so the form
   * can say which field is wrong rather than "registration failed".
   */
  async register({ username, email, password }) {
    username = String(username ?? '').trim();
    email = String(email ?? '').trim();
    password = String(password ?? '');

    if (!USERNAME_RE.test(username)) {
      return { error: 'A username is 3 to 16 letters, digits, - or _.', field: 'username' };
    }
    if (!EMAIL_RE.test(email)) {
      return { error: 'That does not look like an email address.', field: 'email' };
    }
    if (password.length < MIN_PASSWORD) {
      return { error: `A password needs at least ${MIN_PASSWORD} characters.`, field: 'password' };
    }
    const usernameLower = username.toLowerCase();
    const emailLower = email.toLowerCase();
    if (this.#accounts.some(a => a.usernameLower === usernameLower)) {
      return { error: 'That name is taken.', field: 'username' };
    }
    if (this.#accounts.some(a => a.emailLower === emailLower)) {
      return { error: 'There is already an account for that address.', field: 'email' };
    }

    const salt = randomBytes(16).toString('hex');
    const account = {
      id: randomBytes(9).toString('base64url'),
      username, usernameLower, email, emailLower,
      salt, hash: await this.#hash(password, salt),
      // No mail is sent, so nothing can flip this yet. It exists so that adding
      // verification later is a change to the login check and not a migration.
      verified: false,
      createdAt: Date.now(), lastSeen: Date.now(),
    };
    this.#accounts.push(account);
    await this.#persist();
    console.log(`[accounts] registered ${username}`);
    return { account };
  }

  async login({ name, password }, ip = '?') {
    const wait = this.#throttled(ip);
    if (wait) return { error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.` };

    const account = this.#byLogin(name);
    // One message for both halves: saying WHICH was wrong tells a stranger
    // whether a name exists.
    const no = { error: 'Wrong name or password.' };
    if (!account) { this.#failed(ip); return no; }
    if (!await this.#verify(account, String(password ?? ''))) { this.#failed(ip); return no; }

    this.#attempts.delete(ip);
    account.lastSeen = Date.now();
    void this.#persist();
    return { account };
  }

  async changePassword(id, { current, next }) {
    const account = this.byId(id);
    if (!account) return { error: 'No such account.' };
    if (!await this.#verify(account, String(current ?? ''))) {
      return { error: 'That is not your current password.', field: 'current' };
    }
    if (String(next ?? '').length < MIN_PASSWORD) {
      return { error: `A password needs at least ${MIN_PASSWORD} characters.`, field: 'next' };
    }
    account.salt = randomBytes(16).toString('hex');
    account.hash = await this.#hash(next, account.salt);
    await this.#persist();
    return { account };
  }

  // --- stateless sessions ---------------------------------------------------

  /**
   * A cookie value: the account id, when it expires, and an HMAC over both.
   *
   * Nothing secret rides in it, and it cannot be edited: changing either half
   * breaks the signature. Its whole security rests on the secret staying in
   * /data, which is the same thing the saves rest on.
   */
  issue(accountId) {
    const exp = Date.now() + SESSION_DAYS * 86_400_000;
    const body = `${accountId}.${exp}`;
    return `${body}.${this.#sign(body)}`;
  }

  #sign(body) {
    return createHmac('sha256', this.#secret).update(body).digest('base64url');
  }

  /** The account a cookie names, or null if it is missing, stale or forged. */
  verifyToken(token) {
    if (typeof token !== 'string') return null;
    const i = token.lastIndexOf('.');
    if (i < 0) return null;
    const body = token.slice(0, i), sig = token.slice(i + 1);
    const want = Buffer.from(this.#sign(body));
    const got = Buffer.from(sig);
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    const dot = body.lastIndexOf('.');
    const id = body.slice(0, dot);
    const exp = Number(body.slice(dot + 1));
    if (!Number.isFinite(exp) || Date.now() > exp) return null;
    return this.byId(id);
  }

  static COOKIE = 'fiefdom_session';

  /** The Set-Cookie for a fresh session, or for clearing one. */
  static cookieHeader(value, { secure, clear = false } = {}) {
    const bits = [
      `${Accounts.COOKIE}=${clear ? '' : value}`,
      'Path=/', 'HttpOnly', 'SameSite=Lax',
      clear ? 'Max-Age=0' : `Max-Age=${SESSION_DAYS * 86_400}`,
    ];
    if (secure) bits.push('Secure');
    return bits.join('; ');
  }

  static readCookie(req) {
    const m = (req.headers.cookie || '').match(
      new RegExp(`(?:^|;\\s*)${Accounts.COOKIE}=([^;]+)`));
    return m ? m[1] : null;
  }
}
