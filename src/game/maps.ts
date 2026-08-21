/**
 * The maps a player can choose from.
 *
 * Each is a set of biases on the same generator rather than hand-drawn terrain.
 * A Crusader map is characterised by what it is SHORT of -- one is green and
 * wooded, another is bare rock, another is half bog -- and biasing the
 * thresholds says exactly that in a few numbers, where a hand-drawn map would
 * say it in a megabyte.
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
}

export type Difficulty = 'Gentle' | 'Fair' | 'Harsh';

export interface MapDef extends MapSettings {
  id: string;
  name: string;
  blurb: string;
  /** Rival lords on the map, 0-3. They fight each other as well as you. */
  lords: number;
  difficulty: Difficulty;
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
  ];
}

export const MAPS: MapDef[] = [
  {
    id: 'wadi',
    name: 'The Green Wadi',
    blurb: 'A river of green through dry country. Enough of everything, and '
         + 'one lord across the sand who wants it.',
    seed: 20260818, green: 0, rock: 0, marsh: 0, trees: 1,
    lords: 1, difficulty: 'Fair',
  },
  {
    id: 'valley',
    name: 'The Quiet Valley',
    blurb: 'Good land, deep woods, and nobody to fight. Build what you like '
         + 'and see how large a town the ground will carry.',
    seed: 71104, green: 0.055, rock: -0.03, marsh: -0.04, trees: 1.5,
    lords: 0, difficulty: 'Gentle',
  },
  {
    id: 'dust',
    name: 'Dust and Stone',
    blurb: 'Rock in every direction and barely a field to be had. You will '
         + 'have stone for walls long before you have bread to hold them.',
    seed: 44810, green: -0.055, rock: 0.075, marsh: -0.05, trees: 0.35,
    lords: 1, difficulty: 'Harsh',
  },
  {
    id: 'tarpits',
    name: 'The Tar Pits',
    blurb: 'Half this valley is bog. Pitch enough to burn an army, if you can '
         + 'march your own around the mire to reach them.',
    seed: 9273, green: 0.02, rock: -0.01, marsh: 0.085, trees: 0.9,
    lords: 2, difficulty: 'Fair',
  },
  {
    id: 'cedar',
    name: 'Cedar Ridge',
    blurb: 'Timber and high stone both. Room to build properly — and two '
         + 'rivals who will bleed each other before they come for you.',
    seed: 33517, green: 0.02, rock: 0.05, marsh: -0.02, trees: 1.9,
    lords: 2, difficulty: 'Harsh',
  },
  {
    id: 'drought',
    name: 'The Long Drought',
    blurb: 'Sand, and more sand. No wood worth the name and no bog to burn, '
         + 'and three lords already dividing what little there is.',
    seed: 60249, green: -0.085, rock: 0.01, marsh: -0.06, trees: 0.15,
    lords: 3, difficulty: 'Harsh',
  },
];

export const DEFAULT_MAP = MAPS[0];
