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

/**
 * Ground colours, one per GROUND_TYPES entry.
 *
 * Beside the types they index rather than in main.ts, because the menu draws a
 * map preview before main.ts exists. The same swatches the editor's brushes
 * use, so the picture in the corner, the palette you painted with, and the
 * preview you place a keep on all agree about what grass looks like.
 */
export const GROUND_COLOURS: [number, number, number][] = [
  [201, 169, 120],  // sand
  [157, 154, 94],   // scrub
  [127, 156, 78],   // grass
  [85, 116, 54],    // lush
  [142, 139, 131],  // rock
  [74, 68, 56],     // marsh
  [74, 124, 150],   // water
];

export interface GeneratedMap {
  terrain: Terrain;
  /** Flat, buildable tiles, handy for scattering props and placing buildings. */
  flatTiles: { x: number; z: number }[];
  /** Ground type index per tile, for deciding what vegetation belongs where. */
  groundType: Uint8Array;
}

/**
 * The shape of a map, computed from its settings alone.
 *
 * Pulled out of `generateMap` so the MENU can draw a map before the game
 * exists. It has no Terrain, no textures and no renderer -- just noise and
 * arithmetic -- which matters for more than convenience: the lord-placement
 * screen previews a map the player has not entered yet, and if that preview
 * came from a second implementation the two would drift and the picture you
 * placed your keep on would not be the map you woke up in. There is one
 * generator, and both callers run it.
 */
export interface TerrainShape {
  width: number;
  height: number;
  /** Corner heights, row-major over (width + 1) * (height + 1). */
  corners: Uint8Array;
  /** Index into GROUND_TYPES per tile. */
  groundType: Uint8Array;
  /** Texture variant 0-3 per tile. */
  variant: Uint8Array;
  /** 1 where the face is steep enough to draw as cliff rather than its type. */
  cliff: Uint8Array;
  /** Flat, buildable tiles, handy for scattering props and placing buildings. */
  flatTiles: { x: number; z: number }[];
}

