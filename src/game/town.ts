/**
 * Idle people with a job for the moment: moat-diggers and firefighters.
 *
 * Both come out of `state.idle` the way a recruit does -- the campfire
 * shrinks while they are out and fills again when they come home -- and
 * neither is a worker in the staffing sense: nothing employs them, a building
 * on fire or a ditch marked out simply calls for hands and the nearest idle
 * ones answer. Kept out of main.ts so what a digger or a bucket-carrier does
 * is one readable loop rather than another branch of the renderer's update.
 *
 * Movement is the wanderers' scheme: a tile route from the pathfinder, walked
 * waypoint to waypoint, with a final leg to the exact spot.
 */

import {
  DOUSE_SECONDS, MAX_FIREFIGHTERS, MAX_MOAT_DIGGERS, MOAT_DIG_SECONDS,
} from './defs';
import type { GameState, PlacedBuilding } from './state';
import type { PathNode } from './pathfind';

export interface TownJob {
  kind: 'dig' | 'douse';
  x: number; z: number; tx: number; tz: number;
  heading: number; phase: number; moving: boolean;
  path: PathNode[];
  /** Seconds of work left at the spot. */
  timer: number;
  /** The building being dug or drowned. */
  buildingId: number;
  stage: 'toWater' | 'toWork' | 'working' | 'home';
}

export interface TownWorld {
  findPath(fromX: number, fromZ: number, toX: number, toZ: number): PathNode[] | null;
  isBlocked(x: number, z: number): boolean;
  nearestOpen(x: number, z: number, radius: number): PathNode | null;
  /** Where a new hand steps out from: an idle figure's spot by the fire. */
  spawn(): { x: number; z: number };
  home(): { x: number; z: number };
  /** A moat tile has become water. */
  onDug(b: PlacedBuilding): void;
  /** A fire is out. */
  onDoused(b: PlacedBuilding): void;
  notify(text: string, kind: 'info' | 'warn'): void;
}

/** A man with a job walks a little faster than one strolling to the fire. */
const JOB_SPEED = 1.15;

export class TownWork {
  readonly jobs: TownJob[] = [];
  /** Said once per fire season, not once per burning building per tick. */
  private warnedNoWell = 0;

  constructor(private state: GameState, private world: TownWorld) {}

  /** The clip a job draws: a spade at work, a bucket on the way to a fire. */
  static clipOf(j: TownJob): string {
    if (j.stage === 'working') return j.kind === 'dig' ? 'dig' : 'carry';
    if (j.kind === 'douse' && j.stage === 'toWork') return 'carry';
    return j.moving ? 'walk' : 'idle';
  }

  private go(j: TownJob, x: number, z: number, stage: TownJob['stage']): void {
    j.tx = x; j.tz = z; j.stage = stage; j.moving = true;
    const route = this.world.findPath(Math.floor(j.x), Math.floor(j.z),
                                      Math.floor(x), Math.floor(z));
    j.path = route ? route.slice() : [];
  }

  /** Back to the campfire, and the idle count, when he arrives. */
  private sendHome(j: TownJob): void {
    const h = this.world.home();
    this.go(j, h.x, h.z, 'home');
  }

  private finish(j: TownJob): void {
    this.state.idle += 1;
    const i = this.jobs.indexOf(j);
    if (i >= 0) this.jobs.splice(i, 1);
  }

  private building(id: number): PlacedBuilding | undefined {
    return this.state.buildings.find(b => b.id === id);
  }

  /** A spot to stand on beside a footprint, nearest to (px, pz). */
  private standBeside(b: PlacedBuilding, px: number, pz: number): PathNode | null {
    const [w, d] = b.def.footprint;
    const cx = Math.max(b.x, Math.min(Math.floor(px), b.x + w - 1));
    const cz = Math.max(b.z, Math.min(Math.floor(pz), b.z + d - 1));
    // The ring of tiles around the footprint, nearest first.
    let best: PathNode | null = null, bestD = Infinity;
    for (let z = b.z - 1; z <= b.z + d; z++) {
      for (let x = b.x - 1; x <= b.x + w; x++) {
        const inside = x >= b.x && x < b.x + w && z >= b.z && z < b.z + d;
        if (inside || this.world.isBlocked(x, z)) continue;
        const dist = Math.hypot(x - cx, z - cz);
        if (dist < bestD) { bestD = dist; best = { x, z }; }
      }
    }
    return best;
  }

  /** The nearest well to a point, as a place to fill a bucket beside it. */
  private nearestWell(px: number, pz: number): { well: PlacedBuilding; at: PathNode } | null {
    let best: { well: PlacedBuilding; at: PathNode } | null = null, bestD = Infinity;
    for (const b of this.state.buildings) {
      if (b.name !== 'well') continue;
      const [w, d] = b.def.footprint;
      const dist = Math.hypot(b.x + w / 2 - px, b.z + d / 2 - pz);
      if (dist >= bestD) continue;
      const at = this.standBeside(b, px, pz);
      if (!at) continue;
      bestD = dist; best = { well: b, at };
    }
    return best;
  }

