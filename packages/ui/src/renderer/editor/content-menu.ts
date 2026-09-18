import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { LineEndingId, PreviewAffordance } from '@throng/core';
import type { MenuAction } from '../workspace/context-menu.js';
import { isKeyboardMenu } from '../workspace/keyboard-menu.js';
import { applyPaste, clipboardEntry, cutThrough, ENDINGS } from './commands.js';
import { requestLanguagePicker } from './picker-request.js';
import { fileLinkMenuActions, type FileLinkMenuContext } from '../links/link-menu-items.js';

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
  /** 024 US1 (#152): the checkable word-wrap toggle — its current state, the action, and its chord. */
  wordWrap: { on: boolean; toggle: () => void; chord?: string };
  /**
   * 033 US2 (#219, FR-027): Go To Line — the action, and the chord it is CURRENTLY bound to.
   *
   * The chord is passed in rather than read here, and read live rather than captured, for the same
   * reason Word Wrap's is: a user who rebinds the command must see the new chord on the menu without
   * restarting, and a menu that names a chord the app no longer honours is worse than one naming
   * none. The item exists at all because the constitution's "every panel action has a menu item"
   * rule applies to a discrete command acting on a panel's content, which this is.
   */
  gotoLine: { open: () => void; chord?: string };
  /**
   * 044 FR-002 — Open Preview: core's affordance for this editor's file, the `preview.open` action and
   * its chord, all read at menu-open time like Go To Line's. Omitted (or `absent`) draws no item.
   */
  openPreview?: { affordance: PreviewAffordance; open: () => void; chord?: string };
  /**
   * 044 FR-122b — Synchronise Scrolling: the setting's current value, the toggle (`toggleSyncScroll`) and
   * `preview.toggleSyncScroll`'s chord, read at menu-open time. Drawn only where Open Preview is drawn
   * (FR-122a) — the affordance above decides that, so this is omitted or ignored everywhere else.
   */
  syncScroll?: { on: boolean; toggle: () => void; chord?: string };
  /** The document's effective language NAME, shown on the Set Language item so the menu states the
   *  current value as well as offering to change it (024 US1 follow-up). */
  languageName?: string;
  /**
   * 045 FR-031 — the file link the menu was opened over, or null.
   *
   * These are the FIRST `contextual` items this menu has ever had, and they LEAD it: they are absent
   * unless the pointer (or the caret, for a keyboard menu) is on a link, which is the constitution's
   * own test for that section. The run is composed by `fileLinkMenuActions`, shared with the
   * terminal's menu, because FR-031 requires the two to be the same and two builders are two chances
   * to disagree.
   */
  fileLink?: FileLinkMenuContext | null;
}

/**
 * 045 §5 — the document offset the link run is composed from.
 *
 * A right-click hit-tests the POINTER. A keyboard-opened menu (Shift+F10) has no pointer at all: its
 * synthetic event carries the focused element's corner, which is nowhere near the caret — the same
 * trap {@link placeCaretForContextMenu} was fixed for, and the reason that function already no-ops
 * for a keyboard menu. So the caret is the answer there, and both answers are a single offset, so
 * one hit test serves the whole run.
 */
