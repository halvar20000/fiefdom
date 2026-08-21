import type { GameState, PlacedBuilding } from './state';
import { isFood, DEPOT_BATCH, type Resource } from './defs';
import type { PathNode } from './pathfind';

export type WorkerState =
  | 'idle'        // standing at home, nothing to do
  | 'toFetch'     // walking to a store to collect inputs
  | 'returning'   // walking back to the workplace, possibly with inputs
  | 'toWork'      // walking out to the work spot (tree, rock face, field)
  | 'working'     // producing
  | 'toStore';    // carrying output to stockpile or granary

export interface Worker {
  id: number;
  x: number;
  z: number;
  heading: number;
  /** Animation phase, advanced only while actually moving. */
  phase: number;
  speed: number;

  building: PlacedBuilding | null;
  state: WorkerState;
  timer: number;
  tx: number;
  tz: number;
  carrying: Resource | null;
  carryAmount: number;
  /** Which of its building's work spots this worker uses. */
  slot: number;
  /** Index into the world's scatter list of the thing being worked, if any. */
  claim: number | null;
  /**
   * Id of the animal a hunter has marked, if any.
   *
   * Kept separate from `claim` rather than overloaded onto it: one indexes the
   * static scatter list, the other a live herd whose members come and go, and
   * a single field would silently mean two different things per job type.
   */
  prey: number | null;
  /** Remaining waypoints to the current destination. */
  path: PathNode[];
  /**
   * Where this load is being taken.
   *
   * Needed because a producer's output no longer has one destination: it goes
   * to the real store, or to a storehouse if one is nearer, and the arrival
   * handler has to know which -- one adds to the town's stock, the other to a
   * building's own pile.
   */
  dropAt: PlacedBuilding | null;
}

/** Everything a relay is holding, all kinds together. */
export function totalHeld(b: PlacedBuilding): number {
  let n = 0;
  for (const v of Object.values(b.held)) n += v ?? 0;
  return n;
}

export interface WorkerWorld {
  heightAt(x: number, z: number): number;
  /** Nearest store building of the given kind, or null if none exists. */
  nearestStore(kind: 'stockpile' | 'granary', x: number, z: number): PlacedBuilding | null;
  /**
   * Where this worker goes to do its job.
   *
   * Takes the worker, not just a slot index, so jobs tied to a thing on the map
   * can reserve it -- otherwise every woodcutter walks to the same nearest tree
   * and they pile up on one trunk.
   */
  workSpot(b: PlacedBuilding, w: Worker): { x: number; z: number } | null;
  /** Is there an ox tether close enough to haul for this building? */
  haulerNear(b: PlacedBuilding): boolean;
  /**
   * Where a load of this good should be taken from here: the real store, or a
   * storehouse if one is nearer and has room.
   */
  nearestDrop(
    kind: 'stockpile' | 'granary', x: number, z: number,
  ): PlacedBuilding | null;
  /** A production cycle finished -- consume whatever was being worked. */
  harvest(b: PlacedBuilding, w: Worker): void;
  /** Route around buildings. Null means no route exists. */
  findPath(fromX: number, fromZ: number, toX: number, toZ: number): PathNode[] | null;
  /** Pace multiplier for the ground under a point, 1 on firm going. */
  groundSpeed?(x: number, z: number, siege: boolean): number;
  /**
   * Where to stand when visiting a building.
   *
   * Deliberately just OUTSIDE the footprint. Routing to the centre would send
   * every worker through a wall on the last leg of every journey, which is the
   * whole reason they appeared to ignore buildings.
   */
  approach(b: PlacedBuilding, fromX: number, fromZ: number): { x: number; z: number };
  /** Can a unit stand here? */
  isWalkable(x: number, z: number): boolean;
  /** Is the straight segment between two points free of buildings? */
  lineClear(x1: number, z1: number, x2: number, z2: number): boolean;
  /** Nothing to work on right now (no tree in range, etc). */
  releaseClaim(w: Worker): void;
}

