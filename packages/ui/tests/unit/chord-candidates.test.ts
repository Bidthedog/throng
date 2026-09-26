/**
 * The layout-independent key CANDIDATES for a keyboard chord (046 FR-021, FR-026, R2).
 *
 * `chordKey` already normalises one physical key (Backquote) to its produced character, because the
 * PRODUCED character is what every chord match is keyed on — and that is wrong for the digit row.
 * `zoom.reset`'s Windows default is `Ctrl+Shift+0`, matched today by the character a US layout
 * produces (`)`), which is a different symbol on every other layout — and on some (German, French
 * AZERTY) AltGr on the digit row produces a symbol with no relationship to the digit at all.
 *
 * `chordCandidates(e)` widens matching to try the PHYSICAL digit first, so `Ctrl+Shift+0` resolves
 * on every layout the produced-character match already covered, plus every layout it did not — while
 * never matching a symbol AltGr typed on purpose (Alt excludes the digit candidate: rule 2 is Alt
 * held out of the reserved `Ctrl+Alt+0` = `panel.zoomReset`, unchanged) and never colliding with it.
 *
 * Every case below is [contracts/keybindings-and-focus.md](../../../../specs/046-side-panes-and-project-list/contracts/keybindings-and-focus.md)
 * §2's own example table — this test presses the contract's cases, it does not invent its own.
 *
 * `chordCandidates` is not exported yet (it lands with T013, beside `chordKey`), so every case here
 * fails at the import boundary until it does — the RED this file is for.
 */
import { describe, expect, it } from 'vitest';
import { chordCandidates } from '../../src/renderer/config/chord-key.js';
import { chordEventOnLayout, DEAD_KEY, type Layout } from '../shared/chord-event.js';

