import { useEffect, useRef, useState } from 'react';
import { rollStore, useRollState } from '../app/appState';
import { rankedCounts, sortedFaces, type RollRecord } from '../game/roll';
import { useStrings } from '../hooks/useStrings';
import { formatCount, symbolSpokenName, toNepaliDigits } from '../i18n/strings';
import { SymbolIcon } from './SymbolIcon';

function formatTime(timestamp: number, lang: 'en' | 'ne'): string {
  const text = new Date(timestamp).toLocaleTimeString(lang === 'ne' ? 'en-GB' : undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return lang === 'ne' ? toNepaliDigits(text) : text;
}

function HistoryRow({ roll }: { roll: RollRecord }) {
  const { t, lang } = useStrings();
  const summary = rankedCounts(roll.counts);
  const spoken = summary.map(({ id, count }) => `${symbolSpokenName(id, lang)} ${formatCount(count, lang)}`).join(', ');
  const isTest = roll.mode === 'test';
  return (
    <li className={`history-row${isTest ? ' is-test' : ''}`}>
      <div className="history-meta">
        <time dateTime={new Date(roll.timestamp).toISOString()}>{formatTime(roll.timestamp, lang)}</time>
        {isTest && <span className="test-tag">{t.testTag}</span>}
      </div>
      <div className="history-faces" aria-hidden="true">
        {sortedFaces(roll.faces).map((id, i) => (
          <span className="mini-die" key={i}>
            <SymbolIcon id={id} size="100%" />
          </span>
        ))}
      </div>
      <div className="history-summary" aria-hidden="true">
        {summary.map(({ id, count }) => (
          <span key={id} className={`chip${count > 1 ? ' is-multi' : ''}`}>
            <SymbolIcon id={id} size={14} />
            {formatCount(count, lang)}
          </span>
        ))}
      </div>
      <span className="sr-only">
        {isTest ? `${t.testTag}. ` : ''}
        {spoken}
      </span>
    </li>
  );
}

export function HistoryPanel() {
  const { t } = useStrings();
  const history = useRollState((s) => s.history);
  const [confirming, setConfirming] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  // Keep keyboard focus sensible when swapping between Clear and its confirmation.
  useEffect(() => {
    if (confirming) keepRef.current?.focus();
    else if (wasConfirming.current) clearRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  return (
    <section className="history" aria-labelledby="history-title">
      <div className="history-head">
        <h2 id="history-title">{t.historyTitle}</h2>
        {history.length > 0 &&
          (confirming ? (
            <div className="confirm" role="group" aria-label={t.clearConfirm}>
              <span>{t.clearConfirm}</span>
              <button
                type="button"
                className="text-button danger"
                onClick={() => {
                  rollStore.clearHistory();
                  setConfirming(false);
                }}
              >
                {t.clearYes}
              </button>
              <button type="button" className="text-button" ref={keepRef} onClick={() => setConfirming(false)}>
                {t.clearNo}
              </button>
            </div>
          ) : (
            <button type="button" className="text-button" ref={clearRef} onClick={() => setConfirming(true)}>
              {t.clear}
            </button>
          ))}
      </div>
      {history.length === 0 ? (
        <p className="history-empty">{t.historyEmpty}</p>
      ) : (
        <ol className="history-list">
          {history.map((roll) => (
            <HistoryRow key={roll.id} roll={roll} />
          ))}
        </ol>
      )}
    </section>
  );
}
