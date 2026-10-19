import { Quaternion, Vector3 } from 'three';
import { samplePlan, type DiePose, type RollPlan } from './rollPlanner';

/** Dice are scooped up from where they rest into the launch cluster before the throw. */
export const GATHER_SECONDS = 0.34;
const REDUCED_OUT_SECONDS = 0.14;
const REDUCED_IN_SECONDS = 0.24;

function smoothstep(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/**
 * Time-based playback of a RollPlan, independent of frame rate. Sampling at
 * any t ≥ total yields exactly plan.finalPoses, so a late frame, a skipped
 * frame or an early finish can never show a different face.
 *
 * Reduced motion replaces the gather and tumble with a quick shrink, swap and
 * grow at the same final poses.
 */
export class RollAnimation {
  readonly total: number;
  /** Seconds from start when motion becomes gentle (Rolling → Settling). */
  readonly settleAt: number;
  /** Seconds from start when the physics throw begins (for sound scheduling). */
  readonly throwStart: number;

  private readonly from: DiePose[];
  private readonly launch: DiePose[];

  constructor(
    readonly rollId: string,
    readonly plan: RollPlan,
    from: readonly DiePose[],
    readonly reduced: boolean,
  ) {
    this.from = from.map((p) => ({ position: p.position.clone(), quaternion: p.quaternion.clone() }));
    this.launch = plan.tracks.map((_, i) => {
      const position = new Vector3();
      const quaternion = new Quaternion();
      samplePlan(plan, i, 0, position, quaternion);
      return { position, quaternion };
    });
    if (reduced) {
      this.throwStart = 0;
      this.total = REDUCED_OUT_SECONDS + REDUCED_IN_SECONDS;
      this.settleAt = REDUCED_OUT_SECONDS;
    } else {
      this.throwStart = GATHER_SECONDS;
      this.total = GATHER_SECONDS + plan.duration;
      this.settleAt = GATHER_SECONDS + plan.settleAt;
    }
  }

  sample(t: number, outP: Vector3[], outQ: Quaternion[]): { scale: number; done: boolean } {
    if (t >= this.total) {
      this.plan.finalPoses.forEach((pose, i) => {
        outP[i].copy(pose.position);
        outQ[i].copy(pose.quaternion);
      });
      return { scale: 1, done: true };
    }

    if (this.reduced) {
      if (t < REDUCED_OUT_SECONDS) {
        this.from.forEach((pose, i) => {
          outP[i].copy(pose.position);
          outQ[i].copy(pose.quaternion);
        });
        return { scale: 1 - smoothstep(t / REDUCED_OUT_SECONDS) * 0.999, done: false };
      }
      this.plan.finalPoses.forEach((pose, i) => {
        outP[i].copy(pose.position);
        outQ[i].copy(pose.quaternion);
      });
      return { scale: 0.001 + smoothstep((t - REDUCED_OUT_SECONDS) / REDUCED_IN_SECONDS) * 0.999, done: false };
    }

    if (t < GATHER_SECONDS) {
      const k = smoothstep(t / GATHER_SECONDS);
      for (let i = 0; i < this.from.length; i++) {
        const a = this.from[i].position;
        const b = this.launch[i].position;
        const lift = Math.max(a.y, b.y) + 0.9 + (i % 3) * 0.15;
        // Quadratic Bézier through a raised control point: the dice are lifted, not slid.
        const u = 1 - k;
        outP[i].set(
          u * u * a.x + 2 * u * k * ((a.x + b.x) / 2) + k * k * b.x,
          u * u * a.y + 2 * u * k * lift + k * k * b.y,
          u * u * a.z + 2 * u * k * ((a.z + b.z) / 2) + k * k * b.z,
        );
        outQ[i].slerpQuaternions(this.from[i].quaternion, this.launch[i].quaternion, k);
      }
      return { scale: 1, done: false };
    }

    const throwT = t - GATHER_SECONDS;
    for (let i = 0; i < this.plan.tracks.length; i++) samplePlan(this.plan, i, throwT, outP[i], outQ[i]);
    return { scale: 1, done: false };
  }
}
