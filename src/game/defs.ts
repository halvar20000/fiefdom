/**
 * Resource and building definitions -- the economy's data model.
 *
 * Deliberately data-driven: adding a building should mean adding an entry here
 * plus a Blender model, not touching the simulation.
 */

export const RAW_RESOURCES =
  ['wood', 'stone', 'iron', 'pitch', 'wheat', 'flour', 'hops', 'ale', 'pigs'] as const;
export const FOOD_RESOURCES = ['bread', 'cheese', 'apples', 'meat', 'fish'] as const;

export type RawResource = typeof RAW_RESOURCES[number];
export type FoodResource = typeof FOOD_RESOURCES[number];
export type Resource = RawResource | FoodResource;

export const ALL_RESOURCES: Resource[] = [...RAW_RESOURCES, ...FOOD_RESOURCES];

export function isFood(r: Resource): r is FoodResource {
  return (FOOD_RESOURCES as readonly string[]).includes(r);
}

export const RESOURCE_LABELS: Record<Resource, string> = {
  wood: 'Wood', stone: 'Stone', iron: 'Iron', pitch: 'Pitch',
  wheat: 'Wheat', flour: 'Flour', hops: 'Hops', ale: 'Ale', pigs: 'Pigs',
  bread: 'Bread', cheese: 'Cheese', apples: 'Apples', meat: 'Meat', fish: 'Fish',
};

/** Where a produced good is delivered. */
export type Store = 'stockpile' | 'granary';

export type Category = 'castle' | 'industry' | 'farm' | 'food' | 'town';

/**
 * Terrain a building demands underneath it.
 * Farms need green ground and quarries need rock, exactly as in the original --
 * it is what forces you to build outward from the keep instead of stacking
 * everything in one tidy square.
 */
export type TerrainNeed = 'any' | 'green' | 'rock' | 'sand' | 'marsh';

/**
 * How close water must be for a building that works it.
 *
 * Measured from the footprint's edge, not its centre, so a 2x2 hut sited with
 * its back to the bank counts the same as one facing it. Three tiles rather
 * than one: demanding the footprint actually touch the water makes siting on a
 * ragged imported coastline a pixel-hunt, and a jetty three tiles long is not
 * a thing anyone will quarrel with.
 */
export const WATER_REACH = 3;

/**
 * The storehouse.
 *
 * Capacity is all goods together, not per kind: it is a shed, not a set of
 * bins, and a per-kind allowance would let one full good hide the fact that
 * the shed is otherwise empty.
 *
 * The carrier moves a bigger load than a producer does, which is the entire
 * point -- one long walk replaces several, so a distant workings keeps
 * producing while a single man does the hauling.
 */
/**
 * What pulling a building down gives back.
 *
 * Half, not all and not nothing. Nothing punishes a misclick harder than the
 * mistake deserves and makes the player reload rather than adapt; all of it
 * makes the build menu a free sketchpad and removes any weight from choosing
 * where things go.
 */
export const DEMOLISH_REFUND = 0.5;

export const DEPOT_CAPACITY = 48;
export const DEPOT_BATCH = 12;

export interface Production {
  /** What comes out, one unit per completed cycle. */
  output: Resource;
  /** Units of output produced per cycle. */
  amount: number;
  /** Seconds of actual work per cycle. */
  seconds: number;
  /** Consumed from the stores at the start of a cycle. */
  inputs?: Partial<Record<Resource, number>>;
  /** Where the output is delivered. */
  to: Store;
}

