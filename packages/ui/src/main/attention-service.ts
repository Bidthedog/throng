import {
  AttentionModel,
  badgeSummary,
  kindLabel,
  notificationText,
  formatSubject,
  type AppSettings,
  type AttentionKind,
  type AttentionMark,
  type AttentionProducerConfig,
  type AttentionSignal,
  type FocusReport,
  type ISystemNotifier,
  type ITaskbarBadge,
} from '@throng/core';
import { NOTICE_OS_ID_PREFIX } from './notice-os.js';
import {
  TERMINAL_ATTENTION_CONFIG_METHOD,
  TERMINAL_ATTENTION_LEDGER_METHOD,
  TERMINAL_ATTENTION_SYNC_METHOD,
  TERMINAL_ATTENTION_FOCUS_METHOD,
  type TerminalAttentionLedgerResult,
} from '@throng/ipc-contract';

/**
 * 057 — main's owner of panel attention marks (contracts/app-attention.md).
 *
 * Drives core's pure {@link AttentionModel} and does everything the model must not: schedules its dwell
 * timer, broadcasts the mark set, decides how a raise is announced (in-app toast, Windows notification,
 * both, neither), keeps the taskbar badge, mirrors the marks to the daemon's ledger so they survive a
 * restart of throng, and routes "go to this panel" to the window that can show it.
 *
 * Every collaborator is a port, so the whole of it is unit-tested without Electron or a daemon.
 */

export const ATTENTION_CHANGED_CHANNEL = 'throng:attention:changed';
export const ATTENTION_TOAST_CHANNEL = 'throng:attention:toast';
export const ATTENTION_FOCUS_PANEL_CHANNEL = 'throng:attention:focusPanel';
/** Debounce for mirroring the mark set to the daemon (contracts/daemon-attention.md). */
export const ATTENTION_SYNC_DEBOUNCE_MS = 250;
/** The taskbar badge image is re-requested this often, this many times, when nobody could draw it. */
const BADGE_RETRY_MS = 500;
const BADGE_MAX_RETRIES = 4;

/** The slice of AppSettings the service reads. */
export type AttentionSettingsSource = Pick<AppSettings, 'attention' | 'notifications'> & {
  terminals: Pick<AppSettings['terminals'], 'attention'>;
};

export interface AttentionWindows {
  /** Live window ids (webContents ids). */
  ids(): number[];
  /** Windows that mount the toast host: the main window and sub-workspace windows. */
  toastHostIds(): number[];
  /** The focused throng window, or null when none is. */
  focusedId(): number | null;
  /** The main window, or null once it has closed. */
  mainId(): number | null;
  send(windowId: number, channel: string, payload: unknown): void;
  broadcast(channel: string, payload: unknown): void;
  /** Restore, show and focus a window. */
  raise(windowId: number): void;
  /** Ask one window's renderer to draw the badge in the theme's colours (R13); null if it could not. */
  requestBadgeImage(windowId: number, req: { count: number; kind: AttentionKind }): Promise<string | null>;
}

export interface AttentionDaemon {
  call<T>(method: string, params: unknown): Promise<T>;
}

export interface AttentionServiceDeps {
  windows: AttentionWindows;
  daemon: AttentionDaemon;
  notifier: ISystemNotifier;
  badge: ITaskbarBadge;
  settings: () => AttentionSettingsSource;
  log?: (message: string, err: unknown) => void;
}

type ToastOp = 'raise' | 'update' | 'dismiss';

export class AttentionService {
  private readonly model: AttentionModel;
  private readonly reports = new Map<number, FocusReport>();
  /** Which window holds each panel's toast, so an update and a dismiss reach the same one. */
  private readonly toastWindow = new Map<string, number>();
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private badgeSeq = 0;
  private badgeRetryTimer: ReturnType<typeof setTimeout> | null = null;
  /** When each panel last STOPPED being attended; absent = never attended. */
  private readonly lastAttendedEnd = new Map<string, number>();
  private attendedNow = new Set<string>();
  /** A `terminal.attentionFocus` push is awaiting its answer; another must wait (FR-099). */
  private focusInFlight = false;
  /** The attended set changed while a push was in flight, so the latest must follow it. */
  private focusStale = false;
  private readonly log: (message: string, err: unknown) => void;

