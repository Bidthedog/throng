/**
 * 046 iterate round 1 (FR-091, FR-092) — two-stroke chord tokens.
 *
 * A binding token may now be `<stroke> <stroke>` (`Ctrl+E W`), space-separated. Constitution IV
 * v5.6.0's multi-stroke exception is what makes `editor.toggleWordWrap` reachable at all once
 * `Ctrl+Alt+W` moves to the Ctrl+Shift+Alt navigation tier and Ctrl+Alt+W is no longer free — `Ctrl+E`
 * is the reserved prefix the constitution grants for exactly this. The RULES: the first stroke must
 * carry a modifier (a bare first stroke would swallow ordinary typing the moment it becomes a prefix
 * key), the second may be bare, a two-stroke binding is never legal on a command live in a terminal
 * (contracts/keybindings-and-focus.md §4), and a two-stroke binding's first stroke collides with
 * anything ELSE bound to that exact chord in an intersecting scope — pressing it would be ambiguous
 * between "fire now" and "wait for the second stroke".
 */
import { describe, expect, it } from 'vitest';
import {
  chordCollisions,
  isTwoStrokeToken,
  isValidTwoStrokeFirstStroke,
  isValidTwoStrokeToken,
  normalizeToken,
  parseKeybindings,
  parseTwoStroke,
  twoStrokeTerminalViolations,
  type CommandScopes,
} from '../../src/config/keybindings.js';
import { buildShippedDefaults, resetBindingValue } from '../../src/config/shipped-defaults.js';

