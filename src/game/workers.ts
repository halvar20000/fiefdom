import type { GameState, PlacedBuilding } from './state';
import {
  storeOf, STORE_LABELS, DEPOT_BATCH, DEPOT_CAPACITY, DEPOT_INPUT_STOCK,
  HAUL_YARD, productionOf,
  type Resource, type Store,
} from './defs';
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
  /**
   * The yard this hauler is going to empty.
   *
   * Separate from `dropAt` rather than reusing it for the outbound leg: one
   * is where a load is going and the other where it is coming from, and a
   * single field would mean two things on two different legs of the same
   * journey -- which is exactly the sort of overload `prey` was split out of
   * `claim` to avoid.
   */
  haulFrom: PlacedBuilding | null;
  /**
   * The good a storehouse carrier is walking to the store to COLLECT.
   *
   * A third field rather than setting `carrying` early, because `carrying` is
   * what the animation reads: a carrier setting off empty to fetch flour would
   * otherwise be drawn hauling a sack the whole way out.
   */
  restock: Resource | null;
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
  nearestStore(kind: Store, x: number, z: number): PlacedBuilding | null;
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
   * The fullest yard in range of this hauler that has something waiting.
   *
   * Fullest rather than nearest: the ox is the bottleneck, and the yard
   * closest to filling is the one that will stop its cutters first.
   */
  haulSource(b: PlacedBuilding, resource: Resource, range: number):
    PlacedBuilding | null;
  /**
   * Where a load of this good should be taken from here: the real store, or a
   * storehouse if one is nearer and has room.
   */
  nearestDrop(kind: Store, x: number, z: number): PlacedBuilding | null;
  /**
   * A storehouse near this workshop that is already holding everything one
   * cycle needs, or null.
   *
   * Only if it is NEARER than the store the worker would otherwise walk to:
   * a shed built beside the stockpile is not a reason to take a detour.
   */
  inputSource(
    b: PlacedBuilding, inputs: Partial<Record<Resource, number>>,
    x: number, z: number,
  ): PlacedBuilding | null;
  /**
   * What the staffed workshops around this storehouse eat.
   *
   * The shed has no setting to choose what it stocks: it looks at the workings
   * it stands in and holds what they consume. A shed with no workshop near it
   * is what it always was -- a drop-off, and nothing else.
   */
  relayDemand(b: PlacedBuilding): Set<Resource>;
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
          claim: null, prey: null, path: [], dropAt: null, haulFrom: null,
          restock: null,
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
      if (b.def.hauler) {
        this.updateHauler(w, b, b.def.hauler, dt);
        continue;
      }
      const prod = productionOf(b.def, b.alt);
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
          // And one whose yard is full has nowhere to put the next block:
          // the ox is not keeping up with what is being cut.
          if (b.def.needsHauler
              && (b.held[prod.output] ?? 0) >= HAUL_YARD) {
            w.timer = 2.5;
            this.state.notify(
              `${b.def.label} yard is full — the ox tether cannot keep up`, 'warn');
            break;
          }

          // Do not begin a cycle whose output has nowhere to go.
          //
          // Without this the workshop keeps working, walks the load to a full
          // store and spills it -- labour and inputs burned every cycle. Worse,
          // the player sees the DOWNSTREAM workshop "waiting for materials"
          // (the bakery, when it is really the mill that cannot store flour)
          // and has no way to trace that back to the store being full.
          const outStore = storeOf(prod.output);
          if (this.state.hasStore(outStore)
              && this.state.roomFor(prod.output) < prod.amount) {
            w.timer = 3;
            this.state.notify(
              `${STORE_LABELS[outStore]} is full — ${b.def.label} has stopped`, 'warn');
            break;
          }

          if (prod.inputs) {
            const missing = Object.entries(prod.inputs).find(
              ([r, n]) => (b.held[r as Resource] ?? 0) < (n ?? 0));
            if (missing) {
              // A storehouse standing in the workings can supply the cycle
              // itself, which is the other half of what the shed is for: it
              // took the walk off a distant PRODUCER from the day it was
              // built, and left a distant consumer -- a mill out by the wheat,
              // a bakery out by the mill -- walking to the yard for every
              // load. Checked before the store because it is only ever
              // returned when it is the shorter journey.
              const shed = this.world.inputSource(b, prod.inputs, w.x, w.z);
              if (shed) {
                w.haulFrom = shed;
                const c = this.world.approach(shed, w.x, w.z);
                this.goTo(w, c.x, c.z, 'toFetch');
                break;
              }
              w.haulFrom = null;
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

          // Which shed this trip was for, if any -- read once and cleared, so
          // the next cycle starts by asking again rather than inheriting a
          // shed that has since been emptied by the workshop next door.
          const shed = w.haulFrom;
          w.haulFrom = null;

          let took = true;
          for (const [r, n] of Object.entries(prod.inputs ?? {})) {
            const res = r as Resource;
            const have = shed ? (shed.held[res] ?? 0) : this.state.stock[res];
            if (have < (n ?? 0)) { took = false; break; }
          }
          if (took) {
            for (const [r, n] of Object.entries(prod.inputs ?? {})) {
              const res = r as Resource;
              // A shed's pile is deliberately NOT in the town's stock -- that
              // is what stops a relay from being a second, invisible store --
              // so goods taken from one are subtracted from the shed and the
              // town's books are left alone. They were written off the moment
              // the carrier drew them out of the yard, which is the honest
              // point to record it: that is when the stockpile emptied.
              if (shed) shed.held[res] = (shed.held[res] ?? 0) - (n ?? 0);
              else this.state.consume(res, n ?? 0);
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
          // Into the building's own pile: inputs fetched for a stocker, or
          // a block just cut in a yard the ox will come for.
          if (w.carrying && (b.def.stocks || b.def.needsHauler)) {
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

          // A hauled producer stacks its output in its own yard and its man
          // goes straight back to the face. The stone is not his to walk to
          // the stockpile -- that is what the ox is for -- and before this
          // the quarrymen carried every block themselves and the tether was
          // a licence they had to own rather than anything that worked.
          if (b.def.needsHauler) {
            const home = this.world.approach(b, w.x, w.z);
            this.goTo(w, home.x, home.z, 'returning');
            break;
          }

          const kind = storeOf(prod.output);
          const store = this.world.nearestDrop(kind, w.x, w.z);
          if (!store) {
            this.state.notify(
              kind === 'granary' ? 'You need a granary to store food'
                : kind === 'armoury' ? 'You need an armoury to store weapons'
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
            // The hide off the same pig. Only on a real store drop, never into
            // a relay shed, and only for the load this cycle actually made --
            // clamped to the room there is, so it cannot outrun a full yard.
            const bp = productionOf(b.def, b.alt)?.byproduct;
            if (bp && !w.dropAt?.def.relay) {
              const put = Math.min(bp.amount, this.state.roomFor(bp.output));
              if (put > 0) this.state.deposit(bp.output, put);
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
   * The good this shed should go and fetch, or null.
   *
   * `below` is the depth that counts as short: 1 asks whether a shelf is
   * actually EMPTY, DEPOT_INPUT_STOCK whether it is merely low. The same walk
   * either way -- what differs is how urgent it is, and the caller decides
   * that by which question it asks first.
   */
  private restockNeed(
    b: PlacedBuilding, demand: Set<Resource>, below: number,
  ): Resource | null {
    if (totalHeld(b) >= DEPOT_CAPACITY) return null;
    for (const r of demand) {
      if ((b.held[r] ?? 0) >= below) continue;
      // Nothing to fetch, and nowhere to fetch it from. A shed cannot invent
      // wheat the town has not grown.
      if (this.state.stock[r] <= 0) continue;
      if (!this.world.nearestStore(storeOf(r), b.x, b.z)) continue;
      return r;
    }
    return null;
  }

  /** Send the carrier off to the store for a load of one input. */
  private goRestock(w: Worker, b: PlacedBuilding, r: Resource): void {
    const store = this.world.nearestStore(storeOf(r), b.x, b.z);
    if (!store) { w.timer = 2; return; }
    w.restock = r;
    const c = this.world.approach(store, w.x, w.z);
    this.goTo(w, c.x, c.z, 'toFetch');
  }

  /**
   * The storehouse carrier.
   *
   * It walks in both directions. OUTBOUND it takes the largest single kind the
   * shed is holding to the real store -- one good per journey, because a man
   * carries one thing, and because mixing kinds would mean deciding what to do
   * when the stockpile has room for the stone but not the wood. INBOUND it
   * fetches what the workshops around the shed eat, so a mill or a bakery out
   * at the workings takes its sacks from next door instead of walking to the
   * yard for each one.
   *
   * The two are kept apart by `relayDemand`: a good the workings around here
   * consume is never carried OUT, or a shed serving a mill would fetch wheat
   * from the stockpile and immediately walk it back again.
   *
   * It does NOT wait for a full load. A shed by a lone woodcutter would then
   * sit on four logs forever, which looks exactly like a bug.
   */
  private updateRelay(w: Worker, b: PlacedBuilding, dt: number): void {
    switch (w.state) {
      case 'idle': {
        w.timer -= dt;
        if (w.timer > 0) return;

        const demand = this.world.relayDemand(b);

        // An empty shelf comes before a full one. A workshop with nothing to
        // work on is stopped, and a load waiting here is only late: fetching
        // first costs a delivery one trip, and skipping it costs a mill the
        // whole round trip it was built beside this shed to avoid.
        const dry = this.restockNeed(b, demand, 1);
        if (dry) { this.goRestock(w, b, dry); return; }

        let best: Resource | null = null, most = 0;
        for (const [r, n] of Object.entries(b.held)) {
          // Held FOR the workings, not waiting to leave them.
          if (demand.has(r as Resource)) continue;
          if ((n ?? 0) > most) { most = n ?? 0; best = r as Resource; }
        }
        if (!best || most <= 0) {
          // Nothing to take out: top the shelves up to depth rather than
          // stand at the post, so the next dry spell never happens.
          const top = this.restockNeed(b, demand, DEPOT_INPUT_STOCK);
          if (top) { this.goRestock(w, b, top); return; }
          w.timer = 2;
          return;
        }

        const kind = storeOf(best);
        const store = this.world.nearestStore(kind, w.x, w.z);
        if (!store) {
          w.timer = 4;
          this.state.notify(
            `The storehouse has no ${kind} to deliver to`, 'warn');
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

      case 'toFetch': {
        if (!this.arrive(w, dt)) return;

        const r = w.restock;
        w.restock = null;
        if (r) {
          // Re-read the stock on arrival. The walk takes seconds, and a
          // workshop nearer the yard may have taken the last of it while the
          // carrier was on his way -- in which case he goes home empty rather
          // than conjuring a load.
          const want = DEPOT_INPUT_STOCK - (b.held[r] ?? 0);
          const room = DEPOT_CAPACITY - totalHeld(b);
          const n = Math.min(DEPOT_BATCH, want, room, this.state.stock[r]);
          if (n > 0) {
            this.state.consume(r, n);
            w.carrying = r;
            w.carryAmount = n;
          }
        }
        const back = this.world.approach(b, w.x, w.z);
        this.goTo(w, back.x, back.z, 'returning');
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
        // A load coming back IN: inputs fetched for the workings around here.
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
   * The ox tether.
   *
   * It produces nothing. It walks to a quarry that has stone stacked in its
   * yard, takes a sledge-load, walks it to the stockpile and comes back --
   * which is what the building has always claimed to do and, until now, never
   * did: the tether was a range check that let a quarry work, and the
   * quarrymen carried every block to the stockpile themselves while the ox
   * stood at its post.
   *
   * Anything the stockpile had no room for stays on the sledge, in the
   * tether's own yard, and goes out again on the next trip rather than being
   * spilled on the ground.
   */
  private updateHauler(
    w: Worker, b: PlacedBuilding,
    hauler: { resource: Resource; range: number; batch: number },
    dt: number,
  ): void {
    const kind = storeOf(hauler.resource);

    switch (w.state) {
      case 'idle': {
        // The animation phase advances while it waits, unlike a peasant's:
        // an idle worker among forty is a man standing still, but a single ox
        // frozen mid-breath at its post is the whole building looking broken.
        w.phase += dt;
        w.timer -= dt;
        if (w.timer > 0) return;

        // A load left over from a full stockpile goes out again first.
        const left = b.held[hauler.resource] ?? 0;
        if (left > 0) {
          const store = this.world.nearestDrop(kind, w.x, w.z);
          if (!store) { w.timer = 4; return; }
          b.held[hauler.resource] = 0;
          w.carrying = hauler.resource;
          w.carryAmount = left;
          w.dropAt = store;
          const c = this.world.approach(store, w.x, w.z);
          this.goTo(w, c.x, c.z, 'toStore');
          return;
        }

        const src = this.world.haulSource(b, hauler.resource, hauler.range);
        if (!src) { w.timer = 2.5; return; }
        w.haulFrom = src;
        const c = this.world.approach(src, w.x, w.z);
        this.goTo(w, c.x, c.z, 'toFetch');
        return;
      }

      case 'toFetch': {
        if (!this.arrive(w, dt)) return;

        const src = w.haulFrom;
        w.haulFrom = null;
        // The yard may have been emptied by another tether, or the quarry
        // pulled down, while the ox was on its way.
        const have = src ? (src.held[hauler.resource] ?? 0) : 0;
        const take = Math.min(hauler.batch, have);
        if (!src || take <= 0) {
          const home = this.world.approach(b, w.x, w.z);
          this.goTo(w, home.x, home.z, 'returning');
          return;
        }
        src.held[hauler.resource] = have - take;
        w.carrying = hauler.resource;
        w.carryAmount = take;

        const store = this.world.nearestDrop(kind, w.x, w.z);
        if (!store) {
          // Nowhere to take it: bring the load home rather than stand in the
          // quarry holding it, and let the tether's yard keep it.
          this.state.notify(
            `${STORE_LABELS[kind]} — nowhere for the ${b.def.label} to deliver`, 'warn');
          const home = this.world.approach(b, w.x, w.z);
          this.goTo(w, home.x, home.z, 'returning');
          return;
        }
        w.dropAt = store;
        const c = this.world.approach(store, w.x, w.z);
        this.goTo(w, c.x, c.z, 'toStore');
        return;
      }

      case 'toStore': {
        if (!this.arrive(w, dt)) return;
        if (w.carrying) {
          const relay = w.dropAt?.def.relay;
          if (relay) {
            const t = w.dropAt!;
            const room = relay - totalHeld(t);
            const put = Math.min(w.carryAmount, room);
            if (put > 0) t.held[w.carrying] = (t.held[w.carrying] ?? 0) + put;
            w.carryAmount -= put;
          } else {
            // Only what fits. `deposit` spills the remainder of a part load,
            // which is the right answer for a man with an armful and the
            // wrong one for a sledge: the ox can simply take the rest back.
            const put = Math.min(w.carryAmount, this.state.roomFor(w.carrying));
            if (put > 0) {
              this.state.deposit(w.carrying, put);
              w.carryAmount -= put;
            } else {
              this.state.notify(
                `${STORE_LABELS[kind]} is full — the ox is standing loaded`, 'warn');
            }
          }
          if (w.carryAmount > 0) {
            b.held[w.carrying] = (b.held[w.carrying] ?? 0) + w.carryAmount;
          }
          w.carrying = null;
          w.carryAmount = 0;
          w.dropAt = null;
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
    // The hauler is not a peasant, and its clips are not the peasant's: it
    // stands at its post, walks out empty, and comes back with a block on the
    // sledge. Same three states the rest of the workforce has, drawn as an
    // animal in harness.
    if (w.building?.def.hauler) {
      return w.carrying ? 'ox_haul' : this.isMoving(w) ? 'ox_walk' : 'ox_idle';
    }
    if (w.carrying) return 'carry';
    if (this.isMoving(w)) return 'walk';
    if (w.state === 'working') return w.building?.def.workClip ?? 'dig';
    return 'idle';
  }
}
