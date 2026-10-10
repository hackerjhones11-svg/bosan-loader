import gsap from 'gsap';
import type { Frame } from './frame';
import { GLYPH_ORDER, type GlyphKey } from './layout';
import { H_BAR } from './parts';
import { A_BAR_REST_DY, SITES, TRUCK, type CraneSpec } from './site';
import { LIFT_JOINTS, RISE, SPINE, WORKER_IDS, type WorkerId } from './scene/IntroScene';
import { POSES, handOf, makeWorker, renderWorker, type PoseName, type WorkerEls, type WorkerState } from './scene/worker';

/**
 * One coordinated timeline, in seconds at the base 12 s duration.
 *
 *   0.0 – 1.2    black
 *   1.2 – 2.6    setting out: station, baseline, ticks, formwork; crane L erects
 *   2.6 – 7.9    structure is cast in lifts; crane L sets the B bowls (5.2) and
 *                the A crossbar (7.1); curves are completed; crane R erects and
 *                the truck reverses in with the H crossbar
 *   5.9 – 8.5    hero: the H crossbar is lifted across HILLS and set (8.5)
 *   8.5 – 9.6    letters resolve to white; crew, equipment and guides withdraw
 *   9.6 – 10.7   the name alone on black
 *  10.7 – 12.0   handoff (owned by BosanIntro)
 *
 * The construction timeline ends at HOLD_END. The handoff (black opening into
 * the presentation) is a separate short timeline owned by the component, so
 * the finished name can hold for as long as real assets need.
 */
export const BASE_DURATION = 12;
export const BLACK_END = 1.2;
export const HOLD_START = 9.62;
export const HOLD_END = 10.7;
export const REVEAL_DURATION = BASE_DURATION - HOLD_END;

const DEG = Math.PI / 180;
type P = [number, number];

interface CompState {
  dx: number;
  dy: number;
  rot: number;
  /** 1 while riding on the truck deck */
  truck: number;
  opacity: number;
}

interface Comp {
  el: SVGGElement;
  ox: number;
  oy: number;
  pivot: P;
  lugs: [P, P];
  bridle: number;
  st: CompState;
}

type CompId = 'bowls' | 'aBar' | 'hBar';
const COMP_IDS: CompId[] = ['bowls', 'aBar', 'hBar'];
const COMP_INDEX: Record<CompId, number> = { bowls: 1, aBar: 2, hBar: 3 };

interface CraneState {
  /** 0 below ground … 1 standing */
  rise: number;
  /** jib foreshortening while slewing, 0.04 … 1 */
  slew: number;
  /** trolley x in world units (with the jib fully in plane) */
  trolley: number;
  /** hook depth below the jib */
  drop: number;
  /** pendulum lag between trolley and load */
  sway: number;
  /** 1 when the hook is carried by its target load */
  carry: number;
  /** load the bridle belongs to (COMP_INDEX), 0 for none */
  target: number;
  /** 0 bridle taut to the load … 1 hanging free from the hook */
  slack: number;
}

interface CraneRig {
  spec: CraneSpec;
  st: CraneState;
  rise: SVGGElement;
  slew: SVGGElement;
  trolley: SVGGElement;
  falls: SVGPathElement;
  bridle: SVGPathElement;
  block: SVGGElement;
  hook: SVGGElement;
  height: number;
}

interface TagState {
  on: number;
  /** 0 dangling from the load … 1 in the worker's hand */
  held: number;
}

export interface IntroTimeline {
  tl: gsap.core.Timeline;
  render: () => void;
}

