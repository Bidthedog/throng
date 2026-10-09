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
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  createOpenRegistry,
  editorsInScope,
  initialFold,
  isMissingReason,
  isOpenAnywhere,
  isUnderPath,
  movedPathOf as coreMovedPathOf,
  openOrFocus,
  samePath,
  partitionByPathed,
  registerOpen,
  unregisterPanel,
  verifyEdits,
  type CanonicalChangeMsg,
  type DispatchChangeMsg,
  type Disposable,
  type EditorOwnerKind,
  type EncodingId,
  type FoldState,
  type IFileWatcher,
  type LineEndingId,
  type Match,
  type MatchModes,
  type OpenDecision,
  type PersistedHistory,
  type ResetDocumentMsg,
  type SaveAllScope,
  type ScopeEditor,
  type SerialisedHistory,
} from '@throng/core';
import { ChangeSet, type Text } from '@codemirror/state';
import { DocumentAuthority } from './document-authority.js';
import type { DropDecision } from '@throng/core';
import type { EditorService, LoadResult, SaveResult } from './editor-service.js';
import type { MovePair } from './files-service.js';
import type { EditorRecovery, RecoveredDoc, RecoverySnapshot } from './editor-recovery.js';

/**
 * The view a bulk edit claims to come from (043 T085, research R7).
 *
 * Deliberately not a real view id and deliberately stable. `DocumentAuthority` uses the originating
 * view to let a replica recognise its OWN acknowledgement and apply nothing — so a commit must name
 * a view no replica answers to, or the one view that happened to share the id would silently skip
 * the change and drift out of step with its own document.
 */
const BULK_EDIT_VIEW_ID = '__throng:bulk-edit__';

/** 052 FR-012 (data-model "Coordinator document state") — a plain Save of a replaced document. */
const REPLACED_SAVE_REFUSAL = 'This file was replaced. Use Save As to keep your changes.';

/**
 * `PreviewService`'s (044 u7) window onto the editor registry — contracts/preview-ipc.md §3
 * (amended 2026-09-15).
 *
 * Optional: with none injected, the coordinator's behaviour and `relaySync` output are identical to
 * before this existed (`editor-coordinator-lifecycle.integration.test.ts`, parity block).
 *
 * ## One call per logical event
 *
 * `registered`/`unregistered` and `repointed` are disjoint. `load()` or `register()` putting a
 * DIFFERENT file into a panel fires `unregistered(old)` then `registered(new)` — the old document is
 * gone, so a preview parented to it falls back to standalone (FR-013b). `markMoved` and a Save As of a
 * pathed document fire one `repointed` — the SAME document, wearing a new path (FR-013c) — even though
 * the one-buffer registry unregisters and re-registers underneath. The first Save As of an UNPATHED
 * document fires `registered(to)`: a document now exists for that file, and a standalone preview of it
 * becomes parented (FR-013a). Loading the SAME path into the same panel again announces no identity
 * change; only the `changed`/`dirtyChanged` it caused. Pairs therefore always balance.
 *
 * ## Exactly once per transition
 *
 * `changed` fires whenever canonical text changed: an edit, a bulk replace, an undo or redo, AND every
 * reset (revert, restore recovered, live disk reload, reload from disk, auto-recovery) — and once per
 * flip of `getContent().contentless` (the document has no content of its file to follow: the FR-106d
 * stand-in, a restore-time unloadable register, until the path reads), text or no text, because a
 * parented preview shows FR-026's notice exactly while that holds (adversarial review main item 1, fix
 * round 1 ruling). A document that was read and then lost its file keeps its buffer and is NOT
 * contentless, so deleting its file fires no `changed`. `dirtyChanged`
 * fires exactly once per flip of the document's dirty state, whatever caused it, and never when nothing
 * flipped. `registered` starts a new baseline: the listener reads a newly registered document's
 * initial state from `getContent`.
 *
 * ## Isolation
 *
 * Every call is made after the coordinator's own state and relays have settled, inside a try/catch
 * that logs. A throwing listener never aborts a save, move, load, destroy or relay.
 */
export interface DocumentLifecycleListener {
  /** A document now exists for `absPath`: load, register with a path, or first Save As of an unpathed one. */
  registered(absPath: string, documentPanelId: string): void;
  /** The document at `absPath` is gone: destroyed, or replaced by a different file in its panel. */
  unregistered(absPath: string, documentPanelId: string): void;
  /** The SAME document moved from `from` to `to`: an in-app move, or a Save As of a pathed document. */
  repointed(from: string, to: string, documentPanelId: string): void;
  /** The document's canonical text changed (an edit, bulk replace, undo/redo, any reset), or `contentless` flipped. */
  changed(documentPanelId: string): void;
  /** The document's dirty state flipped. Once per flip, never otherwise. */
  dirtyChanged(documentPanelId: string, dirty: boolean): void;
}

/**
 * `NavigationHistoryService`'s face as the coordinator calls it (044 US7, T152,
 * contracts/navigation-history.md §3 *Editors*). Optional: with none injected nothing is recorded and
 * every other behaviour is unchanged.
 *
 * NOT a {@link DocumentLifecycleListener}: that slot holds one listener and it is `PreviewService`'s. The
 * coordinator calls these itself — from `load`, where recording and moving happen, and from the Save-As
 * re-point in `save`. An in-app move is NOT here: main's combined `onMoved` callback rewrites every
 * history once, and doing it from `markMoved` as well would do it twice.
 *
 * Isolated like the listener: a throwing history never aborts a load or a save.
 */
export interface EditorHistoryHooks {
  /** Adopt-if-absent with no recording — a restoring load that was refused (§6). */
  attach(panelId: string, kind: 'editor', persisted: PersistedHistory | undefined): unknown;
  /**
   * A file opened into the panel by any route but Back and Forward (FR-103, FR-103a). `persisted`, when
   * a restoring load carries one, is adopted first if the panel has no record (§6, amended).
   */
  recordOpen(panelId: string, filePath: string, persisted?: PersistedHistory): void;
  /** Back or Forward landed: move to `index` if that entry still names `filePath` (FR-102). Adopts as above. */
  moveTo(panelId: string, index: number, filePath: string, persisted?: PersistedHistory): unknown;
  /** Save As gave the panel's document a new path: the current entry follows it (R14, FR-109). */
  rewriteCurrent(panelId: string, filePath: string): void;
}

/** `throng:editor:load`'s history intent — Back or Forward (contracts/navigation-history.md §3). */
export interface EditorLoadNavigation {
  kind: 'history';
  /** The entry the renderer chose from its mirrored history. */
  index: number;
  /** The file it named, which main checks is still what that entry names. */
  filePath: string;
}

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
  /**
   * The document's path could not be READ when this panel adopted it (027 / #161).
   *
   * Deliberately NOT `fileMissing`, which looks like the same fact and is not. `fileMissing` drives
   * the tab-open "cannot open file" dialog, and FR-105 requires that dialog to stay silent on a
   * remount — which is the exact moment this state must still be visible. Publishing one through
   * the other reddened `editor-missing-aggregate` on both its cases when this was first attempted;
   * they are two facts and they need two fields.
   *
   * It exists so the editor can say "this is what your file USED TO SAY" instead of presenting a
   * blank — or, worse, a remembered — buffer as the file. Cleared by any successful read of the
   * path: a load, a save that re-creates it, a reload, or the auto-recovery below.
   */
  unloadable?: boolean;
  /**
   * This document's path has NEVER been read into this panel — the FR-106d stand-in (044), an empty
   * document put in by Back or Forward onto a file that was already gone, and a restore-time
   * `register(…, { unloadable: true })` whose file could not be read (027 / #161). Cleared the moment the
   * path reads (auto-recovery, reload), a save writes it, or recovered text is restored into it — from then
   * on the document holds content of its own to keep and to follow.
   *
   * It exists for the folder watch. `onDiskChange` treats "the path is missing" as FR-099's "the file was
   * deleted while open" and dirties the document so the buffer the user had is kept. The stand-in never
   * had that file, so there is no buffer to keep: routing it through `markDeleted` turned it dirty on ANY
   * event in its folder, wrote a recovery temp for an empty document, and made the next Alt+Right raise a
   * Save & open prompt whose Save would CREATE the empty file (adversarial review, main item 2).
   *
   * Deliberately NOT `fileMissing = true`: that routes the stand-in through `markRestored`'s keep-the-buffer
   * branch, which cleared its banner over the empty buffer (US7b fix round 2, item 5).
   */
  neverRead?: boolean;
  /**
   * What was true of the buffer at the moment its file went missing (027 / #161).
   *
   * Recorded because `markDeleted` is about to destroy the evidence: it drops `savedText` so the
   * document cannot look saved while there is no file, and from then on EVERY stranded document
   * reports dirty. Without this, "did the user have unsaved work?" is unanswerable at the moment
   * the file comes back — and the recovery would have to either discard real edits or never fire.
   */
  missingSince?: { wasDirty: boolean; text: string };
  /** A one-shot flag so the "changed on disk" notice fires once per external edit
   *  of a dirty document (FR-028), not on every filesystem event. */
  diskChanged?: boolean;
  /** THRONG is moving this file right now (019, FR-004): between `beginMove` and
   *  `markMoved` its absence from `absPath` is the move in progress, not a delete. */
  movePending?: boolean;
  /**
   * 050 FR-035 (R18, data-model "Moved out") — a move took `absPath` outside the owner project's root.
   *
   * The document is DETACHED: it holds no registry claim and no watch (so the project the file moved to
   * opens it as its own, 006 FR-011a, Principle XI), reads nothing, refuses edits and Save, and its
   * Save As may target only the project root holding `absPath` (FR-036). A later move back inside the
   * owner root clears it — unless another panel claimed that path meanwhile.
   */
  movedOut?: boolean;
  /**
   * 052 FR-012 (data-model "Coordinator document state") — a Replace landed on `absPath` while this document
   * held unsaved changes. Like `movedOut` it holds no registry claim and no watch: the file at `absPath` is
   * the moved document's now. The buffer, dirty state and history are kept; a plain Save is refused and
   * Save As is the way out. It does not follow moves of `absPath`, which name the other document's file.
   */
  replaced?: boolean;
  /** Watch on the doc's folder for external changes (soft detection, FR-028). */
  watch?: Disposable;
  recoveryTimer?: ReturnType<typeof setTimeout>;
  /**
   * What the {@link DocumentLifecycleListener} was last told about this panel's document (044 u4).
   *
   * Kept whether or not a listener is injected, so the comparison is the same either way. `path` is
   * what keeps `registered`/`unregistered` balanced; `dirty` is what makes `dirtyChanged` fire once
   * per flip rather than once per relay that happens to carry a dirty flag; `contentless` does the same
   * for `changed` on a flip of it. A same-path re-load carries this object over to the replacement
   * document — it is the same document to the listener.
   */
  reported: { path: string | null; dirty: boolean; contentless: boolean };
}

/**
 * 052 FR-011 — a panel showing another panel's document. `windowId`/`tabId` are the LINKED panel's own
 * (R7b): the owner's record must never take them from a linked view's dispatch, and a hand-over must give
 * the document the window it now lives in, or `focusExisting` raises the wrong one.
 */
