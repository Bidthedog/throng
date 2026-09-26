/**
 * 046 iterate round 5 (FR-124, SC-020) — the `Mods+K1,K2` two-stroke token.
 *
 * A two-stroke chord is one continuous press: hold the modifiers, press the first key, then the
 * second, the modifiers still held. It is written `Mods+K1,K2` (`Ctrl+E,W`), and a stored token is
 * read into the two strokes AS PHYSICALLY PRESSED: the first `Mods+K1`, the second `Mods+K2` — the
 * first's modifiers plus any the second adds (`Ctrl+E,Shift+W` is Ctrl+E then Ctrl+Shift+W). The
 * comma separates strokes except where it is itself a stroke's key, as `+` is in `Ctrl++`. A saved
 * space-separated token (written only by unreleased 046 builds) reads as its comma form.
 *
 * Supersedes round 1's space-separated token (FR-091) as the saved and displayed form.
 */
import { describe, expect, it } from 'vitest';
import {
  chordCollisions,
  formatTwoStroke,
  isTwoStrokeToken,
  isValidTwoStrokeToken,
  normalizeToken,
  parseKeybindings,
  parseTwoStroke,
  sameBindingToken,
  type CommandScopes,
} from '../../src/config/keybindings.js';
import { captureChordToken, captureTwoStrokeToken, findConflict } from '../../src/config/chord-capture.js';
import { planKeybindingsUpgrade } from '../../src/config/shipped-defaults.js';
import * as keybindings from '../../src/config/keybindings.js';

/**
 * 046 iterate round 6 (FR-126, SC-021, T218) — up to THREE keys under the held modifiers:
 * `Mods+K1,K2,K3` (`Ctrl+E,W,Q`), one continuous press. Every later key is read against the FIRST
 * stroke's modifiers, still held, plus any it adds itself. A shorter chord that is a prefix of a
 * longer one in an intersecting scope is a collision; four keys are refused.
 */
