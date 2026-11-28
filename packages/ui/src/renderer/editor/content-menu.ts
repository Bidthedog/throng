import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  ENCODING_CHOICES,
  encodingLabel,
  lineEndingLabel,
  type EncodingId,
  type HeadingRecord,
  type LineEndingId,
} from '@throng/core';
import type { MenuAction } from '../workspace/context-menu.js';
import { isKeyboardMenu } from '../workspace/keyboard-menu.js';
import { applyPaste, clipboardEntry, cutThrough, ENDINGS } from './commands.js';
import { requestLanguagePicker } from './picker-request.js';
import { fixedShortcut } from '../common/fixed-shortcut.js';
import { outliningSubmenu, type OutliningArgs, type OutliningChords } from '../common/outlining-menu.js';

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

/**
 * The document-format rows (v1 review, #732): Set Language…, Reset Language, Encoding ▸ and Line Endings ▸. They
 * describe the panel's file rather than the text under the pointer, so the panel TITLE menu draws them
 * (`panel-header-menu.ts`); the body menu no longer does. Read at menu-open time by the editor that owns them.
 */
export interface EditorFormatMenuArgs {
  panelId: string;
  /** The document's effective language NAME, shown on the Set Language item so the menu states the
   *  current value as well as offering to change it (024 US1 follow-up). */
  languageName?: string;
  /** 055 FR-024b — Reset Language; `enabled` while the document has a manual override. Absent draws none. */
  resetLanguage?: { enabled: boolean; reset: () => void };
  /**
   * 059 FR-058 — the Encoding item, beside Set Language: the encoding indicator's own list as a submenu, and
   * `editor.changeEncoding`'s chord on the item. Absent draws none.
   */
  encoding?: EncodingMenuArgs & { changeChord?: string };
  /**
   * 059 FR-058, FR-061 — the Line Endings item after it: the indicator's list plus Insert Line Break (LF) /
   * (CR) / (CRLF). Absent draws none.
   */
  lineEndings?: LineEndingMenuArgs & { insert: InsertLineBreakArgs };
}

/**
 * The format rows in View & state, in the order the body menu drew them before the v1 review moved them to the title
 * menu. `section` and `group` are the caller's: the title menu files them with the rows only an editor has.
 */
export function editorFormatItems(args: EditorFormatMenuArgs, group?: string): MenuAction[] {
  const placed = group !== undefined ? { section: 'viewState' as const, group } : { section: 'viewState' as const };
  return [
    {
      // FR-010's second entry point; the status strip is the other, and both open the SAME picker. No keyboard
      // shortcut. The label NAMES the current language, because with the status bar hidden this menu is the only
      // place the answer appears. The test id is pinned to the bare label so it survives the language changing.
      label: args.languageName ? `Set Language… (${args.languageName})` : 'Set Language…',
      testId: 'menu-item-Set Language…',
      icon: 'language' as const,
      ...placed,
      onClick: () => requestLanguagePicker(args.panelId),
    },
    /*
     * 055 FR-024b — the menu route to the status strip's reset control, so it survives a hidden status bar.
     * DISABLED while the document has no override: an item that appears and vanishes would move everything below it.
     */
    ...(args.resetLanguage !== undefined
      ? [
          {
            label: 'Reset Language',
            testId: 'menu-item-Reset Language',
            icon: 'destroy' as const,
            ...placed,
            disabled: !args.resetLanguage.enabled,
            onClick: () => args.resetLanguage?.reset(),
          },
        ]
      : []),
    /*
     * 059 FR-058 — Encoding and Line Endings, each naming the current state as Set Language names the language, and
     * each holding its indicator's own list. Test ids pinned to the bare labels, so they survive the state changing.
     */
    ...(args.encoding
      ? [
          {
            label: `Encoding (${encodingLabel(args.encoding.current.encoding, args.encoding.current.hasBom)})`,
            testId: 'menu-item-Encoding',
            ...placed,
            shortcut: args.encoding.changeChord,
            submenu: encodingMenuItems(args.encoding),
          },
        ]
      : []),
    ...(args.lineEndings
      ? [
          {
            label: `Line Endings (${lineEndingLabel(args.lineEndings.lineEnding, args.lineEndings.mixed)})`,
            testId: 'menu-item-Line Endings',
            ...placed,
            submenu: [...lineEndingMenuItems(args.lineEndings), ...insertLineBreakItems(args.lineEndings.insert)],
          },
        ]
      : []),
  ];
}

