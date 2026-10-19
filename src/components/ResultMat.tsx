import type { CSSProperties, PointerEvent } from 'react';
import { uiStore, useRollState } from '../app/appState';
import { rankedCounts } from '../game/roll';
import { hasShownResult } from '../game/rollStore';
import { ROLL_TIMING } from '../game/rollTiming';
import { SYMBOL_IDS, SYMBOLS, type SymbolId } from '../game/symbols';
import { useStrings } from '../hooks/useStrings';
import { formatCount, symbolLabels } from '../i18n/strings';
import { SymbolIcon } from './SymbolIcon';

function MatTile({ id, count, rollKey, index }: { id: SymbolId; count: number | null; rollKey: string; index: number }) {
  const { t, lang } = useStrings();
  const { primary, secondary } = symbolLabels(id, lang);
  const state = count === null ? 'is-waiting' : count === 0 ? 'is-zero' : count > 1 ? 'is-hit is-multi' : 'is-hit';
  // Mouse: highlight while hovering. Touch/pen: a tap toggles a sticky highlight.
  const onPointerEnter = (e: PointerEvent<HTMLLIElement>) => {
    if (e.pointerType === 'mouse') uiStore.set({ hoveredSymbol: id });
  };
  const onPointerLeave = (e: PointerEvent<HTMLLIElement>) => {
    if (e.pointerType === 'mouse') uiStore.set({ hoveredSymbol: null });
  };
  const onPointerUp = (e: PointerEvent<HTMLLIElement>) => {
    if (e.pointerType !== 'mouse') uiStore.set({ hoveredSymbol: uiStore.get().hoveredSymbol === id ? null : id });
  };

  // Each tile reveals a beat after the previous one, once the dice have been held still briefly.
  const style = { '--reveal-delay': `${ROLL_TIMING.revealHold + index * ROLL_TIMING.countStagger}s` } as CSSProperties;

  return (
    <li
      className={`tile tone-${SYMBOLS[id].tone} ${state}`}
      style={style}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerUp={onPointerUp}
    >
      <div className="tile-symbol">
        <SymbolIcon id={id} size="100%" />
      </div>
      <div className="tile-names">
        <span className="tile-primary">{primary}</span>
        <span className="tile-secondary">{secondary}</span>
      </div>
      <div className="tile-count" key={rollKey}>
        {count === null ? <span aria-hidden="true">–</span> : formatCount(count, lang)}
        <span className="sr-only">{count === null ? '' : ` ${t.diceCount(count)}`}</span>
      </div>
      <div className="tile-pips" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={count !== null && i < count ? 'pip on' : 'pip'} />
        ))}
      </div>
    </li>
  );
}

/** e.g. "Paan ×3 · Jhandi ×2 · Burja ×1", most frequent first. */
function ResultSummary({ counts }: { counts: Parameters<typeof rankedCounts>[0] }) {
  const { lang } = useStrings();
  // Appears just after the last tile has turned over.
  const delay = ROLL_TIMING.revealHold + SYMBOL_IDS.length * ROLL_TIMING.countStagger + 0.04;
  return (
    <p className="mat-summary" style={{ animationDelay: `${delay}s` }}>
      {rankedCounts(counts).map(({ id, count }, i) => (
        <span key={id} className={count > 1 ? 'summary-item is-multi' : 'summary-item'}>
          {i > 0 && <span className="summary-dot" aria-hidden="true"> · </span>}
          {symbolLabels(id, lang).primary} <span className="summary-times">×{formatCount(count, lang)}</span>
        </span>
      ))}
    </p>
  );
}

/**
 * The six-symbol mat. Counts appear only once the dice are confirmed at rest
 * (reveal or result phase) and come straight from `lastResult.counts`, the
 * same record the dice settled on.
 */
export function ResultMat() {
  const { t } = useStrings();
  const phase = useRollState((s) => s.phase);
  const lastResult = useRollState((s) => s.lastResult);
  const recovered = useRollState((s) => s.recovered);
  const showCounts = useRollState(hasShownResult) && lastResult !== null;
  const moving = phase === 'rolling' || phase === 'settling';

  return (
    <section className={`mat${showCounts ? ' has-result' : ''}${moving ? ' is-moving' : ''}`} aria-labelledby="mat-title">
      <div className="mat-head">
        <h2 id="mat-title">{t.resultTitle}</h2>
        {showCounts ? (
          <ResultSummary key={lastResult.id} counts={lastResult.counts} />
        ) : (
          <p className="mat-status">{moving ? t.resultRolling : t.resultIdle}</p>
        )}
      </div>
      <ul className="mat-grid" aria-label={t.matLabel}>
        {SYMBOL_IDS.map((id, index) => (
          <MatTile
            key={id}
            id={id}
            index={index}
            count={showCounts ? lastResult.counts[id] : null}
            rollKey={lastResult?.id ?? 'none'}
          />
        ))}
      </ul>
      {showCounts && recovered && <p className="mat-note">{t.resultRecovered}</p>}
    </section>
  );
}
