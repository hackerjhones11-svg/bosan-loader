import { visualRandom } from '../dice3d/visualRandom';

/**
 * Procedural dice audio via Web Audio: no files, no network, no autoplay.
 *
 * Layers, all driven by what the dice are physically doing:
 * - impact(): one short percussive voice per real collision reported by the
 *   simulation: bright clacks for die-on-die, woody knocks for the rim,
 *   muffled taps for the felt. Volume follows impact speed, pitch varies a
 *   little, repeats per die are throttled and simultaneous voices are capped.
 * - setActivity(): a soft felt "slide" bed plus tiny irregular rattle grains
 *   whose density follows how vigorously the dice are moving, so the texture
 *   builds with the shake, thins as the dice coast, and is silent at rest.
 *
 * Everything goes through a per-roll bus into a compressor, so a new roll,
 * mute, tab switch or unmount can silence all of it at once and loud
 * clusters never clip. Every public method swallows errors: audio is
 * optional and must never block a roll.
 */

export type ImpactKind = 'die' | 'wall' | 'felt';

/** Minimum gap between two sounds from the same die on the same kind of surface. */
const PER_DIE_GAP = 0.035;
/** Hard cap on overlapping voices. */
const MAX_VOICES = 18;
/** Impacts softer than this (die units / s along the normal) are inaudible. */
const MIN_STRENGTH: Record<ImpactKind, number> = { die: 0.7, wall: 0.9, felt: 1.2 };
/** Strength at which a voice reaches full level. */
const FULL_STRENGTH: Record<ImpactKind, number> = { die: 14, wall: 16, felt: 18 };

interface Tone {
  band: number;
  q: number;
  noiseDecay: number;
  partials: readonly (readonly [ratio: number, gain: number, decay: number])[];
  base: number;
  level: number;
  lowpass: number;
}

// Modal partials are deliberately inharmonic so impacts read as solid
// objects rather than musical notes.
const TONES: Record<ImpactKind, Tone> = {
  die: {
    band: 3300,
    q: 2.4,
    noiseDecay: 0.022,
    base: 2150,
    partials: [
      [1, 0.32, 0.045],
      [1.61, 0.16, 0.028],
      [2.37, 0.07, 0.018],
    ],
    level: 0.5,
    lowpass: 9000,
  },
  wall: {
    band: 1350,
    q: 1.4,
    noiseDecay: 0.032,
    base: 560,
    partials: [
      [1, 0.36, 0.075],
      [2.31, 0.14, 0.045],
      [3.9, 0.05, 0.025],
    ],
    level: 0.55,
    lowpass: 5200,
  },
  felt: {
    band: 520,
    q: 0.9,
    noiseDecay: 0.03,
    base: 175,
    partials: [
      [1, 0.4, 0.055],
      [2.7, 0.08, 0.03],
    ],
    level: 0.38,
    lowpass: 1500,
  },
};

