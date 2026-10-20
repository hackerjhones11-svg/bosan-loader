import { ROLL_TIMING } from '../game/rollTiming';
import type { TrayDims } from './trayConfig';
import type { VisualRandom } from './visualRandom';

/**
 * The hands shaking the tray, as ONE shared acceleration signal a(t) of the
 * tray. Every die feels the same pseudo-force −m·a(t) in tray space (which is
 * exactly what a rigid, translating box does to loose objects inside it);
 * their different paths come from contacts, friction, spin and collisions,
 * not from per-die random pushes.
 *
 * Shape of a shake:
 * - a dominant back-and-forth stroke near 2 Hz along an axis that drifts and
 *   leans toward the tray's long side, plus a weaker cross-stroke at an
 *   unrelated frequency, so the motion is elliptical and never periodic;
 * - slow amplitude swell, like a person's arms;
 * - a few irregular jolts: a sideways shove while the tray briefly dips and
 *   catches, which lets dice go light and hop;
 * - a smooth envelope: build-up, sustain, then the hands stop.
 *
 * All parameters are drawn once per roll from the visual-only RNG, so no two
 * rolls replay the same choreography. Nothing here touches the outcome.
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

interface Jolt {
  t: number;
  width: number;
  x: number;
  y: number;
  z: number;
}

export interface Shake {
  /** Tray acceleration at time t (die units / s²). */
  accel(t: number, out: Vec3Like): Vec3Like;
  /** Small visual offset of the tray at time t, consistent with accel. */
  offset(t: number, out: Vec3Like): Vec3Like;
  /** 0..1 shake strength at time t (for audio and diagnostics). */
  envelope(t: number): number;
  /**
   * From t0 on, the hands carry on differently: the stroke axis, strength and
   * cross-stroke phase drift to new values and the jolts still to come are
   * re-drawn. Everything before t0 is unchanged and nothing jumps at t0, so
   * any number of continuations can be tried from the same moment. Calling it
   * again replaces the previous continuation; `null` restores the original.
   */
  diverge(t0: number, random: VisualRandom | null): void;
}

interface Divergence {
  t0: number;
  axisShift: number;
  ampScale: number;
  phaseShift: number;
  jolts: Jolt[];
}

/** How long a continuation takes to blend from the original shake into its own. */
const DIVERGE_BLEND = 0.35;

export interface ShakeOptions {
  gravity: number;
  timing?: typeof ROLL_TIMING;
  /** Peak stroke acceleration as a multiple of gravity. */
  strength?: number;
  /** How much of the tray's computed displacement is shown (keeps the view calm). */
  visualScale?: number;
}

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

