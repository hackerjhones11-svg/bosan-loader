import type { CraneSpec } from '../site';
import { C } from '../palette';

/**
 * Top-slewing tower crane in technical elevation: lattice mast on a ballasted
 * cross base, slewing unit with operator cab, cat head with pendants, a
 * trolley jib and a counter-jib carrying the counterweight.
 *
 * Local coordinates: mast axis at x = 0, ground at y = 0, jib toward +x
 * (the parent mirrors it for a jib that points left). Linework uses
 * non-scaling strokes so it stays a crisp hairline at any size and while the
 * jib is foreshortened during slewing.
 */

export const MAST_W = 104;
export const JIB_DEPTH = 74;
export const TROLLEY = { w: 58, h: 18 };

const r = (n: number) => Math.round(n * 10) / 10;

function mastPath(top: number, w: number): string {
  const h = w; // square bays
  const x0 = -w / 2;
  const x1 = w / 2;
  let d = `M${x0} 0V${r(top)}M${x1} 0V${r(top)}`;
  const n = Math.floor(-top / h);
  for (let i = 0; i <= n; i++) {
    const y = -i * h;
    d += `M${x0} ${y}H${x1}`;
    if (i < n) {
      const y2 = y - h;
      d += i % 2 === 0 ? `M${x0} ${y}L${x1} ${y2}` : `M${x1} ${y}L${x0} ${y2}`;
    }
  }
  const yl = -n * h;
  if (yl > top) d += `M${x0} ${yl}L${x1} ${r(top)}`;
  return d;
}

/** Warren-truss jib between two chords that may taper. */
function trussPath(
  x0: number,
  x1: number,
  yBottom: number,
  depth0: number,
  depth1: number,
  bay: number,
): string {
  const top = (x: number) => yBottom - (depth0 + ((depth1 - depth0) * (x - x0)) / (x1 - x0));
  let d = `M${r(x0)} ${r(yBottom)}H${r(x1)}M${r(x0)} ${r(top(x0))}L${r(x1)} ${r(top(x1))}`;
  const n = Math.max(1, Math.round((x1 - x0) / bay));
  const step = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * step;
    const b = a + step;
    const m = (a + b) / 2;
    d += `M${r(a)} ${r(yBottom)}L${r(m)} ${r(top(m))}L${r(b)} ${r(yBottom)}`;
  }
  d += `M${r(x0)} ${r(yBottom)}V${r(top(x0))}M${r(x1)} ${r(yBottom)}V${r(top(x1))}`;
  return d;
}

interface Props {
  spec: CraneSpec;
  clipId: string;
}

