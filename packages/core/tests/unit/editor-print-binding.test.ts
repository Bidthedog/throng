/**
 * `editor.print` — Print… for an editor's document: live in an editor only (never a terminal, where Ctrl+P is
 * readline's previous-history), ships Ctrl+P (Cmd+P on macOS) like the preview's Print…, collides with nothing in
 * its scope, and is described for the key bindings editor.
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

describe('editor.print', () => {
  it('is live in an editor and nowhere else', () => {
    expect([...COMMAND_SCOPES['editor.print']]).toEqual(['editor']);
  });

  it('ships Ctrl+P on Windows and Linux, Cmd+P on macOS — the preview Print…\'s chord', () => {
    expect(shippedBindingsFor('windows').bindings['editor.print']).toEqual(['Ctrl+P']);
    expect(shippedBindingsFor('linux').bindings['editor.print']).toEqual(['Ctrl+P']);
    expect(shippedBindingsFor('macos').bindings['editor.print']).toEqual(['Meta+P']);
  });

  it('resolves Ctrl+P in an editor, the preview\'s own Print… in a preview, and nothing in a terminal', () => {
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'p', ctrl: true }, 'editor')).toBe('editor.print');
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'p', ctrl: true }, 'preview')).toBe('preview.print');
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'p', ctrl: true }, 'terminal')).toBeNull();
  });

  it('collides with no other shipped chord', () => {
    const clashes = chordCollisions(DEFAULT_KEYBINDINGS.bindings).filter((c) => JSON.stringify(c).includes('editor.print'));
    expect(clashes).toEqual([]);
  });

  it('has a descriptor in the Editor group', () => {
    expect(KEYBINDINGS_METADATA.find((d) => d.key === 'editor.print')).toMatchObject({ group: 'Editor', label: 'Print…' });
  });
});
