/**
 * What KIND of thing throng last copied (016, FR-015c/FR-016b) — pure decision, no OS, no DOM.
 *
 * The mode belongs to the CONTENT, not to the widget that copied it. That is why it is decided here
 * from the SELECTION rather than from the command that fired: `Ctrl+X` with no selection cuts a
 * whole line, `Ctrl+X` over a rectangular block cuts a block, and `Ctrl+X` over an ordinary
 * selection cuts exactly that text. Deciding by command would need every command to remember to say
 * which it was, and the first one to forget would silently paste the wrong shape.
 */

export type ClipboardMode = 'verbatim' | 'full-line' | 'rectangular';

/** One cursor's range. `empty` means a bare caret — no selection at all. */
export interface CursorRange {
  empty: boolean;
}

export interface SelectionShape {
  /** The document's cursors, in document order. */
  ranges: readonly CursorRange[];
  /** The selection was made as a rectangular (column) block. */
  rectangular: boolean;
}

/**
 * The mode of what a copy/cut of this selection puts on the clipboard (FR-016b).
 *
 * - A rectangular block is `rectangular` — it pastes column-wise.
 * - EVERY cursor a bare caret ⇒ `full-line`: the user selected nothing, so the line is the unit,
 *   and the paste inserts a whole line above rather than splitting the destination line.
 * - Anything else — including a MIXED set, where some cursors have a selection and some do not —
 *   is `verbatim`. A mixed set has no single sensible shape, and guessing one would produce a paste
 *   the user did not ask for. Verbatim is the honest answer.
 */
export function clipboardModeFor(selection: SelectionShape): ClipboardMode {
  if (selection.rectangular) return 'rectangular';
  if (selection.ranges.length === 0) return 'verbatim';
  return selection.ranges.every((r) => r.empty) ? 'full-line' : 'verbatim';
}

/** throng's most recent clipboard write. Process-lifetime only; never persisted. */
export interface ClipboardRecord {
  /** Exactly what was written to the OS clipboard. */
  text: string;
  mode: ClipboardMode;
}

/**
 * The mode the NEXT paste should use (FR-015c).
 *
 * The record is validated against what the OS clipboard actually holds right now. If they differ,
 * something else — another application, or the user copying in a browser — has written to the
 * clipboard since, so throng's record describes text that is no longer there and the paste is
 * VERBATIM.
 *
 * Self-correcting by construction: no polling, no clipboard observer, no OS event to miss. The
 * check happens exactly when the answer is needed, and it cannot be stale.
 */
export function pasteModeFor(record: ClipboardRecord | null, liveClipboardText: string): ClipboardMode {
  if (!record) return 'verbatim';
  // Compared with line endings normalised, because the OS clipboard is not a faithful pipe: Windows
  // hands back CRLF whatever you put in. A literal comparison therefore said "someone else has
  // copied since" every single time an LF document copied a line — and EVERY full-line paste
  // silently degraded to verbatim, splitting the line it was pasted into. The question being asked
  // is "is this still OUR text?", and a line ending the OS rewrote in transit does not make it
  // someone else's.
  return sameText(record.text, liveClipboardText) ? record.mode : 'verbatim';
}

function sameText(a: string, b: string): boolean {
  return a === b || normaliseEndings(a) === normaliseEndings(b);
}

function normaliseEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}