  constructor(private readonly deps: AttentionServiceDeps) {
    this.log = deps.log ?? ((m, e) => console.error(m, e));
    this.model = new AttentionModel({
      clearDelayMs: deps.settings().attention.clearDelayMs,
      now: () => Date.now(),
    });
    this.model.onChange((marks) => this.marksChanged(marks));
    this.model.onCleared((panelId) => this.dismiss(panelId));
    // A notice's Windows notification (FR-110) shares the notifier but is not a mark.
    deps.notifier.onClick((id) => {
      if (!id.startsWith(NOTICE_OS_ID_PREFIX)) this.goTo(id);
    });
  }

  // --- inputs ---------------------------------------------------------------------------------

  /** A `terminal.attention` notification from the daemon. */
  onSignal(signal: AttentionSignal): void {
    const t = this.deps.settings().terminals.attention;
    if (!t.enabled || !t.signals[signal.signal]) return;
    // Judge attendance by main's own view of window focus at the raise, whatever events did or did
    // not arrive: a minimised window pauses its renderer's rAF, so it never reports its own blur.
    this.applyWindowFocus();
    // T070: Output went quiet reports on output the user could not have seen. Output that began
    // while the panel was attended — or that the panel has been attended since — was seen.
    const { activityAt } = signal;
    if (signal.signal === 'outputQuiet' && activityAt !== undefined && !this.unattendedSince(signal.panelId, activityAt)) {
      return;
    }
    // FR-134: only the raise that creates a mark announces it; one on a mark already showing — announced,
    // restored (FR-038) or a startup command's (FR-038a) — only refreshes a toast still up (FR-112).
    const wasMarked = this.model.marks().some((m) => m.panelId === signal.panelId);
    if (!this.model.raise(signal)) return;
    const mark = this.model.marks().find((m) => m.panelId === signal.panelId);
    if (!mark) return;
    if (wasMarked) this.refresh(mark);
    // FR-038a: a startup command's completion marks the panel but does not announce it.
    else if (!signal.startup) this.notify(mark);
  }

  /** A window's renderer reported what it shows and where focus is. */
  onFocusReport(report: FocusReport): void {
    this.reports.set(report.windowId, report);
    this.model.applyFocusReport(this.withMainsFocus(report));
    this.trackAttendance();
  }

  /** Main saw a window gain or lose focus, or be minimised or hidden: re-judge every window's attendance. */
  onWindowFocusChanged(): void {
    this.applyWindowFocus();
  }

  /** The current mark set, for a renderer that pulls it when its store registers (T068). */
  currentMarks(): readonly AttentionMark[] {
    return this.model.marks();
  }

  /** Push the current set to one window that has just loaded: it missed every earlier broadcast (T068). */
  sendMarksTo(windowId: number): void {
    this.deps.windows.send(windowId, ATTENTION_CHANGED_CHANNEL, { marks: this.model.marks() });
  }

  onWindowClosed(windowId: number): void {
    this.reports.delete(windowId);
    this.model.removeWindow(windowId);
    this.trackAttendance();
    // A toast in a closed window is gone with it; the next signal raises afresh elsewhere.
    for (const [panelId, held] of [...this.toastWindow]) if (held === windowId) this.toastWindow.delete(panelId);
  }

  /** The renderer's `windowFocused` is only believed when main agrees that window has focus. */
  private withMainsFocus(report: FocusReport): FocusReport {
    const focused = report.windowFocused && this.deps.windows.focusedId() === report.windowId;
    return focused === report.windowFocused ? report : { ...report, windowFocused: focused };
  }

  private applyWindowFocus(): void {
    for (const report of [...this.reports.values()]) this.model.applyFocusReport(this.withMainsFocus(report));
    this.trackAttendance();
  }

