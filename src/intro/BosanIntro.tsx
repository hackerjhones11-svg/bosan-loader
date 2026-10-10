import gsap from 'gsap';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { computeFrame } from './frame';
import { IntroScene } from './scene/IntroScene';
import {
  BASE_DURATION,
  BLACK_END,
  HOLD_END,
  HOLD_START,
  REVEAL_DURATION,
  createIntroTimeline,
  type IntroTimeline,
} from './timeline';
import { useScrollLock } from './useScrollLock';
import { useViewport } from './useViewport';
import { WordmarkSvg } from './Wordmark';
import './bosan-intro.css';

export interface BosanIntroCompleteInfo {
  /** the viewer used Skip intro */
  skipped: boolean;
  /** assets were still not ready when the bounded wait ran out */
  timedOut: boolean;
}

export interface BosanIntroProps {
  /** Called once, after the black has fully opened into the presentation. */
  onComplete?: (info: BosanIntroCompleteInfo) => void;
  /** Called when the black begins to open — start the opening screen's own entrance here. */
  onReveal?: () => void;
  /**
   * Whether the presentation behind the intro is ready. The construction
   * always plays in full; if assets are not ready when it finishes, the
   * finished name holds on black until they are (or until `maxAssetWait`).
   */
  assetsReady?: boolean;
  /** Total length of the introduction in seconds, including the handoff. */
  duration?: number;
  /** Longest the finished name will hold waiting for assets (ms). */
  maxAssetWait?: number;
  /** Override the prefers-reduced-motion media query. */
  reducedMotion?: boolean;
  /** Accessible name of the presentation. */
  label?: string;
  /** Show the Skip intro control after the opening black. */
  skippable?: boolean;
  /** Lock page scrolling while the intro is on screen. */
  lockScroll?: boolean;
  /** Element to focus if keyboard focus was inside the intro when it ends. */
  focusTargetRef?: RefObject<HTMLElement>;
  /** Exposes the timeline on window.__bosanIntro for frame-accurate review. */
  debug?: boolean;
}

export interface BosanIntroHandle {
  /** Restart the complete introduction from black. */
  replay: () => void;
  /** Jump to the finished name and hand off. */
  skip: () => void;
}

type Phase = 'playing' | 'holding' | 'revealing' | 'done';

