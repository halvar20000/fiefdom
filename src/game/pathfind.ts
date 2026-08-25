/**
 * Grid A* for unit movement.
 *
 * Units walk a tile grid, so a plain 8-connected A* is the right tool: paths
 * are exact, cheap at these distances, and never get stuck the way steering-
 * based avoidance does when a unit is shoved into a building's inside corner.
 *
 * Only BUILDINGS block. Trees and rocks are deliberately passable -- making
 * scatter block as well turns a palm grove into a maze and sends woodcutters on
 * absurd detours to reach a trunk that is right in front of them.
 */

export interface PathNode { x: number; z: number }

/** Sampled across the unit's width, not just its centre line. */
const LOS_OFFSETS = [-0.35, 0, 0.35];

export class PathGrid {
  readonly width: number;
  readonly height: number;
  /** 1 = impassable. */
  readonly blocked: Uint8Array;

  // Search scratch, reused between calls. A generation stamp avoids clearing
  // 40,000 entries on every single path request.
  private gScore: Float32Array;
  private fScore: Float32Array;
  private cameFrom: Int32Array;
  private stamp: Int32Array;
  private closed: Uint8Array;
  private generation = 0;
  private heap: Int32Array;
  private heapLen = 0;

  /**
   * Connected-component label per walkable tile, -1 for blocked.
   *
   * Buildings readily enclose a courtyard, and a target chosen inside one is
   * unreachable no matter how good the search is. Comparing region labels
   * rejects those instantly, so callers can pick a reachable spot instead of
   * discovering the problem as a failed path and falling back to walking
   * through the wall.
   */
  private regions: Int32Array;
  private regionsDirty = true;
  private queue: Int32Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const n = width * height;
    this.blocked = new Uint8Array(n);
    this.gScore = new Float32Array(n);
    this.fScore = new Float32Array(n);
    this.cameFrom = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.closed = new Uint8Array(n);
    this.heap = new Int32Array(n);
    this.regions = new Int32Array(n);
    this.queue = new Int32Array(n);
  }

  private idx(x: number, z: number): number { return z * this.width + x; }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.width && z < this.height;
  }

  isBlocked(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return true;
    return this.blocked[this.idx(x, z)] === 1;
  }

  setBlocked(x: number, z: number, v: boolean): void {
    if (!this.inBounds(x, z)) return;
    const i = this.idx(x, z);
    if (this.blocked[i] === (v ? 1 : 0)) return;
    this.blocked[i] = v ? 1 : 0;
    this.regionsDirty = true;
  }

  fill(x: number, z: number, w: number, d: number, v: boolean): void {
    for (let dz = 0; dz < d; dz++)
      for (let dx = 0; dx < w; dx++) this.setBlocked(x + dx, z + dz, v);
  }

  // --- binary heap over fScore -------------------------------------------

  private heapPush(i: number): void {
    let c = this.heapLen++;
    this.heap[c] = i;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.fScore[this.heap[p]] <= this.fScore[this.heap[c]]) break;
      const t = this.heap[p]; this.heap[p] = this.heap[c]; this.heap[c] = t;
      c = p;
    }
  }

  private heapPop(): number {
    const top = this.heap[0];
    this.heapLen--;
    if (this.heapLen > 0) {
      this.heap[0] = this.heap[this.heapLen];
      let c = 0;
      for (;;) {
        const l = c * 2 + 1, r = l + 1;
        let s = c;
        if (l < this.heapLen && this.fScore[this.heap[l]] < this.fScore[this.heap[s]]) s = l;
        if (r < this.heapLen && this.fScore[this.heap[r]] < this.fScore[this.heap[s]]) s = r;
        if (s === c) break;
        const t = this.heap[s]; this.heap[s] = this.heap[c]; this.heap[c] = t;
        c = s;
      }
    }
    return top;
  }

  /** Flood-fill walkable tiles into connected components. */
  private computeRegions(): void {
    const n = this.width * this.height;
    this.regions.fill(-1);
    let label = 0;
    for (let start = 0; start < n; start++) {
      if (this.blocked[start] === 1 || this.regions[start] !== -1) continue;
      let head = 0, tail = 0;
      this.queue[tail++] = start;
      this.regions[start] = label;
      while (head < tail) {
        const cur = this.queue[head++];
        const cx = cur % this.width;
        const cz = (cur - cx) / this.width;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue;
            const nx = cx + dx, nz = cz + dz;
            if (!this.inBounds(nx, nz)) continue;
            const ni = this.idx(nx, nz);
            if (this.blocked[ni] === 1 || this.regions[ni] !== -1) continue;
            // match the search's corner rule so labels reflect real movement
            if (dx !== 0 && dz !== 0
                && this.isBlocked(cx + dx, cz) && this.isBlocked(cx, cz + dz)) continue;
            this.regions[ni] = label;
            this.queue[tail++] = ni;
          }
        }
      }
      label++;
    }
    this.regionsDirty = false;
  }

  /** Component label at a tile, or -1 if blocked / out of bounds. */
  regionAt(x: number, z: number): number {
    if (!this.inBounds(x, z)) return -1;
    if (this.regionsDirty) this.computeRegions();
    return this.regions[this.idx(x, z)];
  }

  /** Can a unit walk from one tile to the other at all? */
  connected(x1: number, z1: number, x2: number, z2: number): boolean {
    const a = this.regionAt(x1, z1);
    if (a < 0) return false;
    return a === this.regionAt(x2, z2);
  }

  /** Nearest passable tile to (x,z), searched outward. Used to rescue goals inside buildings. */
  nearestOpen(x: number, z: number, maxRadius = 6, region = -1): PathNode | null {
    const ok = (nx: number, nz: number) =>
      !this.isBlocked(nx, nz) && (region < 0 || this.regionAt(nx, nz) === region);
    if (ok(x, z)) return { x, z };
    for (let r = 1; r <= maxRadius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (ok(x + dx, z + dz)) return { x: x + dx, z: z + dz };
        }
      }
    }
    return null;
  }

  /**
   * Find a route. Returns tile centres, or null if unreachable.
   *
   * The start tile is always treated as passable: workers stand inside their
   * own building, and refusing to path out of a blocked start would strand
   * every one of them the moment they were hired.
   */
  find(sx: number, sz: number, gx: number, gz: number, maxNodes = 0): PathNode[] | null {
    if (!this.inBounds(sx, sz) || !this.inBounds(gx, gz)) return null;
    // Default the budget to the whole grid. A path that squeezes through a narrow
    // gap -- a river ford, a gap in a wall -- makes A* fan out across the entire
    // near-side region before it finds the one-tile-wide way through, far more
    // than a small fixed cap allows. `connected()` below already rejects a
    // genuinely unreachable goal for free, so the cap is only ever spent on a
    // route that really exists -- and an unreachable enemy is worse than a rare
    // expensive search.
    if (maxNodes <= 0) maxNodes = this.width * this.height;

    if (this.isBlocked(gx, gz)) {
      const open = this.nearestOpen(gx, gz);
      if (!open) return null;
      gx = open.x; gz = open.z;
    }
    if (sx === gx && sz === gz) return [];

    // Unreachable in principle -- do not burn a full search discovering it.
    if (!this.isBlocked(sx, sz) && !this.connected(sx, sz, gx, gz)) return null;

    const gen = ++this.generation;
    this.heapLen = 0;

    const start = this.idx(sx, sz);
    const goal = this.idx(gx, gz);

    this.stamp[start] = gen;
    this.closed[start] = 0;
    this.gScore[start] = 0;
    this.fScore[start] = this.octile(sx, sz, gx, gz);
    this.cameFrom[start] = -1;
    this.heapPush(start);

    let expanded = 0;
    while (this.heapLen > 0) {
      const cur = this.heapPop();
      if (cur === goal) return this.rebuild(cur, gen);
      if (this.closed[cur] === 1 && this.stamp[cur] === gen) continue;
      this.closed[cur] = 1;

      if (++expanded > maxNodes) return null;

      const cx = cur % this.width;
      const cz = (cur - cx) / this.width;
      const isStart = cur === start;

      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = cx + dx, nz = cz + dz;
          if (!this.inBounds(nx, nz)) continue;
          const ni = this.idx(nx, nz);
          if (this.blocked[ni] === 1 && ni !== goal) continue;

          // no cutting through the corner between two blocked tiles
          if (dx !== 0 && dz !== 0 && !isStart) {
            if (this.isBlocked(cx + dx, cz) && this.isBlocked(cx, cz + dz)) continue;
          }

          const step = (dx !== 0 && dz !== 0) ? 1.41421356 : 1;
          const tentative = this.gScore[cur] + step;

          if (this.stamp[ni] !== gen) {
            this.stamp[ni] = gen;
            this.closed[ni] = 0;
            this.gScore[ni] = Infinity;
          }
          if (tentative >= this.gScore[ni]) continue;

          this.cameFrom[ni] = cur;
          this.gScore[ni] = tentative;
          this.fScore[ni] = tentative + this.octile(nx, nz, gx, gz);
          this.heapPush(ni);
        }
      }
    }
    return null;
  }

  private octile(x: number, z: number, gx: number, gz: number): number {
    const dx = Math.abs(x - gx), dz = Math.abs(z - gz);
    return (dx + dz) + (1.41421356 - 2) * Math.min(dx, dz);
  }

  private rebuild(goal: number, gen: number): PathNode[] {
    const out: PathNode[] = [];
    let cur = goal;
    while (cur !== -1 && this.stamp[cur] === gen) {
      const x = cur % this.width;
      const z = (cur - x) / this.width;
      out.push({ x: x + 0.5, z: z + 0.5 });
      const prev = this.cameFrom[cur];
      if (prev === cur) break;
      cur = prev;
    }
    out.reverse();
    out.shift();                       // drop the tile we are already standing on
    return this.smooth(out);
  }

  /**
   * String-pulling: drop waypoints that can be skipped with a clear straight
   * line. Without it units visibly staircase along the grid diagonals.
   */
  private smooth(path: PathNode[]): PathNode[] {
    if (path.length <= 2) return path;
    const out: PathNode[] = [];
    let anchor = 0;
    for (let i = 2; i < path.length; i++) {
      if (!this.lineClear(path[anchor], path[i])) {
        out.push(path[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(path[path.length - 1]);
    return out;
  }

  /** Public line-of-sight test, for validating any segment before walking it. */
  isLineClear(x1: number, z1: number, x2: number, z2: number): boolean {
    return this.lineClear({ x: x1, z: z1 }, { x: x2, z: z2 });
  }

  /**
   * Line-of-sight between two points.
   *
   * Sampled densely and with a half-tile margin on each side. The raw A* path
   * never enters a blocked tile, so any wall a unit walks through comes from
   * smoothing shaving a corner -- a sparse sample happily jumps the diagonal
   * gap at a building's edge.
   */
  private lineClear(a: PathNode, b: PathNode): boolean {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(2, Math.ceil(len * 8));
    const nx = -dz / (len || 1), nz = dx / (len || 1);   // perpendicular
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      for (const off of LOS_OFFSETS) {
        if (this.isBlocked(Math.floor(px + nx * off), Math.floor(pz + nz * off))) {
          return false;
        }
      }
    }
    return true;
  }
}
