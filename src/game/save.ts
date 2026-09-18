import type { MapDef } from './maps';
import type { SavedFortune } from './fortune';
import { store } from './backend';

/**
 * Saved games.
 *
 * Stored through `store` (see backend.ts): on the server when the container
 * provides one, mirrored to and falling back on localStorage otherwise. The
 * three slots keep their `fiefdom.save.<n>` keys either way, and the autosave
 * ring sits beside them as `fiefdom.save.auto<n>`.
 *
 * A save is a DIFF against a freshly generated world, not a dump of one. The
 * terrain, the ground types and even the scatter of trees are all deterministic
 * functions of the map seed -- vegetation is hashed from tile position -- so
 * storing them would be storing forty thousand tiles we can recompute in a
 * second. What actually has to be written down is everything the player and the
 * simulation changed since: the buildings, the units, the stores, and which
 * trees have been felled.
 */

export const SAVE_VERSION = 4;
export const SLOTS = 3;

/**
 * The autosave ring: this many slots, written round-robin every
 * AUTOSAVE_INTERVAL seconds of play. Three at five minutes covers the last
 * quarter of an hour, which is what a closed tab or a crash actually costs
 * once the ring exists -- against the whole evening it cost before.
 *
 * The ring is separate from the manual slots on purpose. An autosave that
 * landed in slot 3 would overwrite the game somebody parked there to come back
 * to, and the one thing a save must never do is disappear.
 */
export const AUTOSAVES = 3;
export const AUTOSAVE_INTERVAL = 5 * 60;

/** A manual slot is 1..SLOTS; an autosave is 'auto1'..'autoN'. */
export type SlotId = number | `auto${number}`;

export const isAutosave = (slot: SlotId): boolean => typeof slot === 'string';

// Both kinds share the `fiefdom.save.` prefix, which is what backend.ts uses
// to tell game data (kept on the server) from browser prefs (not).
const KEY = (slot: SlotId) => `fiefdom.save.${slot}`;
const BOOT = 'fiefdom.boot';

export interface SavedBuilding {
  n: string; x: number; z: number; staff: number; hp: number;
  held: Record<string, number>;
  /** A drawbridge that was raised. Absent means down. */
  up?: number;
  /** A workshop set to its alternate product. Absent means the default one. */
  alt?: number;
  /** Quarter turns it was laid at, 1 to 3. Absent means facing north. */
  t?: number;
  /** Seconds it has been burning. Absent means not alight. */
  f?: number;
  /** A moat not yet dug. Absent means dug, which every older save is. */
  u?: number;
}

export interface SavedSoldier {
  /** Faction id: 0 is the player, 1.. are rival lords. */
  t: string; side: number; x: number; z: number; hp: number;
  /** Post being manned: building tile plus the exact stand point. */
  g?: [number, number, number, number];
  /** Holding ground (defensive stance). Absent means aggressive. */
  h?: boolean;
  /** On patrol: the two ends, and 1 if walking toward the second. */
  p?: [number, number, number, number, 0 | 1];
}

export interface SavedAnimal {
  x: number; z: number; hx: number; hz: number; alive: boolean; respawnAt: number;
}

/** A rival lord: his castle and his economy. */
export interface SavedFaction {
  id: number;
  /** "Aldric the Red". Absent on older saves, which get a fresh one. */
  name?: string;
  /** The castle blueprint his walls follow. Absent on older saves: the square. */
  plan?: string;
  buildings: SavedBuilding[];
  defeated: boolean;
  gold: number; stock: Record<string, number>;
  population: number; idle: number; elapsed: number;
  recruited: number; built: number; wavesSent: number;
}

export interface SaveGame {
  version: number;
  savedAt: number;
  /** Play time in seconds, for the slot listing. */
  elapsed: number;
  map: MapDef;

  gold: number;
  stock: Record<string, number>;
  population: number;
  idle: number;
  popularity: number;
  rations: string;
  taxLevel: number;
  trade: Record<string, { buyOn: boolean; buyLevel: number; sellOn: boolean; sellLevel: number }>;

  buildings: SavedBuilding[];
  /** One entry per rival lord, in faction-id order. */
  factions: SavedFaction[];
  /** Decoration indices that are currently felled, with their regrow time. */
  felled: [number, number][];
  soldiers: SavedSoldier[];
  animals: SavedAnimal[];
  fires: [number, number, number][];
  /** The military rally flag, if one is planted. Absent on older saves. */
  rally?: { x: number; z: number } | null;
  /** How hard the rival lords play. Absent on older saves (treated as normal). */
  difficulty?: 'easy' | 'normal' | 'heavy';
  /** The season in force and when the next is due. Absent on older saves. */
  fortune?: SavedFortune;
}

export interface SlotInfo {
  slot: SlotId;
  save: SaveGame | null;
  error?: string;
}

/**
 * Upgrades, keyed by the version they lift a save FROM.
 *
 * A save is never refused for being old. It is walked up this ladder one step
 * at a time -- each step takes the shape that version wrote and returns the
 * next one's -- until it reaches SAVE_VERSION, and only a save from a NEWER
 * build than this one is turned away, because there is no knowing what it
 * holds. So bumping SAVE_VERSION costs one function here, not everyone's
 * evening: the alternative, rejecting anything that does not match, is what
 * v4 did to v3 on the day both shipped.
 *
 * Fields that merely appeared later (`rally`, `difficulty`, a building's `t`)
 * do not need a step: they are optional, and absent reads as the value the
 * game had before the field existed. A step is for a RESHAPE -- a field that
 * moved, split or changed type -- and each one says what changed and why.
 *
 * The steps take and return `any` because the whole point is that the input
 * is a shape the current interfaces no longer describe.
 */
