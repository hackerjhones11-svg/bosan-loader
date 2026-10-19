import { useEffect, useRef, useState } from 'react';
import { rollStore, uiStore, useRollState, useUi } from '../app/appState';
import { soundEngine } from '../audio/soundEngine';
import type { RollRecord } from '../game/roll';
import { SYMBOL_IDS, type SymbolId } from '../game/symbols';
import { SymbolIcon } from '../components/SymbolIcon';
import { visualRandom } from '../dice3d/visualRandom';

const FLICKER_MS = 85;
const FIRST_STOP_MS = 620;
const STOP_STAGGER_MS = 110;

/**
 * 2D fallback when WebGL is unavailable (or `?renderer=2d`). Uses the same
 * roll store, so outcomes are the same fair crypto draws. The flicker during
 * a roll is cosmetic (visualRandom); each card then stops on its recorded face.
 */
export function Dice2D({ reducedMotion, notice }: { reducedMotion: boolean; notice: string | null }) {
  const [faces, setFaces] = useState<SymbolId[]>(() => [...(rollStore.getState().lastResult?.faces ?? SYMBOL_IDS)]);
  const [tumbling, setTumbling] = useState<boolean[]>(() => Array(6).fill(false));
  const hovered = useUi((s) => s.hoveredSymbol);
  const phase = useRollState((s) => s.phase);
  const reducedRef = useRef(reducedMotion);
  useEffect(() => {
    reducedRef.current = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    let timers: ReturnType<typeof setTimeout>[] = [];
    let flicker: ReturnType<typeof setInterval> | null = null;
    let active: RollRecord | null = null;
    let handled: string | null = null;

    const clearAll = () => {
      timers.forEach(clearTimeout);
      timers = [];
      if (flicker !== null) clearInterval(flicker);
      flicker = null;
    };

    const finish = (roll: RollRecord) => {
      clearAll();
      active = null;
      setFaces([...roll.faces]);
      setTumbling(Array(6).fill(false));
      rollStore.markSettling(roll.id);
      if (rollStore.completeRoll(roll.id)) soundEngine.playSettle();
    };

    const start = (roll: RollRecord) => {
      handled = roll.id;
      active = roll;
      clearAll();
      if (reducedRef.current) {
        timers.push(setTimeout(() => finish(roll), 220));
        return;
      }
      const stopped = Array(6).fill(false);
      setTumbling(Array(6).fill(true));
      soundEngine.playRoll(
        Array.from({ length: 6 }, (_, i) => ({ t: (FIRST_STOP_MS + i * STOP_STAGGER_MS) / 1000, strength: 5, surface: 'felt' as const })),
        0,
        true,
      );
      flicker = setInterval(() => {
        setFaces((prev) => prev.map((f, i) => (stopped[i] ? f : SYMBOL_IDS[Math.floor(visualRandom() * 6)])));
      }, FLICKER_MS);
      for (let i = 0; i < 6; i++) {
        timers.push(
          setTimeout(() => {
            stopped[i] = true;
            setFaces((prev) => prev.map((f, j) => (j === i ? roll.faces[i] : f)));
            setTumbling((prev) => prev.map((v, j) => (j === i ? false : v)));
          }, FIRST_STOP_MS + i * STOP_STAGGER_MS),
        );
      }
      timers.push(setTimeout(() => rollStore.markSettling(roll.id), FIRST_STOP_MS + 2 * STOP_STAGGER_MS));
      timers.push(setTimeout(() => finish(roll), FIRST_STOP_MS + 5 * STOP_STAGGER_MS + 260));
    };

    const sync = () => {
      const state = rollStore.getState();
      if (state.activeRoll && state.activeRoll.id !== handled) start(state.activeRoll);
      else if (!state.activeRoll && active) finish(active);
    };
    const onVisibility = () => {
      if (document.hidden && active) finish(active);
    };

    sync();
    const unsubscribe = rollStore.subscribe(sync);
    document.addEventListener('visibilitychange', onVisibility);
    uiStore.set({ rendererReady: true, renderer: '2d' });
    return () => {
      unsubscribe();
      clearAll();
      document.removeEventListener('visibilitychange', onVisibility);
      uiStore.set({ rendererReady: false, renderer: null });
    };
  }, []);

  const showRings = phase === 'result';

  return (
    <div className="stage2d">
      {notice && <p className="stage-notice">{notice}</p>}
      <div className="felt2d">
        <ul className="dice2d">
          {faces.map((face, i) => (
            <li
              key={i}
              className={`die2d${tumbling[i] ? ' is-tumbling' : ''}${showRings && hovered === face ? ' is-ringed' : ''}`}
              style={{ ['--i' as string]: i }}
            >
              <SymbolIcon id={face} size="100%" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
