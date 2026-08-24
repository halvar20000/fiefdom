import { BUILDINGS, canGarrison } from './defs';

/**
 * Which battlement tiles a man can actually reach.
 *
 * A curtain wall has no way up. Towers and gatehouses have stairs inside, so a
 * man can always be posted on one; a stretch of wall is man-able only if its
 * walkway connects, tile by tile, back to one of those. Without this, stairs
 * would be decoration and a bare ring of wall could be garrisoned out of thin
 * air -- which is not how a castle works and removes the reason to anchor a
 * wall with towers.
 *
 * The idea and the BFS shape are from the Dadud/fiefdom fork's castle.ts
 * (AGPL, same licence); this is a reimplementation against our current
 * building model rather than a copy.
 */

/** Buildings with internal stairs: a man reaches their deck unconditionally. */
const STAIR_SOURCES = new Set(['tower', 'gatehouse']);

export interface Footprint {
  name: string;
  x: number;
  z: number;
}

const key = (x: number, z: number) => `${x},${z}`;

/**
 * The set of garrison tiles reachable from a stair, as "x,z" keys.
 *
 * Four-adjacency only: walls join along their edges, and a wall touching
 * another only at a corner is not a continuous walkway -- which is exactly why
 * a corner wants a tower.
 */
export function manableTiles(buildings: Iterable<Footprint>): Set<string> {
  // Map every garrison tile to whether it is a stair source, and remember
  // which tiles exist so the walk cannot step onto open ground.
  const tiles = new Map<string, boolean>();
  for (const b of buildings) {
    if (!canGarrison(b.name)) continue;
    const def = BUILDINGS[b.name];
    if (!def) continue;
    const [w, d] = def.footprint;
    const source = STAIR_SOURCES.has(b.name);
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        // A source tile stays a source even if a plain wall also covers it.
        const k = key(b.x + dx, b.z + dz);
        tiles.set(k, (tiles.get(k) ?? false) || source);
      }
    }
  }

  const reached = new Set<string>();
  const queue: [number, number][] = [];
  for (const [k, isSource] of tiles) {
    if (isSource) { reached.add(k); const [x, z] = k.split(',').map(Number); queue.push([x, z]); }
  }

  while (queue.length) {
    const [x, z] = queue.pop()!;
    for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]] as const) {
      const k = key(nx, nz);
      if (!tiles.has(k) || reached.has(k)) continue;
      reached.add(k);
      queue.push([nx, nz]);
    }
  }
  return reached;
}

/** Is this specific tile reachable? Cheap wrapper for a single-post check. */
export function tileManable(buildings: Iterable<Footprint>, x: number, z: number): boolean {
  return manableTiles(buildings).has(key(x, z));
}
