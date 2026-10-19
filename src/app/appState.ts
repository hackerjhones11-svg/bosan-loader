import { useSyncExternalStore } from 'react';
import { soundEngine } from '../audio/soundEngine';
import { HISTORY_KEY } from '../game/history';
import { createRollStore, type RollState } from '../game/rollStore';
import { getBrowserStorage } from '../game/storage';
import type { SymbolId } from '../game/symbols';
import { createMiniStore, useMiniStore } from './miniStore';
import { PREFS_KEY, loadPrefs, savePrefs, type Prefs } from './prefs';

const storage = getBrowserStorage();

/** The one roll store for the page. All roll triggers go through it. */
export const rollStore = createRollStore({ storage });

export const prefsStore = createMiniStore<Prefs>(loadPrefs(storage));
soundEngine.setEnabled(prefsStore.get().sound);
prefsStore.subscribe(() => {
  const prefs = prefsStore.get();
  savePrefs(storage, prefs);
  soundEngine.setEnabled(prefs.sound);
  document.documentElement.lang = prefs.lang;
});
document.documentElement.lang = prefsStore.get().lang;

export type RendererKind = '3d' | '2d';

interface UiState {
  /** True once a renderer (3D scene or 2D fallback) can animate a roll. */
  rendererReady: boolean;
  renderer: RendererKind | null;
  /** Mat tile under the pointer/focus: matching dice are ringed in the tray. */
  hoveredSymbol: SymbolId | null;
  helpOpen: boolean;
}

export const uiStore = createMiniStore<UiState>({
  rendererReady: false,
  renderer: null,
  hoveredSymbol: null,
  helpOpen: false,
});

// Keep history in sync when another tab of the app rolls or clears.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === HISTORY_KEY) rollStore.reloadHistory();
    if (event.key === PREFS_KEY) prefsStore.set(loadPrefs(storage));
  });
}

/**
 * The single entry point for every roll trigger (button, keyboard, admin).
 * Sound is unlocked here because this runs inside the user gesture.
 */
export function triggerRoll(): boolean {
  if (!uiStore.get().rendererReady) return false;
  soundEngine.unlock();
  const started = rollStore.requestRoll() !== null;
  if (started) uiStore.set({ hoveredSymbol: null });
  return started;
}

export function useRollState<S>(selector: (state: RollState) => S): S {
  return useSyncExternalStore(
    rollStore.subscribe,
    () => selector(rollStore.getState()),
    () => selector(rollStore.getState()),
  );
}

export function usePrefs(): Prefs {
  return useMiniStore(prefsStore, (p) => p);
}

export function useUi<S>(selector: (state: UiState) => S): S {
  return useMiniStore(uiStore, selector);
}
