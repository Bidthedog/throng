/**
 * Back and Forward at the top left of an editor's or a preview's title bar (044 T148, FR-104;
 * contracts/menus-and-controls.md §6).
 *
 * - Drawn on every editor and preview, DISABLED at the ends of the mirrored history — never hidden, so the
 *   header does not shift as the history grows. Enabled state is `canGoBack` / `canGoForward` over
 *   `history-store`, the same value the header menu's rows read (FR-111).
 * - Themeable icon controls (Principle VI): `IconButton` with the `navigateBack` / `navigateForward` tokens,
 *   named *Back* / *Forward*, and titled with the live binding's token as stored (`Back (Alt+ArrowLeft)`),
 *   the form every other binding is shown in.
 * - A press stops `pointerdown` from reaching the header, which is the dnd-kit drag handle
 *   (`tab-group.tsx`, 4 px activation): clicking Back must not start moving the panel.
 *
 * What a press DOES is the caller's: the header hands in the same `navigatePanelHistory` its menu rows run.
 */
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import { canGoBack, canGoForward, firstBinding } from '@throng/core';
import { IconButton } from '../common/icon-button.js';
import { useKeybindings } from '../config/config-store.js';
import { usePanelHistory } from './history-store.js';

export interface BackForwardButtonsProps {
  panelId: string;
  onBack: () => void;
  onForward: () => void;
}

const stopDrag = (e: ReactPointerEvent): void => {
  e.stopPropagation();
};

/** `Back (Alt+ArrowLeft)`, or `Back` alone when the command is unbound. */
function titled(label: string, chord: string | undefined): string {
  return chord ? `${label} (${chord})` : label;
}

export function BackForwardButtons({ panelId, onBack, onForward }: BackForwardButtonsProps): ReactElement {
  const history = usePanelHistory(panelId);
  const keybindings = useKeybindings();
  return (
    <span className="panel-box__history" data-testid={`panel-history-${panelId}`}>
      {/* `className=""` for the reason the header's Add button gives: `icon-button` is a preferences-window
          class, and `.panel-box__history button` styles these by element. */}
      <IconButton
        token="navigateBack"
        title={titled('Back', firstBinding(keybindings, 'navigate.back'))}
        ariaLabel="Back"
        className=""
        testId={`panel-back-${panelId}`}
        disabled={history === undefined || !canGoBack(history)}
        onPointerDown={stopDrag}
        onClick={() => onBack()}
      />
      <IconButton
        token="navigateForward"
        title={titled('Forward', firstBinding(keybindings, 'navigate.forward'))}
        ariaLabel="Forward"
        className=""
        testId={`panel-forward-${panelId}`}
        disabled={history === undefined || !canGoForward(history)}
        onPointerDown={stopDrag}
        onClick={() => onForward()}
      />
    </span>
  );
}
