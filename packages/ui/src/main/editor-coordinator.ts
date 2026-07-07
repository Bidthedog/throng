/**
 * EditorCoordinator — the app-wide UI-main owner of editor documents (006,
 * contracts/editor-service.md). Holds the open-document registry (one buffer per
 * file everywhere, FR-011a), the current content of every open document (pushed
 * from renderers via `notifyDirty`, so UI main is the single source of truth for
 * Save-All / recovery / cross-window mirror), the dirty-file lock (FR-028), and
 * the recovery temp files (FR-041/042/043). No daemon involvement.
 *
 * Because UI main holds each document's latest text, Save-All spanning multiple
 * windows, crash recovery, and the cross-window mirror are all served from here
 * without a renderer round-trip for content.
 */
import { dirname } from 'node:path';
import {
  createOpenRegistry,
  editorsInScope,
  isOpenAnywhere,
  isWithinTree,
  openOrFocus,
  partitionByPathed,
  registerOpen,
  unregisterPanel,
  type Disposable,
  type EditorOwnerKind,
  type EncodingId,
  type IFileWatcher,
  type LineEndingId,
  type OpenDecision,
  type SaveAllScope,
  type ScopeEditor,
} from '@throng/core';
import type { EditorService, LoadResult, SaveResult } from './editor-service.js';
import type { EditorRecovery } from './editor-recovery.js';

/** The mutable per-document state UI main tracks. */
interface CoordDoc {
  panelId: string;
  windowId: string;
  ownerKind: EditorOwnerKind;
  ownerProjectId?: string;
  ownerRoot: string | null;
  allProjectRoots: string[];
  tabId: string | null;
  absPath: string | null;
  encoding: EncodingId;
  hasBom: boolean;
  lineEnding: LineEndingId;
  dirty: boolean;
  text: string;
  /** The backing file was deleted while open (FR-099): the buffer is kept + marked
   *  dirty so a save re-creates it, and re-selecting the tab surfaces the error. */
  fileMissing?: boolean;
  /** A one-shot flag so the "changed on disk" notice fires once per external edit
   *  of a dirty document (FR-028), not on every filesystem event. */
  diskChanged?: boolean;
  /** Watch on the doc's folder for external changes (soft detection, FR-028). */
  watch?: Disposable;
  recoveryTimer?: ReturnType<typeof setTimeout>;
}

/** Metadata a renderer supplies when it loads/creates or edits a document. */
export interface DocMeta {
  panelId: string;
  windowId: string;
  ownerKind: EditorOwnerKind;
  ownerProjectId?: string;
  ownerRoot: string | null;
  allProjectRoots: string[];
  tabId: string | null;
  absPath: string | null;
  encoding: EncodingId;
  hasBom: boolean;
  lineEnding: LineEndingId;
}

export interface CoordinatorDeps {
  /** Debounce (ms) before an in-progress edit is flushed to its recovery temp. */
  recoveryDebounceMs?: number;
  /** Relay a mirror message to every OTHER window (Phase E cross-window sync).
   *  `deleted` marks an open editor dirty because its file was removed (FR-099);
   *  `externalChange` warns that a dirty file changed on disk (FR-028). */
  relaySync: (
    fromWebContentsId: number,
    msg: {
      panelId: string;
      text?: string;
      dirty?: boolean;
      deleted?: boolean;
      externalChange?: boolean;
    },
  ) => void;
  /** Raise/focus the window+panel that owns an already-open file (FR-011a). */
  focusEditor?: (windowId: string, panelId: string) => void;
  /** Watch a folder for external file changes — powers soft change-detection
   *  (FR-028). Omitted in tests that don't exercise it. */
  fileWatcher?: IFileWatcher;
}

export class EditorCoordinator {
  private readonly registry = createOpenRegistry();
  private readonly docs = new Map<string, CoordDoc>();

  constructor(
    private readonly service: EditorService,
    private readonly recovery: EditorRecovery,
    private readonly deps: CoordinatorDeps,
  ) {}

