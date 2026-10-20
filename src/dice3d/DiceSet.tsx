import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { Quaternion, Vector3, type Group, type Mesh } from 'three';
import { rollStore, uiStore } from '../app/appState';
import { soundEngine } from '../audio/soundEngine';
import { countFaces, type Faces, type RollRecord } from '../game/roll';
import { ROLL_TIMING } from '../game/rollTiming';
import { SYMBOL_IDS, type SymbolId } from '../game/symbols';
import { branchCandidates, posesToPlain } from './branchSearch';
import type { BranchWorkerReply, BranchWorkerRequest } from './branchWorker';
import { createDiceResources } from './diceResources';
import { DiceSimulation, type DiePose } from './diceSimulation';
import { FACE_LAYOUT, restQuaternion, upwardFace } from './faceMap';
import { clonePoses, fitPosesToTray, gridLayout } from './layout';
import { DIE_HALF, type TrayDims } from './trayConfig';
import { visualRandom } from './visualRandom';

declare global {
  interface Window {
    /** Dev-only: simulation time of the frame on screen during a roll. */
    __playT?: number;
    __diceDebug?: {
      rollId: string;
      upward: (SymbolId | null)[];
      flatness: number[];
      restAt: number | null;
      paths: number[];
      impacts: { die: number; wall: number; felt: number };
      stats: unknown;
      lookAhead: {
        tried: number;
        best: { seed: number; score: number } | null;
        decidedBy: string | null;
        /** The worker's replay reached exactly the state this roll had at the branch point. */
        consistent: boolean | null;
      } | null;
    };
  }
}

/** Simulate this far ahead of the frame being drawn, so impacts can be scheduled precisely. */
const LEAD = 1 / 60;
/**
 * Physics time budget per frame (ms). Stepping is cheap, so this normally
 * keeps pace even when rendering is slow; if it cannot, playback slows down
 * instead of skipping, and a single long stall never triggers a burst of work.
 */
const PHYSICS_BUDGET_MS = 6;
/** Continuations the look-ahead may try per roll (branchSearch.ts); it stops early on a perfect one. */
const LOOKAHEAD_CANDIDATES = 12;
/** When playback gets this close to the branch point, the best continuation found so far is taken. */
const DECIDE_AHEAD = 0.1;
/** Dev-only `?lookahead=0`: play the first continuation without searching (for comparison). */
const LOOKAHEAD = !(import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('lookahead') === '0');
/** Dev-only `?slowmo=N`: play rolls N times slower, for frame-by-frame inspection. */
const SLOWMO = (() => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return 1;
  const n = Number(new URLSearchParams(window.location.search).get('slowmo'));
  return Number.isFinite(n) && n >= 1 ? n : 1;
})();

/** How quickly halos and edge glow ease toward their target (per second). */
const EASE_RATE = 9;

interface LiveRoll {
  roll: RollRecord;
  sim: DiceSimulation | null;
  /** Reduced motion: dip out at the old poses, return at these. */
  reduced: { from: DiePose[]; to: DiePose[] } | null;
  /** performance.now() of the first rendered frame (null until then). */
  start: number | null;
  heard: number;
  settlingSent: boolean;
  /** Last keep-alive sent to the store's watchdog. */
  lastAlive: number;
  /** Look-ahead search for this roll (null: none, the simulation picks its own continuation). */
  lookAhead: LookAhead | null;
}

interface LookAhead {
  id: number;
  candidates: number[];
  /** Continuation chosen; the simulation may run past the branch point. */
  decided: boolean;
  /** search: the worker finished; deadline: playback got close; fallback: no result; hidden: tab hidden. */
  decidedBy: 'search' | 'deadline' | 'fallback' | 'hidden' | null;
  /** The worker has settled every candidate, or failed: decide at the next frame. */
  finished: boolean;
  best: { seed: number; score: number } | null;
  tried: number;
  /** Fingerprint of the worker's replay at the branch point. */
  baseHash: number | null;
}

/** Ids of look-ahead searches, so late replies for an earlier roll are ignored. */
let lookAheadSeq = 0;

