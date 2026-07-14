import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import { indentUnit } from '@codemirror/language';
import { EditorView, keymap, type Command } from '@codemirror/view';
import {
  columnAt,
  cutLine,
  indentUnitOf,
  isRectangular,
  offsetAt,
  rectPaste,
  rowsOf,
  type ActionId,
  type ClipboardMode,
  type IndentProfile,
  type Keybindings,
  type LineEndingId,
  type PadStyle,
  type RowSpan,
} from '@throng/core';
import { editorChordsFor } from '../keybindings/scope.js';

/**
 * The editor's own commands, bound INSIDE CodeMirror (016, US3 · FR-016).
 *
 * They must be a CodeMirror keymap and not a window-level listener, for two reasons that both
 * decide correctness rather than taste:
 *
 *   • CodeMirror's `defaultKeymap` already owns several of these chords, and a listener on the
 *     document loses to it — the editor would handle the key first and the command would never fire;
 *   • they are EDITOR-scoped. A window-level listener fires wherever the user is, and `Ctrl+X` in
 *     the File Explorer must cut a FILE, not a line.
 *
 * So they sit at `Prec.highest`, above `defaultKeymap` — and the chords 012's window-level commands
 * own are withheld entirely (see {@link editorChordsFor}), so a rebind can never let the editor
 * swallow a move-focus chord.
 */

const win = (): typeof window.throng | undefined => window.throng;

/** The document's effective line ending — what the CLIPBOARD is terminated with (SC-009a). */
export type LineEndingOf = (view: EditorView) => LineEndingId;

export const ENDINGS: Record<LineEndingId, string> = { lf: '\n', crlf: '\r\n', cr: '\r' };

/** What a cut or copy would put on the clipboard, and what a cut would remove. */
export interface ClipboardEntry {
  text: string;
  mode: ClipboardMode;
  changes: { from: number; to: number }[];
}

/**
 * What the CURRENT selection means for the clipboard (FR-016b).
 *
 * **The selection decides the mode, not the command.** Every route that copies or cuts — `cut-line`,
 * the content menu's Cut/Copy, and the native Ctrl+C/Ctrl+X — comes through here, because the
 * alternative is what this codebase actually had: three routes, one of which understood blocks.
 * The content menu's Cut over a block would have taken the block's whole LINES, destroying the text
 * to the left and right of the very block the user drew to protect it; and a native Ctrl+C never
 * reached the clipboard seam at all, so a copied block pasted back verbatim.
 *
 * Returns null when there is nothing to copy (an empty document).
 */
export function clipboardEntry(view: EditorView, ending: string): ClipboardEntry | null {
  // A rectangular block is cut as a BLOCK (FR-025b/FR-025e): only the block's own characters go,
  // each row's line keeping everything outside the columns.
  if (selectionIsRectangular(view)) {
    const ranges = view.state.selection.ranges;
    return {
      text: ranges.map((r) => view.state.sliceDoc(r.from, r.to)).join(ending),
      mode: 'rectangular',
      changes: ranges.map((r) => ({ from: r.from, to: r.to })),
    };
  }

  const cursors = view.state.selection.ranges.map((r) => ({ from: r.from, to: r.to }));
  const result = cutLine(cursors, view.state.doc, ending);
  if (result.clipboardText.length === 0) return null;
  return { text: result.clipboardText, mode: result.mode, changes: result.changes };
}

/**
 * `cut-line` — Ctrl+X (FR-016/FR-016a).
 *
 * A cursor with a selection cuts exactly that selection; a bare caret cuts its whole line; a block
 * cuts the block. What goes on the clipboard is decided by {@link clipboardEntry}; this applies it.
 */
export function cutLineCommand(lineEndingOf: LineEndingOf): Command {
  return (view) => {
    const entry = clipboardEntry(view, ENDINGS[lineEndingOf(view)]);
    if (!entry || entry.changes.length === 0) return false;
    cutThrough(view, entry);
    return true;
  };
}