/**
 * Worker agents.
 *
 * Movement is straight-line rather than pathfound. Buildings are sparse and
 * convex, so workers rarely have anything to walk around, and a proper A* over
 * a 200x200 grid is work better spent once walls exist to block them.
 */
export class WorkerPool {
  workers: Worker[] = [];
  private nextId = 1;

  constructor(private world: WorkerWorld, private state: GameState) {}

  /** Reconcile the worker list against building staffing. */
  sync(): void {
    // release workers whose building is gone or over-staffed
    const counts = new Map<number, number>();
    for (const w of this.workers) {
      if (!w.building) continue;
      if (!this.state.buildings.includes(w.building)) { w.building = null; continue; }
      const n = (counts.get(w.building.id) ?? 0) + 1;
      counts.set(w.building.id, n);
      if (n > w.building.staff) w.building = null;
    }
    for (const w of this.workers) {
      if (w.building === null && w.claim !== null) this.world.releaseClaim(w);
    }
    this.workers = this.workers.filter(w => w.building !== null || w.state === 'idle');

    // staff buildings that are short
    for (const b of this.state.buildings) {
      let have = 0;
      for (const w of this.workers) if (w.building === b) have++;
      while (have < b.staff) {
        const c = this.world.approach(b, b.x, b.z);
        this.workers.push({
          id: this.nextId++,
          x: c.x, z: c.z, heading: 0, phase: Math.random() * 10,
          // Tiles per second. At the original 0.85 a farm 18 tiles from the
          // stockpile spent ~42s of every 55s cycle walking, so buildings
          // looked broken rather than slow.
          speed: 1.55 + Math.random() * 0.4,
          building: b, state: 'idle', timer: 0.5 + Math.random(),
          tx: c.x, tz: c.z, carrying: null, carryAmount: 0, slot: have,
          claim: null, prey: null, path: [], dropAt: null,
        });
        have++;
      }
    }
  }

  private goTo(w: Worker, x: number, z: number, next: WorkerState): void {
    w.tx = x; w.tz = z; w.state = next;
    const route = this.world.findPath(w.x, w.z, x, z);
    if (!route) {
      // Genuinely unreachable -- usually the destination is sealed inside a
      // courtyard. Waiting and retrying is right; the old straight-line
      // fallback is exactly what made workers walk through buildings.
      w.path = [];
      w.tx = w.x; w.tz = w.z;
      w.state = 'idle';
      w.timer = 3;
      this.state.notify(`${w.building?.def.label ?? 'A worker'} cannot reach its work`, 'warn');
      return;
    }
    w.path = route.slice();

    // Land exactly on the destination rather than on a tile centre -- but only
    // by APPENDING it, and only if that last hop is actually clear.
    //
    // Replacing the final waypoint (the previous approach) silently created a
    // segment nothing had validated: A* would route neatly around a granary and
    // the override then drew the last leg straight through it.
    const tail = w.path.length ? w.path[w.path.length - 1] : { x: w.x, z: w.z };
    if (this.world.isWalkable(x, z)
        && (Math.abs(tail.x - x) > 1e-6 || Math.abs(tail.z - z) > 1e-6)
        && this.world.lineClear(tail.x, tail.z, x, z)) {
      w.path.push({ x, z });
    } else {
      w.tx = tail.x; w.tz = tail.z;
    }
  }

