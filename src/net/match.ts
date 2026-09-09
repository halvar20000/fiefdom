/**
 * A match in progress, as one player's client sees it.
 *
 * This is the whole of multiplayer that is not either the lobby or the game:
 * who is playing, who is allied with whom, what everyone else's castle looked
 * like a fraction of a second ago, and the outgoing side of saying what mine is
 * doing.
 *
 * The model, stated once here because everything below assumes it:
 *
 *   Every faction on the map has exactly one OWNER -- a player whose browser
 *   simulates it. Your own castle is yours. Each other human's castle is
 *   theirs. The AI lords all belong to the host, who runs them exactly as
 *   single-player always did. An owner broadcasts what its factions look like;
 *   everyone else replicates that and does not simulate it.
 *
 * The consequence that makes it work: nothing is ever simulated twice, so there
 * is nothing for two clients to disagree about. The consequence that has to be
 * lived with: when you strike someone else's soldier you do not decide he dies
 * -- you tell his owner you hit him, and the answer comes back in their next
 * snapshot, a fraction of a second later.
 *
 * SIDE NUMBERING is the fiddly part and is confined to this file. On the wire,
 * side 0 is the player in slot 0, side 1 slot 1, and the AI lords follow after
 * the humans. In the game, side 0 means *me* -- `PLAYER`, which several hundred
 * lines of existing code test against. `local()` and `global()` convert, and
 * they are the same function: swapping my slot with 0 is its own inverse.
 */

import type {
  MatchView, MatchPlayer, MatchMode, NetBuilding, NetSoldier, SimMessage,
} from './protocol';
import { RATE } from './protocol';
import type { Net } from './socket';
import type { MapDef } from '../game/maps';
import type { Difficulty } from '../game/lord';

/**
 * Teams for the AI lords, well clear of the 1..8 a human can pick.
 *
 * One team EACH, not one between them, because rival lords wrecking each
 * other's castles is single-player behaviour worth keeping: the AI reads "not
 * my team" as a target, and lords who shared a team would sit politely side by
 * side.
 */
const AI_TEAM_BASE = 100;

/** A faction somebody else owns, as last heard. */
export interface RemoteFaction {
  /** Global side. */
  g: number;
  buildings: NetBuilding[];
  soldiers: NetSoldier[];
  keep: { x: number; z: number } | null;
  defeated: boolean;
  /** Set when new data arrives, cleared by the game once it has been applied. */
  buildingsDirty: boolean;
  soldiersDirty: boolean;
  /** When we last heard anything at all, for showing a player as out of touch. */
  heardAt: number;
}

/** A blow somebody else struck on something of mine, waiting to be applied. */
export interface IncomingHit {
  /** Which of my factions was hit -- mine, or an AI lord's if I am the host. */
  g: number;
  kind: 'b' | 'u' | 'w';
  /** My own id for the building, soldier, or the building a labourer works. */
  i: number;
  n: number;
}

export class MatchRuntime {
  readonly id: string;
  readonly map: MapDef;
  readonly mode: MatchMode;
  readonly difficulty: Difficulty;
  readonly aiLords: number;
  readonly seats: { x: number; z: number }[];
  /** My slot, which is also my global side. */
  readonly you: number;
  players: MatchPlayer[];

  /** Global side -> what its owner last said about it. */
  readonly remote = new Map<number, RemoteFaction>();
  /** Blows struck on my things, drained by the game each frame. */
  readonly hits: IncomingHit[] = [];
  /** Trees other players have felled, so every screen shows the same stumps. */
  readonly felled: number[] = [];
  /** Ground others have set alight. */
  readonly fires: { x: number; z: number }[] = [];
  /** Players who have finished, and how. Drained by the game to report it. */
  readonly finished: { slot: number; win: boolean }[] = [];
  /** Lines for the in-game chat panel. */
  readonly chat: { from: string; text: string; at: number }[] = [];
  /** Set when the connection drops, so the game can say so on screen. */
  connected = true;

  private stop: () => void;
  private castleAt = -Infinity;
  private castleDirty = true;
  private armyAt = -Infinity;
  private clock = 0;

