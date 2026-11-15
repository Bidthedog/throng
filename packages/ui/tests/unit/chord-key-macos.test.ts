/**
 * The renderer's chord resolvers on macOS (070 FR-029, SC-005; 046 FR-104 superseded on macOS only).
 *
 * Cmd (`metaKey`) is macOS's primary modifier, so the resolvers accept it there and keep declining it on Windows and
 * Linux, where it is the OS-owned Windows/Super key. Option composes a character from almost every key, so with Cmd
 * or Ctrl held it is matched on the physical key.
 */
import { describe, expect, it } from 'vitest';
import {
  COMMAND_SCOPES,
  DEFAULT_KEYBINDINGS,
  eventToToken,
  isReservedChord,
  linuxHostTraits,
  macosHostTraits,
  normalizeToken,
  resolveAction,
  shippedBindingsFor,
  splitStrokes,
  type ActionId,
  type DispatchScope,
} from '@throng/core';
import { withHostTraits } from '@throng/core/testing';
import { chordCandidates, resolveKeydown, type ChordEventLike } from '../../src/renderer/config/chord-key.js';

const MACOS = macosHostTraits('/tmp/throng', []);

/** What Option makes a US Mac keyboard type for a few keys — what `key` reports with Option held. */
const OPTION_CHAR: Readonly<Record<string, string>> = { KeyS: 'ß', KeyF: 'ƒ', KeyH: '˙', Equal: '≠', Minus: '–', Digit0: 'º' };

function ev(code: string, key: string, mods: Partial<ChordEventLike> = {}): ChordEventLike {
  return { code, key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods };
}

const tokenOf = (e: ChordEventLike): string | null =>
  resolveKeydown(e, (r) => {
    const token = eventToToken(r);
    return token ? normalizeToken(token) : null;
  });

describe('Cmd on macOS (070 FR-029)', () => {
  it('resolves a Cmd chord to its action, and the same keys with Ctrl to nothing', () => {
    withHostTraits(MACOS, () => {
      const resolve = (e: ChordEventLike): ActionId | null =>
        resolveKeydown(e, (r) => resolveAction(DEFAULT_KEYBINDINGS, r, 'editor'));
      expect(resolve(ev('KeyS', 's', { metaKey: true }))).toBe('editor.save');
      expect(resolve(ev('KeyS', 's', { ctrlKey: true }))).toBeNull();
    });
  });

  it('matches Option chords with Cmd held on the physical key, whatever Option made the key type', () => {
    withHostTraits(MACOS, () => {
      expect(tokenOf(ev('KeyS', OPTION_CHAR.KeyS as string, { metaKey: true, altKey: true }))).toBe('Alt+Meta+S');
      expect(tokenOf(ev('Equal', OPTION_CHAR.Equal as string, { metaKey: true, altKey: true }))).toBe('Alt+Meta++');
      expect(tokenOf(ev('Minus', OPTION_CHAR.Minus as string, { metaKey: true, altKey: true }))).toBe('Alt+Meta+-');
      expect(tokenOf(ev('Digit0', OPTION_CHAR.Digit0 as string, { metaKey: true, altKey: true }))).toBe('Alt+Meta+0');
      expect(tokenOf(ev('KeyK', 'K', { metaKey: true, altKey: true, shiftKey: true }))).toBe('Shift+Alt+Meta+K');
      expect(tokenOf(ev('ArrowUp', 'ArrowUp', { ctrlKey: true, altKey: true, shiftKey: true }))).toBe('Ctrl+Shift+Alt+ArrowUp');
    });
  });

  it('matches Cmd+digit on the physical digit, Shift kept', () => {
    withHostTraits(MACOS, () => {
      expect(tokenOf(ev('Digit1', '!', { metaKey: true, shiftKey: true }))).toBe('Shift+Meta+1');
      expect(chordCandidates(ev('Digit1', '1', { metaKey: true }))).toEqual(['Meta+1']);
    });
  });

  it('leaves Option alone to type: Option+S without Cmd or Ctrl is the character it produced', () => {
    withHostTraits(MACOS, () => {
      expect(tokenOf(ev('KeyS', 'ß', { altKey: true }))).toBe('Alt+ß');
    });
  });

  it('keeps declining Meta on Windows and Linux (046 FR-104)', () => {
    for (const traits of [undefined, linuxHostTraits('/run/x')]) {
      const run = (): void => {
        expect(tokenOf(ev('KeyS', 's', { metaKey: true }))).toBeNull();
        expect(chordCandidates(ev('KeyK', 'K', { metaKey: true, altKey: true, shiftKey: true, ctrlKey: true }))).toEqual([]);
        // …and the Ctrl form still resolves exactly as before.
        expect(tokenOf(ev('KeyS', 's', { ctrlKey: true }))).toBe('Ctrl+S');
        expect(tokenOf(ev('KeyK', 'K', { ctrlKey: true, altKey: true, shiftKey: true }))).toBe('Ctrl+Shift+Alt+K');
      };
      if (traits) withHostTraits(traits, run);
      else run();
    }
  });

  it('lets the capture modal bind a Cmd-only chord on macOS, and keeps refusing it elsewhere', () => {
    withHostTraits(MACOS, () => {
      expect(isReservedChord('Meta+S')).toBe(false);
      expect(isReservedChord('Meta+H')).toBe(true);
      expect(isReservedChord('Meta+Q')).toBe(true);
    });
    expect(isReservedChord('Meta+S')).toBe(true);
  });
});

