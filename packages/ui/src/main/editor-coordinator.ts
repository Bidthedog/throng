/**
 * EditorCoordinator — the app-wide UI-main owner of editor documents (006,
 * contracts/editor-service.md). Holds the open-document registry (one buffer per
 * file everywhere, FR-011a), the AUTHORITY for every open document (016, FR-028f —
 * see below), the soft external-change detection (FR-028), and the recovery temp
 * files (FR-041/042/043). No daemon involvement.
 *
 * ## One document, one state (016, constitution XI)
 *
 * 006 kept each document's text here as a plain string, pushed up from whichever
 * renderer last edited it (`notifyDirty`) and relayed back out to the others as a
 * whole-document replace. That made every view a co-equal source of truth, and two
 * views of one document reconciled peer-to-peer — which Principle XI forbids by
 * name, and which gave mirrored views separate undo stacks (breaking FR-026c).
 *
 * That relay is GONE. Each open document now has a {@link DocumentAuthority}: it
 * owns the text, orders every change, rebases anything computed against a stale
 * version, and derives `dirty`. Views are replicas — they echo the user's keystroke
 * locally at once (typing cannot wait for IPC) and send the change here; what comes
 * back is the one ordered canonical stream, which every view applies.
 *
 * Save-All across windows, crash recovery and the cross-window mirror are all served
 * from the authority's text, with no renderer round-trip for content.
 */
import { dirname } from 'node:path';
import {
  createOpenRegistry,
  editorsInScope,
  isOpenAnywhere,
  isUnderPath,
  normaliseForCompare,
  openOrFocus,
  samePath,
  partitionByPathed,
  registerOpen,
  unregisterPanel,
  type CanonicalChangeMsg,
  type DispatchChangeMsg,
  type Disposable,
  type EditorOwnerKind,
  type EncodingId,
  type IFileWatcher,
  type LineEndingId,
  type OpenDecision,
  type ResetDocumentMsg,
  type SaveAllScope,
  type ScopeEditor,
  type SerialisedHistory,
} from '@throng/core';
import { DocumentAuthority } from './document-authority.js';
import type { DropDecision } from '@throng/core';
import type { EditorService, LoadResult, SaveResult } from './editor-service.js';
import type { MovePair } from './files-service.js';
import type { EditorRecovery, RecoveredDoc, RecoverySnapshot } from './editor-recovery.js';

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
  /** THE document. Its text and its dirty state are read from here, never stored
   *  beside it — a second copy would be a second owner (constitution XI). */
  authority: DocumentAuthority;
  /** The backing file was deleted while open (FR-099): the buffer is kept + marked
   *  dirty so a save re-creates it, and re-selecting the tab surfaces the error. */
  fileMissing?: boolean;
  /** A one-shot flag so the "changed on disk" notice fires once per external edit
   *  of a dirty document (FR-028), not on every filesystem event. */
  diskChanged?: boolean;
  /** THRONG is moving this file right now (019, FR-004): between `beginMove` and
   *  `markMoved` its absence from `absPath` is the move in progress, not a delete. */
  movePending?: boolean;
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

/**
 * What UI main sends a renderer about an open document.
 *
 * `change` and `reset` are the authority's canonical stream: EVERY view applies them,
 * the originating one included. The rest are state the views must know about but which
 * no change describes — a save that made the document clean, a file deleted out from
 * under it, an external edit to reconcile.
 */
export interface EditorSyncMsg {
  panelId: string;
  /** One ordered canonical change (016, FR-028f). Applied by every view. */
  change?: CanonicalChangeMsg;
  /** The document was REPLACED — a revert, an external reload, or a resync. */
  reset?: ResetDocumentMsg;
  /** Derived state changed with no accompanying content change (a save, a delete). */
  dirty?: boolean;
  /** The backing file was deleted while open (FR-099). */
  deleted?: boolean;
  /** A dirty document's file changed on disk (FR-028) — a one-shot notice. */
  externalChange?: boolean;
  /** The document's file MOVED, in-app (019, FR-002). Its new absolute path — and the
   *  ONLY thing about the document that changed. Not a reload, not a dirty edit. */
  movedTo?: string;
}

