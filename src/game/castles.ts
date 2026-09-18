/**
 * Castle blueprints: the shapes a rival lord builds his walls in.
 *
 * Stronghold Crusader's lords never planned a castle. Each stamped a
 * hand-drawn layout -- the AIV files -- built out in phases as the stone came
 * in, and that is why their castles looked like castles and not like the
 * output of a search. This is the same idea kept to the part that shows: the
 * curtain wall, its towers and where the gate may go. The economy inside is
 * still sited by the lord as he needs it.
 *
 * A blueprint is drawn, not computed, so it can be read and a new one added
 * in the time it takes to type it:
 *
 *   #   a tile of wall
 *   T   a tower; four of them in a 2x2 block, on the line
 *   G   where a gate may go: two of them side by side on the line. Of the
 *       candidates, the one nearest the player's keep is the gate; the rest
 *       are built as wall
 *   K   the centre of the keep, which is where the plan is stamped
 *   .   open ground
 *
 * The line must be CLOSED, including through the tower blocks and gate
 * pairs, or the castle has a hole in it: `parse` checks this. A plan with
 * two closed lines is two rings -- the bailey plan below -- and each ring
 * takes a gate of its own, or the inner one would shut the lord's own keep
 * away from his town.
 *
 * Where the shape falls on unbuildable ground the lord's plan tries the
 * next in his list, ending on the plain square, which fits nearly anywhere.
 */

export interface Blueprint {
  key: string;
  /** For the console and the log: what he is building. */
  label: string;
  rows: string[];
}

/** A blueprint resolved to tile offsets from the keep's centre. */
export interface Layout {
  key: string;
  /** Every tile of every wall line, tower blocks and gate pairs included. */
  line: [number, number][];
  /** Tower origins (top-left of the 2x2). */
  towers: [number, number][];
  /**
   * Gate candidates, grouped by the ring they sit on. Each is an origin as
   * the gatehouse takes it: the 2x2 covers the origin and reaches +1 in x
   * and z, so a pair on a top or left line reaches inward and a pair on a
   * bottom or right line reaches outward -- exactly as the square did.
   */
  gates: [number, number][][];
  /** Tiles inside the outermost line, the keep's own included. */
  inside: Set<string>;
  /** Half-width and half-height of the bounding box, for a quick fit check. */
  reach: { x: number; z: number };
}

export const BLUEPRINTS: Blueprint[] = [
  {
    key: 'square', label: 'a square keep',
    rows: [
      'TT###############TT',
      'TT###############TT',
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      'G.................#',
      'G.................G',
      '#.................G',
      '#........K........#',
      '#.................#',
      'G.................#',
      'G.................G',
      '#.................G',
      '#.................#',
      '#.................#',
      '#.................#',
      'TT#####GG#####GG#TT',
      'TT###############TT',
    ],
  },
  {
    key: 'bastion', label: 'a bastioned square',
    rows: [
      'TT######TT#######TT',
      'TT######TT#######TT',
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      'G.................G',
      'G.................G',
      'TT...............TT',
      'TT.......K.......TT',
      '#.................#',
      'G.................G',
      'G.................G',
      '#.................#',
      '#.................#',
      '#.................#',
      '#.................#',
      'TT###GG#TT###GG##TT',
      'TT######TT#######TT',
    ],
  },
  {
    key: 'broad', label: 'a broad ward',
    rows: [
      'TT#####GG######GG######TT',
      'TT#####################TT',
      '#.......................#',
      '#.......................#',
      'G.......................G',
      'G.......................G',
      '#.......................#',
      '#...........K...........#',
      '#.......................#',
      'G.......................G',
      'G.......................G',
      '#.......................#',
      '#.......................#',
      'TT#####GG######GG######TT',
      'TT#####################TT',
    ],
  },
  {
    key: 'close', label: 'a close ring',
    rows: [
      'TT#########TT',
      'TT#########TT',
      '#...........#',
      '#...........#',
      'G...........G',
      'G...........G',
      '#.....K.....#',
      'G...........G',
      'G...........G',
      '#...........#',
      '#...........#',
      'TT###GG####TT',
      'TT#########TT',
    ],
  },
  {
    key: 'bailey', label: 'a walled bailey round a citadel',
    rows: [
      'TT###################TT',
      'TT###################TT',
      '#.....................#',
      '#.....................#',
      'G.....................G',
      'G.....................G',
      '#.....TT#####TT.......#',
      '#.....TT#####TT.......#',
      '#.....#.......#.......#',
      '#.....G...K...G.......#',
      '#.....G.......G.......#',
      '#.....#.......#.......#',
      '#.....TT#GG##TT.......#',
      '#.....TT#####TT.......#',
      '#.....................#',
      'G.....................G',
      'G.....................G',
      '#.....................#',
      '#.....................#',
      'TT######GG####GG#####TT',
      'TT###################TT',
    ],
  },
];

