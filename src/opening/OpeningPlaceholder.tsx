import { forwardRef } from 'react';
import { computeFrame, useViewport, WordmarkSvg } from '../intro';

interface Props {
  /** the intro is still on screen: hide the title so it is never doubled */
  introActive: boolean;
}

/**
 * The opening screen: only the BOSAN HILLS wordmark on pure black. The title
 * is drawn with the same frame as the intro, so when the intro hands off the
 * name stays exactly where it is.
 */
export const OpeningPlaceholder = forwardRef<HTMLHeadingElement, Props>(function OpeningPlaceholder(
  { introActive },
  headingRef,
) {
  const { vw, vh } = useViewport();
  const frame = computeFrame(vw, vh);

  return (
    <main className="opening" style={{ height: vh }}>
      <h1
        id="opening-title"
        ref={headingRef}
        tabIndex={-1}
        className={`opening__title${introActive ? ' is-hidden' : ''}`}
      >
        <WordmarkSvg frame={frame} className="opening__wordmark" />
        <span className="visually-hidden">BOSAN HILLS</span>
      </h1>
    </main>
  );
});
