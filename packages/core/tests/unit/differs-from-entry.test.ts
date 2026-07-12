/**
 * The differs-from-entry test (015, FR-016) — the predicate behind the per-item REVERT
 * affordance.
 *
 * Reset and revert answer different questions, and the difference is the whole point of having
 * both: reset asks "what does Throng ship?", revert asks "what did I start this session with?".
 * The case that proves they are not the same is an item that was ALREADY overridden when the
 * preferences window opened: edit it, revert it, and it must come back to that override — not to
 * the shipped default. A predicate that quietly compared against the shipped record would pass
 * every other test in this file and fail that one.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  bindingDiffersFromEntry,
  settingDiffersFromEntry,
  setAtPath,
  type AppSettings,
  type Keybindings,
} from '../../src/index.js';

function settingsWith(path: string, value: unknown): AppSettings {
  return setAtPath(DEFAULT_APP_SETTINGS, path, value);
}

function bindingsWith(action: string, chords: string[]): Keybindings {
  return { ...DEFAULT_KEYBINDINGS, bindings: { ...DEFAULT_KEYBINDINGS.bindings, [action]: chords } };
}

describe('settingDiffersFromEntry', () => {
  it('is false when the leaf is untouched since the window opened', () => {
    const entry = settingsWith('editor.autoSaveDebounceMs', 900);
    expect(settingDiffersFromEntry(entry, entry, 'editor.autoSaveDebounceMs')).toBe(false);
  });

  it('is true once the leaf has been edited this session', () => {
    const entry = settingsWith('editor.autoSaveDebounceMs', 900);
    const current = settingsWith('editor.autoSaveDebounceMs', 1500);
    expect(settingDiffersFromEntry(current, entry, 'editor.autoSaveDebounceMs')).toBe(true);
  });

  it('compares against the ON-ENTRY value, not the shipped default', () => {
    // The user arrives with this leaf already overridden. That override IS their starting point.
    const shipped = DEFAULT_APP_SETTINGS.editor.autoSaveDebounceMs;
    const entry = settingsWith('editor.autoSaveDebounceMs', 900);
    expect(900).not.toBe(shipped); // the premise of the test

    // Editing away from the override: revert is offered.
    const edited = settingsWith('editor.autoSaveDebounceMs', 1500);
    expect(settingDiffersFromEntry(edited, entry, 'editor.autoSaveDebounceMs')).toBe(true);

    // Back at the override: nothing to revert to, even though it is NOT the shipped value.
    expect(settingDiffersFromEntry(entry, entry, 'editor.autoSaveDebounceMs')).toBe(false);

    // At the SHIPPED value: that is a change from where the session started, so revert IS offered
    // — this is what a per-item reset leaves behind, and it must remain undoable.
    const atShipped = settingsWith('editor.autoSaveDebounceMs', shipped);
    expect(settingDiffersFromEntry(atShipped, entry, 'editor.autoSaveDebounceMs')).toBe(true);
  });

  it('ignores sibling leaves', () => {
    const entry = DEFAULT_APP_SETTINGS;
    const current = settingsWith('editor.autoSaveDebounceMs', 1500);
    expect(settingDiffersFromEntry(current, entry, 'appearance.theme')).toBe(false);
  });

  it('compares arrays structurally, not by reference', () => {
    const entry = settingsWith('explorer.excludeGlobs', ['**/.git']);
    const same = settingsWith('explorer.excludeGlobs', ['**/.git']);
    const different = settingsWith('explorer.excludeGlobs', []);
    expect(settingDiffersFromEntry(same, entry, 'explorer.excludeGlobs')).toBe(false);
    expect(settingDiffersFromEntry(different, entry, 'explorer.excludeGlobs')).toBe(true);
  });

  it('never resolves a prototype-chain key', () => {
    const entry = DEFAULT_APP_SETTINGS;
    expect(settingDiffersFromEntry(entry, entry, '__proto__')).toBe(false);
    expect(settingDiffersFromEntry(entry, entry, 'constructor')).toBe(false);
    expect(settingDiffersFromEntry(entry, entry, 'editor.__proto__.toString')).toBe(false);
  });
});

describe('bindingDiffersFromEntry', () => {
  it('is false when the action is untouched since the window opened', () => {
    const entry = bindingsWith('zoom.in', ['Ctrl+=']);
    expect(bindingDiffersFromEntry(entry, entry, 'zoom.in')).toBe(false);
  });

  it('is true once a chord has been added or removed this session', () => {
    const entry = bindingsWith('zoom.in', ['Ctrl+=']);
    expect(bindingDiffersFromEntry(bindingsWith('zoom.in', ['Ctrl+=', 'Ctrl++']), entry, 'zoom.in')).toBe(true);
    expect(bindingDiffersFromEntry(bindingsWith('zoom.in', []), entry, 'zoom.in')).toBe(true);
  });

  it('treats chords as a SET — reordering or recasing is not a change', () => {
    const entry = bindingsWith('zoom.in', ['Ctrl+=', 'Ctrl++']);
    const reordered = bindingsWith('zoom.in', ['Ctrl++', 'Ctrl+=']);
    const recased = bindingsWith('zoom.in', ['ctrl+=', 'CTRL++']);
    expect(bindingDiffersFromEntry(reordered, entry, 'zoom.in')).toBe(false);
    expect(bindingDiffersFromEntry(recased, entry, 'zoom.in')).toBe(false);
  });

  it('compares against the ON-ENTRY chords, not the shipped chords', () => {
    // Arrives already rebound. Clearing it (FR-016) is a change; putting it back is not.
    const entry = bindingsWith('zoom.in', ['Alt+Z']);
    expect(bindingDiffersFromEntry(bindingsWith('zoom.in', []), entry, 'zoom.in')).toBe(true);
    expect(bindingDiffersFromEntry(entry, entry, 'zoom.in')).toBe(false);
  });

  it('treats an action bound this session, absent on entry, as changed', () => {
    const entry: Keybindings = { ...DEFAULT_KEYBINDINGS, bindings: {} };
    expect(bindingDiffersFromEntry(bindingsWith('zoom.in', ['Ctrl+=']), entry, 'zoom.in')).toBe(true);
  });

  it('never resolves a prototype-chain action id', () => {
    const entry = DEFAULT_KEYBINDINGS;
    expect(bindingDiffersFromEntry(entry, entry, '__proto__')).toBe(false);
    expect(bindingDiffersFromEntry(entry, entry, 'constructor')).toBe(false);
  });
});
