import { Component, lazy, Suspense, useCallback, useState, type ReactNode } from 'react';
import { useRollState } from '../app/appState';
import { testModeVisible } from '../game/rollStore';
import { Dice2D } from '../fallback2d/Dice2D';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useStrings } from '../hooks/useStrings';
import { symbolSpokenName } from '../i18n/strings';

// Three.js, React Three Fiber and the physics engine load in a separate chunk,
// so the page shell, mat and history appear immediately.
const DiceStage3D = lazy(() => import('../dice3d/DiceStage3D'));

/** `?renderer=2d` forces the fallback for testing. */
function initialRenderer(): '3d' | '2d' {
  try {
    if (new URLSearchParams(window.location.search).get('renderer') === '2d') return '2d';
  } catch {
    // ignore
  }
  return webglAvailable() ? '3d' : '2d';
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

class RendererBoundary extends Component<{ onError: (error: unknown) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function StageLoading() {
  const { t } = useStrings();
  return (
    <div className="stage-loading" role="status">
      <span className="loading-die" aria-hidden="true" />
      <span>{t.preparing}</span>
    </div>
  );
}

/** Text description of the dice for screen readers (the canvas itself is hidden from them). */
function StageDescription() {
  const { t, lang } = useStrings();
  const phase = useRollState((s) => s.phase);
  const lastResult = useRollState((s) => s.lastResult);
  if (phase === 'rolling' || phase === 'settling') return <p className="sr-only">{t.resultRolling}</p>;
  if (!lastResult) return <p className="sr-only">{t.trayIntro}</p>;
  return (
    <p className="sr-only">
      {t.trayShowing}: {lastResult.faces.map((f, i) => `${t.die} ${i + 1} ${symbolSpokenName(f, lang)}`).join(', ')}
    </p>
  );
}

export function Stage() {
  const { t } = useStrings();
  const reducedMotion = useReducedMotion();
  const [renderer, setRenderer] = useState(initialRenderer);
  const [notice, setNotice] = useState<string | null>(null);
  const testing = useRollState(testModeVisible);

  const fallBack = useCallback(
    (reason: unknown) => {
      console.warn('[stage] switching to 2D dice:', reason);
      setNotice(t.fallbackNotice);
      setRenderer('2d');
    },
    [t.fallbackNotice],
  );

  return (
    <div className={`stage${testing ? ' is-test' : ''}`} role="region" aria-label={t.diceTray}>
      <StageDescription />
      {renderer === '3d' ? (
        <RendererBoundary onError={fallBack}>
          <Suspense fallback={<StageLoading />}>
            <DiceStage3D reducedMotion={reducedMotion} onFail={fallBack} />
          </Suspense>
        </RendererBoundary>
      ) : (
        <Dice2D reducedMotion={reducedMotion} notice={notice} />
      )}
    </div>
  );
}
