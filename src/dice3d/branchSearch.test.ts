import { describe, expect, it } from 'vitest';
import type { Faces } from '../game/roll';
import { ROLL_TIMING } from '../game/rollTiming';
import { SYMBOL_IDS } from '../game/symbols';
import { BranchSearch, branchCandidates, posesToPlain } from './branchSearch';
import { DiceSimulation, PHYSICS, stateHash } from './diceSimulation';
import { upwardFace } from './faceMap';
import { gridLayout } from './layout';
import { createShake } from './shake';
import { TRAY_PRESETS } from './trayConfig';
import { seededVisualRandom } from './visualRandom';

const FACES: Faces = ['paan', 'paan', 'itta', 'chidi', 'jhandi', 'burja'];
const dims = TRAY_PRESETS.wide;
const start = gridLayout(SYMBOL_IDS, dims);

/** Every recorded sample from `fromSample` on, for two runs. */
function sameTracks(a: DiceSimulation, b: DiceSimulation, fromSample: number): boolean {
  if (a.sampleCount !== b.sampleCount) return false;
  const ta = (a as unknown as { tracks: Float32Array[] }).tracks;
  const tb = (b as unknown as { tracks: Float32Array[] }).tracks;
  for (let i = 0; i < 6; i++) {
    for (let k = fromSample * 7; k < a.sampleCount * 7; k++) if (ta[i][k] !== tb[i][k]) return false;
  }
  return true;
}

describe('branching a roll', () => {
  it('continues bit-for-bit identically from a snapshot restored into another simulation', () => {
    for (const seed of [11, 12, 13]) {
      const a = new DiceSimulation(FACES, dims, start, { seed });
      a.advanceTo(ROLL_TIMING.branchAt);
      // Through structured data, as it travels to a worker.
      const snap = JSON.parse(JSON.stringify(a.snapshot()));
      a.chooseBranch(500 + seed);
      a.runToEnd();

      const b = new DiceSimulation(FACES, dims, start, { seed });
      b.restore(snap);
      b.chooseBranch(500 + seed);
      b.runToEnd();

      expect(b.restAt).toBe(a.restAt);
      expect(b.stats).toEqual(a.stats);
      expect(b.score()).toBe(a.score());
      expect(b.impacts.filter((e) => e.t > snap.time)).toEqual(a.impacts.filter((e) => e.t > snap.time));
      expect(sameTracks(a, b, snap.samples - 1)).toBe(true);
    }
  });

  it('replays to the same branch point from the seed alone', () => {
    const seed = 21;
    const main = new DiceSimulation(FACES, dims, start, { seed });
    const search = new BranchSearch({ faces: FACES, dims, start: posesToPlain(start), seed, candidates: branchCandidates(seed, 2) });
    search.run();
    main.runToEnd();
    expect(search.progress.baseHash).not.toBeNull();
    expect(search.progress.baseHash).toBe(main.branchPointHash);
  });

  it('chooses the continuation that needs the least help, and it plays out exactly as scored', () => {
    const seed = 31;
    const candidates = branchCandidates(seed, 8);
    // Score every candidate in full, without pruning.
    const scores = candidates.map((c) => {
      const sim = new DiceSimulation(FACES, dims, start, { seed });
      sim.chooseBranch(c);
      sim.runToEnd();
      return sim.score();
    });
    const search = new BranchSearch({ faces: FACES, dims, start: posesToPlain(start), seed, candidates });
    const { best } = search.run();
    expect(best).not.toBeNull();
    const firstMinimum = candidates[scores.indexOf(Math.min(...scores))];
    // With an early stop on a perfect continuation, any minimum found first is equally good.
    expect(best!.score).toBe(Math.min(...scores));
    expect(scores[candidates.indexOf(best!.seed)]).toBe(best!.score);
    expect(candidates.indexOf(best!.seed)).toBeLessThanOrEqual(candidates.indexOf(firstMinimum));

    const played = new DiceSimulation(FACES, dims, start, { seed });
    played.chooseBranch(best!.seed);
    played.runToEnd();
    expect(played.score()).toBe(best!.score);
    expect(played.wrongDice()).toEqual([]);
    played.finalPoses().forEach((pose, i) => expect(upwardFace(pose.quaternion).symbol).toBe(FACES[i]));
  });

  it('works in slices and resumes where it stopped', () => {
    const seed = 41;
    const request = { faces: FACES, dims, start: posesToPlain(start), seed, candidates: branchCandidates(seed, 4) };
    const whole = new BranchSearch(request).run();
    const sliced = new BranchSearch(request);
    let rounds = 0;
    while (!sliced.run(performance.now() + 2).done) rounds++;
    expect(rounds).toBeGreaterThan(3);
    expect(sliced.progress.best).toEqual(whole.best);
  });

  it('refuses a snapshot taken before the branch point', () => {
    const sim = new DiceSimulation(FACES, dims, start, { seed: 51 });
    sim.advanceTo(1);
    const snapshot = sim.snapshot();
    expect(() => new BranchSearch({ faces: FACES, dims, start: posesToPlain(start), seed: 51, snapshot, candidates: [1] })).toThrow();
  });

  it('fingerprints state', () => {
    const sim = new DiceSimulation(FACES, dims, start, { seed: 61 });
    sim.advanceTo(0.5);
    const a = sim.snapshot();
    const b = JSON.parse(JSON.stringify(a));
    expect(stateHash(b)).toBe(stateHash(a));
    b.bodies[3].v[1] += 1e-12;
    expect(stateHash(b)).not.toBe(stateHash(a));
  });
});

describe('shake continuations', () => {
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 0, y: 0, z: 0 };
  const t0 = ROLL_TIMING.branchAt;

  it('leave everything before the branch point alone and never jump at it', () => {
    const original = createShake(dims, seededVisualRandom(5), { gravity: PHYSICS.gravity });
    const branched = createShake(dims, seededVisualRandom(5), { gravity: PHYSICS.gravity });
    branched.diverge(t0, seededVisualRandom(99));
    for (let t = 0; t <= t0; t += 0.01) {
      original.accel(t, a);
      branched.accel(t, b);
      expect(b).toEqual(a);
    }
    // Continuous across t0: a tiny step changes the acceleration by a tiny amount.
    branched.accel(t0 - 1e-4, a);
    branched.accel(t0 + 1e-4, b);
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(PHYSICS.gravity * 0.05);
    branched.offset(t0 - 1e-4, a);
    branched.offset(t0 + 1e-4, b);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1e-3);
  });

  it('really differ afterwards, and can be undone', () => {
    const shake = createShake(dims, seededVisualRandom(6), { gravity: PHYSICS.gravity });
    const before: number[] = [];
    for (let t = t0; t < ROLL_TIMING.shakeEnd; t += 0.05) before.push(shake.accel(t, a).x);
    shake.diverge(t0, seededVisualRandom(1));
    let difference = 0;
    let k = 0;
    for (let t = t0; t < ROLL_TIMING.shakeEnd; t += 0.05) difference = Math.max(difference, Math.abs(shake.accel(t, a).x - before[k++]));
    expect(difference).toBeGreaterThan(PHYSICS.gravity * 0.2);
    shake.diverge(0, null);
    k = 0;
    for (let t = t0; t < ROLL_TIMING.shakeEnd; t += 0.05) expect(shake.accel(t, a).x).toBe(before[k++]);
  });
});