export function shapeTerrain(
  settings: MapSettings, width: number, height: number,
): TerrainShape {
  const { seed, green, rock, marsh } = settings;
  const river = settings.river ?? 0;
  const relief = settings.relief ?? 1;
  const grain = settings.grain ?? 1;
  const dunes = settings.dunes ?? 0;
  const lakes = settings.lakes ?? 0;
  const coast = settings.coast ?? 0;
  const noise = makeNoise(seed);

  // --- landforms the two passes have to agree about -----------------------
  // Both the elevation pass and the ground pass need to know where the sea
  // and the lake basins are: one cuts the ground flat for them, the other
  // decides where the water actually stands. Asked twice through the same
  // closure rather than remembered in an array, for the same reason the wadi
  // is recomputed below -- a lookup is cheaper than 40,000 stored floats.

  /**
   * How far inland the sea reaches at this column, in tiles.
   *
   * The wobble is large on purpose: the sea comes in anywhere from a quarter
   * to nearly twice its mean depth, because a shoreline that merely ripples
   * is a ruled line with a fringe. At this amplitude it bites bays a good way
   * inland and leaves headlands between them, which is what gives a coast
   * somewhere worth putting a fishery and somewhere worth defending.
   */
  const seaReach = (x: number) => {
    if (coast <= 0) return 0;
    // The noise sits within about a fifth either side of a half, so it is
    // stretched to roughly -1..1 before it is used as a proportion.
    const wobble = Math.max(-0.9, Math.min(0.9, (noise(x + 900, 40, 3, 0.02) - 0.5) * 4));
    return coast * height * (1 + wobble * 0.8);
  };
  /** Signed distance inland from the shoreline: positive is seaward. */
  const seaward = (x: number, z: number) =>
    coast <= 0 ? -Infinity : z - (height - seaReach(x));

  /**
   * Depth of a hollow, for maps that hold standing water away from the wadi.
   *
   * Above `lakeWater` the ground is under water; the shallower band down to
   * `lakeWater - 0.05` is cut flat as well, which is what gives a lake a
   * buildable shore instead of a wall of cliff dropping straight into it.
   */
  const hollow = (x: number, z: number) => noise(x + 5600, z + 4100, 3, 0.028);
  const lakeWater = 0.72 - lakes;

  // --- elevation ----------------------------------------------------------
  const MAX_LEVEL = 5;
  const cw = width + 1;
  const corners = new Uint8Array(cw * (height + 1));
  for (let z = 0; z <= height; z++) {
    for (let x = 0; x <= width; x++) {
      const n = noise(x, z, 4, 0.018 * grain);
      // quantise hard so the ground forms tiers rather than dunes
      let level = Math.floor(n * (MAX_LEVEL + 1.4) * relief);
      // Dune ridges. Bent by slow noise so they wander like a dune field
      // instead of ruling parallel stripes across the map, and added AFTER
      // the quantisation so a crest is a whole step and reads as a ridge.
      if (dunes > 0) {
        const drift = noise(x + 2200, z + 800, 2, 0.008);
        level += Math.round(Math.sin((x * 0.85 + z * 0.35) * 0.32 + drift * 9) * dunes);
      }
      // carve a wadi across the middle
      const wadi = Math.abs(noise(x, z, 2, 0.012) - 0.5);
      if (wadi < 0.055) level = Math.max(0, level - 2);
      // The channel floor is flattened to zero rather than merely lowered.
      // A river has to be continuous to read as one, and a bed that still
      // steps up and down where it crosses higher ground gives a chain of
      // ponds instead.
      if (river > 0 && wadi < river) level = 0;
      // Lake basins and the shelf around them, flattened for the same reason.
      if (lakes > 0 && hollow(x, z) > lakeWater - 0.05) level = 0;
      // The sea, the strand, and a tile of ground behind it, for the same
      // reason: a beach that steps is a cliff at the waterline.
      if (coast > 0 && seaward(x, z) > -5) level = 0;
      corners[z * cw + x] = Math.max(0, Math.min(MAX_LEVEL, level));
    }
  }
  const cornerHeight = (x: number, z: number) => corners[z * cw + x];

  // --- ground cover -------------------------------------------------------
  const flatTiles: { x: number; z: number }[] = [];
  const groundType = new Uint8Array(width * height);
  const variants = new Uint8Array(width * height);
  const cliff = new Uint8Array(width * height);

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const t = z * width + x;

      const c0 = cornerHeight(x, z);
      const c1 = cornerHeight(x + 1, z);
      const c2 = cornerHeight(x + 1, z + 1);
      const c3 = cornerHeight(x, z + 1);
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

      // The wadi again, for the water in the bottom of it and the bog along
      // its banks. Recomputed rather than carried over from the elevation
      // pass: one array of 40,000 floats to avoid one cheap noise lookup is
      // not a trade worth making.
      const wadi = Math.abs(noise(x, z, 2, 0.012) - 0.5);

      const sea = seaward(x, z);

      let type: GroundType;
      if (sea > 4) {
        // The sea. First, along with the other standing water, so that
        // nothing else can claim a tile the player cannot build on anyway.
        type = 'water';
      } else if (sea > -4) {
        // The strand. Sand whatever the moisture says, because a beach that
        // shades into meadow at the waterline does not read as a coast.
        type = 'sand';
      } else if (lakes > 0 && flat && lo === 0 && hollow(x, z) > lakeWater) {
        type = 'water';
      } else if (river > 0 && flat && wadi < river) {
        // Standing water in the channel. First, so nothing else can claim it.
        type = 'water';
      } else if (slope >= 2 || (hi >= 4 && patch > 0.55 - rock)
          || (flat && outcrop > 0.63 - rock)) {
        type = 'rock';
      } else if (flat && bog > 0.58
          && ((river > 0 && wadi < river * 2.0)
              || (lakes > 0 && lo === 0 && hollow(x, z) > lakeWater - 0.05))) {
        // Tar seeps along the banks.
        //
        // Deliberately NOT scaled by the map's marsh bias, unlike the belt
        // rule below. Pitch used to be a fertile-belt feature only, so the two
        // driest maps -- which bias marsh down hard, because that is their
        // character -- had none at all and a pitch rig that could never be
        // built. A fixed threshold here guarantees every map a usable seam
        // beside its water while leaving the bias to shape everywhere else.
        type = 'marsh';
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

      variants[t] = variant;
      // Cliff faces are a RENDER-ONLY type, deliberately kept out of
      // GROUND_TYPES: gameplay still sees plain rock here (nothing may be
      // built on a 2-step face anyway, so no placement rule needs to know),
      // while the texture switches to broken rock instead of the flat
      // top-down plateau stone. Reusing the plateau texture on a 39-degree
      // face is what made cliffs read as pale grey ribbons.
      cliff[t] = slope >= 2 ? 1 : 0;
      groundType[t] = GROUND_TYPES.indexOf(type as GroundType);
      // marsh takes no buildings but a pitch rig, so it is not a build site
      if (flat && type !== 'rock' && type !== 'marsh' && type !== 'water') flatTiles.push({ x, z });
    }
  }

  return { width, height, corners, groundType, variant: variants, cliff, flatTiles };
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
  // The shape is computed without the renderer; this only pours it in.
  const shape = shapeTerrain(settings, terrain.width, terrain.height);

  const cw = terrain.width + 1;
  for (let z = 0; z <= terrain.height; z++) {
    for (let x = 0; x <= terrain.width; x++) {
      terrain.setCorner(x, z, shape.corners[z * cw + x]);
    }
  }
  for (let t = 0; t < shape.groundType.length; t++) {
    const type = shape.cliff[t] ? 'cliff' : GROUND_TYPES[shape.groundType[t]];
    terrain.layer[t] = layerOf(type, shape.variant[t]);
  }

  terrain.rebuild();
  return { terrain, flatTiles: shape.flatTiles, groundType: shape.groundType };
}

