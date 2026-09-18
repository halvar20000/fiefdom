/**
 * Names that are made up, not looked up.
 *
 * A rival lord used to be "the Red Lord" and a painted map "My map": labels,
 * not names, and the same ones in every game. This builds a name from parts,
 * the way OpenTTD makes its town names -- the idea is theirs, the tables are
 * ours; OpenTTD is GPL-2.0-only and nothing of it can be copied into this
 * project -- so each game has lords of its own and a map can be called
 * something before anyone has thought what to call it.
 *
 * Two registers, matched to what already exists rather than invented fresh:
 *
 *  - A MAP is named the way the shipped maps are named: a feature and a word
 *    for it. "The Green Wadi", "Dust and Stone", "The Lake of Reeds" are the
 *    patterns; the lists below produce "The Bitter Scarp", "Salt and Cedar",
 *    "The Ford of Jackals" from the same moulds.
 *  - A LORD is a given name in one of the two traditions the setting has, put
 *    together from a first and a second element as those names actually were,
 *    and then his banner: "Aldric the Red", "Rashid the Blue". The colour
 *    stays in the name because it is how you tell his troops from another's
 *    across the map, and a name that lost it would cost more than it gave.
 *
 * Every function takes an `Rng` rather than calling Math.random, so a name
 * can be drawn from a seed when every client of a match has to agree on it
 * and from chance when it need only be different from last time.
 */

/** A source of numbers in [0, 1). */
export type Rng = () => number;

/** mulberry32: small, decent, and the same sequence for the same seed anywhere. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 32-bit hash of a string, for seeding from a match id or a map name. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)];

// --- maps -------------------------------------------------------------------

const FEATURES = [
  'Wadi', 'Valley', 'Ridge', 'Pan', 'Coast', 'Country', 'Marsh', 'Reach',
  'Basin', 'Flats', 'Hollow', 'Scarp', 'Ford', 'Steppe', 'Shore', 'Gorge',
  'Plain', 'Fens', 'Downs', 'Heath', 'Waste', 'Sands', 'Pools', 'Springs',
  'Bluffs', 'Terraces', 'Rise', 'Bottoms', 'Levels', 'Narrows', 'Crossing',
  'Tables', 'Pits', 'Lake', 'Strand', 'Oasis',
];

const ADJECTIVES = [
  'Green', 'Quiet', 'Long', 'High', 'Broken', 'Dry', 'Red', 'Black', 'White',
  'Low', 'Far', 'Burnt', 'Bitter', 'Silent', 'Stony', 'Windy', 'Sunken',
  'Crooked', 'Bare', 'Wide', 'Hidden', 'Cold', 'Old', 'Grey', 'Pale',
  'Thirsty', 'Shattered', 'Empty', 'Sweet', 'Blind', 'Lost', 'Little',
  'Great', 'Lower', 'Upper', 'Still', 'Bright',
];

/** Things the ground is made of, or grows. Also stand alone before a feature. */
const THINGS = [
  'Dust', 'Stone', 'Salt', 'Cedar', 'Reed', 'Tar', 'Sand', 'Palm', 'Thorn',
  'Ash', 'Iron', 'Bone', 'Flint', 'Clay', 'Copper', 'Bramble', 'Rush',
  'Sedge', 'Pitch', 'Ochre', 'Smoke', 'Brine', 'Chalk', 'Shale', 'Gravel',
  'Fig', 'Olive', 'Willow', 'Tamarisk', 'Juniper', 'Myrrh', 'Amber', 'Lime',
];

/** "...of Reeds": what a place is full of, or remembered for. */
const OF = [
  'Reeds', 'Thorns', 'Palms', 'Stones', 'Salt', 'Dust', 'Ashes', 'Bones',
  'Winds', 'Crows', 'Kites', 'Jackals', 'Gazelles', 'Sorrows', 'Kings',
  'Widows', 'Ravens', 'Thistles', 'Pilgrims', 'Exiles', 'Wells', 'Lions',
  'Bees', 'Cranes', 'Shepherds', 'Ghosts', 'Vipers', 'Locusts', 'Tears',
  'Mirrors', 'Two Rivers', 'Seven Wells', 'the Moon', 'the Dead',
];

