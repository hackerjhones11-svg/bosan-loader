import type { KeyValueStorage } from '../game/storage';

export type Lang = 'en' | 'ne';

export interface Prefs {
  sound: boolean;
  lang: Lang;
}

export const PREFS_KEY = 'langur-burja:prefs:v1';
export const DEFAULT_PREFS: Prefs = { sound: true, lang: 'en' };

export function loadPrefs(storage: KeyValueStorage): Prefs {
  try {
    const raw = storage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      sound: typeof parsed.sound === 'boolean' ? parsed.sound : DEFAULT_PREFS.sound,
      lang: parsed.lang === 'ne' || parsed.lang === 'en' ? parsed.lang : DEFAULT_PREFS.lang,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(storage: KeyValueStorage, prefs: Prefs): void {
  storage.setItem(PREFS_KEY, JSON.stringify(prefs));
}
