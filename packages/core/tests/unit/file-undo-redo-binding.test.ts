import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDINGS, resolveAction, COMMAND_SCOPES } from '../../src/config/keybindings.js';
import { KEYBINDINGS_METADATA } from '../../src/config/keybindings-metadata.js';

/**
 * US3 / FR-006 (spec 024): `file.undo` and `file.redo` reverse a file OPERATION — a rename, a move,
 * a delete — and they live only in the file tree.
 *
 * The scope is the whole point of this file. `Ctrl+Z` is the most overloaded chord in the
 * application: in an editor it must undo TEXT, and if `file.undo` ever leaked into the editor scope
 * a user correcting a typo would silently move a file on disk instead. The collision is legitimate
 * precisely BECAUSE the scopes are disjoint, so the disjointness is what has to be asserted — the
 * shared collision guard cannot flag it, since by design it is not a collision.
 */
describe('file.undo / file.redo keybindings (024 US3)', () => {
  it('are bound to the chords Windows users expect for undo and redo', () => {
    expect(DEFAULT_KEYBINDINGS.bindings['file.undo']).toEqual(['Ctrl+Z']);
    expect(DEFAULT_KEYBINDINGS.bindings['file.redo']).toEqual(['Ctrl+Y']);
  });

  it('live in the explorer scope and NOWHERE else', () => {
    for (const action of ['file.undo', 'file.redo'] as const) {
      const scopes = COMMAND_SCOPES[action];
      expect(scopes.has('explorer')).toBe(true);
      // The two that would do real damage: a text undo that moves a file, or a chord that fires
      // while the user is typing into a shell.
      expect(scopes.has('editor')).toBe(false);
      expect(scopes.has('terminal')).toBe(false);
    }
  });

  it('resolves Ctrl+Z to the FILE undo in the tree', () => {
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'z', ctrl: true }, 'explorer')).toBe('file.undo');
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'y', ctrl: true }, 'explorer')).toBe('file.redo');
  });

  it('leaves Ctrl+Z alone in an editor, so text undo still reaches CodeMirror', () => {
    // Not merely "not file.undo" — nothing at all may claim it, or the keydown is swallowed before
    // the editor ever sees it and the user's typing becomes unundoable.
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'z', ctrl: true }, 'editor')).toBeNull();
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'y', ctrl: true }, 'editor')).toBeNull();
  });

  it('leaves both chords alone in a terminal, where they belong to the shell', () => {
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'z', ctrl: true }, 'terminal')).toBeNull();
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'y', ctrl: true }, 'terminal')).toBeNull();
  });

  it('each has a keybindings-metadata descriptor (completeness gate)', () => {
    for (const action of ['file.undo', 'file.redo'] as const) {
      expect(KEYBINDINGS_METADATA.some((m) => m.key === action)).toBe(true);
    }
  });
});
