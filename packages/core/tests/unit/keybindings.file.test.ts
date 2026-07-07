import { describe, it, expect } from 'vitest';
import { DEFAULT_KEYBINDINGS, resolveAction } from '@throng/core';

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
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'F2' })).toBe('file.rename');
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'x', ctrl: true })).toBe('file.cut');
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'c', ctrl: true })).toBe('file.copy');
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'v', ctrl: true })).toBe('file.paste');
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'Delete' })).toBe('file.delete');
  });

  it('honours a remapped binding', () => {
    const remapped = {
      version: 1,
      bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'file.rename': ['F6'] },
    };
    expect(resolveAction(remapped, { key: 'F6' })).toBe('file.rename');
    expect(resolveAction(remapped, { key: 'F2' })).toBeNull();
  });
});
