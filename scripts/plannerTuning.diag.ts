import { test } from 'vitest';
import { planRoll } from '../src/dice3d/rollPlanner';
import { TRAY_PRESETS } from '../src/dice3d/trayConfig';
import { upwardFace } from '../src/dice3d/faceMap';
import { Quaternion } from 'three';
import type { Faces } from '../src/game/roll';

// Developer tool: how often does the physics planner need retries, and how long are throws?
test('planner tuning stats', () => {
  const faces: Faces = ['jhandi', 'burja', 'itta', 'paan', 'hukum', 'chidi'];
  for (const [name, dims] of Object.entries(TRAY_PRESETS)) {
    const durations: number[] = [];
    const attempts: number[] = [];
    let procedural = 0;
    let wrong = 0;
    const t0 = performance.now();
    const N = 150;
    for (let i = 0; i < N; i++) {
      const plan = planRoll(faces, dims);
      durations.push(plan.duration);
      attempts.push(plan.attempts);
      if (plan.source === 'procedural') procedural++;
      plan.tracks.forEach((track, d) => {
        const o = (plan.sampleCount - 1) * 7;
        const q = new Quaternion(track[o + 3], track[o + 4], track[o + 5], track[o + 6]);
        if (upwardFace(q).symbol !== faces[d]) wrong++;
      });
    }
    const ms = (performance.now() - t0) / N;
    durations.sort((a, b) => a - b);
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    process.stdout.write("\n" + 
      `${name}: ${ms.toFixed(1)}ms/plan, attempts mean ${mean(attempts).toFixed(2)} max ${Math.max(...attempts)}, ` +
        `duration p10 ${durations[Math.floor(N * 0.1)].toFixed(2)} p50 ${durations[Math.floor(N / 2)].toFixed(2)} p90 ${durations[Math.floor(N * 0.9)].toFixed(2)}, ` +
        `procedural ${procedural}, wrong faces ${wrong}\n`,
    );
  }
}, 120000);