/** The subset of a native `KeyboardEvent` that `chordCandidates` reads. */
interface KeyEventLike {
  code: string;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const ev = (
  code: string,
  key: string,
  mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {},
): KeyEventLike => ({
  code,
  key,
  ctrlKey: mods.ctrl ?? false,
  altKey: mods.alt ?? false,
  shiftKey: mods.shift ?? false,
});

describe('chordCandidates — the contract’s own example table (keybindings-and-focus.md §2)', () => {
  it('US Ctrl+Shift+0 (`)`/Digit0) — the physical digit first, the produced token second', () => {
    expect(chordCandidates(ev('Digit0', ')', { ctrl: true, shift: true }))).toEqual([
      'Ctrl+Shift+0',
      'Ctrl+)',
    ]);
  });

  it('US Ctrl+0 (`0`/Digit0) — digit and produced token coincide, so duplicates collapse to one', () => {
    expect(chordCandidates(ev('Digit0', '0', { ctrl: true }))).toEqual(['Ctrl+0']);
  });

  it('US Ctrl+Shift+= (`+`/Equal) — not a digit code, so only the produced token is a candidate', () => {
    expect(chordCandidates(ev('Equal', '+', { ctrl: true, shift: true }))).toEqual(['Ctrl++']);
  });

  it('Swiss DE Ctrl+Shift+1 (`+`/Digit1) — the physical digit candidate, then the produced Ctrl++', () => {
    expect(chordCandidates(ev('Digit1', '+', { ctrl: true, shift: true }))).toEqual([
      'Ctrl+Shift+1',
      'Ctrl++',
    ]);
  });

  it('Czech Ctrl+Digit1 (`+`/Digit1) — physical digit with no Shift held, produced token still Ctrl++', () => {
    expect(chordCandidates(ev('Digit1', '+', { ctrl: true }))).toEqual(['Ctrl+1', 'Ctrl++']);
  });

  it('German Ctrl+ß (`ß`/Minus) — the Minus key is not a digit code, so nothing is added', () => {
    expect(chordCandidates(ev('Minus', 'ß', { ctrl: true }))).toEqual(['Ctrl+ß']);
  });

  it('German AltGr+0 (`}`/Digit0, Ctrl+Alt) — Alt excludes the digit candidate; `}` is typed', () => {
    expect(chordCandidates(ev('Digit0', '}', { ctrl: true, alt: true }))).toEqual(['Ctrl+Alt+}']);
  });

  it('AZERTY AltGr+à (`@`/Digit0, Ctrl+Alt) — the same Alt exclusion, a different typed symbol', () => {
    expect(chordCandidates(ev('Digit0', '@', { ctrl: true, alt: true }))).toEqual(['Ctrl+Alt+@']);
  });

  it('US Ctrl+Alt+0 (`0`/Digit0, Ctrl+Alt) — Alt excludes the digit candidate; panel.zoomReset is unaffected', () => {
    expect(chordCandidates(ev('Digit0', '0', { ctrl: true, alt: true }))).toEqual(['Ctrl+Alt+0']);
  });

  /**
   * 046 iterate round 2 (FR-114) — rule 2's `Numpad0` case used to alias `Digit0`'s candidate
   * (FR-105's pre-round-2 "no Numpad… token" rule), so a genuine `0`-producing keypad press folded
   * onto the SAME single candidate the produced-token rule (rule 3) also built, `Ctrl+0`. It no
   * longer does: the physical-digit candidate is now `Ctrl+Numpad0`, a DIFFERENT string from rule
   * 3's produced-token candidate (still `Ctrl+0`, built from `e.key`, unaffected by this change) — so
   * both now survive the dedup, physical first.
   */
  it('US Ctrl+Numpad0 (no Alt) — the physical digit rule now names Numpad0 itself, not the main-row 0', () => {
    expect(chordCandidates(ev('Numpad0', '0', { ctrl: true }))).toEqual(['Ctrl+Numpad0', 'Ctrl+0']);
  });

  it('US-Intl Ctrl+Alt+P (`ö`/KeyP, Ctrl+Alt) — not a digit code at all; only the produced token', () => {
    expect(chordCandidates(ev('KeyP', 'ö', { ctrl: true, alt: true }))).toEqual(['Ctrl+Alt+ö']);
  });
});

describe('chordCandidates — the two structural rules (§2.3)', () => {
  it('removes duplicates rather than returning the same token twice', () => {
    // US Ctrl+0: the digit rule and the produced-token rule build the identical string.
    const candidates = chordCandidates(ev('Digit0', '0', { ctrl: true }));
    expect(candidates).toHaveLength(new Set(candidates).size);
    expect(candidates).toEqual(['Ctrl+0']);
  });

  it('puts the physical digit token FIRST, ahead of the produced token, whenever both exist', () => {
    const candidates = chordCandidates(ev('Digit1', '+', { ctrl: true, shift: true }));
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toBe('Ctrl+Shift+1');
    expect(candidates[1]).toBe('Ctrl++');
  });
});

/**
 * 046 iterate round 1 (T105) — the TIER-1 physical rule (FR-104), ahead of the digit rule above.
 *
 * `Ctrl+Shift+Alt+<key>` is now the whole navigation/application tier (FR-101, FR-102), matched on
 * `e.code` rather than the produced character, for the reason the digit rule above exists for
 * `Ctrl+Shift+0`: a non-US layout can put a different character on the same physical key, and a
 * chord matched on the produced character silently stops resolving there. Every case is
 * [contracts/keybindings-and-focus.md](../../../../specs/046-side-panes-and-project-list/contracts/keybindings-and-focus.md)
 * §4's own rule 1 and R22's own layout findings — this test presses the contract's cases, it does
 * not invent new ones.
 *
 * `chordCandidates` has no tier-1 branch yet (only rule 1's Ctrl-without-Alt digit match and rule 2's
 * produced token exist), so every case below is RED until T111 adds it.
 */
describe('chordCandidates — the tier-1 physical rule, Ctrl+Shift+Alt (FR-104, contracts §4)', () => {
  it('KeyA–KeyZ resolve to the letter, on the US layout', () => {
    for (const letter of ['B', 'F', 'M', 'N', 'P', 'T']) {
      const e = chordEventOnLayout('US', `Key${letter}`, { ctrlKey: true, shiftKey: true, altKey: true });
      expect(chordCandidates(e), letter).toEqual([`Ctrl+Shift+Alt+${letter}`]);
    }
  });

  it('Digit0–Digit9 resolve to the digit', () => {
    for (let d = 0; d <= 9; d += 1) {
      const e = chordEventOnLayout('US', `Digit${d}`, { ctrlKey: true, shiftKey: true, altKey: true });
      expect(chordCandidates(e), String(d)).toEqual([`Ctrl+Shift+Alt+${d}`]);
    }
  });

  it('Equal and NumpadAdd both resolve to +, the SAME binding (FR-105)', () => {
    const main = chordEventOnLayout('US', 'Equal', { ctrlKey: true, shiftKey: true, altKey: true });
    const pad = chordEventOnLayout('US', 'NumpadAdd', { ctrlKey: true, shiftKey: true, altKey: true });
    expect(chordCandidates(main)).toEqual(['Ctrl+Shift+Alt++']);
    expect(chordCandidates(pad)).toEqual(['Ctrl+Shift+Alt++']);
  });

  it('Minus and NumpadSubtract both resolve to -, the SAME binding (FR-105)', () => {
    const main = chordEventOnLayout('US', 'Minus', { ctrlKey: true, shiftKey: true, altKey: true });
    const pad = chordEventOnLayout('US', 'NumpadSubtract', { ctrlKey: true, shiftKey: true, altKey: true });
    expect(chordCandidates(main)).toEqual(['Ctrl+Shift+Alt+-']);
    expect(chordCandidates(pad)).toEqual(['Ctrl+Shift+Alt+-']);
  });

  /**
   * 046 iterate round 2 (FR-114) — the maintainer's own words, mid-build: "The 'Zoom Reset' key
   * bindings need to use the numpad zero, NOT the 0 key." `zoom.reset`'s shipped chord is now
   * `Ctrl+Shift+Alt+Numpad0` literally, so `Numpad0` must resolve to ITS OWN candidate — never
   * folded onto `0` — MATCHED ON PHYSICAL CODE ALONE, regardless of what `key` a NumLock-on or
   * NumLock-off keypad happens to report. Before this round the fold was guarded on `key === '0'`,
   * which was right while the target genuinely was `0`; now there is nothing left to guard against a
   * false positive on, since every Numpad0 press is genuinely a Numpad0 press.
   */
  it('Numpad0 resolves to Numpad0 when the produced key is 0 — code decides, not key', () => {
    // Built directly: a synthetic shape (key "0" with Shift reported), kept to prove `key` plays no
    // part once `code` is Numpad0. 046 FR-120 measured what a real keyboard sends; see below.
    const genuine = { key: '0', code: 'Numpad0', ctrlKey: true, shiftKey: true, altKey: true, metaKey: false };
    expect(chordCandidates(genuine)).toEqual(['Ctrl+Shift+Alt+Numpad0']);
  });

  it('Numpad0 resolves to Numpad0 too when it reports "Insert" with Shift — the NumLock-OFF shape (core parity)', () => {
    // `Insert` with `shiftKey` true is what a real keyboard reports for Shift+Numpad0 with NumLock
    // OFF (046 FR-120, measured): the physical code never changes, and neither does what it resolves
    // to — `sameBindingSymbolOfCode` (packages/core/src/config/chord-capture.ts) matches `Numpad0` on
    // `code` alone, so the renderer and core agree on this physical key.
    const e = chordEventOnLayout('US', 'Numpad0', { ctrlKey: true, shiftKey: true, altKey: true, numLock: false });
    expect(e.key).toBe('Insert');
    expect(e.shiftKey).toBe(true);
    expect(chordCandidates(e)).toEqual(['Ctrl+Shift+Alt+Numpad0']);
  });

  /*
   * 046 FR-120 (T189) — the NumLock-ON shape, as measured on Windows: Shift held inverts the pad to
   * its navigation key AND is hidden from the event, so the tier-1 press reports as Ctrl+Alt. It must
   * still name the chord the user pressed.
   */
  it('NumLock ON: Ctrl+Shift+Alt+Numpad0 (key "Insert", shiftKey false) yields Ctrl+Shift+Alt+Numpad0', () => {
    const e = chordEventOnLayout('US', 'Numpad0', { ctrlKey: true, shiftKey: true, altKey: true, numLock: true });
    expect(e).toMatchObject({ key: 'Insert', shiftKey: false }); // the builder reports the measured shape
    expect(chordCandidates(e)).toEqual(['Ctrl+Shift+Alt+Numpad0']);
  });

  it('NumLock ON: a genuine Ctrl+Alt+Numpad0 (key "0") still yields Ctrl+Alt+Numpad0', () => {
    const e = chordEventOnLayout('US', 'Numpad0', { ctrlKey: true, altKey: true, numLock: true });
    expect(e.key).toBe('0');
    expect(chordCandidates(e)).toEqual(['Ctrl+Alt+Numpad0']);
  });

  it('NumLock OFF: a genuine Ctrl+Alt+Numpad0 (key "Insert", shiftKey false) still yields Ctrl+Alt+Numpad0', () => {
    const e = chordEventOnLayout('US', 'Numpad0', { ctrlKey: true, altKey: true, numLock: false });
    expect(e).toMatchObject({ key: 'Insert', shiftKey: false });
    expect(chordCandidates(e)).toEqual(['Ctrl+Alt+Numpad0']);
  });

  it('the main-row Digit0 is unaffected — it still builds its own Ctrl+Shift+Alt+0 candidate (FR-114 narrows only Numpad0)', () => {
    const e = { key: ')', code: 'Digit0', ctrlKey: true, shiftKey: true, altKey: true, metaKey: false };
    expect(chordCandidates(e)).toEqual(['Ctrl+Shift+Alt+0']);
  });

  it('the physical backtick aliases to ` in tier-1, same as the single-stroke path (fix round MINOR)', () => {
    const e = chordEventOnLayout('US', 'Backquote', { ctrlKey: true, shiftKey: true, altKey: true });
    expect(chordCandidates(e)).toEqual(['Ctrl+Shift+Alt+`']);
  });

  it('a NumLock-off keypad key (code Numpad4, key ArrowLeft) resolves to its NAMED key, never a Numpad… token (fix round MINOR)', () => {
    const e = chordEventOnLayout('US', 'Numpad4', { ctrlKey: true, shiftKey: true, altKey: true });
    expect(e.key).toBe('ArrowLeft'); // NumLock off: the keypad reports its navigation name
    expect(chordCandidates(e)).toEqual(['Ctrl+Shift+Alt+ArrowLeft']);
  });

  it('arrow keys and PageDown resolve to their name', () => {
    for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageDown']) {
      const e = chordEventOnLayout('US', code, { ctrlKey: true, shiftKey: true, altKey: true });
      expect(chordCandidates(e), code).toEqual([`Ctrl+Shift+Alt+${code}`]);
    }
  });

  it('produces exactly ONE candidate for a tier-1 event — the produced token is not also emitted', () => {
    const e = chordEventOnLayout('US', 'KeyM', { ctrlKey: true, shiftKey: true, altKey: true });
    expect(chordCandidates(e)).toHaveLength(1);
  });

  it('metaKey held DECLINES a tier-1 match, so the Office key (Ctrl+Shift+Alt+Win) resolves no chord', () => {
    const e = chordEventOnLayout('US', 'KeyM', {
      ctrlKey: true,
      shiftKey: true,
      altKey: true,
      metaKey: true,
    });
    expect(chordCandidates(e)).not.toContain('Ctrl+Shift+Alt+M');
  });

  it('German AltGr+0 still yields no chord under the tier-1 rule too (R2 unchanged) — "}" types', () => {
    // Ctrl+Alt WITHOUT Shift is tier 2, not tier 1, and R2's Alt exclusion for the digit candidate
    // still applies: the tier-1 rule (Ctrl+Shift+Alt) must not somehow widen this case.
    const e = chordEventOnLayout('German', 'Digit0', { ctrlKey: true, altKey: true });
    expect(e.key).toBe('}');
    expect(chordCandidates(e)).toEqual(['Ctrl+Alt+}']);
  });

  /**
   * The layout table itself (T105): every layout produces a DIFFERENT character for at least one
   * physical key this feature binds, and the physical rule must resolve the SAME token regardless.
   */
  describe('the same physical key resolves the same tier-1 token on every layout (R22)', () => {
    const layouts: Layout[] = ['US', 'UK', 'German', 'French', 'Polish'];

    it('KeyM — AZERTY produces "," there, every other layout produces "m"/"M"', () => {
      for (const layout of layouts) {
        const e = chordEventOnLayout(layout, 'KeyM', { ctrlKey: true, shiftKey: true, altKey: true });
        expect(chordCandidates(e), layout).toEqual(['Ctrl+Shift+Alt+M']);
      }
    });

    it('Polish AltGr+Shift+N produces "Ń" — the physical match still resolves Ctrl+Shift+Alt+N', () => {
      // AltGr is Ctrl+Alt held together (Chromium on Windows), so a tier-1 press (Ctrl+Shift+Alt) IS
      // simultaneously "AltGr+Shift" on the Polish layout — the one fourth-level collision R22 found
      // among the six tier-1 bound letters (B, F, M, N, P, T). 046 iterate round 3 (FR-117) re-letters
      // the set to B, J, K, M, N, T, V; J, K and V add no loss, so this stays the only one (R22).
      const e = chordEventOnLayout('Polish', 'KeyN', { ctrlKey: true, shiftKey: true, altKey: true });
      expect(e.key).toBe('Ń');
      expect(chordCandidates(e)).toEqual(['Ctrl+Shift+Alt+N']);
    });

    it('a dead key (no character composed yet) still resolves on its physical code', () => {
      // A physical key can produce NOTHING on keydown — an accent key waiting for the next
      // keystroke — and the chord must still fire from where the finger is, not from what (if
      // anything) the key will eventually compose.
      const e = { key: DEAD_KEY, code: 'KeyF', ctrlKey: true, shiftKey: true, altKey: true, metaKey: false };
      expect(chordCandidates(e)).toEqual(['Ctrl+Shift+Alt+F']);
    });
  });
});

