import { describe, it, expect } from 'vitest';
import { DEFAULT_KEYBINDINGS, parseKeybindings, resolveAction } from '@throng/core';

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

/**
 * 046 T030 (US2, FR-023): "A keybindings file already saved by the user MUST NOT be rewritten. The
 * new commands take their shipped defaults alongside it (026 FR-030)." `parseKeybindings` already
 * fills any action absent from the saved record from `DEFAULT_KEYBINDINGS` on every read (the same
 * tolerant fill `shipped-defaults.ts`'s own version-bump history relies on for prior additive
 * commands) — this pins that behaviour for the four ids this feature adds.
 */
describe('project & focus pane commands reach a pre-046 saved keybindings file for free (FR-023)', () => {
  // Stands in for a keybindings.json written before this feature shipped: it knows nothing of the
  // four new ids, and it carries one of the user's own customisations of an UNRELATED command.
  const savedBeforeThisFeature = {
    version: 1,
    bindings: { 'file.rename': ['F6'] },
  };

  it('resolves each new id to its shipped default when the saved file lacks it', () => {
    // 046 iterate round 1 (T097, FR-102 *changes* row): the four ids now ship on the
    // Ctrl+Shift+Alt navigation tier, not the pre-round Ctrl+Alt family. 046 iterate round 3
    // (T172, FR-117): the two focus commands are on M and B.
    const parsed = parseKeybindings(savedBeforeThisFeature);
    expect(parsed.bindings['project.next']).toEqual(['Ctrl+Shift+Alt+PageDown']);
    expect(parsed.bindings['project.previous']).toEqual(['Ctrl+Shift+Alt+PageUp']);
    expect(parsed.bindings['focus.explorer']).toEqual(['Ctrl+Shift+Alt+M']);
    expect(parsed.bindings['focus.projects']).toEqual(['Ctrl+Shift+Alt+B']);
  });

  it('leaves the user’s own customisation of an unrelated command untouched', () => {
    const parsed = parseKeybindings(savedBeforeThisFeature);
    expect(parsed.bindings['file.rename']).toEqual(['F6']);
  });

  it('never rewrites the saved record it was handed — the fill lands only in the returned copy', () => {
    parseKeybindings(savedBeforeThisFeature);
    expect(savedBeforeThisFeature).toEqual({ version: 1, bindings: { 'file.rename': ['F6'] } });
  });
});
