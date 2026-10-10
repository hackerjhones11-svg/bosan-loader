import { forwardRef, useId, useMemo } from 'react';
import type { Frame } from '../frame';
import { CAP_HEIGHT, GLYPHS } from '../glyphData';
import { GLYPH_ORDER, WORDMARKS, charOf, glyphPath, type GlyphKey } from '../layout';
import { C } from '../palette';
import { H_BAR, O_SPINE, REGIONS, S_SPINE, polyPath, type RegionId } from '../parts';
import { SITES, TRUCK } from '../site';
import { Crane, HookRig } from './Crane';
import { Truck } from './Truck';

/** Letters that rise from their footings inside formwork. */
export const RISE: Partial<Record<GlyphKey, RegionId | null>> = {
  B: 'B-stem',
  A: 'A-legs',
  N: null,
  H: 'H-uprights',
  I: null,
  L1: null,
  L2: null,
};

/** Heights of the construction joints between pour lifts. */
export const LIFT_JOINTS = [214, 428];

/** Letters completed along their curve. */
export const SPINE: Partial<Record<GlyphKey, { d: string; width: number }>> = {
  O: { d: O_SPINE, width: 150 },
  S1: { d: S_SPINE, width: 168 },
  S2: { d: S_SPINE, width: 168 },
};

export const WORKER_IDS = ['surveyor', 'bowls', 'aBar', 'scaffold', 'rigger'] as const;
export type WorkerId = (typeof WORKER_IDS)[number];

