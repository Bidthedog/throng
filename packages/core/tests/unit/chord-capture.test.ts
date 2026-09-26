import { describe, it, expect } from 'vitest';
import {
  captureToken,
  isBindableChord,
  isReservedChord,
  findConflict,
  applyReplace,
  applyReassign,
  applyAdd,
  applyRemove,
  RESERVED_CHORDS,
  EXCLUDED_KEYS,
} from '../../src/config/chord-capture.js';

/** Module scope: shared with the physical-form describe block below (046 T108). */
const ev = (over: Partial<Parameters<typeof captureToken>[0]>) => ({
  key: '',
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  ...over,
});

describe('captureToken', () => {
  it('builds a canonical Ctrl+Shift+Alt+Meta+<key> token, upper-casing a lone letter', () => {
    expect(captureToken(ev({ ctrl: true, key: 'b' }))).toBe('Ctrl+B');
    expect(captureToken(ev({ ctrl: true, shift: true, alt: true, key: 's' }))).toBe('Ctrl+Shift+Alt+S');
    expect(captureToken(ev({ meta: true, key: 'l' }))).toBe('Meta+L');
    expect(captureToken(ev({ ctrl: true, meta: true, key: 'd' }))).toBe('Ctrl+Meta+D');
    expect(captureToken(ev({ key: 'F2' }))).toBe('F2');
  });

  it('canonicalises the spacebar so Alt+Space matches the reserved denylist (FR-032a)', () => {
    expect(captureToken(ev({ alt: true, key: ' ' }))).toBe('Alt+Space');
    expect(isReservedChord(captureToken(ev({ alt: true, key: ' ' })))).toBe(true);
  });

  it('never treats a held modifier key as the chord key', () => {
    expect(captureToken(ev({ ctrl: true, key: 'Control' }))).toBe('Ctrl');
    expect(captureToken(ev({ meta: true, key: 'Meta' }))).toBe('Meta');
    expect(captureToken(ev({ shift: true, key: 'Shift' }))).toBe('Shift');
  });
});

/**
 * 046 iterate round 1 (T108, FR-104, FR-105) — the PHYSICAL and SAME-BINDING canonical forms.
 *
 * `captureToken` builds its token from `key` alone today, so a non-US layout's PRODUCED character
 * would be captured verbatim rather than the portable physical token FR-104 requires — the same
 * defect FR-026/R2 fixed for the digit row, extended to the whole tier-1 family and to the `+`/`-`/
 * `0` same-binding rule (FR-105). `captureToken` has no `code` parameter yet, so every case here is
 * RED until T112 adds it.
 */
