import { describe, it, expect } from 'vitest';
import { KEYBINDINGS_METADATA } from '../../src/config/keybindings-metadata.js';
import { assertEveryKeyDescribed, auditRegistry } from '../../src/config/metadata.js';
import { DEFAULT_KEYBINDINGS } from '../../src/config/keybindings.js';

const ACTION_IDS = Object.keys(DEFAULT_KEYBINDINGS.bindings);

describe('KEYBINDINGS_METADATA completeness (FR-047/030)', () => {
  it('describes every ActionId and no unknown keys', () => {
    expect(() => assertEveryKeyDescribed(ACTION_IDS, KEYBINDINGS_METADATA)).not.toThrow();
    expect(auditRegistry(ACTION_IDS, KEYBINDINGS_METADATA)).toEqual({
      missing: [],
      unknown: [],
      duplicated: [],
    });
  });

  it('every descriptor is a chord control with label/description/group', () => {
    for (const d of KEYBINDINGS_METADATA) {
      expect(d.control, d.key).toBe('chord');
      expect(d.label.length, d.key).toBeGreaterThan(0);
      expect(d.description.length, d.key).toBeGreaterThan(0);
      expect(d.group.length, d.key).toBeGreaterThan(0);
    }
  });

  it('describes the scroll-sync toggle once, as "Synchronise Scrolling" in Editor (044 FR-122d)', () => {
    const matches = KEYBINDINGS_METADATA.filter((d) => d.key === 'preview.toggleSyncScroll');
    expect(matches).toHaveLength(1);
    expect(matches[0].label).toBe('Synchronise Scrolling');
    expect(matches[0].group).toBe('Editor');
    // Beside "Toggle word wrap", the other view toggle in the group.
    const keys = KEYBINDINGS_METADATA.map((d) => d.key);
    expect(keys.indexOf('preview.toggleSyncScroll')).toBe(keys.indexOf('editor.toggleWordWrap') + 1);
  });

  it('has unique descriptor keys', () => {
    const seen = new Set<string>();
    for (const d of KEYBINDINGS_METADATA) {
      expect(seen.has(d.key), `duplicate ${d.key}`).toBe(false);
      seen.add(d.key);
    }
  });
});
