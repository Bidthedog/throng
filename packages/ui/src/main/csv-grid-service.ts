/**
 * 073 — the CSV Preview Editor's edits, applied to the file's ONE document (research R1, R2;
 * data-model §2, §3; contracts/preview-ipc-073.md).
 *
 * The grid holds no buffer. It names a grid operation — set these cells, insert rows here — and this
 * service resolves it against the document's CURRENT text (`resolveGridOperation`, core) into the
 * minimal text changes, applied through `EditorCoordinator.applyExternalEdit` as one canonical change:
 * one undo step, relayed to every view, exactly as an editor's own edit would be (Principle XI). Nothing
 * is written to disk; the document is dirty until the user saves (Q3).
 *
 * ══ WHICH DOCUMENT ══
 *
 * - An editor holds the file: the edit applies to that document, and the preview follows it.
 * - Nothing holds it: the first edit opens a GRID DOCUMENT under `csv-grid:<previewPanelId>`, through the
 *   coordinator's ordinary `load` (the editor's read path, confinement and size limit). The preview is
 *   parented to it from then on; an editor opened later joins it as a linked panel, and inherits it when
 *   the preview closes (`release` → `destroy` → hand-over).
 *
 * Edits to one panel are serialised, so a second edit never races the first edit's document opening.
 */
import { logExpected, samePath, validateGridOperation, resolveGridOperation, type CsvGridOperation } from '@throng/core';
import { GRID_DOCUMENT_PREFIX, isGridDocumentId } from './editor-coordinator.js';
import type { LoadResult, SaveResult } from './editor-service.js';

/** The view a grid edit names to the authority: never a renderer replica's id (see `BULK_EDIT_VIEW_ID`). */
export const GRID_VIEW_ID = '__throng:csv-grid__';

/** What the service needs from the editor coordinator — `EditorCoordinator` satisfies it structurally. */
export interface CsvGridEditors {
  documentFor(absPath: string): { panelId: string; windowId: string } | null;
  load(meta: {
    panelId: string;
    windowId: string;
    ownerKind: 'project';
    ownerProjectId?: string;
    ownerRoot: string | null;
    allProjectRoots: string[];
    tabId: string | null;
    absPath: string;
  }): Promise<LoadResult>;
  applyExternalEdit<R extends string>(req: {
    absPath: string;
    decide: (text: string) => { changes: readonly { from: number; to: number; insert: string }[] } | { refuse: R };
  }):
    | { kind: 'applied'; documentId: string; wasClean: boolean }
    | { kind: 'refused'; reason: R | 'movedOut' }
    | null;
  undo(panelId: string, viewId: string): void;
  redo(panelId: string, viewId: string): void;
  save(payload: { panelId: string }): Promise<SaveResult | { ok: false; reason: string; error: string }>;
  destroy(panelId: string): void;
  getContent(panelId: string): { dirty: boolean } | null;
}

/** The CSV run behind a preview panel — `PreviewService.gridRun` / `flush` satisfy it. */
export interface CsvGridRuns {
  gridRun(panelId: string):
    | {
        projectId: string;
        projectRoot: string;
        filePath: string;
        editable: boolean;
        movedOut: boolean;
        windowId: string;
        documentPanelId: string | null;
      }
    | undefined;
  flush(panelId: string): void;
}

export type GridEditResponse =
  | { ok: true; dirty: boolean }
  | { ok: false; reason: 'changed' | 'invalid' | 'unavailable' }
  | { ok: false; reason: 'malformed'; line: number };

export interface GridEditRequest {
  panelId: string;
  filePath: string;
  operation: unknown;
}

/** The grid document id for a preview panel. */
export function gridDocumentIdFor(previewPanelId: string): string {
  return `${GRID_DOCUMENT_PREFIX}${previewPanelId}`;
}

