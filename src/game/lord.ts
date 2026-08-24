import {
  BUILDINGS, RATIONS, TAX_LEVELS, ALL_RESOURCES, FOOD_RESOURCES,
  STOCKPILE_TILE_CAPACITY, GRANARY_TILE_CAPACITY, SOLDIER_TYPES, isFood,
  type Resource,
} from './defs';
import type { Army, Soldier } from './army';

/** One of the lord's buildings, as the world hands it over. */
export interface LordBuilding {
  name: string;
  x: number;
  z: number;
  /** Workers assigned. The lord manages this; the world only stores it. */
  staff: number;
}

export interface LordWorld {
  /** Everything he currently owns. Shrinks when the player knocks things down. */
  buildings(): LordBuilding[];
  /** Try to raise one. The world finds the site and checks the ground. */
  build(name: string): boolean;
  /** Where new troops appear, or null if he has no barracks left. */
  muster(): { x: number; z: number } | null;
  /** His own keep, which the garrison defends. */
  home(): { x: number; z: number };
  /** What he marches on. Null if the player has no keep. */
  target(): { x: number; z: number } | null;
  /** An unmanned wall or tower of his, for the garrison to stand on. */
  garrisonPost(): { x: number; z: number; cx: number; cz: number } | null;
  notify(text: string): void;
}

/**
 * What he builds, and in what order.
 *
 * `want` is a running target for that building, so a name appearing twice reads
 * as stages: two hovels early, more once there is food to feed them. He works
 * down this list and builds the first thing he is short of and can pay for,
 * which is the same order of operations a player follows -- shelter, then
 * timber, then somewhere to put it, then food, then stone, then troops.
 */
export const BUILD_PLAN: { name: string; want: number }[] = [
  { name: 'hovel', want: 2 },
  { name: 'woodcutter', want: 2 },
  { name: 'stockpile', want: 6 },
  { name: 'granary', want: 4 },
  { name: 'hunter', want: 1 },        // food that needs no green land
  { name: 'woodcutter', want: 3 },
  { name: 'hovel', want: 4 },
  { name: 'quarry', want: 1 },
  { name: 'ox_tether', want: 1 },
  { name: 'wheat_farm', want: 2 },
  { name: 'granary', want: 6 },
  { name: 'mill', want: 1 },
  { name: 'bakery', want: 1 },
  { name: 'hunter', want: 2 },        // feed them BEFORE housing more of them
  // Food VARIETY, the same as the player's second-tier farms. A one-crop town
  // starves the moment its single chain is cut, so the lord spreads his food
  // across apples, cheese and meat too -- and each is another kind of operator
  // to see working his fields. All need green ground; on a bare map the plan
  // simply skips whichever has no site.
  { name: 'apple_orchard', want: 1 },
  { name: 'dairy_farm', want: 1 },
  { name: 'barracks', want: 1 },      // nothing military until here
  { name: 'hovel', want: 6 },
  { name: 'stockpile', want: 14 },
  { name: 'iron_mine', want: 1 },
  { name: 'hunter', want: 3 },
  // A second quarry before the stonework. Measured with one: he finished a
  // 20-minute game holding TWO stone, his wall stalled at 20 of 28 and he never
  // afforded a siege camp at all. Walls at 3 stone each outrun a single quarry.
  { name: 'quarry', want: 2 },
  { name: 'ox_tether', want: 2 },
  { name: 'gatehouse', want: 1 },
  { name: 'wall', want: 28 },
  { name: 'tower', want: 2 },
  { name: 'siege_camp', want: 1 },
  { name: 'wheat_farm', want: 3 },
  { name: 'pig_farm', want: 1 },
  { name: 'dairy_farm', want: 2 },
  { name: 'apple_orchard', want: 2 },
  { name: 'hunter', want: 4 },
  { name: 'hovel', want: 8 },
  { name: 'quarry', want: 3 },
  { name: 'stockpile', want: 18 },
  { name: 'wall', want: 44 },
];