/**
 * Put the text on the clipboard, and remove it from the document ONLY once that has succeeded.
 *
 * The order matters, and getting it wrong destroys the user's text. The clipboard write is an IPC
 * round trip (the clipboard is an OS resource and lives in UI main), so it can fail — and the
 * original code fired it with `void`, dropped the rejection, and deleted the text regardless. A cut
 * whose clipboard write failed would then have removed the text from the document AND put it
 * nowhere: it is simply gone, with no error, and Ctrl+V pastes whatever was on the clipboard before.
 *
 * So the deletion waits for the write. The command still reports "handled" synchronously — the key
 * is ours either way, and letting the browser's native cut run as well would delete the text twice.
 */
export function cutThrough(view: EditorView, entry: ClipboardEntry): void {
  void (async () => {
    await win()?.clipboard?.write({ text: entry.text, mode: entry.mode });
    view.dispatch({
      changes: entry.changes,
      // A COMMAND, so it is its own undo entry — it must never coalesce into a backspace run
      // above it (FR-026). `delete.cut` is not one of the run classes, which is what enforces that.
      userEvent: 'delete.cut',
      scrollIntoView: true,
    });
  })().catch((error: unknown) => {
    // The document is UNTOUCHED on this path — that is the point. Say so loudly rather than
    // pretending a cut happened.
    console.error('[editor] cut failed; the document was not changed', error);
  });
}

/**
 * The NATIVE Ctrl+C / Ctrl+X, routed through the clipboard seam (FR-016b).
 *
 * Ctrl+X is a command and never reaches here (its keymap entry preventDefaults), but Ctrl+C is not a
 * registered command in throng and never was — so without this it fell through to CodeMirror's own
 * copy, which writes the OS clipboard directly, behind main's back. The mode marker was therefore
 * never set for a keyboard copy, and — worse — main's record was INVALIDATED by the write it could
 * not see, so a copied block always pasted back verbatim. Copy a column, paste a column: the whole
 * point of US6, broken by the one route users actually reach for.
 *
 * Returning true makes CodeMirror preventDefault, so the browser writes nothing; main's write is the
 * only one, and the OS clipboard and the mode marker can no longer disagree.
 */
export function clipboardEventHandlers(lineEndingOf: LineEndingOf): Extension {
  const handle = (view: EditorView, remove: boolean): boolean => {
    const entry = clipboardEntry(view, ENDINGS[lineEndingOf(view)]);
    if (!entry) return false;

    if (remove && entry.changes.length > 0) {
      cutThrough(view, entry); // …the deletion waits for the clipboard write to succeed
      return true;
    }

    void win()
      ?.clipboard?.write({ text: entry.text, mode: entry.mode })
      // A copy destroys nothing, so it need not wait — but a FAILED copy still leaves the user with
      // a stale clipboard and no idea, and their next paste inserts something they copied minutes
      // ago. Never swallow it.
      .catch((error: unknown) => console.error('[editor] copy failed', error));
    return true;
  };

  return EditorView.domEventHandlers({
    copy: (_event, view) => handle(view, false),
    cut: (_event, view) => handle(view, true),
  });
}

/**
 * Paste, honouring the shape of what was copied (FR-015a/FR-015c).
 *
 * A FULL-LINE entry inserts as a whole line immediately ABOVE the caret's line, leaving that line
 * unsplit — which is the point of remembering the shape at all. Pasting a cut line into the middle
 * of a word, splitting it in half, is what every editor that forgets the shape does.
 *
 * Anything else is inserted verbatim at the caret.
 */
export function pasteCommand(): Command {
  return (view) => {
    void (async () => {
      const entry = await win()?.clipboard?.paste();
      if (!entry || entry.text.length === 0) return;
      applyPaste(view, entry.text, entry.mode);
    })().catch((error: unknown) => {
      // Never swallow this. A paste that fails silently looks exactly like a paste that pasted
      // nothing, and the user's clipboard still holds their text — so they try again, and again,
      // and conclude the editor is broken. Say so.
      console.error('[editor] paste failed', error);
    });
    // Handled: the read is asynchronous (the clipboard lives in UI main), but the key is ours either
    // way — letting the browser's native paste run as well would insert the text a second time.
    return true;
  };
}