  /**
   * Advance along the current path. Returns true on arrival.
   *
   * Workers steer toward the next waypoint rather than the final destination,
   * which is what keeps them out of the buildings they used to walk through.
   */
  private arrive(w: Worker, dt: number): boolean {
    // Peasants wade too. A marsh across the route to a woodcutter is a real
    // economic cost, not only a military one.
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
        w.x = wp.x; w.z = wp.z;
        budget -= d;
        if (w.path.length) w.path.shift();
        else return true;
      } else {
        w.x += (dx / d) * budget;
        w.z += (dz / d) * budget;
        budget = 0;
      }
    }
    return !w.path.length && Math.hypot(w.tx - w.x, w.tz - w.z) < 0.12;
  }

  update(dt: number): void {
    for (const w of this.workers) {
      const b = w.building;
      if (!b) { w.state = 'idle'; continue; }
      if (b.def.relay) {
        this.updateRelay(w, b, dt);
        continue;
      }
      if (b.def.stocks && !b.def.produces) {
        this.updateStocker(w, b, b.def.stocks, dt);
        continue;
      }
      const prod = b.def.produces;
      if (!prod) { w.state = 'idle'; continue; }

      switch (w.state) {
        case 'idle': {
          w.timer -= dt;
          if (w.timer > 0) break;

          // A quarry with no ox tether in range has nowhere to put its stone.
          if (b.def.needsHauler && !this.world.haulerNear(b)) {
            w.timer = 2;
            this.state.notify(`${b.def.label} needs an ox tether nearby`, 'warn');
            break;
          }

          // Do not begin a cycle whose output has nowhere to go.
          //
          // Without this the workshop keeps working, walks the load to a full
          // store and spills it -- labour and inputs burned every cycle. Worse,
          // the player sees the DOWNSTREAM workshop "waiting for materials"
          // (the bakery, when it is really the mill that cannot store flour)
          // and has no way to trace that back to the store being full.
          const outStore = isFood(prod.output) ? 'granary' : 'stockpile';
          if (this.state.hasStore(outStore)
              && this.state.roomFor(prod.output) < prod.amount) {
            w.timer = 3;
            this.state.notify(
              `${outStore === 'granary' ? 'The granary' : 'The stockpile'} is full` +
              ` — ${b.def.label} has stopped`, 'warn');
            break;
          }

          if (prod.inputs) {
            const missing = Object.entries(prod.inputs).find(
              ([r, n]) => (b.held[r as Resource] ?? 0) < (n ?? 0));
            if (missing) {
              const store = this.world.nearestStore('stockpile', w.x, w.z);
              if (!store) {
                w.timer = 3;
                this.state.notify(`${b.def.label} has no stockpile to draw from`, 'warn');
                break;
              }
              // Only set off if the goods are actually there. Without this the
              // worker walks to the stockpile, finds it empty, walks home and
              // immediately repeats -- an endless there-and-back that reads as
              // a bug to anyone watching, and burns the trip for nothing.
              const short = Object.entries(prod.inputs).find(
                ([r, n]) => this.state.stock[r as Resource] < (n ?? 0));
              if (short) {
                w.timer = 2.5;
                this.state.notify(`${b.def.label} is waiting for materials`, 'warn');
                break;
              }
              const c = this.world.approach(store, w.x, w.z);
              this.goTo(w, c.x, c.z, 'toFetch');
              break;
            }
          }
          const spot = this.world.workSpot(b, w);
          if (!spot) {
            // nothing to work on -- wait rather than mime the job at thin air
            w.timer = 2.5;
            break;
          }
          this.goTo(w, spot.x, spot.z, 'toWork');
          break;
        }

        case 'toFetch': {
          if (!this.arrive(w, dt)) break;

          let took = true;
          for (const [r, n] of Object.entries(prod.inputs ?? {})) {
            const res = r as Resource;
            const have = this.state.stock[res];
            if (have < (n ?? 0)) { took = false; break; }
          }
          if (took) {
            for (const [r, n] of Object.entries(prod.inputs ?? {})) {
              const res = r as Resource;
              this.state.consume(res, n ?? 0);
              b.held[res] = (b.held[res] ?? 0) + (n ?? 0);
            }
          } else {
            this.state.notify(`${b.def.label} is waiting for materials`, 'warn');
          }
          const c = this.world.approach(b, w.x, w.z);
          this.goTo(w, c.x, c.z, 'returning');
          break;
        }

        case 'returning': {
          if (!this.arrive(w, dt)) break;
          if (w.carrying && b.def.stocks) {
            b.held[w.carrying] = (b.held[w.carrying] ?? 0) + w.carryAmount;
            w.carrying = null;
            w.carryAmount = 0;
          }
          w.state = 'idle';
          w.timer = 0.2;
          break;
        }

        case 'toWork': {
          if (!this.arrive(w, dt)) break;
          w.state = 'working';
          w.timer = prod.seconds;
          break;
        }

        case 'working': {
          w.timer -= dt;
          w.phase += dt;   // the work animation needs to advance too
          if (w.timer > 0) break;
          if (prod.inputs) {
            for (const [r, n] of Object.entries(prod.inputs)) {
              const res = r as Resource;
              b.held[res] = Math.max(0, (b.held[res] ?? 0) - (n ?? 0));
            }
          }
          // the tree comes down here, so the wood visibly came from somewhere
          this.world.harvest(b, w);
          w.carrying = prod.output;
          w.carryAmount = prod.amount;
          const kind = isFood(prod.output) ? 'granary' : 'stockpile';
          const store = this.world.nearestDrop(kind, w.x, w.z);
          if (!store) {
            this.state.notify(
              kind === 'granary'
                ? 'You need a granary to store food'
                : 'You need a stockpile to store goods', 'warn');
            w.carrying = null;
            w.state = 'idle';
            w.timer = 3;
            break;
          }
          w.dropAt = store;
          const c = this.world.approach(store, w.x, w.z);
          this.goTo(w, c.x, c.z, 'toStore');
          break;
        }

        case 'toStore': {
          if (!this.arrive(w, dt)) break;
          if (w.carrying) {
            const relay = w.dropAt?.def.relay;
            if (relay) {
              // Into the shed's own pile, not the town's stock. It only
              // counts as stored once the carrier has walked it in.
              const t = w.dropAt!;
              const room = relay - totalHeld(t);
              const put = Math.min(w.carryAmount, room);
              if (put > 0) t.held[w.carrying] = (t.held[w.carrying] ?? 0) + put;
            } else {
              this.state.deposit(w.carrying, w.carryAmount);
            }
            w.carrying = null;
            w.carryAmount = 0;
            w.dropAt = null;
          }
          const c = this.world.approach(b, w.x, w.z);
          this.goTo(w, c.x, c.z, 'returning');
          break;
        }
      }
    }
  }

  /**
   * A building that keeps a stock on the premises rather than producing.
   *
   * The inn's drayman: walk to the stockpile, load barrels, carry them back.
   * Deliberately a real journey -- the ale has to arrive before anyone can
   * drink it, and watching it arrive is half the point.
   */
  private updateStocker(
    w: Worker, b: PlacedBuilding,
    stocks: { resource: Resource; capacity: number; batch: number },
    dt: number,
  ): void {
    switch (w.state) {
      case 'idle': {
        w.timer -= dt;
        if (w.timer > 0) return;

        const held = b.held[stocks.resource] ?? 0;
        if (held >= stocks.capacity) { w.timer = 3; return; }
        if (this.state.stock[stocks.resource] <= 0) {
          w.timer = 4;
          this.state.notify(`${b.def.label} has no ale to fetch`, 'warn');
          return;
        }
        const src = this.world.nearestStore('stockpile', w.x, w.z);
        if (!src) {
          w.timer = 4;
          this.state.notify(`${b.def.label} has no stockpile to draw from`, 'warn');
          return;
        }
        const c = this.world.approach(src, w.x, w.z);
        this.goTo(w, c.x, c.z, 'toFetch');
        return;
      }

      case 'toFetch': {
        if (!this.arrive(w, dt)) return;
        const room = stocks.capacity - (b.held[stocks.resource] ?? 0);
        const n = Math.min(stocks.batch, room, this.state.stock[stocks.resource]);
        if (n > 0) {
          this.state.stock[stocks.resource] -= n;
          w.carrying = stocks.resource;
          w.carryAmount = n;
        }
        const home = this.world.approach(b, w.x, w.z);
        this.goTo(w, home.x, home.z, 'returning');
        return;
      }

      case 'returning': {
        if (!this.arrive(w, dt)) return;
        if (w.carrying) {
          b.held[w.carrying] = (b.held[w.carrying] ?? 0) + w.carryAmount;
          w.carrying = null;
          w.carryAmount = 0;
        }
        w.state = 'idle';
        w.timer = 0.4;
        return;
      }

      default:
        w.state = 'idle';
        w.timer = 0.4;
    }
  }

  /**
   * The storehouse carrier.
   *
   * Waits until there is something worth a trip, then takes the largest single
   * kind -- one good per journey, because a man carries one thing, and because
   * mixing kinds would mean deciding what to do when the stockpile has room
   * for the stone but not the wood.
   *
   * It does NOT wait for a full load. A shed by a lone woodcutter would then
   * sit on four logs forever, which looks exactly like a bug.
   */
  private updateRelay(w: Worker, b: PlacedBuilding, dt: number): void {
    switch (w.state) {
      case 'idle': {
        w.timer -= dt;
        if (w.timer > 0) return;

        let best: Resource | null = null, most = 0;
        for (const [r, n] of Object.entries(b.held)) {
          if ((n ?? 0) > most) { most = n ?? 0; best = r as Resource; }
        }
        if (!best || most <= 0) { w.timer = 2; return; }

        const kind = isFood(best) ? 'granary' : 'stockpile';
        const store = this.world.nearestStore(kind, w.x, w.z);
        if (!store) {
          w.timer = 4;
          this.state.notify(
            kind === 'granary'
              ? 'The storehouse has no granary to deliver to'
              : 'The storehouse has no stockpile to deliver to', 'warn');
          return;
        }
        const take = Math.min(DEPOT_BATCH, most);
        b.held[best] = most - take;
        w.carrying = best;
        w.carryAmount = take;

        const c = this.world.approach(store, w.x, w.z);
        this.goTo(w, c.x, c.z, 'toStore');
        return;
      }

      case 'toStore': {
        if (!this.arrive(w, dt)) return;
        if (w.carrying) {
          // Anything the store had no room for goes back in the shed rather
          // than being spilled: the carrier is the one part of the chain that
          // can simply turn round and bring it home.
          const put = this.state.deposit(w.carrying, w.carryAmount);
          if (!put) b.held[w.carrying] = (b.held[w.carrying] ?? 0) + w.carryAmount;
          w.carrying = null;
          w.carryAmount = 0;
        }
        const home = this.world.approach(b, w.x, w.z);
        this.goTo(w, home.x, home.z, 'returning');
        return;
      }

      case 'returning': {
        if (!this.arrive(w, dt)) return;
        w.state = 'idle';
        w.timer = 0.4;
        return;
      }

      default:
        w.state = 'idle';
        w.timer = 0.4;
    }
  }

  /** Workers are drawn walking whenever they are between places. */
  isMoving(w: Worker): boolean {
    return w.state === 'toWork' || w.state === 'toStore'
        || w.state === 'toFetch' || w.state === 'returning';
  }

  /**
   * Which animation this worker should be drawn with.
   *
   * The distinction that carries the most: a labourer hauling a load walks
   * differently from one walking back empty-handed, and half the workforce is
   * doing one or the other at any moment.
   */
  clipFor(w: Worker): string {
    if (w.carrying) return 'carry';
    if (this.isMoving(w)) return 'walk';
    if (w.state === 'working') return w.building?.def.workClip ?? 'dig';
    return 'idle';
  }
}
