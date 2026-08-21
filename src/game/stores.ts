import { type Resource } from './defs';

/**
 * All a layout needs of a placed building.
 *
 * Declared structurally rather than importing PlacedBuilding, which lives in
 * state.ts -- and state.ts owns the layouts, so importing it back would be a
 * cycle. PlacedBuilding satisfies this shape as it stands.
 */
export interface YardTile {
  id: number;
  x: number;
  z: number;
}

/** One square of a store, and what is sitting on it. */
export interface Pile {
  x: number;
  z: number;
  /** null when the square is empty. */
  res: Resource | null;
  /** Units on this square. */
  count: number;
  /** 0 = empty, 1..levels = which sprite to draw. */
  level: number;
}

/**
 * Which square of a store holds which good.
 *
 * Quantities stay in `GameState.stock`; this only decides how they are laid
 * out, so there is exactly one number per good and the yard can never disagree
 * with the panel.
 *
 * One class drives both stores. They differ only in which goods they accept,
 * how much a square holds and which sprites they draw -- and a second copy of
 * this logic would be the obvious place for the two to quietly drift apart.
 *
 * Assignment is PERSISTENT rather than recomputed from scratch each tick. A
 * fresh allocation in resource order looks identical most of the time and then
 * reshuffles the entire yard the moment an early good shrinks by one square --
 * every later good shifts along, and a settlement that is merely spending wood
 * appears to be frantically rearranging itself.
 */
export class StoreLayout {
  /** building id -> the good that square is reserved for */
  private assigned = new Map<number, Resource>();
  /** What to draw, rebuilt by `sync`. */
  piles: Pile[] = [];

  /**
   * Packed (x, z, good, level) per square, for change detection.
   *
   * `sync` runs every frame, so this must not allocate. An earlier version
   * joined a signature string and threw away a kilobyte a frame; a numeric
   * hash would be cheaper still but a collision silently skips a redraw, and
   * a store showing the wrong good is exactly the bug this exists to avoid.
   * Element-wise comparison is exact and allocates only when the store resizes.
   */
  private lastKeys = new Int32Array(0);

  constructor(
    /** Goods this store accepts, in the order squares are claimed. */
    private readonly goods: readonly Resource[],
    /** Units of ONE good a single square holds. */
    readonly tileCapacity: number,
    /** Fill levels the sprites cover. */
    private readonly levels: number,
  ) {}

  /**
   * Recompute the layout. Returns true when what is drawn changed, so the
   * caller can rebuild its sprite list only on the ticks that need it.
   */
  sync(tiles: YardTile[], stock: Record<Resource, number>): boolean {
    // Placement order, so a square keeps its place in the queue for life.
    const ordered = [...tiles].sort((a, b) => a.id - b.id);
    const live = new Set(ordered.map(t => t.id));
    for (const id of [...this.assigned.keys()]) {
      if (!live.has(id)) this.assigned.delete(id);
    }

    const held = (r: Resource) => ordered.filter(t => this.assigned.get(t.id) === r);
    const wanted = (r: Resource) =>
      Math.ceil(Math.max(0, stock[r]) / this.tileCapacity);

    // Release first, so goods that grew can take the squares goods that shrank
    // just gave up -- in the same pass, with no intermediate "store full".
    for (const r of this.goods) {
      for (const t of held(r).slice(wanted(r))) this.assigned.delete(t.id);
    }
    for (const r of this.goods) {
      let short = wanted(r) - held(r).length;
      if (short <= 0) continue;
      for (const t of ordered) {
        if (short === 0) break;
        if (!this.assigned.has(t.id)) { this.assigned.set(t.id, r); short--; }
      }
    }

    const counts = new Map<number, { res: Resource; count: number }>();
    for (const r of this.goods) {
      let left = Math.max(0, stock[r]);
      // Fill squares to the brim in order, leaving the remainder on the last
      // one, so a half-empty store reads as full piles plus one part pile
      // rather than as every square being vaguely half full.
      for (const t of held(r)) {
        const n = Math.min(this.tileCapacity, left);
        left -= n;
        counts.set(t.id, { res: r, count: n });
      }
    }

    this.piles = ordered.map(t => {
      const c = counts.get(t.id);
      return {
        x: t.x, z: t.z,
        res: c ? c.res : null,
        count: c ? c.count : 0,
        level: c ? this.levelFor(c.count) : 0,
      };
    });

    if (this.lastKeys.length !== this.piles.length) {
      this.lastKeys = new Int32Array(this.piles.length);
      this.writeKeys();
      return true;
    }
    for (let i = 0; i < this.piles.length; i++) {
      if (this.lastKeys[i] !== this.keyOf(this.piles[i])) {
        this.writeKeys();
        return true;
      }
    }
    return false;
  }

  /** Units of `res` that still fit: its own part-filled squares plus empty ones. */
  spaceFor(res: Resource, tiles: YardTile[],
           stock: Record<Resource, number>): number {
    this.sync(tiles, stock);
    let mine = 0, free = 0;
    for (const t of tiles) {
      const a = this.assigned.get(t.id);
      if (a === res) mine++;
      else if (a === undefined) free++;
    }
    return (mine + free) * this.tileCapacity - Math.max(0, stock[res]);
  }

  private writeKeys(): void {
    for (let i = 0; i < this.piles.length; i++) this.lastKeys[i] = this.keyOf(this.piles[i]);
  }

  /** (x, z, good, level) packed into one int. Map coords stay under 1024. */
  private keyOf(p: Pile): number {
    const res = p.res ? this.goods.indexOf(p.res) + 1 : 0;
    return ((p.x * 1024 + p.z) * 16 + res) * 8 + p.level;
  }

  private levelFor(count: number): number {
    if (count <= 0) return 0;
    const step = this.tileCapacity / this.levels;
    return Math.min(this.levels, Math.max(1, Math.ceil(count / step)));
  }
}