/** Sound session of the most recent 3D roll (see soundEngine.release). */
let soundToken = -1;

interface Reveal {
  start: number;
  /** Halo strength each die settles at (0 for symbols that came up once). */
  level: number[];
  chimed: boolean;
}

/** Yaw of a resting die, measured the way restQuaternion() applies it. */
function yawOf(q: Quaternion): number {
  const { symbol } = upwardFace(q);
  const up = new Vector3(...FACE_LAYOUT[symbol].up).applyQuaternion(q);
  return Math.atan2(-up.x, -up.z);
}

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/**
 * The six dice. All per-frame work writes straight to Three.js objects; React
 * never re-renders during a roll.
 *
 * A roll plays a live DiceSimulation (diceSimulation.ts): each frame advances
 * the fixed-step physics a little ahead of the clock, draws the interpolated
 * poses, trembles the tray by the same shake signal that drives the physics,
 * and hands new collisions to the sound engine. Meanwhile a worker replays
 * the roll and tries continuations from the branch point (branchSearch.ts);
 * the best one found is played from there. When the simulation confirms
 * all six dice at rest on their recorded faces, the store is told
 * (completeRoll → revealing) and the reveal plays: a short hold, then warm
 * halos under dice whose symbol came up more than once, with a one-time glow
 * along their ivory edges. The dice never move again until the next roll.
 */
