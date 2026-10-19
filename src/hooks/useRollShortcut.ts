import { useEffect } from 'react';
import { triggerRoll } from '../app/appState';

/**
 * Space / Enter rolls only when focus is "nowhere in particular" (the page
 * body) or on an element explicitly marked as a roll surface. Buttons, inputs,
 * dialogs and other controls keep their native keyboard behaviour, and the
 * roll itself goes through the same busy guard as every other trigger.
 */
export function useRollShortcut(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      if (event.repeat || event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (document.querySelector('dialog[open]')) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const neutral = !target || target === document.body || target === document.documentElement;
      if (!neutral && !target.closest('[data-roll-surface]')) return;
      event.preventDefault();
      triggerRoll();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
