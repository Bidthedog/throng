/**
 * SC-021 — every window chord the Shift widening can reach is covered, discovered rather than listed.
 *
 * MIGRATED FROM `packages/ui/tests/e2e/window-chord-resolution.e2e.ts` (034 FR-045).
 *
 * This guard takes no `page`, presses no key and opens no window. It reads `app.tsx`, reads the
 * shipped bindings, and compares two sets of strings — and it was doing that inside a Playwright
 * worker, behind a `beforeAll` that launched Electron, created a project on disk and opened a file in
 * an editor, none of which it used. It is also the test most worth having EARLY: it is what fails
 * when someone adds a window chord on a letter key and covers it nowhere, and finding that out in the
 * unit tier is minutes rather than most of an E2E run.
 *
 * WHAT STAYS END-TO-END: the chords themselves. That a real keystroke reaches a real dispatcher and
 * a real surface responds is the whole point of the sibling spec, and no amount of set comparison
 * substitutes for it. This guard's job is only to make sure that file's list is not quietly short —
 * which is a claim about two files' contents, and is checkable as one.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COVERED,
  COVERED_ELSEWHERE,
  E2E_DIR,
  codeOnly,
  discoverKeepShiftChords,
  handledActions,
  keepsShift,
  keyOf,
  pressesChord,
} from '../shared/window-chords.js';

describe('the window-chord coverage manifest (SC-021)', () => {
  it('parses a real allowlist out of app.tsx', () => {
    // A silently empty parse would make every claim below vacuous — the FR-053a failure mode.
    expect(handledActions().length, 'HANDLED parsed as suspiciously small').toBeGreaterThan(10);
  });

  it('finds chords the widening can actually reach', () => {
    const found = discoverKeepShiftChords();
    expect(found.size, 'no HANDLED action has a Shift-keeping chord — the discovery is broken').
      toBeGreaterThan(5);
    // The chord the widening was made for, by name: if this one stops being discovered, the guard
    // has lost the case that produced it.
    expect(found.get('navigate.quickOpen')).toBeDefined();
  });

  it('covers every discovered chord, and claims none that is no longer reachable', () => {
    const discovered = [...discoverKeepShiftChords().keys()].sort();
    const claimed = [...COVERED.keys(), ...COVERED_ELSEWHERE.keys()].sort();
    const uncovered = discovered.filter((a) => !claimed.includes(a));
    const stale = claimed.filter((a) => !discovered.includes(a));

    expect(
      { uncovered, stale },
      `SC-021: window-chord-resolution.e2e.ts's coverage and app.tsx's HANDLED allowlist disagree.\n` +
        `  uncovered — a window chord on a backtick, function or letter key that the keepShift branch ` +
        `builds the event for, and that nothing presses: ${uncovered.join(', ') || '(none)'}\n` +
        `  stale — covered there but no longer reachable that way, usually a default chord moved to ` +
        `another key: ${stale.join(', ') || '(none)'}\n` +
        `Add a test (or an entry in COVERED_ELSEWHERE naming the spec that has one). A regression in ` +
        `this listener is silent — the chord resolves to null and nothing happens — so an uncovered ` +
        `action is a command that can die without a single test going red.`,
    ).toEqual({ uncovered: [], stale: [] });
  });

  it('holds every exemption to a spec that PRESSES the chord, not one that mentions it', () => {
    expect(COVERED_ELSEWHERE.size, 'no exemptions to check — this test has gone vacuous').
      toBeGreaterThan(0);
    for (const [action, { spec, press: chord }] of COVERED_ELSEWHERE) {
      const path = join(E2E_DIR, spec);
      expect(existsSync(path), `${action} is exempted to ${spec}, which does not exist`).toBe(true);
      expect(
        pressesChord(codeOnly(readFileSync(path, 'utf8')), chord),
        `${action} is exempted to ${spec}, which no longer presses ${chord}. The chord may still be ` +
          `NAMED there — ${spec} explains the guard it needs in prose — but prose is not coverage, so ` +
          `what is looked for is the keystroke: keyboard.press('${chord}'), with comments stripped ` +
          `first. Either restore the press or move ${action} back into the chord spec.`,
      ).toBe(true);
    }
  });

  it('strips comments before looking, so prose about a chord is not coverage of it', () => {
    // The defect this function exists for, stated as a test rather than only as a comment.
    const prose = "/* we press Shift+F10 here */\n// keyboard.press('Shift+F10')\n";
    expect(pressesChord(prose, 'Shift+F10')).toBe(true);
    expect(pressesChord(codeOnly(prose), 'Shift+F10')).toBe(false);
    expect(pressesChord(codeOnly("await win.keyboard.press('Shift+F10');"), 'Shift+F10')).toBe(true);
  });

  it('reads the three keepShift branches the way the dispatcher does', () => {
    expect(keepsShift('`')).toBe(true);
    expect(keepsShift('F11')).toBe(true);
    expect(keepsShift('t')).toBe(true);
    expect(keepsShift('T')).toBe(true);
    // The case the widening did NOT change: a produced character already encodes its Shift.
    expect(keepsShift('+')).toBe(false);
    expect(keyOf('Ctrl+Shift+T')).toBe('T');
    expect(keyOf('Ctrl++')).toBe('+');
  });
});