describe('captureToken — the physical & same-binding canonical forms (FR-104, FR-105)', () => {
  it('Ctrl+Shift+Alt held records the PHYSICAL letter, whatever the layout produced', () => {
    // AZERTY's KeyM produces "," (R22) — the physical form is still Ctrl+Shift+Alt+M.
    expect(captureToken(ev({ ctrl: true, shift: true, alt: true, key: ',', code: 'KeyM' }))).toBe(
      'Ctrl+Shift+Alt+M',
    );
  });

  it('Ctrl+Shift+Alt held records the PHYSICAL digit, not the produced character', () => {
    expect(captureToken(ev({ ctrl: true, shift: true, alt: true, key: ')', code: 'Digit0' }))).toBe(
      'Ctrl+Shift+Alt+0',
    );
  });

  it('Polish AltGr+Shift+N ("Ń") records Ctrl+Shift+Alt+N, not the fourth-level character', () => {
    expect(captureToken(ev({ ctrl: true, shift: true, alt: true, key: 'Ń', code: 'KeyN' }))).toBe(
      'Ctrl+Shift+Alt+N',
    );
  });

  it('the keypad + and the main-row + record the SAME token under Ctrl+Alt (FR-105)', () => {
    expect(captureToken(ev({ ctrl: true, alt: true, key: '+', code: 'NumpadAdd' }))).toBe('Ctrl+Alt++');
    expect(captureToken(ev({ ctrl: true, alt: true, key: '=', code: 'Equal' }))).toBe('Ctrl+Alt++');
  });

  it('the keypad - records the main-row token too', () => {
    expect(captureToken(ev({ ctrl: true, alt: true, key: '-', code: 'NumpadSubtract' }))).toBe('Ctrl+Alt+-');
  });

  /**
   * 046 iterate round 2 (FR-114) — the maintainer's own words, mid-build: "The 'Zoom Reset' key
   * bindings need to use the numpad zero, NOT the 0 key." The keypad 0 no longer folds onto the
   * main-row token under Ctrl+Alt: it records its OWN literal `Numpad0` key segment, matching
   * `panel.zoomReset`'s shipped default.
   */
  it('the keypad 0 records its OWN Numpad0 key segment, not the main-row 0 (FR-114)', () => {
    expect(captureToken(ev({ ctrl: true, alt: true, key: '0', code: 'Numpad0' }))).toBe('Ctrl+Alt+Numpad0');
  });

  /**
   * 046 iterate round 2 (FR-114) narrowed this claim: `Ctrl+Alt+Numpad0` (no Shift) DOES now record
   * a `Numpad…` segment — see the dedicated case above. What still holds, and is asserted here, is
   * every combination that does NOT reach the Ctrl+Alt-without-Shift same-binding rule at all: Ctrl
   * alone never hits it (no `code`-based rule applies), and neither does Ctrl+Shift (the tier-1 rule
   * needs Alt too), so both fall through to the produced-character form, which never spells the code.
   */
  it('never records a Numpad… key segment outside the Ctrl+Alt-without-Shift same-binding rule', () => {
    expect(captureToken(ev({ ctrl: true, key: '+', code: 'NumpadAdd' }))).not.toMatch(/Numpad/);
    expect(captureToken(ev({ ctrl: true, shift: true, key: '0', code: 'Numpad0' }))).not.toMatch(/Numpad/);
  });

  it('with no code at all, the existing produced-character form stands (backward compatible)', () => {
    expect(captureToken(ev({ ctrl: true, key: 'b' }))).toBe('Ctrl+B');
  });
});

/**
 * Review finding (CRITICAL on 34d06dac): the Ctrl+Alt-without-Shift same-binding rule (FR-105)
 * matched the `Equal`/`Minus` CODE regardless of what the layout actually produced. On Windows,
 * AltGr is reported by Chromium as Ctrl+Alt together (R22), so a German AltGr+ß (physical `Minus`,
 * produces `\`), an AZERTY AltGr+= (produces `}`), and similar combinations were wrongly folded onto
 * `Ctrl+Alt++` / `Ctrl+Alt+-` instead of their own produced character — contradicting FR-104's own
 * rule that "a chord with Ctrl and Alt but no Shift stays on the produced character" and FR-105's own
 * wording, which scopes the exception to when the produced character genuinely IS the plain symbol
 * ("the produced =").
 */
describe('captureToken — the FR-105 same-binding guard against an AltGr false positive', () => {
  it('Ctrl+Alt+Minus is NOT folded to "-" when AltGr produced a different character (German ß → \\)', () => {
    expect(captureToken(ev({ ctrl: true, alt: true, key: '\\', code: 'Minus' }))).toBe('Ctrl+Alt+\\');
  });

  it('Ctrl+Alt+Equal is NOT folded to "+" when AltGr produced a different character (AZERTY-style)', () => {
    expect(captureToken(ev({ ctrl: true, alt: true, key: '}', code: 'Equal' }))).toBe('Ctrl+Alt+}');
  });

  it('the GENUINE (non-AltGr) Ctrl+Alt+= and Ctrl+Alt+- still record the same-binding token', () => {
    // These are the cases FR-105 names explicitly ("the produced ="): the produced character IS the
    // plain symbol, so the guard must still let them through.
    expect(captureToken(ev({ ctrl: true, alt: true, key: '=', code: 'Equal' }))).toBe('Ctrl+Alt++');
    expect(captureToken(ev({ ctrl: true, alt: true, key: '-', code: 'Minus' }))).toBe('Ctrl+Alt+-');
  });

  it('the keypad + and - stay safe regardless of the produced key (no AltGr on the numeric keypad)', () => {
    expect(captureToken(ev({ ctrl: true, alt: true, key: '+', code: 'NumpadAdd' }))).toBe('Ctrl+Alt++');
    expect(captureToken(ev({ ctrl: true, alt: true, key: '-', code: 'NumpadSubtract' }))).toBe('Ctrl+Alt+-');
  });

  /**
   * 046 iterate round 2 (FR-114) inverts this case. Before this round, `Numpad0` folded to `'0'`
   * ONLY when `key` was genuinely `'0'` — precisely so a NumLock-off press (key `"Insert"`) did NOT
   * get folded to a binding that was never meant to include it. Now that `panel.zoomReset` ships
   * `Numpad0` as its OWN literal token, that guard has nothing left to protect: every Numpad0 press,
   * NumLock on or off, IS genuinely a Numpad0 press, and `code` alone says so.
   */
  it('Numpad0 with NumLock off (key "Insert") still folds to Numpad0, matched on code alone (FR-114)', () => {
    // Renderer parity: chord-key.ts's same-binding rule reuses this exact function, so it agrees.
    expect(captureToken(ev({ ctrl: true, alt: true, key: 'Insert', code: 'Numpad0' }))).toBe(
      'Ctrl+Alt+Numpad0',
    );
  });
});