export class SoundEngine {
  private ctx: BaseAudioContext | null = null;
  private output: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private bus: GainNode | null = null;
  private bed: { source: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private voiceEnds: number[] = [];
  private lastByKey = new Map<string, number>();
  private grainDebt = 0;
  private lastActivityAt = 0;
  /** Identifies the roll that currently owns the bus (see beginRoll/release). */
  private session = 0;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  /** Web Audio missing or failed to start: stay silent without retrying. */
  private unavailable = false;
  /** Counters for verification and tuning (cheap; never affect playback). */
  readonly stats = { impacts: 0, grains: 0, dropped: 0, lastVoiceAt: 0, lastImpactAt: 0, rolls: 0, bedPeak: 0 };
  enabled = true;

  /** Call synchronously from a click/keydown handler so browsers allow playback. */
  unlock(): void {
    if (!this.enabled || this.unavailable) return;
    this.cancelSuspend();
    let created: AudioContext | null = null;
    try {
      if (!this.ctx) {
        if (typeof globalThis.AudioContext !== 'function') {
          this.unavailable = true;
          return;
        }
        created = new AudioContext();
        this.attach(created);
      }
      const live = this.ctx as AudioContext;
      if (live.state === 'suspended' && typeof live.resume === 'function') void live.resume().catch(() => {});
    } catch {
      // Never leak a half-built context or retry on every gesture.
      void created?.close().catch(() => {});
      this.ctx = null;
      this.unavailable = true;
    }
  }

  /**
   * Lets the audio device sleep once nothing is playing (battery on phones).
   * The next Roll gesture resumes it through unlock().
   */
  suspendSoon(delayMs = 1500): void {
    this.cancelSuspend();
    if (this.virtualTime !== null) return;
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null;
      const live = this.ctx as AudioContext | null;
      if (live && live.state === 'running' && typeof live.suspend === 'function') void live.suspend().catch(() => {});
    }, delayMs);
  }

  private cancelSuspend(): void {
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
  }

  /**
   * Wires the output chain onto a context. unlock() uses a live AudioContext;
   * tests attach an OfflineAudioContext (with `virtualTime`) to render and
   * measure a roll's soundtrack.
   */
  attach(ctx: BaseAudioContext): void {
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 14;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.14;
    const output = ctx.createGain();
    output.gain.value = 0.62;
    output.connect(compressor);
    compressor.connect(ctx.destination);
    this.ctx = ctx;
    this.output = output;
    this.noise = this.makeNoise(ctx, 2.5);
  }

  /** Test hook: when set, used as "now" instead of the context clock (for offline rendering). */
  virtualTime: number | null = null;

  private clock(): number {
    return this.virtualTime ?? this.ctx!.currentTime;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stopAll();
      this.suspendSoon(200);
    }
  }

  private makeNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = visualRandom() * 2 - 1;
    return buffer;
  }

  private live(): { ctx: BaseAudioContext; bus: GainNode; noise: AudioBuffer } | null {
    if (!this.enabled || !this.ctx || !this.output || !this.noise || this.ctx.state === 'closed') return null;
    if (!this.bus) {
      this.bus = this.ctx.createGain();
      this.bus.connect(this.output);
    }
    return { ctx: this.ctx, bus: this.bus, noise: this.noise };
  }

  private claimVoice(at: number, length: number): boolean {
    this.voiceEnds = this.voiceEnds.filter((end) => end > at);
    if (this.voiceEnds.length >= MAX_VOICES) {
      this.stats.dropped += 1;
      return false;
    }
    this.voiceEnds.push(at + length);
    this.stats.lastVoiceAt = Math.max(this.stats.lastVoiceAt, at);
    return true;
  }

  /** Current audio clock (s), or null before audio has been unlocked. */
  now(): number | null {
    return this.ctx ? this.clock() : null;
  }

  /** Whether the continuous slide/rattle texture is currently running. */
  get textureActive(): boolean {
    return this.bed !== null;
  }

  private voice(at: number, kind: ImpactKind, level: number, brightness = 1): void {
    const r = this.live();
    if (!r) return;
    const { ctx, bus, noise } = r;
    const tone = TONES[kind];
    const longest = Math.max(tone.noiseDecay, ...tone.partials.map((p) => p[2])) + 0.03;
    if (!this.claimVoice(at, longest)) return;
    const pitch = (0.93 + visualRandom() * 0.14) * brightness;

    const strike = ctx.createGain();
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = tone.lowpass * (0.6 + 0.4 * level);
    strike.connect(lowpass).connect(bus);

    // Transient: a few milliseconds of band-limited noise.
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = tone.band * pitch;
    band.Q.value = tone.q;
    const nEnv = ctx.createGain();
    nEnv.gain.setValueAtTime(0, at);
    nEnv.gain.linearRampToValueAtTime(tone.level * level, at + 0.0015);
    nEnv.gain.exponentialRampToValueAtTime(0.0001, at + tone.noiseDecay);
    src.connect(band).connect(nEnv).connect(strike);
    src.start(at, visualRandom() * (noise.duration - 0.2), tone.noiseDecay + 0.02);

    // Body: a few short, inharmonic modes.
    for (const [ratio, gain, decay] of tone.partials) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = tone.base * ratio * pitch;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(gain * tone.level * level, at + 0.001);
      env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
      osc.connect(env).connect(strike);
      osc.start(at);
      osc.stop(at + decay + 0.02);
    }
  }

  /**
   * Starts a fresh bus for a new roll, fading out anything left from the last
   * one. Returns a token for release(), so a renderer that is torn down later
   * (e.g. the 3D view replaced by the 2D fallback mid-roll) can only silence
   * its own roll, never the one that replaced it.
   */
  beginRoll(): number {
    this.stopAll();
    this.cancelSuspend();
    this.session += 1;
    const token = this.session;
    this.lastByKey.clear();
    this.grainDebt = 0;
    this.lastActivityAt = 0;
    try {
      const r = this.live();
      if (!r) return token;
      this.stats.rolls += 1;
      const { ctx, bus, noise } = r;
      const source = ctx.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 900;
      filter.Q.value = 0.8;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(bus);
      source.start(this.clock(), visualRandom() * noise.duration);
      this.bed = { source, gain, filter };
    } catch {
      this.bed = null;
    }
    return token;
  }

  /** Silences the given roll's sound if it still owns the bus. */
  release(token: number): void {
    if (token === this.session) this.stopAll();
  }

  /**
   * One collision, `delay` seconds from now (0 = immediately). Soft contacts,
   * rapid repeats from the same die and anything beyond the voice cap are dropped.
   */
  impact(delay: number, strength: number, surface: ImpactKind, die: number): void {
    try {
      if (!this.live() || strength < MIN_STRENGTH[surface]) return;
      const at = this.clock() + Math.max(0, delay) + 0.004;
      const key = `${die}:${surface}`;
      if (at - (this.lastByKey.get(key) ?? -1) < PER_DIE_GAP) {
        this.stats.dropped += 1;
        return;
      }
      this.lastByKey.set(key, at);
      this.stats.impacts += 1;
      this.stats.lastImpactAt = Math.max(this.stats.lastImpactAt, at);
      const x = (strength - MIN_STRENGTH[surface]) / (FULL_STRENGTH[surface] - MIN_STRENGTH[surface]);
      const level = Math.min(1, Math.max(0.05, x)) ** 0.75;
      this.voice(at, surface, level, surface === 'die' ? 1 : 0.97 + level * 0.06);
    } catch {
      // ignore
    }
  }

  /**
   * Continuous texture. `rattle` (0..1) is overall dice agitation, `slide` (0..1)
   * how much they are skidding on the felt. Call once per rendered frame.
   */
  setActivity(rattle: number, slide: number): void {
    try {
      const r = this.live();
      if (!r) return;
      const now = this.clock();
      const dt = this.lastActivityAt ? Math.min(0.1, now - this.lastActivityAt) : 0;
      this.lastActivityAt = now;
      if (this.bed) {
        const level = Math.min(1, slide) ** 1.4 * 0.055;
        this.stats.bedPeak = Math.max(this.stats.bedPeak, level);
        this.bed.gain.gain.setTargetAtTime(level, now, 0.06);
        this.bed.filter.frequency.setTargetAtTime(650 + 700 * Math.min(1, slide), now, 0.1);
      }
      // Irregular micro-clicks between the louder reported impacts.
      this.grainDebt += Math.min(1, rattle) ** 1.3 * 38 * dt;
      while (this.grainDebt >= 1) {
        this.grainDebt -= 1;
        const at = now + 0.01 + visualRandom() * Math.max(dt, 0.016);
        this.stats.grains += 1;
        this.voice(at, 'die', 0.05 + visualRandom() * 0.12 * rattle, 1.15 + visualRandom() * 0.35);
      }
    } catch {
      // ignore
    }
  }

  /** The dice are still: fade the texture; impacts already scheduled ring out. */
  endRoll(): void {
    try {
      if (this.ctx && this.bed) {
        const now = this.clock();
        this.bed.gain.gain.cancelScheduledValues(now);
        this.bed.gain.gain.setTargetAtTime(0, now, 0.05);
        const bed = this.bed;
        bed.source.stop(now + 0.4);
      }
    } catch {
      // ignore
    }
    this.bed = null;
    this.grainDebt = 0;
    this.suspendSoon(2000);
  }

  /** A soft, low wooden tone as the result is revealed. */
  playReveal(): void {
    try {
      const r = this.live();
      if (!r) return;
      const { ctx, bus } = r;
      const t = this.clock() + 0.01;
      for (const [freq, delay, gain] of [
        [523.25, 0, 0.05],
        [784, 0.09, 0.035],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, t + delay);
        env.gain.linearRampToValueAtTime(gain, t + delay + 0.006);
        env.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.45);
        osc.connect(env).connect(bus);
        osc.start(t + delay);
        osc.stop(t + delay + 0.5);
      }
    } catch {
      // ignore
    }
  }

  /** Silences everything immediately (new roll, mute, tab hidden, unmount). */
  stopAll(): void {
    try {
      this.bed?.source.stop();
    } catch {
      // ignore
    }
    this.bed = null;
    try {
      if (this.bus && this.ctx) {
        const old = this.bus;
        const now = this.clock();
        old.gain.cancelScheduledValues(now);
        old.gain.setValueAtTime(old.gain.value, now);
        old.gain.linearRampToValueAtTime(0, now + 0.03);
        setTimeout(() => old.disconnect(), 80);
      }
    } catch {
      // ignore
    }
    this.bus = null;
    this.voiceEnds = [];
  }
}

export const soundEngine = new SoundEngine();
