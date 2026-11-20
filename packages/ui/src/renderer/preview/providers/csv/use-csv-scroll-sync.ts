/**
 * The CSV grid's half of Synchronise Scrolling (073 FR-033c): the same body contract the Markdown preview keeps
 * (044 FR-113, FR-121f, FR-121g), with a record in place of a block.
 *
 * - The chrome hands down `syncLine` (the linked editor's top line, 0-based) and `syncEcho`. A CHANGED line brings the
 *   record it falls in to the grid's top, unless that record is already there; an echo (the editor following this grid)
 *   is only recorded. A record that spans lines is its first line; a line inside one is that record (`record-lines`).
 * - A scroll this hook did not make — the reader's wheel, scrollbar, pan or keys — is reported once a frame through
 *   `onTopLineChange` as the first line of the record now at the top, unless that record is the one the editor is at.
 *   The scroll the hook made to follow the editor is claimed by its offset and reported to no one, so the two views
 *   cannot chase each other.
 * - Locks and wrap are the grid's: its top row is the first one clear of the locked row, from each row's own height.
 *
 * Nothing here writes into the selection or the document.
 */
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { recordAtLine, recordStartLines, type CsvModel } from '@throng/core';
import type { DataGridHandle } from '../../../grid/data-grid.js';

export interface CsvScrollSyncProps {
  syncLine?: number | null | undefined;
  syncEcho?: boolean | undefined;
  onTopLineChange?: ((line: number, centreLine?: number | null) => boolean | void) | undefined;
  onTopLineRead?: ((read: () => number | null) => void) | undefined;
}

export interface CsvScrollSync {
  /** The grid's scroll handler: pass it to `DataGrid.onScrollChange`. */
  schedule: () => void;
  /**
   * Per record, the 0-based line it starts on — worked out ONCE per parsed document and only when something asks (a sync
   * line, a mark), so a keystroke in a CSV that is not in step with an editor costs none of it (073 T075). The same array
   * serves the follower, the reporter and the sync mark.
   */
  starts: () => Int32Array | null;
}

export function useCsvScrollSync(
  grid: RefObject<DataGridHandle | null>,
  parsed: { text: string; model: CsvModel } | null,
  { syncLine, syncEcho, onTopLineChange, onTopLineRead }: CsvScrollSyncProps,
): CsvScrollSync {
  const cache = useRef<{ of: typeof parsed; starts: Int32Array } | null>(null);
  const parsedRef = useRef(parsed);
  parsedRef.current = parsed;
  const getStarts = useCallback((): Int32Array | null => {
    const p = parsedRef.current;
    if (p === null) return null;
    if (cache.current === null || cache.current.of !== p) cache.current = { of: p, starts: recordStartLines(p.model, p.text) };
    return cache.current.starts;
  }, []);

  const line = syncLine ?? null;
  const echo = syncEcho === true;
  const reportRef = useRef(onTopLineChange);
  reportRef.current = onTopLineChange;

  /** FR-121g — where the editor is, as far as this grid knows: the chrome's latest line, or the line it last drove it to. */
  const editorLine = useRef<number | null>(line);
  const seen = useRef({ line, echo });
  if (seen.current.line !== line || seen.current.echo !== echo) {
    seen.current = { line, echo };
    editorLine.current = line;
  }
  /** The last synced line brought to the top, so a line is applied once. */
  const applied = useRef<number | null>(null);
  /** The scroller's offset right after this hook scrolled it to follow the editor; a scroll at that offset is not the reader's. */
  const own = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  /** A report the chrome could not act on yet, made again when the editor's line next changes. */
  const deferred = useRef(false);

  const topLine = useCallback((): number | null => {
    const s = getStarts();
    const g = grid.current;
    if (s === null || g === null || s.length === 0) return null;
    return s[g.topRow()] ?? null;
  }, [grid, getStarts]);

  const report = useCallback((): void => {
    frame.current = null;
    const g = grid.current;
    const send = reportRef.current;
    if (g === null) return;
    const claimed = own.current;
    if (claimed !== null && g.getScroll().top === claimed) return;
    own.current = null;
    const at = editorLine.current;
    if (send === undefined || at === null) return;
    // Only a view that is in step with an editor works the mapping out at all.
    const s = getStarts();
    if (s === null || s.length === 0) return;
    const row = g.topRow();
    if (row === recordAtLine(s, at)) return;
    const top = s[row];
    if (top === undefined) return;
    if (send(top, s[g.centreRow()] ?? top) === false) {
      deferred.current = true;
      return;
    }
    editorLine.current = top;
  }, [grid, getStarts]);

  const schedule = useCallback((): void => {
    if (frame.current !== null) return;
    frame.current = window.requestAnimationFrame(report);
  }, [report]);

  useEffect(
    () => () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );

  // The editor scrolled: follow it, once per changed line.
  useEffect(() => {
    if (line === null) {
      applied.current = null;
      deferred.current = false;
      return;
    }
    const g = grid.current;
    const s = getStarts();
    if (g === null || s === null || s.length === 0) return;
    if (line !== applied.current) {
      applied.current = line;
      if (!echo) {
        const row = recordAtLine(s, line);
        if (g.topRow() !== row) {
          g.scrollRowToTop(row);
          own.current = g.getScroll().top;
        }
      }
    }
    if (deferred.current) {
      deferred.current = false;
      schedule();
    }
  }, [line, echo, parsed, grid, schedule, getStarts]);

  // FR-121h — the chrome reads the line at the top when it adopts an editor.
  useEffect(() => {
    onTopLineRead?.(topLine);
  }, [onTopLineRead, topLine]);

  return { schedule, starts: getStarts };
}
