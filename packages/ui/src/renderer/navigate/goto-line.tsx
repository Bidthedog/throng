/**
 * Go To Line (033 US2, #219) — the editor's use of the shared Go to dialog (073 FR-043b), and the jump it performs.
 *
 * The modal itself is `go-to-dialog.tsx`, shared with the grids' Go to Row and the PDF preview's Go to Page: it
 * names "Line <caret line> of <lines>" and its field takes only a line that exists, so — superseding 033
 * FR-022 and FR-023 for typed input — a number past the end or a non-number can no longer be typed and there is
 * nothing to clamp. What stays here is what is the EDITOR's: the view it acts on, the remembered number (033
 * FR-057 – FR-061) and the move itself.
 *
 * ══ THE REMEMBERED SEED ══
 *
 * `resolveGotoLine` (core) still owns the seed's clamping: a number remembered from a longer document is brought
 * to this document's last line before it is offered. It is the one place a number is clamped, and the dialog's
 * rule never has to disagree with it, because the clamped seed is always a line that exists.
 *
 * ══ FOCUS RETURNS BY NAME, NOT BY MEMORY (FR-072, FR-026, G7, R10) ══
 *
 * The dialog's default — restore focus to whatever held it when it opened — would be WRONG here. A user may have
 * a find bar open in this editor, and restoring the captured element would hand focus back to it: a modal whose
 * dismissal silently leaves the user typing into a search box they had finished with, and a quiet violation of
 * FR-026's "focus returns to the EDITOR, not to the find bar". So this file names its destination:
 * `getEditorView(panelId)`, the view this modal was opened over, focused on the way out — confirmed or cancelled.
 *
 * ══ WHAT THIS FILE MAY NOT TOUCH ══
 *
 *  - **`search/search-store.ts`** (S4). A find bar closes when its user closes it or its editor closes, and by no
 *    other route (FR-026a); a find session is state the user built, and jumping to a line is not a reason to
 *    discard it.
 *  - **the active panel** (S5). Changing it is what would make `followActivePanel` hide a find bar as a side
 *    effect. This modal is opened over the panel that is already active and leaves that fact alone.
 */
import type { ReactElement } from 'react';
import { resolveGotoLine } from '@throng/core';
import { EditorSelection } from '@codemirror/state';
import { useAppSettings } from '../config/config-store.js';
import { getEditorView } from '../editor/editor-views.js';
import { GoToDialog } from './go-to-dialog.js';
import { navigationModal, rememberGotoLineNumber, rememberedInput } from './navigation-store.js';

export function GotoLine({
  panelId,
  onDismiss,
}: {
  /** The editor panel the chord was pressed in. The modal acts on this view and no other. */
  panelId: string;
  onDismiss: () => void;
}): ReactElement {
  // FR-058 — read LIVE, so a toggle takes effect at the next invocation. This component mounts once per
  // invocation, so there is nothing to notify and nothing that can go stale.
  const remember = useAppSettings().editor.navigation.rememberGotoLineNumber;

  // Read once at mount: where the caret is and how long the document is are what the status line names. `doc.lines`
  // is the LOGICAL line count, the same lines the gutter numbers, which is what makes this hold under word wrap.
  const view = getEditorView(panelId);
  const lines = Math.max(1, view?.state.doc.lines ?? 1);
  const caretLine = view ? view.state.doc.lineAt(view.state.selection.main.head).number : 1;

  // FR-057 / FR-060 — the remembered number, clamped into THIS document (033 FR-057 – FR-061), selected on focus.
  const held = rememberedInput().gotoLineNumber;
  const seed = remember && held !== null ? (resolveGotoLine(String(held), lines) ?? undefined) : undefined;

  const go = (line: number): void => {
    const target = getEditorView(panelId);
    if (!target) return;
    // FR-061 — the number is ACCEPTED: the caret is about to move. What is recorded is the line gone to.
    if (remember) rememberGotoLineNumber(line);
    target.dispatch({
      // FR-021 — the caret at the line's FIRST COLUMN, not at the column it happened to be in.
      selection: EditorSelection.cursor(target.state.doc.line(line).from),
      scrollIntoView: true,
      // Not an edit, so it must not join an undo run.
      userEvent: 'select',
    });
  };

  return (
    <GoToDialog
      unit="Line"
      label="Go To Line"
      current={caretLine}
      count={lines}
      {...(seed !== undefined ? { seed } : {})}
      onGo={go}
      onDismiss={onDismiss}
      returnFocus={() => {
        // …but ONLY when this modal is genuinely going away (FR-071). Unmounting because the slot was handed to
        // Quick Open looks identical from in here, and the restore would then fire a frame after the new modal
        // took the caret — leaving Quick Open on screen with the keyboard in the document behind it. The store is
        // read rather than the registry, because `setNavigationModal` has already run by now.
        if (navigationModal() !== null) return;
        getEditorView(panelId)?.focus();
      }}
      testIdPrefix="gotoline"
      testIds={{ dialog: 'gotoline', overlay: 'gotoline-overlay', input: 'gotoline-input', status: 'gotoline-status' }}
    />
  );
}
