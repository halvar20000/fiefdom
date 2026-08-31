import {
  ALL_RESOURCES, BUILDINGS, RAW_RESOURCES, FOOD_RESOURCES, RATIONS, TAX_LEVELS,
  FOOD_VARIETY_BONUS, PRICES, buildingHp, TRADE_BATCH, TRADE_INTERVAL, TRADE_MIN_BAND,
  INN_CAPACITY, ALE_PER_PERSON_PER_MIN, ALE_POPULARITY_MAX, isFood,
  CHURCH_SERVES, RELIGION_POPULARITY_MAX, PHARMACY_SERVES, HEALTH_POPULARITY_MAX,
  BEAUTY_CAP, BEAUTY_PER, SPEED_LEVELS, NORMAL_SPEED,
  RESOURCE_LABELS, STOCKPILE_TILE_CAPACITY, STOCKPILE_LEVELS,
  GRANARY_TILE_CAPACITY,
  type BuildingDef, type RationLevel, type Resource, type Store, type TradeOrder,
} from './defs';
import { Ledger } from './ledger';
import { StoreLayout } from './stores';

export interface PlacedBuilding {
  id: number;
  name: string;
  def: BuildingDef;
  /** North-west tile of the footprint. */
  x: number;
  z: number;
  /** Workers currently assigned. */
  staff: number;
  /** Buffered inputs held at the building between cycles. */
  held: Partial<Record<Resource, number>>;
  /** Damage left before it falls. Only siege engines reduce it. */
  hp: number;
}

export interface Notice {
  text: string;
  at: number;
  kind: 'info' | 'warn';
}

/** The band a popularity factor belongs to, for grouping in the history chart. */
export type PopCat = 'food' | 'rations' | 'taxes' | 'fear';
export interface PopFactor { label: string; value: number; cat: PopCat; }

/**
 * The whole economy's mutable state.
 *
 * Stocks are global rather than per-store-building: the original tracks a
 * single stockpile and a single granary total too, and per-building inventory
 * would add bookkeeping the player never sees.
 */
export class GameState {
  gold = 1000;
  stock: Record<Resource, number> = Object.fromEntries(
    ALL_RESOURCES.map(r => [r, 0]),
  ) as Record<Resource, number>;

  buildings: PlacedBuilding[] = [];
  private nextId = 1;

  /** Which square of each store holds which good. Quantities stay in `stock`. */
  readonly stockpile = new StoreLayout(
    RAW_RESOURCES, STOCKPILE_TILE_CAPACITY, STOCKPILE_LEVELS);
  readonly granary = new StoreLayout(
    FOOD_RESOURCES, GRANARY_TILE_CAPACITY, STOCKPILE_LEVELS);

  /** Peasants living in the settlement, including those working. */
  population = 8;
  /** Peasants not currently assigned to a building. */
  idle = 8;

  popularity = 50;
  rations: RationLevel = 'normal';
  taxLevel = 0;

  /**
   * How fast the world runs: an index into SPEED_LEVELS.
   *
   * Only the frame loop reads it, to scale the dt it hands the simulation. The
   * state never ticks itself, so nothing here has to know about speed at all.
   * Pause is a multiplier of 0 rather than a second flag beside `speed`: one
   * number to read, and no way to be paused and ticking at the same time.
   */
  speed: number = NORMAL_SPEED;
  /** What Pause returns to. Never Pause itself, or the toggle would stick. */
  private lastRunningSpeed = NORMAL_SPEED;

  /** Simulation seconds per real second. 0 while paused. */
  get speedMult(): number {
    return SPEED_LEVELS[this.speed]?.mult ?? 1;
  }

  get paused(): boolean {
    return this.speedMult === 0;
  }

  setSpeed(i: number): void {
    if (i < 0 || i >= SPEED_LEVELS.length) return;
    if (SPEED_LEVELS[i].mult > 0) this.lastRunningSpeed = i;
    this.speed = i;
  }

  /** Pause, or resume at whatever speed was running before it. */
  togglePause(): void {
    this.setSpeed(this.paused ? this.lastRunningSpeed : 0);
  }

