import { CAP_HEIGHT, GLYPHS, type GlyphChar } from './glyphData';

/**
 * Scene units are font units (1000 per em). The ground / baseline is y = 0 and
 * y grows downward, exactly like the extracted glyph paths.
 */

export type LayoutMode = 'wide' | 'stacked';

export type GlyphKey = 'B' | 'O' | 'S1' | 'A' | 'N' | 'H' | 'I' | 'L1' | 'L2' | 'S2';

export const GLYPH_ORDER: GlyphKey[] = ['B', 'O', 'S1', 'A', 'N', 'H', 'I', 'L1', 'L2', 'S2'];

const CHAR_OF: Record<GlyphKey, GlyphChar> = {
  B: 'B',
  O: 'O',
  S1: 'S',
  A: 'A',
  N: 'N',
  H: 'H',
  I: 'I',
  L1: 'L',
  L2: 'L',
  S2: 'S',
};

const LINES: GlyphKey[][] = [
  ['B', 'O', 'S1', 'A', 'N'],
  ['H', 'I', 'L1', 'L2', 'S2'],
];

/** Uniform tracking added after every letter (font units). */
export const TRACKING = 128;

/**
 * Optical pair corrections on top of tracking. Round and open shapes need
 * less room than parallel stems to look evenly spaced.
 */
const PAIR_ADJUST: Record<string, number> = {
  BO: -14,
  OS: -12,
  SA: -26,
  AN: -6,
  HI: 0,
  IL: 0,
  LL: -52,
  LS: -40,
};

/** Advance between the end of BOSAN and the start of HILLS on one line. */
const WORD_GAP = 470;

/** Baseline-to-baseline distance when the name is set on two lines. */
export const STACK_LEADING = 1040;

export interface PlacedGlyph {
  key: GlyphKey;
  ch: GlyphChar;
  /** origin of the glyph (left side bearing edge) */
  x: number;
  /** baseline */
  y: number;
  line: 0 | 1;
  /** ink extents in scene units */
  ink: { x0: number; y0: number; x1: number; y1: number };
}

export interface WordmarkLayout {
  mode: LayoutMode;
  glyphs: Record<GlyphKey, PlacedGlyph>;
  /** ink box of the full name (cap height to baseline, ignoring overshoot) */
  box: { x0: number; y0: number; x1: number; y1: number };
  cx: number;
  cy: number;
  width: number;
}

function setLine(keys: GlyphKey[]): { x: number; key: GlyphKey }[] {
  const out: { x: number; key: GlyphKey }[] = [];
  let x = 0;
  keys.forEach((key, i) => {
    out.push({ x, key });
    const next = keys[i + 1];
    if (next) {
      const pair = CHAR_OF[key] + CHAR_OF[next];
      x += GLYPHS[CHAR_OF[key]].advance + TRACKING + (PAIR_ADJUST[pair] ?? 0);
    }
  });
  return out;
}

function inkOf(key: GlyphKey, x: number, y: number) {
  const [bx0, by0, bx1, by1] = GLYPHS[CHAR_OF[key]].bounds;
  return { x0: x + bx0, y0: y + by0, x1: x + bx1, y1: y + by1 };
}

function buildLayout(mode: LayoutMode): WordmarkLayout {
  const glyphs = {} as Record<GlyphKey, PlacedGlyph>;
  const place = (items: { x: number; key: GlyphKey }[], dx: number, y: number, line: 0 | 1) => {
    for (const it of items) {
      const x = it.x + dx;
      glyphs[it.key] = { key: it.key, ch: CHAR_OF[it.key], x, y, line, ink: inkOf(it.key, x, y) };
    }
  };

  const l0 = setLine(LINES[0]);
  const l1 = setLine(LINES[1]);
  const lineInk = (items: { x: number; key: GlyphKey }[]) => {
    const first = items[0];
    const last = items[items.length - 1];
    return {
      x0: first.x + GLYPHS[CHAR_OF[first.key]].bounds[0],
      x1: last.x + GLYPHS[CHAR_OF[last.key]].bounds[2],
    };
  };

  if (mode === 'wide') {
    const lastOf0 = l0[l0.length - 1];
    const startOf1 = lastOf0.x + GLYPHS[CHAR_OF[lastOf0.key]].advance + WORD_GAP;
    const joined = [...l0, ...l1.map((it) => ({ x: it.x + startOf1, key: it.key }))];
    const ink = lineInk(joined);
    const dx = -(ink.x0 + ink.x1) / 2;
    place(joined.slice(0, 5), dx, 0, 0);
    place(joined.slice(5), dx, 0, 1);
  } else {
    const i0 = lineInk(l0);
    const i1 = lineInk(l1);
    place(l0, -(i0.x0 + i0.x1) / 2, -STACK_LEADING, 0);
    place(l1, -(i1.x0 + i1.x1) / 2, 0, 1);
  }

  let x0 = Infinity;
  let x1 = -Infinity;
  for (const k of GLYPH_ORDER) {
    x0 = Math.min(x0, glyphs[k].ink.x0);
    x1 = Math.max(x1, glyphs[k].ink.x1);
  }
  const y0 = mode === 'wide' ? -CAP_HEIGHT : -STACK_LEADING - CAP_HEIGHT;
  const y1 = 0;
  return { mode, glyphs, box: { x0, y0, x1, y1 }, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, width: x1 - x0 };
}

export const WORDMARKS: Record<LayoutMode, WordmarkLayout> = {
  wide: buildLayout('wide'),
  stacked: buildLayout('stacked'),
};

export function glyphPath(key: GlyphKey): string {
  return GLYPHS[CHAR_OF[key]].d;
}

export function charOf(key: GlyphKey): GlyphChar {
  return CHAR_OF[key];
}

export function chooseMode(vw: number, vh: number): LayoutMode {
  return vw < 720 || vw / vh < 0.9 ? 'stacked' : 'wide';
}
