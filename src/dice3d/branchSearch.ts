import { Quaternion, Vector3 } from 'three';
import type { Faces } from '../game/roll';
import { DiceSimulation, stateHash, type DiePose, type SimSnapshot } from './diceSimulation';
import type { TrayDims } from './trayConfig';

/**
 * Look-ahead for one roll.
 *
 * At ROLL_TIMING.branchAt the hands are still shaking, and how they carry on
 * is free: any continuation of the shake is as genuine as any other. The
 * search replays the roll from a snapshot taken there, once per candidate
 * continuation, with the same controller, and keeps the one whose dice need
 * the least visible help to finish on their recorded faces (see
 * DiceSimulation.score()). Playback only reaches the branch point after the
 * choice, so nothing on screen changes, and the outcome was fixed before any
 * of this ran: the search only chooses how the dice get there.
 *
 * Simulations built with the same seed, faces, tray and start are
 * bit-for-bit identical, so the search can replay the roll up to the branch
 * point by itself (starting the moment Roll is pressed, with nothing to wait
 * for), and the continuation chosen here plays out exactly as scored.
 * Pure and time-sliced: it runs in a Web Worker (branchWorker.ts) in the app
 * and synchronously in tests and diagnostics.
 */

export interface BranchRequest {
  faces: Faces;
  dims: TrayDims;
  /** Starting poses of the roll, as plain data (position [x, y, z], quaternion [x, y, z, w]). */
  start: { p: number[]; q: number[] }[];
  /** Seed the roll's simulation was built with. */
  seed: number;
  /** State at the branch point, if already known; otherwise the search simulates up to it. */
  snapshot?: SimSnapshot;
  /** Continuations to try, in order. */
  candidates: number[];
}

export interface BranchProgress {
  best: { seed: number; score: number } | null;
  /** Candidates finished or abandoned so far. */
  tried: number;
  done: boolean;
  /** stateHash() of the branch-point state the candidates start from (null until reached). */
  baseHash: number | null;
}

/** The continuations tried for a roll, in order; the first is played if nothing better is known. */
export function branchCandidates(seed: number, count: number): number[] {
  return Array.from({ length: count }, (_, k) => (seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0);
}

export function posesToPlain(poses: readonly DiePose[]): BranchRequest['start'] {
  return poses.map((pose) => ({ p: pose.position.toArray(), q: pose.quaternion.toArray() }));
}

function plainToPoses(start: BranchRequest['start']): DiePose[] {
  return start.map((s) => ({ position: new Vector3().fromArray(s.p), quaternion: new Quaternion().fromArray(s.q) }));
}

export class BranchSearch {
  readonly progress: BranchProgress = { best: null, tried: 0, done: false, baseHash: null };
  private readonly request: BranchRequest;
  private readonly sim: DiceSimulation;
  /** State at the branch point every candidate starts from. */
  private base: SimSnapshot | null = null;
  /** Score already earned before the branch point: no continuation can do better. */
  private floor = 0;
  private next = 0;
  private running = false;

  constructor(request: BranchRequest) {
    this.request = request;
    this.sim = new DiceSimulation(request.faces, request.dims, plainToPoses(request.start), { seed: request.seed });
    if (request.snapshot) {
      if (request.snapshot.time < this.sim.timing.branchAt) throw new Error('snapshot taken before the branch point');
      this.setBase(request.snapshot);
    }
  }

  private setBase(snap: SimSnapshot): void {
    this.base = snap;
    this.sim.restore(snap);
    this.floor = this.sim.score();
    this.progress.baseHash = stateHash(snap);
  }

  /** Works until every candidate is settled or `deadline` (performance.now()) passes. */
  run(deadline = Infinity): BranchProgress {
    const p = this.progress;
    if (!this.base) {
      // Replay the roll itself up to the branch point (identical to the original).
      this.sim.advanceTo(this.sim.timing.branchAt, deadline);
      if (this.sim.time < this.sim.timing.branchAt) return p;
      this.setBase(this.sim.snapshot());
    }
    const base = this.base!;
    let n = 0;
    while (!p.done) {
      if (!this.running) {
        if (this.next >= this.request.candidates.length) {
          p.done = true;
          break;
        }
        this.sim.restore(base);
        this.sim.chooseBranch(this.request.candidates[this.next]);
        this.running = true;
      }
      this.sim.stepOnce();
      // score() only grows during a run, so a continuation that already
      // scores no better than the best one is abandoned at once.
      const score = this.sim.score();
      const beaten = p.best !== null && score >= p.best.score;
      if (this.sim.done || beaten) {
        this.running = false;
        p.tried += 1;
        const seed = this.request.candidates[this.next++];
        if (!beaten) {
          p.best = { seed, score };
          // Nothing added after the branch point: it cannot be bettered.
          if (score <= this.floor) p.done = true;
        }
      }
      if ((++n & 15) === 0 && performance.now() > deadline) break;
    }
    return p;
  }
}
