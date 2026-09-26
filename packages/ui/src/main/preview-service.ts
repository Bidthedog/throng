/**
 * PreviewService — the ONE main-process authority for open previews (044, data-model §10,
 * contracts/preview-ipc.md §1–§3).
 *
 * ## What it owns, and what it deliberately does not
 *
 * A preview is a VIEW of a file (FR-013). It holds no buffer, no dirty state and no undo of its own
 * (Principle XI): a parented preview's content is read from the editor coordinator's authority when
 * its settle scheduler fires, and a standalone preview's from the disk through `EditorService`'s read
 * path. Nothing here writes to either.
 *
 * What it does own is the state that would otherwise be derived separately in every window — and two
 * windows deriving one fact is two originals (plan, Principle XI in full):
 *
 * - **runs** by preview panel id, with the windows viewing each (`viewers`);
 * - **byPath**, the canonical path → run map that makes "at most one preview per file" (FR-012) a
 *   property of one map rather than of every window agreeing;
 * - **reservations**, so two opens in quick succession can never place two previews;
 * - whether each run is **parented**, derived from the coordinator's registry and followed through
 *   its {@link DocumentLifecycleListener} events — never stored on the panel (FR-013, FR-066);
 * - the latest **editor titles** windows publish, forwarded as `parent.title` (FR-031).
 *
 * ## Why every collaborator is injected
 *
 * Principle IX, and the practical reason: the coordinator, the reader, the watcher, the clock, the
 * push and the window focus are each a seam a test replaces, so the integration suites drive this
 * over a REAL coordinator and a real temp tree with no Electron at all.
 *
 * ## FR-025 — the standalone read path
 *
 * A standalone preview reads with `EditorService.load` and watches with `IFileWatcher`. It never calls
 * the coordinator's `load`, `register` or `openInto`, so the file never counts as open in an editor,
 * never appears dirty, and a later "open in editor" is unaffected (SC-006). The coordinator is reached
 * only through {@link PreviewDocuments}, which is read-only by construction.
 */
import { dirname } from 'node:path';
import {
  createSettleScheduler,
  editorAutoTitle,
  effectiveMaxWaitMs,
  enabledProviderFor,
  isUnderPath,
  normaliseForCompare,
  previewPathOf,
  samePath,
  type AppSettings,
  type Disposable,
  type IFileSystem,
  type IFileWatcher,
  type NavigationHistory,
  type PersistedHistory,
  type PreviewAttachRequest,
  type PreviewAttachResponse,
  type PreviewContent,
  type PreviewFocusMessage,
  type PreviewNavigateRequest,
  type PreviewNavigateResponse,
  type PreviewNotice,
  type PreviewOpenChanged,
  type PreviewOpenRequest,
  type PreviewOpenResponse,
  type PreviewPathChanged,
  type PreviewPlaceMessage,
  type PreviewProviderRegistry,
  type PreviewRefreshResponse,
  type PreviewUpdate,
  type SettleClock,
  type SettleScheduler,
} from '@throng/core';
import { movedPathOf, type DocumentLifecycleListener } from './editor-coordinator.js';
import type { EditorService, LoadResult } from './editor-service.js';
import type { MovePair } from './files-service.js';
import type { PreviewLookup, PreviewRunRef } from './preview-protocol.js';

/**
 * How long an `open` holds a path for the panel it asked a window to place (contracts/preview-ipc.md
 * §1). A guard against a window that dies between reservation and mount — not a user-facing value —
 * and a recorded Principle X deviation (plan, Complexity Tracking).
 */
export const OPEN_RESERVATION_TIMEOUT_MS = 10_000;

/**
 * A document's state as a preview reads it.
 *
 * `contentless` — the document has NO content of its file to follow: it could not read its path and has
 * never read it in its panel (the FR-106d stand-in, a restore-time `register(…, { unloadable: true })`).
 * Only then does a parented preview show FR-026's notice instead of the document (adversarial review, main
 * item 1). A document that WAS read and then lost its file keeps its buffer (FR-099) with the editor's
 * banner owning that condition, so its preview keeps following the buffer (FR-022; fix round 1 ruling).
 * The coordinator fires `changed` on every flip of it.
 */
export interface PreviewDocumentContent {
  text: string;
  dirty: boolean;
  contentless: boolean;
}

/** The coordinator, as a preview may see it: read-only. `EditorCoordinator` satisfies it. */
export interface PreviewDocuments {
  getContent(panelId: string): PreviewDocumentContent | null;
  documentFor(absPath: string): { panelId: string; windowId: string } | null;
}

/** Main → renderer. `broadcast*` reach every window; the rest reach the one named. */
export interface PreviewPush {
  update(webContentsId: number, update: PreviewUpdate): void;
  broadcastOpenChanged(payload: PreviewOpenChanged): void;
  broadcastPathChanged(payload: PreviewPathChanged): void;
  sendFocus(webContentsId: number, payload: PreviewFocusMessage): void;
  /**
   * Whether the `place` reached a live window. `false` — a window that is gone, or a send that threw — is
   * an immediate decline: nothing will ever answer `placeDeclined` for it (§1, adversarial review ruling).
   */
  sendPlace(webContentsId: number, payload: PreviewPlaceMessage): boolean;
}

export interface PreviewWindows {
  /** The main window's webContents id, or `null` when it is gone. */
  mainWindowId(): number | null;
  /** Bring a window to the front and give it focus. */
  raise(webContentsId: number): void;
}

/**
 * `NavigationHistoryService`'s (US7, T146) narrow face, as this service calls it (contracts/preview-ipc.md
 * §1 `attach` / `navigate` / `destroyed`, §3 FR-013c). Optional: with none injected nothing is recorded
 * and a history-intent `navigate` is refused. Every call is isolated — a throwing history never aborts
 * an attach, a navigate, a destroy or a re-point.
 */
export interface PreviewHistoryHooks {
  /** Adopt the panel's record, or create it from the layout's persisted copy. Answers the record. */
  attach(panelId: string, kind: 'preview', history: PersistedHistory | undefined): NavigationHistory;
  /** The panel's record, or `undefined`. */
  get(panelId: string): NavigationHistory | undefined;
  rewriteCurrent(panelId: string, filePath: string): void;
  purge(panelId: string): void;
  /** The file a preview opens with, and a link followed in place (FR-090a, FR-103b): a new newest entry. */
  recordOpen(panelId: string, filePath: string): void;
  /** Back or Forward landed (FR-102): move if entry `index` still names `filePath`; whether it did. */
  moveTo(panelId: string, index: number, filePath: string): boolean;
  /** Where the reader was on the entry being left (FR-107). */
  setCurrentViewState(panelId: string, viewState: unknown): void;
  /** A same-document heading followed (FR-115): a same-file entry at `arriving`. No-op for an editor record. */
  recordJump(panelId: string, leaving: unknown, arriving: unknown): void;
}

export interface PreviewServiceDeps {
  documents: PreviewDocuments;
  /** `EditorService.load` — the standalone read path (FR-025). */
  reader: Pick<EditorService, 'load'>;
  fs: Pick<IFileSystem, 'exists' | 'stat' | 'realpath'>;
  fileWatcher: IFileWatcher;
  /** Read live: a changed delay, max wait, size limit or provider toggle applies to the next use. */
  settings: () => AppSettings;
  registry: PreviewProviderRegistry;
  /** Main's own answer to "where is this project?" — never the renderer's (Principle I). */
  projectRoot: (projectId: string) => Promise<string | undefined>;
  push: PreviewPush;
  windows: PreviewWindows;
  clock?: SettleClock;
  history?: PreviewHistoryHooks;
}

type RunSource = { kind: 'document'; documentPanelId: string } | { kind: 'disk'; watch: Disposable };