/** Is every tile in this footprint flat and at the same level? */
/**
 * The little of a Terrain that the placement rules actually read.
 *
 * Widened from `Terrain` so the same functions can be asked about a
 * `TerrainShape` -- the menu has to know where a keep may stand on a map it
 * has not built a renderer for. `Terrain` satisfies this structurally, so
 * every existing caller passes one unchanged.
 */
export interface HeightField {
  width: number;
  height: number;
  cornerHeight(x: number, z: number): number;
}

/** Read a computed shape through the same interface a Terrain offers. */
export function heightFieldOf(shape: TerrainShape): HeightField {
  const cw = shape.width + 1;
  return {
    width: shape.width,
    height: shape.height,
    cornerHeight: (x, z) => shape.corners[z * cw + x],
  };
}

export function isBuildable(
  terrain: HeightField, x: number, z: number, w: number, d: number,
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
  terrain: HeightField, groundType: Uint8Array, radius = 26,
): { x: number; z: number } {
  const { width, height } = terrain;
  const idx = (x: number, z: number) => z * width + x;
  const GRASS = GROUND_TYPES.indexOf('grass');
  const DARK = GROUND_TYPES.indexOf('grass_dark');
  const ROCK = GROUND_TYPES.indexOf('rock');
  const WATER = GROUND_TYPES.indexOf('water');

  let best = { x: Math.floor(width / 2), z: Math.floor(height / 2) };
  let bestScore = -Infinity;

  const step = 6;
  const margin = radius + 8;
  for (let z = margin; z < height - margin; z += step) {
    for (let x = margin; x < width - margin; x += step) {
      if (!isBuildable(terrain, x - 1, z - 1, 5, 5)) continue;

      let green = 0, rock = 0, flat = 0, water = 0;
      for (let dz = -radius; dz <= radius; dz += 2) {
        for (let dx = -radius; dx <= radius; dx += 2) {
          const tx = x + dx, tz = z + dz;
          if (tx < 0 || tz < 0 || tx >= width || tz >= height) continue;
          const g = groundType[idx(tx, tz)];
          // Water is level ground, so `isBuildable` is perfectly happy with
          // it -- it only reads corner heights. Counted as flat, a lake was
          // the flattest country on the map, and on the lake and coast maps
          // that put the player's keep in the middle of one. Water is scored
          // on its own terms below: worth something to be beside, worth
          // nothing to stand in.
          if (g === WATER) { water++; continue; }
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
      // A little water in reach is a fishery and a water pot, so it earns a
      // small bonus -- capped, because a shore is worth having and a swamp is
      // not.
      const score = Math.min(green, 60) * 4 + Math.min(rock, 30) * 3 + flat
        + Math.min(water, 25) * 2
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
