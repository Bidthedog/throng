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
  isThemeTokenOverridden,
  themeTokenDiffersFromEntry,
  type AppSettings,
  type Keybindings,
  type ShippedDefaults,
  type Theme,
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

/**
 * Theme-token overridden / differs-from-entry (issue #76) — the predicates behind the per-TOKEN
 * Reset and Revert affordances on the Themes tab. Same shape as the setting/binding pair: reset
 * asks "what does Throng ship?", revert asks "what did this window open with?".
 *
 * A theme IS its file (no override layer like settings.json), so the comparison is a plain
 * value-at-key equality; "reset" writes the shipped leaf as an ordinary token edit.
 */
describe('theme-token overridden / differs-from-entry (#76)', () => {
  const base: Theme = {
    name: 'T',
    colours: { surface: '#111', accent: '#2a2' },
    fonts: { ui: 'Inter', mono: 'Fira' },
    icons: { folder: 'F' },
  };

  describe('isThemeTokenOverridden', () => {
    it('is false when the token equals its shipped value', () => {
      expect(isThemeTokenOverridden(base, base, 'colours.surface')).toBe(false);
    });

    it('is true when the token differs from shipped', () => {
      const edited: Theme = { ...base, colours: { ...base.colours, surface: '#fff' } };
      expect(isThemeTokenOverridden(edited, base, 'colours.surface')).toBe(true);
    });

    it('is false when there is NO shipped baseline (a custom theme is not resettable)', () => {
      // A user/cloned theme has no shipped record; reset must be declined, never falsely offered.
      expect(isThemeTokenOverridden(base, undefined, 'colours.surface')).toBe(false);
    });

    it('treats a shipped-UNSET field as overridden once the user pins a value (inherit-based reset)', () => {
      // Typography overrides (button included) and the optional colour tokens ship UNSET — their
      // default is "inherit", not a concrete value. The editable token set is derived from the schema,
      // so a MISSING shipped leaf here means "the default is inherit", NOT "not a real field / not
      // resettable" (which is what it means for a setting or a binding). Pinning a concrete value IS an
      // override, and Reset returns it to inherit by clearing the leaf. Without this, every button
      // typography field and every optional colour would report a permanently-disabled Reset.
      const shippedUnset: Theme = { ...base, colours: { surface: '#111' } }; // no accent leaf
      const pinned: Theme = { ...base, colours: { surface: '#111', accent: '#2a2' } };
      expect(isThemeTokenOverridden(pinned, shippedUnset, 'colours.accent')).toBe(true);
      // …and NOT overridden while the user leaves it unset, matching shipped:
      expect(isThemeTokenOverridden(shippedUnset, shippedUnset, 'colours.accent')).toBe(false);
    });

    it('offers reset for a typography override the theme leaves unset (button font, casing, italic…)', () => {
      // `button: {}` — every attribute inherits the base font. Toggling italic on is an override the
      // user must be able to undo; the shipped leaf is undefined, so this is the exact case that used
      // to report Reset disabled for all seven button typography fields on every theme.
      const shippedT: Theme = { ...base, typography: { button: {} } };
      const pinned: Theme = { ...base, typography: { button: { italic: true } } };
      expect(isThemeTokenOverridden(pinned, shippedT, 'typography.button.italic')).toBe(true);
      expect(isThemeTokenOverridden(shippedT, shippedT, 'typography.button.italic')).toBe(false);
    });

    it('never resolves inherited prototype keys', () => {
      expect(isThemeTokenOverridden(base, base, 'colours.__proto__')).toBe(false);
      expect(isThemeTokenOverridden(base, base, 'constructor')).toBe(false);
    });

    it('compares a nested typography leaf structurally', () => {
      const shippedT: Theme = { ...base, typography: { paneTitle: { sizePx: 11 } } };
      const same: Theme = { ...base, typography: { paneTitle: { sizePx: 11 } } };
      const diff: Theme = { ...base, typography: { paneTitle: { sizePx: 13 } } };
      expect(isThemeTokenOverridden(same, shippedT, 'typography.paneTitle.sizePx')).toBe(false);
      expect(isThemeTokenOverridden(diff, shippedT, 'typography.paneTitle.sizePx')).toBe(true);
    });
  });

  describe('themeTokenDiffersFromEntry', () => {
    it('is false when the token equals the on-entry value', () => {
      expect(themeTokenDiffersFromEntry(base, base, 'colours.surface')).toBe(false);
    });

    it('is true when the token differs from the on-entry value', () => {
      const edited: Theme = { ...base, colours: { ...base.colours, surface: '#000' } };
      expect(themeTokenDiffersFromEntry(edited, base, 'colours.surface')).toBe(true);
    });

    it('reflects the ENTRY value, not the shipped value', () => {
      // A user who opened the window with an ALREADY-edited token should revert to THAT, not to
      // shipped — the same reason settings keep reset and revert distinct.
      const entry: Theme = { ...base, colours: { ...base.colours, surface: '#abc' } };
      const current: Theme = { ...base, colours: { ...base.colours, surface: '#abc' } };
      expect(themeTokenDiffersFromEntry(current, entry, 'colours.surface')).toBe(false);
      // …even though it differs from shipped:
      expect(isThemeTokenOverridden(current, base, 'colours.surface')).toBe(true);
    });
  });
});
