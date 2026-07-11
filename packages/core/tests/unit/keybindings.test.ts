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
    expect(resolveAction(kb, { ctrl: true, key: '=' })).toBe('zoom.in');
    expect(resolveAction(kb, { ctrl: true, key: '+' })).toBe('zoom.in');
    expect(resolveAction(kb, { ctrl: true, key: '-' })).toBe('zoom.out');
    expect(resolveAction(kb, { ctrl: true, key: '0' })).toBe('zoom.reset');
    expect(resolveAction(kb, { key: 'F11' })).toBe('view.fullscreen');
    // Pane toggles — letters match case-insensitively (DOM keydown reports "b"/"n").
    expect(resolveAction(kb, { ctrl: true, key: 'b' })).toBe('view.toggleProjects');
    expect(resolveAction(kb, { ctrl: true, key: 'B' })).toBe('view.toggleProjects');
    expect(resolveAction(kb, { ctrl: true, key: 'n' })).toBe('view.toggleExplorer');
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
    expect(resolveAction(custom, { ctrl: true, key: 'x' })).toBe('view.toggleProjects');
    expect(resolveAction(custom, { ctrl: true, key: 'X' })).toBe('view.toggleProjects');
  });

  it('resolves the mouse-zoom gestures', () => {
    const kb = DEFAULT_KEYBINDINGS;
    expect(resolveAction(kb, { ctrl: true, gesture: 'WheelUp' })).toBe('zoom.in');
    expect(resolveAction(kb, { ctrl: true, gesture: 'WheelDown' })).toBe('zoom.out');
    expect(resolveAction(kb, { ctrl: true, gesture: 'MiddleClick' })).toBe('zoom.reset');
  });

  it('returns null for an unbound event', () => {
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'a' })).toBeNull();
    expect(resolveAction(DEFAULT_KEYBINDINGS, { ctrl: true, key: 'q' })).toBeNull();
  });

  it('resolves the 012 per-type zoom + move-focus chords the KeybindingsHandler dispatches', () => {
    const kb = DEFAULT_KEYBINDINGS;
    // Per-type zoom (Ctrl+Alt family) — distinct from the global zoom (Ctrl family).
    expect(resolveAction(kb, { ctrl: true, alt: true, key: '=' })).toBe('panel.zoomIn');
    expect(resolveAction(kb, { ctrl: true, alt: true, key: '+' })).toBe('panel.zoomIn');
    expect(resolveAction(kb, { ctrl: true, alt: true, key: '-' })).toBe('panel.zoomOut');
    expect(resolveAction(kb, { ctrl: true, alt: true, key: '0' })).toBe('panel.zoomReset');
    // …and the global zoom chords still resolve to the global actions (distinct, FR-014).
    expect(resolveAction(kb, { ctrl: true, key: '=' })).toBe('zoom.in');
    expect(resolveAction(kb, { ctrl: true, key: '0' })).toBe('zoom.reset');

    // Directional move-focus — arrow keys report `Arrow*`, matching the defaults.
    expect(resolveAction(kb, { ctrl: true, alt: true, key: 'ArrowLeft' })).toBe('focus.left');
    expect(resolveAction(kb, { ctrl: true, alt: true, key: 'ArrowRight' })).toBe('focus.right');
    expect(resolveAction(kb, { ctrl: true, alt: true, key: 'ArrowUp' })).toBe('focus.up');
    expect(resolveAction(kb, { ctrl: true, alt: true, key: 'ArrowDown' })).toBe('focus.down');

    // Cycle: the backtick key is normalised (renderer `chordKey`) so Shift is what
    // distinguishes forward from back — portable across layouts (UK Shift+backtick is
    // ¬, not ~), unlike a produced-character token.
    expect(resolveAction(kb, { ctrl: true, key: '`' })).toBe('focus.cycle');
    expect(resolveAction(kb, { ctrl: true, shift: true, key: '`' })).toBe('focus.cycleBack');
  });

  it('parses defaults and merges custom bindings', () => {
    expect(parseKeybindings(undefined)).toEqual(DEFAULT_KEYBINDINGS);
    const custom = parseKeybindings({ bindings: { 'zoom.in': ['Ctrl+Shift+='] } });
    expect(custom.bindings['zoom.in']).toEqual(['Ctrl+Shift+=']);
    // other actions retained from defaults
    expect(custom.bindings['view.fullscreen']).toEqual(['F11']);
    expect(resolveAction(custom, { ctrl: true, shift: true, key: '=' })).toBe('zoom.in');
  });
});
