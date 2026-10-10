import { WORDMARKS, chooseMode, type LayoutMode } from './layout';
import { SITES } from './site';

export interface Frame {
  mode: LayoutMode;
  vw: number;
  vh: number;
  /** CSS pixels per scene unit */
  scale: number;
  /** scene units per CSS pixel — use for hairline widths */
  px: number;
  viewBox: string;
}

/**
 * Places the wordmark at the centre of the viewport at a size that leaves
 * generous negative space, while guaranteeing the surrounding construction
 * site fits on screen. The intro and the opening screen share this function,
 * so the title sits on exactly the same pixels before and after the handoff.
 */
export function computeFrame(vw: number, vh: number): Frame {
  const mode = chooseMode(vw, vh);
  const wm = WORDMARKS[mode];
  const site = SITES[mode];

  const preferred =
    mode === 'wide'
      ? Math.min(vw * 0.55, 1320) / wm.width
      : Math.min(vw * 0.7, 460) / wm.width;

  const halfW = Math.max(-site.extents.x0, site.extents.x1) - wm.cx;
  const fitW = (vw * 0.96) / (2 * halfW);

  const up = wm.cy - site.extents.y0;
  const down = site.extents.y1 - wm.cy;
  const fitH = (vh * 0.92) / (2 * Math.max(up, down));

  const scale = Math.max(0.01, Math.min(preferred, fitW, fitH));
  const w = vw / scale;
  const h = vh / scale;
  const x = wm.cx - w / 2;
  const y = wm.cy - h / 2;
  return { mode, vw, vh, scale, px: 1 / scale, viewBox: `${x} ${y} ${w} ${h}` };
}