export function applyPaste(view: EditorView, text: string, mode: ClipboardMode): void {
  // The buffer is ALWAYS LF (the fidelity model normalises on read and re-applies the file's own
  // ending on write), so pasted CRLF is normalised here and a paste can never make a file mixed
  // (FR-023a). An already-mixed file is not repaired by this — it is not this paste's business
  // (FR-023b), and the file's recorded ending decides what is written back.
  const normalised = text.replace(/\r\n?/g, '\n');

  /**
   * Pasting INTO a block replaces every row of it (FR-025h).
   *
   * A rectangular entry goes row-for-row. A verbatim entry whose line count EQUALS the row count is
   * distributed one line per row — the only route by which ordinary copied text becomes a block —
   * and anything else replaces the whole block with the text as it stands, because there is no
   * honest way to spread four lines across three rows.
   */
  if (selectionIsRectangular(view)) {
    const ranges = view.state.selection.ranges;
    const rows = rowsOf(normalised);
    const perRow = mode === 'rectangular' || rows.length === ranges.length;
    view.dispatch({
      changes: ranges.map((range, i) => ({
        from: range.from,
        to: range.to,
        insert: perRow ? (rows[i] ?? '') : normalised,
      })),
      userEvent: 'input.paste',
      scrollIntoView: true,
    });
    return;
  }

  // A rectangular entry pasted at a CARET lands column-wise: row n at the caret's column on the
  // n-th successive line. This is what makes "cut a column here, paste it there" work at all.
  if (mode === 'rectangular') {
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    const style = padStyleOf(view);
    const changes = rectPaste(
      rowsOf(normalised),
      { line: line.number, col: columnAt(line.text, head - line.from, style.tabWidth) },
      view.state.doc,
      view.state.lineBreak,
      style,
    );
    view.dispatch({ changes, userEvent: 'input.paste', scrollIntoView: true });
    return;
  }

  if (mode !== 'full-line') {
    view.dispatch(view.state.replaceSelection(normalised), { userEvent: 'input.paste' });
    return;
  }

  // A full-line entry always carries its terminator; inserting it above the caret's line means
  // inserting it AT the start of that line, terminator and all.
  const body = normalised.endsWith('\n') ? normalised : normalised + '\n';
  const changes = [];
  const selections = [];
  for (const [i, range] of view.state.selection.ranges.entries()) {
    const line = view.state.doc.lineAt(range.head);
    changes.push({ from: line.from, insert: body });
    // The caret stays with the text it was on, which has moved down by EVERY line inserted at or
    // before it — not just its own. CodeMirror resolves this selection against the NEW document, so
    // with three cursors the third has three bodies above it, and counting only its own would land
    // it two bodies too early. (`ranges` is always in document order, so `i` is that count.)
    selections.push(EditorSelection.cursor(range.head + body.length * (i + 1)));
  }

  view.dispatch({
    changes,
    selection: EditorSelection.create(selections),
    userEvent: 'input.paste',
    scrollIntoView: true,
  });
}

/**
 * Holds the rebindable keymap so it can be REPLACED on a live view (FR-017).
 *
 * The bindings are user data: rebinding `cut-line` must move the behaviour there and then, in every
 * open editor, and return `Ctrl+X` to a native cut. A keymap fixed at mount would leave the old
 * chord working until the panel was reopened — and "reopen the editor for your keybinding to take
 * effect" is exactly the kind of thing nobody tells the user.
 */
export const commandKeymapCompartment = new Compartment();

/**
 * Holds the document's EFFECTIVE indentation (016, FR-018) — what a new indent inserts, and how wide
 * a literal tab is drawn.
 *
 * In a compartment because it is re-decided whenever the document's identity changes (a different
 * file, a different language) or the setting behind it moves. `tabWidth` is DISPLAY only: it changes
 * how a tab is drawn, never what is in the file (FR-018e).
 */
export const indentCompartment = new Compartment();

/** The CodeMirror facets for one indentation profile. */
export function indentExtensions(profile: IndentProfile): Extension {
  return [indentUnit.of(indentUnitOf(profile)), EditorState.tabSize.of(profile.tabWidth)];
}

