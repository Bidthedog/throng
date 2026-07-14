import type { MergeClass } from './document-sync.js';

/**
 * The undo history, as it survives a crash (016, FR-027a/FR-027b · T089).
 *
 * The history is persisted INSIDE the recovery snapshot rather than beside it, and that is a
 * deliberate safety property rather than a convenience: the persisted history contains text the user
 * CUT OR DELETED — an API key removed from a config file lives on in the undo stack long after the
 * file is clean. Anything holding that text must not outlive the snapshot that holds the rest of the
 * document. One file means one lifetime: whatever deletes the snapshot (a save, a close, a discard
 * after recovery) deletes the history with it, and there is no second file to forget about.
 */

/** One undo entry, reduced to JSON. `changes`/`inverted` are CodeMirror `ChangeSet.toJSON()`. */
export interface SerialisedUndoEntry {
  changes: unknown;
  inverted: unknown;
  selectionBefore: unknown;
  viewId: string;
  version: number;
  mergeClass: MergeClass;
  at: number;
}

export interface SerialisedHistory {
  undo: SerialisedUndoEntry[];
  redo: SerialisedUndoEntry[];
}

/**
 * The cap on a persisted history: **1 MiB of serialised JSON per document** (FR-027a).
 *
 * FR-027a required a bound but never named one, and an unnamed bound is a magic number waiting to be
 * chosen differently in two places. The size matters because the snapshot is rewritten on a **400 ms
 * debounce on every keystroke** — so serialising it has to stay cheap. 1 MiB is far larger than any
 * realistic editing session's history, and small enough that writing it cannot stall the debounce
 * that recovery itself depends on.
 *
 * Fixed, not user-configurable — for the same reason as the 500-entry and 10,000-character bounds.
 * Exposing it would demand a descriptor, Settings exposure and completeness coverage (FR-022) for a
 * knob no user has an opinion about.
 */
export const MAX_HISTORY_BYTES = 1_048_576;

/**
 * An entry's size in BYTES — not in UTF-16 code units.
 *
 * `String.length` counts code units, which is what a JavaScript string reports and what is wrong
 * here: the cap is a bound on what is WRITTEN, and the file is UTF-8. A history of CJK or emoji
 * would measure a third of what it costs on disk, so a "1 MiB" cap could quietly write 3 MiB — on
 * the 400 ms debounced path the cap exists to keep cheap.
 */
const sizeOf = (entry: SerialisedUndoEntry): number =>
  new TextEncoder().encode(JSON.stringify(entry)).length;

/**
 * Drop the OLDEST entries until the history fits the cap (FR-027a).
 *
 * **The oldest end is the only end it is SAFE to drop from**, and that is not a preference. An undo
 * stack is a CHAIN: the top entry's inverse is meaningful only against the document as it is now,
 * the one below it only against the document the top entry produced, and so on. Drop an entry from
 * the middle or the top and every entry beneath it now describes a document that never existed —
 * undoing into them would splice fragments of an imaginary file into the user's real one. A
 * contiguous suffix (the most recent N) is the only subset of a stack that remains a valid history.
 *
 * It is also, happily, the subset worth keeping: a user who crashes mid-edit wants the last few
 * steps back, not the first few.
 *
 * If even the newest entry alone exceeds the cap — one enormous paste — the history is emptied
 * rather than truncated, for the same reason: there is no smaller valid history containing it, and
 * keeping the older entries WITHOUT it would be keeping a broken chain.
 *
 * The redo branch is trimmed only after the undo stack is exhausted, because it is the smaller and
 * more transient of the two — it exists only while the user is stepping back and forth — and
 * because trimming it first would not usually free enough to matter.
 */
export function boundHistory(
  history: SerialisedHistory,
  maxBytes: number = MAX_HISTORY_BYTES,
): SerialisedHistory {
  const undo = [...history.undo];
  const redo = [...history.redo];

  // Measured ONCE per entry, not by re-serialising the whole history on every drop — that is the
  // difference between O(n) and O(n²) on the very path the 400 ms debounce is trying to keep cheap.
  const sizes = new Map<SerialisedUndoEntry, number>();
  const size = (entry: SerialisedUndoEntry): number => {
    let cached = sizes.get(entry);
    if (cached === undefined) {
      cached = sizeOf(entry);
      sizes.set(entry, cached);
    }
    return cached;
  };

  let total = [...undo, ...redo].reduce((sum, entry) => sum + size(entry), 0);

  while (total > maxBytes && undo.length > 0) total -= size(undo.shift()!);
  while (total > maxBytes && redo.length > 0) total -= size(redo.shift()!);

  return { undo, redo };
}
