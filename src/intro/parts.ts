
/**
 * Component regions in glyph-local coordinates (y down, baseline 0). Each
 * region is a union of polygons used as a clip on the exact glyph outline, so
 * every construction piece is cut from the real letterform rather than
 * approximated.
 *
 * Measured from Cormorant Garamond Medium:
 *   B  stem 125–204, bowls join at x = 204
 *   A  crossbar y 261–283, inner leg edges slope inward toward the apex
 *   H  crossbar y 314–337 between uprights 118–197 / 562–641
 */

export type Poly = [number, number][];

const rect = (x0: number, y0: number, x1: number, y1: number): Poly => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const FAR = 900;

export const A_BAR: Poly = [
  [204.0, -261],
  [443.0, -261],
  [432.8, -283],
  [213.1, -283],
];

export const H_BAR = { x0: 197, x1: 562, y0: -337, y1: -314 };

/** Cuts sit just inside the counters so no sliver of a stem edge travels with a piece. */
const B_CUT = 205.5;
const H_CUT = { x0: H_BAR.x0 + 0.6, x1: H_BAR.x1 - 0.6 };

export const REGIONS = {
  'B-stem': [rect(-FAR, -FAR, B_CUT, FAR)],
  'B-bowls': [rect(B_CUT, -FAR, FAR, FAR)],
  'A-legs': [
    rect(-FAR, -261, FAR, FAR),
    rect(-FAR, -FAR, FAR, -283),
    [
      [-FAR, -261],
      [204.0, -261],
      [213.1, -283],
      [-FAR, -283],
    ],
    [
      [443.0, -261],
      [FAR, -261],
      [FAR, -283],
      [432.8, -283],
    ],
  ],
  'A-bar': [A_BAR],
  'H-uprights': [
    rect(-FAR, -FAR, H_CUT.x0, FAR),
    rect(H_CUT.x1, -FAR, FAR, FAR),
    rect(-FAR, -FAR, FAR, H_BAR.y0),
    rect(-FAR, H_BAR.y1, FAR, FAR),
  ],
  'H-bar': [rect(H_CUT.x0, H_BAR.y0, H_CUT.x1, H_BAR.y1)],
} satisfies Record<string, Poly[]>;

export type RegionId = keyof typeof REGIONS;

export function polyPath(polys: Poly[]): string {
  return polys.map((p) => 'M' + p.map(([x, y]) => `${x} ${y}`).join('L') + 'Z').join('');
}

/** Centreline of the S, lower terminal → upper terminal, for completing it along its curve. */
const S_SPINE_POINTS: [number, number][] = [
  [80, -205],
  [82, -175],
  [90, -120],
  [104, -80],
  [124, -40],
  [180, -8],
  [250, 2],
  [300, -3.6],
  [350, -28],
  [395, -80],
  [405, -120],
  [405, -160],
  [394, -200],
  [368, -240],
  [324, -280],
  [266, -320],
  [207, -360],
  [161, -400],
  [133, -440],
  [121, -480],
  [122, -520],
  [135, -560],
  [172, -600],
  [230, -622],
  [300, -624],
  [360, -612],
  [395, -580],
  [406, -540],
  [411, -480],
  [412, -455],
];

/** Catmull-Rom through points, emitted as cubic Béziers. */
function smoothPath(pts: [number, number][]): string {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

export const S_SPINE = smoothPath(S_SPINE_POINTS);

/** Centreline ellipse of the O, starting at the top and running clockwise. */
export const O_SPINE = 'M383 -624A288 312 0 0 1 383 0A288 312 0 0 1 383 -624';
