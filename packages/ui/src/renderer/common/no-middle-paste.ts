/**
 * The middle mouse button never pastes (maintainer, 2026-11-20: "Middle mouse should not paste in throng at all").
 *
 * On Linux, Chromium pastes the primary selection (or, where there is none, the clipboard) into the focused editor as
 * the DEFAULT of a middle-button release, delivered as a `paste` event. Spread these capture-phase handlers on an
 * element and nothing inside it takes that paste: the press, release and `auxclick` are cancelled, and a paste arriving
 * within {@link MIDDLE_PASTE_WINDOW_MS} of a middle press or release is dropped before the editor sees it. A key press
 * ends that window, so a Ctrl+V straight after is the reader's own.
 *
 * Ctrl+middle-click (Cmd on macOS, 070 FR-030) is the zoom-reset gesture and is left alone. The grid keeps its own
 * equivalent (`data-grid.tsx`, 073 FR-008f), which also turns the press into a pan.
 */
import { useMemo, useRef, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { primaryModifierHeld } from '../config/host-modifiers.js';

/** A paste this soon after a middle press or release is that click's, not the reader's. */
export const MIDDLE_PASTE_WINDOW_MS = 500;

export interface NoMiddlePasteHandlers {
  onMouseDownCapture(e: MouseEvent<HTMLElement>): void;
  onMouseUpCapture(e: MouseEvent<HTMLElement>): void;
  onAuxClickCapture(e: MouseEvent<HTMLElement>): void;
  onKeyDownCapture(e: KeyboardEvent<HTMLElement>): void;
  onPasteCapture(e: ClipboardEvent<HTMLElement>): void;
}

export function useNoMiddlePaste(): NoMiddlePasteHandlers {
  const lastMiddle = useRef(0);
  return useMemo(() => {
    const swallow = (e: MouseEvent<HTMLElement>): void => {
      if (e.button !== 1 || primaryModifierHeld(e)) return;
      e.preventDefault();
      lastMiddle.current = Date.now();
    };
    return {
      onMouseDownCapture: swallow,
      onMouseUpCapture: swallow,
      onAuxClickCapture: swallow,
      onKeyDownCapture: () => {
        lastMiddle.current = 0;
      },
      onPasteCapture: (e) => {
        if (Date.now() - lastMiddle.current >= MIDDLE_PASTE_WINDOW_MS) return;
        e.preventDefault();
        e.stopPropagation();
      },
    };
  }, []);
}
