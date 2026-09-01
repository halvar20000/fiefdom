import { BUILDINGS, storeOf } from './defs';
import type { PathNode } from './pathfind';

/**
 * Visible operators for the rival lords.
 *
 * The lord's economy is real and runs on his building counts and per-building
 * `staff` (see `Lord`), but his labour was only ever a headcount -- his mills
 * and quarries stood worked by nobody. This puts a body on every one of those
 * jobs and walks it between the workplace and the nearest of the lord's own
 * stores, so his castle looks worked and, more to the point, so that razing a
 * building visibly turns its people out and stops the traffic through it.
 *
 * Deliberately a REPRESENTATION, not a second economy: production is still the
 * lord's to compute. A figure here tracks a real staffed job -- destroy the
 * building and the figure leaves with it -- but it does not itself carry the
 * good that gets counted. Making the haul physical (so blocking a path, not
 * only felling a building, starves him) is the next slice; this one makes the
 * economy that already exists something you can watch and target.
 */

/** The shape of a rival building this needs -- a subset of the world's own. */
export interface EWBuilding {
  name: string;
  x: number;
  z: number;
  /** Workers the lord has assigned. The source of truth for how many figures. */
  staff: number;
}

/** A rival, as far as its workforce is concerned. */
export interface EWFaction {
  id: number;
  buildings: EWBuilding[];
  defeated: boolean;
}

export interface EnemyWorkerWorld {
  findPath(fromX: number, fromZ: number, toX: number, toZ: number): PathNode[] | null;
  isWalkable(x: number, z: number): boolean;
  /** Pace multiplier for the ground under a point, 1 on firm going. */
  groundSpeed?(x: number, z: number, siege: boolean): number;
}

type EState = 'work' | 'toStore' | 'back';

export interface EnemyWorker {
  id: number;
  side: number;
  x: number;
  z: number;
  heading: number;
  phase: number;
  speed: number;
  /** The building this figure belongs to. Null once it has been razed. */
  b: EWBuilding | null;
  state: EState;
  timer: number;
  tx: number;
  tz: number;
  path: PathNode[];
  carrying: boolean;
  /** The work animation for this job, e.g. a woodcutter's chop. */
  workClip: string;
  /** A labourer, not a soldier -- soft, and unarmed. */
  hp: number;
}

/** How much a labourer can take before he falls. A few arrows, no more. */
export const WORKER_HP = 18;

/** Never spend more than this on animating other men's servants. */
const MAX_WORKERS = 80;

export class EnemyWorkers {
  workers: EnemyWorker[] = [];
  private nextId = 1;

  constructor(private world: EnemyWorkerWorld) {}

  /**
   * Reconcile figures against every rival's staffed, producing buildings.
   *
   * Called whenever the rivals' buildings or staffing may have changed. A job
   * that has lost its building (razed, so no longer in the faction list) or its
   * staff drops the figure; a job that has gained staff grows one.
   */
  sync(factions: EWFaction[]): void {
    const live = new Set<EWBuilding>();
    for (const f of factions) if (!f.defeated) for (const b of f.buildings) live.add(b);

    // Drop figures whose building is gone.
    for (const w of this.workers) if (w.b && !live.has(w.b)) w.b = null;
    this.workers = this.workers.filter(w => w.b !== null);

    // Trim any building down to its staff, then grow the short ones.
    const have = new Map<EWBuilding, number>();
    for (const w of this.workers) have.set(w.b!, (have.get(w.b!) ?? 0) + 1);
    for (const [b, n] of have) {
      if (n <= b.staff) continue;
      let drop = n - b.staff;
      for (let i = this.workers.length - 1; i >= 0 && drop > 0; i--) {
        if (this.workers[i].b === b) { this.workers.splice(i, 1); drop--; }
      }
    }

    if (this.workers.length >= MAX_WORKERS) return;
    for (const f of factions) {
      if (f.defeated) continue;
      for (const b of f.buildings) {
        const def = BUILDINGS[b.name];
        // Only jobs that a body would actually stand in: a building the lord
        // works, staffed. Hovels, walls and empty stores get nobody.
        if (!def || !def.workers || !def.produces) continue;
        let n = 0;
        for (const w of this.workers) if (w.b === b) n++;
        while (n < b.staff && this.workers.length < MAX_WORKERS) {
          this.workers.push({
            id: this.nextId++, side: f.id,
            x: b.x + 0.5, z: b.z + 0.5, heading: 0, phase: Math.random() * 10,
            speed: 1.4 + Math.random() * 0.4,
            b, state: 'work', timer: Math.random() * 2,
            tx: b.x + 0.5, tz: b.z + 0.5, path: [], carrying: false,
            workClip: def.workClip ?? 'dig', hp: WORKER_HP,
          });
          n++;
        }
      }
    }
  }