/**
 * 046 FR-120 (T189) — Windows hides a held Shift on the keypad while NumLock is ON. Measured with
 * `SendInput` scan codes into Electron 44.4.3 (research R22, "T149 follow-up"): Ctrl+Shift+Alt+Numpad0
 * arrives as `{ code Numpad0, key "Insert", shift false }` with NumLock on, after a synthesised Shift
 * key-up. The capture modal must record the chord the user PRESSED, `Ctrl+Shift+Alt+Numpad0`.
 */
describe('captureToken — the NumLock-ON keypad hides Shift (046 FR-120)', () => {
  it('NumLock ON, key "Insert", shift false records Ctrl+Shift+Alt+Numpad0', () => {
    expect(
      captureToken(ev({ ctrl: true, alt: true, key: 'Insert', code: 'Numpad0', numLock: true })),
    ).toBe('Ctrl+Shift+Alt+Numpad0');
  });

  it('NumLock ON, key "0" (a genuine Ctrl+Alt press) still records Ctrl+Alt+Numpad0', () => {
    expect(captureToken(ev({ ctrl: true, alt: true, key: '0', code: 'Numpad0', numLock: true }))).toBe(
      'Ctrl+Alt+Numpad0',
    );
  });

  it('NumLock OFF, key "Insert", shift false (a genuine Ctrl+Alt press) still records Ctrl+Alt+Numpad0', () => {
    expect(
      captureToken(ev({ ctrl: true, alt: true, key: 'Insert', code: 'Numpad0', numLock: false })),
    ).toBe('Ctrl+Alt+Numpad0');
  });

  it('NumLock OFF, key "Insert", shift true records Ctrl+Shift+Alt+Numpad0, as it always has', () => {
    expect(
      captureToken(ev({ ctrl: true, shift: true, alt: true, key: 'Insert', code: 'Numpad0', numLock: false })),
    ).toBe('Ctrl+Shift+Alt+Numpad0');
  });

  it('another keypad digit follows the same rule — NumLock ON, Numpad5 reporting "Clear"', () => {
    expect(captureToken(ev({ ctrl: true, key: 'Clear', code: 'Numpad5', numLock: true }))).toBe(
      'Ctrl+Shift+Clear',
    );
  });

  it('with no NumLock state given, behaviour is exactly what it was', () => {
    expect(captureToken(ev({ ctrl: true, alt: true, key: 'Insert', code: 'Numpad0' }))).toBe(
      'Ctrl+Alt+Numpad0',
    );
  });
});

/**
 * Review finding (34d06dac): `tier1PhysicalKey` fell through to the raw `code` for anything outside
 * its letter/digit/+-/0 cases — wrong for the physical backtick (should alias to the backtick
 * character, as `chordKey` already does for the single-stroke path) and for a NumLock-off keypad key
 * (`Numpad4` etc.), which produced a literal `Ctrl+Shift+Alt+Numpad4` token — a `Numpad…` token,
 * which FR-105 says must NEVER be emitted, recorded or shipped, for any chord.
 */
