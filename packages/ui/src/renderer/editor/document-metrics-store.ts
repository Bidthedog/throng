/**
 * Per-DOCUMENT character and word counts, debounced off the keystroke path (040 US1 — FR-003,
 * FR-007, FR-008, FR-008b, FR-008c; data-model.md §3.2, research.md D2 and D5).
 *
 * ══ WHY KEYED BY DOCUMENT AND NOT BY VIEW ══
 *
 * The counts describe the DOCUMENT, so every panel showing it must agree (FR-007). A per-view
 * store would be observationally identical today — two views of one file hold the same content and
 * would compute the same figures — and research.md D5 rejects it anyway: it makes FR-007 true by
 * COINCIDENCE, and the coincidence breaks the moment one view lags the authority by a transaction,
 * which is exactly the window `DocumentReplica` exists to manage. One map buys the requirement
 * structurally.
 *
 * That is also why this store's key scope differs from {@link caret-store}'s. The caret is view
 * state and is keyed by panel; the counts are document state and are keyed by document. Principle
 * XI draws that line, and two stores is what keeps it visible at every call site.
 *
 * ══ WHY DEBOUNCED, AND WHY 200 ms ══
 *
 * Counting is a full scan of the document. At 5 MB that is emphatically not free (FR-008c), and it
 * must never run per keystroke (FR-008). FR-008b grants a 200 ms lag and requires the figure to
 * SETTLE within 200 ms of the last edit — so a trailing-edge debounce is both the simplest
 * implementation and exactly the requirement. During a fast burst the bar may visibly lag; once
 * typing stops it must not stay stale.
 *
 * A per-document timer rather than one shared timer, so a keystroke in one file cannot postpone
 * another file's already-quiet count.
 *
 * ══ WHY A RELOAD INVALIDATES RATHER THAN OVERWRITES ══
 *
 * A file that changed underneath an open editor is reloaded (AS7). A figure standing from the OLD
 * text is then a lie about the document, and one the user has no reason to distrust — so it is
 * WITHDRAWN, and any pending scan of the old text is cancelled with it. Publishing that scan 40 ms
 * later would be the same defect, delayed.
 */
import { useSyncExternalStore } from 'react';
import { countCharacters, countWords } from '@throng/core';

/** What the document contains. Every panel showing it reads this one value (FR-007). */
export interface DocumentMetrics {
  /**
   * Characters, INCLUDING line breaks at ONE each however the file spells them (FR-003a) — so the
   * figure is unchanged by an LF ↔ CRLF conversion. Never `text.length`: that counts a CRLF pair
   * twice and would report two sizes for one document.
   */
  totalCharacters: number;
  /** Maximal runs of non-whitespace (FR-003b) — `foo_bar()` is one word. */
  totalWords: number;
}

/** FR-008b: the figures must settle within this long after the last edit. */
export const METRICS_DEBOUNCE_MS = 200;

/**
 * The document's text, or a thunk that produces it.
 *
 * The caller is CodeMirror's update listener, which holds a `Text` rope. Flattening that rope is
 * O(document) — a 5 MB allocation for a 5 MB file — and doing it per keystroke is exactly the cost
 * FR-008/FR-008c keep off that path, debounce or no debounce. A thunk lets the rope be flattened
 * once, when the scan actually runs, and never for a schedule that a later keystroke supersedes.
 */
export type MetricsText = string | (() => string);

const settled = new Map<string, DocumentMetrics>();
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; text: MetricsText }>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function cancel(docKey: string): void {
  const inflight = pending.get(docKey);
  if (!inflight) return;
  clearTimeout(inflight.timer);
  // Dropping the entry drops the reference to `text` with it. That string is the whole document,
  // and a timer holding a 5 MB buffer alive after the panel closed is a leak nobody would find.
  pending.delete(docKey);
}

/**
 * Ask for this document's counts to be recomputed from `text`, 200 ms after the edits stop.
 *
 * Cheap to call on every document change, which is the point: the expensive half is the scan, and
 * this schedules it rather than running it (FR-008).
 */
export function scheduleDocumentMetrics(docKey: string, text: MetricsText): void {
  cancel(docKey);
  const timer = setTimeout(() => {
    pending.delete(docKey);
    // Resolved HERE, not at the call site: this is the moment the cost is worth paying, and a
    // superseded or cancelled schedule never reaches it.
    const resolved = typeof text === 'function' ? text() : text;
    settled.set(docKey, {
      totalCharacters: countCharacters(resolved),
      totalWords: countWords(resolved),
    });
    emit();
  }, METRICS_DEBOUNCE_MS);
  pending.set(docKey, { timer, text });
}

/**
 * This document's settled counts, or `null` while nothing has settled.
 *
 * Returns the stored object, not a copy: `useSyncExternalStore` compares snapshots by identity, and
 * a fresh object per read renders forever.
 */
export function documentMetrics(docKey: string): DocumentMetrics | null {
  return settled.get(docKey) ?? null;
}

/**
 * The document was RELOADED — withdraw its figure and cancel any scan of the text it replaced
 * (FR-003, AS7). The reloaded content schedules itself in the ordinary way.
 */
export function invalidateDocumentMetrics(docKey: string): void {
  cancel(docKey);
  if (settled.delete(docKey)) emit();
}

/**
 * Drop a document's counts — called from `disposeEditor` once no panel is left showing it.
 *
 * "No panel is left" is the caller's judgement and has to be: the counts are keyed by DOCUMENT
 * (FR-007), so two panels on one file share this entry and disposing either of them must not blank
 * the other one's bar. `use-editor.ts` asks `editor-state` whether any surviving panel names the
 * same document before it calls this.
 */
export function forgetDocumentMetrics(docKey: string): void {
  cancel(docKey);
  if (settled.delete(docKey)) emit();
}

/** Subscribe to any document's counts settling or being withdrawn. */
export function subscribeDocumentMetrics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribe a component to ONE document's counts. */
export function useDocumentMetrics(docKey: string): DocumentMetrics | null {
  return useSyncExternalStore(subscribeDocumentMetrics, () => documentMetrics(docKey));
}

/** Test-only: clear all state and cancel every pending scan. */
export function __resetDocumentMetricsStore(): void {
  for (const key of [...pending.keys()]) cancel(key);
  settled.clear();
  // …and TELL the readers, exactly as every other withdrawal above does (and as
  // `__resetCaretStore` already did). `useSyncExternalStore` re-reads a snapshot only when the store
  // says something moved, so a silent clear leaves a mounted `StatusStrip` painting the figures of a
  // document this store no longer holds — the same lie `invalidateDocumentMetrics` exists to avoid.
  emit();
}
