import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Quaternion, Vector3, type Group, type Mesh, type MeshBasicMaterial } from 'three';
import { rollStore, uiStore } from '../app/appState';
import { soundEngine } from '../audio/soundEngine';
import type { RollRecord } from '../game/roll';
import { SYMBOL_IDS, type SymbolId } from '../game/symbols';
import { createDiceResources } from './diceResources';
import { upwardFace } from './faceMap';
import { clonePoses, fitPosesToTray, gridLayout } from './layout';
import { RollAnimation } from './rollAnimation';
import { planProcedural, planRoll, type DiePose } from './rollPlanner';
import { DIE_HALF, type TrayDims } from './trayConfig';
import { visualRandom } from './visualRandom';

declare global {
  interface Window {
    __diceDebug?: {
      rollId: string;
      upward: (SymbolId | null)[];
      flatness: number[];
      source: string;
      attempts: number;
      seconds: number;
    };
  }
}

const GLOW_SECONDS = 0.9;
const GLOW_PEAK = 0.2;

interface ActiveAnimation {
  anim: RollAnimation;
  start: number;
  settlingSent: boolean;
}

/**
 * The six dice. Rendering state lives in refs and is written straight to the
 * Three.js objects each frame; React never re-renders during a roll.
 *
 * Synchronisation with the roll store:
 * - A new `activeRoll` starts a planned animation toward exactly its faces.
 * - Crossing `settleAt` calls markSettling; reaching the end calls completeRoll.
 * - If the store completes the roll first (watchdog), or the tab is hidden,
 *   the dice jump to the plan's final poses, which already show the recorded faces.
 */
