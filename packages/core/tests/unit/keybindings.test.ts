import { describe, it, expect } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  eventToToken,
  normalizeToken,
  parseKeybindings,
  resolveAction,
} from '@throng/core';

describe('Keybindings resolver (FR-033)', () => {
  it('builds canonical tokens from events', () => {
    expect(eventToToken({ ctrl: true, key: '=' })).toBe('Ctrl+=');
    expect(eventToToken({ ctrl: true, key: '+' })).toBe('Ctrl++');
    expect(eventToToken({ key: 'F11' })).toBe('F11');
    expect(eventToToken({ ctrl: true, gesture: 'WheelUp' })).toBe('Ctrl+WheelUp');
    expect(eventToToken({})).toBeNull();
  });

  it('resolves the default keyboard shortcuts', () => {
    const kb = DEFAULT_KEYBINDINGS;
    expect(resolveAction(kb, { ctrl: true, key: '=' }, 'editor')).toBe('zoom.in');
    expect(resolveAction(kb, { ctrl: true, key: '+' }, 'editor')).toBe('zoom.in');
    expect(resolveAction(kb, { ctrl: true, key: '-' }, 'editor')).toBe('zoom.out');
    expect(resolveAction(kb, { ctrl: true, key: '0' }, 'editor')).toBe('zoom.reset');
    expect(resolveAction(kb, { key: 'F11' }, 'editor')).toBe('view.fullscreen');
    // Pane toggles — letters match case-insensitively (DOM keydown reports "b"/"n").
    expect(resolveAction(kb, { ctrl: true, key: 'b' }, 'editor')).toBe('view.toggleProjects');
    expect(resolveAction(kb, { ctrl: true, key: 'B' }, 'editor')).toBe('view.toggleProjects');
    expect(resolveAction(kb, { ctrl: true, key: 'n' }, 'editor')).toBe('view.toggleExplorer');
  });

  it('normalises only a lone-letter key segment', () => {
    expect(normalizeToken('Ctrl+b')).toBe('Ctrl+B');
    expect(normalizeToken('b')).toBe('B');
    expect(normalizeToken('Ctrl++')).toBe('Ctrl++'); // the "+" key is untouched
    expect(normalizeToken('Ctrl+0')).toBe('Ctrl+0'); // digits untouched
    expect(normalizeToken('F11')).toBe('F11'); // multi-char keys untouched
  });

  it('matches a custom binding whose letter is written in either case', () => {
    const custom = parseKeybindings({ bindings: { 'view.toggleProjects': ['Ctrl+x'] } });
    expect(resolveAction(custom, { ctrl: true, key: 'x' }, 'editor')).toBe('view.toggleProjects');
    expect(resolveAction(custom, { ctrl: true, key: 'X' }, 'editor')).toBe('view.toggleProjects');
  });

  it('resolves the mouse-zoom gestures', () => {
    const kb = DEFAULT_KEYBINDINGS;
    expect(resolveAction(kb, { ctrl: true, gesture: 'WheelUp' }, 'editor')).toBe('zoom.in');
    expect(resolveAction(kb, { ctrl: true, gesture: 'WheelDown' }, 'editor')).toBe('zoom.out');
    expect(resolveAction(kb, { ctrl: true, gesture: 'MiddleClick' }, 'editor')).toBe('zoom.reset');
  });

  it('returns null for an unbound event', () => {
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'a' }, 'editor')).toBeNull();
    expect(resolveAction(DEFAULT_KEYBINDINGS, { ctrl: true, key: 'q' }, 'editor')).toBeNull();
  });

  it('resolves the 012 per-type zoom + move-focus chords the KeybindingsHandler dispatches', () => {
    const kb = DEFAULT_KEYBINDINGS;
    // Per-type zoom (Ctrl+Alt family) — distinct from the global zoom (Ctrl family).
    expect(resolveAction(kb, { ctrl: true, alt: true, key: '=' }, 'editor')).toBe('panel.zoomIn');
    expect(resolveAction(kb, { ctrl: true, alt: true, key: '+' }, 'editor')).toBe('panel.zoomIn');
    expect(resolveAction(kb, { ctrl: true, alt: true, key: '-' }, 'editor')).toBe('panel.zoomOut');
    expect(resolveAction(kb, { ctrl: true, alt: true, key: '0' }, 'editor')).toBe('panel.zoomReset');
    // …and the global zoom chords still resolve to the global actions (distinct, FR-014).
    expect(resolveAction(kb, { ctrl: true, key: '=' }, 'editor')).toBe('zoom.in');
    expect(resolveAction(kb, { ctrl: true, key: '0' }, 'editor')).toBe('zoom.reset');

    // Directional move-focus — arrow keys report `Arrow*`, matching the defaults.
    expect(resolveAction(kb, { ctrl: true, alt: true, key: 'ArrowLeft' }, 'editor')).toBe('focus.left');
    expect(resolveAction(kb, { ctrl: true, alt: true, key: 'ArrowRight' }, 'editor')).toBe('focus.right');
    expect(resolveAction(kb, { ctrl: true, alt: true, key: 'ArrowUp' }, 'editor')).toBe('focus.up');
    expect(resolveAction(kb, { ctrl: true, alt: true, key: 'ArrowDown' }, 'editor')).toBe('focus.down');

    // Cycle: the backtick key is normalised (renderer `chordKey`) so Shift is what
    // distinguishes forward from back — portable across layouts (UK Shift+backtick is
    // ¬, not ~), unlike a produced-character token.
    expect(resolveAction(kb, { ctrl: true, key: '`' }, 'editor')).toBe('focus.cycle');
    expect(resolveAction(kb, { ctrl: true, shift: true, key: '`' }, 'editor')).toBe('focus.cycleBack');
  });

  it('ROUND-TRIPS every shipped chord through normalizeToken(eventToToken(...)) — F2', () => {
    // The bug this catches, and it is not hypothetical: a chord written `Alt+Shift+ArrowUp`
    // never matches, because `eventToToken` emits modifiers in the canonical order
    // Ctrl+Shift+Alt+key. The command would be shipped, listed in the editor, rebindable —
    // and simply dead. Every shipped chord must be writable as an event and come back
    // identical, which is exactly what dispatch requires of it.
    const parseToken = (token: string): { ev: Parameters<typeof eventToToken>[0] } | null => {
      const parts = token.split('+');
      // A trailing "+" key ("Ctrl++") splits into an empty tail — put it back.
      const key = parts[parts.length - 1] === '' ? '+' : parts[parts.length - 1];
      const mods = new Set(parts.slice(0, parts[parts.length - 1] === '' ? -2 : -1));
      const gesture = ['WheelUp', 'WheelDown', 'MiddleClick'].includes(key)
        ? (key as 'WheelUp' | 'WheelDown' | 'MiddleClick')
        : undefined;
      return {
        ev: {
          ...(gesture ? { gesture } : { key }),
          ctrl: mods.has('Ctrl'),
          shift: mods.has('Shift'),
          alt: mods.has('Alt'),
        },
      };
    };

    for (const [action, tokens] of Object.entries(DEFAULT_KEYBINDINGS.bindings)) {
      for (const token of tokens) {
        const parsed = parseToken(token);
        const rebuilt = eventToToken(parsed!.ev);
        expect(
          normalizeToken(rebuilt ?? ''),
          `"${action}" ships "${token}", which an event can never produce — the chord is dead`,
        ).toBe(normalizeToken(token));
      }
    }
  });

  it('parses defaults and merges custom bindings', () => {
    expect(parseKeybindings(undefined)).toEqual(DEFAULT_KEYBINDINGS);
    const custom = parseKeybindings({ bindings: { 'zoom.in': ['Ctrl+Shift+='] } });
    expect(custom.bindings['zoom.in']).toEqual(['Ctrl+Shift+=']);
    // other actions retained from defaults
    expect(custom.bindings['view.fullscreen']).toEqual(['F11']);
    expect(resolveAction(custom, { ctrl: true, shift: true, key: '=' }, 'editor')).toBe('zoom.in');
  });
});