export function Crane({ spec, clipId }: Props) {
  const { id, jibY, jibLength: L, counterLength: CL, headHeight: HH } = spec;
  const ringY = jibY + 92;
  const unitTop = jibY + 6;
  const headY = jibY - HH;
  const jibRoot = 64;
  const p1 = L * 0.42;
  const p2 = L * 0.8;
  const topAt = (x: number) => jibY - (JIB_DEPTH + ((40 - JIB_DEPTH) * (x - jibRoot)) / (L - jibRoot));
  const cwX0 = -CL + 18;
  const cwX1 = -CL + 150;

  return (
    <g clipPath={`url(#${clipId})`} data-k={`crane${id}`}>
      <g transform={`translate(${spec.mastX} ${spec.baseY}) scale(${spec.dir} 1)`}>
        <g data-k={`crane${id}-rise`}>
          {/* ballasted cross base */}
          <rect x={-248} y={-24} width={496} height={24} fill={C.graphite2} />
          <rect x={-262} y={-8} width={40} height={8} fill={C.steel} />
          <rect x={222} y={-8} width={40} height={8} fill={C.steel} />
          <rect x={-206} y={-104} width={132} height={80} fill={C.graphite2} />
          <rect x={74} y={-104} width={132} height={80} fill={C.graphite2} />
          <path
            d="M-206 -104H-74M74 -104H206M-206 -64H-74M74 -64H206"
            stroke={C.steelLight}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            fill="none"
          />
          {/* mast */}
          <path
            d={mastPath(ringY, MAST_W)}
            stroke={C.line}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            fill="none"
          />
          <rect x={-60} y={ringY - 4} width={120} height={8} fill={C.steel} />

          <g data-k={`crane${id}-slew`}>
            {/* slewing unit and operator cab */}
            <rect x={-58} y={unitTop} width={116} height={ringY - 4 - unitTop} fill={C.graphite2} />
            <path
              d={`M-58 ${unitTop}H58V${ringY - 4}H-58Z`}
              stroke={C.lineDim}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              fill="none"
            />
            <rect x={58} y={jibY + 14} width={70} height={84} fill={C.silver} />
            <rect x={98} y={jibY + 24} width={24} height={38} fill={C.glass} />
            <path
              d={`M58 ${jibY + 70}H128`}
              stroke={C.steelLight}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />

            {/* jib and counter-jib */}
            <path
              d={trussPath(jibRoot, L, jibY, JIB_DEPTH, 40, 92)}
              stroke={C.lineLight}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              fill="none"
            />
            <path
              d={trussPath(-CL, -58, jibY, 52, 58, 96)}
              stroke={C.line}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              fill="none"
            />
            {/* hoist winch on the counter-jib */}
            <rect x={-250} y={jibY - 50} width={96} height={44} fill={C.steel} />
            <circle cx={-202} cy={jibY - 28} r={15} fill={C.graphite} />
            {/* counterweight blocks */}
            {[0, 1, 2, 3].map((i) => (
              <rect
                key={i}
                x={cwX0}
                y={jibY - 40 + i * 54}
                width={cwX1 - cwX0}
                height={50}
                fill={i % 2 ? C.graphite2 : C.steel}
              />
            ))}

            {/* cat head and pendants */}
            <path
              d={`M-52 ${jibY - JIB_DEPTH}L0 ${headY}L52 ${jibY - JIB_DEPTH}M-30 ${jibY - JIB_DEPTH - 110}H30`}
              stroke={C.lineLight}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              fill="none"
            />
            <path
              d={`M0 ${headY}L${r(p1)} ${r(topAt(p1))}M0 ${headY}L${r(p2)} ${r(topAt(p2))}M0 ${headY}L${r(-CL * 0.86)} ${jibY - 52}`}
              stroke={C.line}
              strokeWidth={0.75}
              vectorEffect="non-scaling-stroke"
              fill="none"
            />

            {/* trolley — positioned along the jib by the timeline */}
            <g data-k={`crane${id}-trolley`}>
              <rect x={-TROLLEY.w / 2} y={jibY + 2} width={TROLLEY.w} height={TROLLEY.h} fill={C.silver} />
              <circle cx={-16} cy={jibY + 1} r={5} fill={C.lineLight} />
              <circle cx={16} cy={jibY + 1} r={5} fill={C.lineLight} />
            </g>
          </g>
        </g>
      </g>
    </g>
  );
}

/**
 * Hook block, hoist falls, and two-leg bridle. Drawn in world space so they
 * can follow a load anywhere on the site; the timeline updates them.
 */
export function HookRig({ id }: { id: string }) {
  return (
    <g data-k={`hook${id}`}>
      <path data-k={`hook${id}-falls`} stroke={C.silverLight} strokeWidth={0.8} vectorEffect="non-scaling-stroke" fill="none" />
      <path data-k={`hook${id}-bridle`} stroke={C.silverLight} strokeWidth={0.8} vectorEffect="non-scaling-stroke" fill="none" />
      <g data-k={`hook${id}-block`}>
        {/* sheave block */}
        <rect x={-19} y={-84} width={38} height={42} rx={3} fill={C.silver} />
        <circle cx={0} cy={-63} r={9} fill={C.steel} />
        <rect x={-4} y={-42} width={8} height={14} fill={C.silverLight} />
        {/* hook */}
        <path
          d="M0 -28 C 0 -20, 2 -14, 9 -12 C 15 -10, 15 -2, 9 2 C 3 6, -6 4, -9 -2"
          stroke={C.silverLight}
          strokeWidth={5}
          strokeLinecap="round"
          fill="none"
        />
      </g>
    </g>
  );
}
