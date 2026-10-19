import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Faces } from '../game/roll';
import { upwardFace } from './faceMap';
import { gridLayout } from './layout';
import { RollAnimation } from './rollAnimation';
import { planRoll, samplePlan, type RollPlan } from './rollPlanner';
import { DIE_HALF, TRAY_PRESETS } from './trayConfig';
import { seededVisualRandom } from './visualRandom';

const OUTCOMES: Faces[] = [
  ['jhandi', 'burja', 'itta', 'paan', 'hukum', 'chidi'],
  ['paan', 'paan', 'paan', 'paan', 'paan', 'paan'],
  ['chidi', 'jhandi', 'chidi', 'burja', 'itta', 'chidi'],
];

function finalPoseOf(plan: RollPlan, die: number) {
  const p = new Vector3();
  const q = new Quaternion();
  samplePlan(plan, die, plan.duration, p, q);
  return { p, q };
}

/** Horizontal edge directions of an upright die (the two local axes lying in the felt plane). */
function footprintAxes(q: Quaternion): Vector3[] {
  return [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
    .map((a) => a.applyQuaternion(q))
    .filter((a) => Math.abs(a.y) < 0.5)
    .map((a) => a.setY(0).normalize());
}

/** Separating-axis test for two unit squares on the felt; returns penetration depth (≤ 0 = apart). */
function footprintOverlap(p1: Vector3, q1: Quaternion, p2: Vector3, q2: Quaternion): number {
  const a1 = footprintAxes(q1);
  const a2 = footprintAxes(q2);
  const d = p2.clone().sub(p1).setY(0);
  let depth = Infinity;
  for (const axis of [...a1, ...a2]) {
    const r1 = a1.reduce((s, e) => s + DIE_HALF * Math.abs(axis.dot(e)), 0);
    const r2 = a2.reduce((s, e) => s + DIE_HALF * Math.abs(axis.dot(e)), 0);
    depth = Math.min(depth, r1 + r2 - Math.abs(d.dot(axis)));
  }
  return depth;
}

function assertPlanLandsOn(plan: RollPlan, faces: Faces) {
  const { halfWidth, halfDepth } = plan.dims;
  for (let i = 0; i < 6; i++) {
    const { p, q } = finalPoseOf(plan, i);
    const up = upwardFace(q);
    expect(up.symbol).toBe(faces[i]);
    expect(up.alignment).toBeGreaterThan(0.99999);
    expect(p.y).toBeCloseTo(DIE_HALF, 4);
    expect(Math.abs(p.x)).toBeLessThanOrEqual(halfWidth - DIE_HALF + 0.035);
    expect(Math.abs(p.z)).toBeLessThanOrEqual(halfDepth - DIE_HALF + 0.035);
    // Exact final pose in the plan agrees with the last track sample.
    expect(upwardFace(plan.finalPoses[i].quaternion).symbol).toBe(faces[i]);
    for (let j = i + 1; j < 6; j++) {
      const other = finalPoseOf(plan, j);
      // Resting dice may touch but never intersect (tiny solver slop allowed).
      expect(footprintOverlap(p, q, other.p, other.q)).toBeLessThan(0.02);
    }
  }
}

describe('roll planner', () => {
  it('physics throws land exactly on the recorded faces, flat, separate and inside the tray', () => {
    let seed = 1;
    for (const dims of Object.values(TRAY_PRESETS)) {
      for (const faces of OUTCOMES) {
        for (let k = 0; k < 4; k++) {
          const plan = planRoll(faces, dims, { random: seededVisualRandom(seed++) });
          assertPlanLandsOn(plan, faces);
          expect(plan.duration).toBeGreaterThan(0.5);
          expect(plan.duration).toBeLessThanOrEqual(4);
        }
      }
    }
  }, 60000);

  it('the procedural fallback also lands exactly on the recorded faces', () => {
    for (const dims of Object.values(TRAY_PRESETS)) {
      for (const faces of OUTCOMES) {
        const plan = planRoll(faces, dims, { random: seededVisualRandom(7), forceProcedural: true });
        expect(plan.source).toBe('procedural');
        assertPlanLandsOn(plan, faces);
      }
    }
  });

  it('playback ends on the plan final poses whatever the frame timing', () => {
    const faces = OUTCOMES[2];
    const dims = TRAY_PRESETS.wide;
    const plan = planRoll(faces, dims, { random: seededVisualRandom(99) });
    for (const reduced of [false, true]) {
      const anim = new RollAnimation('r', plan, gridLayout(faces, dims), reduced);
      const positions = Array.from({ length: 6 }, () => new Vector3());
      const quaternions = Array.from({ length: 6 }, () => new Quaternion());
      for (const t of [anim.total, anim.total + 0.016, anim.total + 10, Infinity]) {
        const { done, scale } = anim.sample(t, positions, quaternions);
        expect(done).toBe(true);
        expect(scale).toBe(1);
        quaternions.forEach((q, i) => expect(upwardFace(q).symbol).toBe(faces[i]));
      }
      expect(anim.settleAt).toBeLessThan(anim.total);
      if (!reduced) {
        expect(anim.total).toBeGreaterThan(1);
        expect(anim.total).toBeLessThan(4.5);
      } else {
        expect(anim.total).toBeLessThan(0.5);
      }
    }
  });
});