export interface BuildingDef {
  name: string;
  label: string;
  category: Category;
  footprint: [number, number];
  cost: Partial<Record<Resource, number>>;
  /** Peasants drawn from the idle pool to staff it. */
  workers: number;
  terrain: TerrainNeed;
  produces?: Production;
  /** Peasants this building houses. */
  housing?: number;
  /**
   * Damage it takes before it falls. Only siege engines deal it.
   *
   * Defaulted from the footprint by `buildingHp` when unset, so adding a
   * building does not silently create an indestructible one.
   */
  hp?: number;
  /** Marks storage buildings; production is delivered to the nearest one. */
  storeFor?: Store;
  /** Needs an ox tether nearby to move its output. */
  needsHauler?: boolean;
  /** Must stand within WATER_REACH tiles of water. See the fishery. */
  needsWater?: boolean;
  /**
   * Marks a relay: a local drop-off that forwards to the real store.
   * The number is how many goods it can hold at once, all kinds together.
   */
  relay?: number;
  /**
   * The tool stays in hand after placing one.
   *
   * Things you lay in RUNS -- yard squares, granary bays, curtain wall -- are
   * unusable otherwise: re-selecting between every tile of a twenty-tile wall
   * is not a decision, it is an obstacle.
   */
  paintable?: boolean;
  /**
   * Peasants walk over this instead of round it.
   *
   * The stockpile is a yard, not a shed. Left solid, a player painting a big
   * one builds an accidental wall through their own settlement -- and the
   * carriers whose whole job is to walk onto it would path around the edge.
   */
  walkable?: boolean;
  /** Animation its workers play while producing. */
  workClip?: 'chop' | 'mine' | 'dig';
  /**
   * This building keeps a stock of a good on the premises, fetched from the
   * stockpile by its own worker. Used by the inn: the ale has to physically
   * arrive before anyone can drink it.
   */
  stocks?: { resource: Resource; capacity: number; batch: number };
  description: string;
}

