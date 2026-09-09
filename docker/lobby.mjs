// The lobby, and the relay a running match talks through.
//
// The server does NOT simulate the game. Fiefdom's world lives in the browser
// and always has; porting nineteen thousand lines of simulation into this file
// to make multiplayer work would be a rewrite, not a feature. So the model is
// the one the code already had: each player's browser is authoritative over its
// OWN castle -- its economy, its buildings, its soldiers -- and tells everyone
// else what that castle is doing. Whoever hosts also runs the AI lords.
//
// That makes this file a switchboard: it knows who is in which match, it knows
// the seats and the map, and it forwards `sim` messages between the players of
// a match without looking inside them. Everything about how a castle works
// stays in the game, where it can be read alongside the rest of it.
//
// The honest cost of that choice: a player who edits their own client can lie
// about their own castle. For a game you host for people you know, that is the
// same trust boundary the save API already had. It is written down in the
// README rather than pretended away.

/** A match with nobody left in it is swept after this long. */
const EMPTY_GRACE_MS = 60_000;
/** Chat and names are shown to other players, so they are length-capped here. */
const MAX_CHAT = 300;
const MAX_NAME = 40;

let nextMatchId = 1;

/** Trim, cap, and drop the control characters that would corrupt a chat line. */
function clean(s, max) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

export class Lobby {
  /** id -> match */
  #matches = new Map();
  /** Connections watching the match list (i.e. sitting on the lobby screen). */
  #watchers = new Set();

  // --- what a client can see -----------------------------------------------