export const LORD = {
  /** Seconds before he does anything at all. */
  gracePeriod: 20,
  /** Seconds between construction attempts. */
  buildEvery: 14,
  /** How long he saves for one building before giving up and moving on. */
  blockPatience: 150,
  /** Shortest gap between recruits, when he can afford them. */
  recruitEvery: 7,
  /** Never field more than this. */
  maxArmy: 24,
  /** Troops held back to man his battlements. */
  garrison: 9,
  /** Muster this many before marching, growing to the second figure. */
  waveMin: 4,
  waveMax: 12,
  /** Seconds after a wave leaves before another can form. */
  waveCooldown: 45,
  /** When he starts fielding siege engines of his own. */
  siegeAfter: 600,
  /** How long it takes his army to reach full tempo. */
  tempoRampSeconds: 1200,
  /** Rations he feeds his people, using the player's own table. */
  rations: 'normal' as const,
  /** Tax level he levies, using the player's own table. */
  taxLevel: 2,
};

/**
 * The enemy lord: an economy first, an army second.
 *
 * He runs on the SAME numbers the player does -- the same `BUILDINGS` defs, the
 * same production rates and input chains, the same `RATIONS` and `TAX_LEVELS`
 * tables, the same building costs and storage capacities. What is abstracted is
 * labour and haulage: his workers are a headcount rather than figures walking
 * to and from a stockpile. Simulating those would double the cost of the game
 * loop to animate people the player will almost never be looking at.
 *
 * The part that matters is that his economy is REAL and attackable. Break his
 * woodcutter and his timber stops; break his granary and his people starve;
 * break his barracks and the troops stop coming.
 */
export class Lord {
  // --- economy ---
  gold = 200;
  stock: Record<Resource, number> = Object.fromEntries(
    ALL_RESOURCES.map(r => [r, 0]),
  ) as Record<Resource, number>;
  population = 6;
  idle = 6;

  // --- military ---
  private garrisonIds = new Set<number>();
  private sentIds = new Set<number>();

  private recruitClock = 0;
  private buildClock = 0;
  private waveClock = 0;
  private growthDebt = 0;
  private manClock = 0;
  /** Which plan step he is saving up for, and for how long. */
  private blockedOn: string | null = null;
  private blockedFor = 0;

  elapsed = 0;
  wavesSent = 0;
  recruited = 0;
  built = 0;
  barracksStanding = false;
  defeated = false;
  /** Set while he cannot feed his people, for the status readout. */
  starving = false;

  constructor(private army: Army, private world: LordWorld, readonly side = 1) {
    this.stock.wood = 40;
    this.stock.stone = 20;
    this.stock.bread = 30;
  }

  /** His own men only -- `army.enemies` would sweep in the other rivals too. */
  get troops(): Soldier[] { return this.army.of(this.side); }
  get mustering(): Soldier[] {
    return this.troops.filter(s => !this.garrisonIds.has(s.id) && !this.sentIds.has(s.id));
  }

  /**
   * A labourer has been cut down by the enemy.
   *
   * It costs him the person AND the staffed slot on the building he worked, so
   * that job stops (production needs full staff) until he can spare someone to
   * fill it again. If the man happened to be idle rather than employed, only the
   * head is lost. This is what makes killing his operators a real attack on the
   * economy rather than a cosmetic one.
   */
  loseWorker(b?: { staff: number }): void {
    this.population = Math.max(0, this.population - 1);
    if (b && b.staff > 0) b.staff -= 1;
    else if (this.idle > 0) this.idle -= 1;
  }

  private count(name: string): number {
    return this.world.buildings().filter(b => b.name === name).length;
  }

  get housing(): number {
    return this.world.buildings()
      .reduce((n, b) => n + (BUILDINGS[b.name]?.housing ?? 0), 0);
  }

  get rawCapacity(): number { return this.count('stockpile') * STOCKPILE_TILE_CAPACITY; }
  get foodCapacity(): number { return this.count('granary') * GRANARY_TILE_CAPACITY; }
  get food(): number { return FOOD_RESOURCES.reduce((n, f) => n + this.stock[f], 0); }

