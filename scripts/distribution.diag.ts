import { test } from 'vitest';
import { simulateDistribution } from '../src/admin/distribution';
import { SYMBOL_IDS } from '../src/game/symbols';

// Optional developer diagnostic (`npm run diag:distribution`), NOT a release gate:
// random samples fluctuate, so this only prints numbers for a human to eyeball.
test('empirical symbol distribution', () => {
  const report = simulateDistribution(200_000);
  const lines = SYMBOL_IDS.map((id) => `${id.padEnd(7)} ${((report.counts[id] / report.dice) * 100).toFixed(3)}%`);
  process.stdout.write(`\n${report.dice.toLocaleString()} dice\n${lines.join('\n')}\nchi-square (5 d.f.) = ${report.chiSquare.toFixed(2)}\n`);
}, 120000);
