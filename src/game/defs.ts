/**
 * Resource and building definitions -- the economy's data model.
 *
 * Deliberately data-driven: adding a building should mean adding an entry here
 * plus a Blender model, not touching the simulation.
 */

export const RAW_RESOURCES =
  ['wood', 'stone', 'iron', 'pitch', 'wheat', 'flour', 'hops', 'ale', 'pigs',
   'hides'] as const;
export const FOOD_RESOURCES = ['bread', 'cheese', 'apples', 'meat', 'fish'] as const;
/**
 * What the weapons workshops turn raw goods into.
 *
 * A third class rather than more raw goods, because they answer to a third
 * store. Kit is what the barracks spends: a man is issued a weapon that already
 * cost the timber or the iron, which is why recruiting itself costs only gold.
 */
export const WEAPON_RESOURCES =
  ['bows', 'crossbows', 'spears', 'pikes', 'swords', 'maces', 'armour'] as const;

export type RawResource = typeof RAW_RESOURCES[number];
export type FoodResource = typeof FOOD_RESOURCES[number];
export type WeaponResource = typeof WEAPON_RESOURCES[number];
export type Resource = RawResource | FoodResource | WeaponResource;

export const ALL_RESOURCES: Resource[] =
  [...RAW_RESOURCES, ...FOOD_RESOURCES, ...WEAPON_RESOURCES];

/**
 * The resource ticker, left to right, and the ONLY thing that fills it.
 *
 * Hand-ordered rather than taken from ALL_RESOURCES: the bar reads as raw
 * goods, then food, then kit, which no declaration order gives for free. That
 * ordering is the whole reason it exists and also its one hazard -- a resource
 * left out of here is produced, stored, eaten and traded perfectly while being
 * invisible to the player. Fish shipped that way once. `unlistedResources`
 * below is the guard; it reports through the same startup banner as a stale
 * manifest, exactly as BUILD_MENU and SOLDIER_ORDER do.
 */
export const RESOURCE_BAR: Resource[] = [
  'wood', 'stone', 'iron', 'pitch', 'wheat', 'flour',
  'bread', 'cheese', 'apples', 'meat', 'fish', 'hops', 'ale', 'pigs', 'hides',
  // Kit in pairs, each workshop's two products side by side.
  'spears', 'pikes', 'bows', 'crossbows', 'swords', 'maces', 'armour',
];

/** Resources the game simulates that the ticker never shows. */
export function unlistedResources(): string[] {
  const shown = new Set<string>(RESOURCE_BAR);
  return ALL_RESOURCES.filter(r => !shown.has(r)).map(r => `unshown:${r}`);
}

export function isFood(r: Resource): r is FoodResource {
  return (FOOD_RESOURCES as readonly string[]).includes(r);
}

export function isWeapon(r: Resource): r is WeaponResource {
  return (WEAPON_RESOURCES as readonly string[]).includes(r);
}

export const RESOURCE_LABELS: Record<Resource, string> = {
  wood: 'Wood', stone: 'Stone', iron: 'Iron', pitch: 'Pitch',
  wheat: 'Wheat', flour: 'Flour', hops: 'Hops', ale: 'Ale', pigs: 'Pigs',
  bread: 'Bread', cheese: 'Cheese', apples: 'Apples', meat: 'Meat', fish: 'Fish',
  hides: 'Hides',
  bows: 'Bows', crossbows: 'Crossbows', spears: 'Spears', pikes: 'Pikes',
  swords: 'Swords', maces: 'Maces', armour: 'Armour',
};

/**
 * A good's name as it appears in a sentence, singular when there is one of it.
 *
 * "1 bows / 15s" had been sitting in the building tooltip since the fletcher
 * was written, and the recruit panel had its own private copy of this rule to
 * avoid "20g + 1 spears". One place, so the two cannot disagree and a new good
 * gets it for free.
 */
export function goodName(r: Resource, n: number): string {
  const label = RESOURCE_LABELS[r].toLowerCase();
  return n === 1 && label.endsWith('s') ? label.slice(0, -1) : label;
}

/** Where a produced good is delivered. */
export type Store = 'stockpile' | 'granary' | 'armoury';

/**
 * Which store a good belongs in. The ONE place that decides, so a worker, the
 * market and the capacity warning can never disagree about where a load goes.
 */
export function storeOf(r: Resource): Store {
  return isFood(r) ? 'granary' : isWeapon(r) ? 'armoury' : 'stockpile';
}

/** The store's name as it appears in a sentence: "The armoury is full". */
export const STORE_LABELS: Record<Store, string> = {
  stockpile: 'The stockpile', granary: 'The granary', armoury: 'The armoury',
};

export type Category = 'castle' | 'industry' | 'farm' | 'food' | 'town' | 'weapons';

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
  /**
   * A second good that falls out of the same cycle, delivered with the first.
   *
   * A butchered pig yields meat AND a hide, and they are one job, not two. The
   * worker carries one load to one store, so rather than give it a second trip
   * -- or a second carry slot the loop has no state for -- the byproduct is
   * credited when the main load is set down. It rides on the same cart. It is
   * still clamped to the room actually available, so a full stockpile stops
   * hides accruing exactly as it stops anything else.
   */
  byproduct?: { output: Resource; amount: number };
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
  /**
   * A second thing this workshop can make instead, at the player's word.
   *
   * A poleturner turns spears or pikes off the same lathe out of the same ash;
   * which one is a decision about the army being raised, not a decision about
   * where to put a building. Modelling it as a second workshop would mean a
   * second Blender model, a second build-menu slot and a second plot of ground
   * for what is one man changing what he is cutting.
   *
   * The choice lives on the PLACED building (`alt`), not here, for the same
   * reason a raised drawbridge does: two poleturners either side of a castle
   * are allowed to be making different things. `productionOf` is the only
   * thing that should ever read `produces` and `alternate` together.
   */
  alternate?: Production;
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
  /** People one of these reaches, for coverage levers like the church. */
  serves?: number;
  /**
   * Which coverage `serves` feeds. Both levers used to be a name match in
   * `state.ts` -- `b.name === 'church'` -- which is fine for exactly one
   * building and wrong the moment there is a second, because a chapel would
   * have been built, staffed, paid for and counted for nothing.
   */
  coverage?: 'religion' | 'health';
  /** Flat popularity-per-minute an aesthetic building adds (before the cap). */
  beauty?: number;
  /** A fear building: lowers popularity, raises tax yield. See the gallows. */
  fear?: { popularity: number; taxMultiplier: number };
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
  workClip?: 'chop' | 'mine' | 'dig' | 'fish';
  /**
   * This building keeps a stock of a good on the premises, fetched from the
   * stockpile by its own worker. Used by the inn: the ale has to physically
   * arrive before anyone can drink it.
   */
  stocks?: { resource: Resource; capacity: number; batch: number };
  description: string;
}

