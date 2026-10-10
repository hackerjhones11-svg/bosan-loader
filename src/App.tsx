import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BosanIntro } from './intro';
import { OpeningPlaceholder } from './opening/OpeningPlaceholder';

/**
 * Preview harness. Reload the page to replay the introduction.
 * Query parameters for review:
 *   ?assets=4000   simulate presentation assets that take 4 s to load
 *   ?assets=never  simulate assets that never load (bounded fallback)
 *   ?duration=14   change the overall intro length (seconds)
 *   ?reduced=1     force the reduced-motion version
 *   ?debug=1       expose window.__bosanIntro for frame-accurate review
 */
function useParams() {
  return useMemo(() => new URLSearchParams(window.location.search), []);
}

export default function App() {
  const params = useParams();
  const [introActive, setIntroActive] = useState(true);
  const [assetsReady, setAssetsReady] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  // The page behind the intro is inert: not focusable, not announced twice.
  useEffect(() => {
    if (pageRef.current) pageRef.current.inert = introActive;
  }, [introActive]);

  // The opening screen needs nothing beyond its fonts; a real presentation
  // reports its own images and data here. Readiness never alters the timeline.
  useEffect(() => {
    let cancelled = false;
    const simulated = params.get('assets');
    const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
    fontsReady.then(() => {
      if (cancelled || simulated === 'never') return;
      const delay = simulated ? Number(simulated) || 0 : 0;
      window.setTimeout(() => !cancelled && setAssetsReady(true), delay);
    });
    return () => {
      cancelled = true;
    };
  }, [params]);

  const onComplete = useCallback(() => setIntroActive(false), []);

  const duration = Number(params.get('duration')) || undefined;
  const reduced = params.get('reduced') === '1' ? true : undefined;

  return (
    <>
      <div ref={pageRef}>
        <OpeningPlaceholder ref={headingRef} introActive={introActive} />
      </div>
      {introActive && (
        <BosanIntro
          assetsReady={assetsReady}
          duration={duration}
          reducedMotion={reduced}
          onComplete={onComplete}
          focusTargetRef={headingRef}
          debug={params.has('debug')}
        />
      )}
    </>
  );
}
