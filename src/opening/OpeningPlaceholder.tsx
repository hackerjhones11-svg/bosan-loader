import { forwardRef } from 'react';
import { computeFrame, useViewport, WordmarkSvg } from '../intro';
import { WORDMARKS } from '../intro/layout';

interface Props {
  /** the intro is still on screen: hide the title so it is never doubled */
  introActive: boolean;
  /** the black has started to open: bring in the secondary details */
  revealed: boolean;
  onReplay: () => void;
}

/**
 * A deliberately quiet stand-in for the presentation's first screen. The
 * title is drawn with the same frame as the intro so the handoff is seamless.
 */
export const OpeningPlaceholder = forwardRef<HTMLHeadingElement, Props>(function OpeningPlaceholder(
  { introActive, revealed, onReplay },
  headingRef,
) {
  const { vw, vh } = useViewport();
  const frame = computeFrame(vw, vh);
  const wm = WORDMARKS[frame.mode];
  const below = vh / 2 + (wm.box.y1 - wm.cy) * frame.scale;
  const capPx = 625 * frame.scale;

  return (
    <main className={`opening${revealed ? ' is-revealed' : ''}`}>
      <section className="opening__hero" style={{ height: vh }} aria-labelledby="opening-title">
        <div className="opening__ground" aria-hidden="true">
          <svg viewBox="0 0 1600 400" preserveAspectRatio="none">
            <path d="M0 300 C 220 250, 420 238, 640 262 S 1080 318, 1320 270 S 1520 232, 1600 240" />
            <path d="M0 336 C 260 300, 520 292, 760 314 S 1180 356, 1600 300" />
            <path d="M0 368 C 300 346, 640 340, 900 356 S 1360 384, 1600 350" />
          </svg>
        </div>

        <h1
          id="opening-title"
          ref={headingRef}
          tabIndex={-1}
          className={`opening__title${introActive ? ' is-hidden' : ''}`}
        >
          <WordmarkSvg frame={frame} className="opening__wordmark" />
          <span className="visually-hidden">BOSAN HILLS</span>
        </h1>

        <p className="opening__subtitle" style={{ top: below + capPx * 0.62 }}>
          Architectural presentation
        </p>

        <div className="opening__footer">
          <button type="button" className="opening__replay" onClick={onReplay}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5" />
              <path d="M4.4 1.9v2.8h2.8" />
            </svg>
            Replay intro
          </button>
          <span className="opening__note">Opening screen · placeholder</span>
        </div>
      </section>

      <section className="opening__next">
        <p>The presentation continues here.</p>
      </section>
    </main>
  );
});