  /**
   * Room left for a good, reserved PER GOOD exactly as the player's yard does.
   *
   * Pooling the capacity instead looked like a harmless abstraction and was
   * not. Measured with a shared pool: 316 wood filled 498 of his 500 raw
   * capacity, stone could never rise above 2, and he could not afford a single
   * 20-stone tower for the whole game while his quarries ran flat out with
   * nowhere to put the stone. One good starving another is the exact thing the
   * player's per-square allocation prevents.
   */
  private roomFor(r: Resource): number {
    if (isFood(r)) {
      const bays = this.count('granary');
      const mine = Math.ceil(this.stock[r] / GRANARY_TILE_CAPACITY);
      const used = FOOD_RESOURCES
        .reduce((n, f) => n + Math.ceil(this.stock[f] / GRANARY_TILE_CAPACITY), 0);
      return (mine + Math.max(0, bays - used)) * GRANARY_TILE_CAPACITY - this.stock[r];
    }
    const squares = this.count('stockpile');
    const raws = ALL_RESOURCES.filter(x => !isFood(x));
    const mine = Math.ceil(this.stock[r] / STOCKPILE_TILE_CAPACITY);
    const used = raws
      .reduce((n, x) => n + Math.ceil(this.stock[x] / STOCKPILE_TILE_CAPACITY), 0);
    return (mine + Math.max(0, squares - used)) * STOCKPILE_TILE_CAPACITY - this.stock[r];
  }

  private canAfford(cost: Partial<Record<Resource, number>>): boolean {
    return Object.entries(cost).every(([r, n]) => this.stock[r as Resource] >= (n ?? 0));
  }

  private spend(cost: Partial<Record<Resource, number>>): void {
    for (const [r, n] of Object.entries(cost)) this.stock[r as Resource] -= n ?? 0;
  }

  /** Fill each building up to its worker requirement, in plan order. */
  private assignWorkers(): void {
    const bs = this.world.buildings();
    let free = this.idle;
    for (const b of bs) {
      const need = BUILDINGS[b.name]?.workers ?? 0;
      if (b.staff > need) { free += b.staff - need; b.staff = need; }
    }
    for (const b of bs) {
      const need = BUILDINGS[b.name]?.workers ?? 0;
      while (b.staff < need && free > 0) { b.staff++; free--; }
    }
    this.idle = free;
  }

  /** Same 14-tile test the player's quarries have to pass. */
  private haulerNear(b: LordBuilding): boolean {
    return this.world.buildings().some(o => o.name === 'ox_tether'
      && Math.abs(o.x - b.x) < 14 && Math.abs(o.z - b.z) < 14);
  }

  private produce(dt: number): void {
    for (const b of this.world.buildings()) {
      const def = BUILDINGS[b.name];
      const prod = def?.produces;
      if (!prod || b.staff < (def.workers ?? 0) || (def.workers ?? 0) === 0) continue;
      // A quarry with no ox tether in range has nowhere to put its stone --
      // exactly as for the player. Without this he quarried for free while the
      // player had to build tethers, which is the sort of quiet exemption that
      // makes an opponent feel like it is cheating.
      if (def.needsHauler && !this.haulerNear(b)) continue;

      const perSec = prod.amount / prod.seconds;
      const want = perSec * dt;
      if (this.roomFor(prod.output) <= 0) continue;

      // Same input chain the player's buildings run on: a mill with no wheat
      // makes no flour, however many men are standing in it.
      if (prod.inputs) {
        const need = Object.entries(prod.inputs)
          .map(([r, n]) => [r as Resource, ((n ?? 0) / prod.amount) * want] as const);
        if (need.some(([r, n]) => this.stock[r] < n)) continue;
        for (const [r, n] of need) this.stock[r] -= n;
      }
      this.stock[prod.output] += Math.min(want, this.roomFor(prod.output));
    }
  }

