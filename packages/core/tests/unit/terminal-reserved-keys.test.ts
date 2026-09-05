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
