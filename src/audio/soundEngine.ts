/**
 * Procedural dice sounds via Web Audio: no audio files, no network.
 *
 * - The AudioContext is created lazily inside a user gesture (unlock()), so
 *   nothing ever autoplays.
 * - Every public method swallows errors: audio problems must never block or
 *   delay a roll.
 * - Impacts are scheduled on the audio clock from the physics plan's collision
 *   times, so sounds line up with what is on screen.
 */

export type ImpactKind = 'die' | 'wall' | 'felt';

export interface ScheduledImpact {
  /** Seconds after the throw begins. */
  t: number;
  strength: number;
  surface: ImpactKind;
}

interface Voice {
  stop(): void;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private current: GainNode | null = null;
  enabled = true;

  /** Call synchronously from a click/keydown handler. */
  unlock(): void {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        const Ctor: typeof AudioContext | undefined =
          globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(this.ctx.destination);
        this.noise = this.makeNoise(this.ctx);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    } catch {
      this.ctx = null;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stopAll();
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 0.25);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Deterministic LCG noise: this is texture for a sound, not randomness for outcomes.
    let seed = 22695477;
    for (let i = 0; i < length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    return buffer;
  }

  private ready(): { ctx: AudioContext; bus: GainNode; noise: AudioBuffer } | null {
    if (!this.enabled || !this.ctx || !this.master || !this.noise || this.ctx.state === 'closed') return null;
    if (!this.current) {
      this.current = this.ctx.createGain();
      this.current.connect(this.master);
    }
    return { ctx: this.ctx, bus: this.current, noise: this.noise };
  }

  private click(at: number, strength: number, surface: ImpactKind): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, bus, noise } = r;
    const level = Math.min(1, strength / 9);
    if (level < 0.04) return;
    const tone = {
      die: { band: 3100, q: 5, decay: 0.035, pitch: 2150, gain: 0.5 },
      wall: { band: 1250, q: 3.2, decay: 0.06, pitch: 520, gain: 0.55 },
      felt: { band: 700, q: 1.4, decay: 0.05, pitch: 190, gain: 0.32 },
    }[surface];
    const jitter = 0.92 + ((at * 7919) % 1) * 0.16;

    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = tone.band * jitter;
    filter.Q.value = tone.q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(tone.gain * level, at + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, at + tone.decay);
    src.connect(filter).connect(env).connect(bus);
    src.start(at, ((at * 1000) % 200) / 1000, tone.decay + 0.02);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = tone.pitch * jitter;
    const oscEnv = ctx.createGain();
    oscEnv.gain.setValueAtTime(0, at);
    oscEnv.gain.linearRampToValueAtTime(tone.gain * 0.35 * level, at + 0.002);
    oscEnv.gain.exponentialRampToValueAtTime(0.0001, at + tone.decay * 1.4);
    osc.connect(oscEnv).connect(bus);
    osc.start(at);
    osc.stop(at + tone.decay * 1.5 + 0.02);
  }

  /** Rattle while the dice are gathered, then the planned impacts. */
  playRoll(impacts: readonly ScheduledImpact[], throwDelay: number, rattle: boolean): Voice {
    const voice = { stop: () => this.stopAll() };
    try {
      this.stopAll();
      const r = this.ready();
      if (!r) return voice;
      const start = r.ctx.currentTime + 0.02;
      if (rattle) {
        for (let i = 0; i < 7; i++) this.click(start + (i / 7) * throwDelay * 0.9, 2.5 + (i % 3), 'die');
      }
      // Busy throws produce dozens of contacts; cap voices so the mix stays crisp.
      const sorted = [...impacts].sort((a, b) => b.strength - a.strength).slice(0, 36);
      for (const impact of sorted) this.click(start + throwDelay + impact.t, impact.strength, impact.surface);
    } catch {
      // ignore: sound is optional
    }
    return voice;
  }

  /** Soft two-note wooden cue when the result is shown. */
  playSettle(): void {
    try {
      const r = this.ready();
      if (!r) return;
      const { ctx, bus } = r;
      const t = ctx.currentTime + 0.01;
      [
        [587.33, 0],
        [880, 0.07],
      ].forEach(([freq, delay]) => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, t + delay);
        env.gain.linearRampToValueAtTime(0.07, t + delay + 0.005);
        env.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.35);
        osc.connect(env).connect(bus);
        osc.start(t + delay);
        osc.stop(t + delay + 0.4);
      });
    } catch {
      // ignore
    }
  }

  /** Silences everything scheduled so far (tab hidden, mute, new roll). */
  stopAll(): void {
    try {
      if (this.current && this.ctx) {
        const old = this.current;
        old.gain.setValueAtTime(old.gain.value, this.ctx.currentTime);
        old.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.03);
        setTimeout(() => old.disconnect(), 80);
      }
    } catch {
      // ignore
    }
    this.current = null;
  }
}

export const soundEngine = new SoundEngine();