export function DiceSet({
  dims,
  reducedMotion,
  rig,
}: {
  dims: TrayDims;
  reducedMotion: boolean;
  rig: RefObject<Group | null>;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const resources = useMemo(() => createDiceResources(), []);

  const dieRefs = useRef<(Group | null)[]>([]);
  const shadowRefs = useRef<(Mesh | null)[]>([]);
  const haloRefs = useRef<(Mesh | null)[]>([]);
  const dimsRef = useRef(dims);
  const reducedRef = useRef(reducedMotion);
  const liveRef = useRef<LiveRoll | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const revealRef = useRef<Reveal | null>(null);
  const handledRef = useRef<string | null>(null);
  const shownFacesRef = useRef<readonly SymbolId[] | null>(null);
  const restRef = useRef<DiePose[] | null>(null);
  if (restRef.current === null) {
    const last = rollStore.getState().lastResult;
    shownFacesRef.current = last ? last.faces : null;
    restRef.current = gridLayout(last ? last.faces : SYMBOL_IDS, dims);
  }

  const controller = useMemo(() => {
    const P = Array.from({ length: 6 }, () => new Vector3());
    const Q = Array.from({ length: 6 }, () => new Quaternion());
    const halo = Array(6).fill(0);
    const glow = Array(6).fill(0);
    const offset = { x: 0, y: 0, z: 0 };
    let lastFrame = 0;

    const applyPoses = (positions: readonly Vector3[], quaternions: readonly Quaternion[], scale = 1) => {
      for (let i = 0; i < 6; i++) {
        const die = dieRefs.current[i];
        if (die) {
          die.position.copy(positions[i]);
          die.quaternion.copy(quaternions[i]);
          die.scale.setScalar(scale);
        }
        const height = Math.max(0, positions[i].y - DIE_HALF);
        const shadow = shadowRefs.current[i];
        if (shadow) {
          shadow.position.set(positions[i].x, 0.004, positions[i].z);
          shadow.scale.setScalar((1 + height * 0.35) * scale);
        }
        resources.perDie[i].shadow.opacity = Math.max(0, 1 - height * 0.32) * scale;
        haloRefs.current[i]?.position.set(positions[i].x, 0.006, positions[i].z);
      }
    };

    const applyRest = () => {
      const rest = restRef.current!;
      applyPoses(
        rest.map((p) => p.position),
        rest.map((p) => p.quaternion),
      );
      rig.current?.position.set(0, 0, 0);
    };

    /** Halo and edge-glow targets for this instant; returns true while still changing. */
    const updateEmphasis = (now: number, dt: number): boolean => {
      const reveal = revealRef.current;
      const hovered = uiStore.get().hoveredSymbol;
      const faces = liveRef.current ? null : shownFacesRef.current;
      let moving = false;
      for (let i = 0; i < 6; i++) {
        let haloTarget = 0;
        let glowTarget = 0;
        if (faces && reveal) {
          const r = (now - reveal.start) / 1000 - ROLL_TIMING.revealHold;
          const level = reveal.level[i];
          if (r > 0 && level > 0) {
            // Rise, a single gentle swell for repeated symbols, then hold.
            haloTarget = level * (smooth(r / 0.35) + 0.35 * Math.sin(Math.PI * smooth((r - 0.1) / 0.55)));
            glowTarget = 0.16 * Math.sin(Math.PI * smooth(r / 0.6));
            if (r < 0.9) moving = true;
          }
        }
        if (faces && hovered && faces[i] === hovered) haloTarget = Math.max(haloTarget, 0.8);
        const k = 1 - Math.exp(-EASE_RATE * dt);
        halo[i] += (haloTarget - halo[i]) * k;
        glow[i] += (glowTarget - glow[i]) * k;
        if (Math.abs(haloTarget - halo[i]) > 0.004 || Math.abs(glowTarget - glow[i]) > 0.002) moving = true;
        resources.perDie[i].halo.opacity = halo[i];
        resources.perDie[i].body.emissiveIntensity = glow[i];
        const mesh = haloRefs.current[i];
        if (mesh) mesh.visible = halo[i] > 0.003;
      }
      return moving;
    };

    const startReveal = (faces: Faces, now: number) => {
      const counts = countFaces(faces);
      revealRef.current = {
        start: now,
        level: faces.map((f) => (counts[f] >= 2 ? Math.min(1, 0.78 + 0.08 * (counts[f] - 2)) : 0)),
        chimed: false,
      };
    };

    /**
     * Look-ahead (branchSearch.ts). At roll start the worker gets everything
     * needed to replay this roll (faces, tray, starting poses, seed) and tries
     * continuations from the branch point while playback runs; playback waits
     * for nothing. The simulation holds at the branch point until a
     * continuation is chosen: the best found when the worker finishes, or when
     * playback gets close, whichever comes first.
     */
    const startSearch = (live: LiveRoll, seed: number, start: readonly DiePose[]) => {
      const look = live.lookAhead!;
      const sim = live.sim!;
      try {
        const message: BranchWorkerRequest = {
          type: 'search',
          id: look.id,
          request: {
            faces: live.roll.faces,
            dims: { halfWidth: sim.dims.halfWidth, halfDepth: sim.dims.halfDepth },
            start: posesToPlain(start),
            seed,
            candidates: look.candidates,
          },
        };
        workerRef.current!.postMessage(message);
      } catch (error) {
        console.warn('[dice] look-ahead unavailable for this roll', error);
        look.finished = true;
      }
    };

    const decide = (live: LiveRoll, by: NonNullable<LookAhead['decidedBy']>) => {
      const look = live.lookAhead!;
      look.decided = true;
      look.decidedBy = by;
      live.sim!.chooseBranch(look.best?.seed ?? look.candidates[0]);
      cancelSearch(live);
    };

    const cancelSearch = (live: LiveRoll) => {
      const look = live.lookAhead;
      if (!look || look.finished) return;
      look.finished = true;
      const message: BranchWorkerRequest = { type: 'cancel', id: look.id };
      workerRef.current?.postMessage(message);
    };

    const onSearchReply = (reply: BranchWorkerReply) => {
      const look = liveRef.current?.lookAhead;
      if (!look || reply.id !== look.id || look.decided) return;
      if (reply.error) {
        console.warn('[dice] look-ahead failed; playing the first continuation', reply.error);
        look.finished = true;
        return;
      }
      if (reply.best) look.best = reply.best;
      if (reply.tried !== undefined) look.tried = reply.tried;
      if (reply.baseHash != null) look.baseHash = reply.baseHash;
      if (reply.done) look.finished = true;
    };

    /** The worker could not start or crashed: rolls go on without the look-ahead. */
    const onSearchUnavailable = () => {
      const look = liveRef.current?.lookAhead;
      if (look && !look.decided) look.finished = true;
    };

    /**
     * Dice are confirmed at rest on the recorded faces: hand over to the reveal.
     * `silent` (tab hidden) skips the chime, which would otherwise sound in the
     * background or whenever the user comes back.
     */
    const finishLive = (live: LiveRoll, now: number, silent = false) => {
      cancelSearch(live);
      const final = live.sim ? live.sim.finalPoses() : live.reduced!.to;
      restRef.current = clonePoses(final);
      liveRef.current = null;
      shownFacesRef.current = live.roll.faces;
      applyRest();
      soundEngine.endRoll();
      if (!live.settlingSent) rollStore.markSettling(live.roll.id);
      rollStore.completeRoll(live.roll.id);
      startReveal(live.roll.faces, now);
      if (silent) revealRef.current!.chimed = true;
      if (import.meta.env.DEV) {
        // Dev-only verification hook: what the rendered meshes actually show.
        window.__diceDebug = {
          rollId: live.roll.id,
          upward: dieRefs.current.map((g) => (g ? upwardFace(g.quaternion).symbol : null)),
          flatness: dieRefs.current.map((g) => (g ? upwardFace(g.quaternion).alignment : 0)),
          restAt: live.sim?.restAt ?? null,
          paths: live.sim?.pathLengths() ?? [],
          impacts: {
            die: live.sim?.impacts.filter((e) => e.surface === 'die').length ?? 0,
            wall: live.sim?.impacts.filter((e) => e.surface === 'wall').length ?? 0,
            felt: live.sim?.impacts.filter((e) => e.surface === 'felt').length ?? 0,
          },
          stats: live.sim?.stats ?? null,
          lookAhead: live.lookAhead && {
            tried: live.lookAhead.tried,
            best: live.lookAhead.best,
            decidedBy: live.lookAhead.decidedBy,
            consistent:
              live.lookAhead.baseHash === null || live.sim?.branchPointHash == null
                ? null
                : live.lookAhead.baseHash === live.sim.branchPointHash,
          },
        };
      }
      invalidate();
    };

    const start = (roll: RollRecord) => {
      handledRef.current = roll.id;
      revealRef.current = null;
      const from = restRef.current!;
      try {
        if (reducedRef.current) {
          const to = from.map((p, i) => ({
            position: p.position.clone(),
            quaternion: restQuaternion(roll.faces[i], yawOf(p.quaternion)),
          }));
          liveRef.current = {
            roll,
            sim: null,
            reduced: { from: clonePoses(from), to },
            start: null,
            heard: 0,
            settlingSent: false,
            lastAlive: 0,
            lookAhead: null,
          };
        } else {
          const seed = Math.floor(visualRandom() * 2 ** 32);
          const sim = new DiceSimulation(roll.faces, dimsRef.current, from, { seed });
          const lookAhead: LookAhead | null =
            LOOKAHEAD && workerRef.current
              ? {
                  id: ++lookAheadSeq,
                  candidates: branchCandidates(seed, LOOKAHEAD_CANDIDATES),
                  decided: false,
                  decidedBy: null,
                  finished: false,
                  best: null,
                  tried: 0,
                  baseHash: null,
                }
              : null;
          const live: LiveRoll = { roll, sim, reduced: null, start: null, heard: 0, settlingSent: false, lastAlive: 0, lookAhead };
          liveRef.current = live;
          if (lookAhead) startSearch(live, seed, from);
        }
      } catch (error) {
        // Last resort: show the already-recorded result in place and release the UI.
        console.error('[dice] could not start the roll; showing the recorded result', error);
        liveRef.current = null;
        restRef.current = from.map((p, i) => ({
          position: p.position.clone(),
          quaternion: restQuaternion(roll.faces[i], yawOf(p.quaternion)),
        }));
        shownFacesRef.current = roll.faces;
        applyRest();
        rollStore.markSettling(roll.id);
        rollStore.completeRoll(roll.id, { recovered: true });
      }
      invalidate();
    };

    /** Completes the current roll immediately (tab hidden, store watchdog). */
    const finishNow = () => {
      const live = liveRef.current;
      if (!live) return;
      soundEngine.release(soundToken);
      if (live.lookAhead && !live.lookAhead.decided) decide(live, 'hidden');
      if (live.sim) {
        live.sim.runToEnd();
        live.sim.repair(live.sim.wrongDice());
        live.sim.runToEnd();
      }
      finishLive(live, performance.now(), true);
    };

    const frame = () => {
      const now = performance.now();
      const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 1 / 60;
      lastFrame = now;
      let again = false;
      const live = liveRef.current;

      if (live) {
        if (live.start === null) {
          live.start = now;
          if (live.sim) soundToken = soundEngine.beginRoll();
        }
        let t = (now - live.start) / 1000 / SLOWMO;

        if (live.sim) {
          const sim = live.sim;
          const look = live.lookAhead;
          if (look && !look.decided && (look.finished || t >= ROLL_TIMING.branchAt - DECIDE_AHEAD)) {
            decide(live, !look.finished ? 'deadline' : look.best ? 'search' : 'fallback');
          }
          // Never past the branch point before a continuation is chosen.
          const target = look && !look.decided ? Math.min(t + LEAD, ROLL_TIMING.branchAt) : t + LEAD;
          sim.advanceTo(target, now + PHYSICS_BUDGET_MS);
          if (now - live.lastAlive > 1000) {
            live.lastAlive = now;
            rollStore.keepAlive(live.roll.id);
          }
          if (!sim.done && sim.time < t) {
            // Physics fell behind (slow device, long frame): slow the playback
            // down rather than skipping ahead, so no motion or sound is lost.
            live.start += (t - sim.time) * 1000 * SLOWMO;
            t = sim.time;
          }
          const shown = sim.done ? Math.min(t, sim.restAt!) : t;
          if (import.meta.env.DEV) window.__playT = shown;
          for (let i = 0; i < 6; i++) sim.sample(i, shown, P[i], Q[i]);
          applyPoses(P, Q);
          sim.shake.offset(shown, offset);
          rig.current?.position.set(offset.x, 0, offset.z);

          // Collisions due within the next moment of playback, scheduled at their
          // exact time (the simulation itself may be further ahead, see look-ahead).
          const impacts = sim.impacts;
          const horizon = Math.min(sim.time, t + LEAD);
          while (live.heard < impacts.length && impacts[live.heard].t <= horizon) {
            const e = impacts[live.heard++];
            const delay = e.t - t;
            if (delay > -0.05) soundEngine.impact(Math.max(0, delay), e.strength, e.surface, e.die);
          }
          const activity = sim.activity(shown);
          soundEngine.setActivity(activity.rattle, activity.slide);

          if (!live.settlingSent && t >= ROLL_TIMING.shakeEnd) {
            live.settlingSent = true;
            rollStore.markSettling(live.roll.id);
          }
          if (sim.done && t >= sim.restAt!) {
            // Defensive re-check before anything is revealed (never expected to fire).
            const wrong = sim.wrongDice();
            if (wrong.length) {
              console.error('[dice] resting face mismatch; recovering', wrong);
              sim.repair(wrong);
              again = true;
            } else {
              finishLive(live, now);
            }
          } else {
            again = true;
          }
        } else {
          // Reduced motion: a quick dip, the faces change out of sight, and back.
          const { from, to } = live.reduced!;
          const out = ROLL_TIMING.reducedOut;
          if (t < out) {
            from.forEach((p, i) => (P[i].copy(p.position), Q[i].copy(p.quaternion)));
            applyPoses(P, Q, Math.max(0.001, 1 - smooth(t / out)));
            again = true;
          } else if (t < out + ROLL_TIMING.reducedIn) {
            to.forEach((p, i) => (P[i].copy(p.position), Q[i].copy(p.quaternion)));
            applyPoses(P, Q, Math.max(0.001, smooth((t - out) / ROLL_TIMING.reducedIn)));
            if (!live.settlingSent) {
              live.settlingSent = true;
              rollStore.markSettling(live.roll.id);
              for (let i = 0; i < 6; i += 2) soundEngine.impact(0.04 * i, 3.5, 'felt', i);
            }
            again = true;
          } else {
            finishLive(live, now);
          }
        }
      }

      const reveal = revealRef.current;
      if (reveal && !reveal.chimed && (now - reveal.start) / 1000 >= ROLL_TIMING.revealHold) {
        reveal.chimed = true;
        soundEngine.playReveal();
      }
      if (updateEmphasis(now, dt)) again = true;
      if (reveal && !reveal.chimed) again = true;
      if (again) invalidate();
      else lastFrame = 0;
    };

    const syncWithStore = () => {
      const state = rollStore.getState();
      if (state.activeRoll && state.activeRoll.id !== handledRef.current) {
        if (liveRef.current) finishNow();
        start(state.activeRoll);
      } else if (!state.activeRoll && liveRef.current) {
        // The store finished this roll without us (watchdog recovery).
        finishNow();
      }
    };

    const relayout = (next: TrayDims) => {
      dimsRef.current = next;
      if (liveRef.current) return;
      restRef.current = fitPosesToTray(restRef.current!, next);
      applyRest();
      invalidate();
    };

    return {
      applyRest,
      frame,
      syncWithStore,
      finishNow,
      relayout,
      onSearchReply,
      onSearchUnavailable,
      refresh: () => invalidate(),
    };
  }, [invalidate, resources, rig]);

  useEffect(() => {
    reducedRef.current = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    if (dims !== dimsRef.current) controller.relayout(dims);
  }, [dims, controller]);

  useLayoutEffect(() => {
    controller.applyRest();
    controller.syncWithStore();
    const unsubscribeRoll = rollStore.subscribe(controller.syncWithStore);
    const unsubscribeUi = uiStore.subscribe(controller.refresh);
    const onVisibility = () => {
      // Hidden tabs get no frames: finish on the recorded result rather than
      // replaying a stale tumble (or a burst of queued steps and sounds) later.
      if (document.hidden) controller.finishNow();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      unsubscribeRoll();
      unsubscribeUi();
      document.removeEventListener('visibilitychange', onVisibility);
      soundEngine.release(soundToken);
    };
  }, [controller]);

  useEffect(() => () => resources.dispose(), [resources]);

  useEffect(() => {
    // The look-ahead worker starts with the tray, so it is warm by the first roll.
    // Without it (unsupported, blocked, crashed) rolls simply skip the search.
    // A single-core device would pay for the search in dropped frames.
    if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency === 1) return;
    let worker: Worker;
    try {
      worker = new Worker(new URL('./branchWorker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
      console.warn('[dice] look-ahead worker unavailable', error);
      return;
    }
    worker.onmessage = (event: MessageEvent<BranchWorkerReply>) => controller.onSearchReply(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      console.warn('[dice] look-ahead worker failed', event.message);
      if (workerRef.current === worker) workerRef.current = null;
      worker.terminate();
      controller.onSearchUnavailable();
    };
    workerRef.current = worker;
    return () => {
      if (workerRef.current === worker) workerRef.current = null;
      worker.terminate();
    };
  }, [controller]);

  useFrame(controller.frame);

  return (
    <group>
      {Array.from({ length: 6 }, (_, i) => (
        <group key={i}>
          <group ref={(el) => void (dieRefs.current[i] = el)}>
            <mesh geometry={resources.bodyGeometry} material={resources.perDie[i].body} castShadow receiveShadow />
            <mesh geometry={resources.faceGeometry} material={resources.faceMaterial} receiveShadow />
          </group>
          <mesh
            ref={(el) => void (shadowRefs.current[i] = el)}
            geometry={resources.shadowGeometry}
            material={resources.perDie[i].shadow}
            renderOrder={1}
          />
          <mesh
            ref={(el) => void (haloRefs.current[i] = el)}
            geometry={resources.haloGeometry}
            material={resources.perDie[i].halo}
            visible={false}
            renderOrder={2}
          />
        </group>
      ))}
    </group>
  );
}