export const blueprintOf = (key: string): Blueprint | undefined =>
  BLUEPRINTS.find(b => b.key === key);

/**
 * Resolve a blueprint to offsets from the keep's centre, and check it.
 *
 * Throws on a malformed plan -- a missing or doubled K, a tower block that is
 * not 2x2, a gate mark without its pair, a line with a hole in it -- because
 * a bad blueprint is an authoring error to be found by the tests, not a lord
 * who quietly builds a wall with a gap.
 */
export function parse(bp: Blueprint): Layout {
  const rows = bp.rows;
  const h = rows.length, w = rows[0].length;
  if (rows.some(r => r.length !== w)) throw new Error(`${bp.key}: ragged rows`);
  const at = (x: number, z: number) => (x < 0 || z < 0 || x >= w || z >= h) ? '.' : rows[z][x];
  const isLine = (x: number, z: number) => '#TG'.includes(at(x, z));

  let keep: [number, number] | null = null;
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
    if (at(x, z) !== 'K') continue;
    if (keep) throw new Error(`${bp.key}: two keeps`);
    keep = [x, z];
  }
  if (!keep) throw new Error(`${bp.key}: no keep`);
  const [kx, kz] = keep;
  const rel = (x: number, z: number): [number, number] => [x - kx, z - kz];

  // Tower blocks: every T must be a corner of exactly one 2x2 of Ts.
  const towers: [number, number][] = [];
  const claimed = new Set<string>();
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
    if (at(x, z) !== 'T' || claimed.has(`${x},${z}`)) continue;
    const block = [[0, 0], [1, 0], [0, 1], [1, 1]];
    if (!block.every(([dx, dz]) => at(x + dx, z + dz) === 'T')) {
      throw new Error(`${bp.key}: tower at ${x},${z} is not a 2x2 block`);
    }
    for (const [dx, dz] of block) claimed.add(`${x + dx},${z + dz}`);
    towers.push(rel(x, z));
  }

  // Gate pairs: two Gs side by side, horizontally or vertically.
  const gatePairs: [number, number][] = [];
  const gClaimed = new Set<string>();
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
    if (at(x, z) !== 'G' || gClaimed.has(`${x},${z}`)) continue;
    let mate: [number, number] | null = null;
    if (at(x + 1, z) === 'G' && !gClaimed.has(`${x + 1},${z}`)) mate = [x + 1, z];
    else if (at(x, z + 1) === 'G' && !gClaimed.has(`${x},${z + 1}`)) mate = [x, z + 1];
    if (!mate) throw new Error(`${bp.key}: gate at ${x},${z} has no pair`);
    gClaimed.add(`${x},${z}`); gClaimed.add(`${mate[0]},${mate[1]}`);
    gatePairs.push(rel(x, z));
  }

  // The lines, and which ring each tile belongs to: flood the line tiles by
  // 4-connection so two rings come out as two components. 8-connected here
  // would join rings that touch at a corner, and 4-connected walls are what
  // a sealed line needs anyway -- the pathfinder does not cut corners.
  const line: [number, number][] = [];
  const ringOf = new Map<string, number>();
  let rings = 0;
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
    if (!isLine(x, z) || ringOf.has(`${x},${z}`)) continue;
    const id = rings++;
    const stack: [number, number][] = [[x, z]];
    ringOf.set(`${x},${z}`, id);
    while (stack.length) {
      const [cx, cz] = stack.pop()!;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = cx + dx, nz = cz + dz;
        if (!isLine(nx, nz) || ringOf.has(`${nx},${nz}`)) continue;
        ringOf.set(`${nx},${nz}`, id);
        stack.push([nx, nz]);
      }
    }
  }
  for (const [k] of ringOf) {
    const [x, z] = k.split(',').map(Number);
    line.push(rel(x, z));
  }

  // Inside: flood open ground from the keep, never crossing the line; it
  // must not reach the edge of the drawing, or the outer ring has a hole.
  const inside = new Set<string>();
  const stack: [number, number][] = [[kx, kz]];
  inside.add(`${kx},${kz}`);
  while (stack.length) {
    const [cx, cz] = stack.pop()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= w || nz >= h) {
        throw new Error(`${bp.key}: the line has a hole; the keep can reach the edge`);
      }
      if (isLine(nx, nz) || inside.has(`${nx},${nz}`)) continue;
      inside.add(`${nx},${nz}`);
      stack.push([nx, nz]);
    }
  }
  // Every ring must be sealed too, not only the outer: check that no inner
  // ring's interior leaks -- by flooding from the keep again with the inner
  // ring alone in the way, it must stay smaller than the whole inside.
  const gates: [number, number][][] = Array.from({ length: rings }, () => []);
  for (const [gx, gz] of gatePairs) {
    const id = ringOf.get(`${gx + kx},${gz + kz}`);
    if (id === undefined) throw new Error(`${bp.key}: gate off the line`);
    gates[id].push([gx, gz]);
  }
  for (let id = 0; id < rings; id++) {
    if (!gates[id].length) throw new Error(`${bp.key}: ring ${id} has no gate`);
  }
  // Outer ring first: the one with the farthest tile.
  const far = (g: [number, number][]) => Math.max(...g.map(([x, z]) => Math.max(Math.abs(x), Math.abs(z))));
  gates.sort((a, b) => far(b) - far(a));

  const insideRel = new Set<string>();
  for (const k of inside) {
    const [x, z] = k.split(',').map(Number);
    insideRel.add(`${x - kx},${z - kz}`);
  }
  return {
    key: bp.key, line, towers, gates, inside: insideRel,
    reach: { x: Math.max(kx, w - 1 - kx), z: Math.max(kz, h - 1 - kz) },
  };
}

