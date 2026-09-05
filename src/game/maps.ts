/**
 * The maps a player can choose from.
 *
 * Each is a set of biases on the same generator rather than hand-drawn terrain.
 * A Crusader map is characterised by what it is SHORT of -- one is green and
 * wooded, another is bare rock, another is half bog -- and biasing the
 * thresholds says exactly that in a few numbers, where a hand-drawn map would
 * say it in a megabyte.
 *
 * The later maps bend the SHAPE of the ground as well as its cover -- height,
 * grain, lakes, a coast, dune ridges -- through the same few numbers. Every
 * one of those is optional and reads as the old behaviour when absent, which
 * is not tidiness: a save is a diff against the world its seed regenerates,
 * so a setting that changed a map already shipped would move the ground under
 * games in progress.
 */

/** How a map bends the generator. 0 is the default world. */
export interface MapSettings {
  seed: number;
  /** Positive = greener. Lowers the moisture thresholds for grass. */
  green: number;
  /** Positive = more rock outcrops. */
  rock: number;
  /** Positive = more pitch marsh. */
  marsh: number;
  /** Multiplies vegetation density, 1 = default. */
  trees: number;
  /**
   * Half-width of the river running down the wadi, in noise units. 0 is a dry
   * wadi. The desert map's wadi is a riverbed; on most of these there is
   * water still in the bottom of it.
   */
  river?: number;
  /**
   * Multiplies the height of the land, 1 = default.
   *
   * Below 1 the tiers collapse into a plain you can see across and cannot
   * hide behind; above 1 the top tier is reached over most of the map and the
   * ground becomes tablelands parted by sheer steps.
   */
  relief?: number;
  /**
   * Multiplies the frequency of the elevation noise, 1 = default. Below 1 the
   * landforms are few and broad, above 1 the same height is cut into many
   * small ridges and ravines.
   */
  grain?: number;
  /**
   * Standing water in hollows away from the wadi, 0 = none. Roughly the
   * fraction of the map under water; useful values are small, 0.04 to 0.16.
   */
  lakes?: number;
  /**
   * A sea along the southern edge, as a fraction of the map's depth. The
   * shoreline wanders, so this is the average reach and not a ruled line.
   */
  coast?: number;
  /**
   * Height of the dune ridges laid over the land, 0 = none. About 1 gives
   * crests a whole step above their troughs.
   */
  dunes?: number;
}

export type Difficulty = 'Gentle' | 'Fair' | 'Harsh';

/**
 * The world's size in tiles.
 *
 * Here rather than in main.ts because the menu previews a map at exactly the
 * size the game will build it. A preview drawn at a different size would put
 * every keep you placed in the wrong place.
 */
export const MAP_W = 200;
export const MAP_H = 200;

export interface MapDef extends MapSettings {
  id: string;
  name: string;
  blurb: string;
  /** Rival lords on the map, 0-3. They fight each other as well as you. */
  lords: number;
  difficulty: Difficulty;
  /**
   * Present on hand-drawn maps, which carry their own tiles instead of being
   * regenerated from the seed. Typed loosely to keep maps.ts free of a
   * dependency on the editor's storage format.
   */
  custom?: { id: string; name: string; w: number; h: number;
             corners: string; ground: string; trees: number; lords: number;
             version: number; savedAt: number;
             start?: { x: number; z: number };
             keeps?: { x: number; z: number }[] };
}

/**
 * Ratings shown in the menu, 0-4.
 *
 * Derived from the same numbers that drive the generator rather than typed in
 * by hand, so the bars can never promise a map something the generator does
 * not actually produce.
 */
export function ratings(m: MapDef): { label: string; value: number }[] {
  const clamp = (n: number) => Math.max(0, Math.min(4, Math.round(n)));
  return [
    { label: 'Farmland', value: clamp(2 + m.green * 28) },
    { label: 'Stone',    value: clamp(2 + m.rock * 26) },
    { label: 'Timber',   value: clamp(m.trees * 2) },
    { label: 'Marsh',    value: clamp(2 + m.marsh * 26) },
    { label: 'Water',    value: clamp((m.river ?? 0) * 130
                                     + (m.lakes ?? 0) * 22 + (m.coast ?? 0) * 12) },
    // Relief reads the height of the land and the ways it is broken up:
    // taller tiers, dune ridges, and a finer grain than the default all make
    // for ground you have to build around. A coarser grain does not count
    // against it -- broad plateaus are still plateaus.
    { label: 'Relief',   value: clamp(((m.relief ?? 1) - 0.3) * 2.6
                                     + (m.dunes ?? 0) * 1.2
                                     + Math.max(0, (m.grain ?? 1) - 1)) },
  ];
}

