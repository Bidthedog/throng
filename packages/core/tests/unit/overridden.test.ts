/**
 * The overridden-test (015, FR-004a/FR-004b) — the predicate that decides when a
 * per-item reset affordance is shown. The affordance IS the row's "modified" cue,
 * so a false positive offers the user a reset that would change nothing visible.
 */
import { describe, expect, it } from 'vitest';
import {
  buildShippedDefaults,
  isBindingOverridden,
  isSettingOverridden,
  type AppSettings,
  type Keybindings,
  type ShippedDefaults,
} from '../../src/index.js';

const shipped = buildShippedDefaults();

/** A shipped record with a synthetic action that ships UNBOUND (empty chord set). */
function shippedWithUnboundAction(): ShippedDefaults {
  return {
    ...shipped,
    keybindings: {
      ...shipped.keybindings,
      bindings: { ...shipped.keybindings.bindings, 'test.unbound': [] },
    },
  } as ShippedDefaults;
}

function bindings(over: Record<string, string[]>): Keybindings {
  return {
    version: shipped.keybindings.version,
    bindings: { ...shipped.keybindings.bindings, ...over },
  };
}

describe('isSettingOverridden', () => {
  it('is false for a leaf still at its shipped value', () => {
    expect(isSettingOverridden(shipped.settings, 'editor.autoSave', shipped)).toBe(false);
  });

  it('is true for a changed leaf', () => {
    const current = JSON.parse(JSON.stringify(shipped.settings)) as AppSettings;
    current.editor.autoSave = !shipped.settings.editor.autoSave;
    expect(isSettingOverridden(current, 'editor.autoSave', shipped)).toBe(true);
  });

  it('resolves a nested leaf by its dotted path, leaving siblings out of it', () => {
    const current = JSON.parse(JSON.stringify(shipped.settings)) as AppSettings;
    current.appearance.theme = 'definitely-not-the-shipped-theme';
    expect(isSettingOverridden(current, 'appearance.theme', shipped)).toBe(true);
    expect(isSettingOverridden(current, 'editor.autoSave', shipped)).toBe(false);
  });

  it('reports a path absent from the shipped record as NOT overridden (it is not resettable)', () => {
    expect(isSettingOverridden(shipped.settings, 'nonsense.madeUpKey', shipped)).toBe(false);
  });
});

describe('isBindingOverridden', () => {
  it('is false for an action still at its shipped chords', () => {
    expect(isBindingOverridden(shipped.keybindings, 'search.find', shipped)).toBe(false);
  });

  it('is true when the chords differ', () => {
    const current = bindings({ 'search.find': ['Ctrl+Shift+P'] });
    expect(isBindingOverridden(current, 'search.find', shipped)).toBe(true);
  });

  it('ignores chord ORDER — a reorder is not a modification', () => {
    const shippedChords = shipped.keybindings.bindings['search.findNext'] ?? [];
    const current = bindings({ 'search.findNext': [...shippedChords].reverse() });
    expect(isBindingOverridden(current, 'search.findNext', shipped)).toBe(false);
  });

  it('ignores chord CAPITALISATION', () => {
    const shippedChords = shipped.keybindings.bindings['search.find'] ?? [];
    const current = bindings({ 'search.find': shippedChords.map((c) => c.toLowerCase()) });
    expect(isBindingOverridden(current, 'search.find', shipped)).toBe(false);
  });

  it('treats an extra chord as a modification even though the shipped chord is still present', () => {
    const shippedChords = shipped.keybindings.bindings['search.find'] ?? [];
    const current = bindings({ 'search.find': [...shippedChords, 'Ctrl+Alt+Q'] });
    expect(isBindingOverridden(current, 'search.find', shipped)).toBe(true);
  });

  it('treats an action that SHIPS UNBOUND as overridden once the user binds it', () => {
    const rec = shippedWithUnboundAction();
    const current: Keybindings = {
      version: rec.keybindings.version,
      bindings: { ...rec.keybindings.bindings, 'test.unbound': ['Ctrl+U'] },
    };
    expect(isBindingOverridden(current, 'test.unbound', rec)).toBe(true);
  });

  it('treats an action that SHIPS UNBOUND and is still unbound as NOT overridden', () => {
    const rec = shippedWithUnboundAction();
    expect(isBindingOverridden(rec.keybindings, 'test.unbound', rec)).toBe(false);
  });

  it('reports an action absent from the shipped record as NOT overridden (it is not resettable)', () => {
    const current = bindings({ 'user.inventedThis': ['Ctrl+Q'] });
    expect(isBindingOverridden(current, 'user.inventedThis', shipped)).toBe(false);
  });
});

describe('inherited Object.prototype keys are not mistaken for configuration', () => {
  // The IPC handlers accept an arbitrary string, and plain bracket access resolves keys
  // inherited from Object.prototype — so `__proto__` / `constructor` / `toString` would
  // otherwise look like real settings with "shipped defaults", defeating the contract's
  // promise that an unknown key is refused and NOTHING is written.
  const attacks = ['__proto__', 'constructor', 'toString', 'editor.constructor'];

  it('reports no prototype key as an overridden setting', () => {
    for (const path of attacks) {
      expect(isSettingOverridden(shipped.settings, path, shipped), path).toBe(false);
    }
  });

  it('reports no prototype key as an overridden binding', () => {
    for (const action of attacks) {
      expect(isBindingOverridden(shipped.keybindings, action, shipped), action).toBe(false);
    }
  });
});