interface PreviewRun {
  panelId: string;
  projectId: string;
  projectRoot: string;
  filePath: string;
  providerId: string;
  source: RunSource;
  revision: number;
  lastSent: PreviewContent | null;
  /** Only ever copied from the document (FR-040). */
  dirty: boolean;
  notice: PreviewNotice | null;
  /** Created on the first change, and rebuilt between bursts when the timing settings change. */
  scheduler: SettleScheduler | null;
  timing: { delayMs: number; maxWaitMs: number } | null;
  viewers: Set<number>;
  /** The window that attached most recently — who to focus when no window is viewing. */
  lastViewer: number;
  /** An in-app move of this file is in progress (FR-013c): its absence is the move, not a delete. */
  movePending: boolean;
  /** Bumped by every disk read and every change of source, so a stale read lands nowhere. */
  readSeq: number;
  /** Bumped by every link navigation, so one overtaken by a later one while it read changes nothing. */
  navigateSeq: number;
  /**
   * 044 T177 — how many times this run has actually MOVED to another file (`moveRun`), sent on every
   * update. A re-point (`rebind` alone: an in-app move, a Save As) leaves it, which is how the renderer
   * tells the two apart and keeps the reader's place through a rename (FR-024, FR-013c).
   */
  navigationSeq: number;
  /**
   * The run is parented to a document with no content to follow, and its notice says so (FR-026). The
   * last state applied — what `changed` compares a document's `contentless` against, so a flip is shown at
   * once rather than on the settle schedule.
   */
  documentContentless: boolean;
}

/**
 * The content of a run whose file could not be shown (FR-026) after a link moved it there. Explicitly
 * empty — never `null`, which on the wire means "unchanged" and would keep the previous file's document
 * on screen under the new path.
 */
const CLEARED_CONTENT: PreviewContent = { kind: 'text', text: '' };

interface Reservation {
  token: string;
  /** The window that will place it — focused if a second open arrives meanwhile. */
  webContentsId: number;
  /** Routed to another window (§2 `place`): that window is focused when it attaches. */
  placedElsewhere: boolean;
  timer: unknown;
}

interface PendingPlace {
  canon: string;
  payload: PreviewPlaceMessage;
  /** Where a decline goes next — the registry's recorded window — or `null` once that is spent. */
  next: number | null;
  /** The window that asked: the last resort places it there standalone (§1, amended; review M-1). */
  requester: number;
  /** The standalone fallback has been sent; a decline of it ends the placement. */
  fallbackSent: boolean;
}

type DiskRead = { ok: true; content: PreviewContent } | { ok: false; notice: PreviewNotice };

const REAL_CLOCK: SettleClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** The comparable form every map here is keyed by, and the path `openChanged` carries. */
const canon = (path: string): string => normaliseForCompare(path);

export class PreviewService implements DocumentLifecycleListener, PreviewLookup {
  private readonly runs = new Map<string, PreviewRun>();
  private readonly byPath = new Map<string, string>();
  private readonly pending = new Map<string, Reservation>();
  private readonly places = new Map<string, PendingPlace>();
  private readonly editorTitles = new Map<string, string>();
  private readonly attaching = new Map<string, Promise<PreviewAttachResponse>>();
  /** How many `attach` calls are in progress per panel, waiting ones included. */
  private readonly attachesInFlight = new Map<string, number>();
  /** Panels `destroyed` while an attach for them was in flight — `destroyed` wins (§1, amended). */
  private readonly destroyedWhileAttaching = new Set<string>();
  private readonly clock: SettleClock;
  private seq = 0;

  constructor(private readonly deps: PreviewServiceDeps) {
    this.clock = deps.clock ?? REAL_CLOCK;
  }

  // ── PreviewLookup (the protocol handler, contracts/preview-ipc.md §4) ─────────────────────────

  run(previewPanelId: string): PreviewRunRef | undefined {
    const run = this.runs.get(previewPanelId);
    return run && { projectRoot: run.projectRoot, filePath: run.filePath, providerId: run.providerId };
  }

  /** Whether a preview of this file is open (FR-012) — for menus built at open time. */
  isOpen(absPath: string): boolean {
    return this.byPath.has(canon(absPath));
  }

  /**
   * Every path with a run, in compare form (§1 `openPaths`, FR-012, FR-014) — the seed a window created
   * after those previews opened starts its open set from. `byPath` holds exactly one key per open path
   * however many runs share it, and a reservation is not a run, so nothing still being placed is listed.
   */
  openPaths(): string[] {
    return [...this.byPath.keys()];
  }

  // ── open (§1) ─────────────────────────────────────────────────────────────────────────────────

  async open(fromWebContentsId: number, req: PreviewOpenRequest): Promise<PreviewOpenResponse> {
    const { absPath } = req;
    // 1. Provider, project containment and a real file (FR-004, FR-062).
    const provider = this.deps.registry.forPath(absPath);
    if (!provider) return { kind: 'refused', reason: 'no-provider' };
    if (!enabledProviderFor(this.deps.registry, this.previewSettings(), absPath)) {
      return { kind: 'refused', reason: 'disabled' };
    }
    const root = await this.deps.projectRoot(req.projectId);
    if (root === undefined || !isUnderPath(absPath, root)) return { kind: 'refused', reason: 'outside-project' };
    if (!(await this.isFile(absPath))) return { kind: 'refused', reason: 'no-file' };
    const real = await this.realContainment(absPath, root);
    if (real === null) return { kind: 'refused', reason: 'no-file' };
    if (!real) return { kind: 'refused', reason: 'outside-project' };

    // Everything below is one synchronous turn, so two opens racing for a path cannot both reserve it.
    const key = canon(absPath);

    // 2. A preview of this file exists, or is being placed (FR-012, FR-014).
    const existing = this.runForPath(key);
    if (existing) {
      const target = existing.viewers.size > 0 ? [...existing.viewers][0]! : existing.lastViewer;
      this.deps.windows.raise(target);
      this.deps.push.sendFocus(target, { panelId: existing.panelId });
      return { kind: 'focused', panelId: existing.panelId };
    }
    const reserved = this.pending.get(key);
    if (reserved) {
      // Already being placed: raise the placing window, but there is no panel yet to send `focus` to.
      this.deps.windows.raise(reserved.webContentsId);
      return { kind: 'focused', panelId: null };
    }

    // 3. The file has a document: beside its parent, wherever that lives (FR-010).
    const doc = this.deps.documents.documentFor(absPath);
    const reservation = this.token('reservation');
    if (doc && req.hasParentLocally) {
      this.reserve(key, reservation, fromWebContentsId, false);
      return { kind: 'placeLocally', reservation, besidePanelId: doc.panelId };
    }
    if (doc) {
      const recorded = Number(doc.windowId);
      const main = this.deps.windows.mainWindowId();
      const first = main ?? recorded;
      const payload: PreviewPlaceMessage = {
        requestId: this.token('place'),
        absPath,
        projectId: req.projectId,
        besidePanelId: doc.panelId,
        reservation,
      };
      this.reserve(key, reservation, first, true);
      const place: PendingPlace = {
        canon: key,
        payload,
        next: main !== null && main !== recorded && Number.isFinite(recorded) ? recorded : null,
        requester: fromWebContentsId,
        fallbackSent: false,
      };
      this.places.set(payload.requestId, place);
      if (this.deps.push.sendPlace(first, payload) || this.sendToNext(place)) return { kind: 'placedElsewhere' };
      /*
       * Every window that might hold the parent is gone, and we are still inside `open` (review M-1): nothing
       * asynchronous is left to wait for, so the requester places it from this answer — standalone, still
       * reserved for it. Parenting is derived (FR-013), so the preview follows the document all the same.
       */
      this.places.delete(payload.requestId);
      const held = this.pending.get(key);
      if (held?.token === reservation) {
        held.webContentsId = fromWebContentsId;
        held.placedElsewhere = false;
      }
      return { kind: 'placeLocally', reservation, besidePanelId: null };
    }

    // 4. No document: standalone, where a new editor would go (FR-011).
    this.reserve(key, reservation, fromWebContentsId, false);
    return { kind: 'placeLocally', reservation, besidePanelId: null };
  }

  /**
   * A window's layout did not hold the parent `place` named (FR-010): try the registry's window.
   *
   * Also reached, at once, when a `place` could not be DELIVERED — a window that has gone, such as a
   * closed sub-workspace's the registry still records (adversarial review ruling). Such a window never
   * answers, so waiting for it held the reservation for the full timeout, and every Open Preview meanwhile
   * answered `focused` with nothing to focus.
   *
   * When every window that might hold the parent has declined, the LAST resort is the window that asked: a
   * `place` beside nothing, which it places standalone (review M-1) — so Open Preview is never a silent
   * no-op. A decline of that, or an undelivered one, ends the placement and frees the path.
   */
  placeDeclined(requestId: string): void {
    const place = this.places.get(requestId);
    if (!place) return;
    const reservation = this.pending.get(place.canon);
    const stillHeld = reservation?.token === place.payload.reservation;
    if (stillHeld && this.sendToNext(place)) return;
    if (stillHeld && !place.fallbackSent) {
      place.fallbackSent = true;
      reservation.webContentsId = place.requester;
      if (this.deps.push.sendPlace(place.requester, { ...place.payload, besidePanelId: null })) return;
    }
    // Declined everywhere it could go: the placement failed, so the path is free again.
    this.places.delete(requestId);
    if (stillHeld) this.release(place.canon);
  }