describe('captureToken — tier-1 physical mapping, the backtick and keypad edge cases', () => {
  it('the physical backtick key records the backtick, whatever the layout produced', () => {
    expect(captureToken(ev({ ctrl: true, shift: true, alt: true, key: '~', code: 'Backquote' }))).toBe(
      'Ctrl+Shift+Alt+`',
    );
  });

  it('a keypad key with NumLock off records its NAMED key, never a Numpad… token (FR-105)', () => {
    expect(
      captureToken(ev({ ctrl: true, shift: true, alt: true, key: 'ArrowLeft', code: 'Numpad4' })),
    ).toBe('Ctrl+Shift+Alt+ArrowLeft');
  });

  it('the physical Minus key records "-" under tier-1 even though Shift makes a US keyboard produce "_" (fix round)', () => {
    // sameBindingSymbolOfCode's AltGr guard (only accepting the un-Shifted "-") is reused here by
    // tier1PhysicalKey — but tier-1 ALWAYS holds Shift, so a guard that did not also accept the
    // Shift-held production would read every genuine Ctrl+Shift+Alt+Minus press as an AltGr mismatch
    // and fall back to the raw code, emitting "Ctrl+Shift+Alt+Minus" instead of the "-" every other
    // Minus-shaped chord (the Equal/NumpadAdd/NumpadSubtract siblings, and rule 1b's own Ctrl+Alt+-)
    // already resolves to.
    expect(captureToken(ev({ ctrl: true, shift: true, alt: true, key: '_', code: 'Minus' }))).toBe(
      'Ctrl+Shift+Alt+-',
    );
  });
});

describe('isBindableChord (FR-033a: any single non-excluded key)', () => {
  it('accepts modifier chords AND bare single keys', () => {
    expect(isBindableChord('Ctrl+B')).toBe(true);
    expect(isBindableChord('Ctrl+Shift+Alt+S')).toBe(true);
    expect(isBindableChord('Ctrl++')).toBe(true);
    // single keys are now bindable (reverses the old modifier-minimum)
    expect(isBindableChord('A')).toBe(true);
    expect(isBindableChord('F2')).toBe(true);
  });

  it('rejects lone modifiers and the excluded keys', () => {
    expect(isBindableChord('Ctrl')).toBe(false);
    expect(isBindableChord('Meta')).toBe(false);
    expect(isBindableChord('Ctrl+Shift')).toBe(false);
    // excluded single keys (FR-033a): Esc/Space/Shift/Ctrl/Enter/CapsLock/NumLock
    for (const k of EXCLUDED_KEYS) expect(isBindableChord(k), k).toBe(false);
    expect(isBindableChord('Escape')).toBe(false);
    expect(isBindableChord('Space')).toBe(false);
    expect(isBindableChord('Enter')).toBe(false);
    expect(isBindableChord('CapsLock')).toBe(false);
    expect(isBindableChord('NumLock')).toBe(false);
  });

  it('BINDS Tab and Shift+Tab — 016 freed them, because indent/outdent need them (F1)', () => {
    // They left EXCLUDED_KEYS deliberately. `Tab` is `editor.indentLines`' default and every code
    // editor uses it; while it was excluded, two of the seven commands were unrebindable and the
    // shipped default was itself uncapturable. The exclusion existed to protect focus traversal,
    // and FR-017f's focus guard now protects that directly — while a find bar or any other
    // transient input has focus, Tab moves within it and never reaches the document.
    expect(EXCLUDED_KEYS.has('Tab')).toBe(false);
    expect(isBindableChord('Tab')).toBe(true);
    expect(isBindableChord('Shift+Tab')).toBe(true);
  });

  it('an excluded key IS bindable when combined with a modifier (modifier combos allowed)', () => {
    // The exclusion is for a key bound ALONE; with a modifier it's a normal combo.
    expect(isBindableChord('Ctrl+Space')).toBe(true);
    expect(isBindableChord('Ctrl+Enter')).toBe(true);
    expect(isBindableChord('Shift+Space')).toBe(true);
  });
});

describe('isReservedChord (FR-032a: OS/window-control denylist)', () => {
  it('flags the curated reserved combinations', () => {
    for (const t of RESERVED_CHORDS) expect(isReservedChord(t), t).toBe(true);
    expect(isReservedChord('Ctrl+Alt+Delete')).toBe(true);
    expect(isReservedChord('Alt+F4')).toBe(true);
    expect(isReservedChord('Alt+Tab')).toBe(true);
    expect(isReservedChord('Alt+Space')).toBe(true);
    expect(isReservedChord('Ctrl+Shift+Escape')).toBe(true);
  });

  it('flags any chord whose only modifier is Meta/Super', () => {
    expect(isReservedChord('Meta+L')).toBe(true);
    expect(isReservedChord('Meta+D')).toBe(true);
    expect(isReservedChord('Meta+Tab')).toBe(true);
  });

  it('passes ordinary bindable chords, incl. Meta combined with another modifier', () => {
    expect(isReservedChord('Ctrl+S')).toBe(false);
    expect(isReservedChord('Ctrl+B')).toBe(false);
    expect(isReservedChord('Ctrl+Meta+L')).toBe(false);
    expect(isReservedChord('Ctrl+Shift+P')).toBe(false);
  });
});

