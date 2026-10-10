/**
 * 054 US2 — ticking a task-list checkbox in a preview (FR-020 – FR-028, research R4,
 * contracts/preview-ipc-054.md).
 *
 * The renderer half: what the body reads off the checkbox and the source, the call to main, and the one
 * notice a refusal raises. Main locates the marker and applies the edit; the preview never writes a file.
 * A success needs nothing here — main's content relay re-renders the preview, and the body's update path
 * keeps the scroll position (FR-026).
 */
import { failureWording } from '../find-in-files/commit-replace.js';

/** `throng:preview:toggleTask`'s request (contracts/preview-ipc-054.md). */
export interface TaskToggleRequest {
  panelId: string;
  filePath: string;
  /** 0-based source line, from `data-task-line`. */
  line: number;
  /** The state the reader saw before clicking. */
  expectChecked: boolean;
  /** The item's text after the marker, trimmed — main's relocation fingerprint. */
  itemText: string;
}

export type TaskToggleRefusal =
  | 'not-found'
  | 'ambiguous'
  | 'changed'
  | 'readOnly'
  | 'locked'
  | 'missing'
  | 'outOfTree'
  | 'binary'
  | 'encoding'
  | 'io';

export type TaskToggleResponse = { ok: true; savedToDisk: boolean } | { ok: false; reason: TaskToggleRefusal };

/** What a body reports when the reader asks for a toggle; the chrome adds the panel and the file. */
export type TaskToggle = Pick<TaskToggleRequest, 'line' | 'expectChecked' | 'itemText'>;

/** The attribute the pipeline puts on a task box, and the sanitiser keeps only on its own (R4). */
export const TASK_LINE_ATTRIBUTE = 'data-task-line';

/** A list item's task marker, inside any depth of block quote: `> - [x] text` → `text`. */
const TASK_LINE = /^[ \t]*(?:>[ \t]?)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ xX]\](?:[ \t]+(.*))?$/;

/** The task box `target` is, when it is one the pipeline drew — `null` for anything else. */
export function taskBoxOf(target: EventTarget | null): HTMLInputElement | null {
  if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox' || target.disabled) return null;
  const line = target.getAttribute(TASK_LINE_ATTRIBUTE);
  return line !== null && /^\d+$/.test(line) ? target : null;
}

/**
 * The toggle a task box asks for, against `source` — the text the body DREW, so the line is the one the
 * reader saw. The expected state is the box's rendered `checked` attribute, not its live property: during a
 * click the engine has already flipped the property before any handler runs.
 */
export function taskToggleFor(box: HTMLInputElement, source: string): TaskToggle {
  const line = Number(box.getAttribute(TASK_LINE_ATTRIBUTE));
  const sourceLine = source.split(/\r\n|\n|\r/)[line] ?? '';
  const match = TASK_LINE.exec(sourceLine);
  const itemText = match ? (match[1] ?? '').trim() : (box.parentElement?.textContent ?? '').trim();
  return { line, expectChecked: box.defaultChecked, itemText };
}

/** The test id of a preview's one task notice (FR-028: one notice, on the preview). */
export function taskNoticeTestId(panelId: string): string {
  return `preview-task-notice-${panelId}`;
}

/** The heading's action: `Couldn't change the task in {panel}`. */
export const TASK_NOTICE_ACTION = 'change the task in';

/**
 * What a refusal says (030 FR-040: never a raw reason). The file-level reasons are the replace path's own
 * wording — one condition, one sentence — except encoding, whose wording there is about replacing.
 */
export function taskNoticeMessage(reason: TaskToggleRefusal): string {
  switch (reason) {
    case 'not-found':
    case 'ambiguous':
    case 'changed':
      return 'The task is no longer where the preview shows it — the file changed. Try again once the preview updates.';
    case 'encoding':
      return 'The file is not UTF-8 text, so it was left unchanged.';
    default: {
      const why = failureWording(reason);
      return `The file was left unchanged: ${why}.`;
    }
  }
}
