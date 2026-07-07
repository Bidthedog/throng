/**
 * The editor document model (006, data-model §2). The live buffer's metadata as
 * tracked by the UI-main editor coordinator (registry + dirty + lock + recovery).
 * Pure — no I/O, no OS/DOM. The renderer holds the CodeMirror state; UI main holds
 * this coordinator view. Not a SQL entity (rides recovery temp files + the layout
 * blob per research D2/D14).
 */
import type { EncodingId, LineEndingId } from '../workspace/model.js';

/** Who owns the document — a project (confined to its tree) or a sub-workspace
 *  (saved outside every loaded project). Drives confinement (§4). */
export type EditorOwnerKind = 'project' | 'subworkspace';

export interface EditorDocument {
  /** Owning Panel (registry key; matches on restore/mirror). */
  panelId: string;
  ownerKind: EditorOwnerKind;
  /** Set when `ownerKind === 'project'`. */
  ownerProjectId?: string;
  /** Real target path (`null` = new/unpathed). */
  filePath: string | null;
  /** `filePath` basename, or a "new document" placeholder. */
  displayName: string;
  /** `filePath`'s folder relative to the owner root (for the file pill); `null`
   *  for an unpathed doc. */
  relativeFolder: string | null;
  encoding: EncodingId;
  hasBom: boolean;
  lineEnding: LineEndingId;
  /** Has UNSAVED user changes (drives indicators; NOT the recovery temp). */
  dirty: boolean;
  /** `%APPDATA%\throng\recovery\<panelId>`. */
  recoveryTempPath: string;
}

/** Placeholder display name for a brand-new, never-saved document. */
export const NEW_DOCUMENT_NAME = 'Untitled';

/** True when the document has a real on-disk target path. */
export function isPathed(doc: Pick<EditorDocument, 'filePath'>): boolean {
  return doc.filePath !== null && doc.filePath !== undefined;
}
