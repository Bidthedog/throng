/**
 * 057 FR-099 — the view never forwards xterm's own focus reports; the daemon is the one source.
 *
 * A tab or project switch unmounts the view, so the view's reports could never be complete; the daemon
 * reports from main's attendance instead. Two sources would tell the program twice, and the view's half
 * is the one 028 already had to gate because xterm answers a re-asserted 1004 with a report when focus
 * never moved.
 *
 * Layer: unit — the decision is a pure predicate over the bytes xterm hands to `onData`, and
 * `use-terminal.ts` drops on it (pinned below, since no harness here drives a live xterm).
 *
 * ANTI-VACUITY CONTROL: make `isFocusReport` also match `ESC [ I` with a modifier, or a keystroke, and the
 * keystroke cases fail; drop its use from `use-terminal.ts` and the source pin fails.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isFocusReport } from '../../src/renderer/terminal/focus-reports.js';

const ESC = String.fromCharCode(27);

describe('isFocusReport (FR-099)', () => {
  it('matches exactly the two focus reports', () => {
    expect(isFocusReport(`${ESC}[I`)).toBe(true);
    expect(isFocusReport(`${ESC}[O`)).toBe(true);
  });

  it('matches nothing a user types, or another report', () => {
    for (const data of ['I', 'O', `${ESC}`, `${ESC}[A`, `${ESC}OA`, `${ESC}[I${ESC}[O`, `x${ESC}[I`, `${ESC}[?1;2c`, `${ESC}[<0;3;4M`]) {
      expect(isFocusReport(data), JSON.stringify(data)).toBe(false);
    }
  });
});

describe('the view drops them', () => {
  const source = readFileSync(resolve(__dirname, '../../src/renderer/terminal/use-terminal.ts'), 'utf8');

  it('returns before writing when onData hands it a focus report, with no other condition', () => {
    expect(source).toMatch(/term\.onData\(\(data\) => \{\s*(?:\/\/[^\n]*\n\s*)*if \(isFocusReport\(data\)\) return;/);
  });

  it('no longer carries the 028 gate the daemon replaced', () => {
    expect(source).not.toMatch(/realFocusChange/);
  });
});
