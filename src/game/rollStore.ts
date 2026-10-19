import { HISTORY_LIMIT, loadHistory, saveHistory } from './history';
import { cryptoFill, type RandomFill } from './random';
import { createRollRecord, isFaces, rollFairFaces, type Faces, type RollRecord } from './roll';
import { REVEAL_MS } from './rollTiming';
import { createMemoryStorage, type KeyValueStorage } from './storage';

/**
 * Roll lifecycle:
 *
 *   idle ──requestRoll──▶ rolling ──markSettling──▶ settling ──completeRoll──▶ revealing ──(timer)──▶ result
 *   result ──requestRoll──▶ rolling …
 *
 * - The outcome is fixed in requestRoll(), *before* any animation starts.
 *   Renderers only animate toward `activeRoll.faces`; they never decide a result.
 * - completeRoll() is called once the dice are confirmed at rest on those faces.
 *   It records history and starts the short reveal; the store itself ends the
 *   reveal after `revealMs`, so a renderer can never leave the app stuck.
 * - While rolling/settling/revealing every further requestRoll() is rejected, so
 *   buttons, keyboard, touch and admin triggers all share one guard.
 * - completeRoll() is idempotent per roll id: history gets exactly one entry.
 * - A watchdog completes the roll with the already-selected result if a renderer
 *   stops reporting (crash, lost WebGL context, throttled tab). A renderer that
 *   is still making progress on a slow device calls keepAlive() to defer it.
 */
export type RollPhase = 'idle' | 'rolling' | 'settling' | 'revealing' | 'result';

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
  /** A renderer still making progress on this roll: restarts the watchdog. */
  keepAlive(rollId: string): boolean;
  /** Finalises the active roll and starts its reveal. Returns false for stale or duplicate calls. */
  completeRoll(rollId: string, options?: { recovered?: boolean }): boolean;
  /** Ends the reveal early (normally the store's own timer does this). */
  finishReveal(rollId: string): boolean;
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
  /** Length of the result reveal, during which Roll stays unavailable. */
  revealMs?: number;
}

/** Comfortably longer than the slowest roll including its bounded recovery. */
export const DEFAULT_WATCHDOG_MS = 12000;

export function isBusy(state: RollState): boolean {
  return state.phase === 'rolling' || state.phase === 'settling' || state.phase === 'revealing';
}

function isMoving(state: RollState): boolean {
  return state.phase === 'rolling' || state.phase === 'settling';
}

/** A finished roll whose counts are on screen (being revealed or fully shown). */
export function hasShownResult(state: RollState): boolean {
  return (state.phase === 'revealing' || state.phase === 'result') && state.lastResult !== null;
}

/** Whether the screen must currently show the TEST MODE disclosure. */
export function testModeVisible(state: RollState): boolean {
  if (state.pendingOverride) return true;
  if (state.activeRoll?.mode === 'test') return true;
  return hasShownResult(state) && state.lastResult?.mode === 'test';
}

export function createRollStore(options: RollStoreOptions = {}): RollStore {
  const storage = options.storage ?? createMemoryStorage();
  const fill = options.fill ?? cryptoFill;
  const now = options.now ?? Date.now;
  const watchdogMs = options.watchdogMs ?? DEFAULT_WATCHDOG_MS;
  const revealMs = options.revealMs ?? REVEAL_MS;

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
  let revealTimer: ReturnType<typeof setTimeout> | null = null;

  const set = (patch: Partial<RollState>) => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  };

  const clearWatchdog = () => {
    if (watchdog !== null) clearTimeout(watchdog);
    watchdog = null;
  };

  const armWatchdog = (rollId: string) => {
    clearWatchdog();
    watchdog = setTimeout(() => store.completeRoll(rollId, { recovered: true }), watchdogMs);
  };

  const clearRevealTimer = () => {
    if (revealTimer !== null) clearTimeout(revealTimer);
    revealTimer = null;
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
      armWatchdog(roll.id);
      set({ phase: 'rolling', activeRoll: roll, pendingOverride: null, recovered: false });
      return roll;
    },

    keepAlive(rollId) {
      if (!isMoving(state) || state.activeRoll?.id !== rollId) return false;
      armWatchdog(rollId);
      return true;
    },

    markSettling(rollId) {
      if (state.phase !== 'rolling' || state.activeRoll?.id !== rollId) return false;
      set({ phase: 'settling' });
      return true;
    },

    completeRoll(rollId, opts) {
      const roll = state.activeRoll;
      if (!isMoving(state) || !roll || roll.id !== rollId) return false;
      clearWatchdog();
      clearRevealTimer();
      const history = [roll, ...state.history.filter((r) => r.id !== roll.id)].slice(0, HISTORY_LIMIT);
      saveHistory(storage, history);
      revealTimer = setTimeout(() => store.finishReveal(roll.id), revealMs);
      set({ phase: 'revealing', activeRoll: null, lastResult: roll, history, recovered: Boolean(opts?.recovered) });
      return true;
    },

    finishReveal(rollId) {
      if (state.phase !== 'revealing' || state.lastResult?.id !== rollId) return false;
      clearRevealTimer();
      set({ phase: 'result' });
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
      clearRevealTimer();
      listeners.clear();
    },
  };
  return store;
}