export function createIntroTimeline(svg: SVGSVGElement, frame: Frame): IntroTimeline {
  const site = SITES[frame.mode];
  const wm = site.wordmark;
  const g = wm.glyphs;
  const px = frame.px;
  const stacked = frame.mode === 'stacked';

  const q = <T extends Element = SVGGElement>(k: string): T => {
    const el = svg.querySelector(`[data-k="${k}"]`);
    if (!el) throw new Error(`intro scene is missing ${k}`);
    return el as T;
  };
  const qa = <T extends Element = SVGElement>(sel: string): T[] => Array.from(svg.querySelectorAll<T>(sel));

  // ───────────────────────────── state ─────────────────────────────

  /** scale and the scene point held at the centre of the frame */
  const camera = { s: 0.972, fx: wm.cx, fy: wm.cy };
  const truck = { x: site.truck.offX, pitch: 0 };

  const hBarOnTruck = {
    dx: site.truck.parkX + TRUCK.bar.x0 - (g.H.x + H_BAR.x0),
    dy: TRUCK.bar.y1 - (g.H.y + H_BAR.y1),
  };

  const comps: Record<CompId, Comp> = {
    bowls: {
      el: q('comp-B-bowls'),
      ox: g.B.x,
      oy: g.B.y,
      pivot: [360, -310],
      lugs: [
        [246, -624],
        [372, -612],
      ],
      bridle: 120,
      st: { dx: site.bowlsLaydown.dx, dy: site.bowlsLaydown.dy, rot: 0, truck: 0, opacity: 1 },
    },
    aBar: {
      el: q('comp-A-bar'),
      ox: g.A.x,
      oy: g.A.y,
      pivot: [323, -272],
      lugs: [
        [252, -283],
        [396, -283],
      ],
      bridle: 104,
      st: { dx: 0, dy: A_BAR_REST_DY, rot: 0, truck: 0, opacity: 1 },
    },
    hBar: {
      el: q('comp-H-bar'),
      ox: g.H.x,
      oy: g.H.y,
      pivot: [380, -325],
      lugs: [
        [262, -337],
        [498, -337],
      ],
      bridle: site.heroBridle,
      st: { dx: hBarOnTruck.dx, dy: hBarOnTruck.dy, rot: 0, truck: 1, opacity: 1 },
    },
  };
  const compByIndex = (i: number) => comps[COMP_IDS[i - 1]];

  /** world position of a point given in a component's glyph coordinates */
  function cp(c: Comp, l: P): P {
    const tx = c.st.truck ? truck.x - site.truck.parkX : 0;
    const a = c.st.rot * DEG;
    const [pxl, pyl] = c.pivot;
    const rx = (l[0] - pxl) * Math.cos(a) - (l[1] - pyl) * Math.sin(a) + pxl;
    const ry = (l[0] - pxl) * Math.sin(a) + (l[1] - pyl) * Math.cos(a) + pyl;
    return [c.ox + c.st.dx + tx + rx, c.oy + c.st.dy + ry];
  }

  /** where the hook sits when carrying comp c in its current state */
  function hookFor(c: Comp): P {
    const a = cp(c, c.lugs[0]);
    const b = cp(c, c.lugs[1]);
    return [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - c.bridle];
  }

  /** hook position for comp c at a given offset, used to plan moves */
  function hookAt(c: Comp, dx: number, dy: number): P {
    const save = { ...c.st };
    Object.assign(c.st, { dx, dy, rot: 0, truck: 0 });
    const h = hookFor(c);
    Object.assign(c.st, save);
    return h;
  }

  const mkCrane = (spec: CraneSpec): CraneRig => ({
    spec,
    st: { rise: 0, slew: 0.04, trolley: spec.parkX, drop: spec.parkDrop, sway: 0, carry: 0, target: 0, slack: 1 },
    rise: q(`crane${spec.id}-rise`),
    slew: q(`crane${spec.id}-slew`),
    trolley: q(`crane${spec.id}-trolley`),
    falls: q<SVGPathElement>(`hook${spec.id}-falls`),
    bridle: q<SVGPathElement>(`hook${spec.id}-bridle`),
    block: q(`hook${spec.id}-block`),
    hook: q(`hook${spec.id}`),
    height: spec.baseY - spec.jibY + spec.headHeight + 260,
  });
  const cranes = { L: mkCrane(site.craneL), R: mkCrane(site.craneR) };

  const workers = {} as Record<WorkerId, WorkerState>;
  const workerEls = {} as Record<WorkerId, WorkerEls>;
  const initialPose: Record<WorkerId, PoseName> = {
    surveyor: 'survey',
    bowls: 'stand',
    aBar: 'stand',
    scaffold: 'stand',
    rigger: 'stand',
  };
  for (const id of WORKER_IDS) {
    const spec = site.workers[id];
    workers[id] = makeWorker(spec.x, spec.y, spec.face, initialPose[id]);
    const root = q(`worker-${id}`);
    const part = <T extends Element>(n: string) => root.querySelector(`[data-part="${n}"]`) as T;
    workerEls[id] = {
      root,
      farLeg: part('farLeg'),
      farArm: part('farArm'),
      nearLeg: part('nearLeg'),
      nearArm: part('nearArm'),
      boots: part('boots'),
      torso: part('torso'),
      head: part('head'),
      hat: part('hat'),
    };
  }

  const tags = {
    bowls: { st: { on: 0, held: 1 } as TagState, el: q<SVGPathElement>('tag-bowls'), comp: comps.bowls, at: [216, -36] as P, worker: 'bowls' as WorkerId },
    hBar: { st: { on: 0, held: 0 } as TagState, el: q<SVGPathElement>('tag-hBar'), comp: comps.hBar, at: [204, -318] as P, worker: 'scaffold' as WorkerId },
  };

  /** h: top of the fresh pour; c: top of the cured material just below it */
  const rises = {} as Record<
    GlyphKey,
    { h: number; c: number; rect: SVGRectElement; cure: SVGRectElement; front: SVGRectElement; top: number }
  >;
  for (const k of Object.keys(RISE) as GlyphKey[]) {
    rises[k] = {
      h: 0,
      c: 0,
      rect: q<SVGRectElement>(`rise-${k}`),
      cure: q<SVGRectElement>(`cure-${k}`),
      front: q<SVGRectElement>(`front-${k}`),
      top: 642,
    };
  }
  const spines = {} as Record<GlyphKey, { p: number; el: SVGPathElement }>;
  for (const k of Object.keys(SPINE) as GlyphKey[]) spines[k] = { p: 0, el: q<SVGPathElement>(`spine-${k}`) };

  const cameraEl = q('camera');
  const truckRoot = q('truck-root');
  const truckBody = q('truck-body');
  const wheels = qa<SVGGElement>('[data-k="truck-wheel"]');
  const finals = {} as Record<GlyphKey, SVGPathElement>;
  for (const k of GLYPH_ORDER) finals[k] = svg.querySelector(`[data-glyph="${k}"]`) as SVGPathElement;

  // ───────────────────────────── render ─────────────────────────────

  const f = (n: number) => (Math.round(n * 10) / 10).toString();

  function renderCrane(rig: CraneRig) {
    const { spec, st } = rig;
    const riseOff = (1 - st.rise) * rig.height;
    const k = Math.max(0.04, st.slew);
    rig.rise.setAttribute('transform', `translate(0 ${f(riseOff)})`);
    rig.slew.setAttribute('transform', `scale(${k.toFixed(4)} 1)`);

    const jibY = spec.jibY + riseOff;
    const target = st.target ? compByIndex(st.target) : null;
    let hook: P;
    let trolleyX: number;
    if (st.carry && target) {
      hook = hookFor(target);
      trolleyX = hook[0] + st.sway;
    } else {
      trolleyX = spec.mastX + (st.trolley - spec.mastX) * k;
      hook = [trolleyX - st.sway, jibY + st.drop];
    }
    const local = ((trolleyX - spec.mastX) * spec.dir) / k;
    rig.trolley.setAttribute('transform', `translate(${f(local)} 0)`);

    const ty = jibY + 20;
    const by = hook[1] - 84;
    rig.falls.setAttribute(
      'd',
      `M${f(trolleyX - 6)} ${f(ty)}L${f(hook[0] - 6)} ${f(by)}M${f(trolleyX + 6)} ${f(ty)}L${f(hook[0] + 6)} ${f(by)}`,
    );
    rig.block.setAttribute('transform', `translate(${f(hook[0])} ${f(hook[1])})`);

    const hangLen = target ? Math.min(110, target.bridle * 0.92) : 104;
    const hangA: P = [hook[0] - 8, hook[1] + hangLen];
    const hangB: P = [hook[0] + 8, hook[1] + hangLen];
    let a = hangA;
    let b = hangB;
    if (target && st.slack < 1) {
      const la = cp(target, target.lugs[0]);
      const lb = cp(target, target.lugs[1]);
      const s = st.slack;
      a = [la[0] + (hangA[0] - la[0]) * s, la[1] + (hangA[1] - la[1]) * s];
      b = [lb[0] + (hangB[0] - lb[0]) * s, lb[1] + (hangB[1] - lb[1]) * s];
    }
    rig.bridle.setAttribute(
      'd',
      `M${f(hook[0])} ${f(hook[1] - 1)}L${f(a[0])} ${f(a[1])}M${f(hook[0])} ${f(hook[1] - 1)}L${f(b[0])} ${f(b[1])}`,
    );
    rig.hook.style.visibility = st.rise <= 0.001 ? 'hidden' : 'visible';
  }

  function renderTag(t: (typeof tags)[keyof typeof tags]) {
    if (t.st.on <= 0.001) {
      t.el.style.visibility = 'hidden';
      return;
    }
    t.el.style.visibility = 'visible';
    t.el.style.opacity = t.st.on.toFixed(3);
    const a = cp(t.comp, t.at);
    const free: P = [a[0] - 10, a[1] + 170];
    const hand = handOf(workers[t.worker]);
    const h = t.st.held;
    const b: P = [free[0] + (hand[0] - free[0]) * h, free[1] + (hand[1] - free[1]) * h];
    const mx = (a[0] + b[0]) / 2 + (1 - h) * 8;
    const my = (a[1] + b[1]) / 2 + 8 + 16 * (1 - h);
    t.el.setAttribute('d', `M${f(a[0])} ${f(a[1])}Q${f(mx)} ${f(my)} ${f(b[0])} ${f(b[1])}`);
  }

  function render() {
    const cx = wm.cx;
    const cy = wm.cy;
    cameraEl.setAttribute(
      'transform',
      `translate(${f(cx)} ${f(cy)}) scale(${camera.s.toFixed(5)}) translate(${f(-camera.fx)} ${f(-camera.fy)})`,
    );

    truckRoot.setAttribute('transform', `translate(${f(truck.x)} ${f(site.truck.y)})`);
    truckBody.setAttribute('transform', `rotate(${truck.pitch.toFixed(3)} ${TRUCK.axles[1]} ${-TRUCK.wheelR})`);
    const wheelAngle = ((truck.x - site.truck.parkX) / TRUCK.wheelR / DEG) % 360;
    for (const w of wheels) w.setAttribute('transform', `rotate(${wheelAngle.toFixed(2)})`);

    for (const id of COMP_IDS) {
      const c = comps[id];
      const tx = c.st.truck ? truck.x - site.truck.parkX : 0;
      c.el.setAttribute(
        'transform',
        `translate(${f(c.st.dx + tx)} ${f(c.st.dy)}) rotate(${c.st.rot.toFixed(3)} ${c.pivot[0]} ${c.pivot[1]})`,
      );
      c.el.style.opacity = c.st.opacity.toFixed(3);
    }

    renderCrane(cranes.L);
    renderCrane(cranes.R);

    for (const id of WORKER_IDS) renderWorker(workers[id], workerEls[id]);
    renderTag(tags.bowls);
    renderTag(tags.hBar);

    for (const k of Object.keys(rises) as GlyphKey[]) {
      const r = rises[k];
      // the footing (overshoot below the baseline) appears with the first pour
      r.rect.setAttribute('y', f(-r.h));
      r.rect.setAttribute('height', f(r.h > 0.01 ? r.h + 24 : 0));
      r.cure.setAttribute('y', f(-r.c));
      r.cure.setAttribute('height', f(r.c > 0.01 ? r.c + 24 : 0));
      r.front.setAttribute('y', f(-r.h - px * 0.7));
      const op = Math.max(0, Math.min(1, r.h / 24, (r.top - r.h) / 24));
      r.front.setAttribute('opacity', (op * 0.8).toFixed(3));
    }
    for (const k of Object.keys(spines) as GlyphKey[]) {
      spines[k].el.style.strokeDashoffset = (1 - spines[k].p).toFixed(4);
    }
  }

  // ─────────────────────────── choreography ───────────────────────────

  const tl = gsap.timeline({ paused: true, defaults: { ease: 'power2.inOut' }, onUpdate: render });
  const at = (t: number, target: gsap.TweenTarget, vars: gsap.TweenVars) => tl.to(target, vars, t);
  const set = (t: number, target: gsap.TweenTarget, vars: gsap.TweenVars) => tl.set(target, vars, t);

  const pose = (id: WorkerId, name: PoseName, t: number, d = 0.45) =>
    at(t, workers[id], { ...POSES[name], duration: d, ease: 'sine.inOut' });

  const plannedX = {} as Record<WorkerId, number>;
  for (const id of WORKER_IDS) plannedX[id] = workers[id].x;
  const place = (id: WorkerId, x: number, t = 0) => {
    set(t, workers[id], { x });
    plannedX[id] = x;
  };

  /** walk a worker to x, the stride kept in step with the distance covered */
  const walk = (id: WorkerId, x: number, t: number, d: number) => {
    const w = workers[id];
    const dist = Math.abs(x - plannedX[id]);
    const ramp = Math.min(0.24, d / 3);
    set(t, w, { face: x >= plannedX[id] ? 1 : -1 });
    at(t, w, { x, duration: d, ease: 'power1.inOut' });
    at(t, w, { walk: `+=${((dist / 150) * Math.PI * 2).toFixed(3)}`, duration: d, ease: 'power1.inOut' });
    at(t, w, { stride: 1, duration: ramp, ease: 'sine.out' });
    at(t + d - ramp, w, { stride: 0, duration: ramp, ease: 'sine.in' });
    plannedX[id] = x;
  };
  const turn = (id: WorkerId, face: 1 | -1, t: number) => set(t, workers[id], { face });
  const appear = (id: WorkerId, t: number, d = 0.5) => at(t, workers[id], { opacity: 1, duration: d, ease: 'sine.out' });
  const vanish = (id: WorkerId, t: number, d = 0.45) => at(t, workers[id], { opacity: 0, duration: d, ease: 'sine.in' });

  /** move the empty hook so it ends exactly at p */
  const hookTo = (rig: CraneRig, p: P, t: number, d: number, dropDelay = 0, dropDur = d - dropDelay) => {
    at(t, rig.st, { trolley: p[0], duration: d, ease: 'power2.inOut' });
    at(t + dropDelay, rig.st, { drop: p[1] - rig.spec.jibY, duration: dropDur, ease: 'power2.inOut' });
  };
  const raiseHook = (rig: CraneRig, drop: number, t: number, d: number) =>
    at(t, rig.st, { drop, duration: d, ease: 'power2.inOut' });

  /** connect the bridle (the hook must already sit at hookAt) */
  const attach = (rig: CraneRig, id: CompId, t: number, d = 0.28) => {
    set(t, rig.st, { target: COMP_INDEX[id] });
    at(t, rig.st, { slack: 0, duration: d, ease: 'sine.inOut' });
    set(t + d, rig.st, { carry: 1, sway: 0 });
  };

  /** let the load go at its final position */
  const release = (rig: CraneRig, id: CompId, t: number, d = 0.32) => {
    const h = hookAt(comps[id], 0, 0);
    set(t, rig.st, { carry: 0, trolley: h[0], drop: h[1] - rig.spec.jibY, sway: 0 });
    at(t, rig.st, { slack: 1, duration: d, ease: 'sine.inOut' });
  };

  /** the load trails the trolley as it accelerates and settles as it stops */
  const swayDuring = (rig: CraneRig, t: number, d: number, dir: number, amp = 14) => {
    at(t, rig.st, { sway: amp * dir, duration: d * 0.32, ease: 'sine.out' });
    at(t + d * 0.32, rig.st, { sway: -amp * 0.5 * dir, duration: d * 0.5, ease: 'sine.inOut' });
    at(t + d * 0.82, rig.st, { sway: 0, duration: d * 0.42, ease: 'sine.inOut' });
  };

  /**
   * Cast a letter's structure in lifts: each pour rises to the next joint,
   * pauses, and cures (darker fresh material lightens) just behind the front.
   * Returns the time the last lift reaches `to`.
   */
  const pour = (k: GlyphKey, t: number, to = 642, perLift = 0.34, pause = 0.12) => {
    const r = rises[k];
    const from = plannedRise[k];
    const levels = [...LIFT_JOINTS.filter((y) => y > from + 1 && y < to - 1), to];
    let time = t;
    let prev = from;
    for (const level of levels) {
      const d = perLift * Math.max(0.55, (level - prev) / 214);
      at(time, r, { h: level, duration: d, ease: 'power2.inOut' });
      at(time + 0.3, r, { c: level, duration: d * 0.9, ease: 'sine.inOut' });
      time += d + pause;
      prev = level;
    }
    plannedRise[k] = to;
    return time - pause;
  };
  const plannedRise = {} as Record<GlyphKey, number>;
  for (const k of Object.keys(RISE) as GlyphKey[]) plannedRise[k] = 0;

  const L = cranes.L;
  const R = cranes.R;
  const sx = site.station.x;
  const bowls = comps.bowls;
  const aBar = comps.aBar;
  const hBar = comps.hBar;

  // ── 1.2 – 2.6  setting out ──────────────────────────────────────────
  const station = q('station');
  at(1.22, station, { opacity: 1, duration: 0.55, ease: 'sine.out' });
  if (site.station.surveyor) appear('surveyor', 1.22, 0.55);

  site.lines.baselines.forEach((_, i) => {
    const bl = q<SVGLineElement>(`baseline-${i}`);
    const cl = q<SVGLineElement>(`capline-${i}`);
    set(0, [bl, cl], { attr: { x1: sx, x2: sx } });
    const t0 = 1.4 + i * 0.14;
    at(t0, bl, { attr: { x1: site.lines.x0 }, duration: 1.2, ease: 'power3.inOut' });
    at(t0, bl, { attr: { x2: site.lines.x1 }, duration: 1.15, ease: 'power3.inOut' });
    at(t0 + 0.3, cl, { attr: { x1: wm.box.x0 - 240, x2: wm.box.x1 + 240 }, duration: 1.05, ease: 'power3.inOut' });
  });

  const ticks = qa<SVGLineElement>('[data-tick]');
  set(0, ticks, { opacity: 0 });
  ticks.forEach((tk) => {
    const x = Number(tk.getAttribute('x1'));
    const dist = Math.abs(x - sx) / Math.max(1, wm.width);
    at(1.82 + dist * 0.6, tk, { opacity: 1, duration: 0.3, ease: 'sine.out' });
  });

  // formwork: the name is only hinted at
  for (const k of GLYPH_ORDER) {
    const paths = qa<SVGPathElement>(`[data-k="formwork-${k}"] path`);
    const dist = Math.abs(g[k].x + 300 - sx) / Math.max(1, wm.width);
    at(1.95 + dist * 0.7, paths, { strokeDashoffset: 0, duration: 0.95, ease: 'power2.inOut' });
  }

  // pieces waiting on the laydown become visible as the site is set out
  const laydown = q('laydown');
  set(0, [bowls.st, aBar.st], { opacity: 0 });
  at(2.05, [bowls.st, aBar.st], { opacity: 1, duration: 0.5, ease: 'sine.out' });
  at(2.05, laydown, { opacity: 1, duration: 0.5, ease: 'sine.out' });

  // crane L erects: the mast climbs, then the jib slews into the plane
  const bowlsPick = hookAt(bowls, bowls.st.dx, bowls.st.dy);
  L.st.trolley = bowlsPick[0];
  L.st.slew = 0.18;
  at(1.35, L.st, { rise: 1, duration: 1.0, ease: 'power2.inOut' });
  at(2.12, L.st, { slew: 1, duration: 0.85, ease: 'power2.inOut' });

  // ── 2.6 – 4.2  the structure rises from its footings ────────────────
  const shore = q('shore');
  at(2.48, shore, { opacity: 1, duration: 0.4, ease: 'sine.out' });
  pour('B', 2.58);
  pour('N', 2.74, 642, 0.36);
  pour('A', 2.9, 261, 0.36);
  pour('H', 3.0, 642, 0.35);
  pour('I', 3.18);
  pour('L1', 3.3, 642, 0.33);
  pour('L2', 3.44, 642, 0.33);

  // scaffold and a worker between the H uprights
  const scaffold = q('scaffold-build');
  at(3.95, scaffold, { opacity: 1, duration: 0.45, ease: 'sine.out' });
  place('scaffold', site.workers.scaffold.x - 50);
  appear('scaffold', 4.3, 0.4);
  walk('scaffold', site.workers.scaffold.x, 4.3, 0.55);

  // curves completed along their spines
  at(3.28, spines.O, { p: 1, duration: 1.4, ease: 'power1.inOut' });
  at(4.4, spines.S1, { p: 1, duration: 1.25, ease: 'power1.inOut' });
  at(5.25, spines.S2, { p: 1, duration: 1.2, ease: 'power1.inOut' });

  // ── crane L · lift 1: the bowls of the B ────────────────────────────
  appear('bowls', 2.4, 0.5);
  hookTo(L, bowlsPick, 2.66, 0.42);
  pose('bowls', 'attach', 2.8, 0.3);
  attach(L, 'bowls', 3.08, 0.24);
  if (!stacked) {
    at(3.28, tags.bowls.st, { on: 1, duration: 0.18, ease: 'none' });
    pose('bowls', 'tagHold', 3.34, 0.4);
  } else {
    pose('bowls', 'stand', 3.34, 0.4);
  }
  const bowlsHoist = 3.34;
  // two lines: a longer hoist up to the upper level, a short traverse
  const bowlsHoistD = stacked ? 0.86 : 0.62;
  const bowlsTravelD = stacked ? 0.44 : 0.66;
  at(bowlsHoist, bowls.st, { dy: site.bowlsClearDy, duration: bowlsHoistD, ease: 'power2.inOut' });
  const bowlsTravel = bowlsHoist + bowlsHoistD - 0.06;
  at(bowlsTravel, bowls.st, { dx: 0, duration: bowlsTravelD, ease: 'power2.inOut' });
  swayDuring(L, bowlsTravel, bowlsTravelD, 1, stacked ? 8 : 14);
  if (!stacked) walk('bowls', site.workers.bowls.walkTo, bowlsTravel + 0.02, bowlsTravelD - 0.02);
  const bowlsLower = bowlsTravel + bowlsTravelD;
  at(bowlsLower, bowls.st, { dy: -22, duration: 0.4, ease: 'power2.out' });
  at(bowlsLower + 0.42, bowls.st, { dy: 0, duration: 0.2, ease: 'sine.inOut' });
  const bowlsDone = bowlsLower + 0.64;
  release(L, 'bowls', bowlsDone, 0.3);
  tl.addLabel('bowls-set', bowlsDone);
  if (!stacked) {
    at(bowlsDone, tags.bowls.st, { held: 0, duration: 0.26, ease: 'sine.in' });
    at(bowlsDone + 0.16, tags.bowls.st, { on: 0, duration: 0.2, ease: 'none' });
    pose('bowls', 'stand', bowlsDone + 0.02, 0.4);
  }

  // ── crane L · lift 2: the A crossbar, raised between converging legs ─
  const aPick = hookAt(aBar, 0, A_BAR_REST_DY);
  const aGo = bowlsDone + 0.05;
  raiseHook(L, 420, aGo, 0.34);
  at(aGo, L.st, { trolley: aPick[0], duration: 0.72, ease: 'power2.inOut' });
  at(aGo + 0.5, L.st, { drop: aPick[1] - L.spec.jibY, duration: 0.42, ease: 'power2.inOut' });
  place('aBar', site.workers.aBar.x - 150);
  appear('aBar', 4.95, 0.45);
  walk('aBar', site.workers.aBar.x, 4.95, 0.75);
  const aAttach = aGo + 0.92;
  pose('aBar', 'attach', aAttach - 0.26, 0.3);
  attach(L, 'aBar', aAttach, 0.22);
  const marksA = q('marks-A');
  at(aAttach, marksA, { opacity: 0.55, duration: 0.3, ease: 'sine.out' });
  pose('aBar', 'reachUp', aAttach + 0.22, 0.42);
  at(aAttach + 0.24, aBar.st, { dy: 16, duration: 0.42, ease: 'power2.inOut' });
  at(aAttach + 0.68, aBar.st, { dy: 0, duration: 0.2, ease: 'sine.inOut' });
  const aDone = aAttach + 0.9;
  at(aDone, marksA, { opacity: 0, duration: 0.3, ease: 'sine.in' });
  release(L, 'aBar', aDone, 0.26);
  tl.addLabel('a-bar-set', aDone);
  pose('aBar', 'stand', aDone + 0.02, 0.35);
  // the hook climbs clear of the A before its legs close the apex
  raiseHook(L, L.spec.parkDrop + 100, aDone + 0.06, 0.45);
  pour('A', aDone + 0.24, 642, 0.27, 0.06);

  // ── crane R erects; the truck reverses in with the H crossbar ───────
  const hPick = hookAt(hBar, hBarOnTruck.dx, hBarOnTruck.dy);
  R.st.trolley = hPick[0];
  R.st.slew = 0.18;
  at(2.55, R.st, { rise: 1, duration: 1.0, ease: 'power2.inOut' });
  at(3.3, R.st, { slew: 1, duration: 0.85, ease: 'power2.inOut' });
  const parked = 4.62;
  at(parked - 1.66, truck, { x: site.truck.parkX, duration: 1.66, ease: 'power2.out' });
  at(parked - 0.16, truck, { pitch: -0.3, duration: 0.2, ease: 'sine.out' });
  at(parked + 0.04, truck, { pitch: 0, duration: 0.5, ease: 'sine.inOut' });

  // the rigger steps out from behind the cab and slings the crossbar
  place('rigger', site.truck.parkX + 900, parked - 0.1);
  appear('rigger', parked - 0.08, 0.3);
  walk('rigger', site.workers.rigger.x, parked - 0.08, 0.6);
  turn('rigger', 1, parked + 0.52);
  hookTo(R, hPick, parked + 0.04, 0.62, 0.04);
  pose('rigger', 'attach', parked + 0.5, 0.3);
  const heroAttach = parked + 0.86;
  set(heroAttach, hBar.st, { truck: 0 });
  attach(R, 'hBar', heroAttach, 0.26);
  at(heroAttach + 0.14, tags.hBar.st, { on: 1, duration: 0.2, ease: 'none' });
  pose('rigger', 'stand', heroAttach + 0.26, 0.3);
  walk('rigger', site.truck.parkX - 80, heroAttach + 0.28, 0.55);
  turn('rigger', 1, heroAttach + 0.84);
  pose('rigger', 'signal', heroAttach + 0.86, 0.4);

  // ── hero: the H crossbar travels across and is set between the uprights
  const heroHoist = heroAttach + 0.45;
  tl.addLabel('hero-lift', heroHoist);
  at(heroHoist, hBar.st, { dy: -(640 + 70 - 314), duration: 0.58, ease: 'power2.inOut' });
  // unloaded, the truck pulls away
  at(heroHoist + 0.62, truck, { x: site.truck.offX, duration: 1.15, ease: 'power2.in' });
  const heroTravel = heroHoist + 0.52;
  const heroTravelD = 1.06;
  at(heroTravel, hBar.st, { dx: 0, duration: heroTravelD, ease: 'power2.inOut' });
  swayDuring(R, heroTravel, heroTravelD, -1, 16);
  const heroLower = heroTravel + heroTravelD;
  const marksH = q('marks-H');
  at(heroLower - 0.2, marksH, { opacity: 0.6, duration: 0.4, ease: 'sine.out' });
  // the scaffold hand takes the tag line as the load arrives
  pose('scaffold', 'tagHold', heroLower - 0.3, 0.4);
  at(heroLower - 0.16, tags.hBar.st, { held: 1, duration: 0.3, ease: 'sine.inOut' });
  at(heroLower, hBar.st, { dy: -30, duration: 0.46, ease: 'power2.out' });
  pose('scaffold', 'reachUp', heroLower + 0.08, 0.42);
  at(heroLower + 0.14, tags.hBar.st, { held: 0, on: 0, duration: 0.3, ease: 'sine.inOut' });
  // the rest of the site quietens so the eye settles on the H
  const quiet = [q('craneL'), q('hookL'), q('laydown'), station, shore];
  at(heroLower - 0.25, quiet, { opacity: 0.45, duration: 0.6, ease: 'sine.inOut' });
  for (const id of ['surveyor', 'bowls', 'aBar', 'rigger'] as WorkerId[]) {
    if (id === 'surveyor' && !site.station.surveyor) continue;
    at(heroLower - 0.25, workers[id], { opacity: 0.45, duration: 0.6, ease: 'sine.inOut' });
  }
  // a short alignment hold in near silence, then the final set
  const heroSet = heroLower + 0.46 + 0.24;
  at(heroSet, hBar.st, { dy: 0, duration: 0.28, ease: 'sine.inOut' });
  const contact = heroSet + 0.28;
  tl.addLabel('hero-set', contact);
  at(contact, marksH, { opacity: 1, duration: 0.06, ease: 'none' });
  at(contact + 0.08, marksH, { opacity: 0, duration: 0.4, ease: 'sine.in' });
  release(R, 'hBar', contact + 0.08, 0.3);
  pose('scaffold', 'stand', contact + 0.1, 0.4);
  raiseHook(R, R.spec.parkDrop, contact + 0.24, 0.45);

  // ── camera: an almost imperceptible drift in through the build, a
  //    restrained push toward the H for the final set, then it settles
  //    exactly on the finished frame (scale 1, centred) ──────────────────
  const heroFocus = { x: g.H.x + 380, y: g.H.y - 325 };
  const fx = wm.cx + (heroFocus.x - wm.cx) * 0.38;
  const fy = wm.cy + (heroFocus.y - wm.cy) * 0.38;
  // never push so far that any part of the site leaves the frame
  const ex = site.extents;
  const room = 10; // px kept clear at the viewport edge
  const maxS = Math.min(
    (frame.vw / 2 - room) / (frame.scale * Math.max(fx - ex.x0, ex.x1 - fx)),
    (frame.vh / 2 - room) / (frame.scale * Math.max(fy - ex.y0, ex.y1 - fy)),
  );
  const push = Math.max(1, Math.min(1.1, maxS));
  const pushStart = heroTravel + heroTravelD * 0.35;
  at(BLACK_END, camera, { s: 0.992, duration: pushStart - BLACK_END, ease: 'sine.inOut' });
  at(pushStart, camera, {
    s: push,
    fx: push > 1.005 ? fx : wm.cx,
    fy: push > 1.005 ? fy : wm.cy,
    duration: heroSet + 0.28 - pushStart,
    ease: 'power2.inOut',
  });
  at(contact + 0.35, camera, { s: 1, fx: wm.cx, fy: wm.cy, duration: HOLD_START - contact - 0.35, ease: 'sine.inOut' });

  // ── resolve: precast surfaces become the finished white letters ─────
  const resolveAt = contact + 0.06;
  const hx = g.H.x + 380;
  for (const k of GLYPH_ORDER) {
    const dist = Math.abs(g[k].x + 300 - hx) / Math.max(1, wm.width);
    at(resolveAt + dist * 0.45, finals[k], { opacity: 1, duration: 0.55, ease: 'sine.inOut' });
  }
  at(resolveAt + 0.45, hBar.st, { opacity: 0, duration: 0.25, ease: 'sine.inOut' });
  const formwork = q('formwork');
  at(resolveAt + 0.05, formwork, { opacity: 0, duration: 0.55, ease: 'sine.inOut' });

  // ── withdraw: crew, temporary works, cranes, then the guides ────────
  const out = contact + 0.12;
  if (site.station.surveyor) {
    walk('surveyor', workers.surveyor.x - 100, out, 0.55);
    vanish('surveyor', out + 0.05, 0.45);
  }
  at(out + 0.05, station, { opacity: 0, duration: 0.4, ease: 'sine.in' });
  walk('bowls', plannedX.bowls - 110, out, 0.55);
  vanish('bowls', out + 0.05, 0.45);
  walk('aBar', plannedX.aBar - 110, out + 0.04, 0.55);
  vanish('aBar', out + 0.08, 0.45);
  vanish('scaffold', out + 0.08, 0.36);
  pose('rigger', 'stand', out - 0.1, 0.28);
  walk('rigger', plannedX.rigger + 120, out, 0.55);
  vanish('rigger', out + 0.06, 0.45);
  at(out + 0.12, scaffold, { opacity: 0, duration: 0.42, ease: 'sine.in' });
  at(out, shore, { opacity: 0, duration: 0.42, ease: 'sine.in' });
  at(out, laydown, { opacity: 0, duration: 0.36, ease: 'sine.in' });
  // cranes slew their jibs out of the plane and lower away
  raiseHook(L, 130, out - 0.1, 0.4);
  at(out + 0.04, L.st, { slew: 0.18, duration: 0.46, ease: 'power2.inOut' });
  at(out + 0.36, L.st, { rise: 0, duration: 0.56, ease: 'power2.in' });
  at(out + 0.12, R.st, { slew: 0.18, duration: 0.46, ease: 'power2.inOut' });
  at(out + 0.44, R.st, { rise: 0, duration: 0.56, ease: 'power2.in' });
  // the survey guides are the last to go
  const survey = q('survey');
  at(out + 0.44, survey, { opacity: 0, duration: 0.55, ease: 'sine.inOut' });

  tl.addLabel('setting-out', BLACK_END);
  tl.addLabel('hold', HOLD_START);
  // pin the end of the construction timeline
  set(HOLD_END, camera, { s: 1 });

  render();
  return { tl, render };
}
