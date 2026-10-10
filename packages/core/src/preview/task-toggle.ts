/**
 * 054 US2 — locating the one task-list marker a preview checkbox click toggles (FR-022, FR-023, FR-027,
 * FR-029; contracts/preview-ipc-054.md).
 *
 * Main runs this against the document's CURRENT text: the line the renderer sends is where the item was
 * when the preview drew it, and the item text is the fingerprint that relocates it if the source moved.
 * The result is a one-character replacement, so line endings, encoding and every other byte survive by
 * construction. Pure — no OS/DOM.
 */

/** A list item's task marker inside any depth of block quote: `> 1. [x] text`. Group 1 is everything up
 * to the marker character, group 2 the marker character, group 3 the item text (absent when empty). */
const TASK_LINE = /^([ \t]*(?:>[ \t]?)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([ xX])\](?:[ \t]+(.*))?$/;

export type TaskToggleLocateRefusal = 'not-found' | 'ambiguous' | 'changed';

/** Where the marker character sits, and what it becomes. */
export interface TaskToggleEdit {
  ok: true;
  /** UTF-16 offset of the marker character in the text. */
  offset: number;
  /** `'x'` to tick, `' '` to untick. */
  insert: 'x' | ' ';
  /** 0-based line the marker was found on. */
  line: number;
}

export type TaskToggleLocation = TaskToggleEdit | { ok: false; reason: TaskToggleLocateRefusal };

/** The trimmed item text of a task line, or `null` when the line is not a task item. */
export function taskItemText(line: string): string | null {
  const match = TASK_LINE.exec(line);
  return match ? (match[3] ?? '').trim() : null;
}

interface SourceLine {
  text: string;
  start: number;
}

function linesOf(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const ending = /\r\n|\n|\r/g;
  let start = 0;
  for (let m = ending.exec(text); m !== null; m = ending.exec(text)) {
    lines.push({ text: text.slice(start, m.index), start });
    start = m.index + m[0].length;
  }
  lines.push({ text: text.slice(start), start });
  return lines;
}

function editAt(line: SourceLine, index: number, expectChecked: boolean): TaskToggleLocation {
  const match = TASK_LINE.exec(line.text) as RegExpExecArray;
  const checked = match[2] !== ' ';
  if (checked !== expectChecked) return { ok: false, reason: 'changed' };
  return { ok: true, offset: line.start + (match[1] as string).length, insert: checked ? ' ' : 'x', line: index };
}

/** Which of the task items with `itemText` a drawn `line` is: `index` of `of`, in document order. */
export interface TaskOccurrence {
  index: number;
  of: number;
}

function matchesOf(lines: readonly SourceLine[], wanted: string): number[] {
  const out: number[] = [];
  lines.forEach((l, i) => {
    if (taskItemText(l.text) === wanted) out.push(i);
  });
  return out;
}

/**
 * The renderer's half of FR-027: in the source it DREW, which occurrence of its text the item at `line`
 * is. `undefined` when that line is not a task item with that text.
 */
export function taskOccurrence(drawn: string, line: number, itemText: string): TaskOccurrence | undefined {
  const matches = matchesOf(linesOf(drawn), itemText.trim());
  const index = matches.indexOf(line);
  return index < 0 ? undefined : { index, of: matches.length };
}

/**
 * The marker to toggle. A toggle never lands on a different item (FR-027):
 *
 * - text no task item has → `not-found`; text exactly one has → that item, wherever it moved;
 * - text several items share → the clicked OCCURRENCE when their count is unchanged since the render, and
 *   `ambiguous` when it changed — the line alone cannot say which, because a stale line may now hold
 *   another item with the same text. Without an occurrence (an older caller), the item at `line` if its
 *   text matches, else `ambiguous`;
 * - an item already in the other state → `changed`.
 */
export function locateTaskToggle(
  text: string,
  line: number,
  expectChecked: boolean,
  itemText: string,
  occurrence?: TaskOccurrence,
): TaskToggleLocation {
  const lines = linesOf(text);
  const matches = matchesOf(lines, itemText.trim());
  if (matches.length === 0) return { ok: false, reason: 'not-found' };
  let index: number | undefined;
  if (matches.length === 1) index = matches[0];
  else if (occurrence !== undefined) index = occurrence.of === matches.length ? matches[occurrence.index] : undefined;
  else index = matches.includes(line) ? line : undefined;
  if (index === undefined) return { ok: false, reason: 'ambiguous' };
  return editAt(lines[index] as SourceLine, index, expectChecked);
}

/** `text` with the located marker replaced — the only character that changes. */
export function applyTaskToggle(text: string, edit: TaskToggleEdit): string {
  return text.slice(0, edit.offset) + edit.insert + text.slice(edit.offset + 1);
}
