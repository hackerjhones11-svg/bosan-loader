import { useEffect, useRef, useState } from 'react';
import { rollStore, prefsStore } from '../app/appState';
import { rankedCounts } from '../game/roll';
import { formatCount, STRINGS, symbolSpokenName } from '../i18n/strings';

/**
 * Polite live region: one announcement per completed roll, built from the
 * same RollRecord the dice and mat show.
 */
export function LiveAnnouncer() {
  const [message, setMessage] = useState('');
  const announced = useRef<string | null>(rollStore.getState().lastResult?.id ?? null);

  useEffect(() => {
    let frame = 0;
    const check = () => {
      const { phase, lastResult } = rollStore.getState();
      if (phase !== 'result' || !lastResult || announced.current === lastResult.id) return;
      announced.current = lastResult.id;
      const { lang } = prefsStore.get();
      const t = STRINGS[lang];
      const counts = rankedCounts(lastResult.counts)
        .map(({ id, count }) => `${symbolSpokenName(id, lang)}: ${formatCount(count, lang)}`)
        .join(', ');
      const text = `${lastResult.mode === 'test' ? t.announceTest : t.announce} ${counts}.`;
      // Clear first so identical consecutive results are still announced.
      setMessage('');
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setMessage(text));
    };
    const unsubscribe = rollStore.subscribe(check);
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}
