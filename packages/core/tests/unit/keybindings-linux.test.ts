import { describe, expect, it } from 'vitest';
import {
  DESKTOP_RESERVED_CHORDS,
  KEYPAD_REACHABLE_CHORDS,
  LINUX_BINDING_OVERRIDES,
  DEFAULT_KEYBINDINGS,
  shippedBindingsFor,
  SHIPPED_KEYBINDINGS_BY_PLATFORM,
} from '../../src/config/keybindings.js';
import { linuxHostTraits } from '../../src/platform/host-traits.js';
import { withHostTraits } from '../../src/testing/with-host-traits.js';

const windows = shippedBindingsFor('windows');
const linux = shippedBindingsFor('linux');
const firstStroke = (token: string): string => token.split(',')[0] ?? token;

describe('Linux shipped bindings (062 FR-033, FR-034)', () => {
  it('are their own table, not the Windows fallback', () => {
    expect(SHIPPED_KEYBINDINGS_BY_PLATFORM.linux).toBeDefined();
    expect(linux).not.toBe(windows);
  });

  it('leave no default on a chord the reference desktop reserves, unless the keypad still reaches it', () => {
    const reserved = new Set(DESKTOP_RESERVED_CHORDS.linux);
    const reachable = new Set(KEYPAD_REACHABLE_CHORDS.linux);
    const taken = Object.entries(linux.bindings).flatMap(([action, tokens]) =>
      tokens.filter((t) => reserved.has(firstStroke(t)) && !reachable.has(t)).map((t) => `${action}: ${t}`),
    );
    expect(taken).toEqual([]);
  });

  it('differ from Windows only for the chords the desktop reserves and the keypad cannot reach', () => {
    const reserved = new Set(DESKTOP_RESERVED_CHORDS.linux);
    const reachable = new Set(KEYPAD_REACHABLE_CHORDS.linux);
    for (const [action, tokens] of Object.entries(windows.bindings)) {
      const onLinux = linux.bindings[action];
      if (tokens.some((t) => reserved.has(firstStroke(t)) && !reachable.has(t))) {
        expect(onLinux, action).not.toEqual(tokens);
        expect(Object.keys(LINUX_BINDING_OVERRIDES)).toContain(action);
      } else {
        expect(onLinux, action).toEqual(tokens);
      }
    }
    expect(Object.keys(linux.bindings).sort()).toEqual(Object.keys(windows.bindings).sort());
  });

  it('give each replacement a chord no other action holds', () => {
    const owners = new Map<string, string>();
    for (const [action, tokens] of Object.entries(linux.bindings)) for (const t of tokens) owners.set(t, action);
    for (const [action, tokens] of Object.entries(LINUX_BINDING_OVERRIDES)) {
      for (const t of tokens) expect(owners.get(t), t).toBe(action);
    }
  });

  it('are what the running platform resolves, and Windows is untouched', () => {
    expect(DEFAULT_KEYBINDINGS.bindings).toEqual(windows.bindings);
    withHostTraits(linuxHostTraits('/run/x'), () => {
      expect(DEFAULT_KEYBINDINGS.bindings).toEqual(linux.bindings);
    });
    expect(windows.bindings['focus.up']).toEqual(['Ctrl+Shift+Alt+ArrowUp']);
    expect(linux.bindings['focus.up']).toEqual(['Ctrl+Shift+Alt+ArrowUp']);
    expect(windows.bindings['view.resourceMonitor']).toEqual(['Ctrl+Shift+Alt+Y']);
  });
});
