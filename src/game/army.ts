import {
  SOLDIER_TYPES, GARRISON_RANGE_BONUS, RANGED_THRESHOLD, type SoldierType,
} from './defs';
import type { PathNode } from './pathfind';

/**
 * Which faction a unit belongs to. 0 is the player, 1.. are rival lords.
 *
 * A number rather than a union because the count is now a property of the map.
 * It also means rivals are hostile to EACH OTHER for free: every check that
 * matters asks whether two sides differ, not whether one of them is the player.
 */
export type Side = number;
export const PLAYER: Side = 0;
export const isPlayer = (s: Side) => s === PLAYER;

/** A post on a wall or tower: which building, and where on it to stand. */
export interface GarrisonPost {
  /** North-west tile of the building, for height lookup and eviction. */
  x: number;
  z: number;
  /** Exactly where the man stands, so a tower's crew does not stack up. */
  sx: number;
  sz: number;
}

/** How long a killed soldier lies dying before he is removed, in seconds. */
const DEATH_TIME = 1.1;

export interface Soldier {
  id: number;
  side: Side;
  type: string;
  def: SoldierType;
  x: number;
  z: number;
  heading: number;
  phase: number;
  hp: number;
  moving: boolean;
  selected: boolean;
  path: PathNode[];
  tx: number;
  tz: number;
  /** Id of the unit being fought, or null. */
  target: number | null;
  /** Seconds until the next blow may land. */
  cooldown: number;
  /** Seconds left of the attack animation. Drives which clip is drawn. */
  swing: number;
  /**
   * Seconds left of the death animation, or 0 while alive.
   *
   * A killed soldier is kept in the list, inert, until this runs out, so the
   * death clip can play instead of the man simply blinking out. Everything
   * that matters -- targeting, combat, movement, blocking -- already gates on
   * `hp <= 0`, so a corpse is ignored by all of it without a second flag.
   */
  dying: number;
  /**
   * The player told this one to go somewhere.
   *
   * A unit under orders ignores everything it passes. Without it, marching a
   * column past a skirmish peels men off one at a time and the order silently
   * becomes a suggestion.
   */
  ordered: boolean;
  /**
   * The wall or tower tile this man is standing on, or null.
   *
   * Posted men do not move, reach further, and cannot be touched by anything
   * swinging from the ground.
   */
  garrison: GarrisonPost | null;
  /** Where he is walking to climb up, if he has been sent to man something. */
  mountAt: GarrisonPost | null;
  /**
   * Hold ground: attack what comes into reach, but never move to engage.
   *
   * The defensive stance. An aggressive soldier (the default) chases any foe he
   * notices; a holding one stands exactly where he was put and only swings at
   * what wanders within range -- so a line of archers can be posted to guard a
   * ford or a gate without wandering off after the first thing they see. An
   * explicit move order still moves him; this governs only the automatic
   * pursuit.
   */
  hold: boolean;
}

/** What a siege engine has found to knock down. */
export interface SiegeTarget {
  /** Closest point on the building, for closing the distance. */
  x: number;
  z: number;
  /** Distance to the footprint's edge, not its centre. */
  dist: number;
  hit(amount: number): void;
}

export interface ArmyWorld {
  findPath(fromX: number, fromZ: number, toX: number, toZ: number): PathNode[] | null;
  blocked(x: number, z: number): boolean;
  /**
   * Pace multiplier for the ground under a point, 1 on firm going.
   *
   * Sampled per step rather than per order, so a column slows as it enters a
   * marsh and speeds up as it leaves -- which is what lets the player read the
   * ground and route around it.
   */
  groundSpeed?(x: number, z: number, siege: boolean): number;
  /** Nearest building of the OTHER side that this engine could break. */
  siegeTarget?(s: Soldier): SiegeTarget | null;
  /**
   * Nearest enemy labourer within reach, for a fighter with no soldier to face.
   *
   * Returned only when one is already in range: a soldier cuts down the enemy's
   * people when he is standing among them, but does not GIVE CHASE after them,
   * so an ordered march is not derailed and an archer does not walk off a wall
   * to hunt peasants. `hit` is the world's to apply -- it costs the lord the
   * worker AND a staffed slot on the building he was working, so the job stops
   * until the lord can spare someone to walk in a replacement.
   */
  civilianTarget?(s: Soldier, reach: number): SiegeTarget | null;
  /**
   * A ranged attack was launched: spawn something the eye can follow.
   *
   * Fired at the moment of the blow, not when it lands -- damage is still
   * simultaneous and instant, and the projectile is a flourish over the top.
   * Tying the hit to the projectile's arrival would make range a function of
   * frame rate, which is a worse bargain than a hit that slightly precedes its
   * arrow.
   */
  onShoot?(kind: 'arrow' | 'bolt',
           fromX: number, fromZ: number, toX: number, toZ: number): void;
}