  /** Take a fallen labourer off the map. His building is left to the lord. */
  remove(w: EnemyWorker): void {
    const i = this.workers.indexOf(w);
    if (i >= 0) this.workers.splice(i, 1);
  }

  /** Nearest of the lord's own stores of the right kind, as an approach point. */
  private storeFor(w: EnemyWorker, factions: EWFaction[]): { x: number; z: number } | null {
    const b = w.b!;
    const def = BUILDINGS[b.name];
    const kind = def.produces ? storeOf(def.produces.output) : 'stockpile';
    const mine = factions.find(f => f.id === w.side);
    if (!mine) return null;
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (const s of mine.buildings) {
      if (s.name !== kind) continue;
      const d = (s.x - b.x) ** 2 + (s.z - b.z) ** 2;
      if (d < bestD) { bestD = d; best = this.approach(s); }
    }
    return best;
  }

  /** A walkable tile just outside a building, to stand on when visiting it. */
  private approach(b: EWBuilding): { x: number; z: number } {
    const [w, d] = BUILDINGS[b.name].footprint;
    for (let r = 1; r <= 3; r++) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const x = b.x + w / 2 + Math.cos(a) * (Math.max(w, d) / 2 + r);
        const z = b.z + d / 2 + Math.sin(a) * (Math.max(w, d) / 2 + r);
        if (this.world.isWalkable(x, z)) return { x, z };
      }
    }
    return { x: b.x + w / 2, z: b.z + d / 2 };
  }

  private goTo(w: EnemyWorker, x: number, z: number, next: EState): void {
    const route = this.world.findPath(w.x, w.z, x, z);
    if (!route) { w.state = 'work'; w.timer = 2 + Math.random() * 2; return; }
    w.path = route.slice();
    w.tx = x; w.tz = z; w.state = next;
  }

  /** Advance along the path. Returns true on arrival. Mirrors WorkerPool. */
  private arrive(w: EnemyWorker, dt: number): boolean {
    let budget = w.speed * (this.world.groundSpeed?.(w.x, w.z, false) ?? 1) * dt;
    w.phase += dt;
    while (budget > 0) {
      const wp = w.path.length ? w.path[0] : { x: w.tx, z: w.tz };
      const dx = wp.x - w.x, dz = wp.z - w.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.06) {
        if (w.path.length) { w.path.shift(); continue; }
        return true;
      }
      w.heading = Math.atan2(dz, dx);
      if (d <= budget) {
        w.x = wp.x; w.z = wp.z; budget -= d;
        if (w.path.length) w.path.shift(); else return true;
      } else {
        w.x += (dx / d) * budget; w.z += (dz / d) * budget; budget = 0;
      }
    }
    return !w.path.length && Math.hypot(w.tx - w.x, w.tz - w.z) < 0.12;
  }

  update(dt: number, factions: EWFaction[]): void {
    for (const w of this.workers) {
      const b = w.b;
      if (!b) continue;
      switch (w.state) {
        case 'work': {
          w.timer -= dt;
          w.phase += dt;              // the work clip advances while standing
          if (w.timer > 0) break;
          const store = this.storeFor(w, factions);
          if (!store) { w.timer = 3; break; }   // nowhere to carry to yet
          w.carrying = true;
          this.goTo(w, store.x, store.z, 'toStore');
          break;
        }
        case 'toStore': {
          if (!this.arrive(w, dt)) break;
          w.carrying = false;
          const home = this.approach(b);
          this.goTo(w, home.x, home.z, 'back');
          break;
        }
        case 'back': {
          if (!this.arrive(w, dt)) break;
          w.state = 'work';
          w.timer = 1.5 + Math.random() * 2.5;
          break;
        }
      }
    }
  }

  private moving(w: EnemyWorker): boolean {
    return w.state === 'toStore' || w.state === 'back';
  }

  /** Which animation to draw this figure with -- the same clips the player uses. */
  clipFor(w: EnemyWorker): string {
    if (w.carrying) return 'carry';
    if (this.moving(w)) return 'walk';
    if (w.state === 'work') return w.workClip;
    return 'idle';
  }
}
