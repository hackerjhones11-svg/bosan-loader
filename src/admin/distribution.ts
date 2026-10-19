import { cryptoFill, type RandomFill } from '../game/random';
import { emptyCounts, rollFairFaces } from '../game/roll';
import { SYMBOL_IDS, type SymbolId } from '../game/symbols';

export interface DistributionReport {
  rolls: number;
  dice: number;
  counts: Record<SymbolId, number>;
  /** Pearson chi-square against uniform, 5 degrees of freedom. Informational only. */
  chiSquare: number;
}

/**
 * Developer diagnostic: tallies many fair rolls from the real roller. Random
 * samples fluctuate, so this is for eyeballing, never a pass/fail gate.
 * (For 5 degrees of freedom, values above ~11 occur by chance about 5% of the time.)
 */
export function simulateDistribution(rolls: number, fill: RandomFill = cryptoFill): DistributionReport {
  const counts = emptyCounts();
  for (let i = 0; i < rolls; i++) {
    for (const face of rollFairFaces(fill)) counts[face] += 1;
  }
  const dice = rolls * 6;
  const expected = dice / SYMBOL_IDS.length;
  const chiSquare = SYMBOL_IDS.reduce((sum, id) => sum + (counts[id] - expected) ** 2 / expected, 0);
  return { rolls, dice, counts, chiSquare };
}