/**
 * 046 iterate round 1 (T105) — the `+`/`-`/`0` same-binding rule OUTSIDE tier 1 (FR-105).
 *
 * `panel.zoomIn`'s only shipped chord is `Ctrl+Alt++` (FR-102), and on a US or UK keyboard the `+`
 * key IS the `=` key — pressing "Ctrl+Alt and the + key" without a keypad produces Ctrl+Alt+`=`
 * (unshifted). Without this rule `panel.zoomIn` has no keyboard route on those layouts without a
 * physical keypad (contracts §4, FR-105's own worked example).
 */
describe('chordCandidates — Ctrl+Alt++ matches the = key unshifted, and the keypad + (FR-105)', () => {
  it('Ctrl+Alt on the = key WITHOUT Shift resolves Ctrl+Alt++, not Ctrl+Alt+=', () => {
    const e = chordEventOnLayout('US', 'Equal', { ctrlKey: true, altKey: true });
    expect(e.key).toBe('=');
    expect(chordCandidates(e)).toEqual(['Ctrl+Alt++']);
  });

  it('Ctrl+Alt+NumpadAdd resolves the SAME token, Ctrl+Alt++', () => {
    const e = chordEventOnLayout('US', 'NumpadAdd', { ctrlKey: true, altKey: true });
    expect(chordCandidates(e)).toEqual(['Ctrl+Alt++']);
  });
});

