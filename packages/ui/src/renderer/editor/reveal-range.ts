/**
 * Select a range in an editor panel, once there is an editor to select it in (043 T074, FR-038).
 *
 * ══ WHY THIS WAITS, AND WHAT IT WAITS FOR ══
 *
 * FR-038 asks for the matched text HIGHLIGHTED, not merely scrolled into view — so this dispatches
 * a SELECTION, exactly as `navigate/goto-line.tsx` does for a caret. The difference is when it can
 * run. Go To Line acts on a view that is already mounted, because the modal was opened over it.
 * Opening a result row is two asynchronous steps ahead of any view: the open itself is a promise,
 * and where it creates a panel that panel comes from a LAYOUT MUTATION, which React commits on a
 * later turn. `getEditorView(panelId)` is `undefined` for both of them.
 *
 * So the reveal is deferred, and the condition is deliberately not "a view exists". A view mounts
 * before its document arrives — `openFile` reads the file over the bridge — and selecting `from..to`
 * against an empty document would clamp both ends to zero and put the caret at the top of the file,
 * which looks exactly like a reveal that silently did nothing. The condition is a view whose
 * document is long enough to CONTAIN the range.
 *
 * ══ WHAT IT DOES WHEN IT NEVER ARRIVES ══
 *
 * Gives up, quietly, and says so in its return value. The file is open and the user is looking at
 * it; a notice saying the highlight could not be placed names a remedy they cannot act on, which is
 * the pattern FR-057d rejects. The row's own title still carries the line and column.
 */
import { EditorSelection } from '@codemirror/state';
import { detectLanguage, markdownHeadingLine } from '@throng/core';
import { getEditorView } from './editor-views.js';

/** Absolute document offsets — `ResultRow`'s own `from`/`to`, which is what a commit rewrites. */
export interface RevealRange {
  from: number;
  to: number;
}

/**
 * A place that can only be found once the document is IN the editor (044 FR-090d): a heading a followed
 * link named, whose line is a fact about text the opener never had. Resolved against the view's own
 * document the moment it holds one; `null` leaves the caret where the open put it — the top.
 */
export interface RevealResolver {
  resolve(doc: string): RevealRange | null;
}

export type RevealTarget = RevealRange | RevealResolver;

const isResolver = (target: RevealTarget): target is RevealResolver =>
  typeof (target as RevealResolver).resolve === 'function';

/**
 * 044 FR-090d — where the caret goes when a preview link to `absPath#fragment` opens an editor: the start
 * of the heading's line, when the file's language can identify headings. Only Markdown can
 * (`markdownHeadingLine`); for any other file, or no fragment, there is nothing to place and the file
 * opens at its top.
 */
export function headingRevealTarget(absPath: string, fragment: string | undefined): RevealResolver | undefined {
  if (fragment === undefined || fragment.length === 0 || detectLanguage(absPath) !== 'markdown') return undefined;
  return {
    resolve(doc) {
      const line = markdownHeadingLine(doc, fragment);
      if (line === null) return null;
      let offset = 0;
      const lines = doc.split('\n');
      for (let i = 0; i < line - 1 && i < lines.length; i += 1) offset += lines[i].length + 1;
      return { from: offset, to: offset };
    },
  };
}

/**
 * 045 FR-033 / FR-052 — where the caret goes when a link carrying a position opens an editor.
 *
 * ══ A RESOLVER, FOR THE SAME REASON AS THE HEADING ABOVE ══
 *
 * `src/foo.ts:42` names line 42 of a document nobody has read yet: the file may not be open, the
 * panel may not exist, and its content arrives over the bridge a turn or two after the open. A
 * document OFFSET therefore cannot be computed at the call site, only once the view holds the text —
 * which is what {@link RevealResolver} is for.
 *
 * ══ AND IT CLAMPS RATHER THAN REFUSING ══
 *
 * The spec's *position beyond the file's end* edge case. A build log naming line 400 of a file since
 * cut to 80 lines is STALE, not wrong: the user still wants the file. Refusing would either open
 * nothing or raise a notice about a number they never typed, so the caret lands at the nearest valid
 * position — the same answer `resolveGotoLine` gives a typed line number out of range.
 *
 * Line and column are both 1-BASED, as every form in FR-004 writes them.
 */
export function positionRevealTarget(line: number, column?: number): RevealResolver {
  return {
    resolve(doc) {
      // Split on `\n` and let a trailing `\r` count as part of the line's text: the document
      // arrives exactly as it sits on disk, and a CRLF file must not shift every offset by a line.
      const lines = doc.split('\n');
      const index = Math.min(Math.max(Math.trunc(line) || 1, 1), lines.length) - 1;

      let start = 0;
      for (let i = 0; i < index; i += 1) start += (lines[i]?.length ?? 0) + 1;

      const width = lines[index]?.replace(/\r$/, '').length ?? 0;
      const across = column === undefined ? 0 : Math.min(Math.max(Math.trunc(column) || 1, 1), width + 1) - 1;
      const offset = start + across;
      return { from: offset, to: offset };
    },
  };
}

/**
 * How long to keep looking, as a count and an interval.
 *
 * Two seconds in total at the defaults. Long enough for a panel to be created, mount and load a
 * file over the bridge on a busy machine; short enough that a genuinely absent panel — the user
 * closed it, the open was refused — is not held open by a pending promise for the session.
 */
const DEFAULT_ATTEMPTS = 80;
const DEFAULT_INTERVAL_MS = 25;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Select `range` in `panelId`'s editor as soon as one can hold it.
 *
 * Returns whether the selection was actually made. `false` is "the view never arrived", not an
 * error — see the header.
 */
export async function revealRangeInEditor(
  panelId: string,
  target: RevealTarget,
  opts: { attempts?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    // A LOOKUP each time, never a captured reference: the panel can be destroyed under this loop,
    // and `undefined` then means "there is nothing to reveal in", which is the correct outcome.
    const view = getEditorView(panelId);
    // A resolver waits for a document to resolve against — an empty view has not loaded its file yet.
    const range = !isResolver(target)
      ? target
      : view && view.state.doc.length > 0
        ? target.resolve(view.state.doc.toString())
        : undefined;
    if (range === null) return false;
    if (view && range !== undefined && view.state.doc.length >= range.to) {
      view.dispatch({
        // The MATCH selected, head last so the viewport follows the end of it (FR-038).
        selection: EditorSelection.range(range.from, range.to),
        scrollIntoView: true,
        // Not an edit, so it must not join an undo run — `goto-line.tsx`'s reasoning, unchanged.
        userEvent: 'select',
      });
      view.focus();
      return true;
    }
    await delay(intervalMs);
  }
  return false;
}
