/**
 * #164 — a chord throng consumes while a terminal is focused never reaches the shell.
 *
 * Constitution IV states two tiers and says of the shadowable one that the recorded-exception list
 * "is exhaustive". Until now nothing enforced either statement across the shipped set. The only
 * tier check in the suite is `keybindings.test.ts`'s `tabs.openPicker` block, which asserts the
 * tiers for ONE command — so a new binding on `Ctrl+W` would ship green, and #164's own reported
 * chords (`Ctrl+B` / `Ctrl+N`) were only caught because `pane-toggle-defaults.test.ts` names those
 * two literally.
 *
 * This states it over EVERY shipped binding that is live in a terminal, on every platform set, so
 * the rule is enforced by its shape rather than by whichever chords someone thought to list.
 *
 * Scope liveness is `COMMAND_SCOPES[action].has('terminal')` — the same predicate `resolveAction`
 * uses, so "live in a terminal" here means exactly what it means at runtime.
 */
import { describe, it, expect } from 'vitest';
import {
  COMMAND_SCOPES,
  SHIPPED_KEYBINDINGS_BY_PLATFORM,
  normalizeToken,
  type ActionId,
} from '../../src/config/keybindings.js';

/**
 * Constitution IV, reserved tier: dominant terminal meaning, no equivalent by another route.
 * Taking one of these is a defect, not a trade-off.
 */
const RESERVED = ['C', 'D', 'Z', 'A', 'E', 'W', 'U', 'K', 'R', 'L', 'Q'].map((k) => `Ctrl+${k}`);

/**
 * Constitution IV, shadowable tier: the emacs-style motion/edit aliases and flow control. These MAY
 * be taken, but only as a recorded exception.
 */
const SHADOWABLE = ['Ctrl+B', 'Ctrl+F', 'Ctrl+N', 'Ctrl+P', 'Ctrl+H', 'Ctrl+S'];

/**
 * The shadowable chords Constitution IV records as taken, as of v4.4.0. `Ctrl+F5`
 * (`terminal.redraw`) is a recorded exception too but belongs to neither tier — it is a function
 * key, not a line-editor alias — so it is not asserted here.
 *
 * Adding a chord to this array is the deliberate act the constitution asks for: it must be
 * accompanied by an amendment naming what it displaces and why no free chord serves.
 */
const RECORDED_EXCEPTIONS = ['Ctrl+F', 'Ctrl+H', 'Ctrl+S'];

/** Every (platform, action, chord) a terminal would have to give up, over the whole shipped record. */
function terminalLiveChords(): { platform: string; action: string; chord: string }[] {
  const out: { platform: string; action: string; chord: string }[] = [];
  for (const [platform, set] of Object.entries(SHIPPED_KEYBINDINGS_BY_PLATFORM)) {
    for (const [action, tokens] of Object.entries(set?.bindings ?? {})) {
      if (!COMMAND_SCOPES[action as ActionId]?.has('terminal')) continue;
      for (const token of tokens) out.push({ platform, action, chord: normalizeToken(token) });
    }
  }
  return out;
}