  /** Load a file for an editor and register it in the app-wide registry. */
  async load(
    meta: Omit<DocMeta, 'encoding' | 'hasBom' | 'lineEnding' | 'absPath'> & { absPath: string },
  ): Promise<LoadResult> {
    // Ownership (FR-036): a project's file may only be loaded into an editor of
    // that project — never another project's editor. Refuse a cross-project load.
    if (meta.ownerKind === 'project' && meta.ownerRoot && !isWithinTree(meta.absPath, meta.ownerRoot)) {
      return { ok: false, reason: 'io', error: 'That file belongs to another project.' };
    }
    const result = await this.service.load({ absPath: meta.absPath, ownerRoot: meta.ownerRoot });
    if (!result.ok) return result;
    // Re-pointing an editor at a new file: drop its previous registry entry so the
    // old path is no longer considered open (and free of a stale one-buffer claim),
    // and DELETE its recovery temp. panelIds are stable across restarts (persisted in
    // the layout), so a lingering temp holding the OLD file's content would otherwise
    // be restored OVER the new file on the next launch (the freshly-loaded file is
    // clean — there is nothing to recover for it yet).
    const previous = this.docs.get(meta.panelId);
    if (previous?.absPath && previous.absPath !== meta.absPath) {
      this.disposeWatch(previous);
      unregisterPanel(this.registry, meta.panelId);
      if (previous.recoveryTimer) clearTimeout(previous.recoveryTimer);
      // AWAIT the delete: a fast re-point-then-close must not leave the old file's
      // temp on disk (it would be restored over the new file on the next launch).
      await this.recovery.remove(meta.panelId);
    }
    const doc: CoordDoc = {
      panelId: meta.panelId,
      windowId: meta.windowId,
      ownerKind: meta.ownerKind,
      ownerProjectId: meta.ownerProjectId,
      ownerRoot: meta.ownerRoot,
      allProjectRoots: [...meta.allProjectRoots],
      tabId: meta.tabId,
      absPath: meta.absPath,
      encoding: result.encoding,
      hasBom: result.hasBom,
      lineEnding: result.lineEnding,
      dirty: false,
      text: result.text,
    };
    doc.fileMissing = false; // a successful load means the file exists (FR-099)
    this.docs.set(meta.panelId, doc);
    registerOpen(this.registry, meta.absPath, { panelId: meta.panelId, windowId: meta.windowId });
    this.watchDoc(doc); // soft external-change detection (FR-028)
    return result;
  }

  /**
   * A set of files/folders was deleted (FR-099). Every open editor whose backing
   * file was one of them — or lived under a deleted folder — is marked dirty and
   * flagged file-missing, keeping its buffer so the user can save it back to the
   * original location (re-creating the file) or discard via the dirty prompt. The
   * change is mirrored to the owning renderer so its unsaved dot appears at once.
   */
  markDeleted(deletedAbsPaths: readonly string[]): void {
    if (deletedAbsPaths.length === 0) return;
    const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const gone = deletedAbsPaths.map(norm);
    const isUnder = (file: string): boolean => {
      const f = norm(file);
      return gone.some((g) => f === g || f.startsWith(g + '/'));
    };
    for (const doc of this.docs.values()) {
      if (!doc.absPath || doc.fileMissing || !isUnder(doc.absPath)) continue;
      doc.fileMissing = true;
      doc.dirty = true;
      // Back up the surviving buffer immediately (not debounced) so it is recoverable
      // even across an immediate restart (FR-102).
      if (doc.recoveryTimer) {
        clearTimeout(doc.recoveryTimer);
        doc.recoveryTimer = undefined;
      }
      void this.recovery.write(doc.panelId, doc.text);
      // -1 origin: broadcast to ALL windows (no editing renderer to exclude).
      this.deps.relaySync(-1, { panelId: doc.panelId, deleted: true });
    }
  }

  /** Register a new (possibly empty, unpathed) document without reading a file. */
  register(meta: DocMeta, text = ''): void {
    const doc: CoordDoc = {
      panelId: meta.panelId,
      windowId: meta.windowId,
      ownerKind: meta.ownerKind,
      ownerProjectId: meta.ownerProjectId,
      ownerRoot: meta.ownerRoot,
      allProjectRoots: [...meta.allProjectRoots],
      tabId: meta.tabId,
      absPath: meta.absPath,
      encoding: meta.encoding,
      hasBom: meta.hasBom,
      lineEnding: meta.lineEnding,
      dirty: false,
      text,
    };
    this.docs.set(meta.panelId, doc);
    if (meta.absPath) {
      registerOpen(this.registry, meta.absPath, { panelId: meta.panelId, windowId: meta.windowId });
      this.watchDoc(doc); // soft external-change detection (FR-028)
    }
  }

