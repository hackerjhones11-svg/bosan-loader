import { useState } from 'react';
import { rollStore, triggerRoll, useRollState, useUi } from '../app/appState';
import { countFaces, type Faces } from '../game/roll';
import { isBusy } from '../game/rollStore';
import { SYMBOL_IDS, SYMBOLS, type SymbolId } from '../game/symbols';
import { SymbolIcon } from '../components/SymbolIcon';
import { simulateDistribution, type DistributionReport } from './distribution';

const DEFAULT_SELECTION: Faces = ['jhandi', 'burja', 'itta', 'paan', 'hukum', 'chidi'];

/**
 * Local testing tool, rendered only on the /admin route.
 *
 * SECURITY: this is a client-side prototype with no backend. The /admin route
 * is merely unlinked, not protected; anyone who loads the app can open it.
 * What keeps tests honest is disclosure, not secrecy: an armed override
 * shows TEST MODE on the game screen, the roll and its result are labelled
 * TEST, history marks it, and the override is consumed by exactly one roll.
 * Overrides live in memory for this tab only and never reach other tabs.
 */
export function AdminPanel() {
  const [selection, setSelection] = useState<SymbolId[]>([...DEFAULT_SELECTION]);
  const [report, setReport] = useState<DistributionReport | null>(null);
  const pending = useRollState((s) => s.pendingOverride);
  const busy = useRollState(isBusy);
  const ready = useUi((s) => s.rendererReady);
  const preview = countFaces(selection);

  const choose = (die: number, id: SymbolId) => setSelection((prev) => prev.map((v, i) => (i === die ? id : v)));
  const arm = () => rollStore.setPendingOverride(selection as unknown as Faces);

  return (
    <section className="admin" aria-labelledby="admin-title">
      <h2 id="admin-title">Admin testing</h2>
      <p className="admin-warning">
        Local prototype tool. This route is unlinked but <strong>not secured</strong>. Anyone with the URL can open it.
        Every preset roll is shown as <strong>TEST</strong> on the game screen and in history.
      </p>

      <p className={`admin-status${pending ? ' is-armed' : ''}`} role="status">
        {pending ? 'Override armed: the next roll will be a labelled TEST roll.' : 'Fair random mode. No override armed.'}
      </p>

      <fieldset className="admin-dice">
        <legend>Faces for the next test roll</legend>
        {selection.map((value, die) => (
          <div className="admin-die" role="radiogroup" aria-label={`Die ${die + 1}`} key={die}>
            <span className="admin-die-label">Die {die + 1}</span>
            <div className="admin-options">
              {SYMBOL_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={value === id}
                  aria-label={`${SYMBOLS[id].latin} (${SYMBOLS[id].english})`}
                  className="admin-option"
                  onClick={() => choose(die, id)}
                >
                  <SymbolIcon id={id} size="100%" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </fieldset>

      <div className="admin-preview" aria-label="Preview counts">
        {SYMBOL_IDS.map((id) => (
          <span key={id} className={`chip${preview[id] > 1 ? ' is-multi' : ''}${preview[id] === 0 ? ' is-zero' : ''}`}>
            <SymbolIcon id={id} size={14} />
            {SYMBOLS[id].latin} {preview[id]}
          </span>
        ))}
      </div>

      <div className="admin-actions">
        <button type="button" className="secondary-button" onClick={arm} disabled={busy}>
          Arm for next roll
        </button>
        <button
          type="button"
          className="secondary-button accent"
          disabled={busy || !ready}
          onClick={() => {
            arm();
            if (!triggerRoll()) rollStore.setPendingOverride(null);
          }}
        >
          Run test roll now
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={!pending}
          onClick={() => rollStore.setPendingOverride(null)}
        >
          Clear override (restore random)
        </button>
        <button type="button" className="text-button" onClick={() => setSelection([...DEFAULT_SELECTION])}>
          Reset selection
        </button>
      </div>

      <details className="admin-diag">
        <summary>Distribution diagnostic (developer tool)</summary>
        <p>
          Tallies fair crypto rolls. Results naturally fluctuate; this is not a pass/fail test. Never affects
          history or outcomes.
        </p>
        <button type="button" className="secondary-button" onClick={() => setReport(simulateDistribution(20000))}>
          Simulate 20,000 rolls
        </button>
        {report && (
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col">Dice</th>
                <th scope="col">Share</th>
              </tr>
            </thead>
            <tbody>
              {SYMBOL_IDS.map((id) => (
                <tr key={id}>
                  <th scope="row">{SYMBOLS[id].latin}</th>
                  <td>{report.counts[id].toLocaleString()}</td>
                  <td>{((report.counts[id] / report.dice) * 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>
                  Expected 16.67% each · χ² = {report.chiSquare.toFixed(2)} (5 d.f.)
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </details>
    </section>
  );
}