  /** Note when each panel stops being attended (the focused panel of a window main says is focused). */
  private trackAttendance(): void {
    const now = new Set<string>();
    for (const report of this.reports.values()) {
      const r = this.withMainsFocus(report);
      if (r.windowFocused && r.focusedPanelId !== null) now.add(r.focusedPanelId);
    }
    const at = Date.now();
    for (const panelId of this.attendedNow) if (!now.has(panelId)) this.lastAttendedEnd.set(panelId, at);
    const changed = now.size !== this.attendedNow.size || [...now].some((id) => !this.attendedNow.has(id));
    this.attendedNow = now;
    if (changed) this.sendFocus();
  }

  /**
   * FR-099: tell the daemon the attended set, so it can tell each focus-reporting program.
   *
   * One push in flight at a time: each call is its own connection, so two sent together could be handled
   * in either order and leave a stale set in force. Whatever changes meanwhile is sent, as the latest
   * set, once the push in flight is answered.
   */
  private sendFocus(): void {
    if (this.focusInFlight) {
      this.focusStale = true;
      return;
    }
    this.focusInFlight = true;
    this.focusStale = false;
    this.deps.daemon
      .call(TERMINAL_ATTENTION_FOCUS_METHOD, { attended: [...this.attendedNow] })
      .catch((err: unknown) => this.log('[attention] sending the attended panels failed:', err))
      .finally(() => {
        this.focusInFlight = false;
        if (this.focusStale) this.sendFocus();
      });
  }

  /** Was the panel unattended at `at` and has it stayed so since? */
  private unattendedSince(panelId: string, at: number): boolean {
    if (this.attendedNow.has(panelId)) return false;
    return (this.lastAttendedEnd.get(panelId) ?? Number.NEGATIVE_INFINITY) <= at;
  }

  onPanelDestroyed(panelId: string): void {
    this.model.panelDestroyed(panelId);
  }

  onProjectDeleted(projectId: string): void {
    this.model.projectDeleted(projectId);
  }

  /** The project list was refreshed: a mark whose project no longer exists goes with it (FR-007). */
  reconcileProjects(existingProjectIds: ReadonlySet<string>): void {
    const gone = new Set(
      this.model
        .marks()
        .map((m) => m.projectId)
        .filter((id) => !existingProjectIds.has(id)),
    );
    for (const id of gone) this.model.projectDeleted(id);
  }

  /** The events socket (re)connected: push the producer config, then restore what the daemon held. */
  async onDaemonConnected(): Promise<void> {
    await this.pushConfig();
    // FR-099: a daemon that restarted believes nothing is attended. Sent whatever the attention settings
    // say: telling a program the truth about focus is the terminal's job, not an attention feature.
    this.sendFocus();
    if (!this.deps.settings().terminals.attention.enabled) return;
    try {
      const { entries } = await this.deps.daemon.call<TerminalAttentionLedgerResult>(
        TERMINAL_ATTENTION_LEDGER_METHOD,
        {},
      );
      this.model.restore(entries);
    } catch (err) {
      this.log('[attention] reading the daemon ledger failed:', err);
      return;
    }
    // A daemon that restarted holds an empty ledger: give it everything main holds (FR-091).
    if (this.model.marks().length > 0) {
      if (this.syncTimer) clearTimeout(this.syncTimer);
      this.syncTimer = null;
      await this.sendSync();
    }
  }

  onSettingsChanged(previous: AttentionSettingsSource, next: AttentionSettingsSource): void {
    if (previous.attention.clearDelayMs !== next.attention.clearDelayMs) {
      this.model.setClearDelayMs(next.attention.clearDelayMs);
    }
    if (previous.terminals.attention.enabled && !next.terminals.attention.enabled) {
      this.model.withdraw('terminal');
    }
    if (JSON.stringify(previous.terminals.attention) !== JSON.stringify(next.terminals.attention)) {
      void this.pushConfig();
    }
    if (previous.attention.taskbarBadge !== next.attention.taskbarBadge) {
      void this.refreshBadge();
    }
  }