describe('findConflict is SCOPE-AWARE (016, FR-017b1)', () => {
  const bindings = {
    'editor.cutLine': ['Ctrl+X'], // {editor}
    'file.cut': ['Ctrl+X'], // {explorer}
    'editor.indentLines': ['Tab'], // {editor}
  };

  it('does NOT flag a chord shared by commands whose scopes are DISJOINT', () => {
    // The headline coexistence: Ctrl+X cuts a LINE in an editor and a FILE in the tree. Warning
    // about this would train the user to dismiss the warning that matters.
    expect(findConflict(bindings, 'Ctrl+X', 'editor.cutLine')).toBeNull();
    expect(findConflict(bindings, 'Ctrl+X', 'file.cut')).toBeNull();
  });

  it('DOES flag a chord whose commands are live in a common context', () => {
    // Rebinding indent to Ctrl+X would put two commands on one chord inside the editor — a real
    // clash, and 007's warn → Reassign/Cancel flow must still fire. A scope-aware check that
    // wrongly said "no conflict" here would silently reintroduce last-writer-wins.
    expect(findConflict(bindings, 'Ctrl+X', 'editor.indentLines')).toBe('editor.cutLine');
  });
});

describe('findConflict (FR-034)', () => {
  const bindings = { 'editor.save': ['Ctrl+S'], 'editor.saveAll': ['Ctrl+Shift+S'] };

  it('finds another action bound to the token', () => {
    expect(findConflict(bindings, 'Ctrl+S', 'editor.saveAs')).toBe('editor.save');
  });

  it('excludes the action being edited (rebinding to its own chord is no conflict)', () => {
    expect(findConflict(bindings, 'Ctrl+S', 'editor.save')).toBeNull();
  });

  it('returns null when the token is unbound', () => {
    expect(findConflict(bindings, 'Ctrl+K', 'editor.saveAs')).toBeNull();
  });

  it('matches case-insensitively via normalisation', () => {
    expect(findConflict(bindings, 'Ctrl+s', 'editor.saveAs')).toBe('editor.save');
  });
});

/**
 * Branch-review finding (spec 046, FR-092) — the MISSING direction of the two-stroke first-stroke
 * collision. `editor.toggleWordWrap` ships `Ctrl+E W`; capturing the plain single-stroke `Ctrl+E`
 * for a DIFFERENT, intersecting-scope command used to save silently (`findConflict` only compared
 * tokens for EXACT equality, and `Ctrl+E` never equals `Ctrl+E W`), leaving `Ctrl+E` genuinely
 * ambiguous between "fire the new command now" and "wait for editor.toggleWordWrap's second
 * stroke". `chordCollisions` (keybindings.ts) already catches this shape from the OTHER direction —
 * a NEW two-stroke's first stroke against an EXISTING whole single-stroke chord — via its
 * `singleStrokeOwners` pass; this is that same rule, reused for the direction `chordCollisions`
 * does not need to check at capture time (nothing is saved yet to enumerate).
 */
