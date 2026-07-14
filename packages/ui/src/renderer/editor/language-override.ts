/**
 * The document language override — read, applied, and persisted (016, FR-005a/FR-028b/FR-028e).
 *
 * The override is DOCUMENT state, not panel state, and that distinction is the whole reason it is
 * in SQLite rather than the layout blob: a panel opening the file LATER — next week, in another
 * window, in a sub-workspace — must ADOPT the user's decision rather than re-detect and overrule it.
 */
import type { DocumentClient } from '../state/document-client.js';
import { applyLanguage, claimLanguage, effectiveLanguage, setPanelLanguage } from './editor-language.js';
import { getEditorView } from './editor-views.js';

/** Normalise a path for comparison: forward slashes, lower-cased (Windows is case-insensitive). */
function normalise(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

/**
 * The project-relative path of `absPath` within `projectRoot`, or null when the file lies outside
 * it — a sub-workspace-owned editor saves outside every project and has no project to key against,
 * so it simply has no persisted override. That is a real limitation of Part 1, not a bug: the row
 * is keyed by project because a file belongs to exactly one project (Principle I).
 */
export function toRelPath(projectRoot: string | null, absPath: string | null): string | null {
  if (!projectRoot || !absPath) return null;
  const root = normalise(projectRoot).replace(/\/$/, '');
  const file = normalise(absPath);
  if (!file.startsWith(`${root}/`)) return null;
  // Preserve the ORIGINAL case in what is stored — only the comparison is case-insensitive.
  return absPath.replace(/\\/g, '/').slice(projectRoot.length).replace(/^\//, '');
}

export interface SetOverrideArgs {
  panelId: string;
  projectId: string | null;
  relPath: string | null;
  languageId: string;
  documents: DocumentClient;
  /** The file's path, so detection can be re-run when the override is cleared. */
  filePath?: string | null;
  userMapping?: Readonly<Record<string, string>>;
}

/**
 * Apply a language choice to the live view and persist it.
 *
 * The view is updated FIRST and the write happens behind it: the user's own decision must not wait
 * on a database round-trip to become visible. A failed write leaves the document rendered the way
 * they asked and simply not remembered — which is the right way round.
 */
export async function setDocumentOverride(args: SetOverrideArgs): Promise<void> {
  const { panelId, projectId, relPath, languageId, documents } = args;

  const view = getEditorView(panelId);
  if (view) {
    // The picker CLAIMS the slot, like any other request. An override chosen while a file's own
    // language load was still in flight would otherwise be overwritten by it a moment later — the
    // user picks Shell, watches it apply, and sees it silently revert.
    const isCurrent = claimLanguage(panelId);
    setPanelLanguage(panelId, { languageId, source: 'override' });
    void applyLanguage(view, languageId, () => getEditorView(panelId) === view && isCurrent());
  }

  if (!projectId || !relPath) return; // nothing to key the row against (see toRelPath)
  try {
    await documents.setState(projectId, relPath, languageId);
  } catch (err) {
    console.error('[throng] could not persist the language override', err);
  }
}

export interface LoadOverrideArgs {
  panelId: string;
  projectId: string | null;
  relPath: string | null;
  filePath: string | null;
  documents: DocumentClient;
  userMapping?: Readonly<Record<string, string>>;
  /**
   * False once this request is STALE — the view has gone away, or the panel has since been pointed
   * at another file.
   *
   * It is not enough to ask "does the view still exist?". Every step of this function suspends (a
   * database read, then a dynamic `import()` of a grammar chunk), and a user clicking through the
   * tree starts a fresh request before the previous one has finished. Without a freshness check the
   * winner is whichever chunk ARRIVED last rather than whichever file was ASKED for last — and a
   * warm chunk beats a cold one, so the outcome depends on which file you happened to open before.
   */
  stillMounted: () => boolean;
}

/**
 * Read the document's persisted override on open and apply the resolved language.
 *
 * This is what makes the override DURABLE and SHARED: the panel that opens the file adopts it,
 * whichever panel set it and whenever. The override OUTRANKS detection (FR-005a) — but an id this
 * build no longer knows falls through to detection with the stored id left untouched (FR-005b).
 */
export async function loadDocumentOverride(args: LoadOverrideArgs): Promise<void> {
  const { panelId, projectId, relPath, filePath, documents, userMapping, stillMounted } = args;

  let override: string | null = null;
  if (projectId && relPath) {
    try {
      override = (await documents.getState(projectId, relPath))?.languageId ?? null;
    } catch (err) {
      // A store that cannot be read must not stop the file opening — it just opens undecorated by
      // the user's past decision, which is exactly what happens for a file that never had one.
      console.error('[throng] could not read the language override', err);
    }
  }
  // Checked AFTER the read: this resolution describes the file that was open when it STARTED, and
  // by now the panel may be showing another (see `stillMounted`'s doc — it means "still the newest
  // request", not merely "the view exists").
  if (!stillMounted()) return;

  const resolution = effectiveLanguage({ filePath, override, userMapping });
  setPanelLanguage(panelId, resolution);
  const view = getEditorView(panelId);
  if (view) void applyLanguage(view, resolution.languageId, stillMounted);
}