export const BUILDINGS: Record<string, BuildingDef> = {
  keep: {
    name: 'keep', label: 'Keep', category: 'castle',
    footprint: [3, 3], cost: {}, workers: 0, terrain: 'any', hp: 900,
    description: 'Your seat. Collects taxes and houses the first peasants.',
    housing: 8,
  },
  stockpile: {
    name: 'stockpile', label: 'Stockpile', category: 'castle',
    footprint: [1, 1], cost: {}, workers: 0, terrain: 'any',
    storeFor: 'stockpile',
    walkable: true, paintable: true,
    description: 'One square of yard. Add more squares to store more.',
  },
  granary: {
    name: 'granary', label: 'Granary', category: 'castle',
    footprint: [1, 1], cost: { wood: 2 }, workers: 0, terrain: 'any',
    storeFor: 'granary',
    walkable: true, paintable: true,
    description: 'One bay of granary. Add more bays to store more food.',
  },
  wall: {
    name: 'wall', label: 'Wall', category: 'castle',
    footprint: [1, 1], cost: { stone: 3 }, workers: 0, terrain: 'any',
    paintable: true, hp: 130,
    description: 'One tile of curtain wall. Blocks the way — leave a gatehouse.',
  },
  gatehouse: {
    name: 'gatehouse', label: 'Gatehouse', category: 'castle',
    footprint: [2, 2], cost: { stone: 15, wood: 5 }, workers: 0, terrain: 'any', hp: 340,
    // Walkable on purpose: it is the hole in your own wall.
    //
    // Note what the seal-off guard does and does not do here. It refuses a wall
    // that cuts a BUILDING off from the keep -- verified -- but it will happily
    // let you ring your whole settlement with no gate at all, because
    // everything inside stays connected to everything else. What breaks then is
    // the jobs that reach outside: woodcutters, the hunter, farms on land you
    // walled out. The gatehouse is how you avoid that, not how you satisfy the
    // guard.
    walkable: true,
    description: 'A way through your wall. Your people pass; the wall holds.',
  },
  pitch_ditch: {
    name: 'pitch_ditch', label: 'Pitch Ditch', category: 'castle',
    footprint: [1, 1], cost: { pitch: 4 }, workers: 0, terrain: 'any',
    // Walkable, and that is the trick: the enemy crosses it without a thought.
    walkable: true, paintable: true, hp: 40,
    description: 'A trench of tar. Lay a line of them, then light it (F).',
  },
  siege_camp: {
    name: 'siege_camp', label: 'Siege Camp', category: 'castle',
    footprint: [3, 3], cost: { wood: 40, stone: 10 }, workers: 0, terrain: 'any',
    description: 'Builds rams and catapults. The only way through stone.',
  },
  barracks: {
    name: 'barracks', label: 'Barracks', category: 'castle',
    footprint: [3, 3], cost: { wood: 30, stone: 20 }, workers: 0, terrain: 'any',
    description: 'Recruit soldiers here for gold.',
  },
  tower: {
    name: 'tower', label: 'Tower', category: 'castle',
    footprint: [2, 2], cost: { stone: 20 }, workers: 0, terrain: 'any', hp: 420,
    description: 'Stands above the curtain wall.',
  },
  hovel: {
    name: 'hovel', label: 'Hovel', category: 'town',
    footprint: [2, 2], cost: { wood: 6 }, workers: 0, terrain: 'any',
    housing: 8,
    description: 'Houses eight peasants.',
  },
  market: {
    name: 'market', label: 'Market', category: 'town',
    footprint: [3, 3], cost: { wood: 10 }, workers: 0, terrain: 'any',
    description: 'Buy and sell goods for gold.',
  },

  woodcutter: {
    name: 'woodcutter', label: "Woodcutter's Hut", category: 'industry',
    footprint: [2, 2], cost: { wood: 3 }, workers: 1, terrain: 'any',
    produces: { output: 'wood', amount: 2, seconds: 9, to: 'stockpile' },
    description: 'Fells trees for wood.',
    workClip: 'chop',
  },
  quarry: {
    name: 'quarry', label: 'Quarry', category: 'industry',
    footprint: [3, 3], cost: { wood: 20 }, workers: 3, terrain: 'rock',
    produces: { output: 'stone', amount: 1, seconds: 12, to: 'stockpile' },
    needsHauler: true,
    description: 'Cuts stone. Must be built on rock, and needs an ox tether to move it.',
    workClip: 'mine',
  },
  ox_tether: {
    name: 'ox_tether', label: 'Ox Tether', category: 'industry',
    footprint: [2, 2], cost: { wood: 12 }, workers: 1, terrain: 'any',
    description: 'Hauls stone from quarries to the stockpile.',
  },
  iron_mine: {
    name: 'iron_mine', label: 'Iron Mine', category: 'industry',
    footprint: [3, 3], cost: { wood: 20 }, workers: 2, terrain: 'rock',
    produces: { output: 'iron', amount: 1, seconds: 16, to: 'stockpile' },
    description: 'Digs iron ore. Must be built on rock.',
    workClip: 'mine',
  },
  pitch_rig: {
    name: 'pitch_rig', label: 'Pitch Rig', category: 'industry',
    footprint: [2, 2], cost: { wood: 20 }, workers: 1, terrain: 'marsh',
    produces: { output: 'pitch', amount: 1, seconds: 16, to: 'stockpile' },
    description: 'Draws tar from a pitch marsh. Only stands on boggy ground.',
    workClip: 'dig',
  },

  wheat_farm: {
    name: 'wheat_farm', label: 'Wheat Farm', category: 'farm',
    footprint: [3, 3], cost: { wood: 20 }, workers: 1, terrain: 'green',
    produces: { output: 'wheat', amount: 2, seconds: 13, to: 'stockpile' },
    description: 'Grows wheat. Needs green land.',
    workClip: 'dig',
  },
  apple_orchard: {
    name: 'apple_orchard', label: 'Apple Orchard', category: 'farm',
    footprint: [3, 3], cost: { wood: 15 }, workers: 1, terrain: 'green',
    produces: { output: 'apples', amount: 3, seconds: 13, to: 'granary' },
    description: 'Grows apples. Needs green land.',
    workClip: 'dig',
  },
  dairy_farm: {
    name: 'dairy_farm', label: 'Dairy Farm', category: 'farm',
    footprint: [3, 3], cost: { wood: 20 }, workers: 1, terrain: 'green',
    produces: { output: 'cheese', amount: 2, seconds: 15, to: 'granary' },
    description: 'Keeps cows for cheese. Needs green land.',
    workClip: 'dig',
  },
  pig_farm: {
    name: 'pig_farm', label: 'Pig Farm', category: 'farm',
    footprint: [3, 3], cost: { wood: 20 }, workers: 1, terrain: 'green',
    produces: { output: 'pigs', amount: 1, seconds: 18, to: 'stockpile' },
    workClip: 'dig',
    description: 'Raises pigs. Needs green land.',
  },
  slaughterhouse: {
    name: 'slaughterhouse', label: 'Slaughterhouse', category: 'food',
    footprint: [2, 2], cost: { wood: 20 }, workers: 1, terrain: 'any',
    produces: {
      output: 'meat', amount: 4, seconds: 12,
      inputs: { pigs: 1 }, to: 'granary',
    },
    workClip: 'chop',
    description: 'Butchers pigs into meat.',
  },

  hunter: {
    name: 'hunter', label: "Hunter's Hut", category: 'farm',
    footprint: [2, 2], cost: { wood: 20 }, workers: 1, terrain: 'any',
    produces: { output: 'meat', amount: 2, seconds: 16, to: 'granary' },
    workClip: 'chop',
    description: 'Hunts gazelle on the open land. Needs no green ground.',
  },
  depot: {
    name: 'depot', label: 'Storehouse', category: 'industry',
    footprint: [2, 2], cost: { wood: 15 }, workers: 1, terrain: 'any',
    relay: DEPOT_CAPACITY,
    description: 'A drop-off out at the workings. Producers unload here and go '
               + 'straight back to work; its carrier takes the load on.',
  },
  fishery: {
    name: 'fishery', label: "Fisherman's Hut", category: 'farm',
    footprint: [2, 2], cost: { wood: 20 }, workers: 1, terrain: 'any',
    needsWater: true,
    produces: { output: 'fish', amount: 2, seconds: 15, to: 'granary' },
    workClip: 'chop',
    description: 'Works the water for fish. Must be built on a shore.',
  },
  hops_farm: {
    name: 'hops_farm', label: 'Hops Farm', category: 'farm',
    footprint: [3, 3], cost: { wood: 20 }, workers: 1, terrain: 'green',
    produces: { output: 'hops', amount: 2, seconds: 14, to: 'stockpile' },
    workClip: 'dig',
    description: 'Grows hops for brewing. Needs green land.',
  },
  brewery: {
    name: 'brewery', label: 'Brewery', category: 'food',
    footprint: [3, 3], cost: { wood: 25 }, workers: 1, terrain: 'any',
    produces: {
      output: 'ale', amount: 2, seconds: 12,
      inputs: { hops: 2 }, to: 'stockpile',
    },
    workClip: 'dig',
    description: 'Brews hops into ale.',
  },
  inn: {
    name: 'inn', label: 'Inn', category: 'food',
    footprint: [3, 3], cost: { wood: 30 }, workers: 1, terrain: 'any',
    stocks: { resource: 'ale', capacity: 12, batch: 4 },
    description: 'Serves ale. Its drayman fetches barrels from the stockpile.',
  },

  mill: {
    name: 'mill', label: 'Mill', category: 'food',
    footprint: [3, 3], cost: { wood: 25 }, workers: 1, terrain: 'any',
    produces: {
      output: 'flour', amount: 2, seconds: 11,
      inputs: { wheat: 2 }, to: 'stockpile',
    },
    description: 'Grinds wheat into flour.',
    workClip: 'dig',
  },
  bakery: {
    name: 'bakery', label: 'Bakery', category: 'food',
    footprint: [2, 2], cost: { wood: 20 }, workers: 1, terrain: 'any',
    produces: {
      output: 'bread', amount: 4, seconds: 9,
      inputs: { flour: 2 }, to: 'granary',
    },
    description: 'Bakes flour into bread. Two loaves per sack.',
    workClip: 'dig',
  },
};