describe('the Mods+K1,K2,K3 three-key chord (FR-126)', () => {
  const { formatChord, parseChordStrokes } = keybindings;

  it('Ctrl+E,W,Q parses into Ctrl+E, Ctrl+W, Ctrl+Q — the physical strokes', () => {
    expect(parseChordStrokes('Ctrl+E,W,Q')).toEqual(['Ctrl+E', 'Ctrl+W', 'Ctrl+Q']);
  });

  it('an added modifier belongs to its own key only: Ctrl+E,Shift+W,Q is Ctrl+E, Ctrl+Shift+W, Ctrl+Q', () => {
    expect(parseChordStrokes('Ctrl+E,Shift+W,Q')).toEqual(['Ctrl+E', 'Ctrl+Shift+W', 'Ctrl+Q']);
  });

  it('reads one and two keys too, and refuses four', () => {
    expect(parseChordStrokes('Ctrl+E')).toEqual(['Ctrl+E']);
    expect(parseChordStrokes('Ctrl+E,W')).toEqual(['Ctrl+E', 'Ctrl+W']);
    expect(parseChordStrokes('Ctrl+E,W,Q,R')).toBeNull();
  });

  it('formats back: formatChord of the physical strokes is Ctrl+E,W,Q', () => {
    expect(formatChord(['Ctrl+E', 'Ctrl+W', 'Ctrl+Q'])).toBe('Ctrl+E,W,Q');
    expect(formatChord(['Ctrl+E', 'Ctrl+Shift+W', 'Ctrl+Q'])).toBe('Ctrl+E,Shift+W,Q');
    expect(parseChordStrokes(formatChord(['Ctrl+,', 'Ctrl+W', 'Ctrl++']) ?? '')).toEqual(['Ctrl+,', 'Ctrl+W', 'Ctrl++']);
  });

  it('formatChord is null when a first-stroke modifier was released before a later key, or for four keys', () => {
    expect(formatChord(['Ctrl+E', 'Ctrl+W', 'Q'])).toBeNull();
    expect(formatChord(['Ctrl+E', 'Ctrl+W', 'Ctrl+Q', 'Ctrl+R'])).toBeNull();
  });

  it('validity: three keys are one valid binding; four are not', () => {
    expect(isTwoStrokeToken('Ctrl+E,W,Q')).toBe(true);
    expect(isValidTwoStrokeToken('Ctrl+E,W,Q')).toBe(true);
    expect(isValidTwoStrokeToken('Ctrl+E,W,Shift')).toBe(false);
    expect(isValidTwoStrokeToken('Ctrl+E,W,Q,R')).toBe(false);
  });

  it('parseKeybindings keeps a three-key entry as written', () => {
    const parsed = parseKeybindings({ bindings: { 'editor.toggleWordWrap': ['Ctrl+E,W,Q'] } });
    expect(parsed.bindings['editor.toggleWordWrap']).toEqual(['Ctrl+E,W,Q']);
  });

  it('normalises and folds as one binding', () => {
    expect(normalizeToken('Ctrl+e,w,q')).toBe('Ctrl+E,W,Q');
    expect(sameBindingToken('Ctrl+E,W,NumpadAdd')).toBe('Ctrl+E,W,+');
  });

  it('captureChordToken records three keys under a held Ctrl as Ctrl+E,W,Q', () => {
    const ctrl = { ctrl: true, alt: false, shift: false, meta: false };
    expect(captureChordToken([{ ...ctrl, key: 'e' }, { ...ctrl, key: 'w' }, { ...ctrl, key: 'q' }])).toBe('Ctrl+E,W,Q');
  });

  describe('a shorter chord that prefixes a longer one in an intersecting scope is a collision', () => {
    const scopes = {
      'editor.toggleWordWrap': new Set(['editor'] as const),
      'editor.saveAs': new Set(['editor'] as const),
      'file.rename': new Set(['explorer'] as const),
    } as unknown as CommandScopes;

    it('Ctrl+E,W against Ctrl+E,W,Q collides on Ctrl+E,W', () => {
      const clashes = chordCollisions({ 'editor.toggleWordWrap': ['Ctrl+E,W,Q'], 'editor.saveAs': ['Ctrl+E,W'] }, scopes);
      expect(clashes).toHaveLength(1);
      expect(clashes[0].token).toBe('Ctrl+E,W');
      expect([...clashes[0].actions].sort()).toEqual(['editor.saveAs', 'editor.toggleWordWrap']);
    });

    it('Ctrl+E against Ctrl+E,W,Q collides on Ctrl+E', () => {
      const clashes = chordCollisions({ 'editor.toggleWordWrap': ['Ctrl+E,W,Q'], 'editor.saveAs': ['Ctrl+E'] }, scopes);
      expect(clashes.map((c) => c.token)).toEqual(['Ctrl+E']);
    });

    it('is silent in disjoint scopes, and for two three-key chords merely sharing a prefix', () => {
      expect(chordCollisions({ 'editor.toggleWordWrap': ['Ctrl+E,W,Q'], 'file.rename': ['Ctrl+E,W'] }, scopes)).toEqual([]);
      expect(chordCollisions({ 'editor.toggleWordWrap': ['Ctrl+E,W,Q'], 'editor.saveAs': ['Ctrl+E,W,R'] }, scopes)).toEqual([]);
    });

    it('findConflict: capturing Ctrl+E,W for another editor command conflicts with a bound Ctrl+E,W,Q', () => {
      expect(
        findConflict({ 'editor.toggleWordWrap': ['Ctrl+E,W,Q'] }, 'Ctrl+E,W', 'editor.save' as never),
      ).toBe('editor.toggleWordWrap');
    });

    it('the shipped-defaults upgrade refuses word wrap’s move onto Ctrl+E,W while another editor command keeps Ctrl+E,W,Q', () => {
      // A kept three-key chord that STARTS with the shipped two-key one makes the shipped one
      // ambiguous: the move is refused, as FR-092's first-stroke rule refuses it for a bare Ctrl+E.
      const live = structuredClone(buildLive());
      const doc = { version: 1, bindings: { ...live, 'editor.toggleWordWrap': ['Ctrl+E W'], 'editor.save': ['Ctrl+E,W,Q'] } };
      expect(planKeybindingsUpgrade(doc).find((l) => l.action === 'editor.toggleWordWrap')).toBeUndefined();
    });
  });
});

function buildLive(): Record<string, string[]> {
  return keybindings.DEFAULT_KEYBINDINGS.bindings as Record<string, string[]>;
}

