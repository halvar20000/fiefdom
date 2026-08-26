import type { MapDef } from './maps';
import { store } from './backend';

/**
 * Saved games.
 *
 * Stored through `store` (see backend.ts): on the server when the container
 * provides one, mirrored to and falling back on localStorage otherwise. The
 * three slots keep their `fiefdom.save.<n>` keys either way.
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

const KEY = (slot: number) => `fiefdom.save.${slot}`;
const BOOT = 'fiefdom.boot';

export interface SavedBuilding {
  n: string; x: number; z: number; staff: number; hp: number;
  held: Record<string, number>;
}

export interface SavedSoldier {
  /** Faction id: 0 is the player, 1.. are rival lords. */
  t: string; side: number; x: number; z: number; hp: number;
  /** Post being manned: building tile plus the exact stand point. */
  g?: [number, number, number, number];
  /** Holding ground (defensive stance). Absent means aggressive. */
  h?: boolean;
}

export interface SavedAnimal {
  x: number; z: number; hx: number; hz: number; alive: boolean; respawnAt: number;
}

/** A rival lord: his castle and his economy. */
export interface SavedFaction {
  id: number;
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
}

export interface SlotInfo {
  slot: number;
  save: SaveGame | null;
  error?: string;
}

export function writeSlot(slot: number, save: SaveGame): string | null {
  try {
    store.setItem(KEY(slot), JSON.stringify(save));
    return null;
  } catch (e) {
    // Quota is the realistic failure, and silently losing a save is the worst
    // possible outcome, so this reports rather than swallows.
    return e instanceof Error ? e.message : 'could not write the save';
  }
}

export function readSlot(slot: number): SlotInfo {
  const raw = store.getItem(KEY(slot));
  if (!raw) return { slot, save: null };
  try {
    const save = JSON.parse(raw) as SaveGame;
    if (save.version !== SAVE_VERSION) {
      return { slot, save: null, error: `from an older build (v${save.version})` };
    }
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

export function clearSlot(slot: number): void {
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
export type BootIntent = { kind: 'load'; slot: number } | { kind: 'menu' };

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