export function linkMenuPosition(view: EditorView, event: MouseEvent): number | null {
  if (isKeyboardMenu()) return view.state.selection.main.head;
  return view.posAtCoords({ x: event.clientX, y: event.clientY });
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

export function editorContentMenu(args: ContentMenuArgs): MenuAction[] {
  const { view, panelId, viewId } = args;

  // Cut/Copy/Paste/Select All/Undo/Redo keep FIXED native chords and are deliberately NOT on the
  // rebindable command list (keybindings.ts, FR-017c) — there is no ActionId to resolve, so the
  // shortcuts shown here are the literal native bindings the editor is wired to (Ctrl+X/C/V/A and
  // Mod-z / Mod-y in use-editor.ts). They are display-only, matching what the user actually presses.
  return [
    // 045 FR-031 — the file-link run, ahead of everything. Empty when the pointer is not on a link,
    // which is every menu this editor drew before this feature.
    ...fileLinkMenuActions(args.fileLink ?? null),
    // Never disabled for want of a selection (FR-012b): with none, they act on the caret's whole
    // line. A greyed-out Copy on the line the user just right-clicked is a refusal to do the
    // obvious thing.
    {
      label: 'Cut',
      icon: 'cut',
      section: 'content',
      shortcut: 'Ctrl+X',
      onClick: () => copyOrCut(args, true),
    },
    {
      label: 'Copy',
      icon: 'copy',
      section: 'content',
      shortcut: 'Ctrl+C',
      onClick: () => copyOrCut(args, false),
    },
    {
      label: 'Paste',
      icon: 'paste',
      section: 'content',
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
      section: 'content',
      shortcut: 'Ctrl+A',
      onClick: () => {
        view.dispatch({ selection: EditorSelection.single(0, view.state.doc.length) });
        view.focus();
      },
    },
    {
      label: 'Undo',
      icon: 'undo',
      section: 'content',
      shortcut: 'Ctrl+Z',
      onClick: () => win()?.editor?.undo({ panelId, viewId }),
    },
    {
      label: 'Redo',
      icon: 'redo',
      section: 'content',
      shortcut: 'Ctrl+Y',
      onClick: () => win()?.editor?.redo({ panelId, viewId }),
    },
    {
      // 033 US2 (FR-027) — the menu route to Go To Line, showing the chord it is bound to right now.
      //
      // It sits between the editing items and the view items because it is neither: it changes
      // nothing in the document and nothing about how the document is drawn, it moves you. That is
      // the Navigate section US5's vocabulary gives it, and this is the position it occupies.
      label: 'Go To Line…',
      section: 'navigate',
      testId: 'menu-item-Go To Line…',
      shortcut: args.gotoLine.chord,
      onClick: () => args.gotoLine.open(),
    },
    /*
     * 044 FR-002 — Open Preview, in Navigate immediately after Go To Line… (contracts/menus-and-controls.md
     * §3). It moves the user to a rendering of this file rather than changing the file, which is what
     * puts it beside Go To Line. Absent where a preview means nothing (no provider, no file, outside the
     * project — FR-001, FR-004); DISABLED while the provider is off (FR-062) or the file already has its
     * one preview (FR-012). Every panel action has a menu item: this is the one for the status-bar button.
     */
    ...(args.openPreview !== undefined && args.openPreview.affordance.state !== 'absent'
      ? [
          {
            label: 'Open Preview',
            icon: 'preview',
            section: 'navigate' as const,
            shortcut: args.openPreview.chord,
            disabled: args.openPreview.affordance.state === 'disabled',
            onClick: () => args.openPreview?.open(),
          },
        ]
      : []),
    {
      // The second of the two entry points FR-010 asks for; the status strip is the other, and both
      // open the SAME picker. No keyboard shortcut — it is reachable only from the two menus.
      //
      // The label NAMES the current language, because with the status bar hidden this menu is the
      // only place the answer appears — and "what did the editor decide this file is?" is half the
      // reason the item exists (FR-010). The test id is pinned to the bare label so it survives the
      // language changing, exactly as the Word Wrap item pins its own.
      label: args.languageName ? `Set Language… (${args.languageName})` : 'Set Language…',
      testId: 'menu-item-Set Language…',
      icon: 'language',
      section: 'viewState',
      onClick: () => requestLanguagePicker(panelId),
    },
    {
      // 024 US1 (#152) / Principle VI: every panel action has a menu item, even one also on the
      // status bar — so it survives a hidden status bar. The leading ✓ renders the current state.
      label: args.wordWrap.on ? 'Word Wrap ✓' : 'Word Wrap',
      testId: 'menu-item-Word Wrap',
      section: 'viewState',
      shortcut: args.wordWrap.chord,
      onClick: () => args.wordWrap.toggle(),
    },
    /*
     * 044 FR-122b — Synchronise Scrolling, after Word Wrap and in its idiom (contracts/menus-and-controls.md
     * §3, §10). Present exactly where Open Preview is — ENABLED even while that item is disabled, because
     * the setting applies whether or not a preview can be opened right now (FR-122a). Every panel action
     * has a menu item: this is the one for the status-bar toggle, so a hidden bar strands nothing.
     */
    ...(args.syncScroll !== undefined && args.openPreview !== undefined && args.openPreview.affordance.state !== 'absent'
      ? [
          {
            label: args.syncScroll.on ? 'Synchronise Scrolling ✓' : 'Synchronise Scrolling',
            testId: 'menu-item-Synchronise Scrolling',
            icon: 'syncScroll',
            section: 'viewState' as const,
            shortcut: args.syncScroll.chord,
            onClick: () => args.syncScroll?.toggle(),
          },
        ]
      : []),
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
  // A KEYBOARD-opened menu (Shift+F10) has no pointer, and its synthetic event carries the focused
  // element's corner as its coordinates — nowhere near the caret. Moving the caret there would
  // destroy the very selection the user opened the menu to act on, so Cut took the whole line
  // instead of the selected word. The caret is already exactly where the keyboard put it.
  if (isKeyboardMenu()) return;
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return;

  const inSelection = view.state.selection.ranges.some((r) => !r.empty && pos >= r.from && pos <= r.to);
  if (inSelection) return;

  view.dispatch({ selection: EditorSelection.cursor(pos) });
}