  /** A toast link, Go to Next Marked Panel or a clicked Windows notification (FR-034, FR-080a). */
  goTo(panelId: string): void {
    const mark = this.model.marks().find((m) => m.panelId === panelId);
    if (!mark) {
      // The panel is gone (or its mark already cleared): only the notification has to go.
      this.dismiss(panelId);
      return;
    }
    const hostingWindow = [...this.reports.values()].find(
      (r) => r.windowId !== this.deps.windows.mainId() && r.hostedPanels.some((h) => h.panelId === panelId),
    )?.windowId;
    const target = hostingWindow ?? this.deps.windows.mainId() ?? this.deps.windows.ids()[0];
    if (target === undefined) return;
    this.deps.windows.raise(target);
    this.deps.windows.send(target, ATTENTION_FOCUS_PANEL_CHANNEL, { panelId, projectId: mark.projectId });
  }

  dispose(): void {
    if (this.tickTimer) clearTimeout(this.tickTimer);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    if (this.badgeRetryTimer) clearTimeout(this.badgeRetryTimer);
    this.badgeRetryTimer = null;
    this.tickTimer = null;
    this.syncTimer = null;
  }

  // --- announcing -----------------------------------------------------------------------------

  /**
   * FR-111: one Attention type for both kinds. The toast always goes — the renderer applies its display
   * mode — and a Windows notification too while no throng window is focused, if both switches allow it.
   */
  private notify(mark: AttentionMark): void {
    const { notifications } = this.deps.settings();
    const reason = notificationText(mark);
    this.toast(mark, reason);
    const wantOs = notifications.os && notifications.attention.os && this.deps.windows.focusedId() === null;
    if (wantOs) {
      this.deps.notifier.show({
        id: mark.panelId,
        // FR-120: the project, the tab and the panel's title, as the toast's subject reads them.
        title: formatSubject({
          kind: 'panel',
          name: mark.panelTitle,
          ...(mark.tabTitle ? { tab: mark.tabTitle } : {}),
          ...(mark.projectName ? { project: mark.projectName } : {}),
        }),
        body: reason,
        kind: mark.kind,
      });
    }
  }

  /** FR-112: a later raise on an announced mark changes its toast, if it still has one, and nothing else. */
  private refresh(mark: AttentionMark): void {
    const target = this.toastWindow.get(mark.panelId);
    if (target === undefined) return;
    this.deps.windows.send(target, ATTENTION_TOAST_CHANNEL, {
      op: 'update' satisfies ToastOp,
      panelId: mark.panelId,
      kind: mark.kind,
      title: mark.panelTitle,
      projectName: mark.projectName,
      tabTitle: mark.tabTitle,
      reason: notificationText(mark),
    });
  }

  private toast(mark: AttentionMark, reason: string): void {
    const held = this.toastWindow.get(mark.panelId);
    const windows = this.deps.windows;
    // Only a window that mounts AttentionToasts can show one: not Preferences or About.
    const hosts = windows.toastHostIds();
    const focused = windows.focusedId();
    const main = windows.mainId();
    const target =
      held ??
      (focused !== null && hosts.includes(focused) ? focused : undefined) ??
      (main !== null && hosts.includes(main) ? main : undefined) ??
      hosts[0];
    if (target === undefined) return;
    this.toastWindow.set(mark.panelId, target);
    const op: ToastOp = held === undefined ? 'raise' : 'update';
    windows.send(target, ATTENTION_TOAST_CHANNEL, {
      op,
      panelId: mark.panelId,
      kind: mark.kind,
      title: mark.panelTitle,
      projectName: mark.projectName,
      tabTitle: mark.tabTitle,
      reason,
    });
  }

