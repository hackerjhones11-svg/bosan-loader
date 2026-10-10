import { WORKER_HEIGHT } from '../site';

/**
 * Articulated adult figure for the construction crew. Proportions follow a
 * ~7.8-head adult: legs are just over half the height, arms reach mid-thigh.
 * Limbs on the far side are drawn darker so the silhouette reads in depth
 * without outlines.
 *
 * Angles are radians from straight down; positive swings toward the
 * direction the figure faces. Knee and elbow values are flexion.
 */

export interface Pose {
  lean: number;
  hipN: number;
  kneeN: number;
  hipF: number;
  kneeF: number;
  shN: number;
  elN: number;
  shF: number;
  elF: number;
  /** head tilt: positive looks up */
  look: number;
}

export interface WorkerState extends Pose {
  x: number;
  y: number;
  face: number;
  /** walk cycle phase (radians) and blend amount */
  walk: number;
  stride: number;
  opacity: number;
}

const S = WORKER_HEIGHT / 180;
const THIGH = 47 * S;
const SHIN = 45 * S;
const FOOT_H = 5 * S;
const TORSO = 52 * S;
const UPPER_ARM = 33 * S;
const FOREARM = 29 * S;
const HAND = 7 * S;
const HEAD_R = 11.5 * S;

export const POSES = {
  stand: { lean: 0, hipN: 0.04, kneeN: 0.06, hipF: -0.04, kneeF: 0.04, shN: 0.1, elN: 0.18, shF: -0.06, elF: 0.14, look: 0 },
  ready: { lean: 0.02, hipN: 0.1, kneeN: 0.08, hipF: -0.12, kneeF: 0.06, shN: 0.35, elN: 0.6, shF: 0.25, elF: 0.6, look: 0.1 },
  survey: { lean: 0.28, hipN: 0.06, kneeN: 0.1, hipF: -0.1, kneeF: 0.12, shN: 1.05, elN: 0.8, shF: 0.95, elF: 0.95, look: -0.25 },
  tagHold: { lean: -0.1, hipN: 0.28, kneeN: 0.14, hipF: -0.24, kneeF: 0.1, shN: 1.25, elN: 0.35, shF: 1.05, elF: 0.55, look: 0.45 },
  reachUp: { lean: -0.04, hipN: 0.08, kneeN: 0.05, hipF: -0.08, kneeF: 0.05, shN: 2.75, elN: 0.18, shF: 2.6, elF: 0.28, look: 0.6 },
  attach: { lean: 0.04, hipN: 0.16, kneeN: 0.08, hipF: -0.14, kneeF: 0.06, shN: 2.2, elN: 0.35, shF: 1.95, elF: 0.45, look: 0.5 },
  signal: { lean: 0, hipN: 0.06, kneeN: 0.04, hipF: -0.06, kneeF: 0.04, shN: 3.0, elN: 0.12, shF: 0.08, elF: 0.2, look: 0.35 },
} satisfies Record<string, Pose>;

export type PoseName = keyof typeof POSES;

export function makeWorker(x: number, y: number, face: number, pose: PoseName = 'stand'): WorkerState {
  return { ...POSES[pose], x, y, face, walk: 0, stride: 0, opacity: 0 };
}

type P = [number, number];
const add = (a: P, len: number, ang: number): P => [a[0] + Math.sin(ang) * len, a[1] + Math.cos(ang) * len];

interface Solved {
  hip: P;
  shoulder: P;
  head: P;
  legN: [P, P, P];
  legF: [P, P, P];
  armN: [P, P, P];
  armF: [P, P, P];
  lean: number;
  look: number;
}

function solve(w: WorkerState): Solved {
  const sw = Math.sin(w.walk) * w.stride;
  const cw = Math.cos(w.walk) * w.stride;
  const hipN = w.hipN + 0.42 * sw;
  const hipF = w.hipF - 0.42 * sw;
  const kneeN = w.kneeN + 0.55 * Math.max(0, -Math.sin(w.walk + 0.9)) * w.stride;
  const kneeF = w.kneeF + 0.55 * Math.max(0, Math.sin(w.walk + 0.9)) * w.stride;
  const shN = w.shN - 0.32 * sw;
  const shF = w.shF + 0.32 * sw;
  const elN = w.elN + 0.15 * Math.abs(cw);
  const elF = w.elF + 0.15 * Math.abs(cw);

  // Legs from a provisional hip, then drop the figure until the lower foot
  // meets the ground so stance and stride never float.
  const hip0: P = [0, 0];
  const kN = add(hip0, THIGH, hipN);
  const aN = add(kN, SHIN, hipN - kneeN);
  const kF = add(hip0, THIGH, hipF);
  const aF = add(kF, SHIN, hipF - kneeF);
  const lowest = Math.max(aN[1], aF[1]) + FOOT_H;
  const lift = -lowest;
  const sh = (p: P): P => [p[0], p[1] + lift];
  const hip = sh(hip0);
  const shoulder = add(hip, TORSO, Math.PI - w.lean);
  const neck = add(shoulder, 6 * S, Math.PI - w.lean);
  const head = add(neck, HEAD_R + 2 * S, Math.PI - w.lean * 0.6);

  const eN = add(shoulder, UPPER_ARM, shN);
  const hN = add(eN, FOREARM + HAND, shN + elN);
  const eF = add(shoulder, UPPER_ARM, shF);
  const hF = add(eF, FOREARM + HAND, shF + elF);

  return {
    hip,
    shoulder,
    head,
    legN: [hip, sh(kN), sh(aN)],
    legF: [hip, sh(kF), sh(aF)],
    armN: [shoulder, eN, hN],
    armF: [shoulder, eF, hF],
    lean: w.lean,
    look: w.look,
  };
}

