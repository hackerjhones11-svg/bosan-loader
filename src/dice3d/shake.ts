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
}

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

  const jolts: Jolt[] = [];
  const joltCount = 4 + Math.floor(random() * 3);
  for (let i = 0; i < joltCount; i++) {
    const span = timing.shakeEnd - 0.35 - timing.buildUp;
    const t = timing.buildUp + ((i + 0.2 + random() * 0.6) / joltCount) * span;
    const angle = random() * Math.PI * 2;
    const mag = g * (1.0 + random() * 0.8);
    jolts.push({
      t,
      width: 0.06 + random() * 0.05,
      x: Math.cos(angle) * mag,
      z: Math.sin(angle) * mag,
      y: g * (0.7 + random() * 0.5),
    });
  }

  const envelope = (t: number): number => {
    if (t <= 0) return 0;
    const rise = smooth(t / timing.buildUp);
    const fall = 1 - smooth((t - timing.shakeEnd) / timing.shakeFade);
    return rise * fall;
  };

  const stroke = (t: number) => {
    const theta = axis0 + drift * t + 0.38 * Math.sin(2 * Math.PI * 0.21 * t + wanderPhase);
    const swell = 1 + 0.22 * Math.sin(2 * Math.PI * 0.47 * t + swellPhase);
    const amp = strength * g * swell * envelope(t);
    const w0 = 2 * Math.PI * f0;
    const w1 = 2 * Math.PI * f1;
    const c0 = Math.cos(w0 * t + phase0);
    const c1 = Math.cos(w1 * t + phase1);
    return { theta, amp, w0, w1, c0, c1 };
  };

  return {
    envelope,
    accel(t, out) {
      const { theta, amp, c0, c1 } = stroke(t);
      const ax = Math.cos(theta);
      const az = Math.sin(theta);
      out.x = amp * (c0 * ax - crossRatio * c1 * az);
      out.z = amp * (c0 * az + crossRatio * c1 * ax);
      out.y = 0;
      for (const j of jolts) {
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
  };
}
