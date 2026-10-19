/** Minimal localStorage-compatible interface so persistence can be tested and can fail safely. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

/**
 * Browser localStorage, or an in-memory stand-in when it is unavailable
 * (private mode, disabled cookies, sandboxed iframes). Every call is guarded:
 * storage problems must never break a roll.
 */
export function getBrowserStorage(): KeyValueStorage {
  let backing: Storage | null;
  try {
    backing = globalThis.localStorage ?? null;
    const probe = '__langur_burja_probe__';
    backing?.setItem(probe, probe);
    backing?.removeItem(probe);
  } catch {
    backing = null;
  }
  if (!backing) return createMemoryStorage();
  const store = backing;
  return {
    getItem(key) {
      try {
        return store.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        store.setItem(key, value);
      } catch {
        // Quota or security errors: keep running with in-memory state.
      }
    },
    removeItem(key) {
      try {
        store.removeItem(key);
      } catch {
        // ignore
      }
    },
  };
}
