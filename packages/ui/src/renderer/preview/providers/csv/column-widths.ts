/**
 * 073 FR-040 — a CSV's column widths, per FILE: the same widths in every panel showing it, kept across
 * close, reopen and restart as document state in the daemon (`document_state.grid_column_widths`,
 * research R8).
 *
 * The hook reads the file's persisted widths once per file, applies a change at once (and to every other
 * mounted grid of the same file in this window, through the module cache), and writes it through
 * `DocumentClient` — debounced, because a drag reports one width per column per pointer release, and a
 * sequence of Column Width… changes should not be one daemon write each. The window's shutdown drain (019 FR-010)
 * fires a write still waiting out its debounce, so closing throng moments after a drag keeps the width.
 */
import { useCallback, useEffect, useState } from 'react';
import { logCaught, pathCompareKey, relPathUnderRoot } from '@throng/core';
import { useServicesOptional } from '../../../composition-root.js';
import { useProjectsOptional } from '../../../state/projects-store.js';
import { registerLayoutFlusher, trackLayoutSave } from '../../../state/layout-saves.js';

type Widths = Readonly<Record<number, number>>;

/** This window's widths by file, so a second grid of the same file shows the same widths at once. */
const cache = new Map<string, Widths>();
const listeners = new Map<string, Set<(w: Widths) => void>>();
const WRITE_DEBOUNCE_MS = 400;
/** A write waiting out its debounce, by file: its timer, and the write itself for the drain to fire early. */
const pendingWrites = new Map<string, { timer: ReturnType<typeof setTimeout>; fire: () => Promise<unknown> }>();

/** Fire every waiting write now — the shutdown drain's half (MT-04 walk-through, 2026-11-21). */
function flushPendingWrites(): Promise<void> {
  const writes = [...pendingWrites.values()];
  pendingWrites.clear();
  return Promise.all(
    writes.map(({ timer, fire }) => {
      clearTimeout(timer);
      return trackLayoutSave(fire());
    }),
  ).then(() => undefined);
}
registerLayoutFlusher(flushPendingWrites);

function publish(key: string, widths: Widths): void {
  cache.set(key, widths);
  for (const cb of listeners.get(key) ?? []) cb(widths);
}

/** Tests only. */
export function __resetColumnWidthCache(): void {
  cache.clear();
  listeners.clear();
  for (const { timer } of pendingWrites.values()) clearTimeout(timer);
  pendingWrites.clear();
}

/** The keys a stored value may carry: whole column indexes, widths in range. Anything else is dropped. */
export function sanitiseWidths(raw: unknown): Widths {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const col = Number(k);
    if (Number.isInteger(col) && col >= 0 && typeof v === 'number' && Number.isFinite(v)) {
      out[col] = Math.min(2000, Math.max(40, Math.round(v)));
    }
  }
  return out;
}

/** The id of the loaded project rooted at `projectRoot`, or undefined when none is (or no project store is mounted). */
export function useProjectIdForRoot(projectRoot: string): string | undefined {
  const projects = useProjectsOptional()?.projects ?? [];
  return projects.find((p) => pathCompareKey(p.rootFolder) === pathCompareKey(projectRoot))?.id;
}

export function useGridColumnWidths(
  projectRoot: string,
  filePath: string,
): { widths: Widths; setWidth: (col: number, width: number) => void; resetWidth: (col: number) => void } {
  const key = pathCompareKey(filePath);
  const [widths, setWidths] = useState<Widths>(() => cache.get(key) ?? {});
  const documents = useServicesOptional()?.documents;
  const projectId = useProjectIdForRoot(projectRoot);
  const relPath = relPathUnderRoot(projectRoot, filePath);

  useEffect(() => {
    const set = listeners.get(key) ?? new Set();
    set.add(setWidths);
    listeners.set(key, set);
    setWidths(cache.get(key) ?? {});
    return () => {
      set.delete(setWidths);
    };
  }, [key]);

  /*
   * FR-040 (T091) — read the stored widths every time a grid mounts for the file, not once per window: the cache is
   * this window's, and another window (a sub-workspace) may have stored a width since. A width this window has yet to
   * write (a pending debounce) is newer than anything stored, so it wins.
   */
  useEffect(() => {
    if (documents === undefined || projectId === undefined || relPath === null) return;
    let live = true;
    documents
      .getState(projectId, relPath)
      .then((state) => {
        if (live && !pendingWrites.has(key)) publish(key, sanitiseWidths(state?.gridColumnWidths));
      })
      .catch((error: unknown) => logCaught('column-widths: read the file’s widths', error));
    return () => {
      live = false;
    };
  }, [key, documents, projectId, relPath]);

  /** Publish `next` at once and write it through, debounced; an empty map is stored as `null` (nothing stored). */
  const apply = useCallback(
    (next: Widths) => {
      publish(key, next);
      if (documents?.setGridColumnWidths === undefined || projectId === undefined || relPath === null) return;
      const write = documents.setGridColumnWidths.bind(documents);
      const prior = pendingWrites.get(key);
      if (prior !== undefined) clearTimeout(prior.timer);
      const fire = (): Promise<unknown> => {
        const latest = cache.get(key);
        const stored = latest !== undefined && Object.keys(latest).length > 0 ? latest : null;
        return write(projectId, relPath, stored).catch((error: unknown) =>
          logCaught('column-widths: store the file’s widths', error),
        );
      };
      const timer = setTimeout(() => {
        pendingWrites.delete(key);
        void fire();
      }, WRITE_DEBOUNCE_MS);
      pendingWrites.set(key, { timer, fire });
    },
    [key, documents, projectId, relPath],
  );

  const setWidth = useCallback(
    (col: number, width: number) => {
      apply({ ...(cache.get(key) ?? {}), [col]: Math.min(2000, Math.max(40, Math.round(width))) });
    },
    [key, apply],
  );

  /** FR-006a — Reset Column Width: forget the column's stored width, so it shows the default again, after a reopen too. */
  const resetWidth = useCallback(
    (col: number) => {
      const next: Record<number, number> = { ...(cache.get(key) ?? {}) };
      if (!(col in next)) return;
      delete next[col];
      apply(next);
    },
    [key, apply],
  );

  return { widths, setWidth, resetWidth };
}