/**
 * The church, mirroring ale: a coverage lever, but with no consumable behind
 * it -- faith needs no barrels. One church reaches this many people; popularity
 * rises with the fraction of the town covered.
 */
export const CHURCH_SERVES = 24;
/**
 * The rest of the religion ladder.
 *
 * Coverage is `sum(serves) / population`, so it already thins as a town grows
 * -- a church that blanketed a hamlet covers a third of a city. That is the
 * whole population-scaling story and these tiers do not add a second one; they
 * only change how much ground one plot buys.
 *
 * Value per head improves as you go DOWN and value per tile improves as you go
 * UP: three churches serve 72 on twelve tiles for 60 wood and 90 stone, and a
 * cathedral serves the same 72 on nine tiles for less wood and much more
 * stone. Stone is the currency of grandeur here, and land is the thing a
 * cramped castle actually runs out of.
 */
export const SHRINE_SERVES = 8;
export const CHAPEL_SERVES = 16;
export const CATHEDRAL_SERVES = 72;
export const RELIGION_POPULARITY_MAX = 8;

/**
 * The pharmacy, a second wellbeing lever cut from the same cloth as the church:
 * it tends the body where the church tends the soul. One reaches this many
 * people, and popularity rises with the fraction of the town it covers. Pitched
 * a little below the church so faith stays the larger comfort, but the two stack
 * -- a town given both is a markedly happier one.
 */
export const PHARMACY_SERVES = 24;
export const HEALTH_POPULARITY_MAX = 6;

/**
 * Aesthetic "good" buildings, as in Crusader. Their bonus is CAPPED and it
 * erodes as the town grows -- `sum(beauty) - floor(population / BEAUTY_PER)`,
 * clamped to [0, BEAUTY_CAP] -- so gardens are not a one-off you place and
 * forget but something a big settlement must keep adding to.
 */
