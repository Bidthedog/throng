import { clipboardModeFor, type ClipboardMode } from './clipboard-mode.js';

/**
 * `cut-line` — what Ctrl+X takes when nothing is selected (016, FR-016/FR-016a).
 *
 * Pure, and in core, because the rule is a decision about text and not about CodeMirror: given some
 * cursors and a way to find their lines, what comes out and what goes on the clipboard. The editor
 * supplies the line index and applies the result.
 *
 * The semantics are PER CURSOR, and that is the whole substance of it:
 *
 *   • a cursor WITH a selection cuts exactly that selection — never widened to a line. A user who
 *     selected three characters and pressed Ctrl+X must not lose the line they were on;
 *   • a BARE caret cuts its whole line, break and all, so the document ends up one line shorter
 *     rather than one blank line longer;
 *   • the clipboard is marked `full-line` only when EVERY cursor was bare. A mixed set has no single
 *     shape, and guessing one would paste something the user never asked for.
 */

/** One line of the document. CodeMirror's `Text.lineAt()` already returns this shape. */
export interface LineRef {
  /** Offset of the line's first character. */
  readonly from: number;
  /** Offset just past its last character — BEFORE the line break. */
  readonly to: number;
  readonly text: string;
}

/** The document, as much of it as this decision needs. */
export interface LineIndex {
  readonly length: number;
  lineAt(pos: number): LineRef;
}

/** One cursor. `from === to` is a bare caret. */
export interface CursorSpan {
  readonly from: number;
  readonly to: number;
}

export interface CutLineResult {
  /** Exactly what to write to the OS clipboard. */
  clipboardText: string;
  /** The shape to remember it by, for a later paste (FR-015c/FR-016b). */
  mode: ClipboardMode;
  /** Regions to delete, in document order and non-overlapping. Empty for a no-op. */
  changes: CursorSpan[];
}

/**
 * @param cursors    the document's cursors, in any order
 * @param doc        the line index
 * @param lineEnding the DOCUMENT's effective ending — what the clipboard text is terminated with.
 *                   The buffer itself is always LF (the fidelity model normalises on read and
 *                   re-applies on write); the clipboard is handed to OTHER applications, so a CRLF
 *                   document must put CRLF on it or the line arrives unterminated (SC-009a).
 */
export function cutLine(
  cursors: readonly CursorSpan[],
  doc: LineIndex,
  lineEnding: string,
): CutLineResult {
  if (cursors.length === 0) return { clipboardText: '', mode: 'verbatim', changes: [] };

  const mode = clipboardModeFor({
    ranges: cursors.map((c) => ({ empty: c.from === c.to })),
    rectangular: false,
  });

  const pieces: { from: number; to: number; text: string; wholeLine: boolean }[] = [];
  const linesTaken = new Set<number>();

  for (const cursor of cursors) {
    if (cursor.from !== cursor.to) {
      pieces.push({
        from: cursor.from,
        to: cursor.to,
        text: sliceOf(doc, cursor.from, cursor.to),
        wholeLine: false,
      });
      continue;
    }

    const line = doc.lineAt(cursor.from);
    // Two carets on one line cut it ONCE — not twice, and not a line plus a copy of itself.
    if (linesTaken.has(line.from)) continue;
    linesTaken.add(line.from);

    // Take the line's break with it, so the document loses a LINE and not just its contents. The
    // last line has no trailing break to take, so take the one BEFORE it instead — otherwise
    // cutting the final line leaves an empty line exactly where the text used to be.
    const isLast = line.to >= doc.length;
    const from = isLast && line.from > 0 ? line.from - 1 : line.from;
    const to = isLast ? line.to : line.to + 1;

    pieces.push({ from, to, text: line.text, wholeLine: true });
  }

  pieces.sort((a, b) => a.from - b.from);

  return {
    clipboardText: clipboardTextOf(pieces, mode, lineEnding),
    mode,
    changes: pieces.map(({ from, to }) => ({ from, to })),
  };
}

/**
 * A full-line cut is TERMINATED; a verbatim one is not.
 *
 * A cut line is a line: pasted into another application it must arrive as one, which means it ends
 * with a break. A verbatim cut is a fragment the user selected, and appending a break to it would
 * add a line they never had.
 */
function clipboardTextOf(
  pieces: readonly { text: string; wholeLine: boolean }[],
  mode: ClipboardMode,
  lineEnding: string,
): string {
  const texts = pieces.map((p) => p.text);
  if (mode === 'full-line') return texts.map((t) => t + lineEnding).join('');
  return texts.join(lineEnding);
}

/** The document text between two offsets, without requiring the index to expose a slice. */
function sliceOf(doc: LineIndex, from: number, to: number): string {
  let out = '';
  let pos = from;
  while (pos < to) {
    const line = doc.lineAt(pos);
    const end = Math.min(to, line.to);
    out += line.text.slice(pos - line.from, end - line.from);
    if (end < to) out += '\n'; // the break between this line and the next
    pos = line.to + 1;
  }
  return out;
}
