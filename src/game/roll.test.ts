import { describe, expect, it } from 'vitest';
import type { RandomFill } from './random';
import { countFaces, createRollRecord, isFaces, rankedCounts, rollFairFaces, sortedFaces, totalCount, type Faces } from './roll';
import { SYMBOL_IDS } from './symbols';

describe('fair rolls', () => {
  it('always produces exactly six valid symbols', () => {
    for (let i = 0; i < 2000; i++) {
      const faces = rollFairFaces();
      expect(faces).toHaveLength(6);
      expect(isFaces(faces)).toBe(true);
    }
  });

  it('counts always sum to six', () => {
    for (let i = 0; i < 2000; i++) {
      const roll = createRollRecord(rollFairFaces(), 'random');
      expect(totalCount(roll.counts)).toBe(6);
      for (const id of SYMBOL_IDS) {
        expect(roll.counts[id]).toBeGreaterThanOrEqual(0);
        expect(roll.counts[id]).toBeLessThanOrEqual(6);
      }
    }
  });

  it('maps random indices 0-5 onto the canonical symbol order', () => {
    const fill: RandomFill = (t) => t.set([0, 1, 2, 3, 4, 5].slice(0, t.length));
    expect(rollFairFaces(fill)).toEqual(['jhandi', 'burja', 'itta', 'paan', 'hukum', 'chidi']);
  });

  it('does not change odds based on previous outcomes (same words → same faces)', () => {
    const words = [5, 5, 5, 5, 5, 5];
    const fill: RandomFill = (t) => t.set(words.slice(0, t.length));
    expect(rollFairFaces(fill)).toEqual(rollFairFaces(fill));
    expect(rollFairFaces(fill)).toEqual(Array(6).fill('chidi'));
  });
});

describe('counting', () => {
  it('counts the example from the rules', () => {
    // Flag, Heart, Heart, Crown, Club, Heart
    const counts = countFaces(['jhandi', 'paan', 'paan', 'burja', 'chidi', 'paan']);
    expect(counts).toEqual({ jhandi: 1, burja: 1, itta: 0, paan: 3, hukum: 0, chidi: 1 });
    expect(totalCount(counts)).toBe(6);
  });

  it('handles all six the same', () => {
    expect(countFaces(Array(6).fill('hukum'))).toEqual({ jhandi: 0, burja: 0, itta: 0, paan: 0, hukum: 6, chidi: 0 });
  });

  it('handles one of each', () => {
    expect(countFaces([...SYMBOL_IDS])).toEqual({ jhandi: 1, burja: 1, itta: 1, paan: 1, hukum: 1, chidi: 1 });
  });

  it('ranks by count then canonical order', () => {
    const counts = countFaces(['chidi', 'itta', 'chidi', 'jhandi', 'itta', 'hukum']);
    expect(rankedCounts(counts)).toEqual([
      { id: 'itta', count: 2 },
      { id: 'chidi', count: 2 },
      { id: 'jhandi', count: 1 },
      { id: 'hukum', count: 1 },
    ]);
  });

  it('sorts faces canonically for history rows without changing the record', () => {
    const faces: Faces = ['chidi', 'jhandi', 'paan', 'jhandi', 'burja', 'itta'];
    const roll = createRollRecord(faces, 'random');
    expect(sortedFaces(roll.faces)).toEqual(['jhandi', 'jhandi', 'burja', 'itta', 'paan', 'chidi']);
    expect(roll.faces).toEqual(faces);
  });
});

describe('roll records', () => {
  it('derives counts from faces and is immutable', () => {
    const roll = createRollRecord(['paan', 'paan', 'itta', 'itta', 'itta', 'burja'], 'test', 1000, 'abc');
    expect(roll).toMatchObject({ id: 'abc', timestamp: 1000, mode: 'test' });
    expect(roll.counts.itta).toBe(3);
    expect(Object.isFrozen(roll)).toBe(true);
    expect(Object.isFrozen(roll.faces)).toBe(true);
    expect(Object.isFrozen(roll.counts)).toBe(true);
  });

  it('rejects anything that is not six valid symbols', () => {
    expect(() => createRollRecord(['paan'] as unknown as Faces, 'random')).toThrow();
    expect(() => createRollRecord(['paan', 'paan', 'paan', 'paan', 'paan', 'joker'] as unknown as Faces, 'random')).toThrow();
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 200 }, () => createRollRecord(rollFairFaces(), 'random').id));
    expect(ids.size).toBe(200);
  });
});