export function DiceSet({ dims, reducedMotion }: { dims: TrayDims; reducedMotion: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const resources = useMemo(() => createDiceResources(), []);
  const shadowMaterials = useMemo(
    () => Array.from({ length: 6 }, () => resources.shadowMaterial.clone() as MeshBasicMaterial),
    [resources],
  );

  const dieRefs = useRef<(Group | null)[]>([]);
  const shadowRefs = useRef<(Mesh | null)[]>([]);
  const ringRefs = useRef<(Mesh | null)[]>([]);
  const dimsRef = useRef(dims);
  const reducedRef = useRef(reducedMotion);
  const animRef = useRef<ActiveAnimation | null>(null);
  /** Id of the last roll this renderer has taken charge of, so each roll starts exactly once. */
  const handledRollRef = useRef<string | null>(null);
  const glowStartRef = useRef<number | null>(null);
  const shownFacesRef = useRef<readonly SymbolId[] | null>(null);
  const restRef = useRef<DiePose[] | null>(null);
  if (restRef.current === null) {
    const last = rollStore.getState().lastResult;
    shownFacesRef.current = last ? last.faces : null;
    restRef.current = gridLayout(last ? last.faces : SYMBOL_IDS, dims);
  }

  const scratch = useMemo(
    () => ({
      positions: Array.from({ length: 6 }, () => new Vector3()),
      quaternions: Array.from({ length: 6 }, () => new Quaternion()),
    }),
    [],
  );

  // All per-frame and event logic lives in one stable controller object so
  // callbacks never capture stale state.
  const controller = useMemo(() => {
    const applyPoses = (positions: readonly Vector3[], quaternions: readonly Quaternion[], scale: number) => {
      for (let i = 0; i < 6; i++) {
        const die = dieRefs.current[i];
        if (die) {
          die.position.copy(positions[i]);
          die.quaternion.copy(quaternions[i]);
          die.scale.setScalar(scale);
        }
        const shadow = shadowRefs.current[i];
        if (shadow) {
          const height = Math.max(0, positions[i].y - DIE_HALF);
          shadow.position.set(positions[i].x, 0.004, positions[i].z);
          shadow.scale.setScalar((1 + height * 0.35) * scale);
          shadowMaterials[i].opacity = Math.max(0, 1 - height * 0.32) * scale;
        }
      }
    };

    const applyRest = () => {
      const rest = restRef.current!;
      applyPoses(
        rest.map((p) => p.position),
        rest.map((p) => p.quaternion),
        1,
      );
    };

    const updateRings = () => {
      const hovered = uiStore.get().hoveredSymbol;
      const faces = animRef.current ? null : shownFacesRef.current;
      const rest = restRef.current!;
      for (let i = 0; i < 6; i++) {
        const ring = ringRefs.current[i];
        if (!ring) continue;
        ring.visible = Boolean(faces && hovered && faces[i] === hovered);
        ring.position.set(rest[i].position.x, 0.006, rest[i].position.z);
      }
      invalidate();
    };

    const complete = (active: ActiveAnimation, now: number) => {
      const { anim } = active;
      restRef.current = clonePoses(anim.plan.finalPoses);
      animRef.current = null;
      shownFacesRef.current = anim.plan.faces;
      applyRest();
      glowStartRef.current = now;
      if (!active.settlingSent) rollStore.markSettling(anim.rollId);
      soundEngine.playSettle();
      rollStore.completeRoll(anim.rollId);
      if (import.meta.env.DEV) {
        // Dev-only verification hook: what the rendered meshes actually show.
        window.__diceDebug = {
          rollId: anim.rollId,
          upward: dieRefs.current.map((g) => (g ? upwardFace(g.quaternion).symbol : null)),
          flatness: dieRefs.current.map((g) => (g ? upwardFace(g.quaternion).alignment : 0)),
          source: anim.plan.source,
          attempts: anim.plan.attempts,
          seconds: anim.total,
        };
      }
      updateRings();
      invalidate();
    };

    const start = (roll: RollRecord) => {
      handledRollRef.current = roll.id;
      const dimsNow = dimsRef.current;
      try {
        let plan;
        try {
          plan = planRoll(roll.faces, dimsNow);
        } catch (error) {
          console.error('[dice] planner failed; using procedural tumble', error);
          plan = planProcedural(roll.faces, dimsNow, visualRandom);
        }
        const anim = new RollAnimation(roll.id, plan, restRef.current!, reducedRef.current);
        animRef.current = { anim, start: performance.now(), settlingSent: false };
        glowStartRef.current = null;
        resources.setGlow(0);
        updateRings();
        if (!reducedRef.current) soundEngine.playRoll(plan.impacts, anim.throwStart, true);
        invalidate();
      } catch (error) {
        // Last resort: show the already-recorded result immediately and release the UI.
        console.error('[dice] animation failed; showing recorded result', error);
        animRef.current = null;
        restRef.current = gridLayout(roll.faces, dimsNow);
        shownFacesRef.current = roll.faces;
        applyRest();
        rollStore.markSettling(roll.id);
        rollStore.completeRoll(roll.id, { recovered: true });
        invalidate();
      }
    };

    /** Jump to the end of the current animation (final faces are already known). */
    const finishNow = () => {
      const active = animRef.current;
      if (!active) return;
      soundEngine.stopAll();
      active.anim.sample(Infinity, scratch.positions, scratch.quaternions);
      complete(active, performance.now());
    };

    const frame = () => {
      const now = performance.now();
      const active = animRef.current;
      if (active) {
        const t = (now - active.start) / 1000;
        const { scale, done } = active.anim.sample(t, scratch.positions, scratch.quaternions);
        applyPoses(scratch.positions, scratch.quaternions, scale);
        if (!active.settlingSent && t >= active.anim.settleAt) {
          active.settlingSent = true;
          rollStore.markSettling(active.anim.rollId);
        }
        if (done) complete(active, now);
        else invalidate();
      }
      const glowStart = glowStartRef.current;
      if (glowStart !== null) {
        const g = (now - glowStart) / 1000 / GLOW_SECONDS;
        if (g >= 1) {
          glowStartRef.current = null;
          resources.setGlow(0);
        } else {
          resources.setGlow(Math.sin(Math.PI * g) * GLOW_PEAK);
        }
        invalidate();
      }
    };

    const syncWithStore = () => {
      const state = rollStore.getState();
      const active = animRef.current;
      if (state.activeRoll && state.activeRoll.id !== handledRollRef.current) {
        if (active) finishNow();
        start(state.activeRoll);
      } else if (!state.activeRoll && active) {
        // The store finished this roll without us (watchdog recovery).
        finishNow();
      }
    };

    const relayout = (next: TrayDims) => {
      dimsRef.current = next;
      if (animRef.current) return;
      restRef.current = fitPosesToTray(restRef.current!, next);
      applyRest();
      updateRings();
    };

    return { applyRest, updateRings, frame, syncWithStore, finishNow, relayout };
  }, [invalidate, resources, scratch, shadowMaterials]);

  useEffect(() => {
    reducedRef.current = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    if (dims !== dimsRef.current) controller.relayout(dims);
  }, [dims, controller]);

  useLayoutEffect(() => {
    controller.applyRest();
    controller.updateRings();
    controller.syncWithStore();
    const unsubscribeRoll = rollStore.subscribe(controller.syncWithStore);
    const unsubscribeUi = uiStore.subscribe(controller.updateRings);
    const onVisibility = () => {
      // Hidden tabs get no animation frames; finish on the recorded result
      // rather than replaying a stale tumble when the user returns.
      if (document.hidden) controller.finishNow();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      unsubscribeRoll();
      unsubscribeUi();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [controller]);

  useEffect(
    () => () => {
      resources.dispose();
      for (const m of shadowMaterials) m.dispose();
    },
    [resources, shadowMaterials],
  );

  useFrame(controller.frame);

  return (
    <group>
      {Array.from({ length: 6 }, (_, i) => (
        <group key={i}>
          <group ref={(el) => void (dieRefs.current[i] = el)}>
            <mesh geometry={resources.bodyGeometry} material={resources.bodyMaterial} castShadow receiveShadow />
            <mesh geometry={resources.faceGeometry} material={resources.faceMaterial} receiveShadow />
          </group>
          <mesh
            ref={(el) => void (shadowRefs.current[i] = el)}
            geometry={resources.shadowGeometry}
            material={shadowMaterials[i]}
            renderOrder={1}
          />
          <mesh
            ref={(el) => void (ringRefs.current[i] = el)}
            geometry={resources.ringGeometry}
            material={resources.ringMaterial}
            visible={false}
            renderOrder={2}
          />
        </group>
      ))}
    </group>
  );
}
