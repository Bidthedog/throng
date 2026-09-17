/**
 * NavigationHistoryService — the ONE owner of every editor and preview panel's navigation history
 * (044 US7, #136, contracts/navigation-history.md §1, data-model §11, Principle XI).
 *
 * ## One authority, derived replicas
 *
 * A history is document-like state a panel shown in two windows (Sync to) must agree about, so it lives
 * here, in UI main, keyed by panel id, and nowhere else. Every window mirrors it from the `changed`
 * broadcast into its layout (`HistoryMirrorSync`, renderer); no renderer computes a new history, it only
 * renders one and asks for moves. The arithmetic is core's pure reducer (`navigation/history.ts`); this
 * class decides WHEN it runs and tells everyone what came out.
 *
 * ## Why `changed` is a broadcast, not a viewer update
 *
 * There is no viewer registration and no `detach`. A window holding the panel in a background tab has
 * unmounted it — detached, for every other purpose — and must still mirror a Save-As rewrite, a move or
 * a purge into the layout it will persist. A window whose layout does not hold the panel ignores it.
 *
 * ## Who calls what
 *
 * | Caller | Calls |
 * |---|---|
 * | `throng:history:attach` (editor mount), `PreviewService.attach` | `attach` — adopt if absent |
 * | `EditorCoordinator.load` | `recordOpen`, or `moveTo` for a history intent |
 * | `EditorCoordinator.save` (Save As), `PreviewService.repointed` | `rewriteCurrent` |
 * | `PreviewService.navigate` | `setCurrentViewState`, then `recordOpen` or `moveTo`; `recordJump` for a heading (FR-115) |
 * | main's ONE combined `FilesService.setOnMoved` callback | `rewritePaths` |
 * | `throng:history:purge`, `PreviewService.destroyed` | `purge` |
 * | a `historySize` settings change | `applyCap` |
 *
 * Every mutation broadcasts only when the record actually changed — the reducer returns its input by
 * identity otherwise — so a no-op costs no window a layout write. `attach` is the one exception, below.
 */
import {
  EMPTY_HISTORY,
  applyCap,
  moveTo,
  parseHistory,
  recordCurrentPlace,
  recordJump,
  recordOpen,
  rewriteCurrent,
  rewritePaths,
  samePath,
  type NavigationHistory,
  type PersistedHistory,
} from '@throng/core';

export type HistoryPanelKind = 'editor' | 'preview';

/** `throng:history:changed` — to every window. Paths only, like `throng:files:moved`. */
export interface HistoryChangedMessage {
  panelId: string;
  /**
   * `null` once the panel's record is PURGED (§2, amended 2026-09-15): the mirror removes
   * `config.history`. Never an empty history, which a first attach of a panel with none can send.
   */
  history: NavigationHistory | null;
}

export interface NavigationHistoryServiceDeps {
  /** `editor.navigation.historySize`, read LIVE: a changed setting applies to the next append. */
  cap: () => number;
  /** Every window (`createHistoryPush(...).broadcastChanged`). */
  broadcastChanged: (message: HistoryChangedMessage) => void;
}

interface HistoryRecord {
  panelKind: HistoryPanelKind;
  history: NavigationHistory;
}

export class NavigationHistoryService {
  private readonly records = new Map<string, HistoryRecord>();

  constructor(private readonly deps: NavigationHistoryServiceDeps) {}

  /** The panel's history, or `undefined` when it has no record. */
  get(panelId: string): NavigationHistory | undefined {
    return this.records.get(panelId)?.history;
  }

  /**
   * Adopt if absent (contracts/navigation-history.md §2). The first attach of a panel parses what its
   * layout persisted; every later one — a second window (Sync to), a remount after Send to Tab (FR-110)
   * — adopts the record as it stands, and its possibly older persisted copy is ignored.
   *
   * Broadcasts EVEN WHEN nothing changed. An attach is how a window that did not exist when the record
   * last changed — a sub-workspace opened later, a reloaded window — hears a preview's history at all: a
   * preview's attach is `throng:preview:attach`, whose update deliberately carries no Back/Forward state.
   * Every other window already holds this exact value and skips it.
   */
  attach(panelId: string, panelKind: HistoryPanelKind, persisted: PersistedHistory | undefined): NavigationHistory {
    let record = this.records.get(panelId);
    if (!record) {
      record = { panelKind, history: parseHistory(persisted, this.deps.cap()) };
      this.records.set(panelId, record);
    }
    this.broadcast(panelId, record.history);
    return record.history;
  }

  /**
   * A file opened into the panel by any route but Back and Forward (FR-103): newer entries go, the file
   * is appended — or nothing, when it is already current. A panel with no record yet gets one — an
   * editor's, since previews always attach first.
   *
   * `persisted` is the layout's copy an editor's RESTORING load carries (§6, amended 2026-09-15). When the
   * panel has no record it is adopted first and the open recorded on top of it, in ONE broadcast; when it
   * has one it is ignored (adopt if absent). This is what makes restore independent of whether a separate
   * attach reached main before the load.
   */
  recordOpen(panelId: string, filePath: string, persisted?: PersistedHistory): void {
    this.update(panelId, (h) => recordOpen(h, filePath, this.deps.cap()), persisted);
  }