  private eatAndTax(dt: number): void {
    // Food, using the player's own rations table.
    let need = (this.population * RATIONS[LORD.rations].rate * dt) / 60;
    this.starving = false;
    for (const f of FOOD_RESOURCES) {
      if (need <= 0) break;
      const take = Math.min(this.stock[f], need);
      this.stock[f] -= take;
      need -= take;
    }
    if (need > 0.0001) this.starving = true;

    this.gold += (this.population * TAX_LEVELS[LORD.taxLevel].gold * dt) / 60;

    // Population drifts toward housing while fed, and away from it while not.
    const room = this.housing - this.population;
    if (!this.starving && room > 0) this.growthDebt += dt * 0.09;
    else if (this.starving) this.growthDebt -= dt * 0.12;
    while (this.growthDebt >= 1) {
      this.growthDebt -= 1; this.population += 1; this.idle += 1;
    }
    while (this.growthDebt <= -1 && this.population > 0) {
      this.growthDebt += 1; this.population -= 1;
      if (this.idle > 0) this.idle -= 1;
    }
  }

  /**
   * Raise the next thing on the plan.
   *
   * He SAVES UP for a step he cannot afford instead of skipping to cheaper
   * ones. Skipping looks harmless and is not: a gatehouse costs 15 stone and a
   * wall costs 3, so a lord who moves on when he cannot afford the gate spends
   * every stone he earns on wall segments and never accumulates 15 in his life.
   * Measured before this: 37 walls, no gatehouse, at twenty minutes.
   *
   * A step with no legal SITE is different -- no amount of saving fixes wrong
   * ground -- so that one is skipped immediately. And to avoid deadlocking on
   * something he can never afford, patience runs out after `blockPatience`.
   */
  private construct(dt: number): void {
    this.buildClock += dt;
    if (this.buildClock < LORD.buildEvery) return;

    let skipping = 0;
    for (const step of BUILD_PLAN) {
      if (this.count(step.name) >= step.want) continue;
      const def = BUILDINGS[step.name];
      if (!def) continue;

      if (!this.canAfford(def.cost)) {
        const key = `${step.name}:${step.want}`;
        if (this.blockedOn !== key) { this.blockedOn = key; this.blockedFor = 0; }
        this.blockedFor += dt;
        if (this.blockedFor < LORD.blockPatience) {
          this.buildClock = LORD.buildEvery;   // wait and save
          return;
        }
        skipping++;
        continue;                              // given up on this one for now
      }

      if (!this.world.build(step.name)) continue;   // no site, or wrong ground
      this.spend(def.cost);
      this.buildClock = 0;
      this.built++;
      if (this.blockedOn === `${step.name}:${step.want}`) {
        this.blockedOn = null; this.blockedFor = 0;
      }
      return;
    }
    this.buildClock = LORD.buildEvery;
    void skipping;
  }

  /**
   * Get the garrison onto the battlements.
   *
   * Re-checked periodically rather than only at recruitment. His first five
   * men are raised around the six-minute mark and his wall does not go up
   * until nine, so a one-shot check at recruitment posted nobody, ever --
   * measured 24 troops and an empty wall at twenty-five minutes.
   */
  private manWalls(dt: number): void {
    this.manClock += dt;
    if (this.manClock < 8) return;
    this.manClock = 0;
    for (const s of this.troops) {
      if (!this.garrisonIds.has(s.id)) continue;
      if (s.garrison || s.mountAt || s.def.siege) continue;
      const post = this.world.garrisonPost();
      if (!post) return;                       // nothing built to stand on yet
      this.army.postTo(s, post.x, post.z, post.cx, post.cz, 0.3);
    }
  }

  private get waveSize(): number {
    const t = Math.min(1, this.elapsed / LORD.tempoRampSeconds);
    return Math.round(LORD.waveMin + (LORD.waveMax - LORD.waveMin) * t);
  }

  /** What he can afford to raise, hardest first. */
  private nextType(): string | null {
    const wants: string[] = [];
    if (this.elapsed > LORD.siegeAfter && this.count('siege_camp') > 0) {
      wants.push('ram', 'catapult');
    }
    wants.push('swordsman', 'archer', 'spearman');
    // Shuffled a little so he does not field one monotonous unit type.
    const roll = Math.random();
    const order = roll < 0.45 ? wants : [...wants].reverse();
    for (const t of order) {
      const d = SOLDIER_TYPES[t];
      if (this.gold >= d.gold && this.canAfford(d.cost)) return t;
    }
    return null;
  }

