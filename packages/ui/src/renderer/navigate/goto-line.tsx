/**
 * Go To Line (033 US2, #219) — the modal, and the jump it performs.
 *
 * `contracts/navigation-modals.md §5`. The pure half is `resolveGotoLine` in
 * `@throng/core`: it owns every decision about what the typed text MEANS, including all of the
 * clamping. Nothing here re-decides any of it, and that is the requirement rather than a preference —
 * a second clamp in the renderer is a second place for "0 means the first line" to be wrong, and the
 * one in core is the one with fifteen unit tests behind it.
 *
 * ══ FOCUS RETURNS BY NAME, NOT BY MEMORY (FR-072, FR-026, G7, R10) ══
 *
 * The shipped `Picker` restores focus to whatever `document.activeElement` was when it rendered, and
 * that is right for a picker. It would be WRONG here. A user may have a find bar open in this editor,
 * and if that bar held the caret, restoring the captured element would hand focus back to it — a
 * modal whose dismissal silently leaves the user typing into a search box they had finished with, and
 * a quiet violation of FR-026's "focus returns to the EDITOR, not to the find bar".
 *
 * So this file never reads `activeElement`. It names its destination: `getEditorView(panelId)`, the
 * view this modal was opened over, focused explicitly on the way out — confirmed or cancelled alike.
 *
 * ══ WHAT THIS FILE MAY NOT TOUCH ══
 *
 *  - **`search/search-store.ts`** (S4). A find bar closes when its user closes it or its editor
 *    closes, and by no other route (FR-026a). Importing the store to "tidy up" is exactly the
 *    coupling that requirement forbids; a find session is state the user built, and jumping to a
 *    line is not a reason to discard it.
 *  - **the active panel** (S5). Changing it is what would make `closeFindIfNotOn` close a find bar as
 *    a side effect — the same defect arriving by a longer road. This modal is opened over the panel
 *    that is already active and leaves that fact alone.
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react';
import { resolveGotoLine } from '@throng/core';
import { EditorSelection } from '@codemirror/state';
import { useFocusTrap } from '../common/focus-trap.js';
import { getEditorView } from '../editor/editor-views.js';
import { navigationModal } from './navigation-store.js';

export function GotoLine({
  panelId,
  onDismiss,
}: {
  /** The editor panel the chord was pressed in. The modal acts on this view and no other. */
  panelId: string;
  onDismiss: () => void;
}): ReactElement {
  const [value, setValue] = useState('');

  /*
   * Declared FIRST, exactly as `picker.tsx` declares it first, and for the same mechanical reason.
   *
   * React runs unmount cleanups in the order their effects were declared. The trap installs a
   * `focusin` guard that hauls focus back inside the dialog; focusing the editor (below) while that
   * guard was still live would be undone the instant it happened.
   */
  const trap = useFocusTrap<HTMLDivElement>(true);

  /*
   * The return of focus, as an unmount cleanup — ONE path for confirm and cancel alike (G7).
   *
   * Doing it inline in the two handlers would run it while this component is still mounted and the
   * trap is still installed, so the guard would pull the caret straight back into a dialog that is
   * about to disappear. Doing it here runs it after the trap has been torn down.
   *
   * `getEditorView` is a lookup, not a captured reference: by the time this runs the panel may have
   * been destroyed (a tab closed under the modal), and `undefined` then means "there is nothing to
   * focus", which is the correct outcome rather than an error.
   */
  useEffect(() => {
    return () => {
      /*
       * …but ONLY when this modal is genuinely going away (FR-071).
       *
       * Unmounting because the slot was handed to Quick Open looks identical from in here, and the
       * restore would then fire a frame after the new modal took the caret — leaving Quick Open on
       * screen with the keyboard in the document behind it, so the first thing the user typed went
       * into their file. Measured: `Ctrl+G` then `Ctrl+Shift+T` left `quickopen-input` inactive.
       *
       * The store is read rather than the registry, because `setNavigationModal` has already run by
       * now (it happens in the keydown handler, long before React commits) whereas the registry's
       * release is itself an effect cleanup racing this one.
       */
      if (navigationModal() !== null) return;
      getEditorView(panelId)?.focus();
    };
  }, [panelId]);

  // Read through a ref so the confirm handler is not re-created per keystroke.
  const raw = useRef(value);
  raw.current = value;

  const confirm = (): void => {
    const view = getEditorView(panelId);
    if (view) {
      /*
       * `doc.lines` is the LOGICAL line count, and `doc.line(n)` the same logical line the
       * `lineNumbers()` gutter draws — which is what makes G2 hold under word wrap without this file
       * knowing anything about wrapping. A wrapped line is several visual rows and one entry here.
       */
      const line = resolveGotoLine(raw.current, view.state.doc.lines);
      // `null` is "the input names no line" (empty, whitespace, non-numeric). Nothing moves, and no
      // notice is raised — G4. Out-of-range input never reaches this branch: core clamps it.
      if (line !== null) {
        const target = view.state.doc.line(line);
        view.dispatch({
          // FR-021 — the caret at the line's FIRST COLUMN, not at the column it happened to be in.
          selection: EditorSelection.cursor(target.from),
          scrollIntoView: true,
          // Not an edit, so it must not join an undo run; a selection-only transaction has no
          // document change to coalesce, and naming the event keeps it that way if one is added.
          userEvent: 'select',
        });
      }
    }
    onDismiss();
  };

  const onKeyDown = (event: ReactKeyboardEvent): void => {
    // Claimed from anywhere inside the modal, and stopped: Escape is `search.close`'s chord too, and
    // a dismissal that also closed the find bar underneath would be FR-026a's exact failure.
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      confirm();
      return;
    }
    trap.onKeyDown(event);
  };

  return (
    <div
      className="modal-overlay"
      data-testid="gotoline-overlay"
      // `mousedown`, not `click`: a press that STARTED in the field and finished on the scrim (a
      // drag-select across the input) is not a dismissal, and `click` cannot tell them apart.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      {/*
        The app's shipped dialog card (S3). `.picker` is the general modal surface `quick-open.tsx`
        already presents through — reused rather than copied so the two navigation modals cannot
        drift apart visually, and so this feature adds no CSS of its own to keep in step.
      */}
      <div
        className="picker"
        data-testid="gotoline"
        role="dialog"
        aria-modal="true"
        aria-label="Go To Line"
        tabIndex={-1}
        ref={trap.ref}
        onKeyDown={onKeyDown}
      >
        <input
          className="picker__input"
          data-testid="gotoline-input"
          type="text"
          // `text`, not `number`. A number input silently swallows what it dislikes, so a
          // non-numeric value would never reach `resolveGotoLine` — and G4's "nothing moves" would be
          // enforced by the browser rather than by the rule, in a way no test could distinguish from
          // the rule working. It also hides its own value from `inputValue()` when invalid.
          inputMode="numeric"
          autoFocus
          value={value}
          placeholder="Line number…"
          aria-label="Go To Line"
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
    </div>
  );
}
