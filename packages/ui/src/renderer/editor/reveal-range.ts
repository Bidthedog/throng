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
import { getEditorView } from './editor-views.js';

/** Absolute document offsets — `ResultRow`'s own `from`/`to`, which is what a commit rewrites. */
export interface RevealRange {
  from: number;
  to: number;
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
  range: RevealRange,
  opts: { attempts?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    // A LOOKUP each time, never a captured reference: the panel can be destroyed under this loop,
    // and `undefined` then means "there is nothing to reveal in", which is the correct outcome.
    const view = getEditorView(panelId);
    if (view && view.state.doc.length >= range.to) {
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