  /** Send `place` to the next window that might hold the parent; `false` once none is left or reachable. */
  private sendToNext(place: PendingPlace): boolean {
    while (place.next !== null) {
      const next = place.next;
      place.next = null;
      const reservation = this.pending.get(place.canon);
      if (reservation?.token !== place.payload.reservation) return false;
      reservation.webContentsId = next;
      if (this.deps.push.sendPlace(next, place.payload)) return true;
    }
    return false;
  }

  // ── attach / detach / destroyed (§1) ──────────────────────────────────────────────────────────

  async attach(webContentsId: number, req: PreviewAttachRequest): Promise<PreviewAttachResponse> {
    const { panelId } = req;
    this.attachesInFlight.set(panelId, (this.attachesInFlight.get(panelId) ?? 0) + 1);
    try {
      // Two windows attaching one panel at once must end with one run — the second waits for the first.
      const inFlight = this.attaching.get(panelId);
      if (inFlight) await inFlight.catch(() => undefined);
      if (this.destroyedWhileAttaching.has(panelId)) return this.abandonAttach(req);

      const existing = this.runs.get(panelId);
      if (existing) return this.adopt(existing, webContentsId, req);

      const creating = this.createRun(webContentsId, req);
      this.attaching.set(panelId, creating);
      try {
        return await creating;
      } finally {
        if (this.attaching.get(panelId) === creating) this.attaching.delete(panelId);
      }
    } finally {
      // The destroyed mark outlives the attach it overtook until every attach waiting behind it has
      // also given up — otherwise the second of two racing attaches would resurrect the run.
      const left = (this.attachesInFlight.get(panelId) ?? 1) - 1;
      if (left > 0) this.attachesInFlight.set(panelId, left);
      else {
        this.attachesInFlight.delete(panelId);
        this.destroyedWhileAttaching.delete(panelId);
      }
    }
  }

  /** §1 (amended): `destroyed` won the race. No run, no broadcast, the reservation released. */
  private abandonAttach(req: PreviewAttachRequest): PreviewAttachResponse {
    this.releaseReservation(req.reservation);
    return { ok: false, reason: 'failed' };
  }

  /** A refused attach releases the reservation it carried (§1, amended). */
  private refuseAttach(
    req: PreviewAttachRequest,
    reason: 'no-provider' | 'disabled' | 'outside-project',
  ): PreviewAttachResponse {
    this.releaseReservation(req.reservation);
    return { ok: false, reason };
  }

  /** This window stops viewing the run. The run itself lives until `destroyed`. */
  detach(webContentsId: number, panelId: string): void {
    this.runs.get(panelId)?.viewers.delete(webContentsId);
  }

  /** A window is gone: it views nothing any more. */
  releaseWindow(webContentsId: number): void {
    for (const run of this.runs.values()) run.viewers.delete(webContentsId);
  }

  /**
   * The preview panel no longer exists (FR-042, FR-110). Never prompts and never touches the source
   * document: the run is an observer of it, and dropping an observer changes nothing it observed.
   */
  destroyed(panelId: string): void {
    // An attach still in flight for this panel must not finish creating what is being destroyed.
    if (this.attachesInFlight.has(panelId)) this.destroyedWhileAttaching.add(panelId);
    this.tellHistory('purge', (h) => h.purge(panelId));
    const run = this.runs.get(panelId);
    if (run) this.dropRun(run);
  }

  /** FR-063 — every run of a provider that was just turned off. */
  dropProvider(providerId: string): void {
    for (const run of [...this.runs.values()]) {
      if (run.providerId !== providerId) continue;
      this.emit(run, null, null);
      this.dropRun(run);
    }
    for (const [key, reservation] of [...this.pending]) {
      if (this.deps.registry.forPath(key)?.id === providerId && this.pending.get(key) === reservation) {
        this.release(key);
      }
    }
  }

  // ── refresh / titles / navigate ──────────────────────────────────────────────────────────────

  /** FR-028 — re-read the source now, ignoring the update delay, for every viewer. */
  async refresh(panelId: string): Promise<PreviewRefreshResponse> {
    const run = this.runs.get(panelId);
    if (!run) return { update: null };
    if (run.source.kind === 'document') {
      run.scheduler?.cancel();
      const current = this.deps.documents.getContent(run.source.documentPanelId);
      // Still unable to read its file: Refresh asks the disk again and FLASHES the notice (FR-026, FR-028).
      if (current?.contentless === true) {
        return { update: (await this.showUnloadable(run, { repeat: true })) ?? this.snapshot(run) };
      }
      run.documentContentless = false;
      if (current) run.lastSent = { kind: 'text', text: current.text };
      run.notice = this.providerNotice(run);
      return { update: this.emit(run, run.lastSent) };
    }
    const update = await this.readAndApply(run, { force: true, repeat: true });
    return { update: update ?? this.snapshot(run) };
  }

  /** FR-031 — an editor's display title, forwarded to every preview parented to it. */
  publishEditorTitle(editorPanelId: string, title: string): void {
    if (this.editorTitles.get(editorPanelId) === title) return;
    this.editorTitles.set(editorPanelId, title);
    for (const run of this.parentedTo(editorPanelId)) this.emit(run, null);
  }