interface LinkEntry {
  owner: string;
  windowId: string;
  tabId: string | null;
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
  /**
   * The document's path could not be read (true), or has become readable again (false) —
   * 027 / #161. Drives the editor's unloadable banner, and nothing else; it is NOT the
   * tab-open missing-file dialog (see `CoordDoc.unloadable`).
   */
  unloadable?: boolean;
  /** A dirty document's file changed on disk (FR-028) — a one-shot notice. */
  externalChange?: boolean;
  /** The document's file MOVED, in-app (019, FR-002). Its new absolute path — and the
   *  ONLY thing about the document that changed. Not a reload, not a dirty edit. */
  movedTo?: string;
  /**
   * 050 FR-035 (R18) — rides with `movedTo`. `true`: the move took the file out of the document's owner
   * project; the document is detached (no registry claim, no watch, Save refused, Save As only into the
   * project holding `movedTo`). `false`: a later move (undo/redo) brought it back and it is an ordinary
   * document again. Absent when the move changed neither — an in-project move is unchanged.
   */
  movedOut?: boolean;
  /**
   * The document's word wrap changed (024 US1, FR-001a). Sent to every Panel showing this
   * document, in every window — wrap is document state, so one document has one answer.
   */
  wordWrap?: boolean;
  /**
   * 052 FR-011 (contracts/editor-replace.md) — set: this panel now shows the document of the panel named,
   * and rides with a `reset` carrying that document's state. `null`: the link ended — the owner moved away
   * from the shared path (the renderer loads its own `filePath`), or the owner closed and this panel is the
   * owner now (with a `reset` re-keyed to this panel's id).
   */
  linkedTo?: string | null;
  /**
   * 052 FR-012 — `true`: a Replace landed on this dirty document's path; it keeps its buffer, holds no claim,
   * and a plain Save is refused. `false`: it is an ordinary document again (Save As, Discard, or its path
   * came back unclaimed).
   */
  replaced?: boolean;
  /**
   * The `verifyPath` a mounting view asked for has ANSWERED (#369). Carries no state.
   *
   * Every other field here reports a change. This one reports that a question is finished, which is
   * the half that was missing: verification is silent when nothing is wrong, so a view waiting on
   * its own open could not distinguish a healthy path and a check that has not answered. It waited
   * forever, and the only alternative was to guess at a duration — which is exactly the defect.
   */
  verified?: boolean;
  /**
   * 047 R3, contracts/preview-ipc-047.md §5 — a document or standalone preview's fold state changed.
   *
   * Unlike every other field here, this does NOT describe `panelId` (which is carried only because the
   * interface requires it, and is otherwise unused by this variant — set to the panel that triggered
   * the change). `key` is the fold map's own key (`file:<path>` or `panel:<id>`), because one key can
   * be shown by an editor panel and a preview panel with a DIFFERENT id, in windows this coordinator
   * does not enumerate previews for. Every renderer with a panel on `key` applies `state` to it,
   * rather than main trying to list every viewer across the editor and preview registries.
   */
  foldState?: { key: string; state: FoldState };
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
  /**
   * 041 FR-013 (#327) — would opening this path be REFUSED, and why? `undefined` means it would not.
   *
   * Injected rather than called directly, for the reason the rest of this interface is: the
   * coordinator decides WHAT to do about an open, and the filesystem question belongs to whatever
   * owns the filesystem. It also lets the unit suite drive every refusal reason — including the one
   * that matters most, a MISSING file coming back openable — without a real file of each kind.
   *
   * Omitted in tests that do not exercise it, which is what keeps the existing suite unchanged.
   */
  refusalFor?: (absPath: string, ownership?: OpenOwnership) => Promise<string | undefined>;
  /**
   * 044 u4/u7 — `PreviewService`'s observer. Optional (a suite that does not exercise it omits it).
   * `main.ts` always passes one: a relay built before the coordinator and pointed at `PreviewService` the
   * moment that exists, so an event before then reaches no preview — there cannot be one yet. See
   * {@link DocumentLifecycleListener}.
   */
  documentLifecycle?: DocumentLifecycleListener;
  /** 044 US7 — where an editor's navigation history is recorded. See {@link EditorHistoryHooks}. */
  history?: EditorHistoryHooks;
}

/**
 * What the caller knows about ownership when it asks to open a path (041 FR-013).
 *
 * Only `out-of-tree` needs it, and only main's confinement rule can decide that — from roots main
 * knows per REGISTERED document, of which a first-time open has none. Hence the caller's.
 */
export interface OpenOwnership {
  ownerKind: EditorOwnerKind;
  ownerRoot: string | null;
  allProjectRoots: readonly string[];
}

export class EditorCoordinator {
  private readonly registry = createOpenRegistry();
  private readonly docs = new Map<string, CoordDoc>();
  /**
   * 052 FR-011 (research R7) — linked panel id → the panel id whose document it shows. A linked panel has
   * no `CoordDoc` of its own: every call naming it resolves to the owner's ({@link docFor}), and every
   * relay naming the owner is sent under its id too ({@link relay}). One document, one more view.
   */
  private readonly links = new Map<string, LinkEntry>();

  constructor(
    private readonly service: EditorService,
    private readonly recovery: EditorRecovery,
    private readonly deps: CoordinatorDeps,
  ) {}

  /** The document a panel shows: its own, or — for a linked panel — its owner's (052 FR-011). */
  private docFor(panelId: string): CoordDoc | undefined {
    const own = this.docs.get(panelId);
    if (own) return own;
    const link = this.links.get(panelId);
    return link === undefined ? undefined : this.docs.get(link.owner);
  }

  /** The first panel linked to `ownerId` — who inherits its document when it lets go of it (052 FR-011). */
  private heirOf(ownerId: string): string | undefined {
    for (const [linked, link] of this.links) if (link.owner === ownerId) return linked;
    return undefined;
  }

  /** Point every link to `fromId` at `toId` instead, telling each linked panel (links are one hop). */
  private repointLinks(fromId: string, toId: string, reset: ResetDocumentMsg): void {
    for (const [linked, link] of this.links) {
      if (link.owner !== fromId) continue;
      link.owner = toId;
      this.deps.relaySync(-1, { panelId: linked, linkedTo: toId, reset });
    }
  }

  /**
   * Relay to every window — once under the panel named, and once more under each panel linked to it
   * (052 contracts/editor-replace.md, "Relay fan-out"). The fan-out is the existing multi-view stream,
   * keyed by a second panel id; nothing else about the message changes.
   */
  private relay(msg: EditorSyncMsg): void {
    this.deps.relaySync(-1, msg);
    for (const [linked, link] of this.links) {
      if (link.owner === msg.panelId) this.deps.relaySync(-1, { ...msg, panelId: linked });
    }
  }

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

  /**
   * Load a file for an editor and register it in the app-wide registry.
   *
   * 044 US7 — the load is also where the panel's navigation history is recorded or moved, so no caller
   * can move a position without the panel's content having changed (contracts/navigation-history.md §3):
   *
   * | Outcome        | Without `navigation` | With `navigation`                                  |
   * |----------------|----------------------|----------------------------------------------------|
   * | Read succeeded | `recordOpen`         | `moveTo(index)` if the entry still names the file  |
   * | File missing   | `recordOpen`         | `moveTo(index)` — the panel holds it open (FR-106d)|
   * | Refused        | nothing              | nothing (FR-106c)                                  |
   *
   * `history` is the layout's `config.history`, carried by a RESTORING load (§6, amended 2026-09-15).
   * It is adopted if the panel has no record BEFORE anything above is recorded — in the same call, one
   * broadcast — so a separate attach arriving late can no longer find `[file]` and keep it. A refused
   * load still adopts it (and records nothing), so the next load does not start the panel from scratch.
   */
  async load(
    meta: Omit<DocMeta, 'encoding' | 'hasBom' | 'lineEnding' | 'absPath'> & {
      absPath: string;
      navigation?: EditorLoadNavigation;
      history?: PersistedHistory;
    },
  ): Promise<LoadResult | (Extract<LoadResult, { ok: true }> & { linkedTo: string })> {
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
    if (!result.ok) {
      // A missing file is still an open into the panel — it holds the file open with its could-not-read
      // banner (041 FR-015) — so it records or moves. A refusal is not: nothing was opened (FR-106c).
      if (isMissingReason(result.reason)) {
        /*
         * 044 FR-106d — a Back / Forward step onto a file that is gone, or cannot be read, MOVES — and the
         * panel must then show THAT entry's could-not-read state, not keep the previous file on screen under
         * a position that no longer describes it. So the step replaces the document with an empty,
         * unloadable one at the target, exactly as a successful step replaces it with the file. An ordinary
         * open of a missing file (no intent) keeps its existing 041 behaviour.
         */
        if (meta.navigation?.kind === 'history' && samePath(meta.navigation.filePath, meta.absPath)) {
          const previous = this.docs.get(meta.panelId);
          await this.replaceDoc(
            meta,
            {
              text: '',
              encoding: previous?.encoding ?? 'utf8',
              hasBom: previous?.hasBom ?? false,
              lineEnding: previous?.lineEnding ?? 'lf',
            },
            { readable: false },
          );
        }
        this.recordNavigation(meta.panelId, meta.absPath, meta.navigation, meta.history);
      } else if (meta.history !== undefined) {
        const persisted = meta.history;
        this.tellHistory('attach', (h) => h.attach(meta.panelId, 'editor', persisted));
      }
      return result;
    }
    /*
     * 052 R1 (006 FR-011a) — another panel's document already holds this path. Every ordinary open asks
     * `openInto` first and focuses that panel instead, so a load gets here only by a route that skips the
     * question: a restored linked panel whose owner had not loaded yet reads the path itself, and then the
     * owner loads it too. Minting a second document would overwrite the first one's claim — two buffers on
     * one file. Whichever loads SECOND joins the first's document as a linked panel. Asked after the read,
     * because the claim can change across that await.
     */
    const holder = this.holderOf(meta.absPath, meta.panelId);
    if (holder) {
      // A replaced document's unsaved work is never dropped by a load; Discard is its one way out (FR-012).
      if (this.docs.get(meta.panelId)?.replaced) {
        return { ok: false, reason: 'io', error: 'This file was replaced. Discard your changes to show it.' };
      }
      this.joinHolder(meta, holder);
      this.recordNavigation(meta.panelId, meta.absPath, meta.navigation, meta.history);
      return {
        ...result,
        text: holder.authority.text,
        encoding: holder.encoding,
        hasBom: holder.hasBom,
        lineEnding: holder.lineEnding,
        linkedTo: holder.panelId,
      };
    }
    await this.replaceDoc(meta, result, { readable: true });
    this.recordNavigation(meta.panelId, meta.absPath, meta.navigation, meta.history);
    return result;
  }

  /** Another panel's live document holding `absPath`'s claim, if any (052 R1). */
  private holderOf(absPath: string, panelId: string): CoordDoc | undefined {
    const at = openOrFocus(this.registry, absPath);
    return at.action === 'focus' && at.panelId !== panelId ? this.docs.get(at.panelId) : undefined;
  }

  /**
   * 052 R1 — make `meta.panelId` a linked view of `holder`'s document. Its own previous document (a different
   * file — the same file would be the holder) goes as a re-pointed panel's always does, unless other panels
   * are linked to it, in which case it is handed to the first of them (R4) rather than closed under them.
   */
  private joinHolder(meta: { panelId: string; windowId: string; tabId: string | null }, holder: CoordDoc): void {
    const view = { windowId: meta.windowId, tabId: meta.tabId };
    const previous = this.docs.get(meta.panelId);
    if (previous) {
      const heir = this.heirOf(meta.panelId);
      if (heir === undefined) {
        this.linkToOwner(previous, holder, view);
        return;
      }
      this.handOver(previous, heir);
    }
    this.links.set(meta.panelId, { owner: holder.panelId, ...view });
    this.deps.relaySync(-1, { panelId: meta.panelId, linkedTo: holder.panelId, reset: this.stateOf(holder) });
  }