export const MAPS: MapDef[] = [
  {
    id: 'wadi',
    name: 'The Green Wadi',
    blurb: 'A river of green through dry country. Enough of everything, and '
         + 'one lord across the sand who wants it.',
    seed: 20260818, green: 0, rock: 0, marsh: 0, trees: 1, river: 0.016,
    lords: 1, difficulty: 'Fair',
  },
  {
    id: 'valley',
    name: 'The Quiet Valley',
    blurb: 'Good land, deep woods, and nobody to fight. Build what you like '
         + 'and see how large a town the ground will carry.',
    seed: 71104, green: 0.055, rock: -0.03, marsh: -0.04, trees: 1.5, river: 0.022,
    lords: 0, difficulty: 'Gentle',
  },
  {
    id: 'dust',
    name: 'Dust and Stone',
    blurb: 'Rock in every direction and barely a field to be had. You will '
         + 'have stone for walls long before you have bread to hold them.',
    seed: 44810, green: -0.055, rock: 0.075, marsh: -0.05, trees: 0.35, river: 0.010,
    lords: 1, difficulty: 'Harsh',
  },
  {
    id: 'tarpits',
    name: 'The Tar Pits',
    blurb: 'Half this valley is bog. Pitch enough to burn an army, if you can '
         + 'march your own around the mire to reach them.',
    seed: 9273, green: 0.02, rock: -0.01, marsh: 0.085, trees: 0.9, river: 0.026,
    lords: 2, difficulty: 'Fair',
  },
  {
    id: 'cedar',
    name: 'Cedar Ridge',
    blurb: 'Timber and high stone both. Room to build properly — and two '
         + 'rivals who will bleed each other before they come for you.',
    seed: 33517, green: 0.02, rock: 0.05, marsh: -0.02, trees: 1.9, river: 0.020,
    lords: 2, difficulty: 'Harsh',
  },
  {
    id: 'drought',
    name: 'The Long Drought',
    blurb: 'Sand, and more sand. No wood worth the name and no bog to burn, '
         + 'and three lords already dividing what little there is.',
    seed: 60249, green: -0.085, rock: 0.01, marsh: -0.06, trees: 0.15, river: 0.008,
    lords: 3, difficulty: 'Harsh',
  },
  {
    id: 'saltpan',
    name: 'The Salt Pan',
    blurb: 'Flat as a table from one edge to the other, with shallow salt '
         + 'lakes lying in it. Nothing here is high ground, so your walls are '
         + 'the only ground you hold.',
    seed: 81330, green: -0.055, rock: 0.02, marsh: -0.02, trees: 0.4, river: 0.014,
    relief: 0.34, grain: 0.7, lakes: 0.055,
    lords: 2, difficulty: 'Fair',
  },
  {
    id: 'tables',
    name: 'The High Tables',
    blurb: 'Great flat-topped rocks standing over a canyon with a river in '
         + 'the bottom. Build up on a table and only the ramps can be walked '
         + '— if you can carry bread up to it.',
    seed: 15582, green: -0.015, rock: 0.045, marsh: -0.03, trees: 0.6, river: 0.020,
    relief: 1.42, grain: 0.6,
    lords: 2, difficulty: 'Harsh',
  },
  {
    id: 'badlands',
    name: 'The Broken Country',
    blurb: 'Gullies and ridges as far as a horse can be ridden, and hardly a '
         + 'field\u2019s worth of level ground in any of it. A hard place to '
         + 'build, and a harder one to march an army across.',
    seed: 27441, green: -0.08, rock: 0.045, marsh: -0.02, trees: 0.7, river: 0.016,
    relief: 1.05, grain: 2.1,
    lords: 1, difficulty: 'Harsh',
  },
  {
    id: 'coast',
    name: 'The Salt Coast',
    blurb: 'Green country running down to a sea, with a strand along the '
         + 'whole southern edge. Fish will feed a town that farms badly — but '
         + 'your back is to deep water.',
    seed: 50912, green: 0.035, rock: -0.01, marsh: -0.01, trees: 0.9, river: 0.014,
    relief: 0.8, coast: 0.22,
    lords: 1, difficulty: 'Fair',
  },
  {
    id: 'reeds',
    name: 'The Lake of Reeds',
    blurb: 'Low ground broken into pools and reed beds, wet enough to farm '
         + 'and to fish. Water is everywhere here, which means an army has '
         + 'few ways in — and so do your carts.',
    seed: 68105, green: 0.05, rock: -0.02, marsh: 0.04, trees: 1.2, river: 0.020,
    relief: 0.62, grain: 0.9, lakes: 0.09,
    lords: 1, difficulty: 'Gentle',
  },
  {
    id: 'dunes',
    name: 'The Dune Sea',
    blurb: 'Rank on rank of sand ridges with a thread of a river lost among '
         + 'them. No timber, no bog, and three lords who between them hold '
         + 'every scrap of ground worth a farm.',
    seed: 94627, green: -0.095, rock: -0.005, marsh: -0.055, trees: 0.12, river: 0.012,
    relief: 0.6, grain: 0.85, dunes: 1.15,
    lords: 3, difficulty: 'Harsh',
  },
];

export const DEFAULT_MAP = MAPS[0];
