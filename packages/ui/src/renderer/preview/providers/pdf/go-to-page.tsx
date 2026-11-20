/**
 * Go to Page (074 FR-062b, maintainer's request 2026-11-19) — the PDF preview's modal, opened by `preview.goToHeading`'s
 * chord (Ctrl+G) and the menus' Go to Page….
 *
 * It names the page the reader is on and how many there are ("Page 3 of 120", digit-grouped), and its field takes
 * only a page that exists: `isPageInput` (core) refuses any keystroke that would leave anything else. Enter goes,
 * Escape or a press on the scrim dismisses; either way focus returns to the pages (`onDismiss`). The field is seeded
 * with nothing, so typing a number and pressing Enter is the whole gesture.
 *
 * The card is the app's shared dialog surface (`.picker`, as Go to Line uses), so the two navigation modals look alike.
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react';
import { formatGrouped, isPageInput, resolveGotoPage } from '@throng/core';
import { useFocusTrap } from '../../../common/focus-trap.js';

export interface GoToPageProps {
  panelId: string;
  current: number;
  pageCount: number;
  /** Go to page `page` (1-based, within the document); the modal closes after. */
  onGo(page: number): void;
  onDismiss(): void;
  /** Where focus goes once the modal has gone, gone either way (the pages). */
  returnFocus(): void;
}

export function GoToPage({ panelId, current, pageCount, onGo, onDismiss, returnFocus }: GoToPageProps): ReactElement {
  const [value, setValue] = useState('');
  // Declared before the focus return below: React runs unmount cleanups in declaration order, so the trap's guard is
  // gone before focus leaves — otherwise it would pull focus straight back into a closing dialog (as `goto-line.tsx`).
  const trap = useFocusTrap<HTMLDivElement>(true);
  const returnTo = useRef(returnFocus);
  returnTo.current = returnFocus;
  useEffect(() => () => returnTo.current(), []);

  const onKeyDown = (event: ReactKeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const page = resolveGotoPage(value, pageCount);
      if (page === null) return; // nothing typed: nothing to go to, and the modal stays
      onGo(page);
      onDismiss();
      return;
    }
    trap.onKeyDown(event);
  };

  const status = `Page ${formatGrouped(current)} of ${formatGrouped(pageCount)}`;
  return (
    <div
      className="modal-overlay modal-overlay--transient"
      data-testid={`pdf-goto-overlay-${panelId}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div
        className="picker preview-pdf-goto"
        data-testid={`pdf-goto-${panelId}`}
        role="dialog"
        aria-modal="true"
        aria-label="Go to Page"
        tabIndex={-1}
        ref={trap.ref}
        onKeyDown={onKeyDown}
      >
        <input
          className="picker__input"
          data-testid={`pdf-goto-input-${panelId}`}
          // `text` with a numeric keypad, not `number`: the field's own rule (`isPageInput`) decides what it holds.
          type="text"
          inputMode="numeric"
          autoFocus
          value={value}
          placeholder={`Page number, 1 – ${formatGrouped(pageCount)}…`}
          aria-label="Go to Page"
          aria-describedby={`pdf-goto-status-${panelId}`}
          onChange={(event) => {
            if (isPageInput(event.target.value, pageCount)) setValue(event.target.value);
          }}
        />
        <div className="preview-pdf-goto__status" id={`pdf-goto-status-${panelId}`} data-testid={`pdf-goto-status-${panelId}`}>
          {status}
        </div>
      </div>
    </div>
  );
}