describe('terminal keys belong to the terminal (Constitution IV, #164)', () => {
  it('has a shipped record to check, on at least one platform', () => {
    // Without this the three loops below are vacuous and would pass against an empty record.
    expect(terminalLiveChords().length).toBeGreaterThan(0);
  });

  it('takes no chord from the RESERVED tier, in any scope live in a terminal', () => {
    const taken = terminalLiveChords()
      .filter((c) => RESERVED.includes(c.chord))
      .map((c) => `${c.platform}:${c.action}=${c.chord}`);
    expect(taken, 'Constitution IV forbids these outright — a reserved chord has no other route').toEqual([]);
  });

  it('takes exactly the recorded shadowable exceptions, and no others', () => {
    const taken = [
      ...new Set(terminalLiveChords().filter((c) => SHADOWABLE.includes(c.chord)).map((c) => c.chord)),
    ].sort();
    // Equality, not containment: this is the "the list is exhaustive" clause. A new shadowable
    // binding fails here until Constitution IV records it, and a retired one fails until it is
    // removed from RECORDED_EXCEPTIONS — so the code and the constitution cannot drift apart.
    expect(taken).toEqual([...RECORDED_EXCEPTIONS].sort());
  });

  /**
   * 046 T030 (US2, FR-020). The four side-pane commands are EVERYWHERE-scoped, so they are live in
   * a terminal too — this asserts them directly rather than relying only on the discovering sweep
   * above, which is silent about WHICH chords it swept until one actually collides.
   */
  it('the four 046 side-pane chords are in neither the RESERVED nor the SHADOWABLE tier', () => {
    // Read the LIVE chords off the shipped registry rather than hardcoding them a second time here:
    // a hardcoded literal cannot fail when a later rebind of the shipped default drifts onto a
    // reserved or shadowable chord — only reading the real source can catch that.
    const IDS: ActionId[] = ['project.next', 'project.previous', 'focus.explorer', 'focus.projects'];
    const windowsBindings = SHIPPED_KEYBINDINGS_BY_PLATFORM.windows?.bindings ?? {};
    const CHORDS = IDS.flatMap((id) => windowsBindings[id] ?? []).map(normalizeToken);
    expect(CHORDS.length, 'no shipped chords found for the four ids — the loop below would be vacuous').toBeGreaterThan(0);
    for (const chord of CHORDS) {
      expect(RESERVED, `${chord} is in the RESERVED tier`).not.toContain(chord);
      expect(SHADOWABLE, `${chord} is in the SHADOWABLE tier`).not.toContain(chord);
    }
  });

  it('the four 046 side-pane commands are actually live in a terminal, so the check above is not vacuous', () => {
    const IDS: ActionId[] = ['project.next', 'project.previous', 'focus.explorer', 'focus.projects'];
    for (const id of IDS) {
      expect(COMMAND_SCOPES[id]?.has('terminal'), id).toBe(true);
    }
  });

  /**
   * 046 iterate round 1 (FR-109 bullet 3). The whole `Ctrl+Shift+Alt` family FR-102 introduces is
   * BRAND NEW terminal-live territory (`focus.notice`, `project.next`/`previous`, `focus.explorer`,
   * `focus.projects`, `view.toggleProjects`/`toggleExplorer`, and the window zoom trio are all
   * EVERYWHERE). None of it may land in either tier, and the exhaustive exception list — three
   * entries here, `Ctrl+F`/`Ctrl+H`/`Ctrl+S` (`Ctrl+F5` is a function key and sits outside both
   * tiers, per this file's own header comment) — must stay exactly as it is.
   */
  it('takes no Ctrl+Shift+Alt default from the RESERVED or SHADOWABLE tier (FR-109)', () => {
    const taken = terminalLiveChords().filter(
      (c) => c.chord.startsWith('Ctrl+Shift+Alt+') && (RESERVED.includes(c.chord) || SHADOWABLE.includes(c.chord)),
    );
    expect(taken).toEqual([]);
  });

  it('exercises the check above on a real Ctrl+Shift+Alt default, so it is not vacuous', () => {
    const chords = terminalLiveChords().filter((c) => c.chord.startsWith('Ctrl+Shift+Alt+'));
    expect(chords.length).toBeGreaterThan(0);
  });

  /**
   * Review finding MINOR 7 asked whether this should be four, per FR-103/FR-109's "four" — verified
   * NOT a bug: FR-103/FR-109's "four" names the constitutional SHADOWABLE_EXCEPTIONS list
   * (`keybindings.test.ts:132`, `['Ctrl+F', 'Ctrl+H', 'Ctrl+S', 'Ctrl+F5']`), a DIFFERENT list for a
   * DIFFERENT purpose. THIS file's own `RECORDED_EXCEPTIONS`, right above, is deliberately narrower —
   * its header comment already explains why `Ctrl+F5` is excluded from it: a function key, not a
   * line-editor alias, tracked as a shadowable-tier exception only in the other list. The two counts
   * (3 here, 4 there) are both correct for what each one is.
   */
  it('the recorded shadowable-exception list stays at exactly three entries here', () => {
    expect(RECORDED_EXCEPTIONS).toHaveLength(3);
  });

  it('names the owner of each recorded exception, so a silent re-owning is visible', () => {
    const owners = Object.fromEntries(
      RECORDED_EXCEPTIONS.map((chord) => [
        chord,
        [...new Set(terminalLiveChords().filter((c) => c.chord === chord).map((c) => c.action))].sort(),
      ]),
    );
    expect(owners).toEqual({
      'Ctrl+F': ['search.find'],
      'Ctrl+H': ['search.replace'],
      'Ctrl+S': ['editor.save'],
    });
  });
});
