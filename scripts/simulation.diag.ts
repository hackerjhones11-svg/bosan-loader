import { Quaternion, Vector3 } from 'three';
import { test } from 'vitest';
import { BranchSearch, branchCandidates, posesToPlain } from '../src/dice3d/branchSearch';
import { createDieShape } from '../src/dice3d/dieCollider';
import { DiceSimulation } from '../src/dice3d/diceSimulation';
import { upwardFace } from '../src/dice3d/faceMap';
import { gridLayout } from '../src/dice3d/layout';
import { TRAY_PRESETS } from '../src/dice3d/trayConfig';
import { seededVisualRandom } from '../src/dice3d/visualRandom';
import { SYMBOL_IDS } from '../src/game/symbols';
import type { Faces } from '../src/game/roll';

// Developer diagnostic (`npx vitest run --config vitest.diag.config.ts scripts/simulation.diag.ts`):
// motion quality, outcome control and cost of the live dice simulation.
const N = Number(process.env.DIAG_ROLLS ?? 40);
const STEERING = process.env.DIAG_FREE !== '1';
/** Look-ahead candidates per roll, as in the app (0: play the first continuation, no search). */
const SEARCH = STEERING ? Number(process.env.DIAG_SEARCH ?? 12) : 0;
const hull = createDieShape().vertices.map((v) => new Vector3(v.x, v.y, v.z));

function pct(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

test('simulation diagnostics', () => {
  const lines: string[] = [];
  for (const [name, dims] of Object.entries(TRAY_PRESETS)) {
    const restTimes: number[] = [];
    const paths: number[] = [];
    const minPaths: number[] = [];
    const coverage: number[] = [];
    const walls: number[] = [];
    const dieHits: number[] = [];
    const tumbles: number[] = [];
    const heights: number[] = [];
    const ms: number[] = [];
    let wrong = 0;
    let floorPen = 0;
    let wallPen = 0;
    let diePen = 0;
    let tumblesSteered = 0;
    let caught = 0;
    let nudges = 0;
    let scripted = 0;
    let scriptedFromRest = 0;
    let rollsWithout = 0;
    const searchMs: number[] = [];
    const random = seededVisualRandom(1234 + name.length);
    let start = gridLayout(SYMBOL_IDS, dims);
    for (let r = 0; r < N; r++) {
      const faces = Array.from({ length: 6 }, () => SYMBOL_IDS[Math.floor(random() * 6)]) as unknown as Faces;
      const seed = Math.floor(random() * 2 ** 32);
      let chosen: number | null = null;
      if (SEARCH > 0) {
        const s0 = performance.now();
        const search = new BranchSearch({ faces, dims, start: posesToPlain(start), seed, candidates: branchCandidates(seed, SEARCH) });
        const { best } = search.run();
        searchMs.push(performance.now() - s0);
        chosen = best!.seed;
      }
      const t0 = performance.now();
      const sim = new DiceSimulation(faces, dims, start, { seed, steering: STEERING });
      if (chosen !== null) sim.chooseBranch(chosen);
      sim.runToEnd();
      ms.push(performance.now() - t0);
      scriptedFromRest += sim.stats.scriptedFromRest;
      if (sim.stats.scriptedRecoveries === 0) rollsWithout++;
      restTimes.push(sim.restAt ?? 99);
      tumblesSteered += sim.stats.steeredTumbles;
      caught += sim.stats.caught;
      nudges += sim.stats.nudges;
      scripted += sim.stats.scriptedRecoveries;
      walls.push(sim.impacts.filter((e) => e.surface === 'wall').length);
      dieHits.push(sim.impacts.filter((e) => e.surface === 'die').length);

      const cells = new Set<string>();
      const p = new Vector3();
      const q = new Quaternion();
      const prev = Array.from({ length: 6 }, () => new Vector3());
      const prevUp: (string | null)[] = Array(6).fill(null);
      const len = Array(6).fill(0);
      let flips = 0;
      let maxH = 0;
      const all: Vector3[][] = Array.from({ length: 6 }, () => []);
      for (let k = 0; k < sim.sampleCount; k += 2) {
        const t = k * sim.step;
        for (let i = 0; i < 6; i++) {
          sim.sample(i, t, p, q);
          if (k > 0) len[i] += Math.hypot(p.x - prev[i].x, p.z - prev[i].z);
          prev[i].copy(p);
          all[i].push(p.clone());
          cells.add(`${Math.floor(p.x + dims.halfWidth)},${Math.floor(p.z + dims.halfDepth)}`);
          maxH = Math.max(maxH, p.y);
          const up = upwardFace(q);
          if (up.alignment > 0.95) {
            if (prevUp[i] && prevUp[i] !== up.symbol) flips++;
            prevUp[i] = up.symbol;
          }
          if (k % 6 === 0) {
            let minY = Infinity;
            let maxX = 0;
            let maxZ = 0;
            for (const v of hull) {
              const w = v.clone().applyQuaternion(q).add(p);
              minY = Math.min(minY, w.y);
              maxX = Math.max(maxX, Math.abs(w.x));
              maxZ = Math.max(maxZ, Math.abs(w.z));
            }
            if (minY < -0.06) floorPen++;
            if (maxX > dims.halfWidth + 0.06 || maxZ > dims.halfDepth + 0.06) wallPen++;
          }
        }
        if (k % 6 === 0) {
          for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) if (all[i][all[i].length - 1].distanceTo(all[j][all[j].length - 1]) < 0.86) diePen++;
        }
      }
      paths.push(len.reduce((a, b) => a + b, 0) / 6);
      minPaths.push(Math.min(...len));
      const totalCells = Math.ceil(dims.halfWidth * 2) * Math.ceil(dims.halfDepth * 2);
      coverage.push(cells.size / totalCells);
      tumbles.push(flips / 6);
      heights.push(maxH);
      const finals = sim.finalPoses();
      finals.forEach((f, i) => {
        const up = upwardFace(f.quaternion);
        if (up.symbol !== faces[i] || up.alignment < 0.995) wrong++;
      });
      start = finals;
    }
    const f = (x: number) => x.toFixed(2);
    lines.push(
      `${name.padEnd(6)} rest p10/50/90 ${f(pct(restTimes, 0.1))}/${f(pct(restTimes, 0.5))}/${f(pct(restTimes, 0.9))}s max ${f(Math.max(...restTimes))}` +
        ` | path/die ${f(pct(paths, 0.5))} (min die p10 ${f(pct(minPaths, 0.1))}) coverage ${f(pct(coverage, 0.5))}` +
        ` | wall ${pct(walls, 0.5)} die ${pct(dieHits, 0.5)} flips/die ${f(pct(tumbles, 0.5))} maxH ${f(pct(heights, 0.9))}` +
        ` | wrong ${wrong} pen floor/wall/die ${floorPen}/${wallPen}/${diePen}` +
        ` | per roll: steered ${f(tumblesSteered / N)} caught ${f(caught / N)} nudges ${f(nudges / N)} scripted ${f(scripted / N)} (from rest ${f(scriptedFromRest / N)}; ${Math.round((rollsWithout / N) * 100)}% of rolls none)` +
        ` | ${f(pct(ms, 0.5))}ms/roll` +
        (searchMs.length ? ` | search p50 ${pct(searchMs, 0.5).toFixed(0)}ms p90 ${pct(searchMs, 0.9).toFixed(0)}ms` : ''),
    );
  }
  process.stdout.write(`\n${STEERING ? `STEERED, look-ahead ${SEARCH}` : 'FREE'} x${N}\n${lines.join('\n')}\n`);
}, 600000);
