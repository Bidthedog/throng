/**
 * 057 — the attention mark state machine (R5, R6; data-model § AttentionMark).
 *
 * Pure: no timers, no Electron. The host (main's AttentionService) feeds it signals and focus reports and
 * calls {@link AttentionModel.tick} when {@link AttentionModel.nextTickAt} comes due; the clock is injected.
 * Marks are immutable snapshots; every change replaces the affected mark.
 */
import type {
  AttentionFlagEntry,
  AttentionFlagRequest,
  AttentionLedgerEntry,
  AttentionMark,
  AttentionSignal,
  FocusReport,
} from './attention-types.js';

export interface AttentionModelOptions {
  /** FR-095: how long a mark's panel must hold focus, in a focused window, before the mark clears. */
  clearDelayMs: number;
  now: () => number;
}

type ChangeListener = (marks: readonly AttentionMark[]) => void;
type ClearedListener = (panelId: string) => void;

export class AttentionModel {
  private readonly now: () => number;
  private clearDelayMs: number;
  private readonly byPanel = new Map<string, AttentionMark>();
  private readonly windows = new Map<number, FocusReport>();
  private readonly changeListeners = new Set<ChangeListener>();
  private readonly clearedListeners = new Set<ClearedListener>();
  private snapshot: readonly AttentionMark[] = [];

  constructor(options: AttentionModelOptions) {
    this.clearDelayMs = options.clearDelayMs;
    this.now = options.now;
  }

  /** The marks, oldest raise first. The same array is returned until something changes. */
  marks(): readonly AttentionMark[] {
    return this.snapshot;
  }