  /**
   * Step one notch faster or slower.
   *
   * Clamped rather than wrapped: a player leaning on the key to speed up should
   * never find themselves suddenly paused at the far end.
   */
  nudgeSpeed(step: number): void {
    this.setSpeed(Math.max(0, Math.min(SPEED_LEVELS.length - 1, this.speed + step)));
  }

  /** Accumulates fractional food/gold between ticks. */
  private foodDebt = 0;
  private goldDebt = 0;
  private aleDebt = 0;

  /**
   * How hungry the town is, 0..1, eased rather than switched.
   *
   * A binary "no food" penalty flips on and off every time the last loaf is
   * baked and immediately eaten -- measured at 19 flips in 300 seconds, which
   * makes popularity thrash and the breakdown unreadable. Easing turns a
   * momentary empty granary into a small dip and sustained famine into the
   * full penalty.
   */
  private hunger = 0;

  /**
   * Fraction of the population currently drinking, 0..1.
   *
   * Eased rather than snapped so running dry shows as happiness sliding away
   * over a few seconds -- long enough to notice and do something about.
   */
  aleCoverage = 0;

  notices: Notice[] = [];
  elapsed = 0;
  readonly ledger = new Ledger();

  /**
   * Standing trade orders, one per good.
   *
   * 'buy' tops the stock up to `threshold`; 'sell' disposes of anything above
   * it. This is the part of Stronghold's market worth copying: you state the
   * level you want to hold and stop thinking about it.
   */
  trade: Record<Resource, TradeOrder> = Object.fromEntries(
    ALL_RESOURCES.map(r => [r, { buyOn: false, buyLevel: 20, sellOn: false, sellLevel: 80 }]),
  ) as Record<Resource, TradeOrder>;
  private tradeClock = 0;
  /** Gold earned and spent by standing orders, for the stats panel. */
  tradeIncome = 0;
  tradeSpend = 0;

  constructor() {
    this.stock.wood = 200;
    this.stock.stone = 100;
    this.stock.bread = 40;
  }

  /**
   * Anything the game wants to tell the player.
   *
   * Fires `onNotice` as well as queueing the text, which is what lets the same
   * message be heard as well as read without every caller having to remember
   * to make a sound. The de-duplication above is doing double duty now: it
   * already stopped the screen repeating itself, and it stops the voice
   * repeating itself too.
   */
  onNotice: (text: string, kind: Notice['kind']) => void = () => {};

  notify(text: string, kind: Notice['kind'] = 'info'): void {
    const last = this.notices[this.notices.length - 1];
    if (last && last.text === text && this.elapsed - last.at < 12) return;
    this.notices.push({ text, at: this.elapsed, kind });
    if (this.notices.length > 6) this.notices.shift();
    this.onNotice(text, kind);
  }

  get housing(): number {
    return this.buildings.reduce((n, b) => n + (b.def.housing ?? 0), 0);
  }

  get totalFood(): number {
    return FOOD_RESOURCES.reduce((n, f) => n + this.stock[f], 0);
  }

  /** How many distinct foods are actually available right now. */
  get foodVariety(): number {
    return FOOD_RESOURCES.filter(f => this.stock[f] > 0).length;
  }

  hasStore(kind: 'stockpile' | 'granary'): boolean {
    return this.buildings.some(b => b.def.storeFor === kind);
  }

  /** Every square of a store, in placement order. */
  storeTiles(kind: Store): PlacedBuilding[] {
    return this.buildings.filter(b => b.def.storeFor === kind);
  }

  /** The layout that owns a good: food to the granary, everything else the yard. */
  layoutFor(kind: Store): StoreLayout {
    return kind === 'granary' ? this.granary : this.stockpile;
  }

  get stockpileTiles(): PlacedBuilding[] { return this.storeTiles('stockpile'); }
  get granaryTiles(): PlacedBuilding[] { return this.storeTiles('granary'); }

  get stockpileCapacity(): number {
    return this.stockpileTiles.length * STOCKPILE_TILE_CAPACITY;
  }

  get granaryCapacity(): number {
    return this.granaryTiles.length * GRANARY_TILE_CAPACITY;
  }

  get stockpileUsed(): number {
    return RAW_RESOURCES.reduce((n, r) => n + Math.max(0, this.stock[r]), 0);
  }