/** Every blueprint, parsed once. Throws at load if any is malformed. */
export const LAYOUTS: Layout[] = BLUEPRINTS.map(parse);

export const layoutOf = (key: string): Layout | undefined => LAYOUTS.find(l => l.key === key);

/**
 * The order a lord tries the shapes in. Heavy lords reach for the big
 * plans, easy ones for the modest; everyone ends on the square, which is
 * the one that fits nearly any ground. `avoid` holds the shapes already
 * taken on this map.
 */
export function preference(difficulty: 'easy' | 'normal' | 'heavy', rng: () => number,
                           avoid: Set<string> = new Set()): Layout[] {
  const pools: Record<typeof difficulty, string[]> = {
    easy: ['close', 'square', 'broad'],
    normal: ['square', 'broad', 'bastion', 'close'],
    heavy: ['bailey', 'bastion', 'broad', 'square'],
  };
  const keys = [...pools[difficulty]];
  // Shuffle the front of the list so two lords on one map differ, then make
  // sure the square is last as the fallback whatever the draw.
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  // Shapes the other lords on this map have taken go to the back, so three
  // rivals are three castles and not one castle three times.
  const ordered = keys.filter(k => k !== 'square' && !avoid.has(k));
  ordered.push(...keys.filter(k => k !== 'square' && avoid.has(k)));
  ordered.push('square');
  return ordered.map(k => LAYOUTS.find(l => l.key === k)!);
}
