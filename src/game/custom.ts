import type { Terrain } from '../engine/terrain';
import { GROUND_TYPES, type GroundType, isBuildable, type HeightField } from './worldgen';
import type { GeneratedMap } from './worldgen';
import type { MapDef } from './maps';
import { store } from './backend';

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
  /**
   * Hand-placed keeps. Both are optional and absent on maps painted before
   * the tool existed, which fall back to the automatic siting rather than
   * being rejected -- a version bump here would have thrown away every map
   * already saved.
   */
  start?: { x: number; z: number };
  keeps?: { x: number; z: number }[];
}

/**
 * Marker colours for the editor, mirroring FACTION_COLOURS in main.ts.
 *
 * They live here rather than being imported from main.ts because the editor is
 * reached FROM main.ts; importing back the other way would close a cycle.
 */
export const KEEP_COLOURS = [
  { name: 'You', css: '#f0c869', hex: 0xf0c869 },
  { name: 'Red Lord', css: '#e2794f', hex: 0xe2794f },
  { name: 'Blue Lord', css: '#6f9fd8', hex: 0x6f9fd8 },
  { name: 'Violet Lord', css: '#b07fd0', hex: 0xb07fd0 },
];

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
  start?: { x: number; z: number } | null,
  keeps?: { x: number; z: number }[],
): CustomMap {
  return {
    id: id ?? `custom-${Math.floor(performance.now())}-${name.length}`,
    name, version: CUSTOM_VERSION, w, h,
    corners: rleEncode(corners),
    ground: rleEncode(ground),
    lords, trees, savedAt: Date.now(),
    ...(start ? { start } : {}),
    ...(keeps && keeps.length ? { keeps } : {}),
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

/**
 * Reference colours for reading a map out of a picture.
 *
 * These are what the six ground types look like from directly above, which is
 * what a minimap or a map-preview thumbnail shows. Classification is nearest
 * colour with green weighted up, because green channel is what actually
 * separates fertile ground from sand and rock in these images.
 *
 * Water has three entries rather than one because it is the colour that varies
 * most between sources: a shallow river and open sea are far apart in a
 * thumbnail, and one reference blue put half a coastline into marsh.
 */
const PALETTE: { g: number; rgb: [number, number, number] }[] = [
  { g: 0, rgb: [201, 169, 120] },   // sand
  { g: 0, rgb: [222, 196, 152] },   // pale sand
  { g: 1, rgb: [157, 154, 94] },    // scrub
  { g: 2, rgb: [127, 156, 78] },    // grass
  { g: 3, rgb: [85, 116, 54] },     // lush
  { g: 3, rgb: [58, 84, 38] },      // deep green / tree cover
  { g: 4, rgb: [142, 139, 131] },   // rock
  { g: 4, rgb: [104, 100, 94] },    // dark rock
  { g: 5, rgb: [74, 68, 56] },      // pitch marsh
  { g: 6, rgb: [48, 76, 112] },     // water
  { g: 6, rgb: [72, 116, 150] },    // shallows
  { g: 6, rgb: [30, 52, 84] },      // deep water
];

/**
 * Classify one pixel to a ground type index.
 *
 * Exported so the import can be tested without a canvas or a file picker.
 */
export function classifyPixel(r: number, g: number, b: number): number {
  let best = 0, bestD = Infinity;
  for (const p of PALETTE) {
    const dr = r - p.rgb[0], dg = g - p.rgb[1], db = b - p.rgb[2];
    const d = dr * dr + dg * dg * 2 + db * db;
    if (d < bestD) { bestD = d; best = p.g; }
  }
  return best;
}

/**
 * Read an image into a ground array.
 *
 * The picture is fitted INSIDE the map preserving its aspect ratio, with the
 * margins left as sand. Stretching a wide screenshot to a square map would
 * distort every feature on it, and the whole point of importing is to keep the
 * shapes.
 */
export function groundFromImage(
  img: CanvasImageSource, w: number, h: number,
  iw: number, ih: number,
): Uint8Array {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = 'rgb(201,169,120)';
  ctx.fillRect(0, 0, w, h);

  const k = Math.min(w / iw, h / ih);
  const dw = Math.round(iw * k), dh = Math.round(ih * k);
  ctx.drawImage(img, Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh);

  const px = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) {
    out[i] = classifyPixel(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
  }
  return out;
}

// --- storage --------------------------------------------------------------

export function listMaps(): CustomMap[] {
  try {
    const raw = store.getItem(KEY);
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
    store.setItem(KEY, JSON.stringify(all));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'could not save the map';
  }
}

export function deleteMap(id: string): void {
  store.setItem(KEY, JSON.stringify(listMaps().filter(m => m.id !== id)));
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
      if (flat && type !== 'rock' && type !== 'iron' && type !== 'marsh' && type !== 'water') {
        flatTiles.push({ x, z });
      }
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
  const IRON = GROUND_TYPES.indexOf('iron');
  const WATER = GROUND_TYPES.indexOf('water');
  const MARSH = GROUND_TYPES.indexOf('marsh');
  let green = 0, rock = 0, iron = 0, buildable = 0;

  for (let z = 0; z < terrain.height; z += 2) {
    for (let x = 0; x < terrain.width; x += 2) {
      const g = groundType[z * terrain.width + x];
      if (g === WATER || g === MARSH) continue;   // level, but nothing goes on it
      if (!isBuildable(terrain, x, z, 3, 3)) continue;
      buildable++;
      if (g === GRASS || g === DARK) green++;
      else if (g === ROCK) rock++;
      else if (g === IRON) iron++;
    }
  }

  const warnings: string[] = [];
  if (green < 40) warnings.push('Almost no farmland — nothing can grow food here.');
  if (rock < 12) warnings.push('Almost no flat rock — no quarry can be built.');
  if (iron < 3) warnings.push('No iron ore — no iron mine can be built.');
  if (buildable < 400) warnings.push('Very little level ground to build on.');
  return { ok: warnings.length === 0, warnings };
}

// --- room to farm -----------------------------------------------------------

/** How far from the keep ordinary buildings may go. Mirrors R_KEEP in main.ts. */
export const KEEP_REACH = 22;
/** Farm sites a keep wants in reach: the five farms and room to spare. */
export const FARMS_WANTED = 8;
/** Quarry sites: two quarries and one more. */
export const QUARRIES_WANTED = 3;
/** Iron mine sites: one seam is a mine; the second is for a second mine. */
export const MINES_WANTED = 2;

/** A keep's flat 3x3 sites in reach, by what could stand on them. */
export interface Room { green: number; rock: number; iron: number }

/**
 * Disjoint, flat 3x3 sites within reach of a keep, counted by ground.
 *
 * A farm is 3x3, needs green under all nine tiles, and must be level -- so this
 * is what "room for a farm" actually is, as against the whole-map count that
 * auditMap keeps for a map with no keeps on it yet. Packed greedily, row by
 * row, each site taking its nine tiles out of play, so a 9x9 meadow reads as
 * nine farms wherever it lies -- not as forty-nine overlapping places to put
 * one, nor as the six that a fixed grid happens to line up with. Trees are not
 * in it: they are scattered at game time and the density knob can change them,
 * which is what the spare sites in FARMS_WANTED are for.
 */
export function roomAround(
  terrain: HeightField, groundType: Uint8Array,
  keep: { x: number; z: number }, reach = KEEP_REACH,
): Room {
  const GREEN = new Set([GROUND_TYPES.indexOf('grass'), GROUND_TYPES.indexOf('grass_dark')]);
  const ROCK = GROUND_TYPES.indexOf('rock');
  const IRON = GROUND_TYPES.indexOf('iron');
  const { width, height } = terrain;
  const used = new Set<number>();
  const room: Room = { green: 0, rock: 0, iron: 0 };
  for (let z = Math.max(0, keep.z - reach); z + 3 <= Math.min(height, keep.z + reach + 1); z++) {
    for (let x = Math.max(0, keep.x - reach); x + 3 <= Math.min(width, keep.x + reach + 1); x++) {
      // The keep and its yard: the game lays the keep and the stores there.
      if (Math.abs(x + 1 - keep.x) < 5 && Math.abs(z + 1 - keep.z) < 5) continue;
      // All nine tiles inside the border, not just the middle one.
      if (Math.hypot(x + 1 - keep.x, z + 1 - keep.z) > reach - 1.5) continue;
      let green = 0, rock = 0, iron = 0, free = true;
      for (let dz = 0; dz < 3 && free; dz++) {
        for (let dx = 0; dx < 3; dx++) {
          const t = (z + dz) * width + x + dx;
          if (used.has(t)) { free = false; break; }
          const g = groundType[t];
          if (GREEN.has(g)) green++;
          else if (g === ROCK) rock++;
          else if (g === IRON) iron++;
        }
      }
      if (!free || (green < 9 && rock < 9 && iron < 9)) continue;
      if (!isBuildable(terrain, x, z, 3, 3)) continue;
      if (green === 9) room.green++; else if (iron === 9) room.iron++; else room.rock++;
      for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) used.add((z + dz) * width + x + dx);
    }
  }
  return room;
}

/**
 * See that a keep has ground to farm and rock to quarry within reach, laying
 * it if not.
 *
 * A painted map can seat a keep in the middle of a desert, and a picture read
 * in as ground routinely comes out as scrub where the artist meant grass. Either
 * way the game opens on a settlement that can never grow a loaf, which reads as
 * broken. So where a keep is short, the nearest dry patch is turned into a
 * meadow -- grass, levelled -- and, if it is short of that too, a rock outcrop.
 * Placed in the ring seven to twenty tiles out: clear of the keep's own yard,
 * inside the border. The patch that costs the least is chosen, cost being the
 * tiles and corners it has to change, so an existing half-meadow is finished
 * before a new one is dug, and a nearer patch beats a farther one of the same
 * price. Water and marsh are never taken: those the painter chose.
 *
 * Returns what was laid, for the editor to say so; the author can paint over
 * any of it.
 */
export function ensureRoom(
  terrain: Terrain, groundType: Uint8Array,
  keep: { x: number; z: number }, others: { x: number; z: number }[],
  reach = KEEP_REACH,
): { laid: string[]; failed: string[] } {
  const { width, height } = terrain;
  const WATER = GROUND_TYPES.indexOf('water');
  const MARSH = GROUND_TYPES.indexOf('marsh');
  const GREEN = new Set([GROUND_TYPES.indexOf('grass'), GROUND_TYPES.indexOf('grass_dark')]);
  const taken = new Set<number>();
  const laid: string[] = [];
  const failed: string[] = [];

  const wants: { label: string; fits: Set<number>; paint: number; sizes: number[]; need: () => number }[] = [
    { label: 'a meadow', fits: GREEN, paint: GROUND_TYPES.indexOf('grass'),
      // Sixteen sites for eight farms: the scatter puts trees on a tenth of
      // any grass, and the game's own starting hovels land on level ground
      // near the keep, which is exactly what this is.
      sizes: [12, 9, 6], need: () => FARMS_WANTED - roomAround(terrain, groundType, keep, reach).green },
    { label: 'a rock outcrop', fits: new Set([GROUND_TYPES.indexOf('rock')]),
      paint: GROUND_TYPES.indexOf('rock'),
      sizes: [6], need: () => QUARRIES_WANTED - roomAround(terrain, groundType, keep, reach).rock },
    // A seam is small: a mine is 3x3 and two of them side by side is 6x3,
    // but a 6x6 of ore beside every keep would be more iron than the map's
    // own generator ever lays.
    { label: 'an iron seam', fits: new Set([GROUND_TYPES.indexOf('iron')]),
      paint: GROUND_TYPES.indexOf('iron'),
      sizes: [4], need: () => MINES_WANTED - roomAround(terrain, groundType, keep, reach).iron },
  ];

  for (const want of wants) {
    if (want.need() <= 0) continue;
    type Patch = { x: number; z: number; size: number; level: number; cost: number };
    let best: Patch | null = null;
    const offer = (p: Patch) => { if (!best || p.cost < best.cost) best = p; };
    for (const size of want.sizes) {
      for (let z = keep.z - reach; z + size <= keep.z + reach; z++) {
        for (let x = keep.x - reach; x + size <= keep.x + reach; x++) {
          if (x < 0 || z < 0 || x + size > width || z + size > height) continue;
          const mx = x + size / 2, mz = z + size / 2;
          const d = Math.hypot(mx - keep.x, mz - keep.z);
          // Six out clears the keep and its stores; the far edge stays at
          // the border, so at most a corner of the patch pokes past it.
          if (d < 6 + size / 2 || d + size / 2 > reach) continue;
          if (others.some(o => Math.hypot(mx - o.x, mz - o.z) < 8 + size / 2)) continue;

          let tiles = 0, ok = true;
          for (let dz = 0; dz < size && ok; dz++) {
            for (let dx = 0; dx < size; dx++) {
              const t = (z + dz) * width + x + dx;
              const g = groundType[t];
              if (g === WATER || g === MARSH || taken.has(t)) { ok = false; break; }
              if (!want.fits.has(g)) tiles++;
            }
          }
          if (!ok) continue;

          // Level the patch to whatever height most of its corners already
          // are, which is the least earth to move.
          const count = new Map<number, number>();
          for (let dz = 0; dz <= size; dz++) {
            for (let dx = 0; dx <= size; dx++) {
              const h = terrain.cornerHeight(x + dx, z + dz);
              count.set(h, (count.get(h) ?? 0) + 1);
            }
          }
          let level = 0, most = -1;
          for (const [h, n] of count) if (n > most) { most = n; level = h; }
          const corners = (size + 1) * (size + 1) - most;

          offer({ x, z, size, level, cost: tiles + corners + d * 0.5 });
        }
      }
      if (best) break;
    }
    // Read through a second name: TypeScript does not see the assignment made
    // inside `offer`, and would hold `best` to be null from here on.
    const patch = best as Patch | null;
    if (!patch) { failed.push(want.label); continue; }

    for (let dz = 0; dz <= patch.size; dz++) {
      for (let dx = 0; dx <= patch.size; dx++) terrain.setCorner(patch.x + dx, patch.z + dz, patch.level);
    }
    for (let dz = 0; dz < patch.size; dz++) {
      for (let dx = 0; dx < patch.size; dx++) {
        const t = (patch.z + dz) * width + patch.x + dx;
        groundType[t] = want.paint;
        taken.add(t);
      }
    }
    laid.push(want.label);
  }
  return { laid, failed };
}

/**
 * The per-keep audit, for a map that has keeps on it.
 *
 * Says which keep is short of what, as the whole-map count in auditMap cannot:
 * a map can be a third meadow and still have every keep in the desert.
 */
export function auditKeeps(
  terrain: HeightField, groundType: Uint8Array,
  spots: ({ x: number; z: number } | null)[],
): string[] {
  const warnings: string[] = [];
  spots.forEach((p, i) => {
    if (!p) return;
    const whose = i === 0 ? 'Your keep' : `The ${KEEP_COLOURS[i].name}\u2019s keep`;
    const room = roomAround(terrain, groundType, p);
    if (room.green < 3) warnings.push(`${whose} has room for ${room.green === 0 ? 'no farm' : `only ${room.green} farm${room.green > 1 ? 's' : ''}`}.`);
    if (room.rock < 1) warnings.push(`${whose} has no flat rock to quarry.`);
    if (room.iron < 1) warnings.push(`${whose} has no iron ore to mine.`);
  });
  return warnings;
}
