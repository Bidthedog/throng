import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDINGS, resolveAction, COMMAND_SCOPES } from '../../src/config/keybindings.js';
import { KEYBINDINGS_METADATA } from '../../src/config/keybindings-metadata.js';

/**
 * US6 / FR-018c (spec 024): the menu.open command is bound to Shift+F10 and the ContextMenu key,
 * live in the explorer, editor and terminal scopes, with a metadata descriptor.
 */
describe('menu.open keybinding (024 US6)', () => {
  it('is bound to Shift+F10 and ContextMenu', () => {
    expect(DEFAULT_KEYBINDINGS.bindings['menu.open']).toEqual(['Shift+F10', 'ContextMenu']);
  });

  it('is live in the explorer, editor and terminal scopes', () => {
    const s = COMMAND_SCOPES['menu.open'];
    expect(s.has('explorer')).toBe(true);
    expect(s.has('editor')).toBe(true);
    expect(s.has('terminal')).toBe(true);
  });

  it('resolves Shift+F10 (shift required) and the ContextMenu key', () => {
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'F10', shift: true }, 'explorer')).toBe('menu.open');
    // Without shift it is NOT menu.open (the F10 case in app.tsx keeps shift for function keys).
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'F10' }, 'explorer')).toBeNull();
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'ContextMenu' }, 'terminal')).toBe('menu.open');
  });

  it('has a keybindings-metadata descriptor (completeness gate)', () => {
    expect(KEYBINDINGS_METADATA.some((m) => m.key === 'menu.open')).toBe(true);
  });
});
