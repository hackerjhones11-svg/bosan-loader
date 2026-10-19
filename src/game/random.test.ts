import { describe, expect, it } from 'vitest';
import { rejectionLimit, secureRandomInt, secureRandomInts, UINT32_RANGE, type RandomFill } from './random';

/** A fake source that hands out a scripted sequence of uint32 words, recording how many were drawn. */
function scripted(words: number[]): RandomFill & { drawn: number } {
  const queue = [...words];
  const fill = ((target: Uint32Array) => {
    for (let i = 0; i < target.length; i++) {
      if (queue.length === 0) throw new Error('script exhausted');
      target[i] = queue.shift()!;
      fill.drawn += 1;
    }
  }) as RandomFill & { drawn: number };
  fill.drawn = 0;
  return fill;
}

describe('rejection sampling', () => {
  it('computes the largest unbiased bound for six symbols', () => {
    // 2^32 = 4294967296 ≡ 4 (mod 6), so the last four words must be rejected.
    expect(rejectionLimit(6)).toBe(4294967292);
    expect(rejectionLimit(6) % 6).toBe(0);
    expect(rejectionLimit(1)).toBe(UINT32_RANGE);
  });

  it('rejects out-of-range words and redraws', () => {
    const source = scripted([4294967295, 4294967292, 4294967293, 13]);
    expect(secureRandomInt(6, source)).toBe(13 % 6);
    expect(source.drawn).toBe(4);
  });

  it('accepts the largest in-range word', () => {
    const source = scripted([4294967291]);
    expect(secureRandomInt(6, source)).toBe(4294967291 % 6);
    expect(source.drawn).toBe(1);
  });

  it('keeps accepted values in order and replaces only rejected ones', () => {
    const source = scripted([0, 4294967294, 7, 11, 4294967295, 2, 3, 5, 9]);
    expect(secureRandomInts(6, 6, source)).toEqual([0, 1, 5, 2, 3, 5]);
  });

  it('maps every residue class equally when the source is exhaustive', () => {
    // Feeding 0..599 must produce each value exactly 100 times: no residue is favoured.
    const words = Array.from({ length: 600 }, (_, i) => i);
    const tally = [0, 0, 0, 0, 0, 0];
    for (const v of secureRandomInts(600, 6, scripted(words))) tally[v] += 1;
    expect(tally).toEqual([100, 100, 100, 100, 100, 100]);
  });

  it('gives up on a broken source instead of looping forever', () => {
    const alwaysHigh: RandomFill = (t) => t.fill(0xffffffff);
    expect(() => secureRandomInt(6, alwaysHigh)).toThrow(/out-of-range/);
  });

  it('validates the bound', () => {
    expect(() => secureRandomInt(0)).toThrow(RangeError);
    expect(() => secureRandomInt(2.5)).toThrow(RangeError);
  });

  it('draws in range from the real crypto source', () => {
    for (const v of secureRandomInts(500, 6)) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
  });
});
