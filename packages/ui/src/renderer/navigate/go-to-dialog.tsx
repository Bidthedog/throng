/**
 * The shared Go to dialog (073 FR-043b): the one modal behind the editor's Go to Line, the grids' Go to Row and
 * the PDF preview's Go to Page.
 *
 * It names where the reader is and how far it goes ("Row 3 of 1,200", digit-grouped — constitution 4.5.0), and
 * its field takes only a whole number from 1 to the count: `isGotoInput` (core) refuses any edit that would leave
 * anything else, so there is nothing to clamp and nothing to report. Enter goes and closes; with nothing typed it
 * stays. Escape, or a press on the scrim, closes. The card is the app's shared dialog surface (`.picker`).
 *
 * ══ FOCUS RETURNS BY NAME, AS AN UNMOUNT CLEANUP ══
 *
 * The caller says where focus goes (`returnFocus`) — an editor view, the grid — and it runs once the dialog is
 * gone, confirmed or dismissed alike. Two ordering facts make that work, both inherited from Go to Line:
 *
 *  - the focus trap is declared FIRST. React runs unmount cleanups in declaration order, and the trap's `focusin`
 *    guard hauls focus back into the dialog; focusing anything while it is still live would be undone at once.
 *  - the return is a cleanup rather than a line in the handlers, for the same reason: in a handler the dialog is
 *    still mounted and the guard still installed.
 *
 * With no `returnFocus` the dialog restores focus to the element that held it when it opened (the picker idiom).
 *
 * The seed (Go to Line's remembered number, 033 FR-057 – FR-061) arrives selected, so typing replaces it; a seed
 * that is not a position of this document is dropped rather than clamped here — the caller clamps what it wants.
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { dialogHost } from '../common/dialog-host.js';
import { formatGrouped, isGotoInput, resolveGotoNumber } from '@throng/core';
import { useFocusTrap } from '../common/focus-trap.js';
import './go-to-dialog.css';

export interface GoToDialogProps {
  /** What is counted: `Row`, `Line`, `Page`. Names the status and the default accessible name. */
  unit: string;
  /** The position the reader is on now (1-based). */
  current: number;
  /** How many positions there are; the field accepts 1 to this. */
  count: number;
  /** Selected on first focus, so typing replaces it. Ignored unless it is a position of this document. */
  seed?: number;
  /** Go to `n` (1-based, within 1..count). The dialog closes after, through `onDismiss`. */
  onGo(n: number): void;
  onDismiss(): void;
  /** Where focus goes once the dialog has gone. Absent: back to what held it when it opened. */
  returnFocus?(): void;
  /** The accessible name. Default `Go to <unit>`. */
  label?: string;
  /** Prefix of every test id: `<prefix>`, `<prefix>-overlay`, `<prefix>-input`, `<prefix>-status`. */
  testIdPrefix: string;
}

export function GoToDialog({
  unit,
  current,
  count,
  seed,
  onGo,
  onDismiss,
  returnFocus,
  label,
  testIdPrefix,
}: GoToDialogProps): ReactElement {
  // The seed is the field's starting text only: read once, never pushed back over what the user has typed. A
  // plain `String`, not `formatGrouped` — this is an editable value the field's own rule must accept.
  const [value, setValue] = useState(() => (seed !== undefined && isGotoInput(String(seed), count) ? String(seed) : ''));
  const selected = useRef(false);

  // Declared before the focus return below (see the file comment).
  const trap = useFocusTrap<HTMLDivElement>(true);
  const returnTo = useRef(returnFocus);
  returnTo.current = returnFocus;
  const openedOver = useRef<Element | null>(null);
  if (openedOver.current === null && typeof document !== 'undefined') openedOver.current = document.activeElement;
  useEffect(
    () => () => {
      if (returnTo.current) returnTo.current();
      else if (openedOver.current instanceof HTMLElement) openedOver.current.focus();
    },
    [],
  );

  const valueRef = useRef(value);
  valueRef.current = value;

  const onKeyDown = (event: ReactKeyboardEvent): void => {
    // Claimed from anywhere inside, and stopped: Escape is also the find bar's chord, and a dismissal that closed
    // something underneath would be a second effect of one keystroke.
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const n = resolveGotoNumber(valueRef.current, count);
      if (n === null) return; // nothing typed: nothing to go to, and the dialog stays
      onGo(n);
      onDismiss();
      return;
    }
    trap.onKeyDown(event);
  };

  const name = label ?? `Go to ${unit}`;
  const statusId = `${testIdPrefix}-status`;
  const ids = { dialog: testIdPrefix, overlay: `${testIdPrefix}-overlay`, input: `${testIdPrefix}-input`, status: statusId };

  // Drawn at the document's top level: a panel is its own stacking context (`.panel-box { isolation: isolate }`), so a
  // dialog inside one is painted over by the panels after it (MT-102 walk-through, 2026-11-21). React events still
  // bubble through the component tree, so the caller's key handling is unchanged.
  return createPortal(
    <div
      // `--transient`: the scrim comes from the overlay registry, so handing off to or from another overlay cannot
      // leave a frame with none (see picker.tsx).
      className="modal-overlay modal-overlay--transient"
      data-testid={ids.overlay}
      // `mousedown`, not `click`: a drag that started in the field and ended on the scrim is not a dismissal.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div
        className="picker go-to-dialog"
        data-testid={ids.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        tabIndex={-1}
        ref={trap.ref}
        onKeyDown={onKeyDown}
      >
        <input
          className="picker__input"
          data-testid={ids.input}
          // `text` with a numeric keypad, not `number`: the field's own rule decides what it holds, and a number
          // input would swallow what it dislikes in a way no test could tell from the rule working.
          type="text"
          inputMode="numeric"
          autoFocus
          value={value}
          placeholder={`${unit} number, 1 – ${formatGrouped(count)}…`}
          aria-label={name}
          aria-describedby={statusId}
          onFocus={(event) => {
            if (value === '' || selected.current) return;
            selected.current = true;
            event.target.select();
          }}
          onChange={(event) => {
            if (isGotoInput(event.target.value, count)) setValue(event.target.value);
          }}
        />
        <div className="go-to-dialog__status" id={statusId} data-testid={ids.status}>
          {`${unit} ${formatGrouped(current)} of ${formatGrouped(count)}`}
        </div>
      </div>
    </div>,
    dialogHost(),
  );
}
