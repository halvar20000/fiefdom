/**
 * Where a frame's time goes, by subsystem.
 *
 * A frame that takes too long is a fact with no address: the whole loop is
 * one number, and "the game stutters on a big map" says nothing about which
 * of twenty systems is at fault. This is OpenTTD's framerate window, kept
 * to what is useful here -- every stage of a frame marks itself off as it
 * finishes, and the last few seconds' worth of frames are averaged so a
 * number can be read, not a flicker.
 *
 * The API is a sequence of marks rather than begin/end pairs, because that
 * is what the loop is: a list of stages, one after another. `frame()` resets
 * the clock, `mark(name)` charges the time since the previous mark to that
 * name, and `end()` closes the frame. The simulation steps inside one frame
 * mark the same names over and over; they add up, which is the number that
 * matters -- how much of this frame did the army cost, not how much did one
 * step of it.
 *
 * `performance.now()` is about a tenth of a microsecond, and a frame at fast
 * forward marks perhaps sixty times, so the cost of measuring is well under
 * the noise of what is measured.
 */

/** Frames kept for the average: two seconds at sixty. */
const WINDOW = 120;

export interface Bucket {
  name: string;
  /** Milliseconds per frame, averaged over the window. */
  avg: number;
  /** The worst frame in the window. */
  max: number;
  /** Share of the frame, 0..1. */
  share: number;
}

export interface Report {
  /** Frame time, averaged, and the worst. */
  frame: number;
  frameMax: number;
  fps: number;
  /** Simulation steps per frame, averaged. */
  steps: number;
  buckets: Bucket[];
}

export class Profiler {
  private index = new Map<string, number>();
  private names: string[] = [];
  /** This frame's totals, one per bucket. */
  private cur: number[] = [];
  /** The window: rows of per-bucket totals, plus frame length and step count. */
  private rows: Float32Array[] = [];
  private frameMs = new Float32Array(WINDOW);
  private frameSteps = new Float32Array(WINDOW);
  private at = 0;
  private filled = 0;
  private last = 0;
  private start = 0;
  private steps = 0;

  private slot(name: string): number {
    let i = this.index.get(name);
    if (i === undefined) {
      i = this.names.length;
      this.index.set(name, i);
      this.names.push(name);
      this.cur.push(0);
      // Rows already in the window are shorter than the new count; they read
      // as zero for the new bucket, which is right.
    }
    return i;
  }

  /** Open a frame. Everything up to `end()` is charged to whatever marks it. */
  frame(): void {
    this.start = this.last = performance.now();
    this.cur.fill(0);
    this.steps = 0;
  }

  /** One simulation step happened. For the steps-per-frame figure. */
  step(): void { this.steps++; }

  /** Charge the time since the previous mark to `name`. */
  mark(name: string): void {
    const now = performance.now();
    this.cur[this.slot(name)] += now - this.last;
    this.last = now;
  }

  /** Close the frame and file it in the window. */
  end(): void {
    const now = performance.now();
    this.frameMs[this.at] = now - this.start;
    this.frameSteps[this.at] = this.steps;
    this.rows[this.at] = Float32Array.from(this.cur);
    this.at = (this.at + 1) % WINDOW;
    if (this.filled < WINDOW) this.filled++;
  }

  report(): Report {
    const n = this.filled || 1;
    let frame = 0, frameMax = 0, steps = 0;
    const sum = new Float64Array(this.names.length);
    const max = new Float64Array(this.names.length);
    for (let r = 0; r < this.filled; r++) {
      frame += this.frameMs[r];
      if (this.frameMs[r] > frameMax) frameMax = this.frameMs[r];
      steps += this.frameSteps[r];
      const row = this.rows[r];
      for (let i = 0; i < row.length; i++) {
        sum[i] += row[i];
        if (row[i] > max[i]) max[i] = row[i];
      }
    }
    frame /= n;
    const buckets = this.names.map((name, i) => ({
      name, avg: sum[i] / n, max: max[i], share: frame ? sum[i] / n / frame : 0,
    })).sort((a, b) => b.avg - a.avg);
    return { frame, frameMax, fps: frame ? 1000 / frame : 0, steps: steps / n, buckets };
  }

  /** The report as lines of text, for an overlay or the console. */
  lines(): string[] {
    const r = this.report();
    const out = [
      `frame ${r.frame.toFixed(2)} ms  (worst ${r.frameMax.toFixed(1)})  ` +
      `${r.fps.toFixed(0)} fps  ${r.steps.toFixed(1)} steps`,
    ];
    for (const b of r.buckets) {
      if (b.avg < 0.005) continue;
      out.push(`${b.name.padEnd(12)} ${b.avg.toFixed(2).padStart(6)} ms ` +
               `${(b.share * 100).toFixed(0).padStart(3)}%  worst ${b.max.toFixed(1)}`);
    }
    return out;
  }
}

/**
 * A small monospace panel in the corner showing `lines()`, refreshed a few
 * times a second. Off by default; the game binds a key to it.
 */
export class ProfileOverlay {
  private el: HTMLPreElement | null = null;
  private timer = 0;

  constructor(private prof: Profiler) {}

  get shown(): boolean { return !!this.el; }

  toggle(): boolean {
    if (this.el) { this.hide(); return false; }
    const el = document.createElement('pre');
    el.id = 'profile';
    el.style.cssText = [
      // Top centre, under the resource bar: the corners all hold panels.
      'position:fixed', 'left:50%', 'top:64px', 'transform:translateX(-50%)',
      'z-index:30', 'margin:0',
      'padding:8px 10px', 'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
      'color:#ecdfc2', 'background:rgba(24,19,12,.9)',
      'border:1px solid rgba(196,162,96,.34)', 'border-radius:5px',
      'pointer-events:none', 'white-space:pre',
    ].join(';');
    document.body.appendChild(el);
    this.el = el;
    const tick = () => { if (this.el) this.el.textContent = this.prof.lines().join('\n'); };
    tick();
    this.timer = window.setInterval(tick, 400);
    return true;
  }

  hide(): void {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    window.clearInterval(this.timer);
  }
}
