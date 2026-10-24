/**
 * 057 — the vocabulary shared by every process that handles panel attention marks.
 *
 * The daemon recognises a terminal signal and reports an {@link AttentionSignal}; main owns the
 * {@link AttentionMark}s that result and broadcasts them; renderers send a {@link FocusReport} so main can
 * tell which panels are attended. Pure types: no process-specific code lives here.
 */

/** The terminal signals that can raise a mark; also the names of the `terminals.attention.signals.*` settings. */
export type AttentionSignalName =
  | 'processExited'
  | 'commandFinished'
  | 'bell'
  | 'notification'
  | 'progressEnded'
  | 'unseenOutput'
  | 'outputQuiet';

/** Every {@link AttentionSignalName}, in the order the settings list them. */
export const ATTENTION_SIGNAL_NAMES: readonly AttentionSignalName[] = [
  'processExited',
  'commandFinished',
  'bell',
  'notification',
  'progressEnded',
  'unseenOutput',
  'outputQuiet',
];

/** `failed` is a non-zero exit or a progress error; it outranks `attention` wherever marks merge (FR-002, FR-014). */
export type AttentionKind = 'attention' | 'failed';

/** What the daemon reports for one recognised event, after its per-panel-per-signal rate limit. */
export interface AttentionSignal {
  panelId: string;
  projectId: string;
  signal: AttentionSignalName;
  kind: AttentionKind;
  /** Exit code, command name, or the sanitised notification message (FR-068). */
  detail: string | null;
  /** True for the `commandFinished` of a startup command (R8). */
  startup: boolean;
  /** The panel's title, resolved by the daemon through `currentPanelTitle`; "Terminal" when unknown. */
  panelTitle: string;
  projectName: string;
  /** FR-100: the title of the tab holding the panel; absent from a producer that does not know it. */
  tabTitle?: string;
  /**
   * FR-102: what the terminal was doing when the signal was raised — the title its running program set,
   * else the last command it ran; null when neither is known.
   */
  doing?: string | null;
  /** Epoch milliseconds. */
  at: number;
  /**
   * Only on `outputQuiet`: epoch ms when the burst of output that armed the quiet timer began. The daemon
   * cannot know focus, so main raises only if the panel was unattended while that output arrived.
   */
  activityAt?: number;
}

/** What a reason can name: a terminal signal, or the user's manual Flag (FR-125). */
export type AttentionReasonSignal = AttentionSignalName | 'flagged';

/** Why a mark was raised: the most recent raise. */
export interface AttentionReason {
  signal: AttentionReasonSignal;
  detail: string | null;
}

/** Who raised a mark: the terminal signals, or the user's Flag (FR-125). Withdrawal is per producer (FR-008). */
export type AttentionProducer = 'terminal' | 'user';

/** Main's state for one panel (at most one per panel, FR-002). */
export interface AttentionMark {
  panelId: string;
  /** Moves with the panel: a FocusReport hosting it under another project updates this. */
  projectId: string;
  panelTitle: string;
  projectName: string;
  /** FR-100: the panel's tab; `''` when unknown. A hosting report refreshes it. */
  tabTitle: string;
  /** FR-102: what the terminal was doing at the most recent raise. */
  doing: string | null;
  /** FR-008: withdrawal is per producer. A user flag stays the user's whatever raises on it later (R20). */
  producer: AttentionProducer;
  kind: AttentionKind;
  reason: AttentionReason;
  raisedAt: number;
  /** Set while the mark's panel holds focus in a focused window (FR-095); the mark clears once it has for the clear delay. */
  dwellStartedAt: number | null;
  /**
   * FR-127: a flag raised on the focused panel runs no clear delay until that focus has gone; the first time
   * its panel is unattended this drops to false. Absent means false.
   */
  heldSinceRaise?: boolean;
}

/** A manual flag as the daemon stores it (R19, FR-128). */
export interface AttentionFlagEntry {
  panelId: string;
  projectId: string;
  panelTitle: string;
  tabTitle: string;
  projectName: string;
  raisedAt: number;
}

/** The panel a manual Flag is raised on (FR-125). */
export interface AttentionFlagRequest {
  panelId: string;
  projectId: string;
  panelTitle: string;
  tabTitle: string;
  projectName: string;
  at: number;
}

/** A panel a window currently hosts, with its live title. */
export interface HostedPanel {
  panelId: string;
  projectId: string;
  title: string;
  /** FR-100: the title of the tab holding it. */
  tabTitle?: string;
}

/** A renderer's report of what it shows and where focus is; coalesced to one per animation frame. */
export interface FocusReport {
  /** The webContents id. */
  windowId: number;
  windowFocused: boolean;
  /** Keyboard focus inside a panel in the workspace pane; null in the Files or Projects pane. */
  focusedPanelId: string | null;
  hostedPanels: HostedPanel[];
}

/** The daemon's copy of a mark main holds (R9). */
export interface AttentionLedgerEntry {
  panelId: string;
  projectId: string;
  kind: AttentionKind;
  reason: AttentionReason;
  raisedAt: number;
  /** Carried so a mark restored after a restart still names its panel and project (FR-038); a hosting report refreshes them. */
  panelTitle?: string;
  projectName?: string;
  tabTitle?: string;
  doing?: string | null;
  /** The signal arrived while no events socket was attached (FR-066). */
  whileDetached: boolean;
}

/** The producer settings main pushes to the daemon (R4). */
export interface AttentionProducerConfig {
  enabled: boolean;
  signals: Record<AttentionSignalName, boolean>;
  quietMs: number;
}