  /**
   * Back or Forward landed (FR-102): the position moves, the list does not. Only when entry `index` still
   * names `filePath` — the renderer chose the target from its mirror, and a history that changed since
   * (a move, a cap, a Save As in another window) must not move to an entry that now means another file.
   * `persisted` is adopted first when the panel has no record, exactly as for {@link recordOpen}.
   *
   * Returns whether the position is now `index`.
   */
  moveTo(panelId: string, index: number, filePath: string, persisted?: PersistedHistory): boolean {
    let moved = false;
    this.update(
      panelId,
      (h) => {
        const entry = h.entries[index];
        if (entry === undefined || !samePath(entry.filePath, filePath)) return h;
        moved = true;
        return moveTo(h, index);
      },
      persisted,
    );
    return moved;
  }

  /**
   * Where the reader is on the current entry (FR-107). Preview records only — H10.
   *
   * ══ WHY `recordCurrentPlace` AND NOT THE BARE `setCurrentViewState` (T219) ══
   *
   * FR-115's *"Two consecutive entries for the same file and the same position MUST NOT be
   * recorded"* is unconditional, and it was enforced only inside `recordJump`. THREE routes reach
   * this method without one — `PreviewService.navigate`'s link intent, its history intent, and the
   * detaching-view effect through `throng:history:setViewState` — so a reader who scrolled back to
   * where an earlier jump left them got an entry equal to its neighbour, and then a Back press that
   * was enabled, accepted, and changed nothing on screen.
   *
   * Every route into a history from outside goes through this class, so applying the rule HERE is
   * what makes it true of all of them, including ones added later.
   *
   * The merge can shift entries under a `navigate` request's `index`, and that is handled rather
   * than avoided: `PreviewService.navigateHistory` re-reads the entry AFTER this write and
   * {@link moveTo} re-validates the path, so a request that named the pre-merge list is treated as
   * stale — which is what it is. It is not reordered, because FR-107 needs the reader's place
   * recorded whatever follows, a refusal and a stale request included.
   */
  setCurrentViewState(panelId: string, viewState: unknown): void {
    if (this.records.get(panelId)?.panelKind !== 'preview') return;
    this.update(panelId, (h) => recordCurrentPlace(h, viewState));
  }

  /**
   * A followed same-document heading in a preview (FR-115, data-model §14.3): `leaving` goes on the current
   * entry and a same-file entry at `arriving` is appended, unless the reader is already there. A no-op for an
   * editor record and for a panel with no record — H10 holds by construction — and it broadcasts only when
   * the reducer returned a different history.
   */
  recordJump(panelId: string, leaving: unknown, arriving: unknown): void {
    if (this.records.get(panelId)?.panelKind !== 'preview') return;
    this.update(panelId, (h) => recordJump(h, leaving, arriving, this.deps.cap()));
  }

  /**
   * The panel's current document now has another path — Save As, or a parented preview following its
   * document (R14, FR-013c). The current entry is rewritten: no second entry, no stale one. A panel with
   * no history — a new document's first Save As — records it (H8).
   */
  rewriteCurrent(panelId: string, filePath: string): void {
    this.update(panelId, (h) => rewriteCurrent(h, filePath));
  }

  /**
   * In-app moves (FR-109): every record, whichever window holds its panel, mounted or not. Called once
   * per move from main's combined `onMoved` callback — never from `markMoved`, so a move rewrites each
   * history once.
   */
  rewritePaths(moves: readonly { from: string; to: string }[], except: readonly string[] = []): void {
    if (moves.length === 0) return;
    const skip = new Set(except);
    for (const panelId of [...this.records.keys()]) {
      // A preview a collision kept on its old path keeps its history there too (FR-012, review I-1).
      if (skip.has(panelId)) continue;
      this.update(panelId, (h) => rewritePaths(h, moves));
    }
  }

  /**
   * Broadcast the panel's record as it stands, changed or not — after `throng:files:moved`, which every
   * window applies to every history in its layout, so a panel that move must NOT carry is put back (I-1).
   */
  announce(panelId: string): void {
    const record = this.records.get(panelId);
    if (record) this.broadcast(panelId, record.history);
  }

  /** `historySize` changed (FR-108): every record at once, oldest first, never the current entry. */
  applyCap(cap = this.deps.cap()): void {
    for (const panelId of [...this.records.keys()]) this.update(panelId, (h) => applyCap(h, cap));
  }

  /**
   * The panel no longer exists (FR-110) — destroyed, closed, or its type cleared. Idempotent: the local
   * destroy and every remote one may each purge. Send to Tab and Sync to never do.
   */
  purge(panelId: string): void {
    if (!this.records.delete(panelId)) return;
    this.broadcast(panelId, null);
  }

  /**
   * Apply `change` to the panel's record and broadcast once if anything is new. With no record, the base
   * is `seed` (parsed) or empty; a record is created — and announced, even if `change` then did nothing —
   * only when a seed was adopted or the change produced something.
   */
  private update(
    panelId: string,
    change: (h: NavigationHistory) => NavigationHistory,
    seed?: PersistedHistory,
  ): void {
    const record = this.records.get(panelId);
    if (record) {
      const after = change(record.history);
      if (after === record.history) return;
      record.history = after;
      this.broadcast(panelId, after);
      return;
    }
    const base = seed !== undefined ? parseHistory(seed, this.deps.cap()) : EMPTY_HISTORY;
    const after = change(base);
    if (seed === undefined && after === base) return;
    this.records.set(panelId, { panelKind: 'editor', history: after });
    this.broadcast(panelId, after);
  }

  /** Isolated: a window that cannot be told must never undo or abort the change itself. */
  private broadcast(panelId: string, history: NavigationHistory | null): void {
    try {
      this.deps.broadcastChanged({ panelId, history });
    } catch (err) {
      console.error('[navigation-history] changed broadcast failed:', err);
    }
  }
}