  /** How much more of a good its store will take. */
  roomFor(resource: Resource): number {
    const kind: Store = isFood(resource) ? 'granary' : 'stockpile';
    return this.layoutFor(kind).spaceFor(resource, this.storeTiles(kind), this.stock);
  }

  /** How many people the inns could serve if ale holds out. */
  get innCapacity(): number {
    return this.buildings.filter(b => b.name === 'inn').length * INN_CAPACITY;
  }

  /** Fraction of the town within reach of a church, 0..1. */
  get religionCoverage(): number {
    const served = this.buildings.reduce(
      (n, b) => n + (b.name === 'church' ? CHURCH_SERVES : 0), 0);
    if (this.population <= 0) return 0;
    return Math.min(1, served / this.population);
  }

  /** Fraction of the town within reach of a pharmacy, 0..1. Mirrors the church. */
  get healthCoverage(): number {
    const served = this.buildings.reduce(
      (n, b) => n + (b.name === 'pharmacy' ? PHARMACY_SERVES : 0), 0);
    if (this.population <= 0) return 0;
    return Math.min(1, served / this.population);
  }

  /**
   * Popularity from aesthetic buildings, already capped and eroded by size.
   * A bare number here; the panel adds the label.
   */
  get beautyBonus(): number {
    const beauty = this.buildings.reduce(
      (n, b) => n + (b.def.beauty ?? 0), 0);
    const eroded = beauty - Math.floor(this.population / BEAUTY_PER);
    return Math.max(0, Math.min(BEAUTY_CAP, eroded));
  }

  /** The strongest fear building in place, or null. Gallows do not stack. */
  get fearEffect(): { popularity: number; taxMultiplier: number } | null {
    let best: { popularity: number; taxMultiplier: number } | null = null;
    for (const b of this.buildings) {
      const f = b.def.fear;
      if (f && (!best || f.taxMultiplier > best.taxMultiplier)) best = f;
    }
    return best;
  }

  /**
   * Every contribution to the popularity target, itemised.
   *
   * This IS the calculation -- `tickEconomy` sums this list rather than
   * repeating the arithmetic, so what the player reads can never drift from
   * what the simulation applies.
   */
  popularityBreakdown(): PopFactor[] {
    const ration = RATIONS[this.rations];
    const tax = TAX_LEVELS[this.taxLevel];
    // No "starting goodwill" line any more. 50 is where popularity BEGINS, not
    // a force acting on it; listing it as a factor was what made the panel read
    // as "you are at 51 because 50 + 1" instead of "you are rising by 1 a
    // minute".
    //
    // Every item also carries a `cat`, so the history chart can group these many
    // lines into four legible bands (see `popularityFactors`) without a second
    // copy of the arithmetic that could drift from this one.
    const out: PopFactor[] = [
      { label: ration.label, value: ration.popularity, cat: 'rations' },
      { label: tax.label, value: tax.popularity, cat: 'taxes' },
    ];

    const variety = FOOD_VARIETY_BONUS[Math.min(FOOD_VARIETY_BONUS.length - 1, this.foodVariety)];
    out.push({
      label: this.foodVariety > 1
        ? `Food variety (${this.foodVariety} kinds)`
        : 'Food variety (one kind)',
      value: variety, cat: 'food',
    });

    if (this.innCapacity > 0) {
      out.push({
        label: `Ale (${Math.round(this.aleCoverage * 100)}% drinking)`,
        value: ALE_POPULARITY_MAX * this.aleCoverage, cat: 'food',
      });
    }
    const religion = this.religionCoverage;
    if (religion > 0) {
      out.push({
        label: `Religion (${Math.round(religion * 100)}% at church)`,
        value: RELIGION_POPULARITY_MAX * religion, cat: 'food',
      });
    }
    const health = this.healthCoverage;
    if (health > 0) {
      out.push({
        label: `Health (${Math.round(health * 100)}% near a pharmacy)`,
        value: HEALTH_POPULARITY_MAX * health, cat: 'food',
      });
    }
    const beauty = this.beautyBonus;
    if (beauty > 0) out.push({ label: 'Gardens', value: beauty, cat: 'food' });
    const fear = this.fearEffect;
    if (fear) out.push({ label: 'Rule by fear', value: fear.popularity, cat: 'fear' });
    if (this.hunger > 0.02) {
      out.push({
        label: this.hunger > 0.6 ? 'People are starving!' : 'Food running short',
        value: -45 * this.hunger, cat: 'food',
      });
    }
    if (this.population >= this.housing) {
      // A nudge to build, not a wall. At -6 it exactly cancelled a fed and
      // untaxed town's +6, so a full settlement could never pass 67 no matter
      // what else it did -- and the cap on population is already the real
      // pressure to build more housing. Stronghold has no such penalty at all.
      out.push({ label: 'Overcrowded', value: -2, cat: 'fear' });
    }
    return out;
  }

