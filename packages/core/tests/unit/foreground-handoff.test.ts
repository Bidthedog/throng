/**
 * #199 — a window opened by a command running in a terminal appears BEHIND throng, so the terminal
 * looks like it has hung waiting for input the user cannot see.
 *
 * The OS half of the fix (`AllowSetForegroundWindow`) cannot be asserted here: whether Windows
 * honours the grant is the OS's decision, made later, and only a real window can observe it —
 * `terminal-foreground-handoff.e2e.ts` covers that. What CAN be pinned without an OS is the policy
 * either side of it: WHEN throng asks, and what a platform without the concept does.
 *
 * Both matter on their own. The grant lets any process take the foreground for a moment, so
 * "only on a submitted command" is the whole of its scoping — if that predicate widened to every
 * keystroke, the permission would be held open continuously while someone typed, and nothing about
 * the seam itself would look any different.
 */
import { describe, it, expect } from 'vitest';
import { NoForegroundHandoff, submitsCommand } from '../../src/abstractions/foreground-handoff.js';

describe('when throng asks for the foreground handoff (#199)', () => {
  it('asks on Enter — the moment a command is submitted', () => {
    expect(submitsCommand('\r')).toBe(true);
    expect(submitsCommand('az login\r')).toBe(true);
  });

  it('asks on a newline too, which a bracketed paste can carry', () => {
    expect(submitsCommand('az login\n')).toBe(true);
    expect(submitsCommand('one\r\ntwo\r\n')).toBe(true);
  });

  it('does NOT ask while the user is merely typing', () => {
    // The scoping that keeps ASFW_ANY narrow. Per-character granting would re-arm the permission
    // for as long as someone types, which is the open-ended window this predicate exists to avoid.
    for (const keystroke of ['a', 'z', ' ', 'az login', '\t', '\x1b[A' /* up-arrow */]) {
      expect(submitsCommand(keystroke), keystroke).toBe(false);
    }
  });

  it('does NOT ask on an empty write', () => {
    expect(submitsCommand('')).toBe(false);
  });

  it('does NOT ask for a control key that is not a submit', () => {
    // Ctrl+C interrupts; it starts nothing that could open a window.
    expect(submitsCommand('\x03')).toBe(false);
  });
});

describe('a platform with no such concept (#199)', () => {
  it('refuses rather than pretending, so no caller can read a grant that never happened', () => {
    // The contract's own words: a `true` never means "the window will be raised". A no-op that
    // returned true would be claiming a permission it did not obtain.
    expect(new NoForegroundHandoff().allow()).toBe(false);
  });
});
