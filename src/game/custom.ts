import type { Terrain } from '../engine/terrain';
import { GROUND_TYPES, type GroundType, isBuildable } from './worldgen';
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
      if (flat && type !== 'rock' && type !== 'marsh' && type !== 'water') flatTiles.push({ x, z });
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
  const WATER = GROUND_TYPES.indexOf('water');
  const MARSH = GROUND_TYPES.indexOf('marsh');
  let green = 0, rock = 0, buildable = 0;

  for (let z = 0; z < terrain.height; z += 2) {
    for (let x = 0; x < terrain.width; x += 2) {
      const g = groundType[z * terrain.width + x];
      if (g === WATER || g === MARSH) continue;   // level, but nothing goes on it
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
