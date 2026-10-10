import { forwardRef } from 'react';
import { GLYPH_ORDER, WORDMARKS, glyphPath, type GlyphKey, type LayoutMode } from './layout';
import type { Frame } from './frame';

interface GlyphsProps {
  mode: LayoutMode;
  fill?: string;
  /** adds data-glyph attributes so a timeline can address each letter */
  addressable?: boolean;
  /** initial opacity of each letter (the intro starts them hidden) */
  opacity?: number;
}

/** The finished BOSAN HILLS letterforms, flat and front-facing. */
export function WordmarkGlyphs({ mode, fill = '#FFFFFF', addressable, opacity }: GlyphsProps) {
  const wm = WORDMARKS[mode];
  return (
    <g fill={fill}>
      {GLYPH_ORDER.map((key: GlyphKey) => {
        const g = wm.glyphs[key];
        return (
          <path
            key={key}
            data-glyph={addressable ? key : undefined}
            opacity={opacity}
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
}

/**
 * Full-viewport SVG that draws only the wordmark, using the same frame as the
 * intro. The opening screen renders this so the title never shifts at handoff.
 */
export const WordmarkSvg = forwardRef<SVGSVGElement, WordmarkSvgProps>(function WordmarkSvg(
  { frame, className, label },
  ref,
) {
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
      <WordmarkGlyphs mode={frame.mode} />
    </svg>
  );
});
