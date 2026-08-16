/**
 * `editor.navigation`'s two remember leaves (033 Phase 8, FR-058 / FR-062 / FR-063).
 *
 * Both ship **off**. That is the requirement rather than a convenience: FR-057 says the second
 * invocation of a modal looks exactly like the first, so remembering is something a user opts into,
 * and a default of `true` here would change what every existing installation does on upgrade.
 *
 * The parse is asserted KEY BY KEY, because the section is parsed field by field. A settings file
 * written before this feature has no `navigation` block at all; one hand-edited badly may have one
 * good leaf and one nonsense leaf, and the good one must survive its neighbour.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '../../src/config/app-settings.js';

describe('editor.navigation remember settings (033, FR-058/FR-062/FR-063)', () => {
  it('ships both OFF (FR-058 — the shipped default is that neither modal remembers)', () => {
    expect(DEFAULT_APP_SETTINGS.editor.navigation.rememberQuickOpenQuery).toBe(false);
    expect(DEFAULT_APP_SETTINGS.editor.navigation.rememberGotoLineNumber).toBe(false);
  });

  it('defaults both to false when the whole document is empty', () => {
    const s = parseAppSettings({});
    expect(s.editor.navigation.rememberQuickOpenQuery).toBe(false);
    expect(s.editor.navigation.rememberGotoLineNumber).toBe(false);
  });

  it('defaults both to false when the editor section exists but names no navigation block', () => {
    const s = parseAppSettings({ editor: { autoSave: true } });
    expect(s.editor.navigation.rememberQuickOpenQuery).toBe(false);
    expect(s.editor.navigation.rememberGotoLineNumber).toBe(false);
  });

  it('defaults both to false when the navigation block is not an object at all', () => {
    for (const bad of [null, 42, 'yes', [], true]) {
      const s = parseAppSettings({ editor: { navigation: bad } });
      expect(s.editor.navigation.rememberQuickOpenQuery).toBe(false);
      expect(s.editor.navigation.rememberGotoLineNumber).toBe(false);
    }
  });

  it('honours an explicit true for each, independently', () => {
    const q = parseAppSettings({ editor: { navigation: { rememberQuickOpenQuery: true } } });
    expect(q.editor.navigation.rememberQuickOpenQuery).toBe(true);
    expect(q.editor.navigation.rememberGotoLineNumber).toBe(false);

    const g = parseAppSettings({ editor: { navigation: { rememberGotoLineNumber: true } } });
    expect(g.editor.navigation.rememberQuickOpenQuery).toBe(false);
    expect(g.editor.navigation.rememberGotoLineNumber).toBe(true);

    const both = parseAppSettings({
      editor: { navigation: { rememberQuickOpenQuery: true, rememberGotoLineNumber: true } },
    });
    expect(both.editor.navigation.rememberQuickOpenQuery).toBe(true);
    expect(both.editor.navigation.rememberGotoLineNumber).toBe(true);
  });

  it('falls back KEY BY KEY — a non-boolean leaf never costs its neighbour', () => {
    const s = parseAppSettings({
      editor: {
        navigation: { rememberQuickOpenQuery: 'on', rememberGotoLineNumber: true },
      },
    });
    expect(s.editor.navigation.rememberQuickOpenQuery).toBe(false);
    expect(s.editor.navigation.rememberGotoLineNumber).toBe(true);

    const flipped = parseAppSettings({
      editor: {
        navigation: { rememberQuickOpenQuery: true, rememberGotoLineNumber: 1 },
      },
    });
    expect(flipped.editor.navigation.rememberQuickOpenQuery).toBe(true);
    expect(flipped.editor.navigation.rememberGotoLineNumber).toBe(false);
  });

  it('leaves the sibling exclusion setting alone (the block is three leaves, parsed separately)', () => {
    const s = parseAppSettings({
      editor: {
        navigation: { quickOpenExcludeHidden: false, rememberQuickOpenQuery: true },
      },
    });
    expect(s.editor.navigation.quickOpenExcludeHidden).toBe(false);
    expect(s.editor.navigation.rememberQuickOpenQuery).toBe(true);
    expect(s.editor.navigation.rememberGotoLineNumber).toBe(false);
  });

  it('hands each caller its OWN navigation object, never the shipped one', () => {
    const a = parseAppSettings({});
    const b = parseAppSettings({});
    expect(a.editor.navigation).not.toBe(b.editor.navigation);
    expect(a.editor.navigation).not.toBe(DEFAULT_APP_SETTINGS.editor.navigation);
  });
});
