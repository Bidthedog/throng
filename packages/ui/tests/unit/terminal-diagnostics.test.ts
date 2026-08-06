import { describe, expect, it, beforeEach } from 'vitest';
import {
  countInputAcked,
  countInputWritten,
  countReconcile,
  diagnosticsFor,
  forgetDiagnostics,
  recordKeyBytes,
  recordKeyDecision,
  recordModeEvent,
  recordWrite,
  snapshotDiagnostics,
} from '../../src/renderer/terminal/diagnostics.js';

/**
 * 028 T017 / FR-009 — the counters exist to make this feature's claims ASSERTABLE.
 *
 * "Every keystroke reached the shell" is a claim about writes and acknowledgements, not about
 * pixels; "the reproduction did not pass because a timer happened to fire" is only checkable if the
 * triggers are counted separately. So the module itself is worth pinning: a counter that silently
 * shares a bucket, or a log that grows without bound in a hot path, would make every test that reads
 * it quietly meaningless.
 */

const PANEL = 'panel-under-test';

beforeEach(() => {
  forgetDiagnostics(PANEL);
});

describe('terminal diagnostics', () => {
  it('starts every panel at zero rather than undefined', () => {
    // A test asserting "the backstop did not fire" must be able to read a 0, not an absence.
    const d = diagnosticsFor(PANEL);
    expect(d.reconcile).toEqual({
      attach: 0,
      manual: 0,
      resize: 0,
      reattach: 0,
      altExit: 0,
      backstop: 0,
    });
    expect(d.input).toEqual({ written: 0, acked: 0, failed: 0 });
    expect(d.keys).toEqual([]);
    expect(d.modes).toEqual([]);
    expect(d.writes).toEqual([]);
  });

  it('counts each reconciliation trigger in its own bucket', () => {
    /*
     * Separate buckets are the point (FR-014b): a reproduction that only passes because the periodic
     * backstop fired has not been fixed, and the only way to tell is to know WHICH mechanism acted.
     */
    countReconcile(PANEL, 'attach');
    countReconcile(PANEL, 'attach');
    countReconcile(PANEL, 'manual');
    const { reconcile } = diagnosticsFor(PANEL);
    expect(reconcile.attach).toBe(2);
    expect(reconcile.manual).toBe(1);
    expect(reconcile.resize).toBe(0);
  });

  it('counts writes and acknowledgements at both ends', () => {
    // #200 is a character the SHELL never received — invisible from the rendered view, and only
    // detectable by counting what left the renderer against what the daemon confirmed.
    countInputWritten(PANEL);
    countInputWritten(PANEL);
    countInputAcked(PANEL, true);
    countInputAcked(PANEL, false);
    const { input } = diagnosticsFor(PANEL);
    expect(input).toEqual({ written: 2, acked: 1, failed: 1 });
  });

  it('keeps the key log bounded, newest last', () => {
    // Always on, so it must be a rolling window rather than a growing ledger.
    for (let i = 0; i < 25; i += 1) {
      recordKeyDecision(PANEL, {
        chord: `k${i}`,
        reserved: false,
        kitty: false,
        win32: false,
        app: false,
        altBuffer: false,
        programOwnsKeyboard: false,
      });
    }
    const { keys } = diagnosticsFor(PANEL);
    expect(keys).toHaveLength(20);
    expect(keys.at(-1)?.chord).toBe('k24');
    expect(keys.at(0)?.chord).toBe('k5');
  });

  it('attaches transmitted bytes to the keystroke that caused them, once', () => {
    /*
     * `sent` answers "what did the PROGRAM receive", next to what throng decided — the pair that
     * finally separated two changes made in opposite directions on the same chord. Only the FIRST
     * chunk belongs to the keystroke: anything after it is the program's own traffic.
     */
    recordKeyDecision(PANEL, {
      chord: 'Ctrl+Backspace',
      reserved: false,
      kitty: false,
      win32: false,
      app: true,
      altBuffer: false,
      programOwnsKeyboard: true,
    });
    recordKeyBytes(PANEL, String.fromCharCode(23));
    recordKeyBytes(PANEL, 'later traffic');
    expect(diagnosticsFor(PANEL).keys.at(-1)?.sent).toBe('\\u0017');
  });

  it('records mode negotiations EARLIEST first, and ignores the noisy repeat offender', () => {
    /*
     * The opposite of the key log, deliberately. The negotiation that matters happens as a program
     * starts; a rolling window fills with synchronised-output toggles within seconds and throws away
     * the very thing being looked for.
     */
    recordModeEvent(PANEL, [9001], true);
    recordModeEvent(PANEL, [2026], true); // mode 2026 on its own is the noise
    recordModeEvent(PANEL, [1049], true);
    const { modes } = diagnosticsFor(PANEL);
    expect(modes).toEqual([
      { modes: [9001], enable: true },
      { modes: [1049], enable: true },
    ]);
  });

  it('keeps the raw write log bounded too', () => {
    // It records everything transmitted, including the mouse and focus reports that ride alongside
    // keystrokes — so it must not grow without bound in the hot path.
    for (let i = 0; i < 45; i += 1) recordWrite(PANEL, `w${i}`);
    const { writes } = diagnosticsFor(PANEL);
    expect(writes).toHaveLength(40);
    expect(writes.at(-1)).toBe('w44');
  });

  it('hands out a COPY, so a reader cannot corrupt the counters', () => {
    countReconcile(PANEL, 'attach');
    const snap = snapshotDiagnostics()[PANEL];
    snap.reconcile.attach = 999;
    snap.keys.push({
      chord: 'x',
      reserved: false,
      kitty: false,
      win32: false,
      app: false,
      altBuffer: false,
      programOwnsKeyboard: false,
    });
    expect(diagnosticsFor(PANEL).reconcile.attach).toBe(1);
    expect(diagnosticsFor(PANEL).keys).toHaveLength(0);
  });

  it('forgets a panel when its view goes for good', () => {
    // Per live view, not a growing store: a panel that has gone must not keep its counters alive.
    countReconcile(PANEL, 'attach');
    forgetDiagnostics(PANEL);
    expect(diagnosticsFor(PANEL).reconcile.attach).toBe(0);
  });
});
