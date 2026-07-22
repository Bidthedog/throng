import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { LineEndingId } from '@throng/core';
import type { MenuItem } from '../workspace/context-menu.js';
import { applyPaste, clipboardEntry, cutThrough, ENDINGS } from './commands.js';
import { requestLanguagePicker } from './picker-request.js';

/**
 * The editor's CONTENT context menu (016, FR-012) — right-click inside the document.
 *
 * Distinct from 006's panel-HEADER menu, which is unchanged (FR-014): that one acts on the panel
 * (Save, Revert, Close), this one acts on the text. They are two different objects under the cursor,
 * and collapsing them into one menu would offer Save on a selection and Cut on a tab.
 *
 * Undo and Redo go to the document's AUTHORITY, never to CodeMirror's `undo`/`redo` commands: the
 * local `history()` those operate on was deleted when the undo stack moved to the document, so a
 * menu item bound to them would be a dead no-op that looks perfectly correct in the source
 * (FR-026b). It is the same trap the keymap fell into, one layer up.
 */

const win = (): typeof window.throng | undefined => window.throng;

export interface ContentMenuArgs {
  view: EditorView;
  panelId: string;
  /** THIS view — undo is per document, but the cursors it restores go to the view that asked. */
  viewId: string;
  /** The document's effective ending — what the CLIPBOARD is terminated with (SC-009a). */
  lineEnding: () => LineEndingId;
}

/**
 * Copy or cut, with the caret's WHOLE LINE as the unit when nothing is selected (FR-012b).
 *
 * Never disabled for want of a selection, and never a silent no-op: right-clicking in a line and
 * choosing Copy copies that line — which is what the user plainly meant, and what every editor that
 * greys the item out fails to do.
 *
 * The SELECTION decides the mode, not the menu (FR-016b) — hence the shared {@link clipboardEntry},
 * which is what makes Cut over a rectangular block take the block rather than its whole lines.
 */
function copyOrCut(args: ContentMenuArgs, remove: boolean): void {
  const { view } = args;
  const entry = clipboardEntry(view, ENDINGS[args.lineEnding()]);
  if (!entry) return;

  // A CUT removes the text only once the clipboard write has succeeded — see `cutThrough`. Deleting
  // first and hoping is how a failed clipboard write turns into text that is simply gone.
  if (remove && entry.changes.length > 0) {
    cutThrough(view, entry);
    return;
  }

  void win()
    ?.clipboard?.write({ text: entry.text, mode: entry.mode })
    .catch((error: unknown) => console.error('[editor] copy failed', error));
}

export function editorContentMenu(args: ContentMenuArgs): MenuItem[] {
  const { view, panelId, viewId } = args;

  // Cut/Copy/Paste/Select All/Undo/Redo keep FIXED native chords and are deliberately NOT on the
  // rebindable command list (keybindings.ts, FR-017c) — there is no ActionId to resolve, so the
  // shortcuts shown here are the literal native bindings the editor is wired to (Ctrl+X/C/V/A and
  // Mod-z / Mod-y in use-editor.ts). They are display-only, matching what the user actually presses.
  return [
    // Never disabled for want of a selection (FR-012b): with none, they act on the caret's whole
    // line. A greyed-out Copy on the line the user just right-clicked is a refusal to do the
    // obvious thing.
    {
      label: 'Cut',
      icon: 'cut',
      shortcut: 'Ctrl+X',
      onClick: () => copyOrCut(args, true),
    },
    {
      label: 'Copy',
      icon: 'copy',
      shortcut: 'Ctrl+C',
      onClick: () => copyOrCut(args, false),
    },
    {
      label: 'Paste',
      icon: 'paste',
      shortcut: 'Ctrl+V',
      onClick: () => {
        void (async () => {
          const entry = await win()?.clipboard?.paste();
          if (!entry || entry.text.length === 0) return;
          applyPaste(view, entry.text, entry.mode);
          view.focus();
        })().catch((error: unknown) => {
          // A paste that fails silently looks exactly like a paste of nothing, and the user tries
          // again, and again, and concludes the editor is broken.
          console.error('[editor] paste from the content menu failed', error);
        });
      },
    },
    {
      label: 'Select All',
      icon: 'selectAll',
      shortcut: 'Ctrl+A',
      onClick: () => {
        view.dispatch({ selection: EditorSelection.single(0, view.state.doc.length) });
        view.focus();
      },
    },
    {
      label: 'Undo',
      icon: 'undo',
      shortcut: 'Ctrl+Z',
      onClick: () => win()?.editor?.undo({ panelId, viewId }),
    },
    {
      label: 'Redo',
      icon: 'redo',
      shortcut: 'Ctrl+Y',
      onClick: () => win()?.editor?.redo({ panelId, viewId }),
    },
    {
      // The second of the two entry points FR-010 asks for; the status strip is the other, and both
      // open the SAME picker. No keyboard shortcut — it is reachable only from the two menus.
      label: 'Set Language…',
      icon: 'language',
      onClick: () => requestLanguagePicker(panelId),
    },
  ];
}

/**
 * Where the caret goes when the user right-clicks (FR-012a).
 *
 * Inside an existing selection, the selection is PRESERVED — the user is about to act on it, and
 * collapsing it would destroy the very thing they right-clicked to operate on. Outside it, the
 * selection collapses and the caret moves to the click, because that is where the user is pointing.
 */
export function placeCaretForContextMenu(view: EditorView, event: MouseEvent): void {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return;

  const inSelection = view.state.selection.ranges.some((r) => !r.empty && pos >= r.from && pos <= r.to);
  if (inSelection) return;

  view.dispatch({ selection: EditorSelection.cursor(pos) });
}
