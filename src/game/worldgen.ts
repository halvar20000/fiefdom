import { Terrain } from '../engine/terrain';
import type { MapSettings } from './maps';

/** Deterministic value noise -- no dependencies, same map every reload. */
function makeNoise(seed: number) {
  const hash = (x: number, y: number) => {
    let h = x * 374761393 + y * 668265263 + seed * 2147483647;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);

  const value = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };

  return (x: number, y: number, octaves = 4, scale = 0.04) => {
    let sum = 0, amp = 1, freq = scale, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += value(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  };
}

/**
 * Ground kinds, in the order their indices are stored in saves and painted
 * maps. APPEND ONLY -- reordering these silently rewrites every map already
 * saved, because a painted map stores the index and not the name.
 */
export const GROUND_TYPES =
  ['sand', 'scrub', 'grass', 'grass_dark', 'rock', 'marsh', 'water'] as const;
export type GroundType = typeof GROUND_TYPES[number];

export interface GeneratedMap {
  terrain: Terrain;
  /** Flat, buildable tiles, handy for scattering props and placing buildings. */
  flatTiles: { x: number; z: number }[];
  /** Ground type index per tile, for deciding what vegetation belongs where. */
  groundType: Uint8Array;
}

/**
 * A Crusader-style desert map: mostly dry earth, drifts of scrub, a green belt
 * along a low wadi, rocky high ground. Terrain is deliberately tiered in whole
 * steps with broad flat plateaus -- Stronghold's ground is not rolling hills,
 * it is tables and ramps, and you need the flat area to build on anyway.
 */
export function generateMap(
  terrain: Terrain,
  layerOf: (type: string, variant: number) => number,
  settings: MapSettings = { seed: 1337, green: 0, rock: 0, marsh: 0, trees: 1 },
): GeneratedMap {
  const { seed, green, rock, marsh } = settings;
  const noise = makeNoise(seed);
  const { width, height } = terrain;

  // --- elevation ----------------------------------------------------------
  const MAX_LEVEL = 5;
  for (let z = 0; z <= height; z++) {
    for (let x = 0; x <= width; x++) {
      const n = noise(x, z, 4, 0.018);
      // quantise hard so the ground forms tiers rather than dunes
      let level = Math.floor(n * (MAX_LEVEL + 1.4));
      // carve a wadi across the middle
      const wadi = Math.abs(noise(x, z, 2, 0.012) - 0.5);
      if (wadi < 0.055) level = Math.max(0, level - 2);
      terrain.setCorner(x, z, Math.max(0, Math.min(MAX_LEVEL, level)));
    }
  }

  // --- ground cover -------------------------------------------------------
  const flatTiles: { x: number; z: number }[] = [];
  const groundType = new Uint8Array(width * height);

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const t = z * width + x;

      const c0 = terrain.cornerHeight(x, z);
      const c1 = terrain.cornerHeight(x + 1, z);
      const c2 = terrain.cornerHeight(x + 1, z + 1);
      const c3 = terrain.cornerHeight(x, z + 1);
      const lo = Math.min(c0, c1, c2, c3);
      const hi = Math.max(c0, c1, c2, c3);
      const flat = lo === hi;
      const slope = hi - lo;

      const moisture = noise(x + 500, z + 900, 4, 0.022);
      const patch = noise(x + 40, z + 70, 3, 0.09);
      const variant = Math.floor(noise(x * 3.1, z * 3.7, 1, 0.9) * 4) & 3;

      // Flat rock outcrops, independent of elevation.
      //
      // Without these the game is unplayable: quarries and iron mines demand
      // rock ground, but rock was only ever assigned to steep tiles, which then
      // fail the "ground must be level" placement test. Rock and buildable were
      // mutually exclusive, so neither building could ever be placed.
      const outcrop = noise(x + 3100, z + 1700, 3, 0.05);

      // Pitch marsh: boggy ground where tar seeps to the surface.
      //
      // Seeded INSIDE the fertile belt on purpose. Putting it out in the dead
      // sand would make it free real estate; sitting on the good land it costs
      // the player something to own, and because troops wade through it at half
      // pace it also shapes where an attack can sensibly come from.
      const bog = noise(x + 7700, z + 2300, 3, 0.06);

      let type: GroundType;
      if (slope >= 2 || (hi >= 4 && patch > 0.55 - rock)
          || (flat && outcrop > 0.63 - rock)) {
        type = 'rock';
      } else if (flat && moisture > 0.47 - green && bog > 0.60 - marsh) {
        type = 'marsh';
      // Green bands widened deliberately. Measured on the original thresholds,
      // a starting position had exactly ONE legal wheat-farm site within 15
      // tiles, which reads as the game being broken rather than as the desert
      // being harsh. Scarce fertile land is the point of a Crusader map, but it
      // has to be findable.
      } else if (moisture > 0.575 - green) {
        type = 'grass_dark';
      } else if (moisture > 0.495 - green) {
        type = 'grass';
      } else if (moisture > 0.425 - green) {
        type = 'scrub';
      } else {
        type = 'sand';
      }

      // Cliff faces are a RENDER-ONLY type, deliberately kept out of
      // GROUND_TYPES: gameplay still sees plain rock here (nothing may be
      // built on a 2-step face anyway, so no placement rule needs to know),
      // while the texture switches to broken rock instead of the flat
      // top-down plateau stone. Reusing the plateau texture on a 39-degree
      // face is what made cliffs read as pale grey ribbons.
      terrain.layer[t] = layerOf(slope >= 2 ? 'cliff' : type, variant);
      groundType[t] = GROUND_TYPES.indexOf(type as GroundType);
      // marsh takes no buildings but a pitch rig, so it is not a build site
      if (flat && type !== 'rock' && type !== 'marsh') flatTiles.push({ x, z });
    }
  }

  terrain.rebuild();
  return { terrain, flatTiles, groundType };
}

