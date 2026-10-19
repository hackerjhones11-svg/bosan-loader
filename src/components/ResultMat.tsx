import type { PointerEvent } from 'react';
import { uiStore, useRollState } from '../app/appState';
import { SYMBOL_IDS, SYMBOLS, type SymbolId } from '../game/symbols';
import { useStrings } from '../hooks/useStrings';
import { formatCount, symbolLabels } from '../i18n/strings';
import { SymbolIcon } from './SymbolIcon';

function MatTile({ id, count, rollKey }: { id: SymbolId; count: number | null; rollKey: string }) {
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

  return (
    <li
      className={`tile tone-${SYMBOLS[id].tone} ${state}`}
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

/**
 * The six-symbol mat. Counts are shown only for a completed roll and come
 * straight from `lastResult.counts`, the same record the dice animated toward.
 */
export function ResultMat() {
  const { t } = useStrings();
  const phase = useRollState((s) => s.phase);
  const lastResult = useRollState((s) => s.lastResult);
  const recovered = useRollState((s) => s.recovered);
  const showCounts = phase === 'result' && lastResult !== null;
  const status = phase === 'rolling' || phase === 'settling' ? t.resultRolling : showCounts ? t.resultTotal : t.resultIdle;

  return (
    <section className={`mat${showCounts ? ' has-result' : ''}`} aria-labelledby="mat-title">
      <div className="mat-head">
        <h2 id="mat-title">{t.resultTitle}</h2>
        <p className="mat-status">{status}</p>
      </div>
      <ul className="mat-grid" aria-label={t.matLabel}>
        {SYMBOL_IDS.map((id) => (
          <MatTile key={id} id={id} count={showCounts ? lastResult.counts[id] : null} rollKey={lastResult?.id ?? 'none'} />
        ))}
      </ul>
      {showCounts && recovered && <p className="mat-note">{t.resultRecovered}</p>}
    </section>
  );
}