  /** Fires nobody is on the way to, nearest to a point first. */
  private unclaimedFires(px: number, pz: number, except?: TownJob): PlacedBuilding[] {
    const claimed = new Set(this.jobs
      .filter(j => j !== except && j.kind === 'douse' && j.stage !== 'home')
      .map(j => j.buildingId));
    return this.state.buildings
      .filter(b => (b.ablaze ?? 0) > 0 && !claimed.has(b.id))
      .sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz));
  }

  private unclaimedMarks(px: number, pz: number, except?: TownJob): PlacedBuilding[] {
    const claimed = new Set(this.jobs
      .filter(j => j !== except && j.kind === 'dig' && j.stage !== 'home')
      .map(j => j.buildingId));
    return this.state.buildings
      .filter(b => b.name === 'moat' && b.undug && !claimed.has(b.id))
      .sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz));
  }

  /** Point a firefighter at a burning building: water first, then the fire. */
  private assignFire(j: TownJob, b: PlacedBuilding): boolean {
    const water = this.nearestWell(b.x, b.z);
    if (!water) return false;
    j.buildingId = b.id;
    j.timer = DOUSE_SECONDS;
    this.go(j, water.at.x + 0.5, water.at.z + 0.5, 'toWater');
    return true;
  }

  private assignMark(j: TownJob, b: PlacedBuilding): void {
    j.buildingId = b.id;
    j.timer = MOAT_DIG_SECONDS;
    this.go(j, b.x + 0.5, b.z + 0.5, 'toWork');
  }

  private out(kind: TownJob['kind']): number {
    return this.jobs.filter(j => j.kind === kind && j.stage !== 'home').length;
  }

  update(dt: number): void {
    // Jobs whose reason has gone: the fire is out, the tile was dug by
    // someone else, the building fell. Go home rather than stand at nothing.
    for (const j of this.jobs) {
      if (j.stage === 'home') continue;
      const b = this.building(j.buildingId);
      const gone = !b || (j.kind === 'dig' ? !b.undug : !(b.ablaze ?? 0));
      if (gone) this.sendHome(j);
    }

    // New hands, from the campfire.
    const home = this.world.home();
    const fires = this.unclaimedFires(home.x, home.z);
    while (fires.length && this.state.idle > 0 && this.out('douse') < MAX_FIREFIGHTERS) {
      const b = fires.shift()!;
      const spawn = this.world.spawn();
      const j: TownJob = {
        kind: 'douse', x: spawn.x, z: spawn.z, tx: spawn.x, tz: spawn.z,
        heading: 0, phase: Math.random() * 10, moving: false, path: [],
        timer: DOUSE_SECONDS, buildingId: b.id, stage: 'toWater',
      };
      if (!this.assignFire(j, b)) {
        // Once, and then let it burn: the message is the whole answer.
        if (this.state.elapsed - this.warnedNoWell > 30) {
          this.warnedNoWell = this.state.elapsed;
          this.world.notify('Your people have no water to fight the fire — build a well',
                            'warn');
        }
        break;
      }
      this.state.idle -= 1;
      this.jobs.push(j);
    }
    const marks = this.unclaimedMarks(home.x, home.z);
    while (marks.length && this.state.idle > 0 && this.out('dig') < MAX_MOAT_DIGGERS) {
      const b = marks.shift()!;
      const spawn = this.world.spawn();
      const j: TownJob = {
        kind: 'dig', x: spawn.x, z: spawn.z, tx: spawn.x, tz: spawn.z,
        heading: 0, phase: Math.random() * 10, moving: false, path: [],
        timer: MOAT_DIG_SECONDS, buildingId: b.id, stage: 'toWork',
      };
      this.assignMark(j, b);
      this.state.idle -= 1;
      this.jobs.push(j);
    }

    const done: TownJob[] = [];
    for (const j of this.jobs) {
      j.phase += dt;

      if (j.stage === 'working') {
        j.moving = false;
        j.timer -= dt;
        if (j.timer > 0) continue;
        const b = this.building(j.buildingId);
        if (j.kind === 'dig') {
          if (b && b.undug) {
            b.undug = false;
            this.world.onDug(b);
            // He was standing in it. Out, before the water is under him.
            const open = this.world.nearestOpen(Math.floor(j.x), Math.floor(j.z), 4);
            if (open) { j.x = open.x + 0.5; j.z = open.z + 0.5; }
          }
          const next = this.unclaimedMarks(j.x, j.z, j)[0];
          if (next) this.assignMark(j, next);
          else this.sendHome(j);
        } else {
          if (b && (b.ablaze ?? 0) > 0) this.world.onDoused(b);
          const next = this.unclaimedFires(j.x, j.z, j)[0];
          if (!next || !this.assignFire(j, next)) this.sendHome(j);
        }
        continue;
      }

      if (!j.moving) continue;
      let budget = JOB_SPEED * dt;
      while (budget > 0) {
        const wp = j.path.length ? j.path[0] : { x: j.tx, z: j.tz };
        const dx = wp.x - j.x, dz = wp.z - j.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.08) {
          if (j.path.length) { j.path.shift(); continue; }
          j.moving = false;
          if (j.stage === 'home') { done.push(j); break; }
          if (j.stage === 'toWater') {
            // Bucket full: now to the fire, and stand beside it.
            const b = this.building(j.buildingId);
            const at = b ? this.standBeside(b, j.x, j.z) : null;
            if (!b || !at) { this.sendHome(j); break; }
            this.go(j, at.x + 0.5, at.z + 0.5, 'toWork');
            break;
          }
          j.stage = 'working';
          break;
        }
        j.heading = Math.atan2(dz, dx);
        const step = Math.min(budget, dist);
        j.x += (dx / dist) * step;
        j.z += (dz / dist) * step;
        budget -= step;
      }
    }
    for (const j of done) this.finish(j);
  }
}
