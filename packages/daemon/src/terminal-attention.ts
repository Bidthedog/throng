import {
  DEFAULT_APP_SETTINGS,
  ATTENTION_SIGNAL_NAMES,
  createAttentionScan,
  type AttentionKind,
  type AttentionLedgerEntry,
  type AttentionProducerConfig,
  type AttentionScanner,
  type AttentionSignal,
  type AttentionSignalName,
} from '@throng/core';
import type { TerminalEvents } from './terminal-events.js';

/**
 * At most one `terminal.attention` per panel per signal in this window (R3). The first signal goes out at
 * once, so a mark is never late; what follows inside the window is coalesced.
 */
export const ATTENTION_RATE_WINDOW_MS = 250;

/** The panel a signal is about, as the session knows it. */
export interface AttentionSubject {
  panelId: string;
  projectId: string;
}

export interface TerminalAttentionOptions {
  /** The names a notification and tooltip carry (FR-015, FR-033); absent leaves "Terminal" and no project name. */
  /**
   * `liveTitle` is the terminal's current window title (FR-116), so the panel is named as its header names
   * it rather than by the flavour label a saved layout alone gives.
   */
  resolveNames?: (
    panelId: string,
    projectId: string,
    liveTitle: string | null,
  ) => { panelTitle: string; projectName: string; tabTitle?: string };
  /** FR-116: the subject's terminal's current window title, or null when it has none. */
  liveTitle?: (subject: AttentionSubject) => string | null;
  /** FR-102: what the subject's terminal is doing right now; read when a signal is raised. */
  describeDoing?: (subject: AttentionSubject) => string | null;
  /** Test seam: the scanner a session gets. */
  createScanner?: () => AttentionScanner;
}

/** A signal before its names are resolved (they are looked up only when it is published). */
type RawSignal = Omit<AttentionSignal, 'panelTitle' | 'projectName' | 'tabTitle'>;

interface Limiter {
  last: RawSignal;
  pending: RawSignal | null;
  /** An identical signal arrived inside the window. */
  repeated: boolean;
  timer: ReturnType<typeof setTimeout>;
}

/** R4: output after at least this long a silence is "unseen output". */
export const UNSEEN_OUTPUT_GAP_MS = 1000;

interface Activity {
  lastAt: number;
  /** When the burst the quiet timer is armed for began. */
  burstStartedAt: number;
  quietTimer: ReturnType<typeof setTimeout> | null;
}

/** FR-091: the ledger never holds more than this many entries; the oldest go first. */
export const ATTENTION_LEDGER_MAX = 1000;

function readEntry(raw: unknown): AttentionLedgerEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;
  const reason = e.reason as { signal?: unknown; detail?: unknown } | null | undefined;
  if (typeof e.panelId !== 'string' || typeof e.projectId !== 'string') return null;
  if (e.kind !== 'attention' && e.kind !== 'failed') return null;
  if (typeof reason !== 'object' || reason === null || !ATTENTION_SIGNAL_NAMES.includes(reason.signal as AttentionSignalName)) {
    return null;
  }
  return {
    panelId: e.panelId,
    projectId: e.projectId,
    kind: e.kind,
    reason: { signal: reason.signal as AttentionSignalName, detail: typeof reason.detail === 'string' ? reason.detail : null },
    raisedAt: typeof e.raisedAt === 'number' ? e.raisedAt : 0,
    ...(typeof e.panelTitle === 'string' ? { panelTitle: e.panelTitle } : {}),
    ...(typeof e.projectName === 'string' ? { projectName: e.projectName } : {}),
    ...(typeof e.tabTitle === 'string' ? { tabTitle: e.tabTitle } : {}),
    ...(typeof e.doing === 'string' ? { doing: e.doing } : {}),
    whileDetached: false,
  };
}

/** The shipped defaults, used until main pushes its settings (contracts/daemon-attention.md). */
export function defaultAttentionConfig(): AttentionProducerConfig {
  const base = DEFAULT_APP_SETTINGS.terminals.attention;
  return { enabled: base.enabled, signals: { ...base.signals }, quietMs: base.quietSeconds * 1000 };
}