  constructor(view: MatchView, you: number, private net: Net) {
    this.id = view.id;
    this.map = view.map;
    this.mode = view.mode;
    this.difficulty = view.difficulty;
    this.aiLords = view.aiLords;
    this.you = you;
    this.players = view.players;
    this.seats = view.seats ?? [];

    for (const p of view.players) if (p.slot !== you) this.blank(p.slot);
    for (let k = 0; k < view.aiLords; k++) {
      // The AI lords are the host's to run, so everyone else replicates them and
      // the host itself does not.
      if (!this.host) this.blank(this.humanCount + k);
    }

    this.stop = net.on(msg => this.receive(msg));
    net.onStatus(s => { this.connected = s === 'open'; });
  }

  /** Done with this match: stop listening, but leave the socket for the lobby. */
  dispose(): void { this.stop(); }

  private blank(g: number): void {
    this.remote.set(g, {
      g, buildings: [], soldiers: [], keep: null, defeated: false,
      buildingsDirty: false, soldiersDirty: false, heardAt: 0,
    });
  }

  // --- who is who -----------------------------------------------------------

  get host(): boolean { return this.you === 0; }
  get humanCount(): number { return this.players.length; }

  /**
   * Every faction that is not mine, in the order the game creates them.
   *
   * Local faction ids run 1, 2, 3..., and `local()` maps each wire side to
   * exactly one of them; sorting by that number makes the i-th faction the one
   * whose local id is i+1. Both the game and the code that seats the keeps read
   * this, so there is one definition of the order and no way for them to
   * disagree about who is who.
   */
  get rivalSides(): number[] {
    return [...Array(this.humanCount + this.aiLords).keys()]
      .filter(g => g !== this.you)
      .sort((a, b) => this.local(a) - this.local(b));
  }

  /** Global sides of the AI lords, which only the host simulates. */
  get aiSides(): number[] {
    return Array.from({ length: this.aiLords }, (_, k) => this.humanCount + k);
  }

  /** Every faction I simulate: my own, plus the AI lords if I am the host. */
  get mine(): number[] {
    return this.host ? [this.you, ...this.aiSides] : [this.you];
  }

  /** Which player's browser simulates a faction. The host runs the AI lords. */
  ownerOf(g: number): number {
    return g < this.humanCount ? g : 0;
  }

  /**
   * Wire side <-> game side.
   *
   * A swap of my slot with 0, which is its own inverse -- so one function
   * converts in both directions and there is no way to apply it the wrong way
   * round. The AI lords sit above every human slot and are untouched by it.
   */
  local(globalSide: number): number {
    if (globalSide === this.you) return 0;
    if (globalSide === 0) return this.you;
    return globalSide;
  }

  global(localSide: number): number {
    return this.local(localSide);
  }

  teamOfGlobal(g: number): number {
    const p = this.players.find(x => x.slot === g);
    if (p) return p.team;
    return AI_TEAM_BASE + (g - this.humanCount);
  }

  /** Do these two game-side numbers fight each other? */
  hostile(a: number, b: number): boolean {
    if (a === b) return false;
    return this.teamOfGlobal(this.global(a)) !== this.teamOfGlobal(this.global(b));
  }

  nameOfGlobal(g: number): string {
    return this.players.find(x => x.slot === g)?.username
      ?? `AI lord ${g - this.humanCount + 1}`;
  }

  /** Everyone on my side, me included. For the "your ally is under attack" case. */
  alliesOf(g: number): number[] {
    const team = this.teamOfGlobal(g);
    return this.players.filter(p => p.team === team).map(p => p.slot);
  }

  // --- outgoing -------------------------------------------------------------

  /** Say a building went up, came down, changed hands or changed its staffing. */
  touchCastle(): void { this.castleDirty = true; }

  /**
   * Stop describing my castle to anybody.
   *
   * Called when this player is beaten. The alternative -- going quiet by simply
   * not being asked -- leaves the last snapshot standing on every other screen,
   * so defeat is announced (`declareDead`) and then the tap is turned off, in
   * that order.
   */
  stopBroadcasting(): void { this.silent = true; }
  private silent = false;

