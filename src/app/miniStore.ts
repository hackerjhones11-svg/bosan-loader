import { useSyncExternalStore } from 'react';

/** Tiny observable value for UI-only state (prefs, renderer readiness, hover). */
export interface MiniStore<T> {
  get(): T;
  set(patch: Partial<T>): void;
  subscribe(listener: () => void): () => void;
}

export function createMiniStore<T extends object>(initial: T): MiniStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(patch) {
      const next = { ...value, ...patch };
      if (Object.keys(patch).every((k) => Object.is(next[k as keyof T], value[k as keyof T]))) return;
      value = next;
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useMiniStore<T extends object, S>(store: MiniStore<T>, selector: (value: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}