/** World position of the near hand, for tag lines. */
export function handOf(w: WorkerState): P {
  const s = solve(w);
  const h = s.armN[2];
  return [w.x + h[0] * w.face, w.y + h[1]];
}

const f = (n: number) => n.toFixed(1);
const line3 = (pts: [P, P, P]) => `M${f(pts[0][0])} ${f(pts[0][1])}L${f(pts[1][0])} ${f(pts[1][1])}L${f(pts[2][0])} ${f(pts[2][1])}`;

export interface WorkerEls {
  root: SVGGElement;
  farLeg: SVGPathElement;
  farArm: SVGPathElement;
  nearLeg: SVGPathElement;
  nearArm: SVGPathElement;
  boots: SVGPathElement;
  torso: SVGPathElement;
  head: SVGCircleElement;
  hat: SVGPathElement;
}

export function renderWorker(w: WorkerState, el: WorkerEls) {
  const s = solve(w);
  el.root.setAttribute('transform', `translate(${f(w.x)} ${f(w.y)}) scale(${w.face} 1)`);
  el.root.style.opacity = String(w.opacity);
  el.root.style.visibility = w.opacity <= 0.001 ? 'hidden' : 'visible';
  el.farLeg.setAttribute('d', line3(s.legF));
  el.nearLeg.setAttribute('d', line3(s.legN));
  el.farArm.setAttribute('d', line3(s.armF));
  el.nearArm.setAttribute('d', line3(s.armN));
  const bootN = s.legN[2];
  const bootF = s.legF[2];
  el.boots.setAttribute(
    'd',
    `M${f(bootF[0] - 2)} ${f(bootF[1] + 2)}h${f(11 * S)}M${f(bootN[0] - 2)} ${f(bootN[1] + 2)}h${f(11 * S)}`,
  );

  // Torso: a tapered block from hip to shoulder with a slightly fuller chest.
  const [hx, hy] = s.hip;
  const [sx, sy] = s.shoulder;
  const ux = (sx - hx) / TORSO;
  const uy = (sy - hy) / TORSO;
  const nx = -uy;
  const ny = ux;
  const pt = (t: number, off: number): P => [hx + ux * TORSO * t + nx * off, hy + uy * TORSO * t + ny * off];
  const pts: P[] = [pt(-0.04, -11 * S), pt(0.55, -13 * S), pt(1.02, -12 * S), pt(1.06, 0), pt(1.0, 15 * S), pt(0.6, 15.5 * S), pt(-0.04, 12 * S)];
  el.torso.setAttribute('d', 'M' + pts.map((p) => `${f(p[0])} ${f(p[1])}`).join('L') + 'Z');

  el.head.setAttribute('cx', f(s.head[0]));
  el.head.setAttribute('cy', f(s.head[1]));
  // Hard hat: shallow dome with a short peak, tipped with the head.
  const tilt = -s.look * 0.5 + s.lean * 0.6;
  const cx = s.head[0];
  const cy = s.head[1] - 2 * S;
  const R = HEAD_R + 1.6 * S;
  const rot = (x: number, y: number): P => [
    cx + x * Math.cos(tilt) - y * Math.sin(tilt),
    cy + x * Math.sin(tilt) + y * Math.cos(tilt),
  ];
  const a = rot(-R, 0);
  const b = rot(R + 5 * S, 0);
  const c = rot(R, 0);
  el.hat.setAttribute(
    'd',
    `M${f(a[0])} ${f(a[1])}A${f(R)} ${f(R * 0.95)} ${f((tilt * 180) / Math.PI)} 0 1 ${f(c[0])} ${f(c[1])}L${f(b[0])} ${f(b[1])}L${f(a[0])} ${f(a[1])}Z`,
  );
}