/** The lines a selection touches, in document order, each counted ONCE. */
function touchedLines(view: EditorView): { from: number; text: string }[] {
  const seen = new Set<number>();
  const lines: { from: number; text: string }[] = [];
  for (const range of view.state.selection.ranges) {
    let pos = range.from;
    for (;;) {
      const line = view.state.doc.lineAt(pos);
      if (!seen.has(line.from)) {
        seen.add(line.from);
        lines.push({ from: line.from, text: line.text });
      }
      if (line.to >= range.to) break;
      pos = line.to + 1;
    }
  }
  return lines.sort((a, b) => a.from - b.from);
}

/**
 * `indent-lines` — Tab (FR-018/FR-019).
 *
 * With no selection it inserts one indent AT THE CARET, which is what Tab has always done. With a
 * selection it indents every line the selection touches — including the last line even when only its
 * first character is selected, because the user selected part of it and means the line.
 *
 * ONE undo entry, however many lines it moved (FR-026).
 */
export function indentLinesCommand(indentOf: (view: EditorView) => IndentProfile): Command {
  return (view) => {
    const unit = indentUnitOf(indentOf(view));
    if (!view.state.selection.ranges.some((r) => !r.empty)) {
      view.dispatch({
        ...view.state.replaceSelection(unit),
        userEvent: 'input.indent',
        scrollIntoView: true,
      });
      return true;
    }

    view.dispatch({
      changes: touchedLines(view)
        // An EMPTY line is left alone. Indenting it would add trailing whitespace to a blank line —
        // which every linter flags and every diff shows, for a line the user cannot even see they
        // changed. (A caret sitting ON a blank line is the branch above: there, Tab inserts at the
        // caret, because that is the user asking for indentation rather than a selection sweeping
        // the line up with the others.)
        .filter((line) => line.text.length > 0)
        .map((line) => ({ from: line.from, insert: unit })),
      userEvent: 'input.indent',
      scrollIntoView: true,
    });
    return true;
  };
}

/**
 * `outdent-lines` — Shift+Tab (FR-018/FR-019).
 *
 * Removes ONE level of indentation from every line the selection touches, whichever characters that
 * line actually starts with: a leading tab goes as a tab, leading spaces go up to one indent width.
 * Reading the line rather than assuming the configured style is what lets a tab-indented file be
 * outdented correctly while the setting says spaces — the file's own indentation is the fact
 * (FR-018a), and refusing to outdent it would be refusing to edit the user's file on principle.
 *
 * A line with no indentation is left alone rather than eating its first character.
 */
export function outdentLinesCommand(indentOf: (view: EditorView) => IndentProfile): Command {
  return (view) => {
    const width = indentOf(view).indentWidth;
    const changes: { from: number; to: number }[] = [];

    for (const line of touchedLines(view)) {
      if (line.text.startsWith('\t')) {
        changes.push({ from: line.from, to: line.from + 1 });
        continue;
      }
      const spaces = line.text.length - line.text.trimStart().length;
      const leadingSpaces = line.text.slice(0, spaces).split('').filter((c) => c === ' ').length;
      const remove = Math.min(leadingSpaces, width);
      if (remove > 0) changes.push({ from: line.from, to: line.from + remove });
    }

    if (changes.length === 0) return false; // nothing was indented — not an error, just a no-op
    view.dispatch({ changes, userEvent: 'delete.dedent', scrollIntoView: true });
    return true;
  };
}

/**
 * What the document's padding is made of (FR-025c1) — read from the view, so it is whatever the
 * document's effective indentation is RIGHT NOW: a Save-As that changes the language changes this.
 */
export function padStyleOf(view: EditorView): PadStyle {
  return {
    style: view.state.facet(indentUnit).includes('\t') ? 'tabs' : 'spaces',
    tabWidth: view.state.tabSize,
  };
}

/**
 * The rows of the current selection, as VISUAL columns — the shape a block is recognised from.
 *
 * Visual, not character offsets: a block drawn down a tab-indented file lands on different offsets
 * on every row while sitting under one screen column. Compared as offsets it would not look like a
 * rectangle at all, and the cut would fall through to the whole-line path — destroying text either
 * side of the very block the user drew to avoid it.
 */