  onChange(listener: ChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** Fired once for every mark removed, whatever removed it (the host dismisses the toast and OS notification). */
  onCleared(listener: ClearedListener): () => void {
    this.clearedListeners.add(listener);
    return () => this.clearedListeners.delete(listener);
  }

  setClearDelayMs(clearDelayMs: number): void {
    this.clearDelayMs = clearDelayMs;
    this.settle();
  }

  /** FR-004: a raise on an attended panel is ignored. Returns whether a mark was created or updated. */
  raise(signal: AttentionSignal): boolean {
    if (this.isAttended(signal.panelId)) return false;
    const existing = this.byPanel.get(signal.panelId);
    const reason = { signal: signal.signal, detail: signal.detail };
    if (existing === undefined) {
      this.byPanel.set(signal.panelId, {
        panelId: signal.panelId,
        projectId: signal.projectId,
        panelTitle: this.panelTitleFor(signal),
        projectName: signal.projectName,
        tabTitle: this.tabTitleFor(signal, ''),
        doing: signal.doing ?? null,
        producer: 'terminal',
        kind: signal.kind,
        reason,
        raisedAt: signal.at,
        dwellStartedAt: null,
      });
    } else {
      this.byPanel.set(signal.panelId, {
        ...existing,
        kind: existing.kind === 'failed' || signal.kind === 'failed' ? 'failed' : 'attention',
        reason,
        raisedAt: signal.at,
        // The newest signal says what is happening now (FR-102).
        panelTitle: this.panelTitleFor(signal),
        tabTitle: this.tabTitleFor(signal, existing.tabTitle),
        doing: signal.doing ?? null,
      });
    }
    this.publish();
    return true;
  }

  /**
   * FR-125: the user's Flag. Returns false, changing nothing, on a panel already marked. A flag raised on the
   * focused panel is held: no clear delay runs until that focus has gone (FR-127).
   */
  flag(request: AttentionFlagRequest): boolean {
    if (this.byPanel.has(request.panelId)) return false;
    this.byPanel.set(request.panelId, {
      panelId: request.panelId,
      projectId: request.projectId,
      panelTitle: request.panelTitle,
      projectName: request.projectName,
      tabTitle: request.tabTitle,
      doing: null,
      producer: 'user',
      kind: 'attention',
      reason: { signal: 'flagged', detail: null },
      raisedAt: request.at,
      dwellStartedAt: null,
      heldSinceRaise: this.isAttended(request.panelId),
    });
    this.publish();
    return true;
  }

  /** FR-128: reinstate the user's flags read from the daemon's store. Unheld; no clear events; existing marks win. */
  restoreFlags(entries: readonly AttentionFlagEntry[]): void {
    let dirty = false;
    for (const e of entries) {
      if (this.byPanel.has(e.panelId)) continue;
      this.byPanel.set(e.panelId, {
        panelId: e.panelId,
        projectId: e.projectId,
        panelTitle: e.panelTitle,
        projectName: e.projectName,
        tabTitle: e.tabTitle,
        doing: null,
        producer: 'user',
        kind: 'attention',
        reason: { signal: 'flagged', detail: null },
        raisedAt: e.raisedAt,
        dwellStartedAt: null,
      });
      dirty = true;
    }
    if (dirty && !this.settle()) this.publish();
  }

  /**
   * Take one window's report. A focused panel in a focused window starts its mark's clear delay
   * (FR-095); hosted panels refresh a mark's project and title.
   */
  applyFocusReport(report: FocusReport): void {
    this.windows.set(report.windowId, report);
    let dirty = false;
    for (const mark of [...this.byPanel.values()]) {
      let next = mark;
      const hosted = report.hostedPanels.find((h) => h.panelId === mark.panelId);
      if (hosted !== undefined) {
        const tabTitle = hosted.tabTitle ?? next.tabTitle;
        if (hosted.projectId !== next.projectId || hosted.title !== next.panelTitle || tabTitle !== next.tabTitle) {
          next = { ...next, projectId: hosted.projectId, panelTitle: hosted.title, tabTitle };
        }
      }
      if (next !== mark) {
        this.byPanel.set(mark.panelId, next);
        dirty = true;
      }
    }
    if (this.settle()) return;
    if (dirty) this.publish();
  }

  /** A window closed: it no longer attends or shows anything. */
  removeWindow(windowId: number): void {
    if (this.windows.delete(windowId)) this.settle();
  }

  /** Advance the clock-driven clearing. Call when {@link nextTickAt} comes due. */
  tick(): void {
    this.settle();
  }

  /** When the next focus dwell completes, or null when none is running. */
  nextTickAt(): number | null {
    let next: number | null = null;
    for (const mark of this.byPanel.values()) {
      if (mark.dwellStartedAt !== null) {
        const due = mark.dwellStartedAt + this.clearDelayMs;
        if (next === null || due < next) next = due;
      }
    }
    return next;
  }

  /** FR-008, FR-063: clear every mark that producer raised. */
  withdraw(producer: 'terminal'): void {
    this.removeWhere((m) => m.producer === producer);
  }

  /** FR-007: the panel is gone. */
  panelDestroyed(panelId: string): void {
    this.removeWhere((m) => m.panelId === panelId);
  }

  /** FR-007: the project is gone. */
  projectDeleted(projectId: string): void {
    this.removeWhere((m) => m.projectId === projectId);
  }

  /** Reinstate marks read from the daemon ledger (FR-038): no clear events. Existing marks win. */
  restore(entries: readonly AttentionLedgerEntry[]): void {
    let dirty = false;
    for (const e of entries) {
      if (this.byPanel.has(e.panelId)) continue;
      this.byPanel.set(e.panelId, {
        panelId: e.panelId,
        projectId: e.projectId,
        panelTitle: e.panelTitle ?? 'Terminal',
        projectName: e.projectName ?? '',
        tabTitle: e.tabTitle ?? '',
        doing: e.doing ?? null,
        producer: 'terminal',
        kind: e.kind,
        reason: e.reason,
        raisedAt: e.raisedAt,
        dwellStartedAt: null,
      });
      dirty = true;
    }
    // A restored mark may land on the panel that already has focus: its clear delay starts now (FR-095).
    if (dirty && !this.settle()) this.publish();
  }

  /** The terminal producer's marks as ledger entries, for `terminal.attentionSync`; user flags live apart (R19). */
  ledgerEntries(): AttentionLedgerEntry[] {
    return this.snapshot.filter((m) => m.producer === 'terminal').map((m) => ({
      panelId: m.panelId,
      projectId: m.projectId,
      kind: m.kind,
      reason: m.reason,
      raisedAt: m.raisedAt,
      panelTitle: m.panelTitle,
      projectName: m.projectName,
      tabTitle: m.tabTitle,
      doing: m.doing,
      whileDetached: false,
    }));
  }

  /**
   * FR-100: a window hosting the panel knows its tab's live name; the daemon's comes from the saved layout,
   * which lags a rename. An empty name from the daemon means it does not know, and keeps `known`.
   */
  /**
   * FR-116: a window hosting the panel knows the title its header shows — derived from the live window
   * title, a template or the user's name; the notification goes out at the raise, so that one wins.
   */
  private panelTitleFor(signal: AttentionSignal): string {
    for (const w of this.windows.values()) {
      const hosted = w.hostedPanels.find((h) => h.panelId === signal.panelId);
      if (hosted?.title) return hosted.title;
    }
    return signal.panelTitle;
  }

  private tabTitleFor(signal: AttentionSignal, known: string): string {
    for (const w of this.windows.values()) {
      const hosted = w.hostedPanels.find((h) => h.panelId === signal.panelId);
      if (hosted?.tabTitle) return hosted.tabTitle;
    }
    return signal.tabTitle || known;
  }

  private isAttended(panelId: string): boolean {
    for (const w of this.windows.values()) {
      if (w.windowFocused && w.focusedPanelId === panelId) return true;
    }
    return false;
  }

  /**
   * Re-derive every mark's dwell from the current windows and clear those whose panel has held focus for
   * the clear delay (FR-095). Being the active panel is not focus. Returns whether it published.
   */
  private settle(): boolean {
    const now = this.now();
    let dirty = false;
    const cleared: string[] = [];
    for (const mark of [...this.byPanel.values()]) {
      const attended = this.isAttended(mark.panelId);
      if (mark.heldSinceRaise) {
        // FR-127: no dwell while the focus the flag was raised under holds; once it has gone, an ordinary mark.
        if (!attended) {
          this.byPanel.set(mark.panelId, { ...mark, heldSinceRaise: false, dwellStartedAt: null });
          dirty = true;
        }
        continue;
      }
      const dwellStartedAt = attended ? (mark.dwellStartedAt ?? now) : null;
      if (dwellStartedAt !== null && now - dwellStartedAt >= this.clearDelayMs) {
        this.byPanel.delete(mark.panelId);
        cleared.push(mark.panelId);
        continue;
      }
      if (dwellStartedAt !== mark.dwellStartedAt) {
        this.byPanel.set(mark.panelId, { ...mark, dwellStartedAt });
        dirty = true;
      }
    }
    if (cleared.length > 0 || dirty) this.publish(cleared);
    return cleared.length > 0 || dirty;
  }

  private removeWhere(predicate: (m: AttentionMark) => boolean): void {
    const cleared: string[] = [];
    for (const mark of [...this.byPanel.values()]) {
      if (predicate(mark)) {
        this.byPanel.delete(mark.panelId);
        cleared.push(mark.panelId);
      }
    }
    if (cleared.length > 0) this.publish(cleared);
  }

  private publish(cleared: readonly string[] = []): void {
    this.snapshot = [...this.byPanel.values()].sort((a, b) => a.raisedAt - b.raisedAt);
    for (const l of this.changeListeners) l(this.snapshot);
    for (const id of cleared) for (const l of this.clearedListeners) l(id);
  }
}