  /**
   * The popularity breakdown folded into four bands, for the history chart.
   *
   * `food` gathers everything you PROVIDE -- variety, ale, church, gardens, and
   * the shortage penalty when it bites; `rations` and `taxes` are the two dials
   * you set directly; `fear` is the harsh pressures (rule by fear, overcrowding).
   * They partition the breakdown exactly, so the four always sum to
   * `popularityRate` and the chart can never quietly lose a factor.
   */
  popularityFactors(): Record<PopCat, number> {
    const bands: Record<PopCat, number> = { food: 0, rations: 0, taxes: 0, fear: 0 };
    for (const f of this.popularityBreakdown()) bands[f.cat] += f.value;
    return bands;
  }

  /**
   * Points per minute popularity is currently moving.
   *
   * Positive and it climbs to 100, negative and it falls to 0 -- as in
   * Stronghold, where a fed and untaxed town ends up loved rather than parked
   * at whatever its modifiers happen to add up to. Taxes are then paid for by
   * out-earning them with food, variety and ale, which is the trade the whole
   * economy exists to let you make.
   */
  get popularityRate(): number {
    return this.popularityBreakdown().reduce((n, f) => n + f.value, 0);
  }

  /** Where popularity ends up if nothing changes: one end of the scale. */
  get popularityTarget(): number {
    const r = this.popularityRate;
    return r > 0.05 ? 100 : r < -0.05 ? 0 : Math.round(this.popularity);
  }

  /** Ale actually sitting in the inns, ready to serve. */
  get aleInInns(): number {
    return this.buildings.reduce(
      (n, b) => n + (b.name === 'inn' ? (b.held.ale ?? 0) : 0), 0);
  }

  /**
   * Drink from the inns' own barrels, nearest-full first.
   * Returns how much was actually served.
   */
  private drawAle(want: number): number {
    let need = want;
    for (const b of this.buildings) {
      if (need <= 0) break;
      if (b.name !== 'inn') continue;
      const have = b.held.ale ?? 0;
      if (have <= 0) continue;
      const take = Math.min(have, need);
      b.held.ale = have - take;
      need -= take;
    }
    const served = want - need;
    if (served > 0) this.ledger.recordConsumed('ale', served);
    return served;
  }

  /** Ale drunk per minute at the current coverage. */
  get aleDemandPerMin(): number {
    return Math.min(this.population, this.innCapacity) * ALE_PER_PERSON_PER_MIN;
  }

  /** Trading of any kind needs somewhere to trade. */
  get hasMarket(): boolean {
    return this.buildings.some(b => b.name === 'market');
  }