/** Buildings offered in the build menu, in the order they appear. */
export const BUILD_MENU: { category: Category; label: string; items: string[] }[] = [
  { category: 'castle', label: 'Castle', items: ['wall', 'gatehouse', 'tower', 'pitch_ditch', 'barracks', 'siege_camp'] },
  { category: 'castle', label: 'Stores', items: ['stockpile', 'granary'] },
  { category: 'town', label: 'Town', items: ['hovel', 'market'] },
  { category: 'industry', label: 'Industry',
    items: ['woodcutter', 'quarry', 'ox_tether', 'iron_mine', 'pitch_rig', 'depot'] },
  { category: 'farm', label: 'Farms',
    items: ['wheat_farm', 'apple_orchard', 'dairy_farm', 'pig_farm', 'hunter',
            'fishery', 'hops_farm'] },
  { category: 'food', label: 'Food & Ale',
    items: ['mill', 'bakery', 'slaughterhouse', 'brewery', 'inn'] },
];

/**
 * A standing order per good. Buy and sell are INDEPENDENT, as in Stronghold:
 * "buy below 30, sell above 100" leaves a band between the two where nothing
 * happens, which is what makes the feature set-and-forget.
 */
export interface TradeOrder {
  buyOn: boolean;
  buyLevel: number;
  sellOn: boolean;
  sellLevel: number;
}

