import { useRollState } from '../app/appState';
import { testModeVisible } from '../game/rollStore';
import { useStrings } from '../hooks/useStrings';

/**
 * Disclosure for admin-preset rolls. Shown while an override is armed, while a
 * test roll is in motion, and on its result. It sits in the page flow (never
 * over the tray) and cannot be dismissed.
 */
export function TestModeBanner() {
  const { t } = useStrings();
  const visible = useRollState(testModeVisible);
  const stage = useRollState((s) =>
    s.activeRoll?.mode === 'test' ? 'rolling' : s.pendingOverride ? 'pending' : 'result',
  );
  if (!visible) return null;
  const message = stage === 'pending' ? t.testPending : stage === 'rolling' ? t.testRolling : t.testResult;
  return (
    <div className="test-banner" role="status">
      <strong>{t.testMode}</strong>
      <span>{message}</span>
    </div>
  );
}