describe('two-stroke chord tokens (FR-091, FR-092)', () => {
  describe('parsing, formatting and normalising as ONE binding of two strokes', () => {
    it('isTwoStrokeToken recognises a space-separated pair and rejects a plain chord', () => {
      expect(isTwoStrokeToken('Ctrl+E W')).toBe(true);
      expect(isTwoStrokeToken('Ctrl+E,W')).toBe(true); // FR-124's comma form
      expect(isTwoStrokeToken('Ctrl+Alt+W')).toBe(false);
      expect(isTwoStrokeToken('F2')).toBe(false);
    });

    it('parseTwoStroke splits it into its two strokes', () => {
      // Re-pinned for FR-124: the strokes as physically pressed — Ctrl is still held for W.
      expect(parseTwoStroke('Ctrl+E,W')).toEqual(['Ctrl+E', 'Ctrl+W']);
      expect(parseTwoStroke('Ctrl+E W')).toEqual(['Ctrl+E', 'Ctrl+W']);
    });

    it('normalizeToken normalises EACH stroke and keeps it one binding', () => {
      // A lone-letter key segment is upper-cased on either side of the space, exactly as a
      // single-stroke token is normalised today.
      // Re-pinned for FR-124: the normal form is the comma form.
      expect(normalizeToken('Ctrl+e w')).toBe('Ctrl+E,W');
    });

    // Re-pinned for FR-126: a three-key chord is legal; parseTwoStroke still reads only two, and the
    // refusal moves to four keys.
    it('a four-stroke token is refused — parseTwoStroke reads only two, isValidTwoStrokeToken refuses four', () => {
      expect(parseTwoStroke('Ctrl+E W X')).toBeNull();
      expect(isValidTwoStrokeToken('Ctrl+E W X Y')).toBe(false);
    });
  });

  describe('the modifier rule', () => {
    it('the first stroke MUST carry a modifier', () => {
      expect(isValidTwoStrokeToken('Ctrl+E W')).toBe(true);
      expect(isValidTwoStrokeToken('E W')).toBe(false);
    });

    it('the second stroke MAY be bare', () => {
      expect(isValidTwoStrokeToken('Ctrl+E W')).toBe(true);
      expect(isValidTwoStrokeToken('Ctrl+E Ctrl+W')).toBe(true);
    });

    it('rejects a single-stroke token (nothing to validate as two strokes)', () => {
      expect(isValidTwoStrokeToken('Ctrl+Alt+W')).toBe(false);
    });

    /**
     * Review finding MINOR 8: a stroke that is JUST a modifier name — a real event `captureTwoStrokeToken`
     * can build when the second key of a capture was itself a bare modifier press (its own `key` was
     * "Control"/"Shift"/etc, so no distinguishing key ever got appended) — carries no real key at all
     * and must never be accepted as a two-stroke binding.
     */
    it('rejects a modifier-only second stroke — a bare Ctrl/Shift/Alt/Meta press is not a key', () => {
      expect(isValidTwoStrokeToken('Ctrl+E Ctrl')).toBe(false);
      expect(isValidTwoStrokeToken('Ctrl+E Shift')).toBe(false);
      expect(isValidTwoStrokeToken('Ctrl+E Alt')).toBe(false);
    });

    it('rejects a keyless first stroke — modifiers with no key after them', () => {
      expect(isValidTwoStrokeToken('Ctrl+Alt+ W')).toBe(false);
      expect(isValidTwoStrokeToken('Ctrl+Shift W')).toBe(false);
    });
  });

  /**
   * Review finding CRITICAL 2 (on c0d85941, capture-modal.tsx's two-stroke capture): the modal held
   * a bare first stroke pending with no modifier check at all, so pressing "e" then "w" while armed
   * saved a modifier-less first stroke, violating FR-092 and hijacking every plain "e" in the editor.
   * `isValidTwoStrokeFirstStroke` is the check a capture UI runs on the FIRST stroke alone, before it
   * is ever held pending — the same modifier rule {@link isValidTwoStrokeToken} already applies to a
   * complete token's first half.
   */
  describe('isValidTwoStrokeFirstStroke (FR-092, review finding CRITICAL 2)', () => {
    it('accepts a modified first stroke', () => {
      expect(isValidTwoStrokeFirstStroke('Ctrl+E')).toBe(true);
      expect(isValidTwoStrokeFirstStroke('Ctrl+Alt+B')).toBe(true);
    });

    it('rejects a bare key — no modifier', () => {
      expect(isValidTwoStrokeFirstStroke('E')).toBe(false);
    });

    it('rejects a keyless stroke — modifiers with nothing after them', () => {
      expect(isValidTwoStrokeFirstStroke('Ctrl+Alt+')).toBe(false);
    });

    it('rejects a bare modifier name', () => {
      expect(isValidTwoStrokeFirstStroke('Ctrl')).toBe(false);
    });
  });

  describe('chordCollisions reports a first stroke that doubles as a whole single-stroke chord (FR-092)', () => {
    it('flags the clash when the two live in an intersecting scope', () => {
      const bindings = { 'editor.toggleWordWrap': ['Ctrl+E W'], 'editor.saveAs': ['Ctrl+E'] };
      const scopes = {
        'editor.toggleWordWrap': new Set(['editor'] as const),
        'editor.saveAs': new Set(['editor'] as const),
      } as unknown as CommandScopes;
      const clashes = chordCollisions(bindings, scopes);
      expect(clashes).toHaveLength(1);
      expect(clashes[0].token).toBe('Ctrl+E');
      expect([...clashes[0].actions].sort()).toEqual(['editor.saveAs', 'editor.toggleWordWrap']);
    });

    it('is silent when the scopes are disjoint', () => {
      const bindings = { 'editor.toggleWordWrap': ['Ctrl+E W'], 'file.rename': ['Ctrl+E'] };
      const scopes = {
        'editor.toggleWordWrap': new Set(['editor'] as const),
        'file.rename': new Set(['explorer'] as const),
      } as unknown as CommandScopes;
      expect(chordCollisions(bindings, scopes)).toEqual([]);
    });

    it('does not itself collide when nothing else claims the first stroke', () => {
      const bindings = { 'editor.toggleWordWrap': ['Ctrl+E W'] };
      const scopes = {
        'editor.toggleWordWrap': new Set(['editor'] as const),
      } as unknown as CommandScopes;
      expect(chordCollisions(bindings, scopes)).toEqual([]);
    });

    /**
     * Review finding MINOR 9: two DIFFERENT two-stroke bindings sharing the same first stroke is a
     * legitimate, ordinary prefix share — pressing `Ctrl+E` waits for a second stroke either way,
     * and the second stroke is what disambiguates which command fires. It must never be reported as
     * a clash; only a first stroke that doubles as some OTHER command's WHOLE single-stroke chord is
     * genuinely ambiguous (the case above).
     */
    it('does NOT flag two two-stroke bindings that merely share a first stroke', () => {
      const bindings = { 'editor.toggleWordWrap': ['Ctrl+E W'], 'editor.cutLine': ['Ctrl+E X'] };
      const scopes = {
        'editor.toggleWordWrap': new Set(['editor'] as const),
        'editor.cutLine': new Set(['editor'] as const),
      } as unknown as CommandScopes;
      expect(chordCollisions(bindings, scopes)).toEqual([]);
    });

    it('still flags a genuine whole-token clash between two IDENTICAL two-stroke bindings', () => {
      const bindings = { 'editor.toggleWordWrap': ['Ctrl+E W'], 'editor.cutLine': ['Ctrl+E W'] };
      const scopes = {
        'editor.toggleWordWrap': new Set(['editor'] as const),
        'editor.cutLine': new Set(['editor'] as const),
      } as unknown as CommandScopes;
      const clashes = chordCollisions(bindings, scopes);
      expect(clashes).toHaveLength(1);
      expect(clashes[0].token).toBe('Ctrl+E,W'); // re-pinned for FR-124 (comma form)
    });

    it('treats a doubled space between strokes as the same binding as a single space', () => {
      expect(normalizeToken('Ctrl+E  W')).toBe(normalizeToken('Ctrl+E W'));
      const bindings = { 'editor.toggleWordWrap': ['Ctrl+E  W'], 'editor.cutLine': ['Ctrl+E W'] };
      const scopes = {
        'editor.toggleWordWrap': new Set(['editor'] as const),
        'editor.cutLine': new Set(['editor'] as const),
      } as unknown as CommandScopes;
      const clashes = chordCollisions(bindings, scopes);
      expect(clashes).toHaveLength(1);
      expect(clashes[0].token).toBe('Ctrl+E,W'); // re-pinned for FR-124 (comma form)
    });
  });

  describe('validation refuses a two-stroke chord on any command live in a terminal', () => {
    it('reports the violation', () => {
      const bindings = { 'terminal.redraw': ['Ctrl+E W'], 'editor.save': ['Ctrl+S'] };
      const scopes = {
        'terminal.redraw': new Set(['terminal'] as const),
        'editor.save': new Set(['editor', 'terminal'] as const),
      } as unknown as CommandScopes;
      expect(twoStrokeTerminalViolations(bindings, scopes)).toEqual([
        { action: 'terminal.redraw', token: 'Ctrl+E W' },
      ]);
    });

    it('is silent for a command whose scope never includes terminal', () => {
      const bindings = { 'editor.toggleWordWrap': ['Ctrl+E W'] };
      const scopes = {
        'editor.toggleWordWrap': new Set(['editor'] as const),
      } as unknown as CommandScopes;
      expect(twoStrokeTerminalViolations(bindings, scopes)).toEqual([]);
    });

    it('the LIVE shipped registry has no such violation once T099 lands (SHIPPED, exercised here)', () => {
      // `editor.toggleWordWrap` is EDITOR_ONLY (never live in a terminal), which is the whole reason
      // it, and not some other command, was given the two-stroke chord.
      const shipped = buildShippedDefaults();
      expect(twoStrokeTerminalViolations(shipped.keybindings.bindings)).toEqual([]);
    });
  });

  describe('reset-to-default treats the two strokes as one binding', () => {
    it('resetBindingValue restores the whole two-stroke token in one piece', () => {
      const shipped = buildShippedDefaults();
      const overridden = { version: 1, bindings: { ...shipped.keybindings.bindings, 'editor.toggleWordWrap': ['Ctrl+Alt+Z'] } };
      const restored = resetBindingValue(overridden, 'editor.toggleWordWrap');
      expect(restored?.bindings['editor.toggleWordWrap']).toEqual(
        shipped.keybindings.bindings['editor.toggleWordWrap'],
      );
      // It is ONE array entry, not two — proving the reset did not split the stroke pair apart.
      expect(restored?.bindings['editor.toggleWordWrap']).toHaveLength(1);
    });
  });

  /**
   * Review finding MINOR 4: isValidTwoStrokeToken / twoStrokeTerminalViolations existed but were
   * never called from production code, so a hand-edited keybindings.json could carry a malformed
   * two-stroke token ("E W", "Ctrl+E W X", "Ctrl+E Ctrl") or a two-stroke chord on a terminal-live
   * command, and it would sit there silently doing nothing — never firing, never reported, and
   * indistinguishable from a typo the user has no way to notice. `parseKeybindings`'s own doc
   * comment already promises "Invalid binding entries are dropped; never throws" for a non-string
   * entry; a structurally invalid two-stroke token is the same kind of invalid entry.
   */
  describe('parseKeybindings drops an invalid two-stroke entry (FR-092, MINOR 4)', () => {
    it('drops a malformed two-stroke shape (bare first stroke)', () => {
      const parsed = parseKeybindings({ bindings: { 'editor.toggleWordWrap': ['E W'] } });
      expect(parsed.bindings['editor.toggleWordWrap']).not.toContain('E W');
    });

    it('drops a three-stroke token', () => {
      // Re-pinned for FR-126: four keys, since three are now one legal binding.
      const parsed = parseKeybindings({ bindings: { 'editor.toggleWordWrap': ['Ctrl+E W X Y'] } });
      expect(parsed.bindings['editor.toggleWordWrap'].some((t) => t.includes('Y'))).toBe(false);
    });

    it('drops a modifier-only second stroke', () => {
      const parsed = parseKeybindings({ bindings: { 'editor.toggleWordWrap': ['Ctrl+E Ctrl'] } });
      expect(parsed.bindings['editor.toggleWordWrap']).not.toContain('Ctrl+E Ctrl');
    });

    it('keeps a VALID two-stroke entry alongside an invalid one in the same array', () => {
      const parsed = parseKeybindings({
        bindings: { 'editor.toggleWordWrap': ['Ctrl+E W', 'E W'] },
      });
      // Re-pinned for FR-124: a saved legacy space form reads as its comma form.
      expect(parsed.bindings['editor.toggleWordWrap']).toEqual(['Ctrl+E,W']);
    });

    it('drops a two-stroke entry on a command whose scope includes terminal, even if well-formed', () => {
      // `terminal.redraw` is TERMINAL_ONLY — a two-stroke chord there is never legal (FR-092),
      // whatever its own shape.
      const parsed = parseKeybindings({ bindings: { 'terminal.redraw': ['Ctrl+E W'] } });
      expect(parsed.bindings['terminal.redraw']).not.toContain('Ctrl+E W');
    });

    it('never throws on any of these — the file loads with the bad entry simply absent', () => {
      expect(() =>
        parseKeybindings({ bindings: { 'editor.toggleWordWrap': ['E W', 'Ctrl+E W X', 'Ctrl+E Ctrl'] } }),
      ).not.toThrow();
    });
  });
});