  /**
   * Settle standing trade orders.
   *
   * Deliberately gradual: a batch every couple of seconds rather than an
   * instant correction, so a surplus visibly drains away and a large purchase
   * is something you watch your gold pay for. Runs inside tickEconomy so the
   * headless test path exercises exactly the same code as the game.
   */
  private tickTrade(dt: number): void {
    if (!this.hasMarket) return;
    this.tradeClock += dt;
    if (this.tradeClock < TRADE_INTERVAL) return;
    this.tradeClock = 0;

    for (const r of ALL_RESOURCES) {
      const order = this.trade[r];
      if (!order.buyOn && !order.sellOn) continue;
      const price = PRICES[r];
      if (!price) continue;
      const [buyPrice, sellPrice] = price;
      const held = this.stock[r];

      // Sell the surplus above the sell level.
      if (order.sellOn && held > order.sellLevel) {
        const n = Math.min(TRADE_BATCH, held - order.sellLevel);
        this.stock[r] -= n;
        const earned = n * sellPrice;
        this.gold += earned;
        this.tradeIncome += earned;
        this.ledger.recordConsumed(r, n);
        continue;                       // never buy and sell the same good in one tick
      }

      // Top back up when it falls below the buy level.
      if (order.buyOn && held < order.buyLevel) {
        const affordable = Math.floor(this.gold / buyPrice);
        const room = this.roomFor(r);
        const n = Math.min(TRADE_BATCH, order.buyLevel - held, affordable, room);
        if (n <= 0) {
          // Distinguish the two, or a full yard reads as bankruptcy.
          this.notify(room <= 0
            ? `No room in the ${isFood(r) ? 'granary' : 'stockpile'} for ` +
              RESOURCE_LABELS[r].toLowerCase()
            : 'Not enough gold to buy', 'warn');
          continue;
        }
        const cost = n * buyPrice;
        this.gold -= cost;
        this.tradeSpend += cost;
        this.stock[r] += n;
        this.ledger.recordProduced(r, n);
      }
    }
  }

  /**
   * Adjust a trade level, keeping the buy level below the sell level.
   *
   * If the two ever cross, the good is bought and sold in alternate ticks and
   * the market's spread quietly drains the treasury.
   */
  setTradeLevel(r: Resource, which: 'buy' | 'sell', value: number): void {
    const t = this.trade[r];
    if (which === 'buy') {
      t.buyLevel = Math.max(0, Math.min(value, t.sellLevel - TRADE_MIN_BAND));
    } else {
      t.sellLevel = Math.max(t.buyLevel + TRADE_MIN_BAND, value);
    }
  }

  canAfford(cost: Partial<Record<Resource, number>>): boolean {
    return Object.entries(cost).every(
      ([r, n]) => this.stock[r as Resource] >= (n ?? 0));
  }

  spend(cost: Partial<Record<Resource, number>>): void {
    for (const [r, n] of Object.entries(cost)) {
      this.stock[r as Resource] -= n ?? 0;
    }
  }

  /** Deposit produced goods, but only if the matching store has room. */
  deposit(resource: Resource, amount: number): boolean {
    const needed = isFood(resource) ? 'granary' : 'stockpile';
    if (!this.hasStore(needed)) return false;

    // A part load is accepted and the remainder spills. The carrier is already
    // standing on the yard with the goods in its arms, and sending it home
    // still holding them needs a state the worker loop does not have. The
    // spill is at most a few units, and only on the delivery that fills the
    // last square -- by which point the player has been warned.
    const room = this.roomFor(resource);
    const put = Math.min(amount, room);
    if (put <= 0) {
      const where = needed === 'granary' ? 'The granary' : 'The stockpile';
      this.notify(
        `${where} is full — nowhere to put ${RESOURCE_LABELS[resource].toLowerCase()}`,
        'warn');
      return false;
    }
    this.stock[resource] += put;
    this.ledger.recordProduced(resource, put);
    return true;
  }

  /** Take goods out of store, recording it as consumption. */
  consume(resource: Resource, amount: number): boolean {
    if (this.stock[resource] < amount) return false;
    this.stock[resource] -= amount;
    this.ledger.recordConsumed(resource, amount);
    return true;
  }

  /** Food eaten per minute at the current population and ration level. */
  get foodDemandPerMin(): number {
    return this.population * RATIONS[this.rations].rate;
  }

  /** Minutes of food left at the current net rate, or null if not shrinking. */
  get foodMinutesLeft(): number | null {
    const net = this.ledger.producedPerMin('bread')
      + this.ledger.producedPerMin('cheese')
      + this.ledger.producedPerMin('apples')
      - this.foodDemandPerMin;
    if (net >= -0.01) return null;
    return this.totalFood / -net;
  }

  addBuilding(name: string, x: number, z: number): PlacedBuilding {
    const def = BUILDINGS[name];
    const b: PlacedBuilding = {
      id: this.nextId++, name, def, x, z, staff: 0, held: {}, hp: buildingHp(def),
    };
    this.buildings.push(b);
    return b;
  }

  removeBuilding(b: PlacedBuilding): void {
    const i = this.buildings.indexOf(b);
    if (i >= 0) {
      this.idle += b.staff;
      this.buildings.splice(i, 1);
    }
  }

