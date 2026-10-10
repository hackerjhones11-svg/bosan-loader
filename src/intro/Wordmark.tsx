import { forwardRef } from 'react';
import { GLYPH_ORDER, WORDMARKS, glyphPath, type GlyphKey, type LayoutMode } from './layout';
import type { Frame } from './frame';

interface GlyphsProps {
  mode: LayoutMode;
  /** adds data-glyph attributes and starts each letter hidden, for the intro to reveal */
  addressable?: boolean;
}

const HIDDEN = { opacity: 0 };

/** The finished BOSAN HILLS letterforms, flat and front-facing. */
export function WordmarkGlyphs({ mode, addressable }: GlyphsProps) {
  const wm = WORDMARKS[mode];
  return (
    <g fill="#FFFFFF">
      {GLYPH_ORDER.map((key: GlyphKey) => {
        const g = wm.glyphs[key];
        return (
          <path
            key={key}
            data-glyph={addressable ? key : undefined}
            style={addressable ? HIDDEN : undefined}
            transform={`translate(${g.x} ${g.y})`}
            d={glyphPath(key)}
          />
        );
      })}
    </g>
  );
}

interface WordmarkSvgProps {
  frame: Frame;
  className?: string;
  /** accessible name; omit to mark the artwork decorative */
  label?: string;
  /**
   * Intro use: letters start hidden and sit in a group the timeline can move
   * with its camera. Once the intro settles it clears both, leaving markup
   * identical to the opening screen's so the two render the same pixels.
   */
  intro?: boolean;
}

/**
 * Full-viewport SVG that draws only the wordmark, using the same frame as the
 * intro. The opening screen renders this so the title never shifts at handoff.
 */
export const WordmarkSvg = forwardRef<SVGSVGElement, WordmarkSvgProps>(function WordmarkSvg(
  { frame, className, label, intro },
  ref,
) {
  const glyphs = <WordmarkGlyphs mode={frame.mode} addressable={intro} />;
  return (
    <svg
      ref={ref}
      className={className}
      width={frame.vw}
      height={frame.vh}
      viewBox={frame.viewBox}
      preserveAspectRatio="xMidYMid meet"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      shapeRendering="geometricPrecision"
    >
      {intro ? <g data-k="final-camera">{glyphs}</g> : glyphs}
    </svg>
  );
});
