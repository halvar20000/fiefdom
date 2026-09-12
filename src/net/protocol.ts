/**
 * What the client and the server say to each other.
 *
 * The server (docker/lobby.mjs) never looks inside a `sim` message -- it only
 * forwards it to the other players of a match -- so this file, not the server,
 * is where the shape of a castle on the wire is actually defined. Keeping the
 * two apart means changing what a castle broadcasts is a change to the game and
 * never to the switchboard.
 *
 * Everything on the wire is JSON. It would compress into a fraction of the
 * bytes as a binary format, and it is not worth it: a four-player match moves
 * tens of kilobytes a second, which is less than one of the sprite sheets.
 * What it buys is that the whole protocol can be read in a browser's network
 * tab, which is how anything here will actually be debugged.
 */

import type { MapDef } from '../game/maps';
import type { Difficulty } from '../game/lord';

/** Free-for-all, or humans against the AI lords together. */
export type MatchMode = 'versus' | 'coop';

export interface LobbyRow {
  id: string;
  name: string;
  host: string;
  map: string;
  mode: MatchMode;
  difficulty: Difficulty;
  players: number;
  max: number;
  ai: number;
  state: 'lobby' | 'playing' | 'over';
  createdAt: number;
}

export interface MatchPlayer {
  /** Position in the match, and the identity every `sim` message is stamped with. */
  slot: number;
  username: string;
  /** Who fights alongside whom. Equal numbers are allies. */
  team: number;
  ready: boolean;
  /** False while their socket is away -- a reload, a dropped connection. */
  here: boolean;
  host: boolean;
}

export interface MatchView {
  id: string;
  name: string;
  mode: MatchMode;
  difficulty: Difficulty;
  aiLords: number;
  maxPlayers: number;
  state: 'lobby' | 'playing' | 'over';
  map: MapDef;
  players: MatchPlayer[];
  /** Keep positions, humans in slot order and then the AI lords. Null until start. */
  seats: { x: number; z: number }[] | null;
}

// --- what the client sends ---------------------------------------------------

export type ClientMessage =
  | { t: 'sub' }
  | { t: 'unsub' }
  | { t: 'create'; name: string; map: MapDef; mode: MatchMode; aiLords: number;
      maxPlayers: number; difficulty: Difficulty }
  | { t: 'join'; id: string }
  | { t: 'leave' }
  | { t: 'ready'; on: boolean }
  | { t: 'team'; team: number }
  | { t: 'chat'; text: string }
  | { t: 'start'; seats: { x: number; z: number }[] }
  | { t: 'over'; win: boolean }
  | ({ t: 'sim' } & SimMessage);

// --- what the server sends ---------------------------------------------------

export type ServerMessage =
  | { t: 'hello'; user: { id: string; username: string } }
  | { t: 'lobby'; matches: LobbyRow[] }
  | { t: 'match'; match: MatchView | null }
  | { t: 'chat'; from: string; slot: number; text: string; at: number }
  | { t: 'note'; msg: string }
  | { t: 'err'; msg: string }
  | { t: 'begin'; match: MatchView; you: number; rejoin?: boolean }
  | { t: 'out'; slot: number; win: boolean }
  | ({ t: 'sim'; from: number } & SimMessage);

// --- the simulation messages -------------------------------------------------
//
// Each is stamped by the server with the slot that sent it, and every one of
// them describes something its SENDER owns. Nobody ever tells anybody else what
// their own castle is doing; the most you can say about someone else's is "I
// hit it", which is the `hit` message, and it is theirs to apply.

/**
 * A castle, whole.
 *
 * Sent on change and, at a slower beat, unconditionally -- so a player who
 * missed an update because their socket hiccuped is right again within a few
 * seconds instead of staring at a building that was demolished a minute ago.
 * Buildings are cheap enough (tens per castle) that sending the whole list is
 * simpler and more robust than diffing it, and the diff would have to be
 * reconciled against a base that a dropped message just invalidated.
 */
export interface NetBuilding {
  /** The owner's own id for it. Stable, and what a `hit` addresses. */
  i: number;
  /** Index into the shared building order (see wire.ts). */
  n: number;
  x: number;
  z: number;
  /** Health, rounded -- a fractional hit point is not worth a decimal place. */
  h: number;
  /** Workers on it, which is what draws its labourers. */
  s: number;
  /**
   * Bit 1: a drawbridge raised. Bit 2: a workshop on its alternate product.
   * Bits 3-4: the quarter turn it was laid at. Bit 5: alight. Bit 6: a moat
   * not yet dug. See wire.ts.
   */
  f: number;
}

/**
 * One soldier, as six numbers.
 *
 * Positions are quantised to a twentieth of a tile and headings to a
 * sixty-fourth of a turn: both are below what the eye can see at this camera
 * distance, and together they roughly halve the size of an army update, which
 * is the message that actually runs at eight a second.
 */
export type NetSoldier = [
  id: number, type: number, x20: number, z20: number, head64: number, hp: number,
];

export type SimMessage =
  | { k: 'castle'; g: number; b: NetBuilding[] }
  | { k: 'army'; g: number; s: NetSoldier[] }
  /**
   * A blow struck on something somebody else owns.
   *
   * Addressed (`to`) so it goes to one player rather than the whole match. The
   * damage is NOT applied by the attacker: the owner applies it and the truth
   * comes back in their next snapshot. That costs a round trip of lag on a
   * health bar and buys the thing that matters -- two players can never
   * disagree about whether a keep is still standing.
   */
  | { k: 'hit'; to: number; g: number; kind: 'b' | 'u' | 'w' | 'f'; i: number; n: number }
  /** A tree cut down, so the stump appears on every screen, not just the feller's. */
  | { k: 'fell'; i: number }
  /** Ground set alight by an incendiary. Cosmetic, and cheap to keep in step. */
  | { k: 'fire'; x: number; z: number }
  /** This faction is finished. Announced by whoever owns it. */
  | { k: 'dead'; g: number };

/** How often each kind of message goes out, in seconds. */
export const RATE = {
  /** The army moves; this is the one that has to feel live. */
  army: 1 / 8,
  /** Buildings change rarely, so this is a floor on bursts, not a heartbeat. */
  castle: 1 / 4,
  /** ...and this is the heartbeat, for a client that missed something. */
  castleResync: 3,
};