  /**
   * Population, food, taxes and popularity.
   *
   * Popularity eases toward a target rather than snapping to it, so a bad
   * decision shows as a slide you can still correct.
   */
  tickEconomy(dt: number): void {
    this.elapsed += dt;
    this.ledger.advance(dt);

    const ration = RATIONS[this.rations];
    const tax = TAX_LEVELS[this.taxLevel];

    // --- eating ---
    let starving = false;
    if (ration.rate > 0 && this.population > 0) {
      this.foodDebt += (this.population * ration.rate * dt) / 60;
      while (this.foodDebt >= 1) {
        const available = FOOD_RESOURCES.filter(f => this.stock[f] > 0);
        if (available.length === 0) { starving = true; this.foodDebt = 0; break; }
        const pick = available[Math.floor(Math.random() * available.length)];
        this.consume(pick, 1);
        this.foodDebt -= 1;
      }
    }

    // --- taxes ---
    if (tax.gold > 0 && this.population > 0) {
      // A gallows frightens people into paying more -- the other half of the
      // popularity it costs. No fear building, and the multiplier is 1.
      const fearMult = this.fearEffect?.taxMultiplier ?? 1;
      this.goldDebt += (this.population * tax.gold * fearMult * dt) / 60;
      const whole = Math.floor(this.goldDebt);
      if (whole > 0) { this.gold += whole; this.goldDebt -= whole; }
    }

    // --- ale ---
    // Inns serve whoever they can reach, for as long as the ale lasts.
    let aleTarget = 0;
    const capacity = this.innCapacity;
    if (capacity > 0 && this.population > 0) {
      const served = Math.min(this.population, capacity);
      this.aleDebt += (served * ALE_PER_PERSON_PER_MIN * dt) / 60;
      const whole = Math.floor(this.aleDebt);
      if (whole > 0) {
        const drunk = this.drawAle(whole);
        this.aleDebt -= drunk;
        if (drunk < whole) this.aleDebt = 0;      // barrels are dry
      }
      // Coverage depends on ale being AT the inn, not merely in the stockpile:
      // the drayman has to have carried it there first.
      if (this.aleInInns > 0) aleTarget = served / this.population;
    }
    this.aleCoverage += (aleTarget - this.aleCoverage) * Math.min(1, dt * 0.25);

    // --- hunger ---
    const empty = this.totalFood <= 0 ? 1 : 0;
    this.hunger += (empty - this.hunger) * Math.min(1, dt * 0.35);

    // --- popularity ---
    // Accumulates rather than easing to a target: the modifiers are a rate.
    this.popularity = Math.max(0, Math.min(100,
      this.popularity + (this.popularityRate * dt) / 60));

    // --- population drift ---
    const room = this.housing - this.population;
    if (this.popularity > 52 && room > 0) {
      if (Math.random() < dt * (this.popularity - 50) * 0.012) {
        this.population += 1;
        this.idle += 1;
      }
    } else if (this.popularity < 45 && this.population > 0) {
      // Leaving is slower than arriving on purpose. Now that popularity
      // travels the whole scale rather than parking at a target, a town dips
      // below 45 on the way to somewhere better -- and at the old rate a dip
      // to 30 emptied eight people in forty seconds, which is a death spiral
      // rather than a warning.
      if (Math.random() < dt * (50 - this.popularity) * 0.004) {
        this.population -= 1;
        if (this.idle > 0) this.idle -= 1;
        else this.layOffOne();
      }
    }

    this.tickTrade(dt);

    if (starving) this.notify('Your people are starving!', 'warn');
  }

  /** Pull a worker off a building when the population shrinks below staffing. */
  private layOffOne(): void {
    for (let i = this.buildings.length - 1; i >= 0; i--) {
      const b = this.buildings[i];
      if (b.staff > 0) { b.staff -= 1; return; }
    }
  }

  /** Fill vacant jobs from the idle pool, nearest-built first. */
  assignWorkers(): void {
    for (const b of this.buildings) {
      while (b.staff < b.def.workers && this.idle > 0) {
        b.staff += 1;
        this.idle -= 1;
      }
    }
  }
}