function rowSpans(view: EditorView): RowSpan[] {
  const tabWidth = view.state.tabSize;
  return view.state.selection.ranges.map((range) => {
    const from = view.state.doc.lineAt(range.from);
    const to = view.state.doc.lineAt(range.to);
    return {
      line: from.number,
      fromCol: columnAt(from.text, range.from - from.from, tabWidth),
      toCol: columnAt(to.text, range.to - to.from, tabWidth),
    };
  });
}

/** Is the current selection a rectangular block? (FR-016b — it decides the clipboard's shape.) */
export function selectionIsRectangular(view: EditorView): boolean {
  return isRectangular(rowSpans(view));
}

/**
 * A column block's four corners, in LINE/COLUMN space rather than document offsets.
 *
 * The columns here are the block's TRUE columns, which is the whole reason this is remembered
 * separately from the selection. Drag a block across a ragged file and its rows are clamped to the
 * short lines — so if the next keystroke re-derived the column from a clamped row's caret, the block
 * would shrink to the width of its shortest line and never grow back. A caret has a goal column for
 * exactly the same reason; a block needs one per side.
 */
interface ColumnBlock {
  anchorLine: number;
  anchorCol: number;
  headLine: number;
  headCol: number;
}

const setColumnBlock = StateEffect.define<ColumnBlock>();

/**
 * The live block's goal columns. Any selection change or edit that is not ours ABANDONS it — a stale
 * goal column would silently drag the block back to a shape the user had already left behind.
 */
export const columnBlockField = StateField.define<ColumnBlock | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setColumnBlock)) return effect.value;
    if (tr.selection || tr.docChanged) return null;
    return value;
  },
});

/**
 * The block to move: the one we are already tracking, or one derived from the current selection.
 *
 * Deriving is what lets the keyboard pick up a block the MOUSE made — Alt+drag a block, then extend
 * it with `Shift+Alt+Down` — and what lets it survive typing into the block (which drops the field,
 * because the edit changed the document under it). It also converts an ordinary caret into a
 * single-row block, which is how a block gets started in the first place.
 *
 * The anchor is at whichever end of the selection the MAIN range is not: CodeMirror keeps ranges
 * sorted by position, so `ranges[0]` is the topmost row, not the anchor — an upward block anchors at
 * the BOTTOM, and reading the anchor off `ranges[0]` would silently invert it.
 */
function blockOf(state: EditorState): ColumnBlock {
  const tracked = state.field(columnBlockField, false);
  if (tracked) return tracked;

  const tabWidth = state.tabSize;
  const { ranges, mainIndex } = state.selection;
  const head = ranges[mainIndex];
  const anchorEnd = mainIndex === 0 ? ranges[ranges.length - 1] : ranges[0];
  const headLine = state.doc.lineAt(head.head);
  const anchorLine = state.doc.lineAt(anchorEnd.anchor);
  return {
    anchorLine: anchorLine.number,
    anchorCol: columnAt(anchorLine.text, anchorEnd.anchor - anchorLine.from, tabWidth),
    headLine: headLine.number,
    headCol: columnAt(headLine.text, head.head - headLine.from, tabWidth),
  };
}

/** One selection range per row of the block, each clamped to the line it lands on. */
function materialise(state: EditorState, block: ColumnBlock): EditorSelection {
  const tabWidth = state.tabSize;
  const step = block.headLine >= block.anchorLine ? 1 : -1;
  const ranges = [];
  for (let n = block.anchorLine; ; n += step) {
    const line = state.doc.line(n);
    ranges.push(
      EditorSelection.range(
        line.from + offsetAt(line.text, block.anchorCol, tabWidth).offset,
        line.from + offsetAt(line.text, block.headCol, tabWidth).offset,
      ),
    );
    if (n === block.headLine) break;
  }
  // The head row is the LAST one pushed, whichever way the block grew. `EditorSelection.create`
  // sorts the ranges but tracks the main one through the sort, so this index survives it.
  return EditorSelection.create(ranges, ranges.length - 1);
}

/**
 * Grow or shrink a column block by one row or one column (016, FR-025 · US6).
 *
 * The keyboard half of rectangular selection. CodeMirror gives us the Alt+drag; a user who does not
 * use a mouse — or who is simply already typing — gets nothing from that, so the same block must be
 * reachable from the keyboard (`Shift+Alt+Arrow…`).
 */
