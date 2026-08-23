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
  volume = Number(localStorage.getItem(MASTER_KEY) ?? '0.7');
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