export interface CoordinatorDeps {
  /** Debounce (ms) before an in-progress edit is flushed to its recovery temp. */
  recoveryDebounceMs?: number;
  /**
   * Send a message to renderer windows.
   *
   * `excludeWebContentsId` exists for messages a window already knows about; the
   * canonical change stream passes `-1` so that EVERY window receives it, the
   * originator included. A view cannot be left out of the stream that defines the
   * document — that is precisely how it would drift out of step.
   */
  relaySync: (excludeWebContentsId: number, msg: EditorSyncMsg) => void;
  /**
   * Is `editor.persistUndoHistory` on (FR-027c)? Read at WRITE time, not captured — the user can
   * turn it off mid-session, and the very next snapshot must respect that.
   *
   * REQUIRED, deliberately. It was optional, defaulting to `?? true` — and a privacy setting whose
   * default is "write the user's deleted text to disk" fails OPEN: any future construction that
   * forgot to pass it would persist the history regardless of what the user had chosen, silently,
   * and no test would fail. Making it required means that mistake cannot compile.
   */
  persistUndoHistory: () => boolean;
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

  /**
   * Can this path be opened into a document with these roots? (018 / US9.)
   *
   * A pure question about permission, asked BEFORE anything is opened — so a drop can be refused with a
   * reason, rather than opened and then found unsaveable. It delegates to the same `resolveEntry` the
   * load path uses, which is the whole point: one rule, not two that are supposed to agree.
   */
  async resolveDrop(req: {
    absPath: string;
    ownerKind: EditorOwnerKind;
    ownerRoot: string | null;
    allProjectRoots: string[];
  }): Promise<DropDecision> {
    try {
      return await this.service.resolveEntry(req);
    } catch {
      // `stat` REJECTS when the path is gone — a file deleted between picking it up and letting go, a
      // dangling symlink, a directory whose parent denies traversal. Left bare, that rejection crossed
      // the bridge, rejected the renderer's `resolveDrop` promise, and was swallowed by the `void` on
      // the call — so the drop did NOTHING AT ALL and said nothing about it. That is precisely the
      // silent no-op FR-061 forbids, arriving by the one route nobody tests: the unhappy path of the
      // unhappy path.
      return {
        ok: false,
        reason: 'not-found',
        error: 'That file could not be read — it may have been moved or deleted.',
      };
    }
  }

