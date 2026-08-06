/**
 * Terminal diagnostics counters (028, FR-009).
 *
 * Their real job is not observability after the fact — it is making this feature's invariants
 * ASSERTABLE. FR-014b says a reproduction must not pass merely because the periodic backstop
 * happened to fire; that is only checkable if the backstop's firings are counted. Likewise "every
 * keystroke reached the shell" is a claim about writes and acknowledgements, not about pixels.
 *
 * Integers on a plain object, incremented in place: no allocation per keystroke, nothing rendered,
 * nothing persisted. Exposed on `window` for tests only.
 */

/** Why a terminal was reconciled. Counted per trigger so a test can tell which mechanism acted. */
export type ReconcileTrigger =
  | 'attach'
  | 'manual'
  | 'resize'
  | 'reattach'
  | 'altExit'
  | 'backstop';

export interface TerminalDiagnostics {
  reconcile: Record<ReconcileTrigger, number>;
  input: { written: number; acked: number; failed: number };
  /**
   * The last few key decisions, newest last (028 follow-up).
   *
   * Added because three separate stand-in programs failed to reproduce a defect a user reproduces
   * every time, which means the stand-ins differ from the real program in some way guessing has not
   * found. This records the inputs to the decision — what throng BELIEVED about the program when the
   * key was pressed — so the answer comes from the machine where it actually happens rather than
   * from another hypothesis.
   */
  keys: KeyDecision[];
  /**
   * Every DEC private-mode set/reset the program performed, in order (028 follow-up).
   *
   * Needed because the ORDER decides correctness: throng resets a negotiation when a program takes
   * the alternate screen, on the reasoning that whatever the shell agreed belongs to the shell. If
   * the incoming program announces what it wants BEFORE it takes the screen, that reset destroys the
   * program's own negotiation rather than the shell's.
   */
  modes: ModeEvent[];
  /**
   * Every chunk of bytes this view put on the wire, newest last (028 follow-up).
   *
   * `keys[].sent` records only the FIRST chunk of a keystroke, which hides the thing that matters
   * here: a program with mouse tracking (1003) and focus reporting (1004) enabled receives pointer
   * and focus reports interleaved with its keys, from the same stream. A bare ESC is ambiguous until
   * the next byte arrives — it is both a key and the first byte of every sequence — so a report
   * landing immediately after one can turn the user's Escape into something else. That is invisible
   * unless every write is recorded, in order.
   */
  writes: string[];
}

/** One DEC private-mode set/reset, as the program performed it. */
export interface ModeEvent {
  modes: number[];
  enable: boolean;
}

export interface KeyDecision {
  /** The chord, as thrown at the terminal. */
  chord: string;
  /** Did throng keep it for itself instead of sending it to the program? */
  reserved: boolean;
  /** Had the program negotiated the kitty keyboard protocol, as throng understood it? */
  kitty: boolean;
  /** Had it enabled win32-input-mode? */
  win32: boolean;
  /**
   * Was an APPLICATION reading input (bracketed paste on), rather than the shell editing its line?
   *
   * This is what decides Ctrl+Backspace's encoding, so it is the first thing worth seeing when the
   * chord misbehaves — particularly after a tab switch, where the view is rebuilt and has to recover
   * a negotiation the program made long ago and will never repeat.
   */
  app: boolean;
  /** Was the view showing the alternate screen? */
  altBuffer: boolean;
  /** Did throng conclude the program owns the keyboard (which is what frees the scrollback chords)? */
  programOwnsKeyboard: boolean;
  /**
   * The BYTES this keystroke actually put on the wire, as escaped text (028 follow-up).
   *
   * Everything above says what throng decided; this says what the program received. Two changes have
   * now been made in opposite directions on this chord without being able to tell them apart,
   * because both the record path and the legacy byte pass every test available here. The bytes are
   * the one thing that distinguishes them, and they can only be read on a machine where the defect
   * happens.
   */
  sent?: string;
}

/** Bounded: a rolling window, not a growing log — this is always on. */
const MAX_KEYS = 20;

const store = new Map<string, TerminalDiagnostics>();

function blank(): TerminalDiagnostics {
  return {
    reconcile: { attach: 0, manual: 0, resize: 0, reattach: 0, altExit: 0, backstop: 0 },
    input: { written: 0, acked: 0, failed: 0 },
    keys: [],
    modes: [],
    writes: [],
  };
}

/** Bounded like the key log: a rolling window of what actually reached the pty. */
const MAX_WRITES = 40;

/** Record one chunk of bytes transmitted to the program, escaped for readability. */
export function recordWrite(panelId: string, data: string): void {
  const writes = diagnosticsFor(panelId).writes;
  writes.push(JSON.stringify(data).slice(1, -1));
  if (writes.length > MAX_WRITES) writes.shift();
}

export function diagnosticsFor(panelId: string): TerminalDiagnostics {
  let entry = store.get(panelId);
  if (!entry) {
    entry = blank();
    store.set(panelId, entry);
  }
  return entry;
}

export function countReconcile(panelId: string, trigger: ReconcileTrigger): void {
  diagnosticsFor(panelId).reconcile[trigger] += 1;
}

/** Record one key decision for a panel (028 follow-up diagnostics). */
export function recordKeyDecision(panelId: string, decision: KeyDecision): void {
  const keys = diagnosticsFor(panelId).keys;
  keys.push(decision);
  if (keys.length > MAX_KEYS) keys.shift();
}

/** Record a DEC private-mode negotiation, bounded like the key log. */
export function recordModeEvent(panelId: string, modes: number[], enable: boolean): void {
  const log = diagnosticsFor(panelId).modes;
  // Keep the EARLIEST events, not the latest. The negotiation that matters happens as the program
  // starts; a rolling window fills with synchronised-output toggles (mode 2026) within seconds and
  // throws away the very thing being looked for. Ignore the noisy repeat offenders outright.
  if (modes.length === 1 && modes[0] === 2026) return;
  if (log.length >= 60) return;
  log.push({ modes, enable });
}

/** Attach the bytes a keystroke transmitted to the decision already recorded for it. */
export function recordKeyBytes(panelId: string, data: string): void {
  const keys = diagnosticsFor(panelId).keys;
  const last = keys[keys.length - 1];
  if (!last || last.sent !== undefined) return;
  // Escaped, because a raw control byte in a JSON blob a user pastes back is unreadable.
  last.sent = JSON.stringify(data).slice(1, -1);
}

export function countInputWritten(panelId: string): void {
  diagnosticsFor(panelId).input.written += 1;
}

export function countInputAcked(panelId: string, ok: boolean): void {
  const input = diagnosticsFor(panelId).input;
  if (ok) input.acked += 1;
  else input.failed += 1;
}

/** Drop a panel's counters when its view goes for good. */
export function forgetDiagnostics(panelId: string): void {
  store.delete(panelId);
}

/** Test seam: a snapshot of every panel's counters. Never used by the UI. */
export function snapshotDiagnostics(): Record<string, TerminalDiagnostics> {
  const out: Record<string, TerminalDiagnostics> = {};
  for (const [panelId, entry] of store) {
    out[panelId] = {
      reconcile: { ...entry.reconcile },
      input: { ...entry.input },
      keys: entry.keys.map((k) => ({ ...k })),
      modes: entry.modes.map((m) => ({ ...m, modes: [...m.modes] })),
      writes: [...entry.writes],
    };
  }
  return out;
}

declare global {
  interface Window {
    __throngTerminalDiagnostics?: () => Record<string, TerminalDiagnostics>;
  }
}

if (typeof window !== 'undefined') {
  window.__throngTerminalDiagnostics = snapshotDiagnostics;
}