/** A US Mac keydown for one stroke of a binding token: `key` and `code`, with Option's character where it applies. */
function keydownFor(stroke: string, held: Partial<ChordEventLike> = {}): ChordEventLike {
  const mods = new Set(stroke.split('+').slice(0, -1));
  const rawKey = stroke.endsWith('++') ? '+' : (stroke.split('+').pop() as string);
  const base: ChordEventLike = {
    key: rawKey,
    code: rawKey,
    ctrlKey: mods.has('Ctrl') || (held.ctrlKey ?? false),
    shiftKey: mods.has('Shift') || (held.shiftKey ?? false),
    altKey: mods.has('Alt') || (held.altKey ?? false),
    metaKey: mods.has('Meta') || (held.metaKey ?? false),
  };
  const SYMBOL_CODE: Record<string, string> = { '+': 'Equal', '-': 'Minus', '`': 'Backquote', '[': 'BracketLeft', ']': 'BracketRight' };
  if (/^[A-Z]$/i.test(rawKey)) {
    base.code = `Key${rawKey.toUpperCase()}`;
    base.key = base.shiftKey ? rawKey.toUpperCase() : rawKey.toLowerCase();
  } else if (/^[0-9]$/.test(rawKey)) base.code = `Digit${rawKey}`;
  else if (rawKey in SYMBOL_CODE) base.code = SYMBOL_CODE[rawKey] as string;
  if (base.altKey && OPTION_CHAR[base.code]) base.key = OPTION_CHAR[base.code] as string;
  return base;
}

/** A scope each action is live in, so the resolver is asked where the action can fire. */
function scopeOf(action: string): DispatchScope {
  const scopes = COMMAND_SCOPES[action as ActionId];
  return ([...(scopes ?? [])][0] ?? 'editor') as DispatchScope;
}

describe('every shipped macOS keyboard chord resolves to its own action (070 SC-005)', () => {
  const rows = Object.entries(shippedBindingsFor('macos').bindings).flatMap(([action, tokens]) =>
    tokens
      .filter((t) => !/Wheel|MiddleClick/.test(t))
      .map((token) => ({ action, token })),
  );

  it('has chords to check — the table is not vacuous', () => {
    expect(rows.length).toBeGreaterThan(60);
  });

  for (const { action, token } of rows) {
    it(`${action} — ${token}`, () => {
      withHostTraits(MACOS, () => {
        const strokes = splitStrokes(normalizeToken(token)) ?? [token];
        const first = keydownFor(strokes[0] as string);
        const scope = scopeOf(action);
        if (strokes.length === 1) {
          expect(resolveKeydown(first, (r) => resolveAction(DEFAULT_KEYBINDINGS, r, scope))).toBe(action);
          return;
        }
        // A multi-key chord: each stroke, pressed with the first stroke's modifiers still held, names the stroke
        // the binding writes — which is what the chord engine matches (046 FR-124).
        expect(tokenOf(first)).toBe(normalizeToken(strokes[0] as string));
        const held = { ctrlKey: first.ctrlKey, altKey: first.altKey, shiftKey: first.shiftKey, metaKey: first.metaKey };
        for (const later of strokes.slice(1)) {
          const pressed = keydownFor(later, held);
          expect(tokenOf(pressed), later).not.toBeNull();
        }
      });
    });
  }
});
