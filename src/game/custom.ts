import type { Terrain } from '../engine/terrain';
import { GROUND_TYPES, type GroundType, isBuildable } from './worldgen';
import type { GeneratedMap } from './worldgen';
import type { MapDef } from './maps';

/**
 * Hand-drawn maps.
 *
 * The six shipped maps are generator BIASES -- a seed and four numbers -- and
 * a saved game is a diff against the world that seed regenerates. A painted
 * map has no seed that would reproduce it, so it has to carry its own tiles.
 *
 * That is affordable because the two arrays are tiny in information terms:
 * 40,000 ground types over six values, and 40,401 corner heights over six
 * levels. Run-length encoded, an all-desert canvas is a handful of bytes and a
 * heavily worked map is a few kilobytes -- against the ~5MB localStorage gives
 * us. Storing them raw would be 80KB per map before base64, which is still
 * fine but pointlessly wasteful when the data is this repetitive.
 */

export const CUSTOM_VERSION = 1;
const KEY = 'fiefdom.maps';

export interface CustomMap {
  id: string;
  name: string;
  version: number;
  /** Map dimensions the arrays were painted at, so a size change can't corrupt one. */
  w: number;
  h: number;
  /** RLE + base64: corner heights, (w+1) * (h+1) of them. */
  corners: string;
  /** RLE + base64: ground type index per tile, w * h of them. */
  ground: string;
  lords: number;
  /** Vegetation density multiplier, as on a generated map. */
  trees: number;
  savedAt: number;
}

/**
 * Run-length encode small integers.
 *
 * Three bytes per run: one value, two little-endian count. A run can be no
 * longer than 65535, which is comfortably above the 40,401 longest possible
 * array here, so a uniform map really does come out as a single run.
 */
function rleEncode(data: ArrayLike<number>): string {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const v = data[i] & 0xff;
    let n = 1;
    while (i + n < data.length && (data[i + n] & 0xff) === v && n < 65535) n++;
    out.push(v, n & 0xff, (n >> 8) & 0xff);
    i += n;
  }
  let s = '';
  for (const b of out) s += String.fromCharCode(b);
  return btoa(s);
}

function rleDecode(s: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  const raw = atob(s);
  let at = 0;
  for (let i = 0; i + 2 < raw.length; i += 3) {
    const v = raw.charCodeAt(i);
    const n = raw.charCodeAt(i + 1) | (raw.charCodeAt(i + 2) << 8);
    // Clamp rather than trust: a truncated or hand-edited payload should
    // produce a short map, not a RangeError halfway through a load.
    const end = Math.min(length, at + n);
    out.fill(v, at, end);
    at = end;
    if (at >= length) break;
  }
  return out;
}

/** Raw arrays back out of a saved map, for the editor to reopen one. */
export function decodeArrays(m: CustomMap): { corners: Uint8Array; ground: Uint8Array } {
  return {
    corners: rleDecode(m.corners, (m.w + 1) * (m.h + 1)),
    ground: rleDecode(m.ground, m.w * m.h),
  };
}

export function encodeMap(
  name: string, w: number, h: number,
  corners: ArrayLike<number>, ground: ArrayLike<number>,
  lords: number, trees: number, id?: string,
): CustomMap {
  return {
    id: id ?? `custom-${Math.floor(performance.now())}-${name.length}`,
    name, version: CUSTOM_VERSION, w, h,
    corners: rleEncode(corners),
    ground: rleEncode(ground),
    lords, trees, savedAt: Date.now(),
  };
}

/** The MapDef the rest of the game sees. Generator biases are inert here. */
export function defOf(m: CustomMap): MapDef {
  return {
    id: m.id, name: m.name,
    blurb: 'A map of your own making.',
    seed: 0, green: 0, rock: 0, marsh: 0, trees: m.trees,
    lords: m.lords, difficulty: 'Fair',
    custom: m,
  };
}

// --- storage --------------------------------------------------------------

export function listMaps(): CustomMap[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const all = JSON.parse(raw) as CustomMap[];
    return Array.isArray(all) ? all.filter(m => m.version === CUSTOM_VERSION) : [];
  } catch {
    return [];
  }
}

