import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/** `?motion=reduced` forces reduced motion for testing; otherwise follows the OS setting. */
function forcedByUrl(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('motion') === 'reduced';
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const mql = matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function snapshot(): boolean {
  return forcedByUrl() || (typeof matchMedia === 'function' && matchMedia(QUERY).matches);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