describe('findConflict also catches a single-stroke capture that IS another chord’s first stroke (FR-092)', () => {
  const bindings = { 'editor.toggleWordWrap': ['Ctrl+E,W'] }; // FR-124's comma form
  const scopes = {
    'editor.toggleWordWrap': new Set(['editor'] as const),
    'editor.save': new Set(['editor'] as const),
    'file.rename': new Set(['explorer'] as const),
  } as unknown as import('../../src/config/keybindings.js').CommandScopes;

  it('flags Ctrl+E as a conflict when it is the first stroke of an intersecting-scope two-stroke chord', () => {
    expect(findConflict(bindings, 'Ctrl+E', 'editor.save', scopes)).toBe('editor.toggleWordWrap');
  });

  it('does NOT flag it when the scopes are disjoint (the two-stroke never fires there)', () => {
    expect(findConflict(bindings, 'Ctrl+E', 'file.rename', scopes)).toBeNull();
  });

  it('does not flag a COMPLETED two-stroke capture merely sharing a first stroke (that is legitimate)', () => {
    // Two DIFFERENT two-stroke bindings sharing a first stroke disambiguate on the second stroke —
    // not a clash, the same rule chordCollisions already applies to a saved bindings map.
    expect(findConflict(bindings, 'Ctrl+E X', 'editor.save', scopes)).toBeNull();
  });

  it('the fifth (checkPrefixOfOthers=false) argument suppresses this direction — for arming a NEW first stroke', () => {
    // armFirstStroke (capture-modal.tsx) captures the modal's OWN forming two-stroke's first stroke,
    // which legitimately shares a prefix with someone else's two-stroke chord (see the case above);
    // it must not be refused just because it also happens to equal one.
    expect(findConflict(bindings, 'Ctrl+E', 'editor.save', scopes, false)).toBeNull();
  });

  it('folds through sameBindingToken, the same as chordCollisions (FR-105)', () => {
    const numpadBindings = { 'editor.toggleWordWrap': ['Ctrl+E NumpadAdd'] };
    // Capturing the bare "Ctrl+E" collides with a two-stroke whose first stroke is unaffected by the
    // fold here (only the SECOND stroke differs) — restated as a positive control that folding does
    // not accidentally break the ordinary first-stroke match.
    expect(findConflict(numpadBindings, 'Ctrl+E', 'editor.save', scopes)).toBe('editor.toggleWordWrap');
  });
});

describe('applyReplace / applyReassign (FR-033/034)', () => {
  it('applyReplace sets the action to exactly the captured token, others untouched, original unmutated', () => {
    const bindings = { 'editor.save': ['Ctrl+S', 'Ctrl+K'], 'file.copy': ['Ctrl+C'] };
    const next = applyReplace(bindings, 'editor.save', 'Ctrl+W');
    expect(next['editor.save']).toEqual(['Ctrl+W']);
    expect(next['file.copy']).toEqual(['Ctrl+C']);
    expect(bindings['editor.save']).toEqual(['Ctrl+S', 'Ctrl+K']); // original intact
  });

  it('applyReassign removes the token from the other action then ADDS it here (keeps existing)', () => {
    const bindings = { 'editor.save': ['Ctrl+S'], 'file.copy': ['Ctrl+C'] };
    const next = applyReassign(bindings, 'editor.save', 'file.copy', 'Ctrl+S');
    expect(next['editor.save']).toEqual([]); // removed from the previous owner
    expect(next['file.copy']).toEqual(['Ctrl+C', 'Ctrl+S']); // appended, existing kept
  });
});

describe('applyAdd / applyRemove (FR-033/033b: multiple chords per action)', () => {
  it('applyAdd appends a chord, leaving existing ones in place', () => {
    const bindings = { 'view.toggleProjects': ['Ctrl+B'] };
    const next = applyAdd(bindings, 'view.toggleProjects', 'Ctrl+K');
    expect(next['view.toggleProjects']).toEqual(['Ctrl+B', 'Ctrl+K']);
    expect(bindings['view.toggleProjects']).toEqual(['Ctrl+B']); // original intact
  });

  it('applyAdd is a no-op when the identical chord already exists (dedup)', () => {
    const bindings = { 'view.toggleProjects': ['Ctrl+B'] };
    const next = applyAdd(bindings, 'view.toggleProjects', 'Ctrl+b'); // case-insensitive
    expect(next['view.toggleProjects']).toEqual(['Ctrl+B']);
  });

  it('applyAdd seeds an action that had no bindings', () => {
    const next = applyAdd({ 'file.rename': [] }, 'file.rename', 'F2');
    expect(next['file.rename']).toEqual(['F2']);
  });

  it('applyRemove removes just the given chord, keeping the rest', () => {
    const bindings = { 'view.toggleProjects': ['Ctrl+B', 'Ctrl+K'] };
    const next = applyRemove(bindings, 'view.toggleProjects', 'Ctrl+B');
    expect(next['view.toggleProjects']).toEqual(['Ctrl+K']);
    expect(bindings['view.toggleProjects']).toEqual(['Ctrl+B', 'Ctrl+K']); // original intact
  });
});