/** Read a pushed config tolerantly: a malformed leaf keeps the value already held. */
export function mergeAttentionConfig(current: AttentionProducerConfig, raw: unknown): AttentionProducerConfig {
  if (typeof raw !== 'object' || raw === null) return current;
  const r = raw as Record<string, unknown>;
  const signals = { ...current.signals };
  if (typeof r.signals === 'object' && r.signals !== null) {
    const incoming = r.signals as Record<string, unknown>;
    for (const name of ATTENTION_SIGNAL_NAMES) {
      if (typeof incoming[name] === 'boolean') signals[name] = incoming[name];
    }
  }
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : current.enabled,
    signals,
    quietMs: typeof r.quietMs === 'number' && Number.isFinite(r.quietMs) && r.quietMs > 0 ? r.quietMs : current.quietMs,
  };
}

/**
 * 057 — the daemon's side of panel attention: recognises signals in a session's output, applies the producer
 * settings main pushed, rate-limits, and publishes `terminal.attention`.
 *
 * Kept out of `TerminalService` so the service only says what happened (output, exit, command) and this says
 * what it means. Nothing here touches the bytes a view sees (FR-067).
 */
export class TerminalAttention {
  private config = defaultAttentionConfig();
  private readonly scanners = new Map<string, AttentionScanner>();
  private readonly limiters = new Map<string, Map<AttentionSignalName, Limiter>>();
  private readonly activity = new Map<string, Activity>();
  /** Insertion order is age: the oldest entry is the first key. */
  private readonly ledger = new Map<string, AttentionLedgerEntry>();

  constructor(
    private readonly events: TerminalEvents,
    private readonly options: TerminalAttentionOptions = {},
    private readonly now: () => number = Date.now,
  ) {}

  getConfig(): AttentionProducerConfig {
    return this.config;
  }

  setConfig(raw: unknown): void {
    this.config = mergeAttentionConfig(this.config, raw);
    if (!this.scanningWanted()) this.scanners.clear();
  }

  /** Whether any signal that comes from reading output is on (FR-063: with none, the scanner never runs). */
  private scanningWanted(): boolean {
    const c = this.config;
    return c.enabled && (c.signals.bell || c.signals.notification || c.signals.progressEnded);
  }

  /** Read one chunk of a session's output. Called after the chunk has gone to the views. */
  onOutput(subject: AttentionSubject, chunk: string): void {
    this.trackActivity(subject);
    if (!this.scanningWanted()) return;
    let scanner = this.scanners.get(subject.panelId);
    if (!scanner) {
      scanner = (this.options.createScanner ?? createAttentionScan)();
      this.scanners.set(subject.panelId, scanner);
    }
    for (const hit of scanner.scan(chunk)) this.raise(subject, hit.signal, hit.kind, hit.detail);
  }

  /**
   * The two heuristic signals (R4). Unseen output: the first chunk after a gap of at least
   * {@link UNSEEN_OUTPUT_GAP_MS} — never the very first chunk, or every terminal would mark itself as its
   * shell starts. Output went quiet: one timer per panel that, when it fires, raises only if the output
   * really has been silent for `quietMs`, else waits out the remainder; so a burst costs no timer churn.
   */
  private trackActivity(subject: AttentionSubject): void {
    const c = this.config;
    if (!c.enabled || (!c.signals.unseenOutput && !c.signals.outputQuiet)) return;
    const now = this.now();
    const state = this.activity.get(subject.panelId);
    if (state === undefined) {
      this.activity.set(subject.panelId, { lastAt: now, burstStartedAt: now, quietTimer: null });
    } else {
      if (c.signals.unseenOutput && now - state.lastAt >= UNSEEN_OUTPUT_GAP_MS) {
        this.raise(subject, 'unseenOutput', 'attention', null);
      }
      state.lastAt = now;
    }
    const entry = this.activity.get(subject.panelId)!;
    if (c.signals.outputQuiet && entry.quietTimer === null) {
      entry.burstStartedAt = now; // the burst this timer is for begins with this chunk
      this.armQuiet(subject, entry, c.quietMs);
    }
  }