  /**
   * FR-090 / FR-106 — a preview moves to another file.
   *
   * The LINK intent (FR-090a – FR-090e) is decided here in this order, and every refusal leaves the run
   * exactly where it was:
   *
   * 1. Inside the project, by spelling and then by real path (Principle I) — else `link-outside`. The
   *    renderer already classified the link; main never takes a renderer's word for containment.
   * 2. An existing FILE — else `link-missing-file`. Only `stat` and `realpath` touch the disk: following
   *    a link never creates a file.
   * 3. An enabled provider — else `openedInEditor`, which the renderer carries out through Files &
   *    Folders' open path (FR-090d).
   * 4. Another run already shows it — `focusedOther`: that preview's window is raised and sent `focus`
   *    with the link's fragment; this run is untouched (FR-090c, FR-012).
   * 5. Otherwise the target is READ first (a document's text, or the disk), and only then — unless the
   *    file vanished meanwhile (`link-missing-file`) or a later navigate overtook this one — `shown`:
   *    the leaving view state goes on the entry being left, the run is rebound in place
   *    — `byPath`, `openChanged`, `pathChanged` — and its source RE-DERIVED for the target (FR-090a): the
   *    target's document if an editor holds one, else the disk, read without opening a document (FR-025).
   *    The update goes to every viewer; the invoking window takes the same one from the response.
   *
   * The fragment is passed back untouched. Main does not parse headings: a fragment naming none is still
   * `shown`, and the renderer — which has the rendered target — raises `link-missing-heading` (FR-090e).
   *
   * The HISTORY intent is {@link navigateHistory}; the HEADING intent is {@link navigateHeading}, decided
   * before the "already shown" short-circuit below, which would otherwise swallow it.
   */
  async navigate(_fromWebContentsId: number, req: PreviewNavigateRequest): Promise<PreviewNavigateResponse> {
    const target = req.target.absPath;
    if (req.intent.kind === 'heading') return this.navigateHeading(req);
    if (req.intent.kind === 'history') return this.navigateHistory(req, req.intent.index);
    const missing: PreviewNavigateResponse = { kind: 'refused', notice: { kind: 'link-missing-file', target } };
    const outside: PreviewNavigateResponse = { kind: 'refused', notice: { kind: 'link-outside', target } };
    const fragment = req.target.fragment;
    const withFragment = <T extends object>(value: T): T & { fragment?: string } =>
      fragment !== undefined ? { ...value, fragment } : value;

    const run = this.runs.get(req.panelId);
    if (!run) return missing;
    // 1–2. Containment by spelling, existence, containment by real path.
    if (!isUnderPath(target, run.projectRoot)) return outside;
    if (!(await this.isFile(target))) return missing;
    const real = await this.realContainment(target, run.projectRoot);
    if (real === null) return missing;
    if (!real) return outside;
    if (this.runs.get(req.panelId) !== run) return missing; // destroyed while the disk was asked

    // A link to the file this run already shows moves nothing: the renderer scrolls to the fragment.
    if (canon(target) === canon(run.filePath)) return withFragment({ kind: 'shown' as const, update: this.snapshot(run) });

    // 3. No enabled provider: an editor, as from File Explorer.
    const provider = enabledProviderFor(this.deps.registry, this.previewSettings(), target);
    if (!provider) return { kind: 'openedInEditor' };

    // 4. One preview per file (FR-012): focus the one that exists.
    const other = this.runForPath(canon(target));
    if (other && other !== run) return this.focusOtherPreview(other, fragment);

    // 5. In place — but READ FIRST, and change nothing until the read has answered (fix round 1).
    //
    // The target's content is fetched before the run is touched, so a failed read can never leave the
    // previous document on screen under the target's path (content `null` means "unchanged"). What the
    // answer means:
    //  - a document holds the target → its text (the source becomes that document, FR-090a);
    //  - the disk reads → that content;
    //  - the file vanished between `stat` and the read → it does not exist: `link-missing-file`, and the
    //    preview stays where it is (FR-090e);
    //  - too large, not text, unreadable → the target IS shown (FR-090a binds the preview to it) with its
    //    content explicitly CLEARED and FR-026's one notice saying what is wrong.
    const token = ++run.navigateSeq;
    const doc = provider.kind === 'text' ? this.deps.documents.documentFor(target) : null;
    const docContent = doc ? this.deps.documents.getContent(doc.panelId) : null;
    const read: DiskRead = doc && docContent
      ? await this.documentRead(run, target, provider.id, docContent, false)
      : await this.readPath(run, target, provider.id);
    if (this.runs.get(run.panelId) !== run) return missing;
    // A later navigate of this run started while this one read: that one decides. Hand back the run as it
    // stands, at a revision the renderer has already seen or is about to, so nothing is applied over it.
    if (run.navigateSeq !== token) return { kind: 'shown', update: this.snapshot(run) };
    if (!read.ok && read.notice.kind === 'deleted') return missing;
    // Another preview may have opened the target while this one read (FR-012).
    const raced = this.runForPath(canon(target));
    if (raced && raced !== run) return this.focusOtherPreview(raced, fragment);

    if (req.leavingViewState !== undefined) {
      const leaving = req.leavingViewState;
      this.tellHistory('setCurrentViewState', (h) => h.setCurrentViewState(run.panelId, leaving));
    }
    this.moveRun(run, target, doc && docContent ? { panelId: doc.panelId, content: docContent } : null, read);
    this.tellHistory('recordOpen', (h) => h.recordOpen(run.panelId, target));
    return withFragment({ kind: 'shown' as const, update: this.emit(run, run.lastSent) });
  }

  /**
   * FR-115 — the renderer found a heading in the file this run shows and scrolled to it
   * (contracts/preview-ipc.md §1, `intent: 'heading'`). Only a place changed, so there is nothing to read and
   * nothing to emit: the target being the run's current file records a jump, and every window follows the
   * history through `throng:history:changed`. A target that is not — a link overtaken by another navigation —
   * records nothing. Either way the answer is the run's UNCHANGED snapshot, at a revision the renderer has
   * applied, so it drops it and the reader stays where the jump put them.
   *
   * It is judged against the run as it stands, not against whether a navigate is in flight: a heading that
   * arrives while a link of this run is still reading was found in the file still shown, and is recorded.
   */
  private navigateHeading(req: PreviewNavigateRequest): PreviewNavigateResponse {
    const run = this.runs.get(req.panelId);
    if (!run) return { kind: 'refused', notice: { kind: 'link-missing-file', target: req.target.absPath } };
    if (samePath(req.target.absPath, run.filePath)) {
      const { leavingViewState: leaving, arrivingViewState: arriving } = req;
      this.tellHistory('recordJump', (h) => h.recordJump(run.panelId, leaving, arriving));
    }
    return { kind: 'shown', update: this.snapshot(run) };
  }

  /**
   * FR-102, FR-106, FR-107 — Back or Forward in a preview: `navigate` with a HISTORY intent.
   *
   * The same path a link takes, with the same outcomes, except that it never changes the list:
   *
   * 1. `leavingViewState` goes on the CURRENT entry first, whatever follows: it describes where the
   *    reader is, which stays true of a stale request and of a refusal (FR-107, US7 scenario 3).
   * 2. The request must name what entry `index` names now — the renderer chose it from its mirror, and a
   *    history that changed since means another step. A stale request moves nothing and hands back the
   *    run's unchanged snapshot, at a revision the renderer has applied, like an overtaken link.
   *    An entry naming the run's CURRENT file (a heading jump's place, FR-115) moves the position and sends
   *    the place, and nothing else.
   * 3. Refused — the position does not move, one `history-refused` notice names the file (FR-106c): a
   *    target outside the project, one no enabled provider claims, one that is not a file, and one the
   *    read refuses (too large, not text).
   * 4. Another preview already shows it — `focusedOther`, no move (FR-106b). A file merely open in an
   *    EDITOR is no obstacle: the preview shows it, parented.
   * 5. A MISSING or UNREADABLE file moves (FR-106d, amended 2026-09-15): shown, content cleared, FR-026's
   *    `deleted` or `unreadable` notice — so the user can keep stepping past it, as in an editor.
   * 6. Otherwise the target is read first and only then does the run move: `moveTo`, rebind, and one
   *    update to every viewer carrying the TARGET entry's view state.
   *
   * Both moving branches (the same-file one in 2, and 6) send the target's place or `null` — never omit it
   * (FR-121e, {@link stepPlace}).
   */
  private async navigateHistory(req: PreviewNavigateRequest, index: number): Promise<PreviewNavigateResponse> {
    const target = req.target.absPath;
    const refused = (reason: string): PreviewNavigateResponse => ({
      kind: 'refused',
      notice: { kind: 'history-refused', target, reason },
    });
    const run = this.runs.get(req.panelId);
    if (!run || !this.deps.history) return refused('unavailable');

    if (req.leavingViewState !== undefined) {
      const leaving = req.leavingViewState;
      this.tellHistory('setCurrentViewState', (h) => h.setCurrentViewState(run.panelId, leaving));
    }

    // Stale (contracts/preview-ipc.md §1 `navigate`, amended): the run's UNCHANGED snapshot, at a revision
    // the renderer has already applied, so its revision check drops it.
    const entry = this.historyOf(run.panelId)?.entries[index];
    if (entry === undefined || !samePath(entry.filePath, target)) return { kind: 'shown', update: this.snapshot(run) };

    // FR-115 — a step between two places in the file this run already shows (a jump chain) changes only the
    // place: no re-read, no rebind, no pathChanged. One update to every viewer carries the entry's place, with
    // content `null` ("unchanged").
    if (samePath(target, run.filePath)) {
      if (this.tellHistory('moveTo', (h) => h.moveTo(run.panelId, index, target)) !== true) {
        return { kind: 'shown', update: this.snapshot(run) };
      }
      return { kind: 'shown', update: this.emit(run, null, run.notice, this.stepPlace(run.panelId)) };
    }

    if (!isUnderPath(target, run.projectRoot)) return refused('outside-project');
    const provider = enabledProviderFor(this.deps.registry, this.previewSettings(), target);
    if (!provider) return refused('no-provider');

    let missing = !(await this.isFile(target));
    if (missing && (await this.deps.fs.exists(target).catch(() => false))) return refused('not-a-file');
    if (!missing) {
      const real = await this.realContainment(target, run.projectRoot);
      if (real === false) return refused('outside-project');
      missing = real === null; // `stat` said a file and `realpath` could not find it: gone meanwhile
    }
    if (this.runs.get(run.panelId) !== run) return refused('unavailable');

    const other = this.runForPath(canon(target));
    if (other && other !== run) return this.focusOtherPreview(other, undefined);

    const token = ++run.navigateSeq;
    // A document for the target makes the run parented even when the file is gone (FR-013): the FR-106d
    // stand-in of another editor, say. Its readability decides what is shown — see `documentRead`.
    const doc = provider.kind === 'text' ? this.deps.documents.documentFor(target) : null;
    const docContent = doc ? this.deps.documents.getContent(doc.panelId) : null;
    const read: DiskRead =
      doc && docContent
        ? await this.documentRead(run, target, provider.id, docContent, missing)
        : missing
          ? { ok: false, notice: { kind: 'deleted' } }
          : await this.readPath(run, target, provider.id);
    if (this.runs.get(run.panelId) !== run) return refused('unavailable');
    if (run.navigateSeq !== token) return { kind: 'shown', update: this.snapshot(run) };
    // FR-106c refuses what the read REFUSES; FR-106d (amended) moves onto a file that is gone OR cannot be
    // read, showing FR-026's could-not-read notice — the same as an editor's banner does.
    if (!read.ok && read.notice.kind !== 'deleted' && read.notice.kind !== 'unreadable') {
      return refused(read.notice.kind);
    }
    const raced = this.runForPath(canon(target));
    if (raced && raced !== run) return this.focusOtherPreview(raced, undefined);

    // The history may have changed during the read: move only if the entry still names the target.
    if (this.tellHistory('moveTo', (h) => h.moveTo(run.panelId, index, target)) !== true) {
      return { kind: 'shown', update: this.snapshot(run) };
    }
    this.moveRun(run, target, doc && docContent ? { panelId: doc.panelId, content: docContent } : null, read);
    return { kind: 'shown', update: this.emit(run, run.lastSent, run.notice, this.stepPlace(run.panelId)) };
  }