/** Is every tile in this footprint flat and at the same level? */
export function isBuildable(
  terrain: Terrain, x: number, z: number, w: number, d: number,
): boolean {
  if (x < 0 || z < 0 || x + w > terrain.width || z + d > terrain.height) return false;
  const base = terrain.cornerHeight(x, z);
  for (let dz = 0; dz <= d; dz++) {
    for (let dx = 0; dx <= w; dx++) {
      if (terrain.cornerHeight(x + dx, z + dz) !== base) return false;
    }
  }
  return true;
}

/**
 * Choose a starting location.
 *
 * A random centre of the map is a bad opening: the player can easily land in
 * open desert with no green land for farms and no rock for a quarry within
 * reach, which reads as the game being broken rather than as a challenge.
 * Candidates are scored on having a buildable core plus both resources nearby.
 */
export function findStartSite(
  terrain: Terrain, groundType: Uint8Array, radius = 26,
): { x: number; z: number } {
  const { width, height } = terrain;
  const idx = (x: number, z: number) => z * width + x;
  const GRASS = GROUND_TYPES.indexOf('grass');
  const DARK = GROUND_TYPES.indexOf('grass_dark');
  const ROCK = GROUND_TYPES.indexOf('rock');

  let best = { x: Math.floor(width / 2), z: Math.floor(height / 2) };
  let bestScore = -Infinity;

  const step = 6;
  const margin = radius + 8;
  for (let z = margin; z < height - margin; z += step) {
    for (let x = margin; x < width - margin; x += step) {
      if (!isBuildable(terrain, x - 1, z - 1, 5, 5)) continue;

      let green = 0, rock = 0, flat = 0;
      for (let dz = -radius; dz <= radius; dz += 2) {
        for (let dx = -radius; dx <= radius; dx += 2) {
          const tx = x + dx, tz = z + dz;
          if (tx < 0 || tz < 0 || tx >= width || tz >= height) continue;
          const g = groundType[idx(tx, tz)];
          const buildable = isBuildable(terrain, tx, tz, 3, 3);
          if (buildable) flat++;
          // Only count ground a farm or quarry could actually be PUT on.
          // Counting raw green tiles rewarded lush hillsides that are useless
          // because nothing can be built on a slope.
          if (!buildable) continue;
          if (g === GRASS || g === DARK) green++;
          else if (g === ROCK) rock++;
        }
      }
      const score = Math.min(green, 60) * 4 + Math.min(rock, 30) * 3 + flat
        - (green < 8 ? 900 : 0) - (rock < 4 ? 900 : 0);
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
  }
  return best;
}

/** Find a flat spot of the given size near a preferred point. */
export function findSite(
  terrain: Terrain, w: number, d: number,
  nearX: number, nearZ: number, radius = 40,
): { x: number; z: number } | null {
  for (let r = 0; r <= radius; r += 1) {
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      const x = Math.round(nearX + Math.cos(ang) * r);
      const z = Math.round(nearZ + Math.sin(ang) * r);
      if (isBuildable(terrain, x, z, w, d)) return { x, z };
    }
  }
  return null;
}