  /** Load a file for an editor and register it in the app-wide registry. */
  async load(
    meta: Omit<DocMeta, 'encoding' | 'hasBom' | 'lineEnding' | 'absPath'> & { absPath: string },
  ): Promise<LoadResult> {
    // Ownership (FR-036, and 018 / US9 SC-012). This check used to live HERE, and it was three
    // different kinds of wrong: it compared the UNRESOLVED path (so a symlink inside the project
    // walked straight out of it), it had no outside-all-projects branch (so a sub-workspace editor
    // happily opened a project's file and then refused to save it), and it SKIPPED ITSELF when the
    // owner root was unknown — turning a missing fact into permission.
    //
    // It now lives in EditorService.resolveEntry, which is the same code the SAVE path runs, on the
    // same resolved path. Read scope equals write scope because it is one rule, not two that agree.
    const result = await this.service.load({
      absPath: meta.absPath,
      ownerRoot: meta.ownerRoot,
      ownerKind: meta.ownerKind,
      allProjectRoots: meta.allProjectRoots,
    });
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
      authority: new DocumentAuthority(meta.panelId, result.text),
    };
    doc.fileMissing = false; // a successful load means the file exists (FR-099)
    this.docs.set(meta.panelId, doc);
    registerOpen(this.registry, meta.absPath, { panelId: meta.panelId, windowId: meta.windowId });
    this.watchDoc(doc); // soft external-change detection (FR-028)
    // A new document — every view of this panel adopts it, not just the one that asked. Opening a
    // file from the tree into a MIRRORED editor must change the file in both windows.
    this.broadcastReset(doc);
    return result;
  }

  /**
   * Restore crash-recovered content into the AUTHORITY, dirty against the file on disk (FR-102).
   *
   * Restoring it into the requesting view alone would leave that view disagreeing with the document
   * it is a replica of, from its very first frame — and the disagreement would be invisible until
   * the user's next keystroke landed at an offset computed against text nobody else had.
   */
  restoreRecovered(panelId: string, text: string, history?: SerialisedHistory): void {
    const doc = this.docs.get(panelId);
    if (!doc) return;
    doc.authority.reset(text, false); // NOT clean: it is precisely what the file does NOT hold
    // The history is adopted AFTER the reset, because `reset` clears it — the entries it holds
    // describe a document that has just been replaced. Here they describe the document we are
    // replacing it WITH, so they are exactly the past the user is entitled to (FR-027a).
    if (history) doc.authority.restoreHistory(history);
    this.broadcastReset(doc);
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
    // Identity, not spelling: the deleted paths are `node:path.join`'s (back-slashed) while a doc
    // holds the tree's (forward-slashed). Same rule as it always was — now the ONE copy of it
    // (`path-id.ts`), shared with the move signal so the two cannot drift apart (FR-007).
    const isUnder = (file: string): boolean =>
      deletedAbsPaths.some((gone) => isUnderPath(file, gone));
    for (const doc of this.docs.values()) {
      if (!doc.absPath || doc.fileMissing || !isUnder(doc.absPath)) continue;
      doc.fileMissing = true;
      // No version of this document is on disk any more, so it is dirty whatever it
      // holds — and stays dirty until a save re-creates the file (FR-099).
      doc.authority.markUnsaved();
      // Back up the surviving buffer immediately (not debounced) so it is recoverable
      // even across an immediate restart (FR-102).
      if (doc.recoveryTimer) {
        clearTimeout(doc.recoveryTimer);
        doc.recoveryTimer = undefined;
      }
      void this.snapshot(doc);
      // -1: broadcast to ALL windows (no editing renderer to exclude).
      this.deps.relaySync(-1, { panelId: doc.panelId, deleted: true, dirty: true });
    }
  }

  /**
   * throng is about to move these paths — open the bracket (019, FR-004).
   *
   * A move is not atomic from the watch's point of view: the moment `fs.rename` lands, the folder
   * watch fires, `onDiskChange` re-reads a path that no longer exists, and `markDeleted` force-
   * dirties a buffer nobody edited. That window is what #87 is made of, and it is not raced here:
   * `FilesService` announces the move BEFORE the first `fs.move` and closes it in a `finally`, so
   * the window is BRACKETED rather than outlasted. No timer, no grace period, no retry (FR-011
   * condemns exactly that shape one story over).
   *
   * The paths are the ones REQUESTED. Which of them actually go is not known yet — that is
   * `markMoved`'s payload — so this deliberately over-covers: a doc bracketed for a move that
   * never happened just has its flag cleared when the bracket closes.
   */
  beginMove(absPaths: readonly string[]): void {
    if (absPaths.length === 0) return;
    for (const doc of this.docs.values()) {
      const abs = doc.absPath;
      if (!abs) continue;
      // A folder's move takes every document beneath it (FR-005) — by IDENTITY, never by raw
      // spelling: these paths come from `node:path.join`, the doc's came from the tree (FR-007).
      if (absPaths.some((p) => isUnderPath(abs, p))) doc.movePending = true;
    }
  }

  /**
   * A set of files/folders MOVED, and throng is the one that moved them (019, FR-001/FR-002).
   *
   * Every open document named by a pair — or living beneath one — follows its file. This is a
   * PATH mutation and nothing else: the buffer, its dirty state and its undo history are the same
   * objects afterwards, because it is the same document (Principle XI). A `load()` here would be
   * the easy answer and the wrong one — it mints a second original, discards the user's history,
   * and would make a move look exactly like the delete it is not.
   *
   * Nothing here dirties, snapshots or notifies: a move the user asked for is not news (FR-003),
   * and AC5 asserts that a clean move leaves no recovery snapshot at all. `markDeleted` is
   * untouched — a file moved by ANOTHER program is still kept, dirty and recoverable (FR-009).
   */
  markMoved(moves: readonly MovePair[]): void {
    for (const doc of this.docs.values()) {
      // The bracket closes on EVERY doc it opened, moved or not — a flag left set would suppress
      // the dirtying a genuine external delete is entitled to, for the rest of the session.
      doc.movePending = false;
      if (!doc.absPath) continue;
      const newAbs = movedPathOf(doc.absPath, moves);
      if (newAbs === null) continue;
      // The one-buffer registry follows the file: the new path now focuses this editor, and the
      // old one is free — a stale claim there would refuse a later Save-As onto it (`:480`).
      // Unregister-then-register is the pair `save()` already uses for Save-As (`:503-505`).
      unregisterPanel(this.registry, doc.panelId);
      registerOpen(this.registry, newAbs, { panelId: doc.panelId, windowId: doc.windowId });
      doc.absPath = newAbs;
      // The watch is on the doc's FOLDER (`:681-685`), so a cross-folder move MUST re-watch or
      // the document stops noticing external edits to the file it now points at.
      this.watchDoc(doc);
      // -1: every window. A move is a property of the DOCUMENT, so every replica learns it from
      // the one authority rather than each discovering it for itself (Principle XI).
      this.deps.relaySync(-1, { panelId: doc.panelId, movedTo: newAbs });
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
      authority: new DocumentAuthority(meta.panelId, text),
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
   * A view dispatches an edit it has ALREADY shown the user (016, FR-028f).
   *
   * The authority orders it, rebases it if it was computed against a superseded
   * version, and applies it. The canonical result goes to EVERY window — the
   * originating one included, which is what lets its replica advance its version and
   * release the next change it has buffered.
   */
  dispatchChange(meta: DocMeta, change: DispatchChangeMsg): void {
    const doc = this.docs.get(change.documentId);
    if (!doc) return; // the buffer was destroyed under a live view — nothing to apply it to
    this.refreshMeta(doc, meta);

    const canonical = doc.authority.dispatch(change);
    if (!canonical) {
      // The document was REPLACED under this change (a revert, an external reload), so it
      // cannot be rebased and must not be landed. The view that sent it is now holding an
      // edit to a document that no longer exists: put it back in step.
      this.broadcastReset(doc);
      return;
    }

    if (!doc.authority.dirty) doc.diskChanged = false; // clean again → clear any pending notice
    this.scheduleRecovery(doc); // (debounced; independent of dirty — FR-041/053)
    this.deps.relaySync(-1, { panelId: doc.panelId, change: canonical });
  }

  /**
   * Undo (or redo) the last change to a document, whichever view made it (FR-026c).
   *
   * Invoked from a view, but performed HERE, because the stack belongs to the document.
   * The recorded cursor set rides back on the canonical message and is restored only in
   * the view that invoked it (FR-026f).
   */
  undo(panelId: string, viewId: string): void {
    this.applyHistoryStep(panelId, (doc) => doc.authority.undo(viewId));
  }

  redo(panelId: string, viewId: string): void {
    this.applyHistoryStep(panelId, (doc) => doc.authority.redo(viewId));
  }

  /**
   * Discard every unsaved change, back to the content on disk (FR-075).
   *
   * The undo history goes with them — it described text the user has just discarded.
   * A document whose file was deleted has no saved content to return to, so there is
   * nothing to revert TO and the request is refused rather than silently blanking it.
   */
  revert(panelId: string): boolean {
    const doc = this.docs.get(panelId);
    const saved = doc?.authority.savedText;
    if (!doc || saved === null || saved === undefined) return false;

    doc.authority.reset(saved);
    this.broadcastReset(doc);
    if (doc.recoveryTimer) {
      clearTimeout(doc.recoveryTimer);
      doc.recoveryTimer = undefined;
    }
    void this.recovery.remove(doc.panelId);
    return true;
  }

  /** The authority's current state, for a view that is mounting or has fallen out of step. */
  resync(panelId: string): ResetDocumentMsg | null {
    const doc = this.docs.get(panelId);
    if (!doc) return null;
    return this.stateOf(doc);
  }

  private applyHistoryStep(
    panelId: string,
    step: (doc: CoordDoc) => CanonicalChangeMsg | null,
  ): void {
    const doc = this.docs.get(panelId);
    if (!doc) return;
    const canonical = step(doc);
    if (!canonical) return; // nothing left to undo/redo — not an error
    this.scheduleRecovery(doc);
    this.deps.relaySync(-1, { panelId: doc.panelId, change: canonical });
  }

  /**
   * Refresh the metadata a renderer restates with each change — ownership and routing, which move
   * as projects come and go.
   *
   * ## What is deliberately NOT refreshed, and why
   *
   * `encoding`, `hasBom` and `lineEnding` are the FILE's, learnt from its bytes when it was decoded.
   * They are not a view's to restate, and this used to overwrite them from every dispatched change —
   * which was a silent data-fidelity bug with a specific victim: a MIRRORED view.
   *
   * The second window's panel gets its content from `getContent`, which carries no encoding. Its
   * config therefore held the app defaults, so the moment its user typed, a CRLF file's ending was
   * overwritten with LF and its BOM was dropped — and the next save rewrote every line of the file.
   * Nothing in the edited region would have looked wrong; the whole file would have.
   *
   * The bytes decide the encoding. A view does not (FR-023).
   *
   * `absPath` is NOT refreshed either, and for the same reason one story later (019, FR-002 · #87).
   * It is the AUTHORITY's (contracts/move-signal.md §5): it is set by `load` and by `save`, the two
   * acts that decide where a document lives, and every other reader of it — the one-buffer registry,
   * the folder watch, the save target — is kept in step there.
   *
   * A view restating it made the re-point REVERSIBLE BY A KEYSTROKE: a change dispatched before the
   * view received `movedTo` lands after `markMoved`, and it carried the path the file had just left,
   * raw and unnormalised, with no registry or watch update. `save()` then took `doc.absPath` and
   * wrote the buffer to the OLD path, re-creating the moved-from file and silently undoing the
   * user's move. That is #87 itself, arriving through the fix for #87, and it is what AC3 forbids by
   * name. A view cannot tell the document where it lives, any more than it can tell it what it is
   * encoded in.
   */
  private refreshMeta(doc: CoordDoc, meta: DocMeta): void {
    doc.windowId = meta.windowId;
    doc.ownerKind = meta.ownerKind;
    doc.ownerProjectId = meta.ownerProjectId;
    doc.ownerRoot = meta.ownerRoot;
    doc.allProjectRoots = [...meta.allProjectRoots];
    doc.tabId = meta.tabId;
  }

  private stateOf(doc: CoordDoc): ResetDocumentMsg {
    return {
      documentId: doc.panelId,
      text: doc.authority.text,
      version: doc.authority.version,
      dirty: doc.authority.dirty,
    };
  }

  /**
   * Tell every view the document was replaced — they drop whatever they had in flight,
   * because it described the document that has just been discarded.
   *
   * This also puts a view that has drifted back in step: the two are the same act. A
   * replica that has fallen out of step is, precisely, one holding changes to a document
   * that no longer exists.
   */
  private broadcastReset(doc: CoordDoc): void {
    this.deps.relaySync(-1, { panelId: doc.panelId, reset: this.stateOf(doc) });
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
      text: doc.authority.text,
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
    // What we hold IS what the file holds now — so the document is clean, and an undo past
    // this point re-dirties it for free (FR-026d).
    doc.authority.markSaved();
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
    }).filter((id) => this.docs.get(id)?.authority.dirty);
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

  /**
   * The authority's current state for a panel (a moved panel, a mirrored view, a restored
   * doc). Null when no document is open here.
   *
   * `version` is what makes a mounting view a REPLICA rather than a second original: it
   * starts from the authority's version, so the first change it sends is measured against
   * a document the authority recognises.
   */
  getContent(
    panelId: string,
  ): {
    text: string;
    dirty: boolean;
    version: number;
    absPath: string | null;
    fileMissing: boolean;
    encoding: EncodingId;
    hasBom: boolean;
    lineEnding: LineEndingId;
  } | null {
    const doc = this.docs.get(panelId);
    if (!doc) return null;
    return {
      text: doc.authority.text,
      dirty: doc.authority.dirty,
      version: doc.authority.version,
      absPath: doc.absPath,
      fileMissing: !!doc.fileMissing,
      // The FILE's, learnt from its bytes. A mounting view adopts them rather than assuming the app
      // defaults — a mirrored view that assumed LF would show the wrong line ending in its status
      // bar, and offer the wrong one in a Save-As (FR-023).
      encoding: doc.encoding,
      hasBom: doc.hasBom,
      lineEnding: doc.lineEnding,
    };
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
      dirty: d.authority.dirty,
      ownerKind: d.ownerKind,
    }));
  }

  /** Files open in a sub-workspace-owned editor (project-overlap guard, FR-038). */
  openSubWorkspaceEditorFiles(): { filePath: string }[] {
    return [...this.docs.values()]
      .filter((d) => d.ownerKind === 'subworkspace' && d.absPath !== null)
      .map((d) => ({ filePath: d.absPath as string }));
  }

  /** Launch-time recovery: in-progress content — and its undo history — by panelId (FR-042/FR-027a). */
  async recover(): Promise<RecoveredDoc[]> {
    return this.recovery.list();
  }

  /**
   * ONE panel's snapshot — what an editor asks for when it mounts (FR-042/FR-027a).
   *
   * A view used to fetch the whole recovery directory and pick its own entry out of it, which meant
   * every renderer received every OTHER document's snapshot too — and, since 016, the undo histories
   * inside them, holding whatever the user had cut out of those files. The renderer is the least
   * trusted process in the app and it has no business holding the deleted text of documents it is
   * not showing. It asks for its own.
   */
  async recoverOne(panelId: string): Promise<RecoverySnapshot | null> {
    return this.recovery.read(panelId);
  }

  /**
   * Strip every persisted undo history from disk (FR-027c) — what turning `persistUndoHistory` off
   * does, at the moment it is turned off rather than at the next keystroke.
   */
  async purgePersistedHistories(): Promise<void> {
    await this.recovery.purgeHistories();
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
    const res = await this.service.load({
      absPath: doc.absPath,
      ownerRoot: doc.ownerRoot,
      ownerKind: doc.ownerKind,
      allProjectRoots: doc.allProjectRoots,
    });
    // Re-check, because the READ is an await and the document can be re-pointed inside it (019).
    // The guard above answers "is this watch stale?" at a moment when it cannot yet be — a move
    // announced while this load was in flight lands here with `res` describing a path the document
    // has already left. Acting on it either dirties a document whose file is fine (the `!res.ok`
    // branch, i.e. #87 by the back door) or, worse, resets a re-pointed document to the OLD file's
    // content (the clean branch). Both are answers to a question nobody is asking any more.
    if (doc.absPath !== watchedPath) return;
    if (!res.ok) {
      // THRONG is moving this file right now (019, FR-004). It is not missing — it is in flight,
      // and `markMoved` is about to say where it went. Dirtying it here is #87: the buffer goes
      // dirty behind the user, and the save they then make re-creates the file at the path the
      // move just emptied, silently undoing it.
      //
      // No timer decides this and none may be added: the bracket `FilesService` opens BEFORE the
      // first `fs.move` and closes in a `finally` owns the whole window, so there is nothing left
      // to outlast. A grace period here is the `terminate-all` accident in miniature (FR-011).
      if (doc.movePending) return;
      // Disappeared out from under us (external delete/rename) — same as an in-app
      // delete: keep the buffer, mark dirty + file-missing (FR-099).
      if (!doc.fileMissing) this.markDeleted([doc.absPath]);
      return;
    }
    /**
     * Has the FILE changed — or merely the buffer? (FR-028.)
     *
     * `savedText` is what throng last read from, or wrote to, this path: our belief about what is on
     * disk. Comparing the disk against THAT answers the only question the notice is entitled to ask.
     *
     * It used to compare the disk against the live BUFFER, which is a different question and a
     * useless one: a document with unsaved changes differs from the disk BY DEFINITION, so every
     * dirty editor looked externally modified. And because the watch is on the DIRECTORY — it has to
     * be, or a delete could never be noticed — any event in the folder woke every open document in
     * it. Saving one file therefore announced "this file changed on disk" on all the others, and
     * merely having unsaved work was enough to be told, falsely, that somebody else had edited it.
     *
     * "Changed on disk" is a claim about the disk. This is what makes it true.
     */
    const believedOnDisk = doc.authority.savedText;
    if (believedOnDisk !== null && res.text === believedOnDisk) {
      doc.diskChanged = false; // the file is exactly what we last read/wrote — nothing happened
      return;
    }
    if (res.text === doc.authority.text) {
      doc.diskChanged = false; // matches our buffer (incl. our own save) — no diff
      return;
    }
    if (!doc.authority.dirty) {
      // Clean editor: adopt the external content (live reload), stay clean.
      //
      // A REPLACEMENT, not a change: the new content has no relationship to the old, so
      // there is nothing to express as a rebasable edit — and the undo history, which
      // described the file as it was, is cleared with it (FR-026d).
      doc.encoding = res.encoding;
      doc.hasBom = res.hasBom;
      doc.lineEnding = res.lineEnding;
      doc.authority.reset(res.text);
      this.broadcastReset(doc);
    } else if (!doc.diskChanged) {
      // Dirty editor: warn ONCE that the on-disk file diverged (save will overwrite).
      doc.diskChanged = true;
      this.deps.relaySync(-1, { panelId: doc.panelId, externalChange: true });
    }
  }

  /**
   * Take the snapshot: the document, and — unless the user has turned it off — its undo history
   * (FR-027a/FR-027c).
   *
   * The ONE place a snapshot is written, so the persistUndoHistory rule cannot be honoured on the
   * debounced path and forgotten on the immediate one. `persistUndoHistory` governs PERSISTENCE
   * only: the in-memory history is untouched by it, so turning it off never costs the user an undo
   * in the session they are in — only the one they would have had after a crash.
   */
  private async snapshot(doc: CoordDoc): Promise<void> {
    const withHistory = this.deps.persistUndoHistory();
    await this.recovery.write(doc.panelId, {
      version: doc.authority.version,
      text: doc.authority.text,
      ...(withHistory ? { history: doc.authority.serialiseHistory() } : {}),
    });
  }

  private scheduleRecovery(doc: CoordDoc): void {
    if (doc.recoveryTimer) clearTimeout(doc.recoveryTimer);
    const ms = this.deps.recoveryDebounceMs ?? 400;
    doc.recoveryTimer = setTimeout(() => {
      doc.recoveryTimer = undefined;
      void this.snapshot(doc);
    }, ms);
  }
}

