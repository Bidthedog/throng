/**
 * Per-DOCUMENT word-wrap state (024 US1, #152).
 *
 * Word wrap for an editor is a property of the DOCUMENT, not the panel (constitution Principle XI):
 * every Panel showing the same file must wrap together, so the flag is keyed by the document's
 * identity (its file path), NOT by panel id. This store is the single authority for that value within
 * a window; each editor view derives from it and reconfigures its CodeMirror line-wrapping when it
 * changes. It is in-memory only — a document closed everywhere and reopened starts from the
 * `editor.defaultWordWrap` preference again (FR-003), which the seed argument carries.
 *
 * A document with no file path (an untitled buffer) is its own document — keyed by a per-panel
 * sentinel so two untitled editors are independent.
 *
 * Cross-WINDOW sync (the same file open in a sub-workspace window) is not wired here — like the
 * language resolution, each window resolves its own view; the shared cross-window authority is a
 * later increment. Within a window, two Panels on one file wrap together.
 */
import { useSyncExternalStore } from 'react';

/** The document key for an editor: its file path, or a per-panel sentinel for an untitled buffer. */
export function wordWrapDocKey(filePath: string | null, panelId: string): string {
  return filePath != null ? `file:${filePath}` : `panel:${panelId}`;
}

const wrap = new Map<string, boolean>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Read the wrap flag for a document, seeding it from the type default on first sight. */
export function documentWordWrap(docKey: string, seedDefault: boolean): boolean {
  const cur = wrap.get(docKey);
  if (cur === undefined) {
    wrap.set(docKey, seedDefault);
    return seedDefault;
  }
  return cur;
}

/** True once this document has been seen (so a caller can decide whether to seed). */
export function hasWordWrap(docKey: string): boolean {
  return wrap.has(docKey);
}

export function setDocumentWordWrap(docKey: string, on: boolean): void {
  if (wrap.get(docKey) === on) return;
  wrap.set(docKey, on);
  emit();
}

/** Toggle the document's wrap; returns the new value. Seeds from `seedDefault` if unseen. */
export function toggleDocumentWordWrap(docKey: string, seedDefault: boolean): boolean {
  const next = !documentWordWrap(docKey, seedDefault);
  wrap.set(docKey, next);
  emit();
  return next;
}

/** Drop a document's wrap state — called when the document is closed in every Panel (FR-003). */
export function forgetWordWrap(docKey: string): void {
  if (wrap.delete(docKey)) emit();
}

/** Subscribe a component to a document's wrap flag. */
export function useDocumentWordWrap(docKey: string, seedDefault: boolean): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => documentWordWrap(docKey, seedDefault),
  );
}

/** Test-only: clear all state. */
export function __resetWordWrapStore(): void {
  wrap.clear();
  emit();
}