function contours(d: string): string[] {
  return d
    .split(/(?=M)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function WorkerFigure({ id }: { id: WorkerId }) {
  return (
    <g data-k={`worker-${id}`} style={{ visibility: 'hidden' }}>
      <path data-part="farLeg" stroke={C.figureFar} strokeWidth={14.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path data-part="farArm" stroke={C.figureFar} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path data-part="boots" stroke={C.figureFar} strokeWidth={7} strokeLinecap="round" fill="none" />
      <path data-part="nearLeg" stroke={C.figure} strokeWidth={15} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path data-part="torso" fill={C.figure} />
      <circle data-part="head" r={12} fill={C.figure} />
      <path data-part="hat" fill={C.hat} />
      <path data-part="nearArm" stroke={C.figure} strokeWidth={10.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </g>
  );
}

interface Props {
  frame: Frame;
}

export const IntroScene = forwardRef<SVGSVGElement, Props>(function IntroScene({ frame }, ref) {
  const rawId = useId();
  const uid = 'bi' + rawId.replace(/[^a-zA-Z0-9]/g, '');
  const id = (s: string) => `${uid}-${s}`;
  const url = (s: string) => `url(#${id(s)})`;

  const { mode, px } = frame;
  const wm = WORDMARKS[mode];
  const site = SITES[mode];
  const g = wm.glyphs;

  const regionPaths = useMemo(() => {
    const out = {} as Record<RegionId, string>;
    (Object.keys(REGIONS) as RegionId[]).forEach((k) => (out[k] = polyPath(REGIONS[k])));
    return out;
  }, []);

  const tr = (k: GlyphKey) => `translate(${g[k].x} ${g[k].y})`;

  // Setting-out ticks at every stem and outer extent.
  const ticks: { x: number; y: number }[] = [];
  for (const k of GLYPH_ORDER) {
    ticks.push({ x: g[k].ink.x0, y: g[k].y }, { x: g[k].ink.x1, y: g[k].y });
  }

  const hBar = { y0: g.H.y + H_BAR.y0 };
  const aBar = { y0: g.A.y - 283 };

  return (
    <svg
      ref={ref}
      className="bosan-intro__scene"
      width={frame.vw}
      height={frame.vh}
      viewBox={frame.viewBox}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
      shapeRendering="geometricPrecision"
    >
      <defs>
        <linearGradient id={id('material')} gradientUnits="userSpaceOnUse" x1="0" y1={-CAP_HEIGHT} x2="0" y2="0">
          <stop offset="0" stopColor={C.materialTop} />
          <stop offset="1" stopColor={C.materialBottom} />
        </linearGradient>
        <clipPath id={id('ground')} clipPathUnits="userSpaceOnUse">
          <rect x={-40000} y={-40000} width={80000} height={40000 + site.craneL.baseY + 1} />
        </clipPath>
        {(Object.keys(regionPaths) as RegionId[]).map((k) => (
          <clipPath key={k} id={id(`region-${k}`)} clipPathUnits="userSpaceOnUse">
            <path d={regionPaths[k]} />
          </clipPath>
        ))}
        {(Object.keys(RISE) as GlyphKey[]).map((k) => (
          <clipPath key={k} id={id(`rise-${k}`)} clipPathUnits="userSpaceOnUse">
            <rect data-k={`rise-${k}`} x={-200} y={40} width={1200} height={0} />
          </clipPath>
        ))}
        {(Object.keys(RISE) as GlyphKey[]).map((k) => (
          <clipPath key={k} id={id(`cure-${k}`)} clipPathUnits="userSpaceOnUse">
            <rect data-k={`cure-${k}`} x={-200} y={40} width={1200} height={0} />
          </clipPath>
        ))}
        {(Object.keys(RISE) as GlyphKey[]).map((k) => (
          <clipPath key={k} id={id(`shape-${k}`)} clipPathUnits="userSpaceOnUse">
            <path d={glyphPath(k)} />
          </clipPath>
        ))}
        {(Object.keys(SPINE) as GlyphKey[]).map((k) => (
          <mask key={k} id={id(`spine-${k}`)} maskUnits="userSpaceOnUse" x={-200} y={-900} width={1200} height={1100}>
            <path
              data-k={`spine-${k}`}
              d={SPINE[k]!.d}
              pathLength={1}
              stroke="#fff"
              strokeWidth={SPINE[k]!.width}
              strokeDasharray="1 2"
              strokeDashoffset={1}
              fill="none"
            />
          </mask>
        ))}
      </defs>

      <g data-k="camera">
        {/* ── survey: baselines, cap lines, setting-out ticks ── */}
        <g data-k="survey">
          {site.lines.baselines.map((y, i) => (
            <g key={i}>
              <line data-k={`baseline-${i}`} x1={0} x2={0} y1={y} y2={y} stroke={C.survey} strokeOpacity={0.34} strokeWidth={px} />
              <line data-k={`capline-${i}`} x1={0} x2={0} y1={y - CAP_HEIGHT} y2={y - CAP_HEIGHT} stroke={C.survey} strokeOpacity={0.12} strokeWidth={px} />
            </g>
          ))}
          <g data-k="ticks" stroke={C.survey} strokeOpacity={0.4} strokeWidth={px}>
            {ticks.map((t, i) => (
              <line key={i} data-tick={i} x1={t.x} x2={t.x} y1={t.y - 26} y2={t.y + 26} />
            ))}
          </g>
        </g>

        {/* ── cranes stand behind the work ── */}
        <Crane spec={site.craneL} clipId={id('ground')} />
        <Crane spec={site.craneR} clipId={id('ground')} />

        {/* ── laydown dunnage: under the B bowls, and inside the A for its crossbar ── */}
        <g data-k="laydown" fill={C.steel} opacity={0}>
          {[
            [site.bowlsLaydown.dx + g.B.x + 236, site.bowlsLaydown.dy + g.B.y + 4, 46],
            [site.bowlsLaydown.dx + g.B.x + 420, site.bowlsLaydown.dy + g.B.y + 4, 46],
            [g.A.x + 252, g.A.y - 24, 40],
            [g.A.x + 362, g.A.y - 24, 40],
          ].map(([x, y, w], i) => (
            <rect key={i} x={x} y={y} width={w} height={(i < 2 ? g.H.y : g.A.y) - y} />
          ))}
        </g>

        {/* ── letters under construction ── */}
        <g data-k="letters">
          {GLYPH_ORDER.map((k) => {
            const region = RISE[k];
            const spine = SPINE[k];
            const d = glyphPath(k);
            return (
              <g key={k} transform={tr(k)} data-k={`letters-${k}`}>
                {region !== undefined && (
                  <g clipPath={region ? url(`region-${region}`) : undefined}>
                    {/* fresh pour: darker until it cures */}
                    <g clipPath={url(`rise-${k}`)}>
                      <path d={d} fill={C.wet} />
                    </g>
                    <g clipPath={url(`cure-${k}`)}>
                      <path d={d} fill={url('material')} />
                      <g clipPath={url(`shape-${k}`)}>
                        <path
                          d={LIFT_JOINTS.map((y) => `M-100 ${-y}H1000`).join('')}
                          stroke={C.joint}
                          strokeWidth={px}
                          fill="none"
                        />
                      </g>
                    </g>
                    <g clipPath={url(`shape-${k}`)}>
                      <rect data-k={`front-${k}`} x={-100} y={0} width={1000} height={px * 1.4} fill="#fff" opacity={0} />
                    </g>
                  </g>
                )}
                {spine && <path d={d} fill={url('material')} mask={url(`spine-${k}`)} />}
                {k === 'B' && (
                  <g data-k="comp-B-bowls">
                    <path d={d} fill={url('material')} clipPath={url('region-B-bowls')} />
                  </g>
                )}
                {k === 'A' && (
                  <g data-k="comp-A-bar">
                    <path d={d} fill={url('material')} clipPath={url('region-A-bar')} />
                  </g>
                )}
              </g>
            );
          })}
        </g>

        {/* ── formwork: hairline outlines of every glyph ── */}
        <g data-k="formwork" fill="none" stroke={C.survey} strokeOpacity={0.3} strokeWidth={px * 0.9}>
          {GLYPH_ORDER.map((k) => (
            <g key={k} transform={tr(k)} data-k={`formwork-${k}`}>
              {contours(GLYPHS[charOf(k)].d).map((c, i) => (
                <path key={i} d={c} pathLength={1} strokeDasharray="1 2" strokeDashoffset={1} />
              ))}
            </g>
          ))}
        </g>

        {/* ── level lines for the two precision placements: the piece's top
             edge must meet the line ── */}
        <g data-k="marks" stroke={C.survey} strokeWidth={px} fill="none">
          {(
            [
              ['H', g.H, hBar.y0],
              ['A', g.A, aBar.y0],
            ] as const
          ).map(([k, gl, y]) => (
            <g key={k} data-k={`marks-${k}`} opacity={0}>
              <path
                d={`M${gl.ink.x0 - 150} ${y - 16}V${y}H${gl.ink.x0 - 34}M${gl.ink.x1 + 34} ${y}H${gl.ink.x1 + 150}V${y - 16}`}
              />
            </g>
          ))}
        </g>

        {/* ── temporary works: N shore and H scaffold ── */}
        <g data-k="shore" transform={tr('N')} opacity={0}>
          {/* raking prop braced against the underside of the N's diagonal */}
          <rect x={176} y={-9} width={44} height={9} fill={C.steel} />
          <g transform="translate(198 -9) rotate(20.5)">
            <rect x={-4.5} y={-318} width={9} height={318} fill={C.silver} />
            <rect x={-6.5} y={-150} width={13} height={22} fill={C.steelLight} />
          </g>
          <g transform="translate(309 -307) rotate(40)">
            <rect x={-20} y={-6} width={40} height={8} fill={C.steel} />
          </g>
        </g>
        <g data-k="scaffold" transform={tr('H')}>
          <g data-k="scaffold-build" opacity={0}>
            {/* one-bay tower against the left upright */}
            <path
              d="M224 0V-236M372 0V-236M224 -6H372M224 -122H372M224 -236H372M224 -6L372 -122"
              stroke={C.line}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              fill="none"
            />
            <rect x={216} y={-128} width={166} height={9} fill={C.silver} />
            <rect x={214} y={-6} width={22} height={6} fill={C.steel} />
            <rect x={362} y={-6} width={22} height={6} fill={C.steel} />
            {/* adjustable prop with a U-head that carries the crossbar until it is fixed */}
            <rect x={452} y={-8} width={44} height={8} fill={C.steel} />
            <rect x={470} y={-308} width={8} height={300} fill={C.silverLight} />
            <path d="M456 -314V-306H492V-314" stroke={C.silverLight} strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none" />
          </g>
        </g>

        {/* ── delivery truck ── */}
        <g data-k="truck-root">
          <Truck />
          {/* dunnage that keeps the crossbar off the deck */}
          <g data-k="truck-dunnage" fill={C.steel}>
            <rect x={TRUCK.bar.x0 + 60} y={TRUCK.bar.y1} width={36} height={12} />
            <rect x={TRUCK.bar.x0 + 270} y={TRUCK.bar.y1} width={36} height={12} />
          </g>
        </g>

        {/* ── the hero crossbar arrives on the truck and rides above the deck ── */}
        <g data-k="cargo" transform={tr('H')}>
          <g data-k="comp-H-bar">
            <path d={glyphPath('H')} fill={url('material')} clipPath={url('region-H-bar')} />
          </g>
        </g>

        {/* ── survey station ── */}
        <g data-k="station" transform={`translate(${site.station.x} ${site.station.y})`} opacity={0}>
          <path d="M0 -128L-34 0M0 -128L32 0M0 -128L4 0" stroke={C.line} strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none" />
          <rect x={-14} y={-162} width={28} height={30} fill={C.silver} />
          <rect x={-22} y={-136} width={44} height={8} fill={C.steel} />
          <rect x={-24} y={-156} width={10} height={14} fill={C.glass} />
        </g>

        {/* ── crew ── */}
        <g data-k="workers">
          {WORKER_IDS.map((w) => (
            <WorkerFigure key={w} id={w} />
          ))}
        </g>

        {/* ── hoist ropes, hooks, bridles, tag lines ── */}
        <g data-k="rigging">
          {/* hooks sink below the ground with their cranes, so share the ground clip */}
          <g clipPath={url('ground')}>
            <HookRig id="L" />
            <HookRig id="R" />
          </g>
          <path data-k="tag-bowls" stroke={C.silverLight} strokeOpacity={0.85} strokeWidth={0.8} vectorEffect="non-scaling-stroke" fill="none" />
          <path data-k="tag-hBar" stroke={C.silverLight} strokeOpacity={0.85} strokeWidth={0.8} vectorEffect="non-scaling-stroke" fill="none" />
        </g>
      </g>
    </svg>
  );
});
