import { describe, it, expect } from 'vitest';
import { DEFAULT_KEYBINDINGS, resolveAction } from '@throng/core';

// `file.*` is EXPLORER-scoped (016, FR-017b0): these chords act on the selected file, and only
// while the tree has focus. The same Ctrl+X inside an EDITOR is `editor.cutLine` — the scopes are
// disjoint, which is what lets both keep the chord (see keybindings-scope.test.ts).

describe('file.* keybindings (004 T006/T007)', () => {
  it('defines the default file-operation shortcuts', () => {
    const b = DEFAULT_KEYBINDINGS.bindings;
    expect(b['file.rename']).toEqual(['F2']);
    expect(b['file.cut']).toEqual(['Ctrl+X']);
    expect(b['file.copy']).toEqual(['Ctrl+C']);
    expect(b['file.paste']).toEqual(['Ctrl+V']);
    expect(b['file.delete']).toEqual(['Delete']);
  });

  it('resolves events to the file actions', () => {
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'F2' }, 'explorer')).toBe('file.rename');
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'x', ctrl: true }, 'explorer')).toBe('file.cut');
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'c', ctrl: true }, 'explorer')).toBe('file.copy');
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'v', ctrl: true }, 'explorer')).toBe('file.paste');
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'Delete' }, 'explorer')).toBe('file.delete');
  });

  it('honours a remapped binding', () => {
    const remapped = {
      version: 1,
      bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'file.rename': ['F6'] },
    };
    expect(resolveAction(remapped, { key: 'F6' }, 'explorer')).toBe('file.rename');
    expect(resolveAction(remapped, { key: 'F2' }, 'explorer')).toBeNull();
  });
});
