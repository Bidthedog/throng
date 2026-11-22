/**
 * 075 FR-064 — `preview.print`: live in a preview only, ships Ctrl+P (Cmd+P on macOS), collides with nothing in its
 * scope, and is described for the key bindings editor.
 */
import { describe, expect, it } from 'vitest';
import {
  COMMAND_SCOPES,
  DEFAULT_KEYBINDINGS,
  chordCollisions,
  resolveAction,
  shippedBindingsFor,
} from '../../src/config/keybindings.js';
import { KEYBINDINGS_METADATA } from '../../src/config/keybindings-metadata.js';

describe('preview.print (FR-064)', () => {
  it('is live in a preview and nowhere else', () => {
    expect([...COMMAND_SCOPES['preview.print']]).toEqual(['preview']);
  });

  it('ships Ctrl+P on Windows and Linux, Cmd+P on macOS', () => {
    expect(shippedBindingsFor('windows').bindings['preview.print']).toEqual(['Ctrl+P']);
    expect(shippedBindingsFor('linux').bindings['preview.print']).toEqual(['Ctrl+P']);
    expect(shippedBindingsFor('macos').bindings['preview.print']).toEqual(['Meta+P']);
  });

  it('resolves Ctrl+P in a preview, and leaves it to the shell in a terminal and to the editor', () => {
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'p', ctrl: true }, 'preview')).toBe('preview.print');
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'p', ctrl: true }, 'terminal')).not.toBe('preview.print');
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'p', ctrl: true }, 'editor')).not.toBe('preview.print');
  });

  it('collides with no other shipped chord', () => {
    const clashes = chordCollisions(DEFAULT_KEYBINDINGS.bindings).filter((c) => JSON.stringify(c).includes('preview.print'));
    expect(clashes).toEqual([]);
  });

  it('has a descriptor', () => {
    expect(KEYBINDINGS_METADATA.some((d) => d.key === 'preview.print')).toBe(true);
  });
});