  /** FR-011a: focus the existing editor for an already-open path, else open new. */
  openInto(absPath: string): OpenDecision {
    return openOrFocus(this.registry, absPath);
  }

  isOpen(absPath: string): boolean {
    return isOpenAnywhere(this.registry, absPath);
  }

  /** Raise/focus the window + Panel that already owns a file (FR-011a). */
  focusExisting(windowId: string, panelId: string): void {
    this.deps.focusEditor?.(windowId, panelId);
  }

  /**
   * A renderer reports an edit (or dirty-state change). Updates the stored text +
   * metadata, schedules a recovery write, and relays the mirror to other windows.
   */
  async notifyDirty(fromWebContentsId: number, payload: DocMeta & { dirty: boolean; text: string }): Promise<void> {
    let doc = this.docs.get(payload.panelId);
    if (!doc) {
      this.register(payload, payload.text);
      doc = this.docs.get(payload.panelId)!;
    }
    // Refresh mutable metadata (roots may change as projects come/go).
    doc.windowId = payload.windowId;
    doc.ownerKind = payload.ownerKind;
    doc.ownerProjectId = payload.ownerProjectId;
    doc.ownerRoot = payload.ownerRoot;
    doc.allProjectRoots = [...payload.allProjectRoots];
    doc.tabId = payload.tabId;
    doc.encoding = payload.encoding;
    doc.hasBom = payload.hasBom;
    doc.lineEnding = payload.lineEnding;
    if (payload.absPath) doc.absPath = payload.absPath;
    doc.text = payload.text;

    doc.dirty = payload.dirty;
    if (!doc.dirty) doc.diskChanged = false; // clean again → clear any pending notice

    // Recovery temp (debounced; independent of dirty — FR-041/053).
    this.scheduleRecovery(doc);

    // Cross-window mirror (content + dirty) to other windows (FR-034).
    this.deps.relaySync(fromWebContentsId, {
      panelId: doc.panelId,
      text: doc.text,
      dirty: doc.dirty,
    });
  }

  /** Save one document's stored content (Ctrl+S). `absPath` sets a new location. */
  async save(payload: {
    panelId: string;
    absPath?: string;
    lineEnding?: LineEndingId;
    ownerKind?: EditorOwnerKind;
    ownerRoot?: string | null;
    allProjectRoots?: readonly string[];
  }): Promise<SaveResult | { ok: false; reason: 'no-location'; error: string }> {
    const doc = this.docs.get(payload.panelId);
    if (!doc) return { ok: false, reason: 'io', error: 'No such open document.' };
    const target = payload.absPath ?? doc.absPath;
    if (!target) return { ok: false, reason: 'no-location', error: 'Choose where to save first.' };
    // Save-As onto a path already open in ANOTHER editor would bind two buffers to
    // one file (violates the app-wide one-buffer rule, FR-011a).
    if (target !== doc.absPath) {
      const at = openOrFocus(this.registry, target);
      if (at.action === 'focus' && at.panelId !== doc.panelId) {
        return { ok: false, reason: 'io', error: 'That file is already open in another editor.' };
      }
    }
    if (payload.lineEnding) doc.lineEnding = payload.lineEnding;
    if (payload.ownerKind) doc.ownerKind = payload.ownerKind;
    if (payload.ownerRoot !== undefined) doc.ownerRoot = payload.ownerRoot;
    if (payload.allProjectRoots) doc.allProjectRoots = [...payload.allProjectRoots];

    const result = await this.service.save({
      absPath: target,
      text: doc.text,
      encoding: doc.encoding,
      hasBom: doc.hasBom,
      lineEnding: doc.lineEnding,
      ownerKind: doc.ownerKind,
      ownerRoot: doc.ownerRoot,
      allProjectRoots: doc.allProjectRoots,
    });

    if (!result.ok) return result; // keep the buffer unsaved

    // Success: record the (possibly new) path, mark clean, drop the recovery temp.
    const pathChanged = doc.absPath !== target;
    if (doc.absPath && pathChanged) unregisterPanel(this.registry, doc.panelId);
    doc.absPath = target;
    registerOpen(this.registry, target, { panelId: doc.panelId, windowId: doc.windowId });
    doc.dirty = false;
    doc.fileMissing = false; // the save re-created the file (FR-099)
    doc.diskChanged = false; // our own write is the current on-disk version (FR-028)
    if (pathChanged || !doc.watch) this.watchDoc(doc); // (re)watch the saved location
    // Cancel any pending debounced recovery write so it can't re-create a temp for a
    // now-clean doc after we remove it (FR-043).
    if (doc.recoveryTimer) {
      clearTimeout(doc.recoveryTimer);
      doc.recoveryTimer = undefined;
    }
    void this.recovery.remove(doc.panelId);
    // Mirror the clean state to any other window showing this document, so a synced
    // editor's unsaved dot clears everywhere on save (FR-034). No origin to exclude.
    this.deps.relaySync(-1, { panelId: doc.panelId, dirty: false });
    return result;
  }

