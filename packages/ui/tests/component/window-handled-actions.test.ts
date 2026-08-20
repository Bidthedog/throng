import { describe, expect, it } from 'vitest';
import { WINDOW_HANDLED_ACTIONS } from '../../src/renderer/app.js';

/**
 * Which actions the WINDOW owns, and which are left to whatever has focus.
 *
 * MIGRATED FROM `packages/ui/tests/e2e/fileop-undo.e2e.ts:117` — *"undo works from anywhere in the
 * pane, not only with a row focused"* (035 T055).
 *
 * ══ THE DEFECT, WHICH IS EASY TO MISREAD AS A DETAIL ══
 *
 * Rename a file through the context menu and dismiss the menu with the mouse, and DOM focus is left
 * on the pane rather than on a tree row. If `file.undo` were scoped to the tree, `Ctrl+Z` would then
 * go to whatever widget happened to hold focus — and the user's rename would simply stand, with the
 * keystroke apparently doing nothing. The E2E reached that state by driving the real menu.
 *
 * The rule underneath it is membership of one set: actions in `WINDOW_HANDLED_ACTIONS` are
 * intercepted in the CAPTURE phase at the window, so they fire wherever focus is. That set was a
 * `const` inside a `useEffect` until this migration, which is why the only way to ask the question
 * was to launch the application.
 *
 * ══ WHAT THIS DOES NOT CLAIM ══
 *
 * That the undo actually reverses the rename on disk. That is the daemon's, and
 * `fileop-undo.e2e.ts` keeps the tests that assert `existsSync` on both ends of a real rename and a
 * real move.
 */
describe('the actions the window intercepts', () => {
  it('owns file.undo and file.redo, which is what makes undo work from anywhere in the pane', () => {
    expect(WINDOW_HANDLED_ACTIONS.has('file.undo')).toBe(true);
    expect(WINDOW_HANDLED_ACTIONS.has('file.redo')).toBe(true);
  });

  it('does NOT own editor.save — Ctrl+S belongs to the focused editor', () => {
    /*
     * The other half, and the reason this is a set rather than a rule of thumb. A handler that
     * intercepted everything would satisfy the assertion above while swallowing the chords the
     * focused widget needs — and the comment in `app.tsx` names exactly this pair as the example.
     */
    expect(WINDOW_HANDLED_ACTIONS.has('editor.save')).toBe(false);
  });

  it('does not own the explorer’s other file actions either', () => {
    /*
     * `file.undo` and `file.redo` are the exception among `file.*`, not the pattern. Cut, copy,
     * paste, rename and delete act on the tree's SELECTION and belong to the tree — intercepting
     * them at the window would take `Ctrl+C` away from a focused terminal, which is the failure the
     * capture-phase list is deliberately narrow to avoid.
     */
    for (const action of ['file.cut', 'file.copy', 'file.paste', 'file.rename', 'file.delete']) {
      expect(WINDOW_HANDLED_ACTIONS.has(action), `${action} must be left to the focused widget`)
        .toBe(false);
    }
  });

  it('is a non-trivial set, so the absences above are not absences from nothing', () => {
    // Every "does not own" assertion passes against an empty set. This is what stops them being
    // satisfied by a set that was emptied or renamed.
    expect(WINDOW_HANDLED_ACTIONS.size).toBeGreaterThan(10);
  });

  it('owns the window-level chords a focused widget must never swallow', () => {
    // A spot-check across the categories, so a wholesale replacement of the set fails here rather
    // than only on the two file actions this migration was about.
    for (const action of ['zoom.in', 'focus.left', 'view.fullscreen', 'menu.open', 'panel.rename']) {
      expect(WINDOW_HANDLED_ACTIONS.has(action), `${action} must be handled at the window`).toBe(
        true,
      );
    }
  });
});
