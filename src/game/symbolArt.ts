import type { SymbolId } from './symbols';

/**
 * Original artwork for the six symbols, drawn on a 100 x 100 grid.
 *
 * This is the single source for every rendering of a symbol: inline SVG in the
 * UI (mat, history, help, admin, 2D fallback) and the canvas atlas that textures
 * the 3D dice (via Path2D, which accepts the same path data). Shapes are kept
 * bold and simple so they stay legible on a die face only ~30px wide.
 */

export const INK = {
  red: '#b3241d',
  black: '#1f1b18',
  ivory: '#f4ecdc',
} as const;

export type InkRole = keyof typeof INK;

export interface ArtPart {
  readonly d: string;
  readonly ink: InkRole;
}

/** Full circle as path data, so circles go through the same pipeline as other shapes. */
function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
}

export const SYMBOL_ART: Readonly<Record<SymbolId, readonly ArtPart[]>> = {
  // Waving pennant on a pole with a finial and small plinth. Red cloth, dark pole.
  jhandi: [
    { ink: 'black', d: 'M20 14 H28 V86 H20 Z' },
    { ink: 'black', d: circle(24, 11, 6) },
    { ink: 'black', d: 'M12 86 H36 Q39 86 39 89 V93 H9 V89 Q9 86 12 86 Z' },
    {
      ink: 'red',
      d: 'M28 17 C40 10 52 24 66 18 C75 14 83 13 91 17 L91 57 C83 53 75 54 66 58 C52 64 40 50 28 57 Z',
    },
  ],
  // Five-point crown on a band, with ivory jewels so it never reads as a spade.
  burja: [
    { ink: 'black', d: 'M15 72 L10 33 L31 51 L50 24 L69 51 L90 33 L85 72 Z' },
    { ink: 'black', d: circle(10, 29, 6.5) },
    { ink: 'black', d: circle(50, 19, 7.5) },
    { ink: 'black', d: circle(90, 29, 6.5) },
    { ink: 'black', d: 'M16 77 H84 Q86 77 86 79 V89 Q86 91 84 91 H16 Q14 91 14 89 V79 Q14 77 16 77 Z' },
    { ink: 'ivory', d: 'M50 51 L57 61 L50 71 L43 61 Z' },
    { ink: 'ivory', d: circle(29, 63, 4) },
    { ink: 'ivory', d: circle(71, 63, 4) },
  ],
  itta: [{ ink: 'red', d: 'M50 6 C58 22 70 36 84 50 C70 64 58 78 50 94 C42 78 30 64 16 50 C30 36 42 22 50 6 Z' }],
  paan: [
    {
      ink: 'red',
      d: 'M50 89 C44 81 9 61 9 36 C9 22 19 12 32 12 C41 12 47 18 50 25 C53 18 59 12 68 12 C81 12 91 22 91 36 C91 61 56 81 50 89 Z',
    },
  ],
  hukum: [
    {
      ink: 'black',
      d: 'M50 7 C58 24 91 40 91 62 C91 75 82 82 71 82 C63 82 57 78 54 72 C55 81 59 87 66 93 L34 93 C41 87 45 81 46 72 C43 78 37 82 29 82 C18 82 9 75 9 62 C9 40 42 24 50 7 Z',
    },
  ],
  chidi: [
    { ink: 'black', d: circle(50, 29, 18) },
    { ink: 'black', d: circle(28, 58, 18) },
    { ink: 'black', d: circle(72, 58, 18) },
    { ink: 'black', d: circle(50, 53, 12) },
    { ink: 'black', d: 'M45.5 58 C45.5 75 41 85 33 93 L67 93 C59 85 54.5 75 54.5 58 Z' },
  ],
};
