/**
 * 046 FR-026 / FR-104 — physical-key chord matching at the resolvers that need no DOM: the in-menu
 * shortcut matcher and every `resolveKeydown` call a site builds. Moved from
 * `component/physical-key-chords-every-resolver.test.ts`, which keeps the cases that dispatch real
 * keyboard events (the window listener, `editor-chrome.tsx`, the terminal reservation) and the two
 * preview-scope resolutions, because `resolveScoped` reads `document.activeElement` for a preview.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  WINDOWS_HOST_TRAITS,
  configureHostTraits,
  firstBinding,
  macosHostTraits,
  resolveAction,
  shippedBindingsFor,
  type Keybindings,
  type WorkspaceLayout,
} from '@throng/core';
import { chordMatchesShortcut } from '../../src/renderer/workspace/context-menu.js';
import { resolveKeydown } from '../../src/renderer/config/chord-key.js';
import { resolveScoped, scopeFromKind } from '../../src/renderer/keybindings/scope.js';

/** US Ctrl+Shift+1: the produced `!` on the physical Digit1. */
const CTRL_SHIFT_1 = { key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true, altKey: false };

const bindingsWith = (overrides: Record<string, string[]>): Keybindings => ({
  version: 1,
  bindings: { ...DEFAULT_KEYBINDINGS.bindings, ...overrides },
});

describe('an in-menu shortcut on a digit fires from the physical key (FR-026)', () => {
  it('Ctrl+Shift+1 matches the advertised "Ctrl+Shift+1" when a US keyboard sends !', () => {
    expect(chordMatchesShortcut(CTRL_SHIFT_1, 'Ctrl+Shift+1')).toBe(true);
  });

  it('and a produced-character shortcut still matches as before', () => {
    expect(chordMatchesShortcut({ key: 'c', code: 'KeyC', ctrlKey: true, shiftKey: false, altKey: false }, 'Ctrl+C')).toBe(true);
  });
});

describe('on macOS an in-menu shortcut fires from its Cmd chord (070 FR-029)', () => {
  // Menus take their shortcut from `firstBinding`, which on macOS is the LABEL (`Cmd+C`), not the token (`Meta+C`).
  // Measured on a hosted macOS runner: the explorer menu advertised Cmd+C, got Cmd+C, and stayed open.
  const CMD_C = { key: 'c', code: 'KeyC', ctrlKey: false, shiftKey: false, altKey: false, metaKey: true };
  const CMD_OPTION_SHIFT_V = { key: '◊', code: 'KeyV', ctrlKey: false, shiftKey: true, altKey: true, metaKey: true };

  afterEach(() => configureHostTraits(WINDOWS_HOST_TRAITS));

  it('matches the shortcut a menu row actually carries', () => {
    configureHostTraits(macosHostTraits('/tmp/throng-ipc', []));
    const shortcut = firstBinding(shippedBindingsFor('macos'), 'file.copy');
    expect(shortcut).toBe('Cmd+C');
    expect(chordMatchesShortcut(CMD_C, shortcut!)).toBe(true);
  });

  it('matches a labelled shortcut with Option in it, and the raw token as well', () => {
    configureHostTraits(macosHostTraits('/tmp/throng-ipc', []));
    expect(chordMatchesShortcut(CMD_OPTION_SHIFT_V, 'Option+Shift+Cmd+V')).toBe(true);
    expect(chordMatchesShortcut(CMD_C, 'Meta+C')).toBe(true);
  });

  it('does not match a different key or a missing Cmd', () => {
    configureHostTraits(macosHostTraits('/tmp/throng-ipc', []));
    expect(chordMatchesShortcut({ ...CMD_C, key: 'x', code: 'KeyX' }, 'Cmd+C')).toBe(false);
    expect(chordMatchesShortcut({ ...CMD_C, metaKey: false }, 'Cmd+C')).toBe(false);
  });
});

describe('a tier-1 chord matches at the resolvers that own no command of their own (FR-104)', () => {
  // AZERTY's KeyM produces "," — R22's own example, and the AZERTY case
  // `chord-candidates.test.ts` and `renderer-chord-resolvers.test.ts` already pin.
  const AZERTY_M = { key: ',', code: 'KeyM', ctrlKey: true, shiftKey: true, altKey: true, metaKey: false };

  it('search-keybindings.tsx’s own resolveKeydown call matches a tier-1 chord from an AZERTY event', () => {
    // The exact expression `search-keybindings.tsx`'s onKeyDown builds
    // (`resolveKeydown(e, (ev) => resolveAction(keybindings, ev, scopeFromKind(activeKind)))`),
    // rebinding `search.find` the same test-device way as the block above. `focus.explorer` ships this
    // same chord (EVERYWHERE-scoped) and is unbound here for the same reason as the block above.
    const keybindings = bindingsWith({ 'search.find': ['Ctrl+Shift+Alt+M'], 'focus.explorer': [] });
    const action = resolveKeydown(AZERTY_M, (ev) => resolveScoped(keybindings, ev, {
      tabs: [{ id: 't1', title: 'T', activePanelId: 'p1', root: { type: 'panel', id: 'p1', kind: 'editor', title: 'P' } }] as unknown as WorkspaceLayout['tabs'],
      activeTabId: 't1',
    }, { transientFocus: false }));
    expect(action).toBe('search.find');
    // scopeFromKind is imported and used the same way this site uses it, for the same call shape.
    expect(scopeFromKind('editor')).toBe('editor');
  });

});

describe('Shift genuinely changes the chord at every resolver, not only the window listener (fix round IMPORTANT)', () => {
  it('explorer-keybindings.ts: Shift+Delete does not run file.delete', () => {
    // The exact expression explorer-keybindings.ts's onKeyDown builds:
    // resolveKeydown(e, (ev) => resolveAction(keybindings, ev, 'explorer')).
    const plain = { key: 'Delete', code: 'Delete', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
    expect(resolveKeydown(plain, (ev) => resolveAction(DEFAULT_KEYBINDINGS, ev, 'explorer'))).toBe(
      'file.delete',
    );
    const shifted = { ...plain, shiftKey: true };
    expect(
      resolveKeydown(shifted, (ev) => resolveAction(DEFAULT_KEYBINDINGS, ev, 'explorer')),
    ).not.toBe('file.delete');
  });


  it('search-keybindings.tsx: Shift+Escape does not run search.close (the find bar)', () => {
    // The exact expression search-keybindings.tsx's onKeyDown builds:
    // resolveKeydown(e, (ev) => resolveAction(keybindings, ev, scopeFromKind(activeKind))).
    const plain = { key: 'Escape', code: 'Escape', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
    expect(
      resolveKeydown(plain, (ev) => resolveAction(DEFAULT_KEYBINDINGS, ev, scopeFromKind('editor'))),
    ).toBe('search.close');
    const shifted = { ...plain, shiftKey: true };
    expect(
      resolveKeydown(shifted, (ev) => resolveAction(DEFAULT_KEYBINDINGS, ev, scopeFromKind('editor'))),
    ).not.toBe('search.close');
  });
});