  /**
   * Broadcast whatever is due this tick.
   *
   * Called once a frame with the factions I own. Rate limiting lives here
   * rather than at the call sites so that there is exactly one place that
   * decides how much traffic a match makes.
   */
  tick(dt: number, gather: (g: number) => {
    buildings: NetBuilding[]; soldiers: NetSoldier[];
  }): void {
    if (this.silent) return;
    this.clock += dt;
    const castleDue = this.castleDirty
      ? this.clock - this.castleAt >= RATE.castle
      : this.clock - this.castleAt >= RATE.castleResync;
    const armyDue = this.clock - this.armyAt >= RATE.army;
    if (!castleDue && !armyDue) return;

    for (const g of this.mine) {
      const snap = gather(g);
      if (castleDue) this.send({ k: 'castle', g, b: snap.buildings });
      if (armyDue) this.send({ k: 'army', g, s: snap.soldiers });
    }
    if (castleDue) { this.castleAt = this.clock; this.castleDirty = false; }
    if (armyDue) this.armyAt = this.clock;
  }

  /**
   * Report a blow on something somebody else owns.
   *
   * `g` is the global side of the thing struck, `i` the OWNER's id for it --
   * which is the id that arrived in their snapshot, so it is theirs already and
   * needs no translation.
   */
  hit(g: number, kind: 'b' | 'u' | 'w', i: number, n: number): void {
    const amount = Math.round(n);
    if (amount <= 0) return;
    this.send({ k: 'hit', to: this.ownerOf(g), g, kind, i, n: amount });
  }

  fell(i: number): void { this.send({ k: 'fell', i }); }
  fire(x: number, z: number): void {
    this.send({ k: 'fire', x: Math.round(x), z: Math.round(z) });
  }
  declareDead(g: number): void { this.send({ k: 'dead', g }); }
  say(text: string): void { this.net.send({ t: 'chat', text }); }
  report(win: boolean): void { this.net.send({ t: 'over', win }); }

  private send(m: SimMessage): void {
    this.net.send({ t: 'sim', ...m } as never);
  }

  // --- incoming -------------------------------------------------------------

  private receive(msg: { t: string } & Record<string, unknown>): void {
    if (msg.t === 'chat') {
      this.chat.push({
        from: String(msg.from), text: String(msg.text), at: Number(msg.at),
      });
      if (this.chat.length > 80) this.chat.shift();
      return;
    }
    if (msg.t === 'match' && msg.match) {
      // Teams and who is still connected can change under us; the seats and the
      // map cannot, so only the mutable half is taken.
      this.players = (msg.match as MatchView).players;
      return;
    }
    if (msg.t === 'out') {
      this.finished.push({ slot: Number(msg.slot), win: !!msg.win });
      return;
    }
    if (msg.t !== 'sim') return;

    const m = msg as unknown as SimMessage & { from: number };
    switch (m.k) {
      case 'castle': {
        const f = this.remote.get(m.g);
        // A snapshot of a faction its sender does not own is a bug or a liar;
        // either way it is not applied.
        if (!f || this.ownerOf(m.g) !== m.from) return;
        f.buildings = m.b;
        f.buildingsDirty = true;
        f.heardAt = Date.now();
        return;
      }
      case 'army': {
        const f = this.remote.get(m.g);
        if (!f || this.ownerOf(m.g) !== m.from) return;
        f.soldiers = m.s;
        f.soldiersDirty = true;
        f.heardAt = Date.now();
        return;
      }
      case 'hit': {
        // Only ever applied to something I actually own.
        if (!this.mine.includes(m.g)) return;
        this.hits.push({ g: m.g, kind: m.kind, i: m.i, n: m.n });
        return;
      }
      case 'fell': this.felled.push(m.i); return;
      case 'fire': this.fires.push({ x: m.x, z: m.z }); return;
      case 'dead': {
        const f = this.remote.get(m.g);
        if (f && this.ownerOf(m.g) === m.from) f.defeated = true;
        return;
      }
    }
  }

  /** Take everything queued for the game to apply, leaving the queues empty. */
  drain(): {
    hits: IncomingHit[]; felled: number[]; fires: { x: number; z: number }[];
    finished: { slot: number; win: boolean }[];
  } {
    return {
      hits: this.hits.splice(0),
      felled: this.felled.splice(0),
      fires: this.fires.splice(0),
      finished: this.finished.splice(0),
    };
  }
}

export type { NetBuilding, NetSoldier };