/**
 * Units of ONE good a single stockpile square holds.
 *
 * Nine storable goods against nine starting squares is deliberate: a settlement
 * that opens every production chain runs out of yard and has to paint more,
 * which is the whole reason the stockpile is expandable.
 */
export const STOCKPILE_TILE_CAPACITY = 50;

/**
 * Units of ONE food a single granary bay holds.
 *
 * Smaller than a stockpile square because food is spent continuously rather
 * than hoarded: the bay count is a buffer measured in minutes of eating, and
 * a big number would make the granary a thing you build once and forget.
 */
export const GRANARY_TILE_CAPACITY = 40;

/** Fill levels a square is drawn at. Must match the rendered pile sprites. */
export const STOCKPILE_LEVELS = 3;

/**
 * Which sprites a store's squares draw.
 *
 * The two stores must not look alike -- the stockpile is a flat deck you pile
 * goods on, the granary a kerbed bay you look into.
 */
export const STORE_SPRITES: Record<Store, { empty: string; prefix: string }> = {
  stockpile: { empty: 'stockpile_deck', prefix: 'pile' },
  granary: { empty: 'granary_bin', prefix: 'bin' },
};

/** The two levels must not meet, or the orders churn and bleed the spread. */
export const TRADE_MIN_BAND = 5;

/** How often standing trade orders are settled, and how much moves each time. */
export const TRADE_INTERVAL = 2.0;
export const TRADE_BATCH = 4;

/** Market prices: [buyFromMarket, sellToMarket]. The spread is the market's cut. */
export const PRICES: Partial<Record<Resource, [number, number]>> = {
  wood:   [10, 6],
  stone:  [16, 10],
  iron:   [42, 28],
  pitch:  [38, 25],
  wheat:  [26, 16],
  flour:  [32, 20],
  hops:   [24, 15],
  ale:    [44, 28],
  pigs:   [30, 19],
  meat:   [28, 17],
  bread:  [18, 11],
  cheese: [26, 16],
  apples: [17, 10],
  fish:   [22, 13],
};

// --- population and popularity --------------------------------------------

export const RATION_LEVELS = ['none', 'half', 'normal', 'extra'] as const;
export type RationLevel = typeof RATION_LEVELS[number];

/** Food eaten per peasant per minute, and what it does to popularity. */
/**
 * Popularity numbers are RATES: points per minute, not target offsets.
 *
 * This is the whole difference between "fed and untaxed sits at 51 forever"
 * and Stronghold's "fed and untaxed climbs to 100". A modifier says which way
 * the town is drifting and how fast, and taxes are paid for by making some
 * other rate bigger rather than by hitting a number on a dial.
 */
export const RATIONS: Record<RationLevel, { rate: number; popularity: number; label: string }> = {
  none:   { rate: 0.0,  popularity: -40, label: 'No rations' },
  half:   { rate: 0.25, popularity: -12, label: 'Half rations' },
  normal: { rate: 0.5,  popularity: 2,   label: 'Normal rations' },
  extra:  { rate: 0.75, popularity: 10,  label: 'Extra rations' },
};