  /**
   * Put a new document into `meta.panelId` at `meta.absPath` — a file read, or (044 FR-106d) the empty,
   * unloadable stand-in for one a history step found missing — and tell everyone who holds a view of it.
   */
  private async replaceDoc(
    meta: Omit<DocMeta, 'encoding' | 'hasBom' | 'lineEnding' | 'absPath'> & { absPath: string },
    content: { text: string; encoding: EncodingId; hasBom: boolean; lineEnding: LineEndingId },
    opts: { readable: boolean },
  ): Promise<void> {
    // Re-pointing an editor at a new file: drop its previous registry entry so the
    // old path is no longer considered open (and free of a stale one-buffer claim),
    // and DELETE its recovery temp. panelIds are stable across restarts (persisted in
    // the layout), so a lingering temp holding the OLD file's content would otherwise
    // be restored OVER the new file on the next launch (the freshly-loaded file is
    // clean — there is nothing to recover for it yet).
    let previous = this.docs.get(meta.panelId);
    // 052 — a linked panel that loads a file of its own is no longer a view of its owner's document.
    this.links.delete(meta.panelId);
    /*
     * 052 R4 — an OWNER opening a different file in place (from the tree, or Back/Forward) must not take its
     * linked panels with it: the reset below would fan out to them and drag them to the new file. They keep
     * the file they show — the document passes to the first of them — and this panel starts afresh.
     */
    if (previous && previous.absPath !== meta.absPath) {
      const heir = this.heirOf(meta.panelId);
      if (heir !== undefined) {
        this.handOver(previous, heir);
        previous = undefined;
      }
    }
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
      encoding: content.encoding,
      hasBom: content.hasBom,
      lineEnding: content.lineEnding,
      authority: new DocumentAuthority(meta.panelId, content.text),
      reported: previous?.reported ?? { path: null, dirty: false, contentless: false },
    };
    // A successful load means the path could be read (027 / #161), which is what draws the editor's
    // banner; the FR-106d stand-in is the opposite. `fileMissing` is left FALSE either way — it drives
    // the tab-open "cannot open file" dialog (FR-105 requires that to stay silent on a step), and
    // setting it true here (fix round 1) also routed the stand-in through `markRestored`'s keep-the-
    // buffer branch on a later restore: that branch re-reads only when the buffer already equals the
    // disk text, so it cleared the banner over the empty stand-in before the folder watch ever reloaded
    // it (fix round 2, item 5). This is the same shape `register()` already uses for a mount that failed
    // to read its path.
    doc.fileMissing = false;
    doc.unloadable = !opts.readable;
    doc.neverRead = !opts.readable; // the stand-in: nothing FR-099 could keep (see `CoordDoc.neverRead`)
    this.docs.set(meta.panelId, doc);
    registerOpen(this.registry, meta.absPath, { panelId: meta.panelId, windowId: meta.windowId });
    this.watchDoc(doc); // soft external-change detection (FR-028)
    // A new document — every view of this panel adopts it, not just the one that asked. Opening a
    // file from the tree into a MIRRORED editor must change the file in both windows.
    this.broadcastReset(doc);
    /*
     * 044 FR-106d, fix round 2 item 1 — `broadcastReset` carries text/version/dirty and the path (`stateOf`), so
     * a SECOND view of this panel (Sync to a sub-workspace window) adopts the empty replacement but never
     * learns it is unloadable: the origin window's banner comes from its own `openFile` failure branch in
     * `use-editor.ts`, which only that one view runs. Relay `unloadable` explicitly, the same shape
     * `markDeleted`, `pathCameBack` and `verifyPath` already use — `true` for the stand-in, and `false`
     * when a readable replacement follows one, so a second view's banner clears on Forward too. Sent
     * AFTER the reset and BEFORE `announceReplacement`, so every view (including the origin, which also
     * receives its own broadcast) is caught up before anything else is told about the swap.
     */
    if (!opts.readable) {
      this.relay({ panelId: doc.panelId, unloadable: true });
    } else if (previous?.unloadable) {
      this.relay({ panelId: doc.panelId, unloadable: false });
    }
    this.announceReplacement(doc, previous);
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
    const before = doc.authority.doc;
    doc.authority.reset(text, false); // NOT clean: it is precisely what the file does NOT hold
    // The history is adopted AFTER the reset, because `reset` clears it — the entries it holds
    // describe a document that has just been replaced. Here they describe the document we are
    // replacing it WITH, so they are exactly the past the user is entitled to (FR-027a).
    if (history) doc.authority.restoreHistory(history);
    // The user's own recovered work is content to follow and to keep: no longer `neverRead`, so a parented
    // preview shows it (FR-022, fix round 1 ruling) and a folder event keeps it as FR-099 keeps any buffer.
    doc.neverRead = false;
    this.broadcastReset(doc);
    this.notifyAfterMutation(doc, !doc.authority.doc.eq(before));
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
      // 050 FR-035 — a moved-out document has let go of its file: deleting it is not this panel's news.
      if (!doc.absPath || doc.fileMissing || doc.movedOut || doc.replaced || !isUnder(doc.absPath)) continue;
      // A document that never had its file in this panel (the FR-106d stand-in, a failed restore) and holds
      // nothing the user typed has no buffer for FR-099 to keep: an in-app delete leaves it exactly as the
      // folder watch does (`onDiskChange`). One it WAS typed into is dirty, and kept like any other.
      if (doc.neverRead && !doc.authority.dirty) continue;
      // BEFORE `markUnsaved` below drops `savedText` — after it, "did this buffer hold the user's
      // own work?" can no longer be answered, and that is the question the recovery turns on
      // (027 / #161, see `missingSince`).
      doc.missingSince = { wasDirty: doc.authority.dirty, text: doc.authority.text };
      doc.fileMissing = true;
      // The path cannot be read, so the editor must SAY so and keep saying it (027 / #161). This is
      // the same condition a failed mount reports, reached from the other direction — the file went
      // while the document was already open — and the user is owed the same statement either way:
      // what is on screen is no longer the file. Separate from `fileMissing`, which drives the
      // one-shot tab-open dialog FR-105 keeps silent on remounts.
      doc.unloadable = true;
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
      this.relay({ panelId: doc.panelId, deleted: true, dirty: true, unloadable: true });
      this.notifyAfterMutation(doc, false); // isolated, so one listener throw cannot skip the next doc
    }
  }

  /**
   * A set of files came BACK (024 US3, #85) — the inverse of {@link markDeleted}.
   *
   * Deleting a file with an editor open on it marks that editor dirty and file-missing, deliberately:
   * the buffer is now the only copy, and it must not look saved. Undoing the delete puts the file
   * back, and the editor has to notice — leaving it dirty tells the user their work is still at risk
   * when it is sitting on disk again, and every later prompt ("save before closing?") is asking about
   * a document that has nothing to save.
   *
   * The reason for the dirtiness decides what happens, and the DISK answers that question without
   * anyone having to remember: if the restored file matches the buffer, the deletion was the only
   * thing making it dirty and the editor goes clean. If it does not, the user had genuine unsaved
   * edits before they deleted it — those are still unsaved, so the file-missing flag clears and the
   * dirty flag stands. Nothing is silently overwritten in either direction.
   */
  async markRestored(restoredAbsPaths: readonly string[]): Promise<void> {
    if (restoredAbsPaths.length === 0) return;
    // 052 FR-013 — a replaced document whose path is back and unclaimed holds it again (`markDeleted` skips
    // replaced documents, so none of them is `fileMissing` and the loop below never sees one).
    this.reclaimReplaced((abs) => restoredAbsPaths.some((back) => isUnderPath(abs, back)));
    const isUnder = (file: string): boolean =>
      restoredAbsPaths.some((back) => isUnderPath(file, back));
    for (const doc of this.docs.values()) {
      if (!doc.absPath || !doc.fileMissing || doc.movedOut || !isUnder(doc.absPath)) continue;
      const res = await this.service.load({
        absPath: doc.absPath,
        ownerRoot: doc.ownerRoot,
        ownerKind: doc.ownerKind,
        allProjectRoots: doc.allProjectRoots,
      });
      if (!res.ok) continue; // it did not actually come back — leave the editor exactly as it was
      doc.fileMissing = false;
      doc.unloadable = false; // it reads again, so the banner's claim has stopped being true
      doc.missingSince = undefined;
      doc.encoding = res.encoding;
      doc.hasBom = res.hasBom;
      doc.lineEnding = res.lineEnding;
      const before = doc.authority.doc;
      if (res.text === doc.authority.text) {
        // The file is what the buffer holds: the delete was the only thing making this dirty, and
        // it has been undone. `reset` re-establishes savedText, which is what clears the flag.
        doc.authority.reset(res.text);
        this.broadcastReset(doc);
      }
      // -1: broadcast to ALL windows — no editing renderer to exclude, exactly as markDeleted does.
      this.relay({
        panelId: doc.panelId,
        deleted: false,
        unloadable: false,
        dirty: doc.authority.dirty,
      });
      this.notifyAfterMutation(doc, !doc.authority.doc.eq(before));
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
    const detached: { doc: CoordDoc; newAbs: string }[] = [];
    const moving: { doc: CoordDoc; newAbs: string }[] = [];
    for (const doc of this.docs.values()) {
      // The bracket closes on EVERY doc it opened, moved or not — a flag left set would suppress
      // the dirtying a genuine external delete is entitled to, for the rest of the session.
      doc.movePending = false;
      // 052 FR-012 — a replaced document's path names the moved document's file now, not its own.
      if (!doc.absPath || doc.replaced) continue;
      const newAbs = movedPathOf(doc.absPath, moves);
      if (newAbs !== null) moving.push({ doc, newAbs });
    }
    // Collected first, so a document a Replace disposes below is never visited, and a document whose own
    // path is also moving in this batch (a swap) is never mistaken for the one being replaced.
    const movingIds = new Set(moving.map((m) => m.doc.panelId));
    for (const { doc, newAbs } of moving) {
      /*
       * 052 R7 — panels linked to this document share the path it is leaving. Usually they follow it: a rename
       * or a move of the shared file is a move of their document, and `relay` fans the `movedTo` below out to
       * them. Only when the path it leaves EXISTS again — an undo, which restored the replaced file from the
       * Recycle Bin inside this very bracket — does each go back to showing its own file. Then the unlink goes
       * out BEFORE the owner's `movedTo`, so the fan-out never re-points it at the owner's new path.
       */
      // T028 — asked only of a document that HAS linked panels, and never for a move onto its own path (a
      // case-only rename): the old spelling "exists" there because it is the same file.
      if (
        doc.absPath !== null &&
        this.heirOf(doc.panelId) !== undefined &&
        !samePath(doc.absPath, newAbs) &&
        existsSync(doc.absPath)
      ) {
        this.unlinkFrom(doc.panelId);
      }
      // 050 FR-035 — a moved-out document is settled AFTER every ordinary one, so "has another editor
      // claimed the path it returns to?" is asked of the registry as this batch leaves it, not halfway.
      if (doc.movedOut) {
        detached.push({ doc, newAbs });
        continue;
      }
      // …and one this move takes out of its owner project is detached now.
      if (leavesOwner(doc, newAbs)) {
        this.moveDetached(doc, newAbs);
        continue;
      }
      // 052 FR-010 — a Replace onto a path another panel's document holds. Asked BEFORE the registry
      // follows, because the claim being overwritten is the evidence.
      const victim = this.claimantOf(newAbs, doc.panelId, movingIds);
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
      this.relay({ panelId: doc.panelId, movedTo: newAbs });
      // ONE `repointed`, not the `unregistered`+`registered` pair the registry churn above might
      // suggest: this is the SAME document, wearing a new path (FR-013c). After the relay, and
      // isolated, so a throwing listener cannot cost a later document its move.
      this.announcePath(doc);
      if (victim) this.settleReplaced(victim, doc);
    }
    for (const { doc, newAbs } of detached) this.moveDetached(doc, newAbs);
    // 052 FR-013 — an undo moves the mover off a replaced document's path (and restores its file from the
    // Recycle Bin inside the same bracket); asked once the batch has settled the registry.
    this.reclaimReplaced((abs) => moves.some((m) => isUnderPath(abs, m.from)));
    /*
     * 052 FR-012 (R7a) — a Replace whose mover is NOT an open document here (its file was never open, or it
     * is detached by a cross-project move) found no victim above, yet the target's editor may hold unsaved
     * work. It becomes replaced all the same, or a plain Save would write over the moved file. A clean one is
     * left alone: its folder watch reloads it to the moved content (FR-011 with one panel).
     */
    for (const { to } of moves) {
      const at = openOrFocus(this.registry, to);
      if (at.action !== 'focus' || movingIds.has(at.panelId)) continue;
      const held = this.docs.get(at.panelId);
      if (held && !held.replaced && this.hasOwnWork(held)) this.markReplaced(held);
    }
  }

  /**
   * 052 FR-013 (research R7) — a replaced document whose path nobody claims any more, and which EXISTS again
   * on disk, takes it back: claim, watch, `registered`, and the panel's notice clears. Its unsaved changes
   * are still unsaved. The same reclaim rule `moveDetached` applies to a document coming back into its
   * project. `candidate` narrows it to paths this event could have given back (vacated by a move, or
   * restored) — an unrelated move elsewhere must never hand a replaced document its old claim.
   */
  private reclaimReplaced(candidate: (absPath: string) => boolean): void {
    for (const doc of this.docs.values()) {
      if (!doc.replaced || !doc.absPath || !candidate(doc.absPath)) continue;
      if (openOrFocus(this.registry, doc.absPath).action === 'focus' || !existsSync(doc.absPath)) continue;
      doc.replaced = false;
      registerOpen(this.registry, doc.absPath, { panelId: doc.panelId, windowId: doc.windowId });
      this.watchDoc(doc);
      this.relay({ panelId: doc.panelId, replaced: false });
      this.announcePath(doc);
    }
  }

  /** The document of ANOTHER panel claiming `absPath` that is not itself moving away in this batch. */
  private claimantOf(absPath: string, panelId: string, movingIds: ReadonlySet<string>): CoordDoc | undefined {
    const at = openOrFocus(this.registry, absPath);
    if (at.action !== 'focus' || at.panelId === panelId || movingIds.has(at.panelId)) return undefined;
    return this.docs.get(at.panelId);
  }

  /**
   * 052 FR-011 / FR-012 — `owner` has just landed on the path `victim` held (a Replace). The registry is
   * already `owner`'s; this decides what becomes of `victim`'s panel.
   *
   * - No work of its own → its document is disposed and the panel is LINKED to `owner`'s: one document,
   *   one claim, shown by both panels. Panels that were linked to `victim` follow it to `owner`.
   * - Unsaved work → it becomes REPLACED (see `CoordDoc.replaced`): nothing merged, nothing lost.
   */
  private settleReplaced(victim: CoordDoc, owner: CoordDoc): void {
    if (this.hasOwnWork(victim)) {
      this.markReplaced(victim);
      return;
    }
    this.linkToOwner(victim, owner);
  }

  /**
   * Did the user type into this buffer? Not `authority.dirty` alone: a document whose file went missing
   * is force-dirtied (`markDeleted`), and a Replace trashes the very file the victim's folder watch is
   * watching — so a clean victim can arrive here dirty for no reason of its own (`missingSince`).
   */
  private hasOwnWork(doc: CoordDoc): boolean {
    const since = doc.missingSince;
    return since ? since.wasDirty || since.text !== doc.authority.text : doc.authority.dirty;
  }

  /**
   * Dispose `victim`'s document and show `owner`'s in its panel instead (052 FR-011). `view` is where that
   * panel lives, when the caller knows better than the victim's own record (a load names its window).
   */
  private linkToOwner(victim: CoordDoc, owner: CoordDoc, view?: { windowId: string; tabId: string | null }): void {
    const id = victim.panelId;
    const wrapKey = this.wrapKey(victim);
    if (victim.recoveryTimer) clearTimeout(victim.recoveryTimer);
    this.disposeWatch(victim);
    unregisterPanel(this.registry, id);
    this.docs.delete(id);
    this.forgetWordWrapIfClosed(wrapKey);
    void this.recovery.remove(id);
    const reset = this.stateOf(owner);
    // A panel that was showing the victim's document shows the owner's now — one hop, never a chain.
    this.repointLinks(id, owner.panelId, reset);
    this.links.set(id, {
      owner: owner.panelId,
      windowId: view?.windowId ?? victim.windowId,
      tabId: view !== undefined ? view.tabId : victim.tabId,
    });
    // Not through `relay`: this message names the linked panel, not the owner.
    this.deps.relaySync(-1, { panelId: id, linkedTo: owner.panelId, reset, ...(victim.replaced ? { replaced: false } : {}) });
    const told = victim.reported.path;
    victim.reported.path = null;
    if (told !== null) this.tell('unregistered', (l) => l.unregistered(told, id));
    // After `unregistered`, as `destroy` orders it: a preview falling back to standalone seeds from this key.
    this.forgetFoldIfUnused(wrapKey);
  }

  /**
   * 052 FR-012 — the Replace landed on unsaved work: let go of the path (claim and watch), keep the
   * buffer, dirty state and history, and say so once. The lifecycle listener hears `unregistered`, as for a
   * moved-out document: this panel no longer stands for that file.
   */
  private markReplaced(doc: CoordDoc): void {
    unregisterPanel(this.registry, doc.panelId);
    this.disposeWatch(doc);
    doc.replaced = true;
    this.relay({ panelId: doc.panelId, replaced: true });
    this.announceDetached(doc);
  }

  /**
   * 052 R7 "Persisted" — a panel restored with `config.linkedTo` asks to show its owner's document again.
   *
   * Returns the owner's state to adopt, or `null` when the owner is not open (or `panelId` holds a document
   * of its own) — the renderer's cue to drop `linkedTo` and load `filePath` as an ordinary editor. A link to
   * a panel that is itself linked lands on that panel's owner: links are one hop, never a chain.
   */
  link(panelId: string, ownerId: string, view?: { windowId: string; tabId?: string | null }): ResetDocumentMsg | null {
    const owner = this.docFor(ownerId);
    if (!owner || owner.panelId === panelId || this.docs.has(panelId)) return null;
    this.links.set(panelId, { owner: owner.panelId, windowId: view?.windowId ?? owner.windowId, tabId: view?.tabId ?? null });
    return this.stateOf(owner);
  }

  /**
   * 052 FR-012 — Discard on a replaced document: drop its buffer and recovery temp, and show the file that
   * is at its path now. That is FR-011's outcome — linked to the path's owner — or, when nobody holds the
   * path, the panel reads it itself (and shows the could-not-read state if it cannot).
   */
  async discardReplaced(panelId: string): Promise<{ ok: true; linkedTo: string | null } | { ok: false; error: string }> {
    const doc = this.docs.get(panelId);
    const abs = doc?.absPath;
    if (!doc?.replaced || !abs) return { ok: false, error: 'This document was not replaced.' };
    if (doc.recoveryTimer) {
      clearTimeout(doc.recoveryTimer);
      doc.recoveryTimer = undefined;
    }
    await this.recovery.remove(panelId);
    // Asked after the await: the path may have been claimed, or released, while the temp was removed.
    if (this.docs.get(panelId) !== doc) return { ok: false, error: 'This document was closed.' };
    const at = openOrFocus(this.registry, abs);
    const owner = at.action === 'focus' ? this.docs.get(at.panelId) : undefined;
    if (owner) {
      this.linkToOwner(doc, owner);
      return { ok: true, linkedTo: owner.panelId };
    }
    const meta = {
      panelId,
      windowId: doc.windowId,
      ownerKind: doc.ownerKind,
      ownerProjectId: doc.ownerProjectId,
      ownerRoot: doc.ownerRoot,
      allProjectRoots: doc.allProjectRoots,
      tabId: doc.tabId,
      absPath: abs,
    };
    const res = await this.service.load({
      absPath: abs,
      ownerRoot: doc.ownerRoot,
      ownerKind: doc.ownerKind,
      allProjectRoots: doc.allProjectRoots,
    });
    if (this.docs.get(panelId) !== doc) return { ok: false, error: 'This document was closed.' };
    const content = res.ok ? res : { text: '', encoding: doc.encoding, hasBom: doc.hasBom, lineEnding: doc.lineEnding };
    await this.replaceDoc(meta, content, { readable: res.ok });
    this.relay({ panelId, replaced: false });
    return { ok: true, linkedTo: null };
  }

  /** End every link to `ownerId`: each linked panel goes back to loading its own `filePath` (052 R7). */
  private unlinkFrom(ownerId: string): void {
    for (const [linked, link] of [...this.links]) {
      if (link.owner !== ownerId) continue;
      this.links.delete(linked);
      this.deps.relaySync(-1, { panelId: linked, linkedTo: null });
    }
  }

  /**
   * 050 FR-035 (R18) — `markMoved` for a document whose move crosses its owner project's boundary, or
   * that is already moved out.
   *
   * - Leaving: release the claim and the watch, keep the buffer, dirty state and history untouched (it is
   *   the same document, just detached), and tell the lifecycle listener the document is GONE for that
   *   file (`unregistered`) — a parented preview falls back to standalone, and `PreviewService.moved`
   *   then gives it its own moved-out state.
   * - Moving again while out: the path follows (the header shows where the file is), nothing else.
   * - Coming back inside the owner root unclaimed: re-claim, re-watch, `registered` — an ordinary
   *   document again. Claimed by another panel meanwhile: it stays moved out at that path.
   */
  private moveDetached(doc: CoordDoc, newAbs: string): void {
    const wasOut = doc.movedOut === true;
    const backInside = !leavesOwner(doc, newAbs);
    const claimed = openOrFocus(this.registry, newAbs);
    const reclaim = backInside && (claimed.action !== 'focus' || claimed.panelId === doc.panelId);
    if (!wasOut) {
      unregisterPanel(this.registry, doc.panelId);
      this.disposeWatch(doc);
    }
    doc.absPath = newAbs;
    if (reclaim) {
      doc.movedOut = false;
      registerOpen(this.registry, newAbs, { panelId: doc.panelId, windowId: doc.windowId });
      this.watchDoc(doc);
      this.relay({ panelId: doc.panelId, movedTo: newAbs, movedOut: false });
      this.announcePath(doc);
      return;
    }
    doc.movedOut = true;
    this.relay(wasOut ? { panelId: doc.panelId, movedTo: newAbs } : { panelId: doc.panelId, movedTo: newAbs, movedOut: true });
    if (!wasOut) this.announceDetached(doc);
  }

  /** The document no longer stands for its file (FR-035): `unregistered` for the path last announced. */
  private announceDetached(doc: CoordDoc): void {
    const told = doc.reported.path;
    doc.reported.path = null;
    if (told !== null) this.tell('unregistered', (l) => l.unregistered(told, doc.panelId));
  }

  /**
   * Register a new (possibly empty, unpathed) document without reading a file.
   *
   * `unloadable` is how a mount that FAILED to read its path says so (027 / #161). It has to be
   * recorded here rather than left in the renderer, because the renderer's copy dies with the
   * mount: a panel that is unmounted and remounted — a tab switch, a project switch, a panel drag —
   * takes the `getContent` path and never attempts a load at all, so without this the banner
   * silently disappears and the editor goes back to presenting remembered text as the file.
   */
  register(meta: DocMeta, text = '', opts: { unloadable?: boolean; movedOut?: boolean; replaced?: boolean } = {}): void {
    const previous = this.docs.get(meta.panelId);
    this.links.delete(meta.panelId); // 052 — a document of its own ends any link (see `replaceDoc`)
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
      reported: previous?.reported ?? { path: null, dirty: false, contentless: false },
    };
    doc.unloadable = opts.unloadable === true;
    // A mount that failed to read its path never read it here: nothing of the file's for FR-099 to keep.
    doc.neverRead = doc.unloadable;
    if ((opts.movedOut === true || opts.replaced === true) && meta.absPath) {
      /*
       * 050 FR-035/FR-036 — a panel restored with `config.movedOut` (after a restart, or a layout no window
       * held during the move) whose unsaved text the renderer is about to restore. It is detached from the
       * start: no claim, no watch, nothing read, and the lifecycle listener is told nothing about a file
       * that is another project's. Save As then works through the same exception as a live move-out.
       *
       * 052 T024 — `config.replaced` restores the same way, for the same reason: the file at `absPath` is
       * the moved document's, and the buffer about to be restored is the user's unsaved work from BEFORE the
       * Replace. Claiming the path would make a plain Save write that work over the moved file.
       */
      if (previous?.absPath) {
        this.disposeWatch(previous);
        unregisterPanel(this.registry, meta.panelId);
      }
      if (opts.movedOut === true) doc.movedOut = true;
      else doc.replaced = true;
      this.docs.set(meta.panelId, doc);
      const told = doc.reported.path;
      doc.reported.path = null;
      doc.reported.dirty = doc.authority.dirty;
      doc.reported.contentless = false;
      if (told !== null) this.tell('unregistered', (l) => l.unregistered(told, doc.panelId));
      return;
    }
    this.docs.set(meta.panelId, doc);
    if (meta.absPath) {
      registerOpen(this.registry, meta.absPath, { panelId: meta.panelId, windowId: meta.windowId });
      this.watchDoc(doc); // soft external-change detection (FR-028)
    }
    this.announceReplacement(doc, previous);
  }

  /**
   * FR-011a: focus the existing editor for an already-open path, else open new — or REFUSE.
   *
   * ══ 041 FR-013 (#327): THE REFUSAL IS DECIDED HERE, BEFORE A PANEL EXISTS ══
   *
   * Opening a too-large file with no editor panel open used to CREATE one, show the refusal inside it
   * as a banner, and raise no notification — leaving the user holding a panel for a file that was
   * never opened. With a panel already open, the same action correctly produced a notification and no
   * panel. One action, two outcomes, decided by unrelated workspace state.
   *
   * The cause was ordering: `createDedicatedEditor` built the panel before anything read the file, so
   * the first moment the refusal was knowable was already too late. This asks first.
   *
   * ══ WHY IT RIDES ON THIS CALL ══
   *
   * Every entry point that can create a panel already awaits this decision, so the refusal costs no
   * round-trip — where a separate probe would make an ACCEPTED file pay two in order to save a refused
   * one a panel. And a caller that fails to handle `refuse` fails to COMPILE, which is what makes
   * FR-013a's "every entry point" a property of the type rather than a convention to remember.
   *
   * ══ THE OWNERSHIP CONTEXT IS THE CALLER'S, AND MUST BE ══
   *
   * `out-of-tree` is a refusal about the PROJECT ROOTS, and main knows those only per registered
   * document — there is no registered document for a file being opened for the first time, which is
   * exactly the case this decides. So the renderer supplies them, the same way it already does for
   * `load`. Optional, and its absence narrows the check rather than skipping it: a caller that cannot
   * name the roots still gets `folder`, `too-large` and `binary`, and never a false `out-of-tree`.
   *
   * A MISSING file returns `open` (FR-015). Its panel is what holds the recovered buffer, and
   * refusing it here would delete 018's recovery path without a single failing test near the editor.
   */
  async openInto(absPath: string, ownership?: OpenOwnership): Promise<OpenDecision> {
    const decision = openOrFocus(this.registry, absPath);
    if (decision.action !== 'open') return decision;

    const reason = await this.deps.refusalFor?.(absPath, ownership);
    return reason ? { action: 'refuse', reason } : decision;
  }

  isOpen(absPath: string): boolean {
    return isOpenAnywhere(this.registry, absPath);
  }

  /**
   * The editor document holding `absPath`, and the window the registry recorded for it — or `null`.
   *
   * A read of the registry and nothing else (044 u7): `PreviewService` derives "parented" from it
   * (FR-013) and routes placement to the recorded window (FR-010). Unlike {@link openInto} it never
   * reads the file and never decides a refusal.
   */
  documentFor(absPath: string): { panelId: string; windowId: string } | null {
    const at = openOrFocus(this.registry, absPath);
    return at.action === 'focus' ? { panelId: at.panelId, windowId: at.windowId } : null;
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
    const doc = this.docFor(change.documentId);
    if (!doc) return; // the buffer was destroyed under a live view — nothing to apply it to
    if (doc.movedOut) {
      // 050 FR-035 — read-only. A view that typed anyway (a keystroke in flight as the move landed) is
      // put back in step with the document, which did not change.
      this.broadcastReset(doc);
      return;
    }
    // 052 R7b — a linked panel's view restates where IT lives; that is the link's record, not the owner's.
    const link = meta.panelId !== doc.panelId ? this.links.get(meta.panelId) : undefined;
    if (link) {
      link.windowId = meta.windowId;
      link.tabId = meta.tabId;
    } else {
      this.refreshMeta(doc, meta);
    }

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
    this.relay({ panelId: doc.panelId, change: canonical });
    this.notifyAfterMutation(doc, true);
  }

  /**
   * Apply a replace commit's edits to an OPEN document — from MAIN, with no view involved
   * (043 T085, FR-052, FR-054, FR-057, research R7).
   *
   * ══ WHY THIS EXISTS AT ALL, WHEN `dispatchChange` IS RIGHT THERE ══
   *
   * `dispatchChange` is a VIEW's entry point: it takes the meta a mounted replica supplies and the
   * change that replica has already shown its user. A replace commit has neither. Worse, it cannot
   * get them for every document it must touch: only the ACTIVE tab's panels are mounted
   * (`tab-group.tsx` renders `activeTab.root`), and on unmount the view and the replica are torn
   * down while the document stays alive here. So a file open in a background tab has an authority
   * and no view — and a commit that went looking for one would skip its buffer edit AND decline its
   * disk write, because `isOpen()` correctly reports it open. The file would receive NEITHER,
   * silently. That is the defect research R7 found, and this method is the answer to it.
   *
   * ══ WHAT MAKES IT THE SAME KIND OF EDIT AS A KEYSTROKE ══
   *
   * Everything below the entry point is `dispatchChange`'s own path: the ChangeSet is built against
   * `authority.version` so the authority orders and rebases it like any other, and the canonical
   * result goes out on `relaySync(-1, …)` so EVERY window applies it — a mirrored view of this
   * document in another window is not a special case here, it is the ordinary one.
   *
   * ══ THE TWO ARGUMENTS THAT LOOK LIKE THE COMMIT SERVICE'S JOB ══
   *
   * `term` and `modes` are here because FR-054's re-check must have NOTHING between it and the
   * write. Verifying in the caller and applying here would put an inter-call gap in exactly the
   * place the requirement forbids one; verifying here is the only arrangement in which the check
   * and the edit are one turn by construction.
   *
   * `mergeClass: null` never merges (`document-sync.ts`), which is what makes a whole file's worth
   * of replacements ONE undo entry (FR-057) and keeps it from absorbing the keystroke the user
   * typed a moment earlier. `selectionBefore: null` because there is no cursor to restore: the user
   * did not make this edit with a caret, and a replica skips the selection when it is absent.
   *
   * Returns `null` when no open document holds `absPath` — the caller's cue that it closed under
   * the commit, which is a different thing from a failure.
   */
  bulkReplace(req: {
    absPath: string;
    term: string;
    modes: MatchModes;
    replacement: string;
    /*
     * `applied` names the caller's OWN edits rather than counting them (#378). A caller stepping
     * through one scan's rows rebases the rows it has not committed yet past the ones it has, and a
     * count cannot say WHICH those were — a partially refused file would shift every survivor by the
     * wrong amount, which is how a replacement comes to be written over the middle of the previous
     * one.
     */
    edits: readonly Match[];
  }): {
    applied: readonly Match[];
    applicable: readonly Match[];
    refused: number;
    after: Text;
    /**
     * WHICH document this was — so the caller can address it by panel id (043 FR-086).
     *
     * Returned rather than looked up again, because the caller has only a path and the path→panel
     * lookup is precisely what can change under it: between a second `openOrFocus` and the save, the
     * document could have closed, moved, or been re-registered at another panel. The id this call
     * edited is the only id the follow-up save may name.
     */
    documentId: string;
    /**
     * Was the document CLEAN immediately before this edit (043 FR-086, FR-086a)?
     *
     * ══ WHY THE SAMPLE HAS TO BE TAKEN HERE, AND NOWHERE ELSE ══
     *
     * The edit below goes through the authority, which dirties the document. So there is exactly one
     * instant at which the question has a useful answer — before the dispatch — and a caller asking
     * afterwards finds EVERY document dirty and saves nothing. It cannot usefully be asked before the
     * call either: the caller holds a path, not a document, and every `await` between its question
     * and this method is a window in which the user could type.
     *
     * Sampling it inside the same synchronous turn as the dispatch is the only arrangement in which
     * "was clean" and "is now edited by the commit" are two facts about one moment.
     */
    wasClean: boolean;
  } | null {
    const at = openOrFocus(this.registry, req.absPath);
    if (at.action !== 'focus') return null;
    const doc = this.docs.get(at.panelId);
    if (!doc) return null;

    // FR-086's sample. Read BEFORE `verifyEdits` and before the dispatch — see the field's own note.
    const wasClean = !doc.authority.dirty;

    // FR-054, against the authority's CURRENT text — which is the document, not the file. Nothing
    // separates this from the dispatch below.
    const checked = verifyEdits(
      doc.authority.text,
      req.term,
      req.modes,
      req.edits,
      req.replacement,
    );
    if (checked.applicable.length === 0) {
      return {
        applied: [],
        applicable: [],
        refused: checked.gone.length,
        after: doc.authority.doc,
        documentId: doc.panelId,
        wasClean,
      };
    }

    const canonical = doc.authority.dispatch({
      documentId: doc.panelId,
      // A synthetic id: no replica answers to it, so every view applies the change rather than one
      // of them recognising it as its own acknowledgement and applying nothing.
      viewId: BULK_EDIT_VIEW_ID,
      changes: ChangeSet.of(
        checked.applicable.map((m) => ({ from: m.from, to: m.to, insert: req.replacement })),
        doc.authority.text.length,
      ).toJSON(),
      baseVersion: doc.authority.version,
      selectionBefore: null,
      mergeClass: null,
    });
    if (!canonical) {
      // The document was REPLACED under this edit. Nothing landed; put every view back in step.
      this.broadcastReset(doc);
      return {
        applied: [],
        applicable: [],
        refused: checked.gone.length,
        after: doc.authority.doc,
        documentId: doc.panelId,
        wasClean,
      };
    }

    this.scheduleRecovery(doc);
    this.relay({ panelId: doc.panelId, change: canonical });
    this.notifyAfterMutation(doc, true);
    /*
     * FR-083b — `applicable` and the document AFTER the dispatch, so the commit can say what each
     * changed line now reads. The authority's own text is the only copy of it: nothing here reads
     * the file, and the file does not yet hold this edit (FR-053a).
     */
    return {
      applied: checked.applied,
      applicable: checked.applicable,
      refused: checked.gone.length,
      after: doc.authority.doc,
      documentId: doc.panelId,
      wasClean,
    };
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
    const doc = this.docFor(panelId);
    const saved = doc?.authority.savedText;
    if (!doc || saved === null || saved === undefined) return false;

    const before = doc.authority.doc;
    doc.authority.reset(saved);
    this.broadcastReset(doc);
    if (doc.recoveryTimer) {
      clearTimeout(doc.recoveryTimer);
      doc.recoveryTimer = undefined;
    }
    void this.recovery.remove(doc.panelId);
    this.notifyAfterMutation(doc, !doc.authority.doc.eq(before));
    return true;
  }

  /**
   * Re-READ the document's path and adopt what is there now (027 / #161, FR-013).
   *
   * A different operation from {@link revert}, on a different source of truth, and the pair must
   * not be conflated:
   *
   * | | Source | When the file is missing |
   * |---|---|---|
   * | `revert` (FR-075) | `savedText` — throng's CACHED belief about the disk | refused |
   * | `reload` (FR-013) | a fresh read of the path | exactly the case it exists for |
   *
   * So this is the only operation in the app that can rescue a stranded editor on demand: after a
   * network blip, after a watcher missed the event, after a move-away-and-back that fell inside one
   * watch gap — and from the unloadable state itself, where `revert` has nothing to revert TO.
   *
   * It reuses `service.load`, deliberately: that is the same read the open path performs, with the
   * same ownership rule and the same encoding/line-ending detection. A second way to put content
   * into a document is a second way for it to be wrong.
   *
   * It raises NOTHING on failure. `openFile` warns immediately because a deliberate open of a bad
   * file is news; a reload that finds the path still broken is the state the user is already
   * looking at, and popping the tab-open dialog for it is how the first attempt at #161 reddened
   * `editor-missing-aggregate`. The caller gets the reason and decides.
   */
  async reload(panelId: string): Promise<LoadResult | { ok: false; reason: 'no-location'; error: string }> {
    const doc = this.docFor(panelId);
    if (!doc) return { ok: false, reason: 'io', error: 'No such open document.' };
    if (!doc.absPath) {
      return { ok: false, reason: 'no-location', error: 'This document has no file to reload from.' };
    }
    if (doc.movedOut) {
      // 050 FR-035 — the file is another project's now; this panel reads nothing.
      return { ok: false, reason: 'out-of-tree', error: 'This file moved to another project.' };
    }
    if (doc.replaced) {
      // 052 FR-012 — reading the path would put the moved document's content over the user's changes.
      // Discard is the explicit, one-way route to that outcome.
      return { ok: false, reason: 'io', error: 'This file was replaced. Discard your changes to show it.' };
    }
    const res = await this.service.load({
      absPath: doc.absPath,
      ownerRoot: doc.ownerRoot,
      ownerKind: doc.ownerKind,
      allProjectRoots: doc.allProjectRoots,
    });
    if (!res.ok) return res; // still unreadable — the buffer, and the banner, stand
    this.adoptFromDisk(doc, res);
    return res;
  }

  /**
   * The path was read successfully: make what it holds the document (027 / #161).
   *
   * Shared by the manual reload and the auto-recovery below so the two cannot drift — recovering
   * "by itself" and recovering "because you asked" must leave the document in the same state.
   *
   * `reset` re-establishes `savedText`, which is what makes the document CLEAN again: what we hold
   * is now, demonstrably, what the file holds. The recovery temp goes with it — it described a
   * buffer that no longer exists, and leaving it would restore the pre-recovery text over this
   * file at the next launch.
   */
  private adoptFromDisk(doc: CoordDoc, res: LoadResult & { ok: true }): void {
    doc.encoding = res.encoding;
    doc.hasBom = res.hasBom;
    doc.lineEnding = res.lineEnding;
    doc.fileMissing = false;
    doc.unloadable = false;
    doc.neverRead = false;
    doc.diskChanged = false;
    const before = doc.authority.doc;
    doc.authority.reset(res.text);
    if (doc.recoveryTimer) {
      clearTimeout(doc.recoveryTimer);
      doc.recoveryTimer = undefined;
    }
    void this.recovery.remove(doc.panelId);
    this.broadcastReset(doc);
    // -1: every window showing this document. The banner is per document, not per view.
    this.relay({
      panelId: doc.panelId,
      unloadable: false,
      deleted: false,
      dirty: doc.authority.dirty,
    });
    this.notifyAfterMutation(doc, !doc.authority.doc.eq(before));
  }

  /**
   * AUTO-RECOVERY (027 / #161, FR-012): a path we could not read is readable again.
   *
   * This is the issue itself — the user renames the folder back, and until now nothing re-read the
   * path, so the editor stayed stranded for the rest of the session with no way out but destroying
   * the panel and reopening the file.
   *
   * What decides it is whether the buffer holds work that only exists there. It is NOT
   * `authority.dirty`, and that distinction is the whole subtlety: a document whose file went
   * missing is FORCE-dirtied ({@link DocumentAuthority.markUnsaved} drops `savedText`) precisely so
   * it cannot look saved — so by the time we get here, EVERY stranded document reports dirty,
   * whether the user typed a word or not. Reading that flag would mean never recovering anything.
   * {@link markDeleted} therefore records what was true before it intervened.
   *
   * • Nothing of the user's in the buffer → adopt the file: its current content, in place, in the
   *   same panel, tab and panel name.
   * • Genuine unsaved edits → keep them. They are the only copy, and replacing them with the disk
   *   would be data loss dressed up as a recovery. The banner still goes (the path reads again, so
   *   Save and Revert both work now) and the divergence is announced through the ordinary one-shot
   *   "changed on disk" notice — after which `Reload from disk` is the user's explicit, confirmed
   *   way to take the file instead.
   */
  private pathCameBack(doc: CoordDoc, res: LoadResult & { ok: true }): void {
    const since = doc.missingSince;
    const hasOwnWork = since
      ? since.wasDirty || since.text !== doc.authority.text
      : doc.authority.dirty && doc.authority.savedText !== null;
    doc.missingSince = undefined;
    if (!hasOwnWork) {
      this.adoptFromDisk(doc, res);
      return;
    }
    doc.fileMissing = false;
    doc.unloadable = false;
    doc.neverRead = false;
    doc.encoding = res.encoding;
    doc.hasBom = res.hasBom;
    doc.lineEnding = res.lineEnding;
    this.relay({
      panelId: doc.panelId,
      unloadable: false,
      deleted: false,
      dirty: doc.authority.dirty,
    });
    if (res.text !== doc.authority.text && !doc.diskChanged) {
      doc.diskChanged = true;
      this.relay({ panelId: doc.panelId, externalChange: true });
    }
    // The buffer is kept, so in practice nothing flipped; asked anyway rather than assumed.
    this.notifyAfterMutation(doc, false);
  }

  /**
   * A view has mounted onto a document that was ALREADY open — does its path still read?
   * (027 / #161, FR-011a.)
   *
   * The mount path for an existing document adopts the authority's state and never touches the
   * disk, which is right for the case it was written for (a panel drag, a mirrored view) and blind
   * in the case this issue is about. Switch to another project and back, or reload the window, over
   * a path that has since moved, and the panel comes up holding remembered text with nothing to say
   * that its file is gone — the exact symptom reported, and the one the folder watch cannot cover
   * because the break happened while nobody was mounted to hear it.
   *
   * It sets ONLY `unloadable`, never `fileMissing`. `fileMissing` feeds the tab-open "cannot open
   * file" dialog, and FR-105 forbids that dialog on a remount — publishing it from here is what
   * reddened `editor-missing-aggregate` when this issue was first attempted.
   *
   * `resolveEntry` rather than `load` for the check: it is the same rule the load path applies, and
   * it does not read the file. The full read happens only when there is something to recover.
   */
  async verifyPath(panelId: string): Promise<void> {
    /*
     * ══ IT ALWAYS ANSWERS, EVEN WHEN IT HAS NOTHING TO SAY (#369) ══
     *
     * Every early return below is a legitimate "nothing to relay": the path is fine, the document
     * moved out from under the question, there is no path at all. But silence is not an answer a
     * VIEW can act on, and a view that has just mounted is waiting on precisely this call to learn
     * whether its own open decided anything — `EditorUiState.openPending`.
     *
     * Without the acknowledgement that pending state never clears on a healthy restore, so the
     * missing-file scan would have to bound its wait with a duration instead. That duration is the
     * defect this fixes; putting it back one layer down would be the same bug wearing a hat.
     *
     * `finally` rather than a line at each return: there are five ways out of this method, and the
     * next one added would otherwise be the one that forgets.
     */
    try {
      const doc = this.docFor(panelId);
      const abs = doc?.absPath;
      if (!doc || !abs) return;
      // 050 FR-035 — a moved-out document reads nothing: its path is another project's, and "could not
      // be read" would be a false claim about a file that is fine where it went.
      if (doc.movedOut || doc.replaced) return; // 052 FR-012 — nor a replaced one: the file is the moved document's
      const req = {
        absPath: abs,
        ownerRoot: doc.ownerRoot,
        ownerKind: doc.ownerKind,
        allProjectRoots: doc.allProjectRoots,
      };
      const decision = await this.service.resolveEntry(req).catch(() => ({ ok: false }) as const);
      // The document can be re-pointed or destroyed inside that await (019) — anything decided about
      // the old path is an answer to a question nobody is asking any more.
      if (this.docFor(panelId) !== doc || doc.absPath !== abs) return;
      if (!decision.ok) {
        if (!doc.unloadable) {
          doc.unloadable = true;
          this.relay({ panelId: doc.panelId, unloadable: true });
          this.notifyAfterMutation(doc, false); // reports a `contentless` flip, should this ever make one
        }
        return;
      }
      if (!doc.unloadable && !doc.fileMissing) return; // nothing was wrong; nothing to do
      const res = await this.service.load(req);
      if (this.docFor(panelId) !== doc || doc.absPath !== abs) return;
      if (res.ok) this.pathCameBack(doc, res);
    } finally {
      this.relay({ panelId, verified: true });
    }
  }

  /** The authority's current state, for a view that is mounting or has fallen out of step. */
  resync(panelId: string): ResetDocumentMsg | null {
    const doc = this.docFor(panelId);
    if (!doc) return null;
    return this.stateOf(doc);
  }

  private applyHistoryStep(
    panelId: string,
    step: (doc: CoordDoc) => CanonicalChangeMsg | null,
  ): void {
    const doc = this.docFor(panelId);
    if (!doc || doc.movedOut) return; // 050 FR-035 — a moved-out document is read-only
    const canonical = step(doc);
    if (!canonical) return; // nothing left to undo/redo — not an error
    this.scheduleRecovery(doc);
    this.relay({ panelId: doc.panelId, change: canonical });
    this.notifyAfterMutation(doc, true);
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
      // Which file this is — so a view that did not ask for the replacement can follow it (FR-110).
      ...(doc.absPath !== null ? { filePath: doc.absPath } : {}),
    };
  }

  /**
   * Word wrap for a DOCUMENT (024 US1, FR-001a).
   *
   * Wrap is document state, not view state, so it cannot live in a renderer: two windows showing one
   * file would each hold their own answer and the two Panels would disagree — exactly what
   * constitution Principle XI forbids. The authority is here, and every view is told.
   *
   * Keyed by the file rather than the panel, because "the same document" means the same file open in
   * however many Panels and windows. An unsaved buffer has no file, so it is its own document.
   * Windows paths are compared case-insensitively — `App.ts` and `app.ts` are one file, and holding
   * two wrap values for it would be a bug the user sees as a panel that will not rewrap.
   */
  private readonly wordWrap = new Map<string, boolean>();

  private wrapKey(doc: CoordDoc): string {
    return doc.absPath ? fileKey(doc.absPath) : `panel:${doc.panelId}`;
  }

  /** The document's wrap, seeded from the `editor.defaultWordWrap` preference on first sight. */
  wordWrapFor(panelId: string, seedDefault: boolean): boolean {
    const doc = this.docFor(panelId);
    if (!doc) return seedDefault;
    const key = this.wrapKey(doc);
    const cur = this.wordWrap.get(key);
    if (cur === undefined) {
      this.wordWrap.set(key, seedDefault);
      return seedDefault;
    }
    return cur;
  }

  /**
   * Set the document's wrap and tell every Panel showing it, in every window.
   *
   * The broadcast is per panel because that is how the sync channel routes; the VALUE is per
   * document, so every panel on this file gets the same one.
   */
  setWordWrap(panelId: string, on: boolean): void {
    const doc = this.docFor(panelId);
    if (!doc) return;
    const key = this.wrapKey(doc);
    if (this.wordWrap.get(key) === on) return;
    this.wordWrap.set(key, on);
    for (const [id, other] of this.docs) {
      if (this.wrapKey(other) === key) this.relay({ panelId: id, wordWrap: on });
    }
  }

  /**
   * Drop a document's wrap once no Panel anywhere still shows it (FR-003): the override is
   * in-memory, so a document closed everywhere and reopened must start from the preference again,
   * not from whatever it was last toggled to.
   */
  private forgetWordWrapIfClosed(key: string): void {
    for (const doc of this.docs.values()) if (this.wrapKey(doc) === key) return;
    this.wordWrap.delete(key);
  }

  // ── Fold state, beside word wrap (047 R3, data-model.md "FoldState", contracts/preview-ipc-047.md §5) ──
  //
  // One map, keyed like `wordWrap` — `file:<path>` for a document, extended here to a PREVIEW's own
  // `panel:<id>` too. A preview is not a `CoordDoc`, so unlike `wordWrap` this map is not read through
  // `this.docs`: the caller (`editor-ipc.ts`, for an editor panel via `foldKeyForPanel`; `PreviewService`,
  // for a preview panel via its own `foldKeyFor`) resolves a panelId to a KEY first, and every method
  // below takes that key directly.

  private readonly fold = new Map<string, FoldState>();

  /** Seeds `key` with `initialFold(seed)` if absent (the word-wrap `seedDefault` precedent) and returns it. */
  foldStateFor(key: string, seed: 'expanded' | 'collapsed'): FoldState {
    const cur = this.fold.get(key);
    if (cur) return cur;
    const seeded = initialFold(seed);
    this.fold.set(key, seeded);
    return seeded;
  }

  /** `key`'s CURRENT fold state, or `undefined` — unlike {@link foldStateFor}, NEVER seeds: a read must
   *  not create state (047 FR-041d, `PreviewService`'s per-entry snapshot, which must not manufacture a
   *  fold to remember merely by asking what the run currently shows). */
  readFold(key: string): FoldState | undefined {
    return this.fold.get(key);
  }

  /** The `file:<path>` key for an EDITOR panel (an unpathed document's own `panel:<id>`), or `undefined`
   *  when `panelId` names no open document — the counterpart to `PreviewService.foldKeyFor`. */
  foldKeyForPanel(panelId: string): string | undefined {
    const doc = this.docFor(panelId);
    return doc ? this.wrapKey(doc) : undefined;
  }

  /**
   * Set `key`'s fold state and relay it to every window (the word-wrap `setWordWrap` precedent, with no
   * echo to `excludeWebContentsId` — the sender already applied it locally, the `applyWordWrapFromSync`
   * precedent). A no-op update relays nothing: `FoldState` compares by value, and `flipped` is always
   * kept sorted and de-duplicated by its caller (`outline/fold-state.ts`), so two states reaching the
   * same set compare equal with a plain `toEqual`.
   *
   * The relay carries the KEY, not a list of panelIds — see {@link EditorSyncMsg.foldState}.
   */
  setFoldState(key: string, state: FoldState, excludeWebContentsId: number): void {
    const cur = this.fold.get(key);
    if (cur && sameFold(cur, state)) return;
    this.fold.set(key, state);
    this.deps.relaySync(excludeWebContentsId, { panelId: key, foldState: { key, state } });
  }

  /**
   * A preview transitioned parented ⇄ standalone (R3, contract §5, `PreviewService.makeParented` /
   * `makeStandalone`): re-key its fold entry.
   *
   * Becoming PARENTED (`parented: true`) drops the preview's `panel:<id>` entry, and the document's
   * `file:` entry governs from then on. Which state that entry holds depends on whether one exists:
   *
   * - It exists — an editor already showed the document — so its state applies unchanged (FR-034).
   * - It does not — the editor whose registration parented this preview is the document's FIRST view
   *   (an editor's fold key only resolves once its document is loaded, so its own seed request cannot
   *   have created it) — so the document ADOPTS the preview's state, and it is relayed to every window
   *   so the new editor's view, already seeded with the preference, follows it (047 FR-078, MT-04).
   *
   * Becoming STANDALONE (`parented: false`) seeds a fresh `panel:<id>` entry from `fileKey`'s CURRENT
   * state, so the preview keeps what it showed. Only when no `panel:` entry exists yet: a transition
   * delivered twice (the lifecycle listener's `registered`/`unregistered` are not exactly-once across
   * every edge, `docstring at file top`) must not clobber a fold the reader has since changed.
   */
  reparentFold(previewPanelId: string, fileKey: string, parented: boolean): void {
    const previewKey = `panel:${previewPanelId}`;
    if (parented) {
      const shown = this.fold.get(previewKey);
      this.fold.delete(previewKey);
      if (shown && !this.fold.has(fileKey)) this.setFoldState(fileKey, shown, -1);
      return;
    }
    if (this.fold.has(previewKey)) return;
    const current = this.fold.get(fileKey);
    if (current) this.fold.set(previewKey, current);
  }

  /** Unconditionally forgets `key` (a STANDALONE preview's `panel:<id>` on `PreviewService.dropRun`) —
   *  unlike {@link forgetFoldIfUnused}, nothing else can hold a `panel:` key, so no check is needed. */
  forgetFold(key: string): void {
    this.fold.delete(key);
  }

  /** Drop a document's `file:` fold entry once no EDITOR panel anywhere still shows it (the word-wrap
   *  `forgetWordWrapIfClosed` precedent) — called after every lifecycle listener has re-keyed a preview
   *  that was parented to it, so `reparentFold`'s seed-from-current-state still finds the entry. */
  private forgetFoldIfUnused(key: string): void {
    for (const doc of this.docs.values()) if (this.wrapKey(doc) === key) return;
    this.fold.delete(key);
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
    this.relay({ panelId: doc.panelId, reset: this.stateOf(doc) });
  }

  // ── Document lifecycle listener (044 u4, contracts/preview-ipc.md §3) ─────────────────────────
  // Every call site runs these LAST, once the coordinator's own state and relays have settled.

  /**
   * Call the listener, isolated: a throw is logged and dropped, never propagated. The listener is an
   * observer; letting it abort a save half-way (registry re-pointed, document still dirty, temp still on
   * disk) would hand an observer's bug to the user as data loss.
   */
  private tell(event: keyof DocumentLifecycleListener, call: (listener: DocumentLifecycleListener) => void): void {
    const listener = this.deps.documentLifecycle;
    if (!listener) return;
    try {
      call(listener);
    } catch (err) {
      console.error(`[editor-coordinator] document lifecycle listener threw on ${event}:`, err);
    }
  }

  /** Call the history hooks, isolated exactly as the listener is (044 US7). */
  private tellHistory(what: keyof EditorHistoryHooks, call: (history: EditorHistoryHooks) => void): void {
    const history = this.deps.history;
    if (!history) return;
    try {
      call(history);
    } catch (err) {
      console.error(`[editor-coordinator] navigation history threw on ${what}:`, err);
    }
  }

  /** A load put `absPath` into the panel: record it, or — for Back/Forward — move to it (§3). */
  private recordNavigation(
    panelId: string,
    absPath: string,
    navigation: EditorLoadNavigation | undefined,
    persisted: PersistedHistory | undefined,
  ): void {
    if (navigation?.kind !== 'history') {
      this.tellHistory('recordOpen', (h) => h.recordOpen(panelId, absPath, persisted));
      return;
    }
    // The intent names a file; a load of a DIFFERENT one is not that step, so it moves nothing — but a
    // history it carries is still the panel's, and is adopted.
    if (!samePath(navigation.filePath, absPath)) {
      if (persisted !== undefined) this.tellHistory('attach', (h) => h.attach(panelId, 'editor', persisted));
      return;
    }
    this.tellHistory('moveTo', (h) => h.moveTo(panelId, navigation.index, absPath, persisted));
  }

  /**
   * After any mutation: `changed` when the canonical text changed OR `contentless` flipped, and
   * `dirtyChanged` only when the dirty state differs from what the listener was last told — exactly once
   * per flip, whichever path caused it, and silence when a relay merely restated a flag that did not move.
   *
   * `contentless` rides `changed` because it is part of what a parented preview shows (FR-026, adversarial
   * review main item 1): a document with no content to follow shows that notice, not its empty text. The
   * path reading again can change no text at all — an empty file under the FR-106d stand-in — so without
   * this the preview kept the notice for a file the editor had just adopted.
   */
  private notifyAfterMutation(doc: CoordDoc, textChanged: boolean): void {
    const contentless = isContentless(doc);
    const contentFlipped = contentless !== doc.reported.contentless;
    doc.reported.contentless = contentless;
    if (textChanged || contentFlipped) this.tell('changed', (l) => l.changed(doc.panelId));
    const dirty = doc.authority.dirty;
    if (dirty === doc.reported.dirty) return;
    doc.reported.dirty = dirty;
    this.tell('dirtyChanged', (l) => l.dirtyChanged(doc.panelId, dirty));
  }

  /**
   * The SAME document's path moved — `markMoved`, or `save` with a new target. One `repointed` from
   * the path last announced, or `registered` when none was (the first Save As of an unpathed document).
   */
  private announcePath(doc: CoordDoc): void {
    const from = doc.reported.path;
    const to = doc.absPath;
    if (from === to || to === null) return;
    doc.reported.path = to;
    if (from === null) this.tell('registered', (l) => l.registered(to, doc.panelId));
    else this.tell('repointed', (l) => l.repointed(from, to, doc.panelId));
  }

  /**
   * `load`/`register` put a NEW authority into a panel. Loading the path the listener already knows for
   * this panel is the same document to it — a double-click racing its own open, or two mirrored views
   * mounting at once — so only the text and dirty changes are reported, and the pair stays balanced.
   * A different path is a different document: `unregistered(old)`, `registered(new)`, and a fresh dirty
   * baseline the listener reads from `getContent`.
   */
  private announceReplacement(doc: CoordDoc, previous: CoordDoc | undefined): void {
    const told = doc.reported;
    if (previous && told.path === doc.absPath) {
      this.notifyAfterMutation(doc, !doc.authority.doc.eq(previous.authority.doc));
      return;
    }
    const oldPath = told.path;
    const newPath = doc.absPath;
    told.path = newPath;
    told.dirty = doc.authority.dirty;
    told.contentless = isContentless(doc);
    if (oldPath !== null) this.tell('unregistered', (l) => l.unregistered(oldPath, doc.panelId));
    if (newPath !== null) this.tell('registered', (l) => l.registered(newPath, doc.panelId));
  }

  /** Save one document's stored content (Ctrl+S). `absPath` sets a new location. */
  async save(payload: {
    panelId: string;
    absPath?: string;
    lineEnding?: LineEndingId;
    ownerKind?: EditorOwnerKind;
    ownerRoot?: string | null;
    allProjectRoots?: readonly string[];
  }): Promise<SaveResult | { ok: false; reason: 'no-location' | 'replaced'; error: string }> {
    const doc = this.docFor(payload.panelId);
    if (!doc) return { ok: false, reason: 'io', error: 'No such open document.' };
    // 052 FR-012 — the file at this path is the moved document's now; a plain Save must never write over it.
    // The same refusal shape as a moved-out document's (`saveMovedOut`), asked before the claim check below,
    // which would otherwise answer with a reason that names the wrong cause.
    if (doc.replaced && payload.absPath === undefined) {
      return { ok: false, reason: 'replaced', error: REPLACED_SAVE_REFUSAL };
    }
    const wasReplaced = doc.replaced === true;
    const target = payload.absPath ?? doc.absPath;
    if (!target) return { ok: false, reason: 'no-location', error: 'Choose where to save first.' };
    // Save-As onto a path already open in ANOTHER editor would bind two buffers to
    // one file (violates the app-wide one-buffer rule, FR-011a).
    // A moved-out document holds no claim (050 FR-035), so ANY claim on its target is another editor's.
    if (target !== doc.absPath || doc.movedOut || doc.replaced) {
      const at = openOrFocus(this.registry, target);
      if (at.action === 'focus' && at.panelId !== doc.panelId) {
        return { ok: false, reason: 'io', error: 'That file is already open in another editor.' };
      }
    }
    if (payload.lineEnding) doc.lineEnding = payload.lineEnding;
    if (payload.ownerKind) doc.ownerKind = payload.ownerKind;
    if (payload.ownerRoot !== undefined) doc.ownerRoot = payload.ownerRoot;
    if (payload.allProjectRoots) doc.allProjectRoots = [...payload.allProjectRoots];
    // 050 FR-036 — a moved-out document saving anywhere but its OWN project goes by the exception. Save As
    // back into its own project is ordinary 006 FR-084 and takes the path below; it ends moved-out state.
    const wasMovedOut = doc.movedOut === true;
    if (wasMovedOut && (payload.absPath === undefined || leavesOwner(doc, target))) {
      return this.saveMovedOut(doc, payload.absPath);
    }

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
    doc.unloadable = false; // …and the path is demonstrably writable, so it reads (027 / #161)
    doc.neverRead = false; // what is on disk now is this buffer
    doc.missingSince = undefined;
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
    this.relay({ panelId: doc.panelId, dirty: false });
    if (wasReplaced) {
      // 052 FR-012 — Save As kept the changes: an ordinary document at its new path, claimed and watched
      // above. `reported.path` was cleared when it was replaced, so `announcePath` says `registered`.
      doc.replaced = false;
      this.relay({ panelId: doc.panelId, replaced: false });
    }
    if (wasMovedOut) {
      // 050 FR-036 — a Save As into its own project: an ordinary editor of that file again, claimed and
      // watched above. `reported.path` was cleared when it moved out, so `announcePath` says `registered`.
      doc.movedOut = false;
      this.relay({ panelId: doc.panelId, movedTo: target, movedOut: false });
    } else if (pathChanged && this.heirOf(doc.panelId) !== undefined) {
      // 052 R3 — the document lives at `target` now, and every PANEL showing it must say so: the Save As may
      // have been made through either one, and the other would keep the path it just left. Only when the
      // document has linked panels — a lone panel's own view already knows, and 044 T043 pins that a save
      // otherwise relays no `movedTo` (`editor-coordinator-lifecycle.integration.test.ts`).
      this.relay({ panelId: doc.panelId, movedTo: target });
    }
    // FR-013c / FR-013a — only now, with the save fully settled and relayed. A Save As of a pathed
    // document is one `repointed`, exactly as an in-app move; the first Save As of an unpathed one is
    // `registered(target)`, because a document now exists for that file. The relay above carries no
    // `movedTo` for a save, so this is the only way `PreviewService` learns either (T043).
    this.announcePath(doc);
    // R14, FR-109 — a Save As re-points the editor's CURRENT history entry: no second entry, and no stale
    // one for Back to land on. The first Save As of an unpathed document records it (H8). Called here
    // rather than through the listener, whose one slot is `PreviewService`'s.
    if (pathChanged) this.tellHistory('rewriteCurrent', (h) => h.rewriteCurrent(doc.panelId, target));
    this.notifyAfterMutation(doc, false);
    return result;
  }

  /**
   * 050 FR-036 (amended) — saving a moved-out document.
   *
   * Save (no new path) is refused: the file is another project's now. Save As outside its own project may
   * write anywhere inside the project root that holds the document's current path — the one exception to
   * 006 FR-084's confinement — and nowhere else. (Save As into its own project never reaches here: that is
   * ordinary FR-084, handled by `save`, and makes it an ordinary editor again.) A successful one leaves the
   * document moved out: clean, `absPath` the saved path, still no registry claim and no watch, so the
   * saved file is the destination project's to open (Principle XI).
   */
  private async saveMovedOut(
    doc: CoordDoc,
    target: string | undefined,
  ): Promise<SaveResult | { ok: false; reason: 'no-location'; error: string }> {
    const refused = (error: string): SaveResult => ({ ok: false, reason: 'out-of-tree', error });
    if (target === undefined) return refused('This file moved to another project. Use Save As to keep your changes.');
    const here = doc.absPath;
    const destinationRoot = here ? doc.allProjectRoots.find((root) => isUnderPath(here, root)) : undefined;
    if (destinationRoot === undefined) return refused('This file moved to another project, which is no longer open.');
    const result = await this.service.save({
      absPath: target,
      text: doc.authority.text,
      encoding: doc.encoding,
      hasBom: doc.hasBom,
      lineEnding: doc.lineEnding,
      ownerKind: 'project',
      ownerRoot: destinationRoot,
      allProjectRoots: doc.allProjectRoots,
    });
    if (!result.ok) {
      return result.reason === 'out-of-tree'
        ? refused('This file can only be saved inside the project it moved to.')
        : result;
    }
    const pathChanged = doc.absPath !== target;
    doc.absPath = target;
    doc.authority.markSaved();
    doc.fileMissing = false;
    doc.unloadable = false;
    doc.neverRead = false;
    doc.missingSince = undefined;
    doc.diskChanged = false;
    if (doc.recoveryTimer) {
      clearTimeout(doc.recoveryTimer);
      doc.recoveryTimer = undefined;
    }
    void this.recovery.remove(doc.panelId);
    this.relay({ panelId: doc.panelId, dirty: false });
    this.relay({ panelId: doc.panelId, movedTo: target, movedOut: true });
    if (pathChanged) this.tellHistory('rewriteCurrent', (h) => h.rewriteCurrent(doc.panelId, target));
    this.notifyAfterMutation(doc, false);
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
    })
      // 050 FR-036 — Save is unavailable on a moved-out document; Save All passes it by, as it would a clean one.
      // 052 R5 — a replaced one is NOT passed by: `save` refuses it, so it lands in `failed` as `replaced`, and
      // a caller closing its panel (Unload, Remove → Save) stops rather than dropping the changes silently.
      .filter((id) => this.docs.get(id)?.authority.dirty && !this.docs.get(id)?.movedOut);
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
    if (!doc) {
      // 052 FR-011 — a linked panel has no document of its own; closing it ends only the link.
      this.links.delete(panelId);
      return;
    }
    const heir = this.heirOf(panelId);
    if (heir !== undefined) {
      this.handOver(doc, heir);
      return;
    }
    const wrapKey = this.wrapKey(doc);
    if (doc.recoveryTimer) clearTimeout(doc.recoveryTimer);
    this.disposeWatch(doc);
    unregisterPanel(this.registry, panelId);
    this.docs.delete(panelId);
    // After the delete, so "is anyone still showing this document?" asks about the panels that remain.
    this.forgetWordWrapIfClosed(wrapKey);
    void this.recovery.remove(panelId);
    // Last, and cleared first: a `load` that awaited across this destroy carries `reported` over,
    // and must not unregister the same path a second time.
    const told = doc.reported.path;
    doc.reported.path = null;
    if (told !== null) this.tell('unregistered', (l) => l.unregistered(told, panelId));
    // 047 R3 — AFTER `unregistered`, not beside `forgetWordWrapIfClosed` above: a preview parented to
    // THIS panel falls back to standalone from that very listener call (`PreviewService.unregistered` →
    // `makeStandalone` → `reparentFold(…, wrapKey, false)`), which seeds its new `panel:<id>` entry by
    // reading `wrapKey`'s CURRENT fold state. Forgetting it any earlier would seed from nothing.
    this.forgetFoldIfUnused(wrapKey);
  }

  /**
   * 052 FR-011 (contracts/editor-replace.md) — the owner panel closes while `heir` still shows its document.
   *
   * The document is not closed: it is the same document, re-keyed to `heir`. Text, version, dirty state and
   * undo history all carry over; nothing is read from disk. The claim and the recovery temp move to the new
   * id, every other linked panel is re-pointed at `heir`, and the lifecycle listener hears the old panel's
   * document go and the new one's arrive — the panel ids are what changed.
   */
  private handOver(doc: CoordDoc, heir: string): void {
    const from = doc.panelId;
    const view = this.links.get(heir);
    this.links.delete(heir);
    this.docs.delete(from);
    doc.panelId = heir;
    doc.authority.rekey(heir);
    // R7b — the document lives where its new panel does, so `focusExisting` raises that window.
    if (view) {
      doc.windowId = view.windowId;
      doc.tabId = view.tabId;
    }
    this.docs.set(heir, doc);
    unregisterPanel(this.registry, from);
    if (doc.absPath && !doc.movedOut && !doc.replaced) {
      registerOpen(this.registry, doc.absPath, { panelId: heir, windowId: doc.windowId });
    }
    // The temp is keyed by panel id: the old one would be an orphan, and a dirty document needs one under
    // its new id, or a crash now would lose the work the hand-over just preserved.
    void this.recovery.remove(from);
    if (doc.authority.dirty) this.scheduleRecovery(doc);
    const reset = this.stateOf(doc);
    this.deps.relaySync(-1, { panelId: heir, linkedTo: null, reset });
    this.repointLinks(from, heir, reset);
    const told = doc.reported.path;
    if (told !== null) {
      this.tell('unregistered', (l) => l.unregistered(told, from));
      this.tell('registered', (l) => l.registered(told, heir));
    }
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
    /** The path could not be read when this document was adopted (027 / #161). */
    unloadable: boolean;
    /** 050 FR-035 — a move took the file out of this document's project; it is detached and read-only. */
    movedOut: boolean;
    /** 052 FR-012 — a Replace landed on this document's path while it was dirty (see `CoordDoc.replaced`). */
    replaced: boolean;
    /**
     * 044 — the document has NO content of its file to follow: its path cannot be read and has never been
     * read in its panel (the FR-106d stand-in, a restore-time unloadable register). A parented preview shows
     * FR-026's notice exactly while this holds; a document read and then deleted keeps its buffer and is
     * not contentless (FR-022 over FR-026, fix round 1 ruling). `changed` fires on every flip of it.
     */
    contentless: boolean;
    encoding: EncodingId;
    hasBom: boolean;
    lineEnding: LineEndingId;
  } | null {
    const doc = this.docFor(panelId);
    if (!doc) return null;
    return {
      text: doc.authority.text,
      dirty: doc.authority.dirty,
      version: doc.authority.version,
      absPath: doc.absPath,
      fileMissing: !!doc.fileMissing,
      // A REMOUNT reads its state from here and never attempts a load, so the banner survives a
      // tab/project/panel switch only because this is published (027 / #161).
      unloadable: !!doc.unloadable,
      // 050 FR-035 — a remount shows the moved notice from this, without reading.
      movedOut: !!doc.movedOut,
      // 052 FR-012 — a remount shows the replaced notice from this, without a relay.
      replaced: !!doc.replaced,
      contentless: isContentless(doc),
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
    if (res.ok && (doc.unloadable || doc.fileMissing)) {
      this.pathCameBack(doc, res);
      return;
    }
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
      // delete: keep the buffer, mark dirty + file-missing (FR-099). `markDeleted` itself leaves an
      // untyped `neverRead` document alone (the FR-106d stand-in, a failed restore): its file was already
      // gone, so there is no buffer to keep, and a file that later appears is still adopted by the
      // `res.ok` branch above. One rule for the watch and for File Explorer's delete.
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
      const before = doc.authority.doc;
      doc.authority.reset(res.text);
      this.broadcastReset(doc);
      this.notifyAfterMutation(doc, !doc.authority.doc.eq(before));
    } else if (!doc.diskChanged) {
      // Dirty editor: warn ONCE that the on-disk file diverged (save will overwrite).
      doc.diskChanged = true;
      this.relay({ panelId: doc.panelId, externalChange: true });
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
    try {
      await this.recovery.write(doc.panelId, {
        version: doc.authority.version,
        text: doc.authority.text,
        ...(withHistory ? { history: doc.authority.serialiseHistory() } : {}),
      });
    } catch (err) {
      /*
       * Reported and dropped, never re-thrown (#305).
       *
       * Both callers fire this and walk away (`void this.snapshot(doc)`) — the debounced one from a
       * timer, the immediate one from a file going missing — so a rejection escaping here is an
       * unhandled rejection in the MAIN process. That is a disproportionate answer to a failed
       * snapshot: recovery is best-effort by construction, the document it protects is still open
       * and unharmed in the editor, and the next keystroke schedules another attempt 400ms later.
       *
       * Catching HERE rather than at the two call sites so a third one cannot reintroduce it.
       */
      console.error(`[editor-recovery] could not snapshot panel ${doc.panelId}:`, err);
    }
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
 * 050 FR-035 — is `absPath` outside the project that owns this document? Only a PROJECT-owned document
 * with a known root can be moved out; a sub-workspace editor's files lie outside every project and a
 * cross-project move never takes one as a source.
 */
function leavesOwner(doc: CoordDoc, absPath: string): boolean {
  return doc.ownerKind === 'project' && doc.ownerRoot !== null && !isUnderPath(absPath, doc.ownerRoot);
}

/** No content of its file to follow: unreadable, and never read in its panel (`CoordDoc.neverRead`). */
function isContentless(doc: CoordDoc): boolean {
  return doc.unloadable === true && doc.neverRead === true;
}

/**
 * Where did this document's file go — if it went anywhere? (FR-002/FR-005.)
 *
 * A folder's pair re-points every document beneath it by PREFIX: one pair, N docs. Containment is
 * decided on the NORMALISED form, because the doc's path is the tree's forward-slashed spelling
 * while the pair's is `node:path.join`'s (FR-007), and the remainder is cut after the folder's
 * SEGMENTS (`remainderUnder`) — so it begins with a separator, whichever way it was spelled.
 *
 * The result is spelled the way the DESTINATION is spelled, rather than being a mongrel of the two
 * (`…\dest\pack/one.txt`). Nothing downstream is hurt by a mixed separator — `toDisplayPath`
 * rewrites for the pill and every comparison normalises first — but this path is written into the
 * panel's persisted config verbatim (FR-008), and what lands in the user's config file should be a
 * path they could have typed.
 *
 * Exported for `PreviewService` (044 u7), whose standalone previews follow an in-app move by the same
 * rule — one rule for "where did this file go", not two that must agree. The rule itself now lives in core
 * (050 R19, `workspace/moved-paths.ts`), so the layout walk and the renderer's held-layout patch use it too.
 */
export function movedPathOf(absPath: string, moves: readonly MovePair[]): string | null {
  return coreMovedPathOf(absPath, moves);
}

/**
 * The `file:<path>` half of `wrapKey`'s form — forward-slashed, lower-cased, so `App.ts` and `app.ts`
 * are one key (word wrap's Windows-case rule, above). Exported for `PreviewService` (047 R3), whose
 * runs are not `CoordDoc`s and so compute a document's fold key from `run.filePath` directly, rather
 * than through this coordinator's `docs` registry.
 */
export function fileKey(absPath: string): string {
  return `file:${absPath.replace(/\\/g, '/').toLowerCase()}`;
}

/** Value equality for `FoldState`: `flipped` is kept sorted and de-duplicated by its caller. */
function sameFold(a: FoldState, b: FoldState): boolean {
  return a.base === b.base && a.flipped.length === b.flipped.length && a.flipped.every((s, i) => s === b.flipped[i]);
}