export function saveMap(m: CustomMap): string | null {
  const all = listMaps().filter(x => x.id !== m.id);
  all.push(m);
  all.sort((a, b) => b.savedAt - a.savedAt);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'could not save the map';
  }
}

export function deleteMap(id: string): void {
  localStorage.setItem(KEY, JSON.stringify(listMaps().filter(m => m.id !== id)));
}

export function getMap(id: string): CustomMap | null {
  return listMaps().find(m => m.id === id) ?? null;
}

// --- applying -------------------------------------------------------------

/**
 * Lay a painted map onto the terrain, in place of generateMap.
 *
 * Returns the same shape generateMap does, so nothing downstream -- scatter,
 * start site, placement -- needs to know which kind of map it is playing on.
 * Vegetation in particular still comes from the hashed scatter over painted
 * ground types, so painting a meadow grows trees on it without the editor
 * having to place a single one.
 */
export function applyCustomMap(
  terrain: Terrain,
  layerOf: (type: string, variant: number) => number,
  map: CustomMap,
): GeneratedMap {
  const { width, height } = terrain;
  const corners = rleDecode(map.corners, (map.w + 1) * (map.h + 1));
  const ground = rleDecode(map.ground, map.w * map.h);

  for (let z = 0; z <= height; z++) {
    for (let x = 0; x <= width; x++) {
      // Read through the SAVED dimensions, not the live ones. If the world
      // size ever changes, an old map lands in the corner of the new one
      // rather than being sheared diagonally by a stride mismatch.
      const v = (x <= map.w && z <= map.h) ? corners[z * (map.w + 1) + x] : 0;
      terrain.setCorner(x, z, v);
    }
  }

  const flatTiles: { x: number; z: number }[] = [];
  const groundType = new Uint8Array(width * height);

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const t = z * width + x;
      const g = (x < map.w && z < map.h) ? ground[z * map.w + x] : 0;
      const type = (GROUND_TYPES[g] ?? 'sand') as GroundType;

      const c0 = terrain.cornerHeight(x, z);
      const c1 = terrain.cornerHeight(x + 1, z);
      const c2 = terrain.cornerHeight(x + 1, z + 1);
      const c3 = terrain.cornerHeight(x, z + 1);
      const lo = Math.min(c0, c1, c2, c3);
      const hi = Math.max(c0, c1, c2, c3);
      const slope = hi - lo;
      const flat = lo === hi;

      // Same deterministic variant the generator uses, so painted ground has
      // the same non-repeating texture rotation as generated ground.
      const variant = hashVariant(x, z);
      terrain.layer[t] = layerOf(slope >= 2 ? 'cliff' : type, variant);
      groundType[t] = g;
      if (flat && type !== 'rock' && type !== 'marsh') flatTiles.push({ x, z });
    }
  }

  terrain.rebuild();
  return { terrain, flatTiles, groundType };
}

/** Cheap positional hash for texture variant, 0-3. */
export function hashVariant(x: number, z: number): number {
  let h = x * 374761393 + z * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) & 3;
}

/**
 * Whether a painted map can actually be played.
 *
 * A start site needs somewhere to farm and somewhere to quarry; without either
 * the game opens on a settlement that can never produce anything, which reads
 * as the map being broken rather than as the player having painted a desert.
 */
export function auditMap(
  terrain: Terrain, groundType: Uint8Array,
): { ok: boolean; warnings: string[] } {
  const GRASS = GROUND_TYPES.indexOf('grass');
  const DARK = GROUND_TYPES.indexOf('grass_dark');
  const ROCK = GROUND_TYPES.indexOf('rock');
  let green = 0, rock = 0, buildable = 0;

  for (let z = 0; z < terrain.height; z += 2) {
    for (let x = 0; x < terrain.width; x += 2) {
      const g = groundType[z * terrain.width + x];
      if (!isBuildable(terrain, x, z, 3, 3)) continue;
      buildable++;
      if (g === GRASS || g === DARK) green++;
      else if (g === ROCK) rock++;
    }
  }

  const warnings: string[] = [];
  if (green < 40) warnings.push('Almost no farmland — nothing can grow food here.');
  if (rock < 12) warnings.push('Almost no flat rock — no quarry or iron mine can be built.');
  if (buildable < 400) warnings.push('Very little level ground to build on.');
  return { ok: warnings.length === 0, warnings };
}