  private armQuiet(subject: AttentionSubject, entry: Activity, delay: number): void {
    const timer = setTimeout(() => {
      entry.quietTimer = null;
      const c = this.config;
      if (!c.enabled || !c.signals.outputQuiet || this.activity.get(subject.panelId) !== entry) return;
      const remaining = c.quietMs - (this.now() - entry.lastAt);
      if (remaining > 0) {
        this.armQuiet(subject, entry, remaining);
        return;
      }
      this.raise(subject, 'outputQuiet', 'attention', null, false, entry.burstStartedAt);
    }, delay);
    timer.unref?.();
    entry.quietTimer = timer;
  }

  /** Raise one signal for a panel, if attention and that signal are on. */
  raise(
    subject: AttentionSubject,
    signal: AttentionSignalName,
    kind: AttentionKind,
    detail: string | null,
    startup = false,
    activityAt?: number,
  ): void {
    if (!this.config.enabled || !this.config.signals[signal]) return;
    // Names are not resolved here: a storm raises thousands of these and only the published ones need them.
    // What the terminal is doing is read by `limit` for a signal it keeps, and then at once: by the time a
    // rate window publishes it, the terminal may have moved on.
    this.limit(
      { panelId: subject.panelId, projectId: subject.projectId, signal, kind, detail, startup, at: this.now(), ...(activityAt !== undefined ? { activityAt } : {}) },
      () => this.doingOf(subject),
    );
  }

  /** The terminal's process has ended: it can no longer go quiet or produce unseen output. */
  stopActivity(panelId: string): void {
    const activity = this.activity.get(panelId);
    if (activity?.quietTimer) clearTimeout(activity.quietTimer);
    this.activity.delete(panelId);
  }

  /** A panel's terminal has gone or been replaced: forget its scanner and any signal waiting out its window. */
  dropPanel(panelId: string): void {
    this.scanners.delete(panelId);
    this.stopActivity(panelId);
    const byPanel = this.limiters.get(panelId);
    if (byPanel) for (const l of byPanel.values()) clearTimeout(l.timer);
    this.limiters.delete(panelId);
  }

  private namesFor(subject: AttentionSubject): { panelTitle: string; projectName: string; tabTitle: string } {
    try {
      const names = this.options.resolveNames?.(subject.panelId, subject.projectId, this.liveTitleOf(subject));
      if (names) return { ...names, tabTitle: names.tabTitle ?? '' };
    } catch {
      /* a name that cannot be read must not lose the signal */
    }
    return { panelTitle: 'Terminal', projectName: '', tabTitle: '' };
  }

  private liveTitleOf(subject: AttentionSubject): string | null {
    try {
      const title = this.options.liveTitle?.(subject) ?? null;
      return title === null || title === '' ? null : title;
    } catch {
      return null;
    }
  }

  private doingOf(subject: AttentionSubject): string | null {
    try {
      return this.options.describeDoing?.(subject) ?? null;
    } catch {
      return null; // as for names: never lose the signal over its description
    }
  }

  /**
   * First signal out at once; inside the window only a signal that says something new (a worse kind, other
   * text) is kept, last wins with Failed sticky, and goes out when the window closes. Identical repeats — a
   * bell storm — add nothing, and while they keep arriving the window keeps renewing, so a sustained storm
   * is one signal and not one per window.
   */
  private limit(raw: RawSignal, doingNow: () => string | null): void {
    const byPanel = this.limiters.get(raw.panelId) ?? new Map<AttentionSignalName, Limiter>();
    this.limiters.set(raw.panelId, byPanel);
    const state = byPanel.get(raw.signal);
    if (state === undefined) {
      const sig = { ...raw, doing: doingNow() };
      this.publish(sig);
      byPanel.set(sig.signal, this.open(sig.panelId, sig.signal, sig));
      return;
    }
    const reference = state.pending ?? state.last;
    if (raw.kind === reference.kind && raw.detail === reference.detail) {
      state.repeated = true; // a storm is still going: keep the window open rather than publish it again
      return;
    }
    state.pending = {
      ...raw,
      doing: doingNow(),
      kind: raw.kind === 'failed' || reference.kind === 'failed' ? 'failed' : 'attention',
    };
  }