  /** Save-All by scope over UI-main's stored content (FR-023); skip+report unpathed. */
  async saveAll(scope: SaveAllScope, ctx: { activeTabId: string | null; activeProjectId: string | null }): Promise<{
    saved: string[];
    skippedUnpathed: string[];
    failed: { panelId: string; reason: string }[];
  }> {
    const scopeEditors: ScopeEditor[] = [...this.docs.values()].map((d) => ({
      panelId: d.panelId,
      tabId: d.tabId ?? '',
      ownerKind: d.ownerKind,
      ownerProjectId: d.ownerProjectId,
      pathed: d.absPath !== null,
    }));
    const ids = editorsInScope(scope, {
      editors: scopeEditors,
      activeTabId: ctx.activeTabId,
      activeProjectId: ctx.activeProjectId,
    }).filter((id) => this.docs.get(id)?.dirty);
    const { pathed, unpathed } = partitionByPathed(ids, scopeEditors);
    const saved: string[] = [];
    const failed: { panelId: string; reason: string }[] = [];
    for (const panelId of pathed) {
      const r = await this.save({ panelId });
      if (r.ok) saved.push(panelId);
      else failed.push({ panelId, reason: r.reason });
    }
    return { saved, skippedUnpathed: unpathed, failed };
  }

  /** Relay a cross-window mirror message (renderer → UI main → other windows). */
  notifySync(fromWebContentsId: number, msg: { panelId: string; text?: string; dirty?: boolean }): void {
    const doc = this.docs.get(msg.panelId);
    if (doc && msg.text !== undefined) doc.text = msg.text;
    if (doc && msg.dirty !== undefined) doc.dirty = msg.dirty;
    this.deps.relaySync(fromWebContentsId, msg);
  }

  /** Tear down a document (Panel destroy/close): stop watching, unregister, clean temp. */
  destroy(panelId: string): void {
    const doc = this.docs.get(panelId);
    if (!doc) return;
    if (doc.recoveryTimer) clearTimeout(doc.recoveryTimer);
    this.disposeWatch(doc);
    unregisterPanel(this.registry, panelId);
    this.docs.delete(panelId);
    void this.recovery.remove(panelId);
  }

  /** Current stored content for a panel, if UI main already holds it (moved
   *  panel / cross-window mirror / restored doc). Null when not open here. */
  getContent(
    panelId: string,
  ): { text: string; dirty: boolean; absPath: string | null; fileMissing: boolean } | null {
    const doc = this.docs.get(panelId);
    if (!doc) return null;
    return { text: doc.text, dirty: doc.dirty, absPath: doc.absPath, fileMissing: !!doc.fileMissing };
  }

  /** Open documents summary (indicators / menus). */
  list(): Array<{
    panelId: string;
    absPath: string | null;
    dirty: boolean;
    ownerKind: EditorOwnerKind;
  }> {
    return [...this.docs.values()].map((d) => ({
      panelId: d.panelId,
      absPath: d.absPath,
      dirty: d.dirty,
      ownerKind: d.ownerKind,
    }));
  }

