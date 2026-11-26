/**
 * F1 (`help.open`) in a window that does not mount the window dispatcher (080 FR-010, US2 AC3):
 * the preferences window, the Resource Monitor and About.
 *
 * The main window and every sub-workspace window get the chord from `keybindings/window-dispatcher.tsx`.
 * These three have no workspace and no dispatcher, so this is the same decision made the same way —
 * the user's LIVE bindings (`useKeybindings`), core's resolver (`resolveAction`), the dispatcher's own
 * key normalisation (`resolveKeydown`) — over the one opener. A window without a terminal has no scope
 * that withholds the key, so it is resolved in the `explorer` scope, the fallback `currentScope` uses
 * when no panel is active (`help.open` is live in every scope but `terminal`).
 */
import { useEffect, useRef } from 'react';
import { resolveAction, startPageUrl } from '@throng/core';
import { resolveKeydown, windowProducedEvent } from '../config/chord-key.js';
import { useKeybindings } from '../config/config-store.js';
import { effectiveHelpBase, openHelp } from './help-opener.js';

export function useHelpKey(): void {
  const keybindings = useKeybindings();
  // Read through a ref so a rebind does not depend on the listener being re-subscribed in time.
  const live = useRef(keybindings);
  live.current = keybindings;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Someone already took the key: the Key Bindings chord-capture box listens at the window in the
      // capture phase and consumes every key, F1 included — a user binding F1 to something must not
      // also be sent to the browser.
      if (e.defaultPrevented) return;
      const action = resolveKeydown(e, (ev) => resolveAction(live.current, ev, 'explorer'), windowProducedEvent(e));
      if (action !== 'help.open') return;
      e.preventDefault();
      openHelp(startPageUrl(effectiveHelpBase()));
    };
    // BUBBLE phase on purpose (the dispatcher is capture, to beat a terminal; these windows have none):
    // a consumer that stops the key on its way down, as the capture box does, is never overridden.
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
