import { ALL_RESOURCES, type Resource } from './defs';

const WINDOW = 60;   // seconds -- one bucket per second, so totals are per minute

/**
 * Rolling record of what the economy actually produced and consumed.
 *
 * Rates are measured from real events rather than derived from building counts,
 * because the two diverge exactly where the player needs the truth: a mill with
 * no wheat, a farm whose worker spends most of the cycle walking, or a building
 * that lost its staff to a shrinking population all still count as "one mill"
 * while producing nothing.
 */
export class Ledger {
  private produced: Record<Resource, Float32Array>;
  private consumed: Record<Resource, Float32Array>;
  private cursor = 0;
  private carry = 0;
  /** Seconds recorded so far, capped at WINDOW -- used to scale early rates. */
  private filled = 0;

  constructor() {
    const make = () => Object.fromEntries(
      ALL_RESOURCES.map(r => [r, new Float32Array(WINDOW)]),
    ) as Record<Resource, Float32Array>;
    this.produced = make();
    this.consumed = make();
  }

  recordProduced(r: Resource, n: number): void {
    this.produced[r][this.cursor] += n;
  }

  recordConsumed(r: Resource, n: number): void {
    this.consumed[r][this.cursor] += n;
  }

  advance(dt: number): void {
    this.carry += dt;
    while (this.carry >= 1) {
      this.carry -= 1;
      this.cursor = (this.cursor + 1) % WINDOW;
      // clear the bucket we are about to reuse
      for (const r of ALL_RESOURCES) {
        this.produced[r][this.cursor] = 0;
        this.consumed[r][this.cursor] = 0;
      }
      this.filled = Math.min(WINDOW, this.filled + 1);
    }
  }

  private sum(buf: Float32Array): number {
    let n = 0;
    for (let i = 0; i < WINDOW; i++) n += buf[i];
    return n;
  }

  /**
   * Per-minute rate. Early on, fewer than 60 seconds have been recorded, so the
   * raw sum would read as a misleadingly low rate; scale it up to a full minute.
   */
  private rate(buf: Float32Array): number {
    const seconds = Math.max(4, this.filled);
    return (this.sum(buf) * WINDOW) / seconds;
  }

  producedPerMin(r: Resource): number { return this.rate(this.produced[r]); }
  consumedPerMin(r: Resource): number { return this.rate(this.consumed[r]); }
  netPerMin(r: Resource): number {
    return this.producedPerMin(r) - this.consumedPerMin(r);
  }

  /** True once there is enough history for the numbers to mean anything. */
  get warm(): boolean { return this.filled >= 8; }
}