  /** Files open in a sub-workspace-owned editor (project-overlap guard, FR-038). */
  openSubWorkspaceEditorFiles(): { filePath: string }[] {
    return [...this.docs.values()]
      .filter((d) => d.ownerKind === 'subworkspace' && d.absPath !== null)
      .map((d) => ({ filePath: d.absPath as string }));
  }

  /** Launch-time recovery: return in-progress content by panelId (FR-042). */
  async recover(): Promise<Array<{ panelId: string; text: string }>> {
    return this.recovery.list();
  }

  /**
   * Delete recovery temps for panels that are neither in `keepPanelIds` (the panels
   * that still exist in a persisted layout / sub-workspace) NOR currently open here
   * — i.e. genuine crash orphans (FR-043). Open docs are always kept so a live
   * (possibly lazily-restoring) editor's temp is never deleted out from under it.
   *
   * NB: this is deliberately NOT auto-invoked at launch. Sub-workspaces load lazily
   * (their panel trees aren't known until opened), so a launch-time sweep could not
   * distinguish a genuine orphan from a closed-but-retained sub-workspace editor's
   * temp — deleting the latter would be unsaved-content LOSS. Per-doc cleanup on
   * save/destroy handles the normal cases; this method backs a future explicit
   * "clear recovery" action that can pass the full known panel set.
   */
  async cleanupRecovery(keepPanelIds: readonly string[]): Promise<void> {
    const keep = new Set(keepPanelIds);
    for (const panelId of this.docs.keys()) keep.add(panelId);
    for (const { panelId } of await this.recovery.list()) {
      if (!keep.has(panelId)) await this.recovery.remove(panelId);
    }
  }

  // ── Soft external-change detection (FR-028) ───────────────────────────────────
  // Replaces the old hard dirty-file lock. We no longer prevent other tools from
  // editing an open file; instead we watch its folder and reconcile:
  //   • a CLEAN editor live-reloads the new on-disk content (stays clean);
  //   • a DIRTY editor shows a one-shot "changed on disk" notice (save overwrites);
  //   • a file that vanished is routed through the same path as an in-app delete.

  private watchDoc(doc: CoordDoc): void {
    this.disposeWatch(doc);
    if (!doc.absPath || !this.deps.fileWatcher) return;
    const target = doc.absPath;
    doc.watch = this.deps.fileWatcher.watch(dirname(target), () => {
      void this.onDiskChange(doc.panelId, target);
    });
  }

  private disposeWatch(doc: CoordDoc): void {
    doc.watch?.dispose();
    doc.watch = undefined;
  }

  private async onDiskChange(panelId: string, watchedPath: string): Promise<void> {
    const doc = this.docs.get(panelId);
    if (!doc || doc.absPath !== watchedPath) return; // stale watch after a re-point
    const res = await this.service.load({ absPath: doc.absPath, ownerRoot: doc.ownerRoot });
    if (!res.ok) {
      // Disappeared out from under us (external delete/rename) — same as an in-app
      // delete: keep the buffer, mark dirty + file-missing (FR-099).
      if (!doc.fileMissing) this.markDeleted([doc.absPath]);
      return;
    }
    if (res.text === doc.text) {
      doc.diskChanged = false; // matches our buffer (incl. our own save) — no diff
      return;
    }
    if (!doc.dirty) {
      // Clean editor: adopt the external content (live reload), stay clean.
      doc.text = res.text;
      doc.encoding = res.encoding;
      doc.hasBom = res.hasBom;
      doc.lineEnding = res.lineEnding;
      this.deps.relaySync(-1, { panelId: doc.panelId, text: res.text, dirty: false });
    } else if (!doc.diskChanged) {
      // Dirty editor: warn ONCE that the on-disk file diverged (save will overwrite).
      doc.diskChanged = true;
      this.deps.relaySync(-1, { panelId: doc.panelId, externalChange: true });
    }
  }

  private scheduleRecovery(doc: CoordDoc): void {
    if (doc.recoveryTimer) clearTimeout(doc.recoveryTimer);
    const ms = this.deps.recoveryDebounceMs ?? 400;
    doc.recoveryTimer = setTimeout(() => {
      doc.recoveryTimer = undefined;
      void this.recovery.write(doc.panelId, doc.text);
    }, ms);
  }
}