/**
 * Where did this document's file go — if it went anywhere? (FR-002/FR-005.)
 *
 * A folder's pair re-points every document beneath it by PREFIX: one pair, N docs. The prefix is
 * measured on the NORMALISED form, because the doc's path is the tree's forward-slashed spelling
 * while the pair's is `node:path.join`'s (FR-007). `normaliseForCompare` rewrites separators in
 * place and drops a trailing one, so slicing at its length always lands on the boundary separator
 * — the remainder therefore begins with one, whichever way it was spelled.
 *
 * The result is spelled the way the DESTINATION is spelled, rather than being a mongrel of the two
 * (`…\dest\pack/one.txt`). Nothing downstream is hurt by a mixed separator — `toDisplayPath`
 * rewrites for the pill and every comparison normalises first — but this path is written into the
 * panel's persisted config verbatim (FR-008), and what lands in the user's config file should be a
 * path they could have typed.
 */
function movedPathOf(absPath: string, moves: readonly MovePair[]): string | null {
  for (const move of moves) {
    if (samePath(absPath, move.from)) return move.to;
    if (isUnderPath(absPath, move.from)) {
      const to = move.to.replace(/[\\/]+$/, '');
      const sep = to.includes('\\') ? '\\' : '/';
      const remainder = absPath.slice(normaliseForCompare(move.from).length);
      return to + remainder.replace(/[\\/]/g, sep);
    }
  }
  return null;
}
