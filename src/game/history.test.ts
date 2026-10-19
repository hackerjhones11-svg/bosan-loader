import { describe, expect, it, vi } from 'vitest';
import { HISTORY_KEY, loadHistory, parseHistory, saveHistory } from './history';
import { createRollRecord } from './roll';
import { createMemoryStorage, getBrowserStorage } from './storage';

const valid = { id: 'r1', t: 1700000000000, faces: ['paan', 'paan', 'itta', 'hukum', 'chidi', 'burja'], mode: 'random' };

describe('history persistence', () => {
  it('round-trips rolls including the test mode label', () => {
    const storage = createMemoryStorage();
    const rolls = [
      createRollRecord(['jhandi', 'jhandi', 'jhandi', 'paan', 'paan', 'paan'], 'test', 2000, 'b'),
      createRollRecord(['itta', 'burja', 'chidi', 'hukum', 'paan', 'jhandi'], 'random', 1000, 'a'),
    ];
    saveHistory(storage, rolls);
    expect(loadHistory(storage)).toEqual(rolls);
  });

  it('recovers from missing, unparsable and wrongly shaped data', () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory('{not json')).toEqual([]);
    expect(parseHistory('42')).toEqual([]);
    expect(parseHistory(JSON.stringify({ v: 2, rolls: [valid] }))).toEqual([]);
    expect(parseHistory(JSON.stringify({ v: 1, rolls: 'nope' }))).toEqual([]);
  });

  it('drops invalid entries but keeps valid ones', () => {
    const raw = JSON.stringify({
      v: 1,
      rolls: [
        valid,
        { ...valid, id: 'bad-faces', faces: ['paan', 'paan'] },
        { ...valid, id: 'bad-symbol', faces: ['paan', 'paan', 'paan', 'paan', 'paan', 'joker'] },
        { ...valid, id: 'bad-mode', mode: 'rigged' },
        { ...valid, id: 'bad-time', t: 'yesterday' },
        { ...valid, id: '' },
        null,
        { ...valid, id: 'r1' },
        { ...valid, id: 'r2', mode: 'test' },
      ],
    });
    const rolls = parseHistory(raw);
    expect(rolls.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(rolls[1].mode).toBe('test');
  });

  it('recomputes counts from faces instead of trusting storage', () => {
    const raw = JSON.stringify({ v: 1, rolls: [{ ...valid, counts: { paan: 6 } }] });
    const [roll] = parseHistory(raw);
    expect(roll.counts).toEqual({ jhandi: 0, burja: 1, itta: 1, paan: 2, hukum: 1, chidi: 1 });
  });

  it('removes corrupted data from storage', () => {
    const storage = createMemoryStorage({ [HISTORY_KEY]: '<<garbage>>' });
    expect(loadHistory(storage)).toEqual([]);
    expect(storage.getItem(HISTORY_KEY)).toBeNull();
  });

  it('caps loaded history at 20 entries', () => {
    const rolls = Array.from({ length: 30 }, (_, i) => ({ ...valid, id: `r${i}` }));
    expect(parseHistory(JSON.stringify({ v: 1, rolls }))).toHaveLength(20);
  });

  it('falls back to in-memory storage when localStorage is unusable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    });
    try {
      const storage = getBrowserStorage();
      saveHistory(storage, [createRollRecord(['paan', 'paan', 'paan', 'paan', 'paan', 'paan'], 'random', 5, 'm')]);
      expect(loadHistory(storage).map((r) => r.id)).toEqual(['m']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps working when reads and writes start failing later', () => {
    let broken = false;
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => {
        if (broken) throw new Error('denied');
        return data.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        if (broken) throw new Error('quota');
        data.set(k, v);
      },
      removeItem: (k: string) => void data.delete(k),
    });
    try {
      const storage = getBrowserStorage();
      broken = true;
      expect(() => saveHistory(storage, [])).not.toThrow();
      expect(loadHistory(storage)).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