  update(dt: number): void {
    this.elapsed += dt;
    if (this.defeated) return;
    if (this.elapsed < LORD.gracePeriod) return;

    this.assignWorkers();
    this.produce(dt);
    this.eatAndTax(dt);
    this.construct(dt);
    this.manWalls(dt);

    const alive = new Set(this.troops.map(s => s.id));
    for (const id of [...this.garrisonIds]) if (!alive.has(id)) this.garrisonIds.delete(id);
    for (const id of [...this.sentIds]) if (!alive.has(id)) this.sentIds.delete(id);

    // --- troops, only once the economy can pay for them ---
    const at = this.world.muster();
    this.barracksStanding = at !== null;
    this.recruitClock += dt;
    if (at && this.recruitClock >= LORD.recruitEvery
        && this.troops.length < LORD.maxArmy && this.idle > 0) {
      const type = this.nextType();
      if (type) {
        const d = SOLDIER_TYPES[type];
        this.recruitClock = 0;
        this.gold -= d.gold;
        this.spend(d.cost);
        // Same rule as the player: a recruit leaves the population, so he
        // stops eating and his hovel takes someone new. The lord's whole point
        // is that he plays by the player's economy.
        this.idle -= 1;
        this.population -= 1;
        const s = this.army.recruit(type,
          at.x + (Math.random() - 0.5) * 2.4, at.z + (Math.random() - 0.5) * 2.4, this.side);
        if (s) {
          this.recruited++;
          if (this.garrisonIds.size < LORD.garrison) {
            this.garrisonIds.add(s.id);
            // Put him on the wall if there is a wall to stand on. A lord who
            // builds battlements and then leaves his men milling about at the
            // foot of them is not playing the same game as the player.
            const post = this.world.garrisonPost();
            if (!post || !this.army.postTo(s, post.x, post.z, post.cx, post.cz, 0.3)) {
              const h = this.world.home();
              this.army.send(s, h.x + (Math.random() - 0.5) * 5,
                                h.z + (Math.random() - 0.5) * 5);
            }
          }
        }
      }
    }

    this.waveClock += dt;
    if (this.waveClock < LORD.waveCooldown) return;
    const ready = this.mustering;
    if (ready.length < this.waveSize) return;
    const target = this.world.target();
    if (!target) return;

    let sent = 0;
    ready.forEach((s, i) => {
      const ring = 1.2 + 0.5 * Math.floor(i / 8);
      const a = (i % 8) / 8 * Math.PI * 2;
      if (!this.army.send(s, target.x + Math.cos(a) * ring, target.z + Math.sin(a) * ring)) return;
      this.sentIds.add(s.id);
      sent++;
    });
    if (!sent) return;
    this.waveClock = 0;
    this.wavesSent++;
    this.world.notify(`The enemy lord marches on you — ${sent} strong!`);
  }

  attackNow(): number {
    const ready = this.mustering;
    const target = this.world.target();
    if (!ready.length || !target) return 0;
    let sent = 0;
    ready.forEach((s, i) => {
      const a = (i % 8) / 8 * Math.PI * 2;
      if (!this.army.send(s, target.x + Math.cos(a) * 1.4, target.z + Math.sin(a) * 1.4)) return;
      this.sentIds.add(s.id);
      sent++;
    });
    if (sent) { this.waveClock = 0; this.wavesSent++; }
    return sent;
  }

  status(): Record<string, number | string> {
    const held = ALL_RESOURCES
      .filter(r => this.stock[r] >= 1)
      .map(r => `${r} ${Math.floor(this.stock[r])}`).join(', ');
    return {
      elapsed: Math.round(this.elapsed),
      gold: Math.floor(this.gold),
      population: this.population,
      idle: this.idle,
      housing: this.housing,
      food: Math.floor(this.food),
      starving: this.starving ? 'yes' : 'no',
      buildings: this.world.buildings().length,
      built: this.built,
      stock: held || '(empty)',
      storage: `${this.rawCapacity} raw / ${this.foodCapacity} food`,
      troops: this.troops.length,
      recruited: this.recruited,
      wavesSent: this.wavesSent,
      barracks: this.barracksStanding ? 'standing' : 'none',
      defeated: this.defeated ? 'yes' : 'no',
    };
  }
}
