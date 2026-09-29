/**
 * 047 T013 — `editor.markdownSectionsOpen` (data-model.md "Settings", research R3/R11, FR-039).
 *
 * An `editor.*` setting rather than a Markdown PROVIDER leaf: it governs the initial fold state of
 * both the editor and the preview, so it must not be disabled when Markdown previews are off — the
 * reason data-model.md gives it "no subgroup" rather than `Editor → Previews`.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '../../src/config/app-settings.js';
import { SETTINGS_METADATA, settingsLeaves } from '../../src/config/settings-metadata.js';
import { auditRegistry, assertEveryKeyDescribed } from '../../src/config/metadata.js';

const KEY = 'editor.markdownSectionsOpen';

describe('editor.markdownSectionsOpen — default and type', () => {
  it('ships "expanded"', () => {
    expect(DEFAULT_APP_SETTINGS.editor.markdownSectionsOpen).toBe('expanded');
  });
});

describe('editor.markdownSectionsOpen — descriptor', () => {
  const d = SETTINGS_METADATA.find((m) => m.key === KEY);

  it('is described, under Editor, with no subgroup', () => {
    expect(d, `no descriptor for ${KEY}`).toBeDefined();
    expect(d!.group).toBe('Editor');
    expect(d!.subgroup).toBeUndefined();
  });

  it('is a select offering Expanded and Collapsed, labelled "Markdown sections open"', () => {
    expect(d!.control).toBe('select');
    expect(d!.label).toBe('Markdown sections open');
    expect([...(d!.allowedValues ?? [])].sort()).toEqual(['collapsed', 'expanded']);
    expect(d!.description.length).toBeGreaterThan(0);
  });

  it('is never disabled by a provider — it governs the editor as well as the preview (FR-039)', () => {
    expect(d!.enabledWhen).toBeUndefined();
  });
});

describe('editor.markdownSectionsOpen — parse, tolerant per leaf', () => {
  it('keeps a valid value', () => {
    const parsed = parseAppSettings({ editor: { markdownSectionsOpen: 'collapsed' } });
    expect(parsed.editor.markdownSectionsOpen).toBe('collapsed');
  });

  it('falls back to the default for an invalid value, and keeps its neighbours', () => {
    const parsed = parseAppSettings({
      editor: { markdownSectionsOpen: 'sideways', autoSave: true },
    });
    expect(parsed.editor.markdownSectionsOpen).toBe('expanded');
    expect(parsed.editor.autoSave).toBe(true);
  });

  it('falls back to the default when the whole editor section is absent', () => {
    expect(parseAppSettings({}).editor.markdownSectionsOpen).toBe('expanded');
  });
});

describe('settings completeness picks up the new key (FR-047)', () => {
  it('describes it, and the registry has no missing/unknown/duplicated keys', () => {
    const keys = settingsLeaves();
    expect(keys).toContain(KEY);
    expect(() => assertEveryKeyDescribed(keys, SETTINGS_METADATA)).not.toThrow();
    expect(auditRegistry(keys, SETTINGS_METADATA)).toEqual({ missing: [], unknown: [], duplicated: [] });
  });
});