  /**
   * Point a run at `target` in place, from a read that has already answered (FR-090a, FR-102): the
   * source is re-derived — the target's document when an editor holds one, else the disk, watched without
   * opening a document (FR-025) — and a failed read CLEARS the content under FR-026's one notice, never
   * leaving the previous file's document on screen under the new path.
   */
  private moveRun(
    run: PreviewRun,
    target: string,
    doc: { panelId: string; content: PreviewDocumentContent } | null,
    read: DiskRead,
  ): void {
    run.scheduler?.cancel();
    run.scheduler = null;
    run.timing = null;
    if (run.source.kind === 'disk') run.source.watch.dispose();
    run.readSeq += 1;
    run.movePending = false;
    run.notice = null;
    // 044 T177 — this is a NAVIGATION, the one thing that is not an update: the renderer shows the target
    // from its top (FR-024), where a re-point through `rebind` alone keeps the reader's place.
    run.navigationSeq += 1;
    this.rebind(run, target, { rewriteHistory: false });

    if (doc) {
      run.source = { kind: 'document', documentPanelId: doc.panelId };
      run.dirty = doc.content.dirty;
    } else {
      run.dirty = false;
      this.watchDisk(run);
    }
    // A document that cannot read the target is the only way a document-sourced read fails (`documentRead`).
    run.documentContentless = doc !== null && !read.ok;
    if (read.ok) {
      run.lastSent = read.content;
    } else {
      run.lastSent = CLEARED_CONTENT;
      run.notice = read.notice;
    }
  }

  /**
   * What a navigate onto `target` shows when a DOCUMENT holds it (FR-013, FR-090a): the document's text,
   * even when the file itself is gone — a document with content is followed, never the disk (FR-022, fix
   * round 1 ruling). Only a document with NO content to follow (`contentless`) shows FR-026's notice, saying
   * why exactly as a standalone read of that file would (adversarial review, main item 1).
   */
  private async documentRead(
    run: PreviewRun,
    target: string,
    providerId: string,
    content: PreviewDocumentContent,
    missing: boolean,
  ): Promise<DiskRead> {
    if (content.contentless !== true) return { ok: true, content: { kind: 'text', text: content.text } };
    if (missing) return { ok: false, notice: { kind: 'deleted' } };
    return { ok: false, notice: await this.unloadableNotice(run, target, providerId) };
  }

  /**
   * FR-026's notice for a file its DOCUMENT could not read. The document knows only that it could not;
   * the disk says why — gone, too large, not text, or unreadable — through the same read a standalone
   * preview uses (FR-025: nothing is opened). A file that reads fine by the time it is asked is still
   * `unreadable` to this run: the document has not adopted it yet, and the coordinator's `changed` when it
   * does is what clears the notice.
   */
  private async unloadableNotice(run: PreviewRun, path: string, providerId: string): Promise<PreviewNotice> {
    const read = await this.readPath(run, path, providerId);
    return read.ok ? { kind: 'unreadable' } : read.notice;
  }

  /**
   * Show, on a parented run, that its document cannot read its file (FR-026) — at once, not on the settle
   * schedule. `repeat` flashes an unchanged notice (Refresh). Returns the update sent, or `null` when the
   * run moved on during the read (another source, another file, or a later read or flip).
   */
  private async showUnloadable(run: PreviewRun, opts: { repeat: boolean }): Promise<PreviewUpdate | null> {
    if (run.source.kind !== 'document') return null;
    const documentPanelId = run.source.documentPanelId;
    const path = run.filePath;
    run.documentContentless = true;
    const seq = ++run.readSeq;
    const notice = await this.unloadableNotice(run, path, run.providerId);
    if (this.runs.get(run.panelId) !== run || seq !== run.readSeq || run.filePath !== path) return null;
    if (run.source.kind !== 'document' || run.source.documentPanelId !== documentPanelId) return null;
    const current = this.deps.documents.getContent(documentPanelId);
    if (!current) return null;
    if (current.contentless !== true) return this.showReadableDocument(run, current);
    run.lastSent = { kind: 'text', text: current.text };
    run.dirty = current.dirty;
    const flash = opts.repeat && run.notice?.kind === notice.kind;
    run.notice = notice;
    return this.emit(run, run.lastSent, flash ? { ...notice, repeat: true } : notice);
  }

  /** A parented run's document reads its file (again): its text, and only FR-027's notice if any. */
  private showReadableDocument(run: PreviewRun, current: PreviewDocumentContent): PreviewUpdate {
    run.readSeq += 1; // any classification still in flight describes a document that is gone
    run.documentContentless = false;
    run.lastSent = { kind: 'text', text: current.text };
    run.dirty = current.dirty;
    run.notice = this.providerNotice(run);
    return this.emit(run, run.lastSent);
  }

  /**
   * FR-090c, FR-012 — a link's target already has a preview: raise the window viewing it (or the one that
   * viewed it last) and ask it to focus that preview, at the link's heading when it names one.
   */
  private focusOtherPreview(other: PreviewRun, fragment: string | undefined): PreviewNavigateResponse {
    const viewer = other.viewers.size > 0 ? [...other.viewers][0]! : other.lastViewer;
    this.deps.windows.raise(viewer);
    this.deps.push.sendFocus(viewer, fragment !== undefined ? { panelId: other.panelId, fragment } : { panelId: other.panelId });
    return { kind: 'focusedOther', panelId: other.panelId };
  }

  // ── In-app moves (FR-013c, standalone sentence; FilesService's bracket) ────────────────────────

  /** throng is about to move these paths: a standalone watch must not read the absence as a delete. */
  beginMove(absPaths: readonly string[]): void {
    for (const run of this.runs.values()) {
      if (run.source.kind === 'disk' && absPaths.some((p) => isUnderPath(run.filePath, p))) {
        run.movePending = true;
      }
    }
  }

  /**
   * The moves that actually happened. Closes the bracket on every run and rebinds each STANDALONE run
   * whose file moved. A parented run has already followed its document through `repointed`, which
   * `EditorCoordinator.markMoved` fires before this is called.
   *
   * A move ONTO a path another run already shows does not rebind (FR-012, the Save As ruling of §3): the
   * moved run stays standalone on its old path — where its file no longer is, so it re-reads and says so
   * (FR-026) — and the run at the destination shows the file that arrived, through its own watch. Rebinding
   * it there made two previews of one file, `claimPath` keeping the holder and letting the second in beside
   * it (adversarial review, main item 3). The same holds for a parented run `repointed` sent back to its old
   * path because its document moved onto a previewed file: by now it is standalone on that path.
   *
   * Returns the panels held back, so main keeps their HISTORY and every window's `config.filePath` on the old
   * path too (`in-app-moves.ts`; review of batch B, I-1) — the run is only one of three records a relaunch
   * reads.
   */
  moved(moves: readonly MovePair[]): string[] {
    const heldBack: string[] = [];
    // Where every run stood BEFORE this batch: a destination held by a run that was already there is a
    // collision; one held by a run that moved there a moment ago in this same loop is this very file
    // (two runs of one file, restored in a sub-workspace, say) and follows it.
    const before = new Map([...this.runs.values()].map((r) => [r.panelId, canon(r.filePath)] as const));
    for (const run of [...this.runs.values()]) {
      run.movePending = false;
      if (run.source.kind !== 'disk') continue;
      const next = movedPathOf(run.filePath, moves);
      if (next === null) continue;
      const holder = this.runForPath(canon(next));
      if (holder && holder !== run && before.get(holder.panelId) === canon(next)) {
        heldBack.push(run.panelId);
        void this.readAndApply(run, { force: true, repeat: false });
        continue;
      }
      this.rebind(run, next, { rewriteHistory: false });
      this.watchDisk(run);
      void this.readAndApply(run, { force: true, repeat: false });
    }
    return heldBack;
  }