/** Tiles from a click within which a soldier counts as clicked. */
export const PICK_RADIUS = 0.7;

/** How far a unit looks for something to fight, beyond its own reach. */
export const AGGRO_MARGIN = 4.5;

/** Seconds an attack animation is held after a blow. */
export const SWING_TIME = 0.45;

/**
 * Every combatant on the map, both sides.
 *
 * One list rather than two, because combat is symmetric: target acquisition,
 * cooldowns and damage are identical whoever is swinging, and two lists would
 * mean writing all of it twice and letting the copies drift. The player-facing
 * methods filter to `side === 'player'` so a stray enemy can never end up
 * selected and taking orders.
 */
export class Army {
  soldiers: Soldier[] = [];
  private nextId = 1;
  /** Set by update() so the caller can report losses. */
  lastFallen: Soldier[] = [];

  constructor(private world: ArmyWorld) {}

  recruit(type: string, x: number, z: number, side: Side = PLAYER): Soldier | null {
    const def = SOLDIER_TYPES[type];
    if (!def) return null;
    const s: Soldier = {
      id: this.nextId++, side, type, def, x, z,
      heading: -Math.PI / 2, phase: Math.random() * 2,
      hp: def.hp, moving: false, selected: false,
      path: [], tx: x, tz: z,
      target: null, cooldown: Math.random() * 0.4, swing: 0, dying: 0, ordered: false,
      garrison: null, mountAt: null, hold: false,
    };
    this.soldiers.push(s);
    return s;
  }

  get mine(): Soldier[] { return this.soldiers.filter(s => s.side === PLAYER && s.hp > 0); }
  get enemies(): Soldier[] { return this.soldiers.filter(s => s.side !== PLAYER && s.hp > 0); }
  /** Everyone belonging to one faction. */
  of(side: Side): Soldier[] { return this.soldiers.filter(s => s.side === side && s.hp > 0); }
  get selected(): Soldier[] {
    return this.soldiers.filter(s => s.selected && isPlayer(s.side));
  }

  clearSelection(): void {
    for (const s of this.soldiers) s.selected = false;
  }

  byId(id: number): Soldier | undefined {
    return this.soldiers.find(s => s.id === id);
  }