function moveColumnSelection(view: EditorView, dRow: number, dCol: number): boolean {
  const { state } = view;
  const block = blockOf(state);

  const headLine = Math.min(Math.max(1, block.headLine + dRow), state.doc.lines);

  // The head column is bounded by the WIDEST line the block now covers. Without a bound it would
  // run off into virtual space: hold Right on a block of four-character lines and the block looks
  // unchanged, but its column is now 40 — and the user must then press Left 36 times before
  // anything moves. Clamping to the widest row means Right stops where the text stops.
  let widest = 0;
  const step = headLine >= block.anchorLine ? 1 : -1;
  for (let n = block.anchorLine; ; n += step) {
    const line = state.doc.line(n);
    widest = Math.max(widest, columnAt(line.text, line.length, state.tabSize));
    if (n === headLine) break;
  }
  const headCol = Math.min(Math.max(0, block.headCol + dCol), widest);

  const next: ColumnBlock = { ...block, headLine, headCol };
  view.dispatch({
    selection: materialise(state, next),
    effects: setColumnBlock.of(next),
    scrollIntoView: true,
  });
  return true;
}

export const columnSelectUp: Command = (view) => moveColumnSelection(view, -1, 0);
export const columnSelectDown: Command = (view) => moveColumnSelection(view, 1, 0);
export const columnSelectLeft: Command = (view) => moveColumnSelection(view, 0, -1);
export const columnSelectRight: Command = (view) => moveColumnSelection(view, 0, 1);

/** The rebindable editor commands, as a CodeMirror keymap (FR-017/FR-024b). */
export function editorCommandKeymap(
  keybindings: Keybindings,
  handlers: Partial<Record<ActionId, Command>>,
): Extension {
  const bindings = [];
  for (const [action, run] of Object.entries(handlers) as [ActionId, Command][]) {
    // …NOT `keybindings.bindings[action]`: a chord 012's window-level commands own is never bound
    // here at all, so the keypress is not handled, is not preventDefault'ed, and reaches the window
    // exactly as it would with no editor focused (FR-024b).
    for (const chord of editorChordsFor(keybindings, action)) {
      const key = toCodeMirrorKey(chord);
      if (key) bindings.push({ key, run, preventDefault: true });
    }
  }
  return Prec.highest(keymap.of(bindings));
}

/**
 * throng's chord notation (`Ctrl+Shift+ArrowUp`) in CodeMirror's (`Ctrl-Shift-ArrowUp`).
 *
 * ## The lowercase letter matters, and getting it wrong fails INVISIBLY
 *
 * CodeMirror matches a binding against `KeyboardEvent.key`, which for Ctrl+X — no Shift — is the
 * lowercase `"x"`. A binding written `Ctrl-X` therefore matches nothing at all, and the command
 * never runs.
 *
 * That failure is worse than it sounds, because CodeMirror's OWN cut already removes the whole line
 * when the selection is empty. So `Ctrl+X` still cut the line, the editor looked entirely correct —
 * and `cut-line` had in fact never fired, the clipboard record was never set, and every subsequent
 * paste came back verbatim and empty. The bug was visible only two steps later, in the paste.
 *
 * A letter typed WITH Shift arrives as the uppercase `"X"`, and CodeMirror resolves `Ctrl-Shift-X`
 * through its own base-key path, so those are left alone.
 *
 * Returns null for a chord CodeMirror cannot express — a mouse-wheel binding, for instance, which
 * the keybinding model permits for zoom. Binding it as a key would be nonsense.
 */
export function toCodeMirrorKey(chord: string): string | null {
  if (/wheel/i.test(chord)) return null;
  const parts = chord.split('+').filter(Boolean);
  if (parts.length === 0) return null;

  const key = parts[parts.length - 1];
  const shifted = parts.slice(0, -1).some((p) => p.toLowerCase() === 'shift');
  const normalised = key.length === 1 && !shifted ? key.toLowerCase() : key;

  return [...parts.slice(0, -1), normalised].join('-');
}