  private open(panelId: string, signal: AttentionSignalName, last: RawSignal): Limiter {
    const limiter: Limiter = {
      last,
      pending: null,
      repeated: false,
      timer: setTimeout(() => this.close(panelId, signal), ATTENTION_RATE_WINDOW_MS),
    };
    limiter.timer.unref?.();
    return limiter;
  }

  private close(panelId: string, signal: AttentionSignalName): void {
    const byPanel = this.limiters.get(panelId);
    const state = byPanel?.get(signal);
    if (!byPanel || !state) return;
    if (state.pending === null) {
      if (state.repeated) {
        // Identical repeats arrived all through the window: a storm. Stay quiet for another window.
        byPanel.set(signal, this.open(panelId, signal, state.last));
        return;
      }
      byPanel.delete(signal);
      if (byPanel.size === 0) this.limiters.delete(panelId);
      return;
    }
    const next = state.pending;
    this.publish(next);
    byPanel.set(signal, this.open(panelId, signal, next));
  }

  /** Resolve the names now, once, for a signal that is really going out. */
  private publish(raw: RawSignal): void {
    if (!this.config.enabled || !this.config.signals[raw.signal]) return;
    const sig: AttentionSignal = { ...raw, ...this.namesFor(raw) };
    if (this.events.sinkCount === 0) {
      this.recordDetached(sig);
      return;
    }
    this.events.publishAttention(sig);
  }

  // --- The ledger (R9, FR-066, FR-091) ---

  /** A signal that arrived while no window was open: held for main to read on reconnect. */
  private recordDetached(sig: AttentionSignal): void {
    const existing = this.ledger.get(sig.panelId);
    this.ledger.delete(sig.panelId); // re-insert so insertion order stays oldest-first
    this.ledger.set(sig.panelId, {
      panelId: sig.panelId,
      projectId: sig.projectId,
      kind: sig.kind === 'failed' || existing?.kind === 'failed' ? 'failed' : 'attention',
      reason: { signal: sig.signal, detail: sig.detail },
      raisedAt: sig.at,
      panelTitle: sig.panelTitle,
      projectName: sig.projectName,
      tabTitle: sig.tabTitle ?? '',
      doing: sig.doing ?? null,
      whileDetached: true,
    });
    this.trim();
  }

  private trim(): void {
    while (this.ledger.size > ATTENTION_LEDGER_MAX) {
      const oldest = this.ledger.keys().next();
      if (oldest.done) break;
      this.ledger.delete(oldest.value);
    }
  }

  /** `terminal.attentionLedger`: every entry, clearing `whileDetached` on the ones returned. */
  readLedger(): AttentionLedgerEntry[] {
    const out = [...this.ledger.values()].map((e) => ({ ...e }));
    for (const [id, e] of this.ledger) if (e.whileDetached) this.ledger.set(id, { ...e, whileDetached: false });
    return out;
  }

  /** `terminal.attentionSync`: main's full set replaces the ledger, except detached entries main has not read. */
  syncLedger(raw: unknown): void {
    const incoming = (raw as { entries?: unknown } | null)?.entries;
    const next = new Map<string, AttentionLedgerEntry>();
    if (Array.isArray(incoming)) {
      for (const candidate of incoming) {
        const entry = readEntry(candidate);
        if (entry) next.set(entry.panelId, entry);
      }
    }
    for (const [id, e] of this.ledger) if (e.whileDetached) next.set(id, e);
    this.ledger.clear();
    for (const [id, e] of next) this.ledger.set(id, e);
    this.trim();
  }

  /** A terminal throng ended, or a panel that no longer exists: its mark is not coming back. */
  forgetPanel(panelId: string): void {
    this.ledger.delete(panelId);
  }

  forgetProject(projectId: string): void {
    for (const [id, e] of this.ledger) if (e.projectId === projectId) this.ledger.delete(id);
  }
}