const UPGRADES: Record<number, (s: any) => any> = {
  // v3 -> v4: one enemy became up to three rival lords. The single
  // `enemyBuildings` list and `lord` block fold into `factions[0]` as rival
  // number 1, and a soldier's side goes from 'player' | 'enemy' to a faction
  // id -- 0 for the player, 1 for the one rival a v3 world ever had.
  3: s => {
    const { enemyBuildings = [], lord = {}, soldiers = [], ...rest } = s;
    const { defeated = false, ...economy } = lord;
    return {
      ...rest,
      version: 4,
      factions: [{ id: 1, buildings: enemyBuildings, defeated, ...economy }],
      soldiers: soldiers.map((u: any) => ({
        ...u, side: u.side === 'enemy' ? 1 : u.side === 'player' ? 0 : u.side,
      })),
    };
  },
};

/**
 * Bring a save of any version we have ever written up to SAVE_VERSION, or
 * say why it cannot be. Pure: the stored copy is left as it was, and is only
 * rewritten in the new shape when the player next saves.
 */
export function upgrade(raw: unknown): { save: SaveGame } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'unreadable' };
  let s = raw as { version?: unknown };
  if (typeof s.version !== 'number') return { error: 'unreadable' };
  if (s.version > SAVE_VERSION) {
    return { error: `from a newer build (v${s.version}) — update the game` };
  }
  while (s.version !== SAVE_VERSION) {
    const step = UPGRADES[s.version as number];
    if (!step) return { error: `from an older build (v${s.version})` };
    s = step(s);
  }
  return { save: s as SaveGame };
}

export function writeSlot(slot: SlotId, save: SaveGame): string | null {
  try {
    store.setItem(KEY(slot), JSON.stringify(save));
    return null;
  } catch (e) {
    // Quota is the realistic failure, and silently losing a save is the worst
    // possible outcome, so this reports rather than swallows.
    return e instanceof Error ? e.message : 'could not write the save';
  }
}

export function readSlot(slot: SlotId): SlotInfo {
  const raw = store.getItem(KEY(slot));
  if (!raw) return { slot, save: null };
  try {
    const up = upgrade(JSON.parse(raw));
    if ('error' in up) return { slot, save: null, error: up.error };
    const { save } = up;
    // A save missing its map is corrupt -- refuse it rather than let the menu
    // crash reading its name. Cheap insurance now the data can live on a server
    // where a stray edit or a half-finished write could produce exactly this.
    if (!save.map || typeof save.map.name !== 'string') {
      return { slot, save: null, error: 'unreadable' };
    }
    return { slot, save };
  } catch {
    return { slot, save: null, error: 'unreadable' };
  }
}

export function listSlots(): SlotInfo[] {
  return Array.from({ length: SLOTS }, (_, i) => readSlot(i + 1));
}

/** The ring, newest first, empty slots left out. */
export function listAutosaves(): SlotInfo[] {
  return Array.from({ length: AUTOSAVES }, (_, i) => readSlot(`auto${i + 1}`))
    .filter(i => i.save)
    .sort((a, b) => b.save!.savedAt - a.save!.savedAt);
}

/**
 * Write into the ring, over its oldest entry.
 *
 * Which entry is newest is read off `savedAt` rather than kept as a pointer,
 * so an autosave is one write, not a rotation of three -- and each one goes
 * to the server, so that matters. An unreadable entry counts as the oldest:
 * it is the one worth losing.
 */
export function writeAutosave(save: SaveGame): string | null {
  let oldest: SlotId = 'auto1';
  let oldestAt = Infinity;
  for (let i = 1; i <= AUTOSAVES; i++) {
    const info = readSlot(`auto${i}`);
    const at = info.save ? info.save.savedAt : -1;
    if (at < oldestAt) { oldestAt = at; oldest = `auto${i}`; }
  }
  return writeSlot(oldest, save);
}

export function clearSlot(slot: SlotId): void {
  store.removeItem(KEY(slot));
}

/**
 * What to do on the next page load.
 *
 * Loading a save and quitting to the menu both go through a reload rather than
 * tearing the running game down in place. Rebuilding takes about a second on a
 * local disk, and unwinding three.js buffers, event listeners, timers and the
 * sprite atlas by hand is a reliable source of leaks nobody would ever notice
 * until the fourth or fifth load.
 */
export type BootIntent = { kind: 'load'; slot: SlotId } | { kind: 'menu' };

export function setBootIntent(intent: BootIntent): void {
  sessionStorage.setItem(BOOT, JSON.stringify(intent));
}

export function takeBootIntent(): BootIntent | null {
  const raw = sessionStorage.getItem(BOOT);
  sessionStorage.removeItem(BOOT);
  if (!raw) return null;
  try { return JSON.parse(raw) as BootIntent; } catch { return null; }
}

/** "3h 04m" / "12m" — how long this settlement has been going. */
export function playTime(seconds: number): string {
  const m = Math.floor(seconds / 60), h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

export function savedWhen(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit' })}`;
}
