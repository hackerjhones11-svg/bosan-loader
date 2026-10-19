import { usePrefs } from '../app/appState';
import type { Lang } from '../app/prefs';
import { STRINGS, type Strings } from '../i18n/strings';

export function useStrings(): { t: Strings; lang: Lang } {
  const { lang } = usePrefs();
  return { t: STRINGS[lang], lang };
}