export class CsvGridService {
  /** Per preview panel, the tail of its serialised edits. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly editors: CsvGridEditors,
    private readonly runs: CsvGridRuns,
  ) {}

  edit(req: GridEditRequest): Promise<GridEditResponse> {
    return this.serial(req.panelId, () => this.editNow(req));
  }

  private serial<T>(panelId: string, work: () => Promise<T>): Promise<T> {
    const tail = this.queues.get(panelId) ?? Promise.resolve();
    const next = tail.then(work, work);
    // The queue only orders the work: each caller already receives its own outcome (and its own failure).
    const settled = next.catch((error: unknown) => logExpected('csv-grid: serialise edits', 'a failed edit is answered to its own caller; the queue moves on', error));
    this.queues.set(panelId, settled);
    void settled.then(() => {
      if (this.queues.get(panelId) === settled) this.queues.delete(panelId);
    });
    return next;
  }

  private async editNow(req: GridEditRequest): Promise<GridEditResponse> {
    const operation = validateGridOperation(req.operation);
    if (operation === null) {
      logExpected('csv-grid: edit', 'a grid operation failed validation and changed nothing', new Error('invalid grid operation'));
      return { ok: false, reason: 'invalid' };
    }
    const run = this.runs.gridRun(req.panelId);
    if (run === undefined || !run.editable || run.movedOut) return { ok: false, reason: 'unavailable' };
    if (!samePath(run.filePath, req.filePath)) return { ok: false, reason: 'changed' };

    if (this.editors.documentFor(run.filePath) === null && !(await this.openGridDocument(req.panelId, run))) {
      return { ok: false, reason: 'unavailable' };
    }
    return this.apply(req.panelId, run.filePath, operation);
  }

  /** Open the file as this preview's grid document (data-model §3). False when it could not be read. */
  private async openGridDocument(
    panelId: string,
    run: NonNullable<ReturnType<CsvGridRuns['gridRun']>>,
  ): Promise<boolean> {
    const result = await this.editors.load({
      panelId: gridDocumentIdFor(panelId),
      windowId: run.windowId,
      ownerKind: 'project',
      ownerProjectId: run.projectId,
      ownerRoot: run.projectRoot,
      allProjectRoots: [run.projectRoot],
      tabId: null,
      absPath: run.filePath,
    });
    if (!result.ok) {
      // The run's own read already shows why (FR-026); this is the trace of the refused edit (FR-072).
      logExpected('csv-grid: open the grid document', `the file could not be opened as a document (${result.reason})`, new Error(result.error));
      return false;
    }
    return true;
  }

  private apply(panelId: string, absPath: string, operation: CsvGridOperation): GridEditResponse {
    let faultLine = 0;
    const applied = this.editors.applyExternalEdit<'malformed' | 'unchanged'>({
      absPath,
      decide: (text) => {
        const resolved = resolveGridOperation(text, operation);
        if ('refuse' in resolved) {
          faultLine = resolved.line;
          return { refuse: resolved.refuse };
        }
        // Nothing to change is not an edit: no undo step, no dirty flag.
        return resolved.changes.length === 0 ? { refuse: 'unchanged' } : { changes: resolved.changes };
      },
    });
    if (applied === null) return { ok: false, reason: 'unavailable' };
    if (applied.kind === 'refused') {
      if (applied.reason === 'unchanged') return { ok: true, dirty: this.dirtyOf(absPath) };
      if (applied.reason === 'malformed') {
        logExpected('csv-grid: edit', `the document has an unterminated quote at line ${faultLine}; the grid refused the edit`, new Error('malformed csv'));
        return { ok: false, reason: 'malformed', line: faultLine };
      }
      return { ok: false, reason: 'unavailable' };
    }
    this.runs.flush(panelId);
    return { ok: true, dirty: this.dirtyOf(absPath) };
  }

  private dirtyOf(absPath: string): boolean {
    const doc = this.editors.documentFor(absPath);
    return doc === null ? false : this.editors.getContent(doc.panelId)?.dirty === true;
  }

  /** The document the panel's run follows, or `null`. */
  private documentOf(panelId: string): string | null {
    const run = this.runs.gridRun(panelId);
    if (run === undefined || !run.editable) return null;
    return this.editors.documentFor(run.filePath)?.panelId ?? null;
  }

  /** Undo the document's latest step, whichever view made it (FR-035, 016 FR-026c). */
  undo(panelId: string): { ok: boolean } {
    const doc = this.documentOf(panelId);
    if (doc === null) return { ok: false };
    this.editors.undo(doc, GRID_VIEW_ID);
    this.runs.flush(panelId);
    return { ok: true };
  }

  redo(panelId: string): { ok: boolean } {
    const doc = this.documentOf(panelId);
    if (doc === null) return { ok: false };
    this.editors.redo(doc, GRID_VIEW_ID);
    this.runs.flush(panelId);
    return { ok: true };
  }

  /** Save through the editor's one save path (FR-045). With no document there is nothing unsaved. */
  async save(panelId: string): Promise<SaveResult | { ok: true } | { ok: false; reason: string; error: string }> {
    const doc = this.documentOf(panelId);
    if (doc === null) return { ok: true };
    return this.editors.save({ panelId: doc });
  }

  /**
   * The preview panel is gone for good. Its grid document goes too — or, with an editor linked to it,
   * passes to that editor (the coordinator's hand-over). The renderer has already asked about unsaved
   * work (FR-033).
   */
  release(panelId: string): void {
    const id = gridDocumentIdFor(panelId);
    if (!isGridDocumentId(id)) return;
    this.queues.delete(panelId);
    this.editors.destroy(id);
  }
}
