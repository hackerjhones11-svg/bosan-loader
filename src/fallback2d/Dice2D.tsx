import { useEffect, useRef, useState } from 'react';
import { rollStore, uiStore, useRollState, useUi } from '../app/appState';
import { soundEngine } from '../audio/soundEngine';
import type { RollRecord } from '../game/roll';
import { hasShownResult } from '../game/rollStore';
import { ROLL_TIMING } from '../game/rollTiming';
import { SYMBOL_IDS, type SymbolId } from '../game/symbols';
import { SymbolIcon } from '../components/SymbolIcon';
import { visualRandom } from '../dice3d/visualRandom';

const FLICKER_MS = 90;

/**
 * 2D fallback when WebGL is unavailable (or `?renderer=2d`). Same store and
 * fair engine, same rhythm as the 3D tray (ROLL_TIMING): cards jostle and
 * flicker while the "box" is shaken, then stop one by one on their recorded
 * faces as the shake dies away. The flicker is cosmetic (visualRandom); the
 * stops always show `roll.faces`.
 */
export function Dice2D({ reducedMotion, notice }: { reducedMotion: boolean; notice: string | null }) {
  const [faces, setFaces] = useState<SymbolId[]>(() => [...(rollStore.getState().lastResult?.faces ?? SYMBOL_IDS)]);
  const [tumbling, setTumbling] = useState<boolean[]>(() => Array(6).fill(false));
  const hovered = useUi((s) => s.hoveredSymbol);
  const showRings = useRollState(hasShownResult);
  const reducedRef = useRef(reducedMotion);
  useEffect(() => {
    reducedRef.current = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    let timers: ReturnType<typeof setTimeout>[] = [];
    let ticker: ReturnType<typeof setInterval> | null = null;
    let active: RollRecord | null = null;
    let handled: string | null = null;

    const clearAll = () => {
      timers.forEach(clearTimeout);
      timers = [];
      if (ticker !== null) clearInterval(ticker);
      ticker = null;
    };

    const finish = (roll: RollRecord) => {
      clearAll();
      active = null;
      setFaces([...roll.faces]);
      setTumbling(Array(6).fill(false));
      soundEngine.endRoll();
      rollStore.markSettling(roll.id);
      if (rollStore.completeRoll(roll.id)) soundEngine.playReveal();
    };

    const start = (roll: RollRecord) => {
      handled = roll.id;
      active = roll;
      clearAll();
      const ms = (s: number) => Math.round(s * 1000);
      if (reducedRef.current) {
        timers.push(setTimeout(() => finish(roll), ms(ROLL_TIMING.reducedOut + ROLL_TIMING.reducedIn)));
        return;
      }
      soundEngine.beginRoll();
      const stopped = Array(6).fill(false);
      const began = performance.now();
      setTumbling(Array(6).fill(true));
      // Stops are spread across the coast and settle window, in a random order.
      const order = [0, 1, 2, 3, 4, 5].sort(() => visualRandom() - 0.5);
      const span = ROLL_TIMING.settleAssistFrom + 0.45 - (ROLL_TIMING.shakeEnd + 0.2);
      const stopAt = (rank: number) => ROLL_TIMING.shakeEnd + 0.2 + (span * rank) / 5;

      ticker = setInterval(() => {
        const t = (performance.now() - began) / 1000;
        const vigour = t < ROLL_TIMING.buildUp ? t / ROLL_TIMING.buildUp : t < ROLL_TIMING.shakeEnd ? 1 : 0.35;
        const moving = stopped.filter((s) => !s).length / 6;
        soundEngine.setActivity(vigour * moving, vigour * moving * 0.8);
        if (visualRandom() < 0.35 * vigour * moving) {
          const die = Math.floor(visualRandom() * 6);
          soundEngine.impact(0, 3 + visualRandom() * 6, visualRandom() < 0.6 ? 'die' : 'wall', die);
        }
        setFaces((prev) => prev.map((f, i) => (stopped[i] ? f : SYMBOL_IDS[Math.floor(visualRandom() * 6)])));
      }, FLICKER_MS);

      order.forEach((die, rank) => {
        timers.push(
          setTimeout(() => {
            stopped[die] = true;
            soundEngine.impact(0, 5 - rank * 0.5, 'felt', die);
            setFaces((prev) => prev.map((f, j) => (j === die ? roll.faces[die] : f)));
            setTumbling((prev) => prev.map((v, j) => (j === die ? false : v)));
          }, ms(stopAt(rank))),
        );
      });
      timers.push(setTimeout(() => rollStore.markSettling(roll.id), ms(ROLL_TIMING.shakeEnd)));
      timers.push(setTimeout(() => finish(roll), ms(stopAt(5) + 0.18)));
    };

    const sync = () => {
      const state = rollStore.getState();
      if (state.activeRoll && state.activeRoll.id !== handled) start(state.activeRoll);
      else if (!state.activeRoll && active) finish(active);
    };
    const onVisibility = () => {
      if (document.hidden && active) {
        soundEngine.stopAll();
        finish(active);
      }
    };

    sync();
    const unsubscribe = rollStore.subscribe(sync);
    document.addEventListener('visibilitychange', onVisibility);
    uiStore.set({ rendererReady: true, renderer: '2d' });
    return () => {
      unsubscribe();
      clearAll();
      soundEngine.stopAll();
      document.removeEventListener('visibilitychange', onVisibility);
      uiStore.set({ rendererReady: false, renderer: null });
    };
  }, []);

  return (
    <div className="stage2d">
      {notice && <p className="stage-notice">{notice}</p>}
      <div className="felt2d">
        <ul className="dice2d">
          {faces.map((face, i) => (
            <li
              key={i}
              data-symbol={face}
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
