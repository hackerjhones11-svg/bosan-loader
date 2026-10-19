import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Faces } from '../game/roll';
import { ROLL_TIMING } from '../game/rollTiming';
import { SYMBOL_IDS } from '../game/symbols';
import { createDieShape, VISUAL_CORNER_RADIUS } from './dieCollider';
import { DiceSimulation, PHYSICS } from './diceSimulation';
import { upwardFace } from './faceMap';
import { gridLayout } from './layout';
import { createShake } from './shake';
import { DIE_HALF, TRAY_PRESETS } from './trayConfig';
import { seededVisualRandom } from './visualRandom';

const OUTCOMES: Faces[] = [
  ['jhandi', 'burja', 'itta', 'paan', 'hukum', 'chidi'],
  ['paan', 'paan', 'paan', 'paan', 'paan', 'paan'],
  ['chidi', 'jhandi', 'chidi', 'burja', 'itta', 'chidi'],
];

const HULL = createDieShape().vertices.map((v) => new Vector3(v.x, v.y, v.z));

/** Horizontal edge directions of an upright die (the two local axes lying in the felt plane). */
function footprintAxes(q: Quaternion): Vector3[] {
  return [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
    .map((a) => a.applyQuaternion(q))
    .filter((a) => Math.abs(a.y) < 0.5)
    .map((a) => a.setY(0).normalize());
}

/** Separating-axis test for two upright unit dice on the felt; penetration depth (≤ 0 = apart). */
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

function run(faces: Faces, preset: keyof typeof TRAY_PRESETS, seed: number) {
  const dims = TRAY_PRESETS[preset];
  const start = gridLayout(SYMBOL_IDS, dims);
  const sim = new DiceSimulation(faces, dims, start, { random: seededVisualRandom(seed) });
  sim.runToEnd();
  return { sim, dims, start };
}

describe('dice simulation: outcomes', () => {
  const cases = (Object.keys(TRAY_PRESETS) as (keyof typeof TRAY_PRESETS)[]).flatMap((preset, p) =>
    OUTCOMES.map((faces, o) => ({ preset, faces, seed: 100 + p * 10 + o })),
  );

  it.each(cases)('$preset tray lands exactly on $faces', ({ preset, faces, seed }) => {
    const { sim, dims } = run(faces, preset, seed);
    expect(sim.done).toBe(true);
    expect(sim.wrongDice()).toEqual([]);
    const finals = sim.finalPoses();
    finals.forEach((pose, i) => {
      const up = upwardFace(pose.quaternion);
      expect(up.symbol).toBe(faces[i]);
      expect(up.alignment).toBeGreaterThan(0.995);
      expect(pose.position.y).toBeCloseTo(DIE_HALF, 1);
      expect(Math.abs(pose.position.x)).toBeLessThanOrEqual(dims.halfWidth - DIE_HALF + 0.05);
      expect(Math.abs(pose.position.z)).toBeLessThanOrEqual(dims.halfDepth - DIE_HALF + 0.05);
      for (let j = i + 1; j < 6; j++) {
        expect(footprintOverlap(pose.position, pose.quaternion, finals[j].position, finals[j].quaternion)).toBeLessThan(0.03);
      }
    });
    // Rest falls in the settling window and the roll always ends within its hard bound.
    expect(sim.restAt!).toBeGreaterThan(ROLL_TIMING.shakeEnd);
    expect(sim.restAt!).toBeLessThan(ROLL_TIMING.hardStop + 1.3);
  });
});

describe('dice simulation: continuity and containment', () => {
  const { sim, dims, start } = run(OUTCOMES[2], 'wide', 7);
  const p = new Vector3();
  const q = new Quaternion();

  it('starts exactly where the dice were resting (no teleport at roll start)', () => {
    start.forEach((pose, i) => {
      sim.sample(i, 0, p, q);
      expect(p.distanceTo(pose.position)).toBeLessThan(1e-4);
      expect(q.angleTo(pose.quaternion)).toBeLessThan(1e-3);
    });
  });

  it('ends on the final resting pose (no snap at the end)', () => {
    sim.finalPoses().forEach((pose, i) => {
      sim.sample(i, sim.restAt!, p, q);
      expect(p.distanceTo(pose.position)).toBeLessThan(1e-4);
      expect(q.angleTo(pose.quaternion)).toBeLessThan(1e-3);
      sim.sample(i, sim.restAt! + 5, p, q);
      expect(p.distanceTo(pose.position)).toBeLessThan(1e-4);
    });
  });

  it('keeps every corner on the felt, inside the walls and under the lid', () => {
    for (let k = 0; k < sim.sampleCount; k += 3) {
      for (let i = 0; i < 6; i++) {
        sim.sample(i, k * sim.step, p, q);
        for (const v of HULL) {
          const w = v.clone().applyQuaternion(q).add(p);
          expect(w.y).toBeGreaterThan(-0.12);
          expect(w.y).toBeLessThan(PHYSICS.lidHeight + 0.05);
          expect(Math.abs(w.x)).toBeLessThan(dims.halfWidth + 0.12);
          expect(Math.abs(w.z)).toBeLessThan(dims.halfDepth + 0.12);
        }
      }
    }
  });

  it('moves every die around the tray rather than spinning it in place', () => {
    const paths = sim.pathLengths();
    for (const length of paths) expect(length).toBeGreaterThan(5);
    // Dice cross the middle: some die is seen on both the left and right halves.
    let crossed = false;
    for (let i = 0; i < 6 && !crossed; i++) {
      let left = false;
      let right = false;
      for (let k = 0; k < sim.sampleCount; k += 6) {
        sim.sample(i, k * sim.step, p, q);
        if (p.x < -1) left = true;
        if (p.x > 1) right = true;
      }
      crossed = left && right;
    }
    expect(crossed).toBe(true);
  });

  it('produces real wall and die-to-die impacts for the sound to follow', () => {
    expect(sim.impacts.filter((e) => e.surface === 'wall').length).toBeGreaterThan(5);
    expect(sim.impacts.filter((e) => e.surface === 'die').length).toBeGreaterThan(5);
    for (let k = 1; k < sim.impacts.length; k++) expect(sim.impacts[k].t).toBeGreaterThanOrEqual(sim.impacts[k - 1].t);
  });
});

describe('shake signal', () => {
  const dims = TRAY_PRESETS.wide;
  const shake = createShake(dims, seededVisualRandom(3), { gravity: PHYSICS.gravity });
  const a = { x: 0, y: 0, z: 0 };

  it('builds up from rest, sustains, then stops when the hands stop', () => {
    shake.accel(0, a);
    expect(Math.hypot(a.x, a.y, a.z)).toBe(0);
    expect(shake.envelope(ROLL_TIMING.buildUp / 2)).toBeGreaterThan(0);
    expect(shake.envelope(ROLL_TIMING.buildUp / 2)).toBeLessThan(1);
    expect(shake.envelope(2)).toBeCloseTo(1, 5);
    const after = ROLL_TIMING.shakeEnd + ROLL_TIMING.shakeFade + 0.01;
    shake.accel(after, a);
    expect(Math.hypot(a.x, a.y, a.z)).toBe(0);
  });

  it('is strong enough to throw dice about, and the tray only trembles visually', () => {
    let peak = 0;
    let offset = 0;
    const o = { x: 0, y: 0, z: 0 };
    for (let t = 0; t < ROLL_TIMING.shakeEnd; t += 0.005) {
      shake.accel(t, a);
      peak = Math.max(peak, Math.hypot(a.x, a.z));
      shake.offset(t, o);
      offset = Math.max(offset, Math.hypot(o.x, o.z));
    }
    expect(peak).toBeGreaterThan(PHYSICS.gravity);
    expect(offset).toBeGreaterThan(0.01);
    expect(offset).toBeLessThan(0.2);
  });

  it('changes from roll to roll', () => {
    const other = createShake(dims, seededVisualRandom(4), { gravity: PHYSICS.gravity });
    const b = { x: 0, y: 0, z: 0 };
    shake.accel(1.234, a);
    other.accel(1.234, b);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1);
  });
});

describe('die collider', () => {
  it('is a closed chamfered cube that wraps the rounded visual die', () => {
    const shape = createDieShape();
    expect(shape.vertices).toHaveLength(24);
    expect(shape.faces).toHaveLength(26);
    // Every face plane lies at or outside the rounded cube's surface.
    const r = VISUAL_CORNER_RADIUS;
    const core = DIE_HALF - r;
    for (let f = 0; f < shape.faces.length; f++) {
      const n = shape.faceNormals[f];
      const v = shape.vertices[shape.faces[f][0]];
      const planeDistance = n.dot(v);
      // Support of a rounded cube in direction n: support of the inner box plus r.
      const support = core * (Math.abs(n.x) + Math.abs(n.y) + Math.abs(n.z)) + r;
      expect(planeDistance).toBeGreaterThanOrEqual(support - 1e-6);
    }
  });
});
