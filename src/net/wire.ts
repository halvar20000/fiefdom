/**
 * Turning castles and soldiers into numbers, and back.
 *
 * Two things happen here. Names become indexes -- "poleturner" is eleven bytes
 * every time it is sent and a small integer once -- and positions are quantised
 * to a twentieth of a tile. Neither is visible at the camera distance this game
 * is played at, and together they roughly halve an army update, which is the
 * message that runs eight times a second for every player in the match.
 *
 * The index tables are SORTED lists of the names in defs.ts, not the order they
 * happen to be declared in. That matters: two players on slightly different
 * builds would otherwise silently disagree about what a `7` is, and a
 * disagreement of that kind draws a granary where a barracks is. Sorted, a
 * build that only ADDS a building still shifts every index after it -- which is
 * why the build id is checked when a match begins and a mismatch is refused
 * rather than played through.
 */

import { BUILDINGS, SOLDIER_TYPES } from '../game/defs';
import type { NetBuilding, NetSoldier } from './protocol';

/** Every building name, in an order both ends agree on. */
export const BUILDING_ORDER: string[] = Object.keys(BUILDINGS).sort();
const BUILDING_INDEX = new Map(BUILDING_ORDER.map((n, i) => [n, i]));

export const SOLDIER_ORDER_WIRE: string[] = Object.keys(SOLDIER_TYPES).sort();
const SOLDIER_INDEX = new Map(SOLDIER_ORDER_WIRE.map((n, i) => [n, i]));

export const buildingIndex = (name: string): number => BUILDING_INDEX.get(name) ?? -1;
export const buildingName = (i: number): string | null => BUILDING_ORDER[i] ?? null;
export const soldierIndex = (type: string): number => SOLDIER_INDEX.get(type) ?? -1;
export const soldierType = (i: number): string | null => SOLDIER_ORDER_WIRE[i] ?? null;

/** Flags packed into NetBuilding.f. */
export const F_RAISED = 1;
export const F_ALT = 2;

export interface WireBuildingSource {
  id: number;
  name: string;
  x: number;
  z: number;
  hp: number;
  staff: number;
  raised?: boolean;
  alt?: boolean;
}

export function packBuilding(b: WireBuildingSource): NetBuilding | null {
  const n = buildingIndex(b.name);
  if (n < 0) return null;   // a building this build has never heard of
  return {
    i: b.id, n, x: b.x, z: b.z,
    h: Math.max(0, Math.round(b.hp)),
    s: b.staff | 0,
    f: (b.raised ? F_RAISED : 0) | (b.alt ? F_ALT : 0),
  };
}

export interface WireSoldierSource {
  id: number;
  type: string;
  x: number;
  z: number;
  heading: number;
  hp: number;
}

const TAU = Math.PI * 2;

export function packSoldier(s: WireSoldierSource): NetSoldier | null {
  const t = soldierIndex(s.type);
  if (t < 0) return null;
  // Headings are wrapped into 0..63 rather than clamped: a heading is an angle,
  // and clamping one would pin every man facing slightly past due west to due
  // west exactly.
  const h = ((Math.round((s.heading / TAU) * 64) % 64) + 64) % 64;
  return [
    s.id, t,
    Math.round(s.x * 20), Math.round(s.z * 20),
    h, Math.max(0, Math.round(s.hp)),
  ];
}

export function unpackSoldier(s: NetSoldier): {
  id: number; type: string | null; x: number; z: number; heading: number; hp: number;
} {
  return {
    id: s[0], type: soldierType(s[1]),
    x: s[2] / 20, z: s[3] / 20,
    heading: (s[4] / 64) * TAU, hp: s[5],
  };
}