  /** Broadcast `pathChanged` with the file the run shows now — to put back a window's `config.filePath` (I-1). */
  announcePath(panelId: string): void {
    const run = this.runs.get(panelId);
    if (run) this.deps.push.broadcastPathChanged({ panelId, filePath: run.filePath });
  }

  // ── DocumentLifecycleListener (contracts/preview-ipc.md §3) ───────────────────────────────────

  /**
   * FR-013a — a document now exists for `absPath`: EVERY standalone run on that path becomes parented,
   * not only the `byPath` holder (u7 fix round 2). Two runs can share a path (`claimPath`/`leavePath`,
   * fix round 1 item 1) before either has a document — restored sub-workspaces, most often — and a
   * non-holder that stayed disk-sourced would still show as standalone once handover in `leavePath`
   * passed the key to it, because a handover never re-checked the registry. Parenting every match here
   * removes that gap at the source: by the time any handover of THIS path can happen, no disk run
   * remains on it while a document does, so `leavePath` needs no parenting step of its own.
   */
  registered(absPath: string, documentPanelId: string): void {
    const key = canon(absPath);
    for (const run of this.runs.values()) {
      if (run.source.kind === 'disk' && canon(run.filePath) === key) this.makeParented(run, documentPanelId);
    }
  }

  unregistered(_absPath: string, documentPanelId: string): void {
    for (const run of this.parentedTo(documentPanelId)) this.makeStandalone(run);
    // The editor's published title goes with the editor. Only when the panel holds no document at all:
    // a `load` re-pointing the same panel fires `unregistered` with the new document already in place,
    // and the title that panel just published for its new file must survive that.
    if (this.deps.documents.getContent(documentPanelId) === null) this.editorTitles.delete(documentPanelId);
  }

  repointed(from: string, to: string, documentPanelId: string): void {
    const following = this.parentedTo(documentPanelId);
    const atTarget = this.runForPath(canon(to));
    if (atTarget && !following.includes(atTarget)) {
      /*
       * A Save As onto a file a STANDALONE preview already shows (§3, amended 2026-09-15). A document
       * now exists for `to`, so that run becomes parented in place (FR-013a). The run that was following
       * the document does NOT re-key onto `to`, which would make two previews of one file (FR-012);
       * it stays on `from` — which a Save As leaves on disk — and falls back to standalone (FR-013b).
       * No channel closes a renderer's panel, so the one-run-per-path rule is kept by not moving it.
       */
      if (atTarget.source.kind === 'disk') this.makeParented(atTarget, documentPanelId);
      for (const run of following) this.makeStandalone(run);
      return;
    }
    for (const run of following) {
      if (canon(run.filePath) !== canon(from) && canon(run.filePath) !== canon(to)) continue;
      this.rebind(run, to, { rewriteHistory: true });
      this.emit(run, null);
    }
  }

  /**
   * The document's text changed, or it gained or lost content to follow (`contentless`, §3 amended). That
   * flip is shown AT ONCE — the notice appears or clears, FR-026 — and anything else waits for the settle
   * schedule (R13).
   */
  changed(documentPanelId: string): void {
    for (const run of this.parentedTo(documentPanelId)) {
      const current = this.deps.documents.getContent(documentPanelId);
      const contentless = current?.contentless === true;
      if (current && contentless !== run.documentContentless) {
        if (contentless) void this.showUnloadable(run, { repeat: false });
        else this.showReadableDocument(run, current);
        continue;
      }
      this.scheduleChange(run);
    }
  }