/** Tax settings: gold per peasant per minute, and popularity per minute. */
export const TAX_LEVELS = [
  { label: 'No taxes',   gold: 0.0,  popularity: 4 },
  { label: 'Low taxes',  gold: 0.30, popularity: -6 },
  { label: 'Fair taxes', gold: 0.60, popularity: -14 },
  { label: 'High taxes', gold: 1.00, popularity: -28 },
] as const;

// --- ale ------------------------------------------------------------------
// Ale is the other happiness lever, and the interesting one: unlike food it is
// optional, so it is a genuine choice about where the labour goes.

/** People one inn can serve. */
export const INN_CAPACITY = 20;
/**
 * Ale drunk per served person per minute.
 *
 * Tuned so ale is a real investment rather than a freebie. At 0.05 a single
 * brewery supplied 80 drinkers, which bought +10 popularity for a fraction of
 * what feeding those people costs. At 0.12 a fully-served town of 40 needs
 * roughly one hops farm and one brewery, which is a fair trade for the bonus.
 */
export const ALE_PER_PERSON_PER_MIN = 0.12;
/** Popularity at full coverage of the population. */
/** Points per minute at full coverage. */
export const ALE_POPULARITY_MAX = 10;

/**
 * Eating a variety of foods pleases people, as in the original.
 * Indexed by how many DIFFERENT foods are in the granary, so the array must
 * have an entry for every possible count -- adding meat made four possible.
 */
export const FOOD_VARIETY_BONUS = [0, 0, 3, 6, 9];

/**
 * What you can buy at the barracks.
 *
 * No weapons chain. Stronghold routes iron through a blacksmith and an armoury
 * before you get a swordsman; here you simply buy the man. The trade-off is
 * kept elsewhere and is still real: every recruit costs GOLD, costs a peasant
 * out of the idle pool, and goes on eating and occupying housing while
 * producing nothing. An army you cannot feed is still a mistake.
 *
 * Armoured troops cost iron directly. Without that, nothing in the game
 * consumes iron or pitch at all -- they are mined and then only ever sold --
 * and the iron mine has no reason to exist beyond trade.
 */
/**
 * How much punishment a building takes.
 *
 * Footprint-scaled by default: a hovel should not stand as long as a keep just
 * because nobody remembered to give it a number.
 */
/**
 * Height of a building's walkway, in tiles, for troops posted on it.
 *
 * Taken straight from the Blender models: a wall's body is 0.92 with the
 * merlons above it, a tower's deck sits at 1.55 + 0.10, a gatehouse's at
 * 1.30 + 0.11. Anything not listed here cannot be manned.
 */
export const GARRISON_HEIGHT: Record<string, number> = {
  wall: 0.92,
  tower: 1.65,
  gatehouse: 1.41,
};

/** Extra reach a man gains from standing on a wall. */
export const GARRISON_RANGE_BONUS = 2.5;

/**
 * Reach at which an attacker counts as ranged.
 *
 * Melee cannot touch a man on a wall -- that is the entire point of the wall --
 * so a target that is posted is invisible to anything swinging below this.
 */
export const RANGED_THRESHOLD = 3.0;

export function canGarrison(name: string): boolean {
  return GARRISON_HEIGHT[name] !== undefined;
}

/**
 * How fast a unit crosses a pitch marsh, as a fraction of its normal pace.
 *
 * Wheels fare far worse than boots: a catapult dragged into a bog is close to
 * stuck, which is the whole strategic point. A marsh across your approach means
 * siege has to go the long way round, or you take the ground you are given.
 */
/**
 * Burning pitch.
 *
 * Lethal but escapable: 14 a second kills a spearman in three and a swordsman
 * in seven, so a column caught in it dies unless it keeps moving -- which is
 * the decision the mechanic is there to create. It burns friend and foe alike;
 * fire does not check banners, and knowing that is what makes the timing hard.
 */
export const BURN_SECONDS = 12;
export const BURN_RADIUS = 1.6;
export const BURN_DPS = 14;
/** How close an enemy must be to a ditch before lighting it is worth doing. */
export const IGNITE_RADIUS = 1.3;

export const MARSH_SPEED_FOOT = 0.48;
export const MARSH_SPEED_SIEGE = 0.26;