describe('the Mods+K1,K2 two-stroke token (FR-124)', () => {
  describe('parseTwoStroke reads the strokes as physically pressed', () => {
    it('Ctrl+E,W is Ctrl+E then Ctrl+W — the modifiers are still held for the second key', () => {
      expect(parseTwoStroke('Ctrl+E,W')).toEqual(['Ctrl+E', 'Ctrl+W']);
    });

    it('a modifier added for the second key is part of it: Ctrl+E,Shift+W is Ctrl+E then Ctrl+Shift+W', () => {
      expect(parseTwoStroke('Ctrl+E,Shift+W')).toEqual(['Ctrl+E', 'Ctrl+Shift+W']);
    });

    it('a three-modifier chord keeps all three for the second key', () => {
      expect(parseTwoStroke('Ctrl+Shift+Alt+J,K')).toEqual(['Ctrl+Shift+Alt+J', 'Ctrl+Shift+Alt+K']);
    });

    it('Ctrl+,,W is Ctrl+comma then W — a comma that is a stroke key is not a separator', () => {
      expect(parseTwoStroke('Ctrl+,,W')).toEqual(['Ctrl+,', 'Ctrl+W']);
    });

    it('a comma as the SECOND key: Ctrl+E,, is Ctrl+E then Ctrl+comma', () => {
      expect(parseTwoStroke('Ctrl+E,,')).toEqual(['Ctrl+E', 'Ctrl+,']);
    });

    it('Ctrl+, alone is ONE stroke (Ctrl+comma), not a two-stroke token', () => {
      expect(parseTwoStroke('Ctrl+,')).toBeNull();
      expect(isTwoStrokeToken('Ctrl+,')).toBe(false);
      expect(normalizeToken('Ctrl+,')).toBe('Ctrl+,');
    });

    it('a legacy space-separated token reads as its comma form', () => {
      expect(parseTwoStroke('Ctrl+E W')).toEqual(['Ctrl+E', 'Ctrl+W']);
    });
  });

  describe('normalizeToken writes the comma form', () => {
    it('upper-cases the letters on either side of the comma', () => {
      expect(normalizeToken('Ctrl+e,w')).toBe('Ctrl+E,W');
    });

    it('a legacy Ctrl+E W normalises to Ctrl+E,W', () => {
      expect(normalizeToken('Ctrl+E W')).toBe('Ctrl+E,W');
      expect(normalizeToken('Ctrl+E  W')).toBe('Ctrl+E,W');
    });

    it('a legacy second stroke naming a held modifier again drops it: Ctrl+E Ctrl+W is Ctrl+E,W', () => {
      expect(normalizeToken('Ctrl+E Ctrl+W')).toBe('Ctrl+E,W');
      expect(normalizeToken('Ctrl+E Shift+W')).toBe('Ctrl+E,Shift+W');
    });

    it('keeps a comma key intact', () => {
      expect(normalizeToken('Ctrl+,,w')).toBe('Ctrl+,,W');
    });
  });

  // Re-pinned for FR-126 (iterate round 6): up to THREE keys follow the modifiers, so the refusal
  // moves from the third key to the fourth. parseTwoStroke itself still reads exactly two.
  describe('four keys are refused (FR-126 supersedes FR-124’s three)', () => {
    it('Ctrl+E,W,X,Y is no chord; parseTwoStroke still reads only two-key tokens', () => {
      expect(parseTwoStroke('Ctrl+E,W,X')).toBeNull();
      expect(isValidTwoStrokeToken('Ctrl+E,W,X,Y')).toBe(false);
    });

    it('parseKeybindings drops a four-key entry', () => {
      const parsed = parseKeybindings({ bindings: { 'editor.toggleWordWrap': ['Ctrl+E,W,X,Y'] } });
      expect(parsed.bindings['editor.toggleWordWrap']).not.toContain('Ctrl+E,W,X,Y');
    });
  });

  describe('validity keeps FR-092 in the comma form', () => {
    it('accepts Ctrl+E,W and Ctrl+E,Shift+W', () => {
      expect(isValidTwoStrokeToken('Ctrl+E,W')).toBe(true);
      expect(isValidTwoStrokeToken('Ctrl+E,Shift+W')).toBe(true);
    });

    it('refuses a bare first stroke and a modifier-only second stroke', () => {
      expect(isValidTwoStrokeToken('E,W')).toBe(false);
      expect(isValidTwoStrokeToken('Ctrl+E,Shift')).toBe(false);
      expect(isValidTwoStrokeToken('Ctrl+E,')).toBe(false);
    });
  });

  describe('formatTwoStroke — the display and save form', () => {
    it('writes two physical strokes under one held modifier set as Mods+K1,K2', () => {
      expect(formatTwoStroke('Ctrl+E', 'Ctrl+W')).toBe('Ctrl+E,W');
      expect(formatTwoStroke('Ctrl+Shift+Alt+J', 'Ctrl+Shift+Alt+K')).toBe('Ctrl+Shift+Alt+J,K');
    });

    it('writes a modifier added for the second key on the second key', () => {
      expect(formatTwoStroke('Ctrl+E', 'Ctrl+Shift+W')).toBe('Ctrl+E,Shift+W');
    });

    it('writes a comma key so it parses back', () => {
      expect(formatTwoStroke('Ctrl+,', 'Ctrl+W')).toBe('Ctrl+,,W');
      expect(parseTwoStroke(formatTwoStroke('Ctrl+,', 'Ctrl+W') ?? '')).toEqual(['Ctrl+,', 'Ctrl+W']);
    });

    it('is null when a first-stroke modifier was released before the second key — not one press', () => {
      expect(formatTwoStroke('Ctrl+E', 'W')).toBeNull();
      expect(formatTwoStroke('Ctrl+Shift+E', 'Ctrl+W')).toBeNull();
    });

    it('round-trips: parseTwoStroke(formatTwoStroke(a, b)) is [a, b]', () => {
      const pairs: [string, string][] = [
        ['Ctrl+E', 'Ctrl+W'],
        ['Ctrl+E', 'Ctrl+Shift+W'],
        ['Ctrl+Shift+Alt+J', 'Ctrl+Shift+Alt+K'],
        ['Ctrl++', 'Ctrl+W'],
      ];
      for (const [a, b] of pairs) {
        expect(parseTwoStroke(formatTwoStroke(a, b) ?? '')).toEqual([a, b]);
      }
    });
  });

  describe('captureTwoStrokeToken writes the comma form', () => {
    it('Ctrl held through E then W records Ctrl+E,W', () => {
      const ctrl = { ctrl: true, alt: false, shift: false, meta: false };
      expect(captureTwoStrokeToken({ ...ctrl, key: 'e' }, { ...ctrl, key: 'w' })).toBe('Ctrl+E,W');
    });

    it('is null when Ctrl was released before the second key', () => {
      const ctrl = { ctrl: true, alt: false, shift: false, meta: false };
      expect(captureTwoStrokeToken({ ...ctrl, key: 'e' }, { ...ctrl, ctrl: false, key: 'w' })).toBeNull();
    });
  });

  describe('loading and comparing', () => {
    it('parseKeybindings reads a saved legacy Ctrl+E W as Ctrl+E,W', () => {
      const parsed = parseKeybindings({ bindings: { 'editor.toggleWordWrap': ['Ctrl+E W'] } });
      expect(parsed.bindings['editor.toggleWordWrap']).toEqual(['Ctrl+E,W']);
    });

    it('sameBindingToken folds per stroke in the comma form', () => {
      expect(sameBindingToken('Ctrl+E,NumpadAdd')).toBe('Ctrl+E,+');
    });

    it('a comma-form first stroke still collides with a whole single-stroke chord (FR-092)', () => {
      const bindings = { 'editor.toggleWordWrap': ['Ctrl+E,W'], 'editor.saveAs': ['Ctrl+E'] };
      const scopes = {
        'editor.toggleWordWrap': new Set(['editor'] as const),
        'editor.saveAs': new Set(['editor'] as const),
      } as unknown as CommandScopes;
      const clashes = chordCollisions(bindings, scopes);
      expect(clashes).toHaveLength(1);
      expect(clashes[0].token).toBe('Ctrl+E');
    });

    it('the legacy and comma forms are the same binding for collisions', () => {
      const bindings = { 'editor.toggleWordWrap': ['Ctrl+E W'], 'editor.cutLine': ['Ctrl+E,W'] };
      const scopes = {
        'editor.toggleWordWrap': new Set(['editor'] as const),
        'editor.cutLine': new Set(['editor'] as const),
      } as unknown as CommandScopes;
      const clashes = chordCollisions(bindings, scopes);
      expect(clashes).toHaveLength(1);
      expect(clashes[0].token).toBe('Ctrl+E,W');
    });
  });
});