function usePrefersReducedMotion(override?: boolean): boolean {
  const [pref, setPref] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setPref(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return override ?? pref;
}

/** Reduced motion: a quiet wordmark on black, then a brief dissolve. */
const REDUCED = { fadeIn: 0.7, hold: 1.6, reveal: 0.9 };

export const BosanIntro = forwardRef<BosanIntroHandle, BosanIntroProps>(function BosanIntro(
  {
    onComplete,
    onReveal,
    assetsReady = true,
    duration = BASE_DURATION,
    maxAssetWait = 8000,
    reducedMotion,
    label = 'BOSAN HILLS',
    skippable = true,
    lockScroll = true,
    focusTargetRef,
    debug = false,
  },
  ref,
) {
  const reduced = usePrefersReducedMotion(reducedMotion);
  const { vw, vh } = useViewport();
  const frame = useMemo(() => computeFrame(vw, vh), [vw, vh]);

  const rootRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SVGSVGElement>(null);
  const quietRef = useRef<SVGSVGElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);

  const [run, setRun] = useState(0);
  const [phase, setPhase] = useState<Phase>('playing');
  const [skipVisible, setSkipVisible] = useState(false);
  const [waitExpired, setWaitExpired] = useState(false);

  const timeScale = BASE_DURATION / Math.max(1, duration);
  const introRef = useRef<IntroTimeline | null>(null);
  const timeRef = useRef(0);
  const skippedRef = useRef(false);
  const revealTlRef = useRef<gsap.core.Timeline | null>(null);
  const completedRef = useRef(false);

  // Latest callbacks and readiness without re-running effects.
  const cb = useRef({ onComplete, onReveal, assetsReady });
  cb.current = { onComplete, onReveal, assetsReady };

  useScrollLock(lockScroll && phase !== 'done');

  // ── construction timeline ─────────────────────────────────────────
  useLayoutEffect(() => {
    if (reduced) return;
    const svg = sceneRef.current;
    if (!svg) return;
    const intro = createIntroTimeline(svg, frame);
    introRef.current = intro;
    intro.tl.timeScale(timeScale);
    intro.tl.eventCallback('onComplete', () => setPhase((p) => (p === 'playing' ? 'holding' : p)));
    // Skip intro is offered after the opening black and withdrawn once the
    // name stands alone, so nothing shares the screen with it in the hold.
    intro.tl.call(() => setSkipVisible(skippable), [], BLACK_END);
    intro.tl.call(() => setSkipVisible(false), [], HOLD_START);
    // Rebuilt after a layout change mid-run: continue from the same moment.
    const resumeAt = timeRef.current;
    intro.tl.time(resumeAt, true);
    intro.render();
    setSkipVisible(skippable && resumeAt >= BLACK_END && resumeAt < HOLD_START);
    if (resumeAt >= HOLD_END) {
      setPhase((p) => (p === 'playing' ? 'holding' : p));
    } else {
      intro.tl.play();
    }
    const tick = () => {
      timeRef.current = intro.tl.time();
    };
    gsap.ticker.add(tick);
    if (debug) {
      (window as unknown as Record<string, unknown>).__bosanIntro = {
        tl: intro.tl,
        seek: (t: number) => {
          intro.tl.pause();
          intro.tl.time(t, true);
          intro.render();
        },
        play: () => intro.tl.play(),
        activeTweens: () => gsap.globalTimeline.getChildren(true, true, true).filter((t) => t.isActive()).length,
        children: () => gsap.globalTimeline.getChildren(false, true, true).length,
      };
    }
    return () => {
      gsap.ticker.remove(tick);
      intro.tl.kill();
      introRef.current = null;
    };
    // frame.mode is the only frame property that changes the scene geometry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, frame.mode, reduced, skippable]);

  // a new duration applies to the running timeline without restarting it
  useEffect(() => {
    introRef.current?.tl.timeScale(timeScale);
  }, [timeScale]);

  // ── reduced motion: quiet wordmark only ───────────────────────────
  useLayoutEffect(() => {
    if (!reduced) return;
    const svg = quietRef.current;
    if (!svg) return;
    const tl = gsap.timeline({ onComplete: () => setPhase((p) => (p === 'playing' ? 'holding' : p)) });
    tl.fromTo(svg, { opacity: 0 }, { opacity: 1, duration: REDUCED.fadeIn, ease: 'sine.out' }, 0.3);
    tl.to({}, { duration: REDUCED.hold });
    return () => {
      tl.kill();
    };
  }, [run, reduced]);

  // ── bounded wait for assets once the name is complete ─────────────
  useEffect(() => {
    if (phase !== 'holding' || assetsReady) return;
    const t = window.setTimeout(() => setWaitExpired(true), maxAssetWait);
    return () => window.clearTimeout(t);
  }, [phase, assetsReady, maxAssetWait]);

  /** keyboard focus was inside the intro (e.g. on Skip intro) and must be handed on */
  const focusInsideRef = useRef(false);

  const finish = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    const root = rootRef.current;
    const handFocus = focusInsideRef.current || (!!root && root.contains(document.activeElement));
    setPhase('done');
    cb.current.onComplete?.({ skipped: skippedRef.current, timedOut: !cb.current.assetsReady });
    if (handFocus) {
      // Wait for the host to commit (and lift any inert state) before focusing.
      const target = focusTargetRef?.current;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (target && target.isConnected) target.focus({ preventScroll: true });
          else if (root?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
        }),
      );
    }
  }, [focusTargetRef]);

  // ── handoff: the black opens around the name ──────────────────────
  useEffect(() => {
    if (phase !== 'holding' || !(assetsReady || waitExpired)) return;
    const backdrop = backdropRef.current;
    if (!backdrop) return;
    setPhase('revealing');
    cb.current.onReveal?.();
    const fast = skippedRef.current;
    const total = reduced ? REDUCED.reveal : fast ? 0.9 : REVEAL_DURATION / timeScale;
    const state = { o: 0 };
    const h = window.innerHeight;
    const feather = Math.max(80, h * 0.16);
    const apply = () => {
      if (reduced) {
        backdrop.style.opacity = String(1 - state.o);
        return;
      }
      // a soft-edged band opens from the wordmark's centre line outward;
      // it starts fully closed and thins before it widens
      const half = state.o * (h / 2 + feather);
      const k = Math.min(1, state.o / 0.12);
      const inner = `rgba(0,0,0,${(1 - k).toFixed(3)})`;
      const a = `calc(50% - ${half.toFixed(1)}px)`;
      const b = `calc(50% + ${half.toFixed(1)}px)`;
      const a2 = `calc(50% - ${(half + feather).toFixed(1)}px)`;
      const b2 = `calc(50% + ${(half + feather).toFixed(1)}px)`;
      const mask = `linear-gradient(to bottom, #000 ${a2}, ${inner} ${a}, ${inner} ${b}, #000 ${b2})`;
      backdrop.style.maskImage = mask;
      backdrop.style.webkitMaskImage = mask;
      backdrop.style.opacity = String(Math.min(1, (1 - state.o) / 0.35));
    };
    const tl = gsap.timeline({ onComplete: finish });
    tl.to(state, { o: 1, duration: total, ease: reduced ? 'sine.inOut' : 'power2.inOut', onUpdate: apply });
    revealTlRef.current = tl;
    apply();
    if (debug) {
      // review tooling: optionally hold the handoff so it can be stepped frame by frame
      const dbg = (window as unknown as Record<string, Record<string, unknown>>).__bosanIntro;
      if (dbg) {
        dbg.reveal = tl;
        if (dbg.pauseReveal) tl.pause();
      }
    }
    return () => {
      // only kill on unmount/replay; phase changes to 'revealing' re-run this effect harmlessly
    };
  }, [phase, assetsReady, waitExpired, reduced, timeScale, finish, debug]);

  // ── hard failsafe: the intro can never stay on screen indefinitely ─
  // Counts only time the page is visible, so a tab opened in the background
  // still plays its intro when the viewer arrives.
  useEffect(() => {
    if (debug) return;
    const limit = (reduced ? 6000 : (duration + 4) * 1000) + maxAssetWait;
    let visibleMs = 0;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      if (document.visibilityState === 'visible') visibleMs += Math.min(now - last, 1000);
      last = now;
      if (visibleMs >= limit) {
        window.clearInterval(id);
        introRef.current?.tl.kill();
        revealTlRef.current?.kill();
        if (backdropRef.current) backdropRef.current.style.opacity = '0';
        finish();
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [run, reduced, duration, maxAssetWait, finish, debug]);

  // kill the handoff tween on unmount or replay
  useEffect(
    () => () => {
      revealTlRef.current?.kill();
      revealTlRef.current = null;
    },
    [run],
  );

  const skip = useCallback(() => {
    if (phase !== 'playing') return;
    skippedRef.current = true;
    focusInsideRef.current = !!rootRef.current?.contains(document.activeElement);
    const intro = introRef.current;
    if (intro) {
      intro.tl.progress(1, true);
      intro.tl.pause();
      intro.render();
      timeRef.current = intro.tl.time();
    }
    setSkipVisible(false);
    setPhase('holding');
  }, [phase]);

  const replay = useCallback(() => {
    revealTlRef.current?.kill();
    revealTlRef.current = null;
    timeRef.current = 0;
    skippedRef.current = false;
    completedRef.current = false;
    focusInsideRef.current = false;
    const backdrop = backdropRef.current;
    if (backdrop) {
      backdrop.style.opacity = '1';
      backdrop.style.maskImage = '';
      backdrop.style.webkitMaskImage = '';
    }
    setWaitExpired(false);
    setPhase('playing');
    setRun((r) => r + 1);
  }, []);

  useImperativeHandle(ref, () => ({ replay, skip }), [replay, skip]);

  // Escape also skips while the construction plays.
  useEffect(() => {
    if (!skippable || phase !== 'playing') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && skipVisible) skip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [skippable, phase, skipVisible, skip]);

  const done = phase === 'done';

  return (
    <div
      ref={rootRef}
      className={`bosan-intro${done ? ' bosan-intro--done' : ''}`}
      data-phase={phase}
      aria-hidden={done ? true : undefined}
    >
      <div ref={backdropRef} className="bosan-intro__backdrop" />
      <div className="bosan-intro__name" role="img" aria-label={label}>
        {reduced ? (
          <WordmarkSvg key={`q${run}`} ref={quietRef} frame={frame} className="bosan-intro__scene" />
        ) : (
          <IntroScene key={`${frame.mode}-${run}`} ref={sceneRef} frame={frame} />
        )}
      </div>
      {skippable && !reduced && (
        <button
          ref={skipRef}
          type="button"
          className={`bosan-intro__skip${skipVisible && phase === 'playing' ? ' is-visible' : ''}`}
          onClick={skip}
          tabIndex={skipVisible && phase === 'playing' ? 0 : -1}
          aria-hidden={skipVisible && phase === 'playing' ? undefined : true}
        >
          Skip intro
        </button>
      )}
    </div>
  );
});