export const BEAUTY_CAP = 12;
export const BEAUTY_PER = 12;

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
  moat: {
    name: 'moat', label: 'Moat', category: 'castle',
    footprint: [1, 1], cost: { wood: 2 }, workers: 0, terrain: 'any', hp: 70,
    // NOT walkable, and that is the entire building: it blocks, and unlike a
    // wall nobody can stand on it. Paintable because a moat is a run, never a
    // single square.
    paintable: true,
    description: 'A wet ditch. Nothing crosses it and nobody mans it — the '
               + 'cheapest way to say "not here", and the reason to leave a '
               + 'drawbridge where you do want them.',
  },
  drawbridge: {
    name: 'drawbridge', label: 'Drawbridge', category: 'castle',
    footprint: [1, 1], cost: { wood: 12, iron: 2 }, workers: 0, terrain: 'any', hp: 90,
    // Walkable while it is down. Raising it marks its tile solid instead --
    // see toggleDrawbridges() -- which is the one building in the game whose
    // passability changes after it is placed.
    walkable: true,
    description: 'The gap you leave in your own moat. Raise and drop it with '
               + 'G: down it is a road, up it is a wall, and the enemy walks '
               + 'straight over it while you forget.',
  },
  killing_pit: {
    name: 'killing_pit', label: 'Killing Pit', category: 'castle',
    footprint: [1, 1], cost: { wood: 6 }, workers: 0, terrain: 'any', hp: 30,
    // Walkable, and that is the trick, exactly as with the pitch ditch: it has
    // to be crossed to work, so it must not block the path that leads over it.
    walkable: true, paintable: true,
    description: 'Stakes under a thin lid. The first man onto it goes in and '
               + 'takes whoever is beside him — once. Then it is a hole.',
  },
  water_pot: {
    name: 'water_pot', label: 'Water Pot', category: 'castle',
    footprint: [1, 1], cost: { wood: 4, stone: 4 }, workers: 0, terrain: 'any', hp: 30,
    walkable: true, paintable: true,
    description: 'A butt of water against fire. It douses everything burning '
               + 'near it and is emptied doing so — the answer to a fire '
               + 'ballista, and to your own pitch when the wind turns.',
  },
  stairs: {
    name: 'stairs', label: 'Wall Stairs', category: 'castle',
    footprint: [1, 1], cost: { wood: 8 }, workers: 0, terrain: 'any', hp: 60,
    walkable: true,
    description: 'Timber steps against a curtain. Nobody stands on them, but '
               + 'the wall beside them can be manned without spending a tower '
               + 'to anchor it.',
  },
  engineers_guild: {
    name: 'engineers_guild', label: "Engineers' Guild", category: 'castle',
    footprint: [2, 2], cost: { wood: 25, stone: 15 }, workers: 0, terrain: 'any',
    description: 'Recruits engineers, who mend walls rather than man them.',
  },
  tunnelers_guild: {
    name: 'tunnelers_guild', label: "Tunnellers' Guild", category: 'castle',
    footprint: [2, 2], cost: { wood: 30, stone: 10 }, workers: 0, terrain: 'any',
    description: 'Recruits tunnellers, who go under a wall instead of over it.',
  },
  mercenary_post: {
    name: 'mercenary_post', label: 'Mercenary Post', category: 'castle',
    footprint: [2, 2], cost: { wood: 25, stone: 10 }, workers: 0, terrain: 'any',
    description: 'Hires fighting men from across the sand. They come armed, so '
               + 'gold is the whole price — no workshop, no armoury, no rack. '
               + 'Dearer than the barracks for the same man, and available the '
               + 'moment you can pay.',
  },
  siege_camp: {
    name: 'siege_camp', label: 'Siege Camp', category: 'castle',
    footprint: [3, 3], cost: { wood: 40, stone: 10 }, workers: 0, terrain: 'any',
    description: 'Builds rams, catapults and trebuchets. The only way through stone.',
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
  perimeter_turret: {
    name: 'perimeter_turret', label: 'Perimeter Turret', category: 'castle',
    footprint: [1, 1], cost: { stone: 14 }, workers: 0, terrain: 'any', hp: 150,
    description: 'A one-tile watch post with a stair of its own, so it can be '
               + 'manned standing alone on ground you only want watched. It '
               + 'anchors a wall like a tower does — but barely rises above '
               + 'one, and falls to a third of the punishment.',
  },
  round_tower: {
    name: 'round_tower', label: 'Round Tower', category: 'castle',
    footprint: [3, 3], cost: { stone: 55 }, workers: 0, terrain: 'any', hp: 900,
    description: 'A stone drum. Twice a square tower\'s punishment before it '
               + 'falls, because there is no corner for a stone to break off.',
  },
  lookout_tower: {
    name: 'lookout_tower', label: 'Lookout Tower', category: 'castle',
    footprint: [2, 2], cost: { wood: 20, stone: 25 }, workers: 0, terrain: 'any', hp: 260,
    description: 'Tall and thin, and lightly built with it. Archers on top '
               + 'shoot further than from anything else you can raise.',
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
  shrine: {
    name: 'shrine', label: 'Wayside Shrine', category: 'town',
    footprint: [1, 1], cost: { stone: 6, wood: 6 }, workers: 0, terrain: 'any',
    serves: SHRINE_SERVES, coverage: 'religion',
    description: 'A niche and a lamp at the roadside. Reaches few, costs '
               + 'almost nothing, and fits where nothing else will.',
  },
  chapel: {
    name: 'chapel', label: 'Chapel', category: 'town',
    footprint: [2, 2], cost: { wood: 12, stone: 18 }, workers: 0, terrain: 'any',
    serves: CHAPEL_SERVES, coverage: 'religion',
    description: 'A single vaulted hall under a bellcote. Two thirds of a '
               + 'church for two thirds of the price.',
  },
  cathedral: {
    name: 'cathedral', label: 'Cathedral', category: 'town',
    footprint: [3, 3], cost: { wood: 50, stone: 140 }, workers: 2, terrain: 'any',
    serves: CATHEDRAL_SERVES, coverage: 'religion', beauty: 5,
    description: 'A great dome between two towers. Reaches three churches\' '
               + 'worth of souls on less ground — and is the only building '
               + 'that is both a mercy and an ornament.',
  },
  church: {
    name: 'church', label: 'Church', category: 'town',
    footprint: [2, 2], cost: { wood: 20, stone: 30 }, workers: 0, terrain: 'any',
    serves: CHURCH_SERVES, coverage: 'religion',
    description: 'Tends the town\'s soul. Popularity rises with how much of '
               + 'your people it reaches.',
  },
  pharmacy: {
    name: 'pharmacy', label: 'Pharmacy', category: 'town',
    footprint: [2, 2], cost: { wood: 20, stone: 15 }, workers: 0, terrain: 'any',
    serves: PHARMACY_SERVES, coverage: 'health',
    description: 'Tends the town\'s health. Popularity rises with how much of '
               + 'your people it reaches — and it stacks with the church.',
  },
  garden: {
    name: 'garden', label: 'Garden', category: 'town',
    footprint: [2, 2], cost: { wood: 8 }, workers: 0, terrain: 'green',
    beauty: 4,
    description: 'A pleasant thing to look at. Raises popularity — but a '
               + 'growing town needs more of them to stay charmed.',
  },
  // --- the carrot ---------------------------------------------------------
  //
  // `beauty` is summed across every one of these and then eroded by
  // floor(population / BEAUTY_PER), so they are not a one-off purchase: a town
  // that doubles needs more of them to stay as charmed as it was. The ladder
  // below runs cheap-and-plain to dear-and-showy.
  well: {
    name: 'well', label: 'Well', category: 'town',
    footprint: [2, 2], cost: { wood: 6, stone: 10 }, workers: 0, terrain: 'any',
    beauty: 2,
    description: 'Clean water within reach of the hovels. A small kindness, '
               + 'and the cheapest one you can buy.',
  },
  pond: {
    name: 'pond', label: 'Ornamental Pond', category: 'town',
    footprint: [2, 2], cost: { wood: 6, stone: 14 }, workers: 0, terrain: 'green',
    beauty: 5,
    description: 'A dug pool with reeds and ducks. Needs green ground — a '
               + 'pond in the sand fools nobody.',
  },
  statue: {
    name: 'statue', label: 'Statue', category: 'town',
    footprint: [2, 2], cost: { stone: 30 }, workers: 0, terrain: 'any',
    beauty: 6,
    description: 'Yourself, in stone, twice life size. Stone only, and it '
               + 'shows: nothing else you build says permanence so plainly.',
  },
  maypole: {
    name: 'maypole', label: 'Maypole', category: 'town',
    footprint: [2, 2], cost: { wood: 20 }, workers: 0, terrain: 'green',
    beauty: 7,
    description: 'Ribbons on a pole on the green. Cheap in materials and '
               + 'loved out of all proportion to what it cost.',
  },
  dancing_bear: {
    name: 'dancing_bear', label: 'Dancing Bear', category: 'town',
    footprint: [2, 2], cost: { wood: 24, iron: 4 }, workers: 1, terrain: 'any',
    beauty: 9,
    description: 'A keeper, a chain and a bear on its hind legs. The finest '
               + 'entertainment in the fief, and the only one that eats.',
  },

  // --- the stick ----------------------------------------------------------
  //
  // Only the STRONGEST fear building applies -- see `fearEffect`, which picks
  // by taxMultiplier and ignores the rest -- so these are a ladder to climb,
  // not a set to collect. Building a gibbet beside your stocks buys you the
  // gibbet's terms and wastes the stocks. Each rung trades more popularity for
  // more tax than the one below it.
  stocks: {
    name: 'stocks', label: 'Stocks', category: 'town',
    footprint: [2, 2], cost: { wood: 8 }, workers: 0, terrain: 'any',
    fear: { popularity: -4, taxMultiplier: 1.3 },
    description: 'A day in the pillory and a face full of turnips. The '
               + 'gentlest rung: a little resented, a little more tax.',
  },
  dunking_stool: {
    name: 'dunking_stool', label: 'Dunking Stool', category: 'town',
    footprint: [2, 2], cost: { wood: 14, stone: 8 }, workers: 0, terrain: 'any',
    fear: { popularity: -6, taxMultiplier: 1.45 },
    description: 'A beam, a chair and a cold pond. Humiliation rather than '
               + 'injury, and the town pays a little better for watching.',
  },
  stretching_rack: {
    name: 'stretching_rack', label: 'Stretching Rack', category: 'town',
    footprint: [2, 2], cost: { wood: 20, iron: 6 }, workers: 0, terrain: 'any',
    fear: { popularity: -10, taxMultiplier: 1.75 },
    description: 'Rollers, rope and a ratchet. Past this rung nobody pretends '
               + 'it is about shame any more.',
  },
  gibbet: {
    name: 'gibbet', label: 'Gibbet', category: 'town',
    footprint: [2, 2], cost: { wood: 16, iron: 10 }, workers: 0, terrain: 'any',
    fear: { popularity: -12, taxMultiplier: 1.9 },
    description: 'An iron cage on an arm, and whoever was in it left there. '
               + 'A warning that keeps working long after the man stopped.',
  },
  dog_cage: {
    name: 'dog_cage', label: 'Dog Cage', category: 'town',
    footprint: [2, 2], cost: { wood: 22, iron: 12 }, workers: 1, terrain: 'any',
    fear: { popularity: -14, taxMultiplier: 2.05 },
    description: 'A barred pen of half-starved hounds by the road. Everyone '
               + 'who passes it walks a little faster and pays a little more.',
  },
  burning_stake: {
    name: 'burning_stake', label: 'Burning Stake', category: 'town',
    footprint: [2, 2], cost: { wood: 26, iron: 6 }, workers: 0, terrain: 'any',
    fear: { popularity: -16, taxMultiplier: 2.2 },
    description: 'A charred post in a ring of ash and faggots. Nobody needs '
               + 'telling what it is for.',
  },
  dungeon: {
    name: 'dungeon', label: 'Dungeon', category: 'town',
    footprint: [3, 3], cost: { wood: 20, stone: 60, iron: 15 }, workers: 2, terrain: 'any',
    fear: { popularity: -18, taxMultiplier: 2.4 },
    description: 'A sunken blockhouse with a grated pit. The last rung, the '
               + 'largest, and the only one that needs gaolers to run it.',
  },

  gallows: {
    name: 'gallows', label: 'Gallows', category: 'town',
    footprint: [2, 2], cost: { wood: 12 }, workers: 0, terrain: 'any',
    fear: { popularity: -8, taxMultiplier: 1.6 },
    description: 'Rule by fear. Popularity falls, but frightened people pay '
               + 'their taxes — gold from tax rises sharply.',
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
      byproduct: { output: 'hides', amount: 2 },
    },
    workClip: 'chop',
    description: 'Butchers pigs into meat, and the hides come off with it — '
               + 'they pile up in the stockpile whether you have a tanner or not.',
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
    workClip: 'fish',
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

  // --- the weapons chain: four workshops feeding one store ---------------
  armoury: {
    name: 'armoury', label: 'Armoury', category: 'weapons',
    footprint: [3, 3], cost: { wood: 25, stone: 15 }, workers: 0, terrain: 'any',
    storeFor: 'armoury',
    // A shed, not a yard. The stockpile and the granary are painted square by
    // square because their contents are BULK -- you buy more room by the tile.
    // Kit is not bulk: an armoury either exists or it does not, and gating the
    // whole military on one building the player must decide to put up is the
    // point. Each one holds ARMOURY_CAPACITY weapons of all kinds together.
    description: 'Stores finished weapons and armour. The barracks arms its '
               + 'recruits from here — without one, nothing you make is kept.',
  },
  poleturner: {
    name: 'poleturner', label: "Poleturner's Workshop", category: 'weapons',
    footprint: [2, 2], cost: { wood: 15 }, workers: 1, terrain: 'any',
    produces: {
      output: 'spears', amount: 2, seconds: 13,
      inputs: { wood: 2 }, to: 'armoury',
    },
    alternate: {
      output: 'pikes', amount: 1, seconds: 16,
      inputs: { wood: 3 }, to: 'armoury',
    },
    workClip: 'chop',
    description: 'Turns timber into spears, or into pikes for a heavier man. '
               + 'One lathe, one choice — say which and he cuts it.',
  },
  fletcher: {
    name: 'fletcher', label: "Fletcher's Workshop", category: 'weapons',
    footprint: [2, 2], cost: { wood: 20 }, workers: 1, terrain: 'any',
    produces: {
      output: 'bows', amount: 1, seconds: 15,
      inputs: { wood: 2 }, to: 'armoury',
    },
    alternate: {
      output: 'crossbows', amount: 1, seconds: 22,
      inputs: { wood: 3, iron: 1 }, to: 'armoury',
    },
    workClip: 'chop',
    description: 'Makes bows from timber. No bow, no archer — and given a '
               + 'little iron for the lock, crossbows instead.',
  },
  blacksmith: {
    name: 'blacksmith', label: "Blacksmith's Workshop", category: 'weapons',
    footprint: [2, 2], cost: { wood: 20, stone: 10 }, workers: 1, terrain: 'any',
    produces: {
      output: 'swords', amount: 1, seconds: 19,
      inputs: { iron: 2 }, to: 'armoury',
    },
    alternate: {
      output: 'maces', amount: 1, seconds: 15,
      inputs: { iron: 2 }, to: 'armoury',
    },
    workClip: 'mine',
    description: 'Beats iron into swords. Slow, and hungry for ore. A mace is '
               + 'quicker off the same anvil and the same ore — a blunt thing '
               + 'needs no edge putting on it.',
  },
  tanner: {
    name: 'tanner', label: "Tanner's Workshop", category: 'weapons',
    footprint: [2, 2], cost: { wood: 18, stone: 6 }, workers: 1, terrain: 'any',
    produces: {
      output: 'armour', amount: 1, seconds: 17,
      inputs: { hides: 3 }, to: 'armoury',
    },
    workClip: 'dig',
    description: 'Cures hides into leather armour. The same rack a swordsman '
               + 'takes his mail from, filled off the back of your pig farms '
               + 'instead of your iron mines.',
  },
  armourer: {
    name: 'armourer', label: "Armourer's Workshop", category: 'weapons',
    footprint: [2, 2], cost: { wood: 20, stone: 10 }, workers: 1, terrain: 'any',
    produces: {
      output: 'armour', amount: 1, seconds: 21,
      inputs: { iron: 2 }, to: 'armoury',
    },
    workClip: 'mine',
    description: 'Forges mail. A swordsman needs a suit as well as a blade.',
  },
};

/** Buildings offered in the build menu, in the order they appear. */
/**
 * The build bar, group by group, and the ONLY way a building becomes placeable.
 *
 * A building defined but left out of here is fully real -- costed, rendered,
 * simulated -- and cannot be built, with nothing anywhere to say so. Twenty-one
 * of them accumulated exactly that way before anyone noticed. `unlistedBuildings`
 * below is the guard; keep it passing.
 */
export const BUILD_MENU: { category: Category; label: string; items: string[] }[] = [
  { category: 'castle', label: 'Castle',
    items: ['wall', 'gatehouse', 'tower', 'round_tower', 'perimeter_turret',
            'lookout_tower', 'stairs', 'moat', 'drawbridge', 'pitch_ditch',
            'killing_pit', 'water_pot', 'barracks', 'mercenary_post',
            'engineers_guild', 'tunnelers_guild', 'siege_camp'] },
  { category: 'castle', label: 'Stores', items: ['stockpile', 'granary'] },
  { category: 'town', label: 'Town',
    items: ['hovel', 'market', 'garden', 'well', 'pond', 'statue', 'maypole',
            'dancing_bear'] },
  { category: 'town', label: 'Faith',
    items: ['shrine', 'chapel', 'church', 'cathedral', 'pharmacy'] },
  { category: 'town', label: 'Fear',
    items: ['stocks', 'dunking_stool', 'gallows', 'stretching_rack', 'gibbet',
            'dog_cage', 'burning_stake', 'dungeon'] },
  { category: 'industry', label: 'Industry',
    items: ['woodcutter', 'quarry', 'ox_tether', 'iron_mine', 'pitch_rig', 'depot'] },
  { category: 'farm', label: 'Farms',
    items: ['wheat_farm', 'apple_orchard', 'dairy_farm', 'pig_farm', 'hunter',
            'fishery', 'hops_farm'] },
  { category: 'food', label: 'Food & Ale',
    items: ['mill', 'bakery', 'slaughterhouse', 'brewery', 'inn'] },
  { category: 'weapons', label: 'Weapons',
    items: ['armoury', 'poleturner', 'fletcher', 'blacksmith', 'armourer', 'tanner'] },
];

/**
 * Buildings that exist but no menu offers.
 *
 * `keep` is deliberate -- you start with one and never place another. Anything
 * else in this list is a building the player has paid for in code and cannot
 * reach, which is the failure this exists to make loud.
 */
export function unlistedBuildings(): string[] {
  const listed = new Set(BUILD_MENU.flatMap(g => g.items));
  const deliberate = new Set(['keep']);
  return Object.keys(BUILDINGS)
    .filter(n => !listed.has(n) && !deliberate.has(n))
    .map(n => `unbuildable:${n}`);
}

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

/**
 * Weapons ONE armoury holds, all kinds together.
 *
 * A shed, not a yard: unlike the stockpile and the granary the armoury is a
 * whole building rather than a painted square, so its capacity is pooled the
 * way the storehouse's is. Kit is spent in ones and twos at the barracks and
 * made in ones and twos at the workshops, so forty is several minutes of
 * recruiting -- enough that one armoury serves a modest war, not so much that
 * the second is never worth building.
 */
export const ARMOURY_CAPACITY = 40;

/** Fill levels a square is drawn at. Must match the rendered pile sprites. */
export const STOCKPILE_LEVELS = 3;

/**
 * Which sprites a store's squares draw.
 *
 * The two painted stores must not look alike -- the stockpile is a flat deck
 * you pile goods on, the granary a kerbed bay you look into.
 *
 * PARTIAL, and that is what tells the two kinds of store apart. A store with
 * an entry here is painted a square at a time and draws its contents; one
 * without -- the armoury -- is an ordinary building that draws its own sprite
 * and pools its capacity. Everything that lays out piles keys off this map, so
 * adding a shed-style store needs no second flag to remember to set.
 */
export const STORE_SPRITES: Partial<Record<Store, { empty: string; prefix: string }>> = {
  stockpile: { empty: 'stockpile_deck', prefix: 'pile' },
  granary: { empty: 'granary_bin', prefix: 'bin' },
};

/**
 * Buildings drawn with somebody else's sprite, and why each one is.
 *
 * Two different needs, served by one map because the drawing code only ever
 * asks the same question -- "what art does this building use?".
 *
 * PERMANENT: the stockpile and the granary have no building model at all. They
 * are yards painted a square at a time, so their menu icon and their placement
 * ghost borrow the empty square they lay down.
 *
 * TEMPORARY: a building whose Blender model exists but has not been RENDERED
 * yet draws nothing -- `push` skips any sprite with no frame, so it is invisible
 * on the map and unclickable in the menu, which reads as a broken feature
 * rather than as a missing PNG. Standing in with a same-footprint neighbour
 * keeps it playable meanwhile, and `missingSprites` still names it in the stale-
 * asset banner so nobody mistakes the stand-in for the finished art. Run
 * `blender -b -P tools/render/render_buildings.py -- --only <name>` and the
 * entry becomes dead weight to delete.
 */
export const SPRITE_STANDIN: Record<string, string> = {
  stockpile: 'stockpile_deck',
  granary: 'granary_bin',
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
  hides:  [20, 12],
  meat:   [28, 17],
  bread:  [18, 11],
  cheese: [26, 16],
  apples: [17, 10],
  fish:   [22, 13],
  // Kit trades dear. Buying a sword outright costs well over the iron in it,
  // so the market is the expensive way to arm a garrison in a hurry rather
  // than a way to skip the workshops altogether.
  bows:      [72, 46],
  crossbows: [104, 67],
  spears:    [44, 28],
  pikes:     [62, 40],
  swords:    [115, 74],
  maces:     [98, 63],
  armour:    [130, 84],
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

/**
 * Game speed. The multiplier scales the simulation's dt and nothing else.
 *
 * Distinct from the Esc menu, which stops the world dead while it is open.
 * This is a speed you play at: at Pause the camera, the build ghost and every
 * tooltip still work, so a paused settlement is one you can read and plan in.
 */
export const SPEED_LEVELS = [
  { label: 'Pause',  mult: 0 },
  { label: 'Slow',   mult: 0.5 },
  { label: 'Normal', mult: 1 },
  { label: 'Fast',   mult: 3 },
] as const;

/** Index of Normal -- where a new game starts, and what Pause returns to. */
export const NORMAL_SPEED = 2;

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
// Indexed by how many KINDS of food the granary is issuing, so it needs one
// slot per food type plus the empty case. FOOD_RESOURCES has grown to five --
// bread, cheese, apples, meat and fish -- and this stopped at four, so the
// fifth kind was earning nothing and a fishery could never pay for itself in
// popularity. Same +3 a kind the rest of the ladder uses.
export const FOOD_VARIETY_BONUS = [0, 0, 3, 6, 9, 12];

/**
 * What you can buy at the barracks.
 *
 * Gold buys the MAN; the armoury arms him. Recruiting costs no timber and no
 * iron any more, because the timber and the iron were already spent by the
 * workshop that made the weapon sitting in the armoury -- charging for both
 * would be charging twice for the same spear. So a recruit costs gold, a
 * peasant out of the idle pool, and one item of kit off the rack, and an army
 * is now limited by how fast your workshops turn out gear rather than by how
 * fast the treasury fills.
 *
 * That also finally gives iron a job. It used to be mined and then only ever
 * sold; it is now the whole supply line behind swordsmen.
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
 *
 * The three below are read off tools/render/buildings.py the same way, and the
 * number is the top of the surface a man actually stands on, not the top of
 * the merlons or the rail above it: the turret's corbel at 1.06 + 0.08, the
 * round tower's flagged deck at 1.84 + 0.08, the lookout's nest floor at
 * 2.20 + 0.10. Change a model and change these.
 */
export const GARRISON_HEIGHT: Record<string, number> = {
  wall: 0.92,
  tower: 1.65,
  gatehouse: 1.41,
  perimeter_turret: 1.14,
  round_tower: 1.92,
  lookout_tower: 2.30,
};

/** Extra reach a man gains from standing on a wall. */
export const GARRISON_RANGE_BONUS = 2.5;

/**
 * Further reach per tile of deck ABOVE a plain tower's.
 *
 * A flat bonus made every posting identical, which is fine while a wall, a
 * tower and a gatehouse are the only things to stand on -- and makes a lookout
 * tower pointless the moment one exists, since its entire reason to be built
 * is that it is tall. Measured from the tower rather than from the ground so
 * that walls and gatehouses, which sit below it, keep exactly the bonus they
 * have always had. Nothing existing moves; only things taller than a tower
 * gain.
 */
export const GARRISON_RANGE_PER_TILE = 2.0;

/** What a man posted on `name` adds to his reach. 0 if it cannot be manned. */
export function garrisonReach(name: string): number {
  const h = GARRISON_HEIGHT[name];
  if (h === undefined) return 0;
  return GARRISON_RANGE_BONUS
    + Math.max(0, h - GARRISON_HEIGHT.tower) * GARRISON_RANGE_PER_TILE;
}

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

/**
 * What an engineer mends and what a tunneller undermines, per second.
 *
 * Both are deliberately slow. A wall that comes back as fast as a catapult
 * knocks it down makes siege pointless, and a tunneller who drops a gatehouse
 * in ten seconds makes walls pointless. They are attritional: bring several,
 * or bring time.
 */
export const REPAIR_RADIUS = 2.2;
export const REPAIR_PER_SECOND = 7;
export const UNDERMINE_RADIUS = 1.8;
export const UNDERMINE_PER_SECOND = 5;

/**
 * The two sprung defences: a pit that opens under a man, and a pot that puts a
 * fire out. Both are ONE-SHOT and consumed, like a pitch ditch, because a
 * permanent free trap is not a decision -- you would lay one and forget it.
 * A line of them is a line you have to keep paying for.
 */
export const PIT_TRIGGER_RADIUS = 0.7;
export const PIT_DAMAGE = 70;
/** Radius the pit hurts, wider than it triggers, so a tight column suffers. */
export const PIT_BLAST_RADIUS = 1.1;
export const WATER_POT_RADIUS = 3.2;

/**
 * How near a ladderman a man must be to climb what he is standing under.
 *
 * A tile and a half, which is "at the foot of the same wall he is" and not
 * "somewhere in this fight". The ladder is a real object in the fiction and it
 * leans against one stretch of wall, not a district.
 */
export const LADDER_RADIUS = 2.6;

/**
 * How far a climbing man can strike a posted one.
 *
 * Not the same as his own reach, and it has to be stated separately. A wall is
 * SOLID, so an attacker cannot stand on it -- he stands on the tile beside it,
 * a full tile from where the defender is standing, which is already further
 * than a sword's 0.9 will go. Left at his ordinary reach an assassin could
 * scale anything and then never quite touch anybody, which is the sort of bug
 * that reads as the feature simply not working.
 *
 * It applies ONLY against a garrisoned target, so climbing does not quietly
 * lengthen a man's arm in an ordinary fight on open ground.
 */
export const ESCALADE_REACH = 1.6;

export const MARSH_SPEED_FOOT = 0.48;
export const MARSH_SPEED_SIEGE = 0.26;

/**
 * What a workshop is actually making right now.
 *
 * The ONE place that resolves `produces` against `alternate`, so a worker, the
 * building panel and the rival lord's economy can never disagree about what is
 * coming off the bench. Anything reading `def.produces` directly to decide what
 * a building outputs is a bug waiting for the first player to flip a switch.
 */
export function productionOf(
  def: BuildingDef, alt?: boolean,
): Production | undefined {
  return alt && def.alternate ? def.alternate : def.produces;
}

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
  /**
   * A wall is not in his way.
   *
   * Everything else swinging from the ground cannot touch a man posted above
   * it -- that is what a wall is FOR -- and only reach past RANGED_THRESHOLD
   * gets round it. A climber goes up instead. One flag rather than a special
   * case per unit, because the ladderman grants exactly the same thing to
   * everyone standing near him.
   */
  climbs?: boolean;
  /** He carries a ladder: everyone near him climbs. See LADDER_RADIUS. */
  ladders?: boolean;
  /** Which building must exist to buy this. */
  /**
   * The building that recruits him, by name.
   *
   * Was a union of the only two that existed. A union means every new
   * recruiting building is a change to this type AND to every place that
   * switched on it -- and the places that switched on it were writing the
   * "you need a barracks" message by hand, so a guild would have told the
   * player to build a barracks. It is the building's name now, and the
   * message comes from the building's own label.
   */
  from: string;
  description: string;
}

export const SOLDIER_TYPES: Record<string, SoldierType> = {
  spearman: {
    name: 'spearman', from: 'barracks', label: 'Spearman', gold: 20,
    cost: { spears: 1 },
    hp: 40, speed: 1.5, damage: 6, range: 0.9, cooldown: 1.2,
    description: 'Cheap and quick. Numbers, not quality. Needs a spear.',
  },
  archer: {
    name: 'archer', from: 'barracks', label: 'Archer', gold: 40,
    cost: { bows: 1 },
    hp: 26, speed: 1.6, damage: 5, range: 6.5, cooldown: 1.6,
    description: 'Shoots at range. Helpless once reached. Needs a bow.',
  },
  engineer: {
    name: 'engineer', from: 'engineers_guild', label: 'Engineer', gold: 40,
    cost: { wood: 2 },
    // No reach and no bite on purpose: he is a workman with a hammer, and a
    // unit that both mends and fights would simply replace the swordsman.
    hp: 45, speed: 1.2, damage: 0, range: 0.9, cooldown: 1.5,
    description: 'Mends what the enemy knocks down. Stand him by a damaged '
               + 'building and it comes back up. He will not fight.',
  },
  tunneler: {
    // "Tunneller", to match the Tunnellers' Guild that trains him. The KEY
    // stays `tunneler`: it names his sprite clips and his atlas frames.
    name: 'tunneler', from: 'tunnelers_guild', label: 'Tunneller', gold: 50,
    cost: { wood: 2 },
    hp: 40, speed: 1.15, damage: 0, range: 0.9, cooldown: 1.5,
    description: 'Digs under whatever he is standing beside. Slower than a '
               + 'catapult and silent — and no wall is thick enough to stop '
               + 'him from below. He will not fight either.',
  },
  swordsman: {
    name: 'swordsman', from: 'barracks', label: 'Swordsman', gold: 80,
    // The one recruit that wants two workshops behind it, which is exactly
    // what makes him the late unit rather than merely the dear one.
    cost: { swords: 1, armour: 1 },
    hp: 95, speed: 1.15, damage: 13, range: 0.9, cooldown: 1.5,
    description: 'Armoured and slow. Holds a gatehouse. Needs a sword and mail.',
  },
  /*
   * The three that make the weapons chain a choice rather than a queue.
   *
   * Each one is the same workshop cutting something else, so a player who
   * wants them gives up the thing that workshop was making -- pikes instead of
   * spears off the one lathe, maces instead of swords off the one anvil. That
   * is the whole design: a bigger roster that costs decisions rather than
   * merely costing more.
   *
   * They are spread deliberately along the three axes a foot soldier has:
   * the pikeman takes punishment and reaches further than anything else on
   * foot, the maceman deals it and takes little, the crossbowman out-ranges an
   * archer and hits nearly three times as hard, once every three seconds.
   */
  pikeman: {
    name: 'pikeman', from: 'barracks', label: 'Pikeman', gold: 55,
    cost: { pikes: 1, armour: 1 },
    // The longest melee reach in the game, and the only one above 1.0. A pike
    // is a fourteen-foot weapon; a man holding one strikes a tile before
    // anything holding a sword can answer, which is the entire reason to have
    // him in the front rank rather than a swordsman.
    hp: 125, speed: 0.95, damage: 9, range: 1.5, cooldown: 1.8,
    description: 'The front rank. Slow, heavily armoured, and he strikes a '
               + 'full tile before a swordsman can reach him. Needs a pike '
               + 'and armour.',
  },
  maceman: {
    name: 'maceman', from: 'barracks', label: 'Maceman', gold: 70,
    cost: { maces: 1, armour: 1 },
    // Twelve damage a second against the swordsman's nine, on two thirds of
    // his health. He wins the fight he starts and loses the one he is caught
    // in, which is what makes him an attacking unit rather than a better one.
    hp: 78, speed: 1.4, damage: 16, range: 0.9, cooldown: 1.3,
    description: 'Hits harder and faster than a swordsman and cannot take '
               + 'what a swordsman takes. Send him at something; do not leave '
               + 'him holding a gate. Needs a mace and armour.',
  },
  crossbowman: {
    name: 'crossbowman', from: 'barracks', label: 'Crossbowman', gold: 60,
    cost: { crossbows: 1 },
    // Deliberately not "a better archer". He out-ranges one and each bolt
    // bites nearly three times as deep, but at a third of the rate of shooting
    // and a walking pace slower than anyone else on foot -- so he is a man for
    // a wall you already hold, and an archer is still the man for a wall you
    // are still running to.
    hp: 34, speed: 1.05, damage: 14, range: 7.5, cooldown: 3.4,
    description: 'Punches through armour at a range no archer has, and winds '
               + 'the thing back up for three seconds afterwards. Put him on a '
               + 'wall. Needs a crossbow.',
  },

  /*
   * The mercenary post's roster, and the ladderman.
   *
   * Every one of these costs gold and NOTHING ELSE, which is their whole reason
   * to exist. A player with no iron, no fletcher and no armoury has, until now,
   * had no army at all -- and a player whose armoury has just been burnt has had
   * no way to replace one quickly. Mercenaries are that way: dearer per man than
   * the barracks charges for his near-equivalent, available the instant the
   * treasury can pay, and beholden to no workshop.
   *
   * They are otherwise deliberately not better. The arabian swordsman is a
   * swordsman who costs fifteen gold more and wears less; the slinger is an archer
   * with less reach. What you buy is speed and independence, not quality.
   */

  slave: {
    name: 'slave', from: 'mercenary_post', label: 'Slave', gold: 12,
    cost: {},
    // The cheapest thing on the field by a wide margin, and it shows in every
    // number. He exists to be in front of somebody who matters -- a wall's
    // worth of arrows spent on slaves is a wall's worth not spent on your
    // swordsmen.
    hp: 22, speed: 1.55, damage: 3, range: 0.9, cooldown: 1.3,
    description: 'Barely armed and barely willing. Twelve gold buys a body '
               + 'between the enemy and someone who cost you eighty.',
  },
  slinger: {
    name: 'slinger', from: 'mercenary_post', label: 'Slinger', gold: 25,
    cost: {},
    hp: 24, speed: 1.7, damage: 4, range: 5.0, cooldown: 1.5,
    description: 'Throws stones, quickly, from not quite as far as an archer. '
               + 'Cheap enough to lose and fast enough to get away.',
  },
  arabian_swordsman: {
    name: 'arabian_swordsman', from: 'mercenary_post', label: 'Arabian Swordsman',
    gold: 95, cost: {},
    // A swordsman's blow at a swordsman's reach, quicker on his feet and
    // thinner in the skin, for fifteen gold more and no workshop at all.
    hp: 82, speed: 1.4, damage: 14, range: 0.9, cooldown: 1.4,
    description: 'A swordsman who brought his own sword. Faster than yours and '
               + 'less armoured, and he wants no armoury behind him.',
  },
  assassin: {
    name: 'assassin', from: 'mercenary_post', label: 'Assassin', gold: 115,
    cost: {},
    climbs: true,
    // The hardest single blow any man deals, and the only one that does not
    // care about a wall. He dies to two swordsmen. He is a key, not an army.
    hp: 46, speed: 1.5, damage: 22, range: 0.9, cooldown: 1.8,
    description: 'Goes over a wall as though it were not there and kills what '
               + 'is standing on it. Send one at a tower, not a battle — '
               + 'anything that gets its hands on him wins.',
  },
  ladderman: {
    name: 'ladderman', from: 'siege_camp', label: 'Ladderman', gold: 30,
    cost: { wood: 3 },
    ladders: true,
    // Zero damage, like the engineer and the tunneller, and for the same
    // reason: what he does is worth having on its own, and a man who did it
    // AND fought would simply be a better soldier.
    hp: 32, speed: 1.5, damage: 0, range: 0.9, cooldown: 1.5,
    description: 'Carries a ladder and nothing else. Every man of yours near '
               + 'him can reach the enemy standing on a wall — which is the '
               + 'only way anything but an assassin ever can. He will not fight.',
  },
};

/**
 * Siege engines. Slow, defenceless, and the only thing that brings a wall down.
 *
 * Priced well above troops on purpose: a catapult is the answer to "how do I
 * ever beat the lord", and it should cost a real part of an economy rather than
 * being another unit in the queue.
 *
 * These still cost timber and iron DIRECTLY, unlike the men at the barracks.
 * An engine is not a soldier being handed kit off a rack -- it is built on the
 * spot out of beams and fittings, so the siege camp draws on the stockpile
 * and the armoury has nothing to do with it.
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
  trebuchet: {
    name: 'trebuchet', from: 'siege_camp', label: 'Trebuchet', gold: 300,
    cost: { wood: 45, iron: 15 },
    // The heavy engine above the catapult: it out-ranges everything and each
    // stone bites nearly twice as deep, but it crawls and it reloads slowly, so
    // it wants an escort and a good firing spot rather than a brawl. Same
    // fragility as the catapult -- a siege engine, not a tank.
    hp: 90, speed: 0.35, damage: 55, range: 10.5, cooldown: 5.0, siege: true,
    description: 'Hurls great stones farther than any catapult and hits far '
               + 'harder — but slow to move and slow to reload.',
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

export const SOLDIER_ORDER: string[] =
  ['spearman', 'archer', 'crossbowman', 'pikeman', 'maceman', 'swordsman',
   'slave', 'slinger', 'arabian_swordsman', 'assassin',
   'engineer', 'tunneler',
   'ram', 'catapult', 'trebuchet', 'fire_ballista', 'ladderman'];

/**
 * Soldiers that exist but no recruit panel lists.
 *
 * The same trap BUILD_MENU sprang: SOLDIER_ORDER is hand-written and it is the
 * only thing the recruit panel iterates, so a unit missing from it is defined,
 * costed, sprited and unrecruitable in silence. Reported through the same
 * startup banner as a stale manifest.
 */
export function unlistedSoldiers(): string[] {
  const listed = new Set(SOLDIER_ORDER);
  return Object.keys(SOLDIER_TYPES)
    .filter(n => !listed.has(n))
    .map(n => `unrecruitable:${n}`);
}
