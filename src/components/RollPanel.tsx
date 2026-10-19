import { triggerRoll, useRollState, useUi } from '../app/appState';
import { isBusy } from '../game/rollStore';
import { useStrings } from '../hooks/useStrings';

/** The primary control. On narrow screens CSS docks it to the bottom edge, above the safe area. */
export function RollPanel() {
  const { t, lang } = useStrings();
  const phase = useRollState((s) => s.phase);
  const busy = useRollState(isBusy);
  const testArmed = useRollState((s) => s.pendingOverride !== null || s.activeRoll?.mode === 'test');
  const ready = useUi((s) => s.rendererReady);
  const unavailable = busy || !ready;

  // During the short reveal the button already reads "Roll Dice" but stays unavailable until it ends.
  const label = !ready ? t.preparing : phase === 'rolling' ? t.rolling : phase === 'settling' ? t.settling : t.roll;
  const showSub = ready && (!busy || phase === 'revealing');

  return (
    <div className="roll-panel">
      <button
        type="button"
        className={`roll-button${testArmed ? ' is-test' : ''}`}
        aria-disabled={unavailable}
        aria-busy={busy}
        onClick={() => {
          if (!unavailable) triggerRoll();
        }}
      >
        <span className="roll-main">{label}</span>
        {showSub && (
          <span className="roll-sub" lang={lang === 'en' ? 'ne' : 'en'}>
            {t.rollOther}
          </span>
        )}
        {testArmed && <span className="roll-test-tag">{t.testTag}</span>}
      </button>
      <p className="roll-hint">{t.shortcutHint}</p>
    </div>
  );
}