  /** One row of the match list: enough to decide whether to join. */
  #row(m) {
    return {
      id: m.id, name: m.name, host: m.players[0]?.username ?? '-',
      map: m.map?.name ?? '-', mode: m.mode, difficulty: m.difficulty,
      players: m.players.filter(p => p.here).length, max: m.maxPlayers,
      ai: m.aiLords, state: m.state, createdAt: m.createdAt,
    };
  }

  /** The whole match, as its own members see it. */
  #view(m) {
    return {
      id: m.id, name: m.name, mode: m.mode, difficulty: m.difficulty,
      aiLords: m.aiLords, maxPlayers: m.maxPlayers, state: m.state,
      map: m.map,
      players: m.players.map(p => ({
        slot: p.slot, username: p.username, team: p.team,
        ready: p.ready, here: p.here, host: p.slot === 0,
      })),
      seats: m.seats,
    };
  }

  #pushLobby() {
    const rows = [...this.#matches.values()]
      .filter(m => m.state !== 'over')
      .map(m => this.#row(m))
      .sort((a, b) => b.createdAt - a.createdAt);
    const text = JSON.stringify({ t: 'lobby', matches: rows });
    for (const c of this.#watchers) c.sendRaw(text);
  }

  #pushMatch(m) {
    const text = JSON.stringify({ t: 'match', match: this.#view(m) });
    for (const p of m.players) if (p.here) p.conn.sendRaw(text);
    this.#pushLobby();
  }

  #note(m, msg) {
    const text = JSON.stringify({ t: 'note', msg });
    for (const p of m.players) if (p.here) p.conn.sendRaw(text);
  }

  // --- connection lifecycle -------------------------------------------------

  attach(conn, account) {
    conn.data.account = account;
    conn.data.matchId = null;
    conn.send({ t: 'hello', user: { id: account.id, username: account.username } });
    conn.onMessage = msg => this.#dispatch(conn, msg);
    conn.onClose = () => this.#gone(conn);
  }

  #gone(conn) {
    this.#watchers.delete(conn);
    const m = this.#matches.get(conn.data.matchId);
    if (!m) return;
    const p = m.players.find(x => x.conn === conn);
    if (!p) return;
    p.here = false;
    p.conn = null;
    conn.data.matchId = null;

    // A match still being set up loses the chair entirely; one already running
    // keeps it, because that player's castle is still standing and they may
    // well be reloading the tab rather than leaving for good.
    if (m.state === 'lobby') {
      const wasHost = p.slot === 0;
      m.players = m.players.filter(x => x !== p);
      m.players.forEach((x, i) => { x.slot = i; });
      // The host leaving before the start takes the match with them: the seats,
      // the map and the AI lords were all theirs to choose.
      if (wasHost || !m.players.length) {
        this.#matches.delete(m.id);
        this.#note(m, 'The host left. This match is closed.');
        for (const x of m.players) {
          if (!x.here) continue;
          x.conn.data.matchId = null;
          this.#watchers.add(x.conn);
          x.conn.send({ t: 'match', match: null });
        }
        this.#pushLobby();
        return;
      }
    }

    this.#note(m, `${p.username} left.`);
    this.#pushMatch(m);
    if (!m.players.some(x => x.here)) this.#sweepLater(m.id);
  }

  #sweepLater(id) {
    const timer = setTimeout(() => {
      const m = this.#matches.get(id);
      if (m && !m.players.some(x => x.here)) {
        this.#matches.delete(id);
        this.#pushLobby();
      }
    }, EMPTY_GRACE_MS);
    timer.unref?.();
  }

  // --- routing --------------------------------------------------------------

  #dispatch(conn, msg) {
    const fail = why => conn.send({ t: 'err', msg: why });
    switch (msg.t) {
      case 'sub': this.#watchers.add(conn); this.#pushLobby(); return;
      case 'unsub': this.#watchers.delete(conn); return;
      case 'create': return this.#create(conn, msg, fail);
      case 'join': return this.#join(conn, msg, fail);
      case 'leave': return this.#leave(conn);
      case 'ready': return this.#seatChange(conn, p => { p.ready = !!msg.on; });
      case 'team': return this.#seatChange(conn, p => {
        const t = Number(msg.team);
        if (Number.isInteger(t) && t >= 1 && t <= 8) p.team = t;
      });
      case 'chat': return this.#chat(conn, msg);
      case 'start': return this.#start(conn, msg, fail);
      case 'sim': return this.#relay(conn, msg);
      case 'over': return this.#over(conn, msg);
      default: fail(`unknown message: ${msg.t}`);
    }
  }

  #mine(conn) {
    const m = this.#matches.get(conn.data.matchId);
    if (!m) return [null, null];
    return [m, m.players.find(p => p.conn === conn) ?? null];
  }

  #create(conn, msg, fail) {
    if (conn.data.matchId) return fail('You are already in a match.');
    const map = msg.map;
    if (!map || typeof map.name !== 'string') return fail('That match has no map.');
    const m = {
      id: String(nextMatchId++),
      name: clean(msg.name, MAX_NAME) || `${conn.data.account.username}'s war`,
      map,
      mode: msg.mode === 'coop' ? 'coop' : 'versus',
      aiLords: Math.max(0, Math.min(6, Number(msg.aiLords) || 0)),
      maxPlayers: Math.max(2, Math.min(4, Number(msg.maxPlayers) || 2)),
      difficulty: ['easy', 'normal', 'heavy'].includes(msg.difficulty) ? msg.difficulty : 'normal',
      state: 'lobby', createdAt: Date.now(),
      players: [], seats: null,
    };
    this.#matches.set(m.id, m);
    this.#sit(m, conn);
    this.#pushMatch(m);
  }

  #sit(m, conn) {
    const slot = m.players.length;
    m.players.push({
      slot, conn, here: true, out: false,
      accountId: conn.data.account.id,
      username: conn.data.account.username,
      // Co-op puts every human on one side by default; versus gives each their
      // own. Either can be changed in the lobby -- the mode only picks the
      // sensible starting arrangement.
      team: m.mode === 'coop' ? 1 : slot + 1,
      ready: false,
    });
    conn.data.matchId = m.id;
    this.#watchers.delete(conn);
  }

  #join(conn, msg, fail) {
    if (conn.data.matchId) return fail('You are already in a match.');
    const m = this.#matches.get(String(msg.id));
    if (!m) return fail('That match is gone.');

    // Rejoining a match you are already seated in -- a reload, a dropped
    // connection -- is a reconnect, not a new chair.
    const seat = m.players.find(p => p.accountId === conn.data.account.id);
    if (seat) {
      seat.conn = conn;
      seat.here = true;
      conn.data.matchId = m.id;
      this.#watchers.delete(conn);
      this.#note(m, `${seat.username} is back.`);
      this.#pushMatch(m);
      if (m.state === 'playing') {
        conn.send({ t: 'begin', match: this.#view(m), you: seat.slot, rejoin: true });
      }
      return;
    }

    if (m.state !== 'lobby') return fail('That match has already started.');
    if (m.players.filter(p => p.here).length >= m.maxPlayers) return fail('That match is full.');
    this.#sit(m, conn);
    this.#note(m, `${conn.data.account.username} joined.`);
    this.#pushMatch(m);
  }

  #leave(conn) {
    const [m] = this.#mine(conn);
    conn.send({ t: 'match', match: null });
    if (!m) return;
    this.#gone(conn);
    // #gone assumes the socket died; a deliberate leave keeps it, back on the
    // lobby screen and watching the list.
    this.#watchers.add(conn);
    this.#pushLobby();
  }

  #seatChange(conn, apply) {
    const [m, p] = this.#mine(conn);
    if (!m || !p || m.state !== 'lobby') return;
    apply(p);
    this.#pushMatch(m);
  }

  #chat(conn, msg) {
    const [m, p] = this.#mine(conn);
    if (!m || !p) return;
    const text = clean(msg.text, MAX_CHAT);
    if (!text) return;
    const out = JSON.stringify({
      t: 'chat', from: p.username, slot: p.slot, text, at: Date.now(),
    });
    for (const x of m.players) if (x.here) x.conn.sendRaw(out);
  }

  /**
   * Begin.
   *
   * The host sends the seats, because the host chose them on the placement
   * screen -- the same screen single-player uses, so the map you place a keep
   * on is the map you wake up in. The server checks there is one for everybody
   * and then tells each player which seat is theirs.
   */
  #start(conn, msg, fail) {
    const [m, p] = this.#mine(conn);
    if (!m || !p) return fail('You are not in a match.');
    if (p.slot !== 0) return fail('Only the host can start the match.');
    if (m.state !== 'lobby') return fail('Already started.');
    const here = m.players.filter(x => x.here);
    if (here.length < 2) return fail('A multiplayer match needs at least two players.');
    if (here.some(x => !x.ready && x.slot !== 0)) return fail('Not everyone is ready.');

    const seats = Array.isArray(msg.seats) ? msg.seats : null;
    const want = here.length + m.aiLords;
    if (!seats || seats.length < want) return fail('The map has no seat for everyone.');
    m.seats = seats.slice(0, want).map(s => ({ x: Math.round(s.x), z: Math.round(s.z) }));
    m.state = 'playing';
    m.startedAt = Date.now();

    for (const x of m.players) {
      if (!x.here) continue;
      x.conn.send({ t: 'begin', match: this.#view(m), you: x.slot });
      this.#watchers.delete(x.conn);
    }
    this.#pushLobby();
  }

  /**
   * Pass a simulation message to the other players of the match.
   *
   * The payload is never inspected: what a castle broadcasts is the game's
   * business, and a server that had to understand it would have to be updated
   * in step with every change to the simulation.
   */
  #relay(conn, msg) {
    const [m, p] = this.#mine(conn);
    if (!m || !p) return;
    msg.from = p.slot;
    const text = JSON.stringify(msg);
    // `to` addresses one player: a blow lands on somebody's castle in
    // particular, and sending it to the other three is waste at ten a second.
    const to = Number.isInteger(msg.to) ? msg.to : null;
    for (const x of m.players) {
      if (!x.here || x === p) continue;
      if (to !== null && x.slot !== to) continue;
      x.conn.sendRaw(text);
    }
  }

  #over(conn, msg) {
    const [m, p] = this.#mine(conn);
    if (!m || !p) return;
    p.out = true;
    const text = JSON.stringify({ t: 'out', slot: p.slot, win: !!msg.win });
    for (const x of m.players) if (x.here && x !== p) x.conn.sendRaw(text);
    if (m.players.filter(x => x.here && !x.out).length <= 1) {
      m.state = 'over';
      this.#pushLobby();
    }
  }
}
