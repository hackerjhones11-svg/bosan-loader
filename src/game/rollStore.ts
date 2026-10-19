import { HISTORY_LIMIT, loadHistory, saveHistory } from './history';
import { cryptoFill, type RandomFill } from './random';
import { createRollRecord, isFaces, rollFairFaces, type Faces, type RollRecord } from './roll';
import { createMemoryStorage, type KeyValueStorage } from './storage';

/**
 * Roll lifecycle:
 *
 *   idle ──requestRoll──▶ rolling ──markSettling──▶ settling ──completeRoll──▶ result
 *   result ──requestRoll──▶ rolling …
 *
 * - The outcome is fixed in requestRoll(), *before* any animation starts.
 *   Renderers only animate toward `activeRoll.faces`; they never decide a result.
 * - While rolling/settling every further requestRoll() is rejected, so buttons,
 *   keyboard, touch and admin triggers all share one guard.
 * - completeRoll() is idempotent per roll id: history gets exactly one entry.
 * - A watchdog completes the roll with the already-selected result if a renderer
 *   never reports back (crash, lost WebGL context, throttled tab).
 */
export type RollPhase = 'idle' | 'rolling' | 'settling' | 'result';

export interface RollState {
  readonly phase: RollPhase;
  /** The roll currently being animated (rolling/settling), else null. */
  readonly activeRoll: RollRecord | null;
  /** The most recent completed roll; the mat and announcements derive from it. */
  readonly lastResult: RollRecord | null;
  /** Completed rolls, newest first, at most HISTORY_LIMIT. */
  readonly history: readonly RollRecord[];
  /** Admin-preset faces for the next roll only. Disclosed on screen while set. */
  readonly pendingOverride: Faces | null;
  /** True when lastResult was finalised by recovery rather than the animation. */
  readonly recovered: boolean;
}

export interface RollStore {
  getState(): RollState;
  subscribe(listener: () => void): () => void;
  /** Starts a roll if none is active. Returns the new record, or null when busy. */
  requestRoll(): RollRecord | null;
  markSettling(rollId: string): boolean;
  /** Finalises the active roll. Returns false for stale or duplicate calls. */
  completeRoll(rollId: string, options?: { recovered?: boolean }): boolean;
  setPendingOverride(faces: Faces | null): void;
  clearHistory(): void;
  /** Re-reads persisted history (e.g. after another tab changed it). */
  reloadHistory(): void;
  dispose(): void;
}

export interface RollStoreOptions {
  storage?: KeyValueStorage;
  fill?: RandomFill;
  now?: () => number;
  watchdogMs?: number;
}

export const DEFAULT_WATCHDOG_MS = 9000;

export function isBusy(state: RollState): boolean {
  return state.phase === 'rolling' || state.phase === 'settling';
}

/** Whether the screen must currently show the TEST MODE disclosure. */
export function testModeVisible(state: RollState): boolean {
  if (state.pendingOverride) return true;
  if (state.activeRoll?.mode === 'test') return true;
  return state.phase === 'result' && state.lastResult?.mode === 'test';
}

export function createRollStore(options: RollStoreOptions = {}): RollStore {
  const storage = options.storage ?? createMemoryStorage();
  const fill = options.fill ?? cryptoFill;
  const now = options.now ?? Date.now;
  const watchdogMs = options.watchdogMs ?? DEFAULT_WATCHDOG_MS;

  let state: RollState = {
    phase: 'idle',
    activeRoll: null,
    lastResult: null,
    history: loadHistory(storage),
    pendingOverride: null,
    recovered: false,
  };
  const listeners = new Set<() => void>();
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const set = (patch: Partial<RollState>) => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  };

  const clearWatchdog = () => {
    if (watchdog !== null) clearTimeout(watchdog);
    watchdog = null;
  };

  const store: RollStore = {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    requestRoll() {
      if (isBusy(state)) return null;
      // A pending override is consumed here, at roll start, so it can apply at most once.
      const override = state.pendingOverride;
      const roll = override
        ? createRollRecord(override, 'test', now())
        : createRollRecord(rollFairFaces(fill), 'random', now());
      clearWatchdog();
      watchdog = setTimeout(() => store.completeRoll(roll.id, { recovered: true }), watchdogMs);
      set({ phase: 'rolling', activeRoll: roll, pendingOverride: null, recovered: false });
      return roll;
    },

    markSettling(rollId) {
      if (state.phase !== 'rolling' || state.activeRoll?.id !== rollId) return false;
      set({ phase: 'settling' });
      return true;
    },

    completeRoll(rollId, opts) {
      const roll = state.activeRoll;
      if (!isBusy(state) || !roll || roll.id !== rollId) return false;
      clearWatchdog();
      const history = [roll, ...state.history.filter((r) => r.id !== roll.id)].slice(0, HISTORY_LIMIT);
      saveHistory(storage, history);
      set({ phase: 'result', activeRoll: null, lastResult: roll, history, recovered: Boolean(opts?.recovered) });
      return true;
    },

    setPendingOverride(faces) {
      if (faces !== null && !isFaces(faces)) throw new Error('Override must be six valid symbols.');
      set({ pendingOverride: faces ? (Object.freeze([...faces]) as unknown as Faces) : null });
    },

    clearHistory() {
      saveHistory(storage, []);
      set({ history: [] });
    },

    reloadHistory() {
      set({ history: loadHistory(storage) });
    },

    dispose() {
      clearWatchdog();
      listeners.clear();
    },
  };
  return store;
}