export function createShake(dims: TrayDims, random: VisualRandom, options: ShakeOptions): Shake {
  const timing = options.timing ?? ROLL_TIMING;
  const g = options.gravity;
  const strength = (options.strength ?? 1.75) * (0.9 + random() * 0.2);
  const visualScale = options.visualScale ?? 0.1;

  const f0 = 1.75 + random() * 0.55;
  const f1 = f0 * (1.38 + random() * 0.25);
  const crossRatio = 0.32 + random() * 0.2;
  const phase0 = random() * Math.PI * 2;
  const phase1 = random() * Math.PI * 2;
  const swellPhase = random() * Math.PI * 2;
  const longAxis = dims.halfWidth >= dims.halfDepth ? 0 : Math.PI / 2;
  const axis0 = longAxis + (random() - 0.5) * 1.1;
  const wanderPhase = random() * Math.PI * 2;
  const drift = (random() - 0.5) * 0.25;

  const drawJolt = (t: number, r: VisualRandom): Jolt => {
    const angle = r() * Math.PI * 2;
    const mag = g * (1.0 + r() * 0.8);
    return {
      t,
      width: 0.06 + r() * 0.05,
      x: Math.cos(angle) * mag,
      z: Math.sin(angle) * mag,
      y: g * (0.7 + r() * 0.5),
    };
  };
  const joltsUntil = timing.shakeEnd - 0.35;
  const jolts: Jolt[] = [];
  const joltCount = 4 + Math.floor(random() * 3);
  for (let i = 0; i < joltCount; i++) {
    const span = joltsUntil - timing.buildUp;
    jolts.push(drawJolt(timing.buildUp + ((i + 0.2 + random() * 0.6) / joltCount) * span, random));
  }
  let branch: Divergence | null = null;

  const envelope = (t: number): number => {
    if (t <= 0) return 0;
    const rise = smooth(t / timing.buildUp);
    const fall = 1 - smooth((t - timing.shakeEnd) / timing.shakeFade);
    return rise * fall;
  };

  const stroke = (t: number) => {
    const blend = branch && t > branch.t0 ? smooth((t - branch.t0) / DIVERGE_BLEND) : 0;
    let theta = axis0 + drift * t + 0.38 * Math.sin(2 * Math.PI * 0.21 * t + wanderPhase);
    const swell = 1 + 0.22 * Math.sin(2 * Math.PI * 0.47 * t + swellPhase);
    let amp = strength * g * swell * envelope(t);
    let crossPhase = phase1;
    if (branch && blend > 0) {
      theta += branch.axisShift * blend;
      amp *= 1 + (branch.ampScale - 1) * blend;
      crossPhase += branch.phaseShift * blend;
    }
    const w0 = 2 * Math.PI * f0;
    const w1 = 2 * Math.PI * f1;
    const c0 = Math.cos(w0 * t + phase0);
    const c1 = Math.cos(w1 * t + crossPhase);
    return { theta, amp, w0, w1, c0, c1 };
  };
  /** Jolts in effect: the original ones, with those after a divergence point re-drawn. */
  const activeJolts = (t: number): readonly Jolt[] => (branch && t > branch.t0 ? branch.jolts : jolts);

  return {
    envelope,
    accel(t, out) {
      const { theta, amp, c0, c1 } = stroke(t);
      const ax = Math.cos(theta);
      const az = Math.sin(theta);
      out.x = amp * (c0 * ax - crossRatio * c1 * az);
      out.z = amp * (c0 * az + crossRatio * c1 * ax);
      out.y = 0;
      for (const j of activeJolts(t)) {
        const u = (t - j.t) / j.width;
        if (u < 0 || u > 1) continue;
        const env = envelope(t);
        out.x += j.x * Math.sin(Math.PI * u) * env;
        out.z += j.z * Math.sin(Math.PI * u) * env;
        // Dice feel −a: the tray dips (dice go light and hop), then catches
        // them again, so the jolt leaves no net vertical velocity.
        out.y -= j.y * Math.sin(2 * Math.PI * u) * env;
      }
      return out;
    },
    offset(t, out) {
      // For a sinusoidal stroke, displacement = −a/ω². Only the strokes are
      // shown; the visual is scaled down so the tray trembles rather than lurches.
      const { theta, amp, w0, w1, c0, c1 } = stroke(t);
      const ax = Math.cos(theta);
      const az = Math.sin(theta);
      const d0 = -(amp * c0) / (w0 * w0);
      const d1 = -(amp * crossRatio * c1) / (w1 * w1);
      out.x = visualScale * (d0 * ax - d1 * az);
      out.z = visualScale * (d0 * az + d1 * ax);
      out.y = 0;
      return out;
    },
    diverge(t0, r) {
      if (!r) {
        branch = null;
        return;
      }
      // Jolts already under way at t0 carry on; the ones still to come are re-drawn.
      const kept = jolts.filter((j) => j.t <= t0);
      const remaining = jolts.length - kept.length;
      const fresh: Jolt[] = [];
      const from = t0 + 0.08;
      const count = Math.max(0, remaining + Math.floor(r() * 3) - 1);
      if (joltsUntil > from) {
        for (let i = 0; i < count; i++) fresh.push(drawJolt(from + ((i + 0.15 + r() * 0.7) / count) * (joltsUntil - from), r));
      }
      branch = {
        t0,
        axisShift: (r() - 0.5) * 1.2,
        ampScale: 0.9 + r() * 0.22,
        phaseShift: (r() - 0.5) * 2 * Math.PI,
        jolts: [...kept, ...fresh],
      };
    },
  };
}