  dirtyChanged(documentPanelId: string, dirty: boolean): void {
    for (const run of this.parentedTo(documentPanelId)) {
      if (run.dirty === dirty) continue;
      run.dirty = dirty;
      this.emit(run, null);
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────────────────────────

  private previewSettings() {
    return this.deps.settings().editor.previews;
  }

  private token(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private runForPath(key: string): PreviewRun | undefined {
    const id = this.byPath.get(key);
    return id === undefined ? undefined : this.runs.get(id);
  }

  private parentedTo(documentPanelId: string): PreviewRun[] {
    return [...this.runs.values()].filter(
      (r) => r.source.kind === 'document' && r.source.documentPanelId === documentPanelId,
    );
  }

  private async isFile(absPath: string): Promise<boolean> {
    try {
      return (await this.deps.fs.stat(absPath)).kind === 'file';
    } catch {
      return false;
    }
  }

  /** Containment over REAL paths: `true`/`false`, or `null` when either could not be resolved. */
  private async realContainment(absPath: string, root: string): Promise<boolean | null> {
    try {
      const [realFile, realRoot] = await Promise.all([this.deps.fs.realpath(absPath), this.deps.fs.realpath(root)]);
      return isUnderPath(realFile, realRoot);
    } catch {
      return null;
    }
  }

  private reserve(key: string, token: string, webContentsId: number, placedElsewhere: boolean): void {
    const timer = this.clock.setTimeout(() => {
      if (this.pending.get(key)?.token === token) this.release(key);
    }, OPEN_RESERVATION_TIMEOUT_MS);
    this.pending.set(key, { token, webContentsId, placedElsewhere, timer });
  }

  private release(key: string): void {
    const reservation = this.pending.get(key);
    if (!reservation) return;
    this.clock.clearTimeout(reservation.timer);
    this.pending.delete(key);
    for (const [id, place] of [...this.places]) {
      if (place.payload.reservation === reservation.token) this.places.delete(id);
    }
  }

  /** Release whichever reservation carries `token`, and say whether it was placed elsewhere. */
  private releaseReservation(token: string | undefined): Reservation | undefined {
    if (token === undefined) return undefined;
    for (const [key, reservation] of this.pending) {
      if (reservation.token !== token) continue;
      this.release(key);
      return reservation;
    }
    return undefined;
  }

  /** An `attach` naming a reservation consumes it; one that was placed elsewhere focuses its window. */
  private consume(token: string | undefined, webContentsId: number): void {
    if (this.releaseReservation(token)?.placedElsewhere) this.deps.windows.raise(webContentsId);
  }

  private adopt(run: PreviewRun, webContentsId: number, req: PreviewAttachRequest): PreviewAttachResponse {
    // Principle I: a window may name any panel id, so the PROJECT is what decides whether it may view
    // this run. A request from another project is refused rather than handed the run's content.
    if (req.projectId !== run.projectId) return this.refuseAttach(req, 'outside-project');
    // Adopt-if-absent: the persisted filePath and history lose to the run (FR-022, FR-110).
    run.viewers.add(webContentsId);
    run.lastViewer = webContentsId;
    this.consume(req.reservation, webContentsId);
    this.tellHistory('attach', (h) => h.attach(run.panelId, 'preview', req.history));
    return { ok: true, update: this.snapshot(run, this.currentViewState(run.panelId)) };
  }

  /**
   * The file a run with no state in main opens on (§1, *Which persisted field wins on restore*): the
   * current entry of the panel's history — main's record if it still holds one, else the persisted copy
   * — and `filePath` only when there is no history. `previewPathOf` is the one reader of that precedence,
   * shared with the FR-067 restore filter and the FR-063 purge, so the three cannot disagree.
   */
  private openingPath(req: PreviewAttachRequest): string {
    const held = this.historyOf(req.panelId);
    const current = held?.entries[held.index];
    if (current !== undefined) return current.filePath;
    return previewPathOf({ filePath: req.filePath, history: req.history }) ?? req.filePath;
  }

  private async createRun(webContentsId: number, req: PreviewAttachRequest): Promise<PreviewAttachResponse> {
    const { panelId } = req;
    const filePath = this.openingPath(req);
    /** `destroyed` arrived during an await: stop, creating and announcing nothing (§1, amended). */
    const overtaken = (): boolean => this.destroyedWhileAttaching.has(panelId);
    const provider = this.deps.registry.forPath(filePath);
    if (!provider) return this.refuseAttach(req, 'no-provider');
    if (!enabledProviderFor(this.deps.registry, this.previewSettings(), filePath)) {
      return this.refuseAttach(req, 'disabled');
    }
    const root = await this.deps.projectRoot(req.projectId);
    if (overtaken()) return this.abandonAttach(req);
    if (root === undefined || !isUnderPath(filePath, root)) return this.refuseAttach(req, 'outside-project');
    // A missing file still attaches — with the `deleted` notice (FR-026) — so only a file that
    // resolves OUTSIDE the project is refused here.
    const contained = await this.realContainment(filePath, root);
    if (overtaken()) return this.abandonAttach(req);
    if (contained === false) return this.refuseAttach(req, 'outside-project');

    // Another window may have created it while this one was checking.
    const raced = this.runs.get(panelId);
    if (raced) return this.adopt(raced, webContentsId, req);

    const key = canon(filePath);
    const run: PreviewRun = {
      panelId: req.panelId,
      projectId: req.projectId,
      projectRoot: root,
      filePath,
      providerId: provider.id,
      source: { kind: 'disk', watch: { dispose: () => {} } },
      revision: 1,
      lastSent: null,
      dirty: false,
      notice: null,
      scheduler: null,
      timing: null,
      viewers: new Set([webContentsId]),
      lastViewer: webContentsId,
      movePending: false,
      readSeq: 0,
      navigateSeq: 0,
      navigationSeq: 0,
      documentContentless: false,
    };
    this.runs.set(run.panelId, run);
    // Claimed, and announced, before the read: from here on a concurrent `open` must see this run, and a
    // `destroyed` during the read then announces the path closed AFTER it was announced open.
    this.claimPath(key, run);
    this.consume(req.reservation, webContentsId);
    // One attach per panel: the preview's history record is adopted here, never by the renderer. A brand
    // new preview's file is its first entry (FR-103b); a restored one's is already current, so this adds
    // nothing.
    this.tellHistory('attach', (h) => h.attach(panelId, 'preview', req.history));
    this.tellHistory('recordOpen', (h) => h.recordOpen(panelId, filePath));
    // The history won over a stale `config.filePath`: say so, so every window's mirror heals it (FR-066).
    if (!samePath(filePath, req.filePath)) this.deps.push.broadcastPathChanged({ panelId, filePath });

    const doc = provider.kind === 'text' ? this.deps.documents.documentFor(filePath) : null;
    if (doc) {
      run.source = { kind: 'document', documentPanelId: doc.panelId };
      const current = this.deps.documents.getContent(doc.panelId);
      run.dirty = current?.dirty ?? false;
      run.lastSent = current ? { kind: 'text', text: current.text } : null;
      if (current?.contentless === true) {
        // Parented to a document that could not read this file: FR-026's notice, never its empty text.
        run.documentContentless = true;
        const seq = ++run.readSeq;
        const notice = await this.unloadableNotice(run, filePath, provider.id);
        if (this.runs.get(panelId) !== run || overtaken()) return this.abandonAttach(req);
        // A `changed` during the read already applied what the document is now; it bumped `readSeq`.
        if (seq === run.readSeq) run.notice = notice;
      }
    } else {
      this.watchDisk(run);
      const seq = ++run.readSeq;
      const read = await this.readDisk(run);
      // The run was dropped during the read: it is gone, and the attach answers as refused.
      if (this.runs.get(panelId) !== run || overtaken()) return this.abandonAttach(req);
      if (run.source.kind === 'disk' && seq === run.readSeq) {
        if (read.ok) run.lastSent = read.content;
        else run.notice = read.notice;
      }
    }
    return { ok: true, update: this.snapshot(run, this.currentViewState(panelId)) };
  }

  /** A run arrives on `key`: it holds the path unless another run already does, and a new hold is news. */
  private claimPath(key: string, run: PreviewRun): void {
    if (this.byPath.has(key)) return;
    this.byPath.set(key, run.panelId);
    this.deps.push.broadcastOpenChanged({ path: key, open: true });
  }

  /**
   * A run leaves `key` (dropped, or rebound elsewhere). If it held the path and another run still shows
   * that file — a second preview of it restored in a sub-workspace, or a spelling that differs only in
   * case — the path passes to that run and stays open (FR-012, FR-033). `open: false` only when none
   * remains.
   */
  private leavePath(key: string, run: PreviewRun): void {
    if (this.byPath.get(key) !== run.panelId) return;
    const heir = [...this.runs.values()].find((r) => r !== run && canon(r.filePath) === key);
    if (heir) {
      this.byPath.set(key, heir.panelId);
      return;
    }
    this.byPath.delete(key);
    this.deps.push.broadcastOpenChanged({ path: key, open: false });
  }

  private dropRun(run: PreviewRun): void {
    run.scheduler?.cancel();
    if (run.source.kind === 'disk') run.source.watch.dispose();
    run.readSeq += 1;
    this.runs.delete(run.panelId);
    const key = canon(run.filePath);
    this.release(key);
    this.leavePath(key, run);
  }

  private parentOf(run: PreviewRun): PreviewUpdate['parent'] {
    if (run.source.kind !== 'document') return null;
    const id = run.source.documentPanelId;
    return { panelId: id, title: this.editorTitles.get(id) ?? editorAutoTitle(run.filePath) };
  }

  /**
   * `viewState` is set only where the body must restore a position — an attach, and a history navigate —
   * and is otherwise ABSENT, not `undefined`-valued, so an ordinary update keeps the reader where they are
   * (FR-024, FR-107). A `null` is kept: it is how a history step says "no saved place" (FR-121e).
   */
  private updateOf(
    run: PreviewRun,
    content: PreviewContent | null,
    notice = run.notice,
    viewState?: unknown,
  ): PreviewUpdate {
    const update: PreviewUpdate = {
      panelId: run.panelId,
      revision: run.revision,
      filePath: run.filePath,
      providerId: run.providerId,
      content,
      dirty: run.source.kind === 'document' ? run.dirty : false,
      parent: this.parentOf(run),
      notice,
      // 044 T177 — on EVERY update, so a renderer that misses one still learns the count from the next.
      navigationSeq: run.navigationSeq,
    };
    if (viewState !== undefined) update.viewState = viewState;
    return update;
  }

  /** The run's whole current state, at its current revision — what an attaching window is handed. */
  private snapshot(run: PreviewRun, viewState?: unknown): PreviewUpdate {
    return this.updateOf(run, run.lastSent, run.notice, viewState);
  }

  /** A new revision, to every viewer. */
  private emit(run: PreviewRun, content: PreviewContent | null, notice = run.notice, viewState?: unknown): PreviewUpdate {
    run.revision += 1;
    const update = this.updateOf(run, content, notice, viewState);
    for (const viewer of run.viewers) this.deps.push.update(viewer, update);
    return update;
  }

  // ── Navigation history (US7) ──────────────────────────────────────────────────────────────────

  /**
   * Call the history, isolated: a throw is logged and dropped. History is recorded ABOUT an attach, a
   * navigate, a destroy or a re-point; letting it abort one half-way would leave a run rebound with no
   * update sent, or a destroyed panel's run still alive.
   */
  private tellHistory<T>(what: keyof PreviewHistoryHooks, call: (history: PreviewHistoryHooks) => T): T | undefined {
    const history = this.deps.history;
    if (!history) return undefined;
    try {
      return call(history);
    } catch (err) {
      console.error(`[preview-service] navigation history threw on ${what}:`, err);
      return undefined;
    }
  }

  private historyOf(panelId: string): NavigationHistory | undefined {
    return this.tellHistory('get', (h) => h.get(panelId));
  }

  /** The current entry's view state — what an attach or a history navigate restores (FR-107). */
  private currentViewState(panelId: string): unknown {
    const history = this.historyOf(panelId);
    return history?.entries[history.index]?.viewState;
  }

  /**
   * 044 FR-121e (contracts/preview-ipc.md §2, research R32) — the place a HISTORY STEP sends: the entry's,
   * or `null` when it has none. Never absent, so every viewer — including one that learns of the step only
   * as a push — can tell a step onto the top of a document from a followed link, which carries no key.
   */
  private stepPlace(panelId: string): unknown {
    return this.currentViewState(panelId) ?? null;
  }

  /** FR-027 — the notice a run carries while no ENABLED provider claims its current file. */
  private providerNotice(run: PreviewRun): PreviewNotice | null {
    return enabledProviderFor(this.deps.registry, this.previewSettings(), run.filePath)
      ? null
      : { kind: 'no-provider' };
  }

  /**
   * A content change the preview has not shown (R13). The scheduler is rebuilt between bursts when
   * the delay or max wait setting changed, so a settings change applies to the next scheduled flush
   * without disturbing a burst already in progress.
   */
  private scheduleChange(run: PreviewRun): void {
    const settings = this.previewSettings();
    const timing = { delayMs: settings.updateDelayMs, maxWaitMs: effectiveMaxWaitMs(settings) };
    const stale =
      run.timing === null || run.timing.delayMs !== timing.delayMs || run.timing.maxWaitMs !== timing.maxWaitMs;
    if (run.scheduler === null || (stale && !run.scheduler.pending)) {
      run.scheduler?.cancel();
      run.scheduler = createSettleScheduler({
        ...timing,
        clock: this.clock,
        onSettle: () => this.settleDocument(run),
      });
      run.timing = timing;
    }
    run.scheduler.change();
  }

  /** The scheduler fired: read the document's text NOW — nothing holds a copy between flushes. */
  private settleDocument(run: PreviewRun): void {
    if (this.runs.get(run.panelId) !== run || run.source.kind !== 'document') return;
    const current = this.deps.documents.getContent(run.source.documentPanelId);
    if (!current) return;
    if (run.lastSent?.kind === 'text' && run.lastSent.text === current.text) return;
    run.lastSent = { kind: 'text', text: current.text };
    this.emit(run, run.lastSent);
  }

  /** FR-013a — a document now exists for the run's file: follow it, in place. */
  private makeParented(run: PreviewRun, documentPanelId: string): void {
    if (this.deps.registry.get(run.providerId)?.kind === 'binary') return; // FR-073: always standalone
    if (run.source.kind === 'disk') run.source.watch.dispose();
    run.readSeq += 1;
    run.movePending = false;
    run.source = { kind: 'document', documentPanelId };
    // `registered` carries no dirtyChanged: the initial state is read, not assumed (§3).
    const current = this.deps.documents.getContent(documentPanelId);
    run.dirty = current?.dirty ?? false;
    if (current) run.lastSent = { kind: 'text', text: current.text };
    // A document that could not read the file — a restore of a deleted file, the FR-106d stand-in — is not
    // the file: the run keeps saying what is wrong (FR-026) rather than showing that document's empty text.
    // Nothing is emitted until the disk has said why, so the notice already on screen never blinks off.
    if (current?.contentless === true) {
      void this.showUnloadable(run, { repeat: false });
      return;
    }
    run.documentContentless = false;
    run.notice = this.providerNotice(run);
    this.emit(run, run.lastSent);
  }

  /** FR-013b — the document is gone: back to the disk, clean, standalone. */
  private makeStandalone(run: PreviewRun): void {
    run.scheduler?.cancel();
    run.dirty = false;
    run.documentContentless = false;
    this.watchDisk(run);
    void this.readAndApply(run, { force: true, repeat: false });
  }

  /** Point a run at a new file: `byPath`, `openChanged` for both paths, `pathChanged`, provider. */
  private rebind(run: PreviewRun, to: string, opts: { rewriteHistory: boolean }): void {
    const oldKey = canon(run.filePath);
    const newKey = canon(to);
    run.filePath = to;
    const provider = enabledProviderFor(this.deps.registry, this.previewSettings(), to);
    if (provider) run.providerId = provider.id;
    run.notice = provider ? (run.notice?.kind === 'no-provider' ? null : run.notice) : { kind: 'no-provider' };
    if (oldKey !== newKey) {
      this.leavePath(oldKey, run);
      this.claimPath(newKey, run);
    }
    if (opts.rewriteHistory) this.tellHistory('rewriteCurrent', (h) => h.rewriteCurrent(run.panelId, to));
    this.deps.push.broadcastPathChanged({ panelId: run.panelId, filePath: to });
  }

  /** (Re)watch the run's folder and make the disk its source. */
  private watchDisk(run: PreviewRun): void {
    if (run.source.kind === 'disk') run.source.watch.dispose();
    const watchedPath = run.filePath;
    const watch = this.deps.fileWatcher.watch(dirname(watchedPath), () => {
      if (this.runs.get(run.panelId) !== run || run.filePath !== watchedPath) return; // a stale watch
      void this.readAndApply(run, { force: false, repeat: false });
    });
    run.source = { kind: 'disk', watch };
  }

  private readDisk(run: PreviewRun): Promise<DiskRead> {
    return this.readPath(run, run.filePath, run.providerId);
  }

  /** Read `path` for `run` as provider `providerId` would show it — the run's own file or a link's target. */
  private async readPath(run: PreviewRun, path: string, providerId: string): Promise<DiskRead> {
    const provider = this.deps.registry.get(providerId);
    if (provider?.kind === 'binary') {
      if (!(await this.isFile(path))) return { ok: false, notice: { kind: 'deleted' } };
      const url = `throng-preview://source/${encodeURIComponent(run.panelId)}?rev=${run.revision + 1}`;
      return { ok: true, content: { kind: 'resource', url } };
    }
    let result: LoadResult;
    try {
      result = await this.deps.reader.load({
        absPath: path,
        ownerRoot: run.projectRoot,
        ownerKind: 'project',
        allProjectRoots: [run.projectRoot],
      });
    } catch {
      return { ok: false, notice: { kind: 'unreadable' } };
    }
    if (result.ok) return { ok: true, content: { kind: 'text', text: result.text } };
    switch (result.reason) {
      case 'binary':
        return { ok: false, notice: { kind: 'not-text' } };
      case 'too-large':
        return { ok: false, notice: { kind: 'too-large' } };
      case 'not-found':
        return { ok: false, notice: { kind: 'deleted' } };
      case 'io': {
        // A vanished file surfaces from the read path as an I/O failure; ask the disk which it was.
        const exists = await this.deps.fs.exists(path).catch(() => false);
        return { ok: false, notice: { kind: exists ? 'unreadable' : 'deleted' } };
      }
      default:
        return { ok: false, notice: { kind: 'unreadable' } };
    }
  }

  /**
   * Read the disk and apply it to a standalone run. `force` sends an update even when nothing changed
   * (a refresh, a change of source); `repeat` marks an unchanged notice as a repeat so it flashes
   * (FR-026). Returns the update sent, or `null` when the read was stale or changed nothing.
   */
  private async readAndApply(run: PreviewRun, opts: { force: boolean; repeat: boolean }): Promise<PreviewUpdate | null> {
    const seq = ++run.readSeq;
    const path = run.filePath;
    const read = await this.readDisk(run);
    if (this.runs.get(run.panelId) !== run || run.source.kind !== 'disk' || run.filePath !== path) return null;
    if (seq !== run.readSeq) return null;

    if (!read.ok) {
      // An in-app move in progress: the file is in flight, not deleted (FR-013c).
      if (run.movePending) return null;
      if (run.notice?.kind === read.notice.kind) {
        if (opts.repeat) return this.emit(run, null, { ...read.notice, repeat: true });
        return opts.force ? this.emit(run, null) : null;
      }
      run.notice = read.notice;
      return this.emit(run, null);
    }

    const notice = this.providerNotice(run);
    const contentChanged = !sameContent(run.lastSent, read.content);
    const noticeChanged = run.notice?.kind !== notice?.kind;
    if (!contentChanged && !noticeChanged && !opts.force) return null;
    run.lastSent = read.content;
    run.notice = notice;
    return this.emit(run, contentChanged || opts.force ? read.content : null);
  }
}

function sameContent(a: PreviewContent | null, b: PreviewContent): boolean {
  if (a === null || a.kind !== b.kind) return false;
  return a.kind === 'text' ? a.text === (b as { text: string }).text : a.url === (b as { url: string }).url;
}