/**
 * Fix round CRITICAL (review of T111) — the Ctrl+Alt-without-Shift same-binding rule (FR-105) must
 * be guarded by the PRODUCED key, not fire on the physical Equal/Minus code alone.
 *
 * On Windows, AltGr is reported by Chromium as Ctrl+Alt held together (R22) — so a German AltGr+ß
 * (physical `Minus`, produces `\`) and an AZERTY AltGr+= (physical `Equal`, produces `}`) both arrive
 * at rule 1b's gate looking exactly like the panel.zoomOut / panel.zoomIn chord it exists to match. An
 * unguarded code-only match folds either onto `Ctrl+Alt+-` / `Ctrl+Alt++`, `preventDefault`s the
 * keystroke in the window listener, and the character never reaches the focused terminal or editor —
 * a real typing regression, not merely a mismatch. Core already fixed the identical shape in
 * `chord-capture.ts`'s `sameBindingSymbolOfCode`, guarding the match against the produced `key`; this
 * is that same guard, reused rather than re-derived.
 */
describe('chordCandidates — Ctrl+Alt+/- declines an AltGr combination the produced key does not match (fix round CRITICAL)', () => {
  // Built directly rather than through chordEventOnLayout('German'/'French', …): that shared table's
  // own AltGr branch (`altGr && shiftKey ? altGrShift ?? altGr : …`) is keyed on `ctrlKey && altKey`
  // ALONE, so an override added there for the unshifted AltGr case here would ALSO fire for a tier-1
  // (Ctrl+Shift+Alt) event on the SAME code — which is exactly what adding one here first did, and it
  // broke `renderer-chord-resolvers.test.ts` / `window-chord-manifest.test.ts`'s existing tier-1
  // Equal/Minus cases on French/German (they observed a raw `Ctrl+Shift+Alt+Equal`/`…+Minus` instead
  // of `…++`/`…+-`). A raw literal is what these two real-world characters need without that risk.
  it('German AltGr+ß (physical Minus, produces \\) does NOT resolve Ctrl+Alt+-', () => {
    const e = { key: '\\', code: 'Minus', ctrlKey: true, altKey: true, shiftKey: false, metaKey: false };
    expect(chordCandidates(e)).toEqual(['Ctrl+Alt+\\']);
  });

  it('AZERTY AltGr+= (physical Equal, produces }) does NOT resolve Ctrl+Alt++', () => {
    const e = { key: '}', code: 'Equal', ctrlKey: true, altKey: true, shiftKey: false, metaKey: false };
    expect(chordCandidates(e)).toEqual(['Ctrl+Alt+}']);
  });

  it('a genuine Ctrl+Alt+Minus press (no AltGr) still resolves Ctrl+Alt+- — the guard is not blanket', () => {
    // Same code, produced key genuinely '-': a real Ctrl+Alt+Minus press, not AltGr (which types ß or \).
    const usShaped = { key: '-', code: 'Minus', ctrlKey: true, altKey: true, shiftKey: false, metaKey: false };
    expect(chordCandidates(usShaped)).toEqual(['Ctrl+Alt+-']);
  });
});
