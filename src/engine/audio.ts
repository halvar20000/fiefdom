/**
 * Sound, synthesised rather than sampled.
 *
 * Every sprite in this game comes out of Blender rather than an asset pack,
 * and the audio follows the same rule for the same reasons: nothing to
 * licence in a public repository, nothing added to the download, and a set
 * that stays coherent because one file decides how everything sounds.
 *
 * The vocabulary is deliberately small -- a tone, a thud, a band of noise --
 * and every effect is those three in different proportions. A castle is
 * wood, stone and rope hitting each other; that is what those primitives are
 * for.
 */

export type SoundName =
  | 'place' | 'demolish' | 'recruit' | 'hit' | 'destroy'
  | 'notice' | 'warn' | 'coin' | 'fire';

const MASTER_KEY = 'fiefdom.volume';
const SPEECH_KEY = 'fiefdom.speech';

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  /** 0 silent, 1 full. Persisted, because nobody wants to set it twice. */
  volume = Number(localStorage.getItem(MASTER_KEY) ?? '0.8');
  speech = (localStorage.getItem(SPEECH_KEY) ?? '1') === '1';

  /** Last thing spoken, to stop a repeated warning talking over itself. */
  private lastSpoken = '';
  private lastSpokeAt = 0;

  /**
   * Browsers refuse to start audio until the player has interacted, so the
   * context is created on the first gesture rather than at load. Attaching
   * this to several event types and removing them all on the first one is
   * the whole trick.
   */
  arm(): void {
    const start = () => {
      this.ensure();
      for (const ev of ['pointerdown', 'keydown', 'wheel']) {
        window.removeEventListener(ev, start);
      }
    };
    for (const ev of ['pointerdown', 'keydown', 'wheel']) {
      window.addEventListener(ev, start, { passive: true });
    }
  }

  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    type Legacy = typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? (globalThis as Legacy).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.startWind();
    return this.ctx;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    localStorage.setItem(MASTER_KEY, String(this.volume));
    if (this.master) this.master.gain.value = this.volume;
    if (this.volume === 0) window.speechSynthesis?.cancel();
  }

  setSpeech(on: boolean): void {
    this.speech = on;
    localStorage.setItem(SPEECH_KEY, on ? '1' : '0');
    if (!on) window.speechSynthesis?.cancel();
  }

  // --- primitives ---------------------------------------------------------

  /** White noise, one second of it, reused by everything that needs grit. */
  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseCache) return this.noiseCache;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseCache = buf;
    return buf;
  }
  private noiseCache: AudioBuffer | null = null;

  /** A struck tone: pitch falling a little, decaying fast. */
  private tone(freq: number, dur: number, gain: number,
               type: OscillatorType = 'triangle', bend = 0.8): void {
    const ctx = this.ctx!, t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * bend), t + dur);
    // Exponential, not linear: a linear tail reads as a synthesiser cutting
    // out, an exponential one as something that was struck.
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** A band of noise: wood, stone, cloth, depending where you put it. */
  private hiss(freq: number, q: number, dur: number, gain: number,
               kind: BiquadFilterType = 'bandpass'): void {
    const ctx = this.ctx!, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    const f = ctx.createBiquadFilter();
    f.type = kind;
    f.frequency.setValueAtTime(freq, t);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /**
   * The wind, always there and very quiet.
   *
   * A desert map with no sound at all reads as broken rather than as quiet,
   * and a bed costs one filtered noise loop. Kept low enough that the effects
   * sit on top of it rather than fighting it.
   */
  private startWind(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0.035;
    src.connect(f).connect(g).connect(this.master!);
    src.start();

    // Slow swell, so it does not sit at one level and stop being weather.
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.06;
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain).connect(g.gain);
    lfo.start();
  }

  // --- the sounds themselves ----------------------------------------------

  play(name: SoundName): void {
    if (this.volume <= 0) return;
    if (!this.ensure() || !this.master) return;
    switch (name) {
      case 'place':
        // timber set down on stone
        this.hiss(900, 1.2, 0.10, 0.20);
        this.tone(180, 0.16, 0.16, 'triangle', 0.7);
        break;
      case 'demolish':
        this.hiss(500, 0.7, 0.42, 0.28, 'lowpass');
        this.tone(90, 0.34, 0.18, 'sawtooth', 0.5);
        break;
      case 'recruit':
        this.tone(392, 0.13, 0.13);
        window.setTimeout(() => this.volume > 0 && this.tone(587, 0.18, 0.12), 90);
        break;
      case 'hit':
        this.hiss(2100, 2.0, 0.06, 0.13);
        this.tone(240, 0.07, 0.10, 'square', 0.6);
        break;
      case 'destroy':
        this.hiss(320, 0.6, 0.75, 0.34, 'lowpass');
        this.tone(70, 0.60, 0.22, 'sawtooth', 0.4);
        break;
      case 'notice':
        this.tone(660, 0.16, 0.10, 'sine', 1);
        break;
      case 'warn':
        this.tone(330, 0.20, 0.13, 'triangle', 0.75);
        window.setTimeout(() => this.volume > 0 && this.tone(262, 0.26, 0.12, 'triangle', 0.8), 130);
        break;
      case 'coin':
        this.tone(1180, 0.09, 0.07, 'sine', 1.1);
        window.setTimeout(() => this.volume > 0 && this.tone(1560, 0.10, 0.05, 'sine', 1.1), 55);
        break;
      case 'fire':
        this.hiss(700, 0.5, 0.9, 0.22, 'lowpass');
        break;
    }
  }

  // --- ambience -----------------------------------------------------------

  /**
   * What each kind of thing sounds like when it is on screen.
   *
   * ONE voice per kind, never one per building. Forty hovels and a dozen
   * quarries would otherwise be fifty oscillators fighting for the same few
   * hundred hertz, which is noise rather than atmosphere -- and the player
   * cannot tell four quarries from five by ear anyway. Presence is a weight,
   * and the weight moves one voice.
   *
   * `pulse` kinds are struck at intervals: a quarry is not a drone, it is a
   * chink every few seconds, and intermittence is most of what makes it read
   * as work being done. `loop` kinds are continuous beds.
   */
  private static AMBIENCE: Record<string, {
    mode: 'loop' | 'pulse';
    /** Seconds between strikes, min and max, for pulse kinds. */
    every?: [number, number];
    gain: number;
  }> = {
    water:      { mode: 'loop',  gain: 0.16 },
    crowd:      { mode: 'loop',  gain: 0.10 },
    burning:    { mode: 'loop',  gain: 0.16 },
    quarry:     { mode: 'pulse', every: [0.9, 2.1], gain: 0.26 },
    woodcutter: { mode: 'pulse', every: [1.4, 3.0], gain: 0.28 },
    mill:       { mode: 'pulse', every: [2.2, 3.4], gain: 0.20 },
    brewery:    { mode: 'pulse', every: [1.6, 3.2], gain: 0.14 },
    livestock:  { mode: 'pulse', every: [2.6, 5.5], gain: 0.16 },
  };

  private voices = new Map<string, {
    gain: GainNode; pan: StereoPannerNode;
    /** Loops only. */ src?: AudioBufferSourceNode;
    /** Pulses only: when the next strike is due, in context time. */ next?: number;
    weight: number;
  }>();

  /**
   * Tell the mixer what is on screen.
   *
   * Weights are 0..1 and pans are -1..1. Called a few times a second rather
   * than every frame: gains are ramped, so a slower update is inaudible, and
   * scanning the map for what is visible is not free.
   */
  setAmbience(present: Map<string, { weight: number; pan: number }>): void {
    if (this.volume <= 0 || !this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;

    for (const [kind, spec] of Object.entries(Audio.AMBIENCE)) {
      const here = present.get(kind);
      const want = here ? Math.max(0, Math.min(1, here.weight)) : 0;
      let v = this.voices.get(kind);

      if (!v) {
        if (want <= 0) continue;             // never built, never allocated
        const gain = ctx.createGain();
        // Safari was late to StereoPannerNode; without it everything is
        // centred, which is a smaller loss than no ambience at all.
        const pan = typeof ctx.createStereoPanner === 'function'
          ? ctx.createStereoPanner() : null;
        gain.gain.value = 0;
        if (pan) gain.connect(pan).connect(this.master);
        else gain.connect(this.master);
        v = { gain, pan: pan as StereoPannerNode, weight: 0 };
        if (spec.mode === 'loop') v.src = this.startBed(kind, gain);
        else v.next = t;
        this.voices.set(kind, v);
      }

      v.weight = want;
      // Ramped, not set: a gain that jumps as a building scrolls into view
      // clicks, and the click is louder than the sound it is introducing.
      v.gain.gain.setTargetAtTime(want * spec.gain, t, 0.35);
      if (v.pan && here) v.pan.pan.setTargetAtTime(here.pan, t, 0.35);
    }
  }

  /** Fire any pulse voices that are due. Called from the frame loop. */
  tickAmbience(): void {
    if (this.volume <= 0 || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    for (const [kind, v] of this.voices) {
      const spec = Audio.AMBIENCE[kind];
      if (!spec || spec.mode !== 'pulse' || v.next === undefined) continue;
      if (v.weight <= 0.02) { v.next = t + 1; continue; }
      if (t < v.next) continue;
      const [lo, hi] = spec.every ?? [2, 4];
      // Louder when there is more of it, but nowhere near linearly -- eight
      // quarries are not eight times the noise, they are a busier hillside.
      this.strike(kind, v.gain, 0.55 + 0.45 * v.weight);
      v.next = t + lo + Math.random() * (hi - lo);
    }
  }

  /** A continuous bed for one kind, built from filtered noise. */
  private startBed(kind: string, dest: GainNode): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    src.loop = true;
    const f = ctx.createBiquadFilter();

    if (kind === 'water') {
      // Lapping: a narrow low band, swelling slowly.
      f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = 0.7;
    } else if (kind === 'crowd') {
      // Voices without words: the band a room full of people sits in.
      f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.4;
    } else {
      // Fire: broad and low, with the top rolled off.
      f.type = 'lowpass'; f.frequency.value = 1400;
    }

    const swell = ctx.createGain();
    swell.gain.value = 0.75;
    const lfo = ctx.createOscillator();
    const lfoAmt = ctx.createGain();
    lfo.frequency.value = kind === 'water' ? 0.22 : 0.13;
    lfoAmt.gain.value = 0.3;
    lfo.connect(lfoAmt).connect(swell.gain);
    lfo.start();

    src.connect(f).connect(swell).connect(dest);
    src.start();
    return src;
  }

  /** One strike of a pulse kind, through that kind's own gain and pan. */
  private strike(kind: string, dest: GainNode, level: number): void {
    const ctx = this.ctx!, t = ctx.currentTime;
    const hit = (freq: number, q: number, dur: number, g: number,
                 type: BiquadFilterType = 'bandpass') => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(ctx);
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(g * level, t + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(env).connect(dest);
      src.start(t); src.stop(t + dur + 0.02);
    };
    const ring = (freq: number, dur: number, g: number,
                  type: OscillatorType = 'triangle') => {
      const o = ctx.createOscillator();
      const env = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(freq * 0.75, t + dur);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(g * level, t + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(env).connect(dest);
      o.start(t); o.stop(t + dur + 0.02);
    };

    switch (kind) {
      case 'quarry':                     // iron on stone
        hit(2600, 3.0, 0.09, 0.9);
        ring(880, 0.10, 0.35, 'square');
        break;
      case 'woodcutter':                 // axe into a trunk
        hit(1100, 1.1, 0.13, 1.0);
        ring(150, 0.13, 0.5, 'triangle');
        break;
      case 'mill':                       // a big wheel taking its weight
        ring(78, 0.55, 0.5, 'sawtooth');
        hit(320, 0.8, 0.45, 0.30, 'lowpass');
        break;
      case 'brewery':                    // something bubbling over
        hit(480, 2.4, 0.22, 0.5);
        break;
      case 'livestock':                  // a low complaint from the pens
        ring(196, 0.30, 0.35, 'sawtooth');
        break;
    }
  }

  /**
   * Read a notice aloud.
   *
   * Uses the browser's own voice: no audio to ship, and it reads whatever the
   * game writes, so a new message is spoken without anyone recording it.
   *
   * Anything already queued is dropped rather than queued behind. Notices
   * arrive in bursts -- a granary filling while a quarry stalls -- and a voice
   * still working through the backlog thirty seconds later is describing a
   * situation that has already changed.
   */
  say(text: string, urgent = false): void {
    if (!this.speech || this.volume <= 0) return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    const now = performance.now();
    if (text === this.lastSpoken && now - this.lastSpokeAt < 15000) return;
    this.lastSpoken = text;
    this.lastSpokeAt = now;

    synth.cancel();
    const u = new SpeechSynthesisUtterance(stripMarkup(text));
    u.rate = 1.05;
    u.pitch = urgent ? 0.9 : 1.0;
    u.volume = Math.min(1, this.volume);
    synth.speak(u);
  }

  /** Everything off, for the pause menu and for quitting. */
  silence(): void {
    window.speechSynthesis?.cancel();
  }
}

/** Notices carry a little markup for the on-screen version; speech wants none. */
function stripMarkup(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
