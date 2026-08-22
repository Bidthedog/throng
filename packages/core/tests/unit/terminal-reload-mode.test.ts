import { describe, it, expect } from 'vitest';
import {
  terminalReloadAction,
  startsTerminal,
  changesDormancy,
  type TerminalReloadAction,
} from '@throng/core';

/*
 * 039 (#293) — opening a project, per terminal Panel.
 *
 * All four outcomes are decidable from two values, which is why this is a unit test and not an
 * E2E. The one thing that genuinely needs a window and a real process table — FR-026, that a
 * dormant Panel holds no PTY, no shell and no conhost — is the single E2E this story earns.
 */
describe('terminalReloadAction (039 FR-021/FR-022/FR-028/FR-029a)', () => {
  /*
   * The row that matters most, because it is every existing install. Automatic is the shipped
   * default and no Panel has ever been dormant, so this is the only row an upgrading user meets —
   * and it must be indistinguishable from today.
   */
  it('automatic + not dormant -> start (FR-021: today, unchanged)', () => {
    expect(terminalReloadAction('automatic', undefined)).toBe('start');
    expect(terminalReloadAction('automatic', false)).toBe('start');
  });

  it('manual + not dormant -> mark dormant, and do not launch (FR-022)', () => {
    expect(terminalReloadAction('manual', undefined)).toBe('mark-dormant');
    expect(terminalReloadAction('manual', false)).toBe('mark-dormant');
  });

  /*
   * FR-028. The user closed a project with terminals deliberately left dormant; reopening it must
   * not undo that decision. This is the rule that makes Manual mode worth having: without it, the
   * twenty terminals come back the first time you switch away and return.
   */
  it('manual + dormant -> stay dormant (FR-028: a switch away and back does not wake it)', () => {
    expect(terminalReloadAction('manual', true)).toBe('stay-dormant');
  });

  /*
   * FR-029a. Switching the preference back to Automatic has to take effect somewhere, and "the
   * next project open" is that somewhere — which is exactly where a dormant Panel gets its chance
   * to start. Without this row, a Panel made dormant under Manual would stay dormant forever.
   */
  it('automatic + dormant -> wake and start (FR-029a: the switch back lands here)', () => {
    expect(terminalReloadAction('automatic', true)).toBe('wake-and-start');
  });

  it('is total — every mode/flag pair yields exactly one of the four actions', () => {
    const seen = new Set<TerminalReloadAction>();
    for (const mode of ['automatic', 'manual'] as const) {
      for (const dormant of [undefined, false, true]) {
        seen.add(terminalReloadAction(mode, dormant));
      }
    }
    // Lexicographic order: 'start' precedes 'stay-dormant' because 'r' < 'y' at the fourth
    // character. Sorted so the assertion does not depend on iteration order of the Set.
    expect([...seen].sort()).toEqual(['mark-dormant', 'start', 'stay-dormant', 'wake-and-start']);
  });
});

describe('what an action implies', () => {
  it('only start and wake-and-start launch a shell (FR-022, FR-026)', () => {
    expect(startsTerminal('start')).toBe(true);
    expect(startsTerminal('wake-and-start')).toBe(true);
    expect(startsTerminal('mark-dormant')).toBe(false);
    expect(startsTerminal('stay-dormant')).toBe(false);
  });

  /*
   * FR-021 again, from the other side. "Observably identical" includes not writing to the workspace
   * layout: a steady state must not churn the file on every project open. `start` is the steady
   * state every existing Panel is in, so it must not change dormancy — otherwise Automatic mode
   * quietly rewrites the layout of every project on open, which is a change even though nothing
   * on screen moves.
   */
  it('only the two TRANSITIONS touch the persisted flag', () => {
    expect(changesDormancy('mark-dormant')).toBe(true);
    expect(changesDormancy('wake-and-start')).toBe(true);
    expect(changesDormancy('start')).toBe(false);
    expect(changesDormancy('stay-dormant')).toBe(false);
  });
});
