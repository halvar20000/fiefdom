import type { Resource } from './defs';

/**
 * The land's luck: a season now and then that leans on one trade.
 *
 * OpenTTD does this to its industries -- a coal mine's output doubles, or
 * halves, and a news item says so -- and it is what keeps a settled economy
 * from being a solved one. Here the seasons are the land's, not the player's:
 * a blight in the wheat is in every lord's wheat, a good year for the
 * orchards is good for the rivals' too. What the player does about it is the
 * game; that they and the lords face the same weather is what keeps the lords
 * honest.
 *
 * One season at a time, a few minutes long, and never in the first stretch
 * of a game: a settlement of six buildings has no economy to lean on, only a
 * plan, and a blight then would be a rule rather than a turn of luck. Each
 * season is drawn from the trades the player actually keeps, so news of the
 * orchards never reaches a lord with no orchard.
 *
 * Off in a match. Every client would roll its own weather, and the host's
 * would fall on the AI lords -- three different climates on one map. Until
 * the host can announce a season on the wire, a match has no seasons.
 */

export interface Season {
  key: string;
  /** What the herald says when it begins. */
  text: string;
  /** And when it passes. */
  over: string;
  /** The trade it touches: what the affected buildings produce. */
  output: Resource;
  /** The production rate while it lasts. Above 1 is good news. */
  factor: number;
}

export const SEASONS: Season[] = [
  // Good
  { key: 'harvest', output: 'wheat', factor: 1.5,
    text: 'A fine harvest: the wheat comes in heavy this year.',
    over: 'The harvest is in.' },
  { key: 'fruit', output: 'apples', factor: 1.5,
    text: 'The orchards are heavy with fruit.',
    over: 'The orchards have been picked.' },
  { key: 'milk', output: 'cheese', factor: 1.5,
    text: 'The herds are fat and the milk flows.',
    over: 'The herds are back on plain grazing.' },
  { key: 'game', output: 'meat', factor: 1.5,
    text: 'Game is plentiful in the hills.',
    over: 'The game has thinned again.' },
  { key: 'shoal', output: 'fish', factor: 1.5,
    text: 'The waters teem with fish.',
    over: 'The shoals have moved on.' },
  { key: 'seam', output: 'stone', factor: 1.4,
    text: 'The quarrymen strike a good seam.',
    over: 'The good seam is worked out.' },
  { key: 'vein', output: 'iron', factor: 1.4,
    text: 'A rich vein of ore in the mine.',
    over: 'The rich vein has run out.' },
  // Bad
  { key: 'blight', output: 'wheat', factor: 0.5,
    text: 'Blight in the wheat: the fields yield poorly.',
    over: 'The blight has passed.' },
  { key: 'locusts', output: 'apples', factor: 0.5,
    text: 'Locusts have stripped the orchards.',
    over: 'The locusts have gone.' },
  { key: 'murrain', output: 'cheese', factor: 0.5,
    text: 'Murrain among the cattle: little milk this season.',
    over: 'The cattle have recovered.' },
  { key: 'fled', output: 'meat', factor: 0.5,
    text: 'The game has fled the hills.',
    over: 'The game has returned to the hills.' },
  { key: 'lowwater', output: 'fish', factor: 0.5,
    text: 'The waters run low and the fish are scarce.',
    over: 'The waters have risen; the fish are back.' },
];

/** Seconds of play before the first season can come. */
const FIRST_AFTER = 8 * 60;
/** Between one season passing and the next beginning. */
const GAP_MIN = 5 * 60, GAP_MAX = 9 * 60;
/** How long one lasts. */
const LENGTH_MIN = 3 * 60, LENGTH_MAX = 4 * 60;

export interface SavedFortune {
  key: string | null;
  until: number;
  nextAt: number;
}

export class Fortunes {
  private active: Season | null = null;
  private until = 0;
  private nextAt = FIRST_AFTER;

  constructor(
    /** What the player produces, for choosing news that means something. */
    private outputs: () => Set<Resource>,
    private say: (text: string, kind: 'info' | 'warn') => void,
  ) {}

  get current(): Season | null { return this.active; }

  /** The production rate for a trade right now: 1 unless a season touches it. */
  factor(output: Resource): number {
    return this.active && this.active.output === output ? this.active.factor : 1;
  }

  update(elapsed: number): void {
    if (this.active) {
      if (elapsed < this.until) return;
      this.say(this.active.over, 'info');
      this.active = null;
      this.nextAt = elapsed + GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN);
      return;
    }
    if (elapsed < this.nextAt) return;
    const have = this.outputs();
    const fitting = SEASONS.filter(s => have.has(s.output));
    if (!fitting.length) {
      // Nothing to lean on yet. Look again in a minute rather than pinning
      // the first season to the moment the first farm goes up.
      this.nextAt = elapsed + 60;
      return;
    }
    // Good and bad, evenly: the pool is stacked with more good than bad
    // news, and the draw is two-stage so the odds do not follow the count.
    const good = Math.random() < 0.5;
    const pool = fitting.filter(s => (s.factor > 1) === good);
    const pick = (pool.length ? pool : fitting)[Math.floor(Math.random() * (pool.length || fitting.length))];
    this.active = pick;
    this.until = elapsed + LENGTH_MIN + Math.random() * (LENGTH_MAX - LENGTH_MIN);
    this.say(pick.text, pick.factor < 1 ? 'warn' : 'info');
  }

  save(): SavedFortune {
    return { key: this.active?.key ?? null, until: this.until, nextAt: this.nextAt };
  }

  restore(sv: SavedFortune): void {
    this.active = sv.key ? SEASONS.find(s => s.key === sv.key) ?? null : null;
    this.until = sv.until;
    this.nextAt = sv.nextAt;
  }
}
