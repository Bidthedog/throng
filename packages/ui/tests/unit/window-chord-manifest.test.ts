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
import { DEFAULT_KEYBINDINGS, shippedBindingsFor } from '@throng/core';
import { resolveKeydown } from '../../src/renderer/config/chord-key.js';
import { resolveScoped } from '../../src/renderer/keybindings/scope.js';
import { chordEventOnLayout, type Layout } from '../shared/chord-event.js';
import {
  COMPONENT_DIR,
  COVERED,
  COVERED_ELSEWHERE,
  COVERED_IN_COMPONENT,
  E2E_DIR,
  chordEvent,
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
    const claimed = [...COVERED.keys(), ...COVERED_ELSEWHERE.keys(), ...COVERED_IN_COMPONENT.keys()].sort();
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

  it('holds every component claim to a test that presses the key with its modifiers (044 US7b)', () => {
    expect(COVERED_IN_COMPONENT.size, 'no component claims to check — this test has gone vacuous').toBeGreaterThan(0);
    for (const [action, { test, key, mods }] of COVERED_IN_COMPONENT) {
      const path = join(COMPONENT_DIR, test);
      expect(existsSync(path), `${action} is claimed by ${test}, which does not exist`).toBe(true);
      const code = codeOnly(readFileSync(path, 'utf8'));
      /*
       * A press is the key's literal beside EXACTLY the modifiers it needs, on one line of code — not
       * merely those modifiers PLUS whatever else. Fix round 2, item 3: the loose form (every required
       * mod present, nothing said about the rest) let an EXTRA-modifier press satisfy a claim that
       * named fewer — `{ key: 'ArrowLeft', ctrlKey: true, altKey: true }` (`focus.left`'s firing shape)
       * also has `'ArrowLeft'` and `altKey: true` on one line, which is all `navigate.back`'s claim
       * (`mods: ['altKey']`) checked for; and `{ key: 'ArrowLeft', altKey: true, shiftKey: true }`
       * (the column-select must-NOT-fire shape) matches the same way. With only one matching line
       * required (`.some`), deleting `navigate.back`'s own firing press left either of THOSE lines to
       * satisfy the check anyway — a coverage claim that had stopped being true still read as covered.
       * So a candidate line is rejected if it carries any OTHER recognised modifier as `true` that
       * `mods` does not name — the exact set, not a subset.
       */
      const ALL_MODS = ['ctrlKey', 'altKey', 'shiftKey', 'metaKey'] as const;
      const pressed = code
        .split('\n')
        .some(
          (line) =>
            line.includes(`'${key}'`) &&
            mods.every((mod) => new RegExp(String.raw`\b${mod}: true`).test(line)) &&
            ALL_MODS.filter((mod) => !mods.includes(mod)).every(
              (extra) => !new RegExp(String.raw`\b${extra}: true`).test(line),
            ),
        );
      expect(pressed, `${action} is claimed by ${test}, which no longer presses ${key} with EXACTLY ${mods.join(' + ')}`).toBe(true);
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
    // 044 US7b — an arrow key's name encodes no Shift, so the dispatcher keeps it.
    expect(keepsShift('ArrowLeft')).toBe(true);
    expect(keyOf('Ctrl+Shift+T')).toBe('T');
    expect(keyOf('Ctrl++')).toBe('+');
  });

  it('reads the physical digit branch through chordCandidates itself (046 T044, FR-026)', () => {
    // Ctrl+digit keeps Shift now — the physical token.
    expect(keepsShift('0')).toBe(true);
    /*
     * 046 iterate round 1 (T111) — `keepsShift` always forces Shift on when it builds its probe
     * event, so `{ altKey: true }` here is Ctrl+Alt+SHIFT+0 — the tier-1 rule's own shape, not R2's
     * Ctrl+Alt-WITHOUT-Shift AltGr exclusion (chord-candidates.test.ts's "German AltGr+0" case, which
     * holds Alt without Shift and is unaffected). Before T111 this combination matched nothing
     * physically and fell through to the produced token, which does not keep Shift; now it IS the
     * tier-1 rule, which always names Shift explicitly.
     */
    expect(keepsShift('0', { altKey: true })).toBe(true);
    // The builder reports what a real US keyboard does: the produced `)` AND the physical Digit0.
    expect(chordEvent('Ctrl+Shift+0')).toMatchObject({ key: ')', code: 'Digit0', ctrlKey: true, shiftKey: true, altKey: false });
    expect(chordEvent('Ctrl+0')).toMatchObject({ key: '0', code: 'Digit0', shiftKey: false });
    expect(chordEvent('Ctrl++')).toMatchObject({ key: '+', code: 'Equal' });
    /*
     * 046 iterate round 1 (T106) — `zoom.reset`'s shipped default moved to the tier-1
     * `Ctrl+Shift+Alt+0` (FR-102), so this is the token the manifest now discovers, not the
     * pre-round `Ctrl+Shift+0` (#390, retired by FR-107). Digit0 with Alt held excludes RULE 1's
     * Ctrl-without-Alt candidate, so this only comes back once T111 adds the tier-1 rule — before
     * that, `zoom.reset` drops out of `discoverKeepShiftChords()` entirely, which is exactly the
     * `stale` failure the "covers every discovered chord" test above reports until then.
     *
     * 046 iterate round 2 (FR-114) moved the chord again, to `Ctrl+Shift+Alt+Numpad0` — the
     * maintainer's own words, mid-build: "The 'Zoom Reset' key bindings need to use the numpad zero,
     * NOT the 0 key." The discovery mechanism is unchanged; only the literal it now finds is.
     */
    expect(discoverKeepShiftChords().get('zoom.reset')).toContain('Ctrl+Shift+Alt+Numpad0');
  });

  /**
   * 046 iterate round 1 (T106, FR-109 bullet 1) — every `Ctrl+Shift+Alt` default this window's
   * dispatcher HANDLES resolves through it on all five R22 layouts, using the exact expression the
   * dispatcher itself uses (`resolveKeydown` over `resolveScoped`) — this file's own domain, rather
   * than the general discovery `renderer-chord-resolvers.test.ts` performs across every call site.
   */
  describe('every HANDLED Ctrl+Shift+Alt default resolves on all five layouts (FR-109 bullet 1)', () => {
    const LAYOUTS: Layout[] = ['US', 'UK', 'German', 'French', 'Polish'];
    const NO_TABS = { tabs: [], activeTabId: null };

    const tier1Handled = handledActions()
      .map((action) => ({ action, chords: (shippedBindingsFor().bindings[action] ?? []) as string[] }))
      .flatMap(({ action, chords }) =>
        chords
          .filter((chord) => /^Ctrl\+Shift\+Alt\+/.test(chord))
          .map((chord) => ({ action, chord, code: chordEvent(chord).code })),
      );

    it('finds HANDLED tier-1 defaults to check — the discovery is not vacuous', () => {
      expect(tier1Handled.length, 'no HANDLED action ships a Ctrl+Shift+Alt default').toBeGreaterThan(5);
    });

    for (const { action, chord, code } of tier1Handled) {
      for (const layout of LAYOUTS) {
        it(`${action} (${chord}) resolves on the ${layout} layout`, () => {
          const e = chordEventOnLayout(layout, code, { ctrlKey: true, shiftKey: true, altKey: true });
          const resolved = resolveKeydown(e, (ev) =>
            resolveScoped(DEFAULT_KEYBINDINGS, ev, NO_TABS, { transientFocus: false }),
          );
          expect(resolved).toBe(action);
        });
      }
    }
  });
});
