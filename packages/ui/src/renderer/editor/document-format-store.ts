/**
 * The document's encoding and line format as each view DISPLAYS it (059 FR-030 … FR-034).
 *
 * A display copy, keyed by panel, written only from what the authority says — the load / adoption answer,
 * the meta relay (`encoding`, `hasBom`, `encodingChosen`, `lineFormat`) and a canonical change carrying
 * `lineFormat` (a conversion, or the undo of one). The authority owns the value (Principle XI); a view
 * never sends this back as truth. The status strip's two indicators and the content menu's checked state
 * read it, so every panel showing the document updates the moment the relay lands (FR-034).
 */
import { useSyncExternalStore } from 'react';
import type { EncodingId, LineEndingId } from '@throng/core';

export interface DocumentFormat {
  encoding: EncodingId;
  hasBom: boolean;
  /** The encoding was chosen by the user (Reopen with Encoding / Change Encoding) rather than detected. */
  encodingChosen: boolean;
  /** The uniform ending, or the DOMINANT one when `mixed`. */
  lineEnding: LineEndingId;
  mixed: boolean;
  /**
   * 059 FR-059 — a mixed document's per-break record (one ending per line break, in order), when the
   * authority relays it. View Whitespace draws each line's own ending from it.
   */
  lineEndings?: readonly LineEndingId[];
}

function sameEndings(a: readonly LineEndingId[] | undefined, b: readonly LineEndingId[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((e, i) => e === b[i]);
}

const formats = new Map<string, DocumentFormat>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Record what the authority last said about this panel's document. An unchanged value emits nothing. */
export function setDocumentFormat(panelId: string, next: DocumentFormat): void {
  const prev = formats.get(panelId);
  const same =
    prev !== undefined &&
    prev.encoding === next.encoding &&
    prev.hasBom === next.hasBom &&
    prev.encodingChosen === next.encodingChosen &&
    prev.lineEnding === next.lineEnding &&
    prev.mixed === next.mixed &&
    sameEndings(prev.lineEndings, next.lineEndings);
  if (same) return;
  formats.set(panelId, { ...next });
  emit();
}

export function getDocumentFormat(panelId: string): DocumentFormat | null {
  return formats.get(panelId) ?? null;
}

export function forgetDocumentFormat(panelId: string): void {
  if (formats.delete(panelId)) emit();
}

export function useDocumentFormat(panelId: string): DocumentFormat | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => formats.get(panelId) ?? null,
  );
}

/** Test seam. */
export function __resetDocumentFormats(): void {
  formats.clear();
  emit();
}
