import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDINGS, resolveAction, COMMAND_SCOPES } from '../../src/config/keybindings.js';
import { KEYBINDINGS_METADATA } from '../../src/config/keybindings-metadata.js';

/**
 * US1 / FR-003b (spec 024): the word-wrap toggle command ships on Ctrl+Alt+W, editor scope only,
 * with a metadata descriptor (the completeness gate requires one), and does not reach a terminal.
 */
describe('editor.toggleWordWrap keybinding (024 US1)', () => {
  it('is bound to Ctrl+Alt+W', () => {
    expect(DEFAULT_KEYBINDINGS.bindings['editor.toggleWordWrap']).toEqual(['Ctrl+Alt+W']);
  });

  it('is live in the editor scope, not the terminal', () => {
    const scopes = COMMAND_SCOPES['editor.toggleWordWrap'];
    expect(scopes.has('editor')).toBe(true);
    expect(scopes.has('terminal')).toBe(false);
    expect(scopes.has('explorer')).toBe(false);
  });

  it('resolves Ctrl+Alt+W to the command in the editor scope but not in a terminal', () => {
    const ev = { key: 'W', ctrl: true, alt: true };
    expect(resolveAction(DEFAULT_KEYBINDINGS, ev, 'editor')).toBe('editor.toggleWordWrap');
    expect(resolveAction(DEFAULT_KEYBINDINGS, ev, 'terminal')).toBeNull();
  });

  it('has a keybindings-metadata descriptor (completeness gate)', () => {
    const d = KEYBINDINGS_METADATA.find((m) => m.key === 'editor.toggleWordWrap');
    expect(d).toBeDefined();
    expect(d?.group).toBe('Editor');
  });
});