/** v1 review (#732) — the editor's search rows, moved from the title menu (043 FR-015) to the body. */
export interface EditorSearchMenuArgs {
  find: () => void;
  replace: () => void;
  replaceAll: () => void;
  chords?: { find?: string; replace?: string; replaceAll?: string };
}

export interface ContentMenuArgs {
  view: EditorView;
  panelId: string;
  /** THIS view — undo is per document, but the cursors it restores go to the view that asked. */
  viewId: string;
  /** The document's effective ending — what the CLIPBOARD is terminated with (SC-009a). */
  lineEnding: () => LineEndingId;
  /** 024 US1 (#152): the checkable word-wrap toggle — its current state, the action, and its chord. */
  wordWrap: { on: boolean; toggle: () => void; chord?: string };
  /** 059 FR-059 — this PANEL's View Whitespace toggle, after Word Wrap. Absent draws none. */
  whitespace?: { on: boolean; toggle: () => void; chord?: string };
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
   * v1 review (#732), superseding 043 FR-015's placement — Find, Replace and Replace All act on the text, so the body
   * menu offers them. Absent draws none (a builder test that does not care).
   */
  search?: EditorSearchMenuArgs;
  /*
   * v1 review (#732) — Split, Open Preview, Print…, Synchronise Scrolling and the format rows are about the panel or its
   * file, so they are the TITLE menu's alone (`panel-header-menu.ts`); this menu no longer takes them.
   */
  /**
   * 047 US3 (FR-036, contracts "Editor body menu") — the four fold rows, present only for a
   * Markdown document; `undefined` draws none of them. `section` is the innermost section
   * containing the position the menu was opened at (the clicked point, or the caret for a
   * keyboard-opened menu) — `null` before the first heading, which is when the This-Section rows
   * are ABSENT rather than disabled. Collapse All / Expand All are always present but DISABLED
   * when the document has no headings at all.
   */
  markdownFold?: OutliningArgs & {
    section: { slug: string; level: HeadingRecord['level']; collapsed: boolean } | null;
    chords: OutliningChords;
  };
  // 045 FR-169 — no link input. Every link action lives in the ONE Link menu, which opens INSTEAD of
  // this one over a link (FR-171, `links/file-link-menu.ts`); this menu never carries a link row.
}

/** 059 FR-055, FR-056 — what the encoding list needs, read at menu-open time. */
export interface EncodingMenuArgs {
  /** The document's encoding and BOM — the entry matching both is marked current. */
  current: { encoding: EncodingId; hasBom: boolean };
  /** False for a document with no file on disk: there is nothing to re-read (FR-026). */
  canReopen: boolean;
  /** Change Encoding to that entry's encoding and BOM (FR-055). Never called for the current entry. */
  change: (choice: { encoding: EncodingId; hasBom: boolean }) => void;
  /** Open THE encoding picker — the one the strip anchors — for Reopen with Encoding (FR-056). */
  openReopenPicker: () => void;
  /** The live chord for Reopen with Encoding, once bound (FR-041 ships it unbound). */
  chords?: { reopen?: string };
}

/** The three endings a document can be converted to, or a break inserted with (FR-057, FR-061). */
export type LineEndingTarget = 'lf' | 'cr' | 'crlf';

/** 059 FR-057 — what the line-ending list needs, read at menu-open time. */
export interface LineEndingMenuArgs {
  /** The uniform ending, or the dominant one when `mixed`. */
  lineEnding: LineEndingId;
  mixed: boolean;
  convert: (target: LineEndingTarget) => void;
  chords?: Partial<Record<LineEndingTarget, string>>;
}

/** 059 FR-061 — Insert Line Break (LF) / (CR) / (CRLF). */
export interface InsertLineBreakArgs {
  insert: (ending: LineEndingTarget) => void;
  chords?: Partial<Record<LineEndingTarget, string>>;
}

/** 059 FR-070 — the submenu holding the code pages: not "ANSI" (a misnomer) and not "Legacy". */
export const CODE_PAGES_LABEL = 'Windows Code Pages';

/** The id a row's test id is pinned to — `utf16le-bom` — so it survives the label's check mark. */
const encodingKey = (c: { encoding: EncodingId; hasBom: boolean }): string =>
  `${c.encoding}${c.hasBom ? '-bom' : ''}`;

/**
 * 059 FR-055, FR-056, FR-070 — the encoding list: the Unicode encodings, then the Windows Code Pages submenu,
 * the current one marked, then Reopen with Encoding… last. ONE builder for the encoding indicator's menu and the content menu's Encoding submenu: the
 * indicator is an accelerator over these rows, so the two cannot drift (FR-033, FR-058).
 *
 * Choosing an entry is Change Encoding — the document changes, dirty and undoable, and nothing is written
 * until a save. Choosing the current one is a no-op (FR-055). Reopen sits in a group of its own below,
 * because it is a different act: it re-reads the file rather than changing the document.
 */
export function encodingMenuItems(a: EncodingMenuArgs): MenuAction[] {
  const row = (c: (typeof ENCODING_CHOICES)[number]): MenuAction => {
    const current = c.encoding === a.current.encoding && c.hasBom === a.current.hasBom;
    return {
      label: c.label,
      checked: current,
      testId: `menu-item-encoding-${encodingKey(c)}`,
      section: 'viewState' as const,
      group: 'change',
      onClick: () => {
        if (!current) a.change({ encoding: c.encoding, hasBom: c.hasBom });
      },
    };
  };
  // FR-070: the Unicode rows stay one click away; the code pages share one submenu, ticked when the document
  // is in one of them so the current encoding shows without opening it.
  const pages = ENCODING_CHOICES.filter((c) => c.group === 'codepage');
  const inPages = pages.some((c) => c.encoding === a.current.encoding);
  const rows: MenuAction[] = [
    ...ENCODING_CHOICES.filter((c) => c.group === 'unicode').map(row),
    {
      label: CODE_PAGES_LABEL,
      checked: inPages,
      testId: 'menu-item-encoding-codepages',
      section: 'viewState',
      group: 'change',
      submenu: pages.map(row),
    },
  ];
  rows.push({
    label: 'Reopen with Encoding…',
    testId: 'menu-item-Reopen with Encoding…',
    section: 'viewState',
    group: 'reopen',
    shortcut: a.chords?.reopen,
    disabled: !a.canReopen,
    onClick: () => a.openReopenPicker(),
  });
  return rows;
}

const ENDING_NAME: Record<LineEndingTarget, string> = { lf: 'LF', cr: 'CR', crlf: 'CRLF' };
const ENDING_ORDER: readonly LineEndingTarget[] = ['lf', 'cr', 'crlf'];

/**
 * 059 FR-057 — the line-ending list: LF, CR, CRLF and Mixed, the current state marked. ONE builder for the
 * line-ending indicator's menu and the content menu's Line Endings submenu.
 *
 * LF, CR and CRLF convert every ending, as one undoable step; the current UNIFORM ending is a no-op (FR-038).
 * On a mixed document none of the three is current — the dominant ending included — so each converts.
 * **Mixed is always listed and never selectable**: it is marked current on a mixed document and is only a
 * state to switch FROM ("Users cannot switch to 'Mixed'" — the user).
 */
export function lineEndingMenuItems(a: LineEndingMenuArgs): MenuAction[] {
  const rows: MenuAction[] = ENDING_ORDER.map((target) => {
    const current = !a.mixed && a.lineEnding === target;
    const name = ENDING_NAME[target];
    return {
      label: name,
      checked: current,
      testId: `menu-item-line-ending-${target}`,
      section: 'viewState' as const,
      group: 'convert',
      shortcut: a.chords?.[target],
      onClick: () => {
        if (!current) a.convert(target);
      },
    };
  });
  rows.push({
    label: 'Mixed',
    checked: a.mixed,
    testId: 'menu-item-line-ending-mixed',
    section: 'viewState',
    group: 'convert',
    disabled: true,
  });
  return rows;
}

/**
 * 059 FR-061 — Insert Line Break (LF) / (CR) / (CRLF), the content menu's explicit route to a mixed document:
 * a line break with THAT ending at each caret, as an ordinary undoable edit. Enter keeps the dominant ending.
 * Labelled as the key binder names the three commands, so the two surfaces agree; a group of their own below
 * the conversions, because they change one line rather than every one.
 */
export function insertLineBreakItems(a: InsertLineBreakArgs): MenuAction[] {
  return ENDING_ORDER.map((ending) => ({
    label: `Insert Line Break (${ENDING_NAME[ending]})`,
    testId: `menu-item-insert-line-break-${ending}`,
    section: 'viewState' as const,
    group: 'insert',
    shortcut: a.chords?.[ending],
    onClick: () => a.insert(ending),
  }));
}

/**
 * 045 §5 — the document offset the Link menu is hit-tested from.
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
  // shortcuts shown here are the native bindings the editor is wired to (Mod-x/c/v/a, and Mod-z / Mod-y,
  // Mod-Shift-z on macOS, in use-editor.ts), in this platform's form (`fixedShortcut`: Cmd on macOS).
  // v1 review (#732): the clipboard rows are one group and Undo / Redo the next, the order every content menu uses.
  const items: MenuAction[] = [
    // Never disabled for want of a selection (FR-012b): with none, they act on the caret's whole
    // line. A greyed-out Copy on the line the user just right-clicked is a refusal to do the
    // obvious thing.
    {
      label: 'Cut',
      icon: 'cut' as const,
      section: 'content',
      group: 'clipboard',
      shortcut: fixedShortcut('cut'),
      onClick: () => copyOrCut(args, true),
    },
    {
      label: 'Copy',
      icon: 'copy' as const,
      section: 'content',
      group: 'clipboard',
      shortcut: fixedShortcut('copy'),
      onClick: () => copyOrCut(args, false),
    },
    {
      label: 'Paste',
      icon: 'paste' as const,
      section: 'content',
      group: 'clipboard',
      shortcut: fixedShortcut('paste'),
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
      icon: 'selectAll' as const,
      section: 'content',
      group: 'clipboard',
      shortcut: fixedShortcut('selectAll'),
      onClick: () => {
        view.dispatch({ selection: EditorSelection.single(0, view.state.doc.length) });
        view.focus();
      },
    },
    {
      label: 'Undo',
      icon: 'undo' as const,
      section: 'content',
      group: 'history',
      shortcut: fixedShortcut('undo'),
      onClick: () => win()?.editor?.undo({ panelId, viewId }),
    },
    {
      label: 'Redo',
      icon: 'redo' as const,
      section: 'content',
      group: 'history',
      shortcut: fixedShortcut('redo'),
      onClick: () => win()?.editor?.redo({ panelId, viewId }),
    },
    /*
     * v1 review (#732), superseding 043 FR-015's placement — Find, Replace and Replace All, in Content because all
     * three act on the text: Find moves the caret through it and Replace rewrites it. A group of their own below
     * Undo / Redo. Each shows the chord it is bound to now.
     */
    ...(args.search !== undefined
      ? [
          {
            label: 'Find',
            icon: 'search' as const,
            section: 'content' as const,
            group: 'search',
            shortcut: args.search.chords?.find,
            onClick: () => args.search?.find(),
          },
          {
            label: 'Replace',
            icon: 'replace' as const,
            section: 'content' as const,
            group: 'search',
            shortcut: args.search.chords?.replace,
            onClick: () => args.search?.replace(),
          },
          {
            label: 'Replace All',
            icon: 'replaceAll' as const,
            section: 'content' as const,
            group: 'search',
            shortcut: args.search.chords?.replaceAll,
            onClick: () => args.search?.replaceAll(),
          },
        ]
      : []),
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
    {
      // 024 US1 (#152) / Principle VI: every panel action has a menu item, even one also on the
      // status bar — so it survives a hidden status bar. The checked mark renders the current state.
      label: 'Word Wrap',
      checked: args.wordWrap.on,
      testId: 'menu-item-Word Wrap',
      section: 'viewState',
      shortcut: args.wordWrap.chord,
      onClick: () => args.wordWrap.toggle(),
    },
    /*
     * 059 FR-059 — View Whitespace, immediately after Word Wrap and in its idiom: the menu route to the
     * status-bar toggle, so a hidden bar strands nothing. The check states the PANEL's own value.
     */
    ...(args.whitespace
      ? [
          {
            label: 'View Whitespace',
            checked: args.whitespace.on,
            testId: 'menu-item-View Whitespace',
            section: 'viewState' as const,
            shortcut: args.whitespace.chord,
            onClick: () => args.whitespace?.toggle(),
          },
        ]
      : []),
    /*
     * 054 FR-010 (superseding 047 FR-036's placement) — every fold row in ONE Outlining submenu,
     * Markdown documents only (FR-014), built by the builder the preview's menu uses too, so the two
     * cannot drift.
     */
    ...(args.markdownFold ? [outliningSubmenu(args.markdownFold)] : []),
  ];
  return items;
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
