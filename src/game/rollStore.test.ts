import { afterEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_KEY, HISTORY_LIMIT } from './history';
import type { RandomFill } from './random';
import type { Faces } from './roll';
import { createRollStore, isBusy, testModeVisible } from './rollStore';
import { createMemoryStorage } from './storage';

const PRESET: Faces = ['paan', 'paan', 'paan', 'jhandi', 'burja', 'chidi'];

/** Deterministic source cycling 0..5 so "random" rolls are recognisable in assertions. */
const cycling: RandomFill = (target) => {
  for (let i = 0; i < target.length; i++) target[i] = i % 6;
};

/** Settles, completes and ends the reveal, leaving the store ready for the next roll. */
function finish(store: ReturnType<typeof createRollStore>) {
  const roll = store.getState().activeRoll!;
  store.markSettling(roll.id);
  store.completeRoll(roll.id);
  store.finishReveal(roll.id);
  return roll;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('state machine', () => {
  it('walks idle → rolling → settling → revealing → result', () => {
    vi.useFakeTimers();
    const store = createRollStore({ fill: cycling, revealMs: 800 });
    expect(store.getState().phase).toBe('idle');
    const roll = store.requestRoll()!;
    expect(store.getState().phase).toBe('rolling');
    expect(store.getState().activeRoll).toBe(roll);
    expect(store.markSettling(roll.id)).toBe(true);
    expect(store.getState().phase).toBe('settling');
    expect(store.completeRoll(roll.id)).toBe(true);
    let state = store.getState();
    expect(state.phase).toBe('revealing');
    expect(state.activeRoll).toBeNull();
    expect(state.lastResult).toBe(roll);
    expect(state.history[0]).toBe(roll);
    vi.advanceTimersByTime(799);
    expect(store.getState().phase).toBe('revealing');
    vi.advanceTimersByTime(1);
    state = store.getState();
    expect(state.phase).toBe('result');
    expect(state.lastResult).toBe(roll);
    store.dispose();
  });

  it('records history once when the dice are confirmed, not when the reveal ends', () => {
    vi.useFakeTimers();
    const store = createRollStore({ fill: cycling });
    const roll = store.requestRoll()!;
    store.completeRoll(roll.id);
    expect(store.getState().history.map((r) => r.id)).toEqual([roll.id]);
    vi.runAllTimers();
    expect(store.getState().history.map((r) => r.id)).toEqual([roll.id]);
    expect(store.finishReveal(roll.id)).toBe(false);
    store.dispose();
  });

  it('fixes the outcome before animation starts', () => {
    const store = createRollStore({ fill: cycling });
    const roll = store.requestRoll()!;
    expect(roll.faces).toEqual(['jhandi', 'burja', 'itta', 'paan', 'hukum', 'chidi']);
    store.completeRoll(roll.id);
    expect(store.getState().lastResult?.faces).toEqual(roll.faces);
    store.dispose();
  });
});

describe('busy-state protection', () => {
  it('rejects overlapping roll requests', () => {
    const store = createRollStore({ fill: cycling });
    const first = store.requestRoll();
    expect(first).not.toBeNull();
    expect(store.requestRoll()).toBeNull();
    store.markSettling(first!.id);
    expect(isBusy(store.getState())).toBe(true);
    expect(store.requestRoll()).toBeNull();
    expect(store.getState().activeRoll?.id).toBe(first!.id);
    store.completeRoll(first!.id);
    // The reveal is part of the roll: still guarded until it ends.
    expect(store.getState().phase).toBe('revealing');
    expect(isBusy(store.getState())).toBe(true);
    expect(store.requestRoll()).toBeNull();
    store.finishReveal(first!.id);
    expect(store.requestRoll()).not.toBeNull();
    store.dispose();
  });

  it('a stale reveal end cannot affect a later roll', () => {
    const store = createRollStore({ fill: cycling });
    const first = finish((store.requestRoll(), store));
    const second = store.requestRoll()!;
    expect(store.finishReveal(first.id)).toBe(false);
    expect(store.getState().phase).toBe('rolling');
    expect(store.getState().activeRoll?.id).toBe(second.id);
    store.dispose();
  });

  it('records each roll once even if completion is reported repeatedly', () => {
    const store = createRollStore({ fill: cycling });
    const roll = store.requestRoll()!;
    expect(store.completeRoll(roll.id)).toBe(true);
    expect(store.completeRoll(roll.id)).toBe(false);
    expect(store.markSettling(roll.id)).toBe(false);
    expect(store.getState().history).toHaveLength(1);
    store.dispose();
  });

  it('ignores completion for a stale roll id', () => {
    const store = createRollStore({ fill: cycling });
    const roll = store.requestRoll()!;
    expect(store.completeRoll('someone-else')).toBe(false);
    expect(store.getState().phase).toBe('rolling');
    store.completeRoll(roll.id);
    store.dispose();
  });

  it('recovers via watchdog to the already-selected result', () => {
    vi.useFakeTimers();
    const store = createRollStore({ fill: cycling, watchdogMs: 5000 });
    const roll = store.requestRoll()!;
    vi.advanceTimersByTime(4999);
    expect(store.getState().phase).toBe('rolling');
    vi.advanceTimersByTime(1);
    const state = store.getState();
    expect(state.phase).toBe('revealing');
    expect(state.lastResult?.id).toBe(roll.id);
    expect(state.lastResult?.faces).toEqual(roll.faces);
    expect(state.recovered).toBe(true);
    expect(state.history).toHaveLength(1);
    vi.runAllTimers();
    expect(store.getState().phase).toBe('result');
    store.dispose();
  });

  it('a renderer still making progress defers the watchdog', () => {
    vi.useFakeTimers();
    const store = createRollStore({ fill: cycling, watchdogMs: 5000 });
    const roll = store.requestRoll()!;
    for (let k = 0; k < 4; k++) {
      vi.advanceTimersByTime(4000);
      expect(store.keepAlive(roll.id)).toBe(true);
    }
    expect(store.getState().phase).toBe('rolling');
    vi.advanceTimersByTime(5000);
    expect(store.getState().phase).toBe('revealing');
    expect(store.getState().recovered).toBe(true);
    expect(store.keepAlive(roll.id)).toBe(false);
    store.dispose();
  });

  it('cancels the watchdog when the roll completes normally', () => {
    vi.useFakeTimers();
    const store = createRollStore({ fill: cycling, watchdogMs: 5000 });
    store.requestRoll();
    finish(store);
    const next = store.requestRoll()!;
    vi.advanceTimersByTime(4000);
    expect(store.getState().activeRoll?.id).toBe(next.id);
    store.dispose();
  });
});

describe('admin test overrides', () => {
  it('applies a forced outcome to exactly one roll, then returns to fair mode', () => {
    const store = createRollStore({ fill: cycling });
    store.setPendingOverride(PRESET);
    expect(testModeVisible(store.getState())).toBe(true);

    const forced = store.requestRoll()!;
    expect(forced.mode).toBe('test');
    expect(forced.faces).toEqual(PRESET);
    expect(store.getState().pendingOverride).toBeNull();
    expect(testModeVisible(store.getState())).toBe(true);
    finish(store);
    expect(testModeVisible(store.getState())).toBe(true);

    const next = store.requestRoll()!;
    expect(next.mode).toBe('random');
    expect(next.faces).toEqual(['jhandi', 'burja', 'itta', 'paan', 'hukum', 'chidi']);
    expect(testModeVisible(store.getState())).toBe(false);
    finish(store);
    expect(testModeVisible(store.getState())).toBe(false);
    store.dispose();
  });

  it('can be cleared before use', () => {
    const store = createRollStore({ fill: cycling });
    store.setPendingOverride(PRESET);
    store.setPendingOverride(null);
    expect(store.requestRoll()!.mode).toBe('random');
    store.dispose();
  });

  it('cannot alter a roll already in progress', () => {
    const store = createRollStore({ fill: cycling });
    const roll = store.requestRoll()!;
    store.setPendingOverride(PRESET);
    store.completeRoll(roll.id);
    expect(store.getState().lastResult?.mode).toBe('random');
    expect(store.getState().lastResult?.faces).toEqual(roll.faces);
    store.dispose();
  });

  it('rejects malformed overrides', () => {
    const store = createRollStore({ fill: cycling });
    expect(() => store.setPendingOverride(['paan'] as unknown as Faces)).toThrow();
    store.dispose();
  });

  it('keeps the test label attached through history persistence', () => {
    const storage = createMemoryStorage();
    const store = createRollStore({ fill: cycling, storage });
    store.setPendingOverride(PRESET);
    const forced = store.requestRoll()!;
    store.completeRoll(forced.id);
    expect(testModeVisible(store.getState())).toBe(true);
    store.finishReveal(forced.id);
    finish((store.requestRoll(), store));
    store.dispose();

    const reloaded = createRollStore({ fill: cycling, storage });
    const [latest, previous] = reloaded.getState().history;
    expect(latest.mode).toBe('random');
    expect(previous.id).toBe(forced.id);
    expect(previous.mode).toBe('test');
    expect(previous.faces).toEqual(PRESET);
    reloaded.dispose();
  });
});

describe('history', () => {
  it('keeps the newest 20, newest first', () => {
    let t = 1000;
    const store = createRollStore({ fill: cycling, now: () => t++ });
    const ids: string[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) ids.push(finish((store.requestRoll(), store)).id);
    const history = store.getState().history;
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history[0].id).toBe(ids[ids.length - 1]);
    expect(history.map((r) => r.timestamp)).toEqual([...history.map((r) => r.timestamp)].sort((a, b) => b - a));
    store.dispose();
  });

  it('never persists an unfinished roll', () => {
    const storage = createMemoryStorage();
    const store = createRollStore({ fill: cycling, storage });
    store.requestRoll();
    expect(storage.getItem(HISTORY_KEY)).toBeNull();
    store.dispose();
    expect(createRollStore({ storage }).getState().history).toHaveLength(0);
  });

  it('clears history', () => {
    const storage = createMemoryStorage();
    const store = createRollStore({ fill: cycling, storage });
    finish((store.requestRoll(), store));
    store.clearHistory();
    expect(store.getState().history).toHaveLength(0);
    expect(createRollStore({ storage }).getState().history).toHaveLength(0);
    store.dispose();
  });
});