/** A name for a map, in the register of the ones the game ships with. */
export function mapName(rng: Rng): string {
  const r = rng();
  if (r < 0.34) return `The ${pick(rng, ADJECTIVES)} ${pick(rng, FEATURES)}`;
  if (r < 0.52) return `The ${pick(rng, THINGS)} ${pick(rng, FEATURES)}`;
  if (r < 0.70) return `${pick(rng, THINGS)} ${pick(rng, FEATURES)}`;
  if (r < 0.86) return `The ${pick(rng, FEATURES)} of ${pick(rng, OF)}`;
  // "Dust and Stone": two things, never the same one twice.
  const a = pick(rng, THINGS);
  let b = pick(rng, THINGS);
  while (b === a) b = pick(rng, THINGS);
  return `${a} and ${b}`;
}

// --- lords ------------------------------------------------------------------

/**
 * Two-element names, as the Franks and the English actually made them: a
 * first element and a second, each a word in its own right once. Most pairs
 * are names that were borne -- Aldric, Godwin, Osmund, Theobald, Wulfstan --
 * and the rest sound as if they could have been.
 */
const FRANK_FIRST = [
  'Ald', 'Bald', 'Ber', 'Cuth', 'Ead', 'Ed', 'God', 'Gun', 'Leof', 'Os',
  'Rad', 'Sig', 'Theo', 'Wal', 'Wil', 'Wulf', 'Ger', 'Hum', 'Ran', 'Rob',
  'Ans', 'Arn', 'Mal', 'Reg', 'Ric', 'Rod', 'Ael', 'Alf', 'Bert', 'Her',
  'Hro', 'Lam', 'Od', 'Ot', 'Rein', 'Sae', 'Thur', 'Wig',
];
const FRANK_SECOND = [
  'ric', 'win', 'mund', 'red', 'bert', 'helm', 'frid', 'gar', 'wald', 'ulf',
  'noth', 'mer', 'olf', 'hard', 'bald', 'man', 'ward', 'stan', 'wine', 'her',
  'mar', 'grim', 'lac', 'brand', 'gyth',
];

/**
 * Names from the other side of the same wars, built the same way from a
 * first syllable and a second. Rashid, Salim, Hamid, Khalid, Tariq, Yaqub and
 * Kamal come out of these tables, and the rest keep their company.
 */
const ARAB_FIRST = [
  'Ra', 'Sa', 'Ha', 'Mu', 'Kha', 'Ta', 'Ya', 'Na', 'Ka', 'Fa', 'Ja', 'Ma',
  'Za', 'Ba', 'Da', 'Sha', 'Wa', 'Qa', 'La', 'Ni', 'Su', 'Hu', 'Ab', 'Id',
];
const ARAB_SECOND = [
  'shid', 'lim', 'mid', 'sir', 'lid', 'riq', 'qub', 'mal', 'sim', 'rid',
  'bir', 'fir', 'lil', 'him', 'zid', 'man', 'san', 'dir', 'kim', 'jib',
  'hir', 'dil', 'nir', 'fiq', 'wad', 'mir', 'zim', 'bas', 'dan',
];

/** A given name, from one tradition or the other. */
function givenName(rng: Rng): string {
  const frank = rng() < 0.5;
  const [firsts, seconds] = frank ? [FRANK_FIRST, FRANK_SECOND] : [ARAB_FIRST, ARAB_SECOND];
  for (;;) {
    const a = pick(rng, firsts), b = pick(rng, seconds);
    // A doubled letter at the join ("Wulffrid", "Radd...") or an element
    // repeated ("Ulfulf") is the seam showing. Draw again.
    if (a[a.length - 1].toLowerCase() === b[0]) continue;
    if (a.toLowerCase().endsWith(b) || b.startsWith(a.toLowerCase())) continue;
    return a + b;
  }
}

/**
 * A rival's name with his banner: "Aldric the Red". `banner` is the banner's
 * own name, "the Red Lord", and the colour is what is kept of it. `taken`
 * keeps two lords in one game from sharing a given name.
 */
export function lordName(rng: Rng, banner: string, taken: Set<string> = new Set()): string {
  let given = givenName(rng);
  for (let tries = 0; taken.has(given) && tries < 20; tries++) given = givenName(rng);
  taken.add(given);
  const colour = banner.replace(/^the /, '').replace(/ Lord$/, '');
  return `${given} the ${colour}`;
}
