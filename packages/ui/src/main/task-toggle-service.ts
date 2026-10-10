/**
 * 054 US2 — a preview's task-list checkbox, toggled in its source (FR-022 – FR-029,
 * contracts/preview-ipc-054.md `throng:preview:toggleTask`).
 *
 * The preview never writes. It names the line it drew and the item's text; this service finds the marker
 * in the CURRENT text (`locateTaskToggle`) and changes one character:
 *
 * - **Open document** — through `EditorCoordinator.applyExternalEdit`, one undo entry relayed to every
 *   view (FR-024), then saved through the authority iff the document was clean before the edit (FR-025).
 * - **No open document** — `textFileRewrite`, which keeps the file's encoding, BOM and endings (FR-029)
 *   and re-checks `isOpen` before the write; a file that opened meanwhile takes the buffer path.
 *
 * Confinement is the run's own project (Principle I), resolved on the real path.
 */
import {
  applyTaskToggle,
  samePath,
  isUnderPath,
  locateTaskToggle,
  resolveSaveConfinement,
  type IFileSystem,
  type TaskToggleLocateRefusal,
  type TaskToggleRefusal,
  type TaskToggleRequest,
  type TaskToggleResponse,
} from '@throng/core';
import { textFileRewrite } from './text-file-rewrite.js';

/** What the service needs from the editor authority — `EditorCoordinator` satisfies it structurally. */
export interface TaskToggleEditors {
  isOpen(absPath: string): boolean;
  applyExternalEdit<R extends string>(req: {
    absPath: string;
    decide: (text: string) => { changes: readonly { from: number; to: number; insert: string }[] } | { refuse: R };
  }):
    | { kind: 'applied'; documentId: string; wasClean: boolean }
    | { kind: 'refused'; reason: R | 'movedOut' }
    | null;
  save(payload: { panelId: string }): Promise<{ ok: true } | { ok: false; reason: string; error: string }>;
}

/** The preview run a panel shows — `PreviewService.run` satisfies it. */
export type TaskToggleRunLookup = (panelId: string) => { projectRoot: string; filePath: string } | undefined;

/**
 * A save refusal, said in the toggle's vocabulary. `EditorService` reports every OS failure as `io` with
 * the error's message, so the code that names the cause is read from that message.
 */
function saveRefusal(reason: string, error: string): TaskToggleRefusal {
  if (reason === 'out-of-tree') return 'outOfTree';
  if (/\b(?:EACCES|EPERM|EROFS)\b/.test(error)) return 'readOnly';
  if (/\b(?:EBUSY|ETXTBSY)\b/.test(error)) return 'locked';
  if (/\bENOENT\b/.test(error)) return 'missing';
  return 'io';
}

export class TaskToggleService {
  constructor(
    private readonly fs: IFileSystem,
    private readonly editors: TaskToggleEditors,
    private readonly runOf: TaskToggleRunLookup,
  ) {}

  async toggle(req: TaskToggleRequest): Promise<TaskToggleResponse> {
    const run = this.runOf(req.panelId);
    if (run === undefined) return { ok: false, reason: 'io' };
    // The run moved on to another document since the preview drew this one.
    if (!samePath(run.filePath, req.filePath)) return { ok: false, reason: 'changed' };
    const absPath = run.filePath;
    if (!isUnderPath(absPath, run.projectRoot)) return { ok: false, reason: 'outOfTree' };

    if (this.editors.isOpen(absPath)) return this.inBuffer(req, absPath);

    const confinement = resolveSaveConfinement(
      { ownerKind: 'project' },
      { ownerRoot: run.projectRoot, allProjectRoots: [run.projectRoot] },
    );
    const outcome = await textFileRewrite(
      this.fs,
      absPath,
      { allowed: confinement.allowed, isOpen: (p) => this.editors.isOpen(p) },
      (text) => {
        const located = locateTaskToggle(text, req.line, req.expectChecked, req.itemText, req.occurrence);
        return located.ok
          ? { next: applyTaskToggle(text, located), value: null }
          : { next: null, value: located.reason };
      },
    );
    switch (outcome.kind) {
      case 'failed':
        return { ok: false, reason: outcome.reason };
      case 'becameOpen':
        return this.inBuffer(req, absPath);
      case 'unchanged':
        return { ok: false, reason: outcome.value ?? 'io' };
      case 'written':
        return { ok: true, savedToDisk: true };
    }
  }

  private async inBuffer(req: TaskToggleRequest, absPath: string): Promise<TaskToggleResponse> {
    let toggledLine = req.line;
    const applied = this.editors.applyExternalEdit<TaskToggleLocateRefusal>({
      absPath,
      decide: (text) => {
        const located = locateTaskToggle(text, req.line, req.expectChecked, req.itemText, req.occurrence);
        if (!located.ok) return { refuse: located.reason };
        toggledLine = located.line;
        return { changes: [{ from: located.offset, to: located.offset + 1, insert: located.insert }] };
      },
    });
    if (applied === null) return { ok: false, reason: 'io' };
    if (applied.kind === 'refused') {
      return { ok: false, reason: applied.reason === 'movedOut' ? 'outOfTree' : applied.reason };
    }
    // FR-025 — the user's own unsaved edits are never written out by a toggle.
    if (!applied.wasClean) return { ok: true, savedToDisk: false };
    const saved = await this.editors.save({ panelId: applied.documentId });
    if (saved.ok) return { ok: true, savedToDisk: true };
    /*
     * FR-028 — refused, and the box keeps its state: the toggle is taken back out of the buffer, or the
     * document would show (and a later Ctrl+S write) the change the notice says did not happen. Located
     * afresh in the current text, as the inverse of what was applied, so typing during the failed save is
     * left alone; the document's dirty flag compares content, so it reads clean again.
     */
    this.editors.applyExternalEdit<TaskToggleLocateRefusal>({
      absPath,
      decide: (text) => {
        const back = locateTaskToggle(text, toggledLine, !req.expectChecked, req.itemText, req.occurrence);
        return back.ok
          ? { changes: [{ from: back.offset, to: back.offset + 1, insert: back.insert }] }
          : { refuse: back.reason };
      },
    });
    return { ok: false, reason: saveRefusal(saved.reason, saved.error) };
  }
}