export function buildingHp(def: BuildingDef): number {
  if (def.hp !== undefined) return def.hp;
  const [w, d] = def.footprint;
  return Math.round(70 * w * d);
}

export interface SoldierType {
  name: string;
  label: string;
  /** Gold per recruit. */
  gold: number;
  /** Goods per recruit, on top of the gold. */
  cost: Partial<Record<Resource, number>>;
  hp: number;
  /** Tiles per second. */
  speed: number;
  damage: number;
  /** Tiles. Melee sits just under 1 so it reads as contact. */
  range: number;
  /** Seconds between blows. */
  cooldown: number;
  /**
   * A machine that shoots people rather than walls.
   *
   * Split from `siege` rather than folded into it because the two properties
   * are genuinely separate: `siege` says "this is a wheeled engine" -- slow,
   * cannot man a wall, never advances on its own -- while this says what it
   * shoots at. A fire ballista is every bit as much an engine as a catapult
   * and wants none of the same targets.
   */
  targetsUnits?: boolean;
  /**
   * A machine, not a man.
   *
   * Siege engines ignore enemy soldiers entirely and only ever attack
   * buildings -- which is what makes them worth their price and worth
   * escorting, since they cannot defend themselves at all.
   */
  siege?: boolean;
  /** Which building must exist to buy this. */
  from: 'barracks' | 'siege_camp';
  description: string;
}

export const SOLDIER_TYPES: Record<string, SoldierType> = {
  spearman: {
    name: 'spearman', from: 'barracks', label: 'Spearman', gold: 20, cost: {},
    hp: 40, speed: 1.5, damage: 6, range: 0.9, cooldown: 1.2,
    description: 'Cheap and quick. Numbers, not quality.',
  },
  archer: {
    name: 'archer', from: 'barracks', label: 'Archer', gold: 40, cost: { wood: 2 },
    hp: 26, speed: 1.6, damage: 5, range: 6.5, cooldown: 1.6,
    description: 'Shoots at range. Helpless once reached.',
  },
  swordsman: {
    name: 'swordsman', from: 'barracks', label: 'Swordsman', gold: 80, cost: { iron: 4 },
    hp: 95, speed: 1.15, damage: 13, range: 0.9, cooldown: 1.5,
    description: 'Armoured and slow. Holds a gatehouse.',
  },
};

/**
 * Siege engines. Slow, defenceless, and the only thing that brings a wall down.
 *
 * Priced well above troops on purpose: a catapult is the answer to "how do I
 * ever beat the lord", and it should cost a real part of an economy rather than
 * being another unit in the queue.
 */
export const SIEGE_TYPES: Record<string, SoldierType> = {
  ram: {
    name: 'ram', from: 'siege_camp', label: 'Battering Ram', gold: 120,
    cost: { wood: 25 },
    hp: 170, speed: 0.55, damage: 22, range: 1.7, cooldown: 2.4, siege: true,
    description: 'Tough and short-ranged. Walk it up to a wall and it comes down.',
  },
  catapult: {
    name: 'catapult', from: 'siege_camp', label: 'Catapult', gold: 200,
    cost: { wood: 30, iron: 10 },
    hp: 85, speed: 0.45, damage: 30, range: 7.5, cooldown: 3.4, siege: true,
    description: 'Breaks stone from well out of reach. Fragile — keep men round it.',
  },
  fire_ballista: {
    name: 'fire_ballista', from: 'siege_camp', label: 'Fire Ballista', gold: 150,
    cost: { wood: 20, iron: 5 },
    // Longer reach than an archer and far harder hitting, but it cannot touch
    // stone and it cannot defend itself if anything closes.
    hp: 70, speed: 0.7, damage: 18, range: 9.0, cooldown: 2.2,
    siege: true, targetsUnits: true,
    description: 'Shoots burning bolts at men and machines, further than any '
               + 'archer. Useless against stone.',
  },
};

Object.assign(SOLDIER_TYPES, SIEGE_TYPES);

export const SOLDIER_ORDER =
  ['spearman', 'archer', 'swordsman', 'ram', 'catapult', 'fire_ballista'] as const;