  /** FR-036: drop a panel's toast and Windows notification, whatever cleared it. */
  private dismiss(panelId: string): void {
    const target = this.toastWindow.get(panelId);
    if (target !== undefined) {
      this.toastWindow.delete(panelId);
      this.deps.windows.send(target, ATTENTION_TOAST_CHANNEL, { op: 'dismiss' satisfies ToastOp, panelId });
    }
    this.deps.notifier.close(panelId);
  }

  // --- reacting to the model ------------------------------------------------------------------

  private marksChanged(marks: readonly AttentionMark[]): void {
    this.deps.windows.broadcast(ATTENTION_CHANGED_CHANNEL, { marks });
    this.scheduleTick();
    this.scheduleSync();
    void this.refreshBadge();
  }

  private scheduleTick(): void {
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.tickTimer = null;
    const due = this.model.nextTickAt();
    if (due === null) return;
    this.tickTimer = setTimeout(
      () => {
        this.tickTimer = null;
        this.model.tick();
        this.scheduleTick();
      },
      Math.max(0, due - Date.now()),
    );
  }

  private scheduleSync(): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.sendSync();
    }, ATTENTION_SYNC_DEBOUNCE_MS);
  }

  private sendSync(): Promise<void> {
    return this.deps.daemon
      .call(TERMINAL_ATTENTION_SYNC_METHOD, { entries: this.model.ledgerEntries() })
      .then(
        () => undefined,
        (err: unknown) => this.log('[attention] syncing the daemon ledger failed:', err),
      );
  }

  /** Send a pending ledger sync now (on quit, so a fresh mark reaches the daemon — FR-091). */
  /** Whether a mark set is still waiting out the sync debounce, so a quit has something to flush. */
  hasPendingSync(): boolean {
    return this.syncTimer !== null;
  }

  async flush(): Promise<void> {
    if (this.syncTimer === null) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = null;
    await this.sendSync();
  }

  private async pushConfig(): Promise<void> {
    const t = this.deps.settings().terminals.attention;
    const config: AttentionProducerConfig = {
      enabled: t.enabled,
      signals: { ...t.signals },
      quietMs: t.quietSeconds * 1000,
    };
    try {
      await this.deps.daemon.call(TERMINAL_ATTENTION_CONFIG_METHOD, config);
    } catch (err) {
      this.log('[attention] pushing the producer config failed:', err);
    }
  }

  /** FR-039. The newest request wins: a reply for an older mark set is discarded. */
  private async refreshBadge(attempt = 0): Promise<void> {
    const seq = ++this.badgeSeq;
    if (this.badgeRetryTimer) clearTimeout(this.badgeRetryTimer);
    this.badgeRetryTimer = null;
    const summary = this.deps.settings().attention.taskbarBadge ? badgeSummary(this.model.marks()) : null;
    if (summary === null) {
      this.deps.badge.clear();
      return;
    }
    // No window to draw it, or no answer: try again shortly, a bounded number of times. A window
    // finishing its load (or its answerer registering) restarts the count via onBadgeAnswererReady.
    const retry = (): void => {
      if (attempt >= BADGE_MAX_RETRIES || seq !== this.badgeSeq) return;
      this.badgeRetryTimer = setTimeout(() => void this.refreshBadge(attempt + 1), BADGE_RETRY_MS);
    };
    const windowId = this.deps.windows.mainId() ?? this.deps.windows.ids()[0];
    if (windowId === undefined) return retry();
    try {
      const image = await this.deps.windows.requestBadgeImage(windowId, {
        count: summary.count,
        kind: summary.kind,
      });
      if (seq !== this.badgeSeq) return;
      if (image === null) return retry();
      const noun = summary.count === 1 ? 'panel needs' : 'panels need';
      this.deps.badge.set(image, `${summary.count} ${noun} you (${kindLabel(summary.kind)})`);
    } catch (err) {
      this.log('[attention] drawing the taskbar badge failed:', err);
      retry();
    }
  }

  /** A window's renderer can now draw the badge (it finished loading, or registered its answerer). */
  onBadgeAnswererReady(): void {
    if (this.model.marks().length > 0) void this.refreshBadge(0);
  }
}