  /**
   * Select the single player soldier nearest a world point.
   *
   * `add` keeps the rest of the selection (shift-click, or every tap on touch,
   * where there is no modifier to hold). `toggle` flips the picked man instead
   * of always selecting him, so a second tap on a touch device takes him back
   * out of the group -- the only way to deselect one without a modifier key.
   */
  selectAt(x: number, z: number, add: boolean, toggle = false): boolean {
    let best: Soldier | null = null;
    let bestD = PICK_RADIUS * PICK_RADIUS;
    for (const s of this.soldiers) {
      if (!isPlayer(s.side)) continue;
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < bestD) { bestD = d; best = s; }
    }
    if (!best) return false;
    if (!add) this.clearSelection();
    best.selected = toggle ? !best.selected : true;
    return true;
  }

  /**
   * Select every player soldier matching a test.
   *
   * Takes a predicate rather than a world-space rectangle on purpose. A box
   * dragged on SCREEN is a rotated diamond in world space, so an axis-aligned
   * world box built from its two corners covers a completely different region
   * -- in an isometric view, usually a sliver containing nobody. The caller
   * projects each soldier to screen space and tests there, in the space the
   * player actually drew the box in.
   */
  selectWhere(test: (s: Soldier) => boolean, add: boolean): number {
    if (!add) this.clearSelection();
    let n = 0;
    for (const s of this.soldiers) {
      if (!isPlayer(s.side)) continue;
      if (test(s)) { s.selected = true; n++; }
    }
    return n;
  }

  /** Every player soldier of one type, for double-click "select all of these". */
  selectType(type: string, add: boolean): number {
    return this.selectWhere(s => s.type === type, add);
  }

  /**
   * Set the stance of the selected soldiers. Returns how many changed.
   *
   * Holding also drops any pursuit already under way -- the point of the order
   * is "stop where you are", so a man mid-chase turns and stands rather than
   * finishing the run he was told to abandon.
   */
  setHold(on: boolean): number {
    let n = 0;
    for (const s of this.selected) {
      if (s.hold === on) continue;
      s.hold = on;
      if (on && !s.garrison && !s.ordered) { s.moving = false; s.path = []; }
      n++;
    }
    return n;
  }

  /** Whether every selected soldier is already holding, for a toggle. */
  get allHolding(): boolean {
    const sel = this.selected;
    return sel.length > 0 && sel.every(s => s.hold);
  }

  /**
   * Order the selection to a point.
   *
   * Targets are spread over a small block around the click rather than all
   * routed to the same tile: a dozen soldiers sent to one tile arrive, find it
   * occupied by each other, and mill about on the spot.
   */
  orderMove(x: number, z: number): number {
    const sel = this.selected;
    if (!sel.length) return 0;
    const side = Math.ceil(Math.sqrt(sel.length));
    let ordered = 0;
    sel.forEach((s, i) => {
      const ox = (i % side) - (side - 1) / 2;
      const oz = Math.floor(i / side) - (side - 1) / 2;
      if (!this.send(s, x + ox * 1.1, z + oz * 1.1)) return;
      s.ordered = true;
      s.target = null;
      // A move order is also the order to come down.
      s.garrison = null;
      s.mountAt = null;
      ordered++;
    });
    return ordered;
  }

  /** Route one unit to a point. Returns false if there is no way there. */
  send(s: Soldier, x: number, z: number): boolean {
    const target = this.nearestFree(x, z);
    const route = this.world.findPath(s.x, s.z, target.x, target.z);
    if (!route) return false;
    s.path = route.slice();
    s.tx = target.x; s.tz = target.z;
    s.moving = true;
    return true;
  }

  private nearestFree(x: number, z: number): { x: number; z: number } {
    if (!this.world.blocked(x, z)) return { x, z };
    for (let r = 1; r <= 4; r++) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
        if (!this.world.blocked(nx, nz)) return { x: nx, z: nz };
      }
    }
    return { x, z };
  }

  /** A man's reach, longer when he is standing on something. */
  static reachOf(s: Soldier): number {
    return s.def.range + (s.garrison ? GARRISON_RANGE_BONUS : 0);
  }

  /** Can `s` touch `o` at all? A wall puts a man out of a swordsman's reach. */
  private canHit(s: Soldier, o: Soldier): boolean {
    if (!o.garrison) return true;
    return Army.reachOf(s) >= RANGED_THRESHOLD;
  }

  /** Nearest living unit of the other side, within `reach`. */
  private findFoe(s: Soldier, reach: number): Soldier | null {
    let best: Soldier | null = null;
    let bestD = reach * reach;
    for (const o of this.soldiers) {
      if (o.side === s.side || o.hp <= 0) continue;
      if (!this.canHit(s, o)) continue;
      const d = (o.x - s.x) ** 2 + (o.z - s.z) ** 2;
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  /**
   * Send the selection to man a wall or tower.
   *
   * They walk to the foot of it and climb on arrival. Returns how many set off.
   */
  orderGarrison(x: number, z: number, cx: number, cz: number,
                spread = 0.55): number {
    const sel = this.selected.filter(s => !s.def.siege);
    let sent = 0;
    for (const s of sel) if (this.postTo(s, x, z, cx, cz, spread)) sent++;
    return sent;
  }

  /** Send one man to a post. Used by the player's orders and by the lord. */
  postTo(s: Soldier, x: number, z: number, cx: number, cz: number,
         spread = 0.55): boolean {
    if (s.def.siege) return false;
    if (!this.send(s, cx, cz)) return false;
    const n = this.garrisonOf(x, z).length
      + this.soldiers.filter(o => o.mountAt
          && o.mountAt.x === x && o.mountAt.z === z).length;
    const a = (n % 8) / 8 * Math.PI * 2;
    const r = n === 0 ? 0 : spread * (1 + Math.floor(n / 8) * 0.5);
    s.mountAt = { x, z, sx: cx + Math.cos(a) * r, sz: cz + Math.sin(a) * r };
    s.garrison = null;
    s.ordered = true;
    s.target = null;
    return true;
  }

  /** Turn a man out of whatever he is standing on. */
  dismount(s: Soldier, toX?: number, toZ?: number): void {
    s.garrison = null;
    s.mountAt = null;
    if (toX !== undefined && toZ !== undefined) { s.x = toX; s.z = toZ; }
  }

  /** He has arrived at the foot of a wall he was sent to man: put him on it. */
  private mountIfAsked(s: Soldier): void {
    if (!s.mountAt) return;
    s.garrison = s.mountAt;
    s.mountAt = null;
    s.x = s.garrison.sx;
    s.z = s.garrison.sz;
    s.path = [];
  }

  /** Everyone posted on a given tile. */
  garrisonOf(x: number, z: number): Soldier[] {
    return this.soldiers.filter(s => s.garrison
      && s.garrison.x === x && s.garrison.z === z);
  }

  update(dt: number): void {
    this.lastFallen = [];

    // Combat is resolved in two passes, and damage is applied simultaneously.
    //
    // A single pass over the list is not fair. Whoever is processed LATER sees
    // positions the earlier units have already updated this tick, so it enters
    // attack range a tick sooner while its opponent is still walking. With
    // everything else symmetric that one tick decides the whole fight:
    // measured, the second-created side won 16 duels out of 16, and 12 even
    // 3v3s out of 12, while dealing exactly the same 25 blows per 30 seconds.
    //
    // So: everyone decides and swings against the SAME snapshot, the blows all
    // land together, and only then does anyone move. Two units that kill each
    // other on the same tick both die, which is the honest outcome.
    const blows: { on: Soldier; amount: number }[] = [];
    const wallBlows: { t: SiegeTarget; amount: number }[] = [];
    const engaged = new Set<number>();

    for (const s of this.soldiers) {
      if (s.hp <= 0) continue;
      // Every living unit's animation clock runs, not just the walkers.
      // This used to sit in the movement pass, which skips anyone standing
      // still or in contact -- so idle men were frozen on one frame and the
      // attack animation, the whole point of having one, never played.
      s.phase += dt;
      s.cooldown -= dt;
      if (s.swing > 0) s.swing -= dt;

      // Siege engines are machines: they ignore soldiers completely and only
      // ever work on buildings. That is what makes them worth escorting --
      // they will stand there being cut to pieces without swinging back.
      if (s.def.siege && s.def.targetsUnits) {
        // An engine that shoots people. Same standing-still rule as the wall
        // breakers -- it never goes hunting, it holds where you put it and
        // covers the ground in front of it, which is the whole point of
        // owning one.
        const reach = Army.reachOf(s);
        let foe = s.target !== null ? this.byId(s.target) ?? null : null;
        if (foe && (foe.hp <= 0 || foe.side === s.side
                    || Math.hypot(foe.x - s.x, foe.z - s.z) > reach)) foe = null;
        if (!foe) foe = this.findFoe(s, reach);
        s.target = foe ? foe.id : null;
        if (!foe) continue;
        engaged.add(s.id);
        s.moving = false;
        s.path = [];
        s.heading = Math.atan2(foe.z - s.z, foe.x - s.x);
        if (s.cooldown <= 0) {
          const roll = s.def.damage * (0.85 + Math.random() * 0.3);
          blows.push({ on: foe, amount: Math.max(1, Math.round(roll)) });
          this.world.onShoot?.('bolt', s.x, s.z, foe.x, foe.z);
          s.cooldown = s.def.cooldown;
          s.swing = SWING_TIME;
        }
        continue;
      }

      if (s.def.siege) {
        const t = this.world.siegeTarget?.(s) ?? null;
        s.target = null;
        // An engine NEVER goes looking for a target. It shoots what is already
        // in reach and otherwise waits to be told where to go. Auto-advancing
        // meant a catapult trundled off across the map the moment it was
        // built, which makes it impossible to keep one at home for defence.
        if (!t || t.dist > s.def.range) continue;
        {
          engaged.add(s.id);
          s.moving = false;
          s.path = [];
          s.heading = Math.atan2(t.z - s.z, t.x - s.x);
          if (s.cooldown <= 0) {
            const roll = s.def.damage * (0.85 + Math.random() * 0.3);
            wallBlows.push({ t, amount: Math.max(1, Math.round(roll)) });
            // A catapult lobs a bolt-coloured shot at the stone it is breaking;
            // a ram is point-blank and throws nothing.
            if (s.def.range >= RANGED_THRESHOLD) {
              this.world.onShoot?.('bolt', s.x, s.z, t.x, t.z);
            }
            s.cooldown = s.def.cooldown;
            s.swing = SWING_TIME;
          }
        }
        continue;
      }

      let foe = s.target !== null ? this.byId(s.target) ?? null : null;
      if (foe && (foe.hp <= 0 || foe.side === s.side)) foe = null;

      const reach = Army.reachOf(s);
      const aggro = reach + AGGRO_MARGIN;
      if (foe && Math.hypot(foe.x - s.x, foe.z - s.z) > aggro) foe = null;

      // A unit under a move order keeps marching. Everything else looks around.
      if (!foe && !(s.ordered && s.moving)) foe = this.findFoe(s, aggro);
      s.target = foe ? foe.id : null;
      if (!foe) {
        // No enemy soldier to face. A fighter standing among an enemy's
        // labourers still cuts them down -- soldiers first, always, but an
        // undefended economy is fair game. He does not chase (the target is
        // only returned when already in reach), so a march is not derailed and
        // a wall archer keeps his post while thinning the workers below.
        if (!(s.ordered && s.moving)) {
          const civ = this.world.civilianTarget?.(s, reach);
          if (civ) {
            s.heading = Math.atan2(civ.z - s.z, civ.x - s.x);
            engaged.add(s.id);
            s.moving = false;
            s.path = [];
            if (s.cooldown <= 0) {
              const roll = s.def.damage * (0.85 + Math.random() * 0.3);
              civ.hit(Math.max(1, Math.round(roll)));
              if (Army.reachOf(s) >= RANGED_THRESHOLD) {
                this.world.onShoot?.(s.def.targetsUnits ? 'bolt' : 'arrow',
                                     s.x, s.z, civ.x, civ.z);
              }
              s.cooldown = s.def.cooldown;
              s.swing = SWING_TIME;
            }
          }
        }
        continue;
      }

      s.heading = Math.atan2(foe.z - s.z, foe.x - s.x);
      if (Math.hypot(foe.x - s.x, foe.z - s.z) <= reach) {
        engaged.add(s.id);
        s.moving = false;
        s.path = [];
        if (s.cooldown <= 0) {
          // A little spread on every blow. With simultaneous resolution and no
          // variance, two identical units ALWAYS kill each other on the same
          // tick -- correct, but it makes every even fight play out identically
          // and reads as the simulation being stuck rather than fair.
          const roll = s.def.damage * (0.85 + Math.random() * 0.3);
          blows.push({ on: foe, amount: Math.max(1, Math.round(roll)) });
          // An arrow to watch, but only for actual ranged fire -- a spearman's
          // reach is melee and wants no projectile.
          if (Army.reachOf(s) >= RANGED_THRESHOLD) {
            this.world.onShoot?.(s.def.targetsUnits ? 'bolt' : 'arrow',
                                 s.x, s.z, foe.x, foe.z);
          }
          s.cooldown = s.def.cooldown;
          s.swing = SWING_TIME;
        }
      } else if (!s.moving && !s.garrison && !s.hold) {
        // A man on a wall never climbs down to chase, and neither does one told
        // to hold ground -- both give up the pursuit for a fixed post. Everyone
        // else closes on the foe he has noticed.
        this.send(s, foe.x, foe.z);
      }
    }

    for (const b of wallBlows) b.t.hit(b.amount);
    for (const b of blows) {
      b.on.hp -= b.amount;
      // Being hit clears a march order: a column that walks on while being cut
      // down from behind looks broken, whatever the orders say.
      b.on.ordered = false;
    }

    for (const s of this.soldiers) {
      if (s.hp <= 0 || !s.moving || engaged.has(s.id) || s.garrison) continue;
      const going = this.world.groundSpeed?.(s.x, s.z, !!s.def.siege) ?? 1;
      let budget = s.def.speed * going * dt;
      while (budget > 0) {
        const wp = s.path.length ? s.path[0] : { x: s.tx, z: s.tz };
        const dx = wp.x - s.x, dz = wp.z - s.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.06) {
          if (s.path.length) { s.path.shift(); continue; }
          s.moving = false; s.ordered = false;
          this.mountIfAsked(s);
          break;
        }
        s.heading = Math.atan2(dz, dx);
        if (d <= budget) {
          s.x = wp.x; s.z = wp.z; budget -= d;
          if (s.path.length) s.path.shift();
          else { s.moving = false; s.ordered = false; this.mountIfAsked(s); break; }
        } else {
          s.x += (dx / d) * budget; s.z += (dz / d) * budget; budget = 0;
        }
      }
    }

    const fallen = this.soldiers.filter(s => s.hp <= 0 && s.dying <= 0);
    if (fallen.length) {
      this.lastFallen = fallen;
      // A soldier who just died starts his death animation rather than
      // vanishing. He is already inert -- every combat and movement check
      // above skips `hp <= 0` -- so this only keeps him on screen falling.
      for (const s of fallen) s.dying = DEATH_TIME;
      for (const s of this.soldiers) {
        if (s.target !== null && fallen.some(f => f.id === s.target)) s.target = null;
      }
    }
    // Age out the dying and drop them when the clip has played.
    let aged = false;
    for (const s of this.soldiers) {
      if (s.hp <= 0 && s.dying > 0) { s.dying -= dt; aged = true; }
    }
    if (aged) this.soldiers = this.soldiers.filter(s => s.hp > 0 || s.dying > 0);
  }
}
