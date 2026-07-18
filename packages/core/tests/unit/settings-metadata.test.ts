import { describe, it, expect } from 'vitest';
import {
  SETTINGS_METADATA,
  SETTINGS_INTERNAL_KEYS,
  HIDDEN_TERMINAL_FLAVOUR_DESCRIPTORS,
  settingsLeaves,
} from '../../src/config/settings-metadata.js';
import {
  assertEveryKeyDescribed,
  auditRegistry,
  leavesOf,
  leavesOfDeclared,
} from '../../src/config/metadata.js';
import { DEFAULT_APP_SETTINGS } from '../../src/config/app-settings.js';

describe('SETTINGS_METADATA completeness (FR-047)', () => {
  it('describes every configurable settings leaf and no unknown keys', () => {
    const keys = settingsLeaves();
    expect(() => assertEveryKeyDescribed(keys, SETTINGS_METADATA)).not.toThrow();
    // no missing/unknown/duplicated
    expect(auditRegistry(keys, SETTINGS_METADATA)).toEqual({
      missing: [],
      unknown: [],
      duplicated: [],
    });
  });

  it('excludes only the internal version marker from the configurable set', () => {
    // A declared MAP is ONE leaf (016, F5). Its rows are the user's DATA — `.foo` → Python, Go →
    // tabs — not fields of the settings schema, so they cannot each carry a descriptor. Walking
    // into them would demand one for `editor.indentByLanguage.csharp.style`, and a new row a user
    // added at runtime would make their own configuration fail its own completeness check.
    const allLeaves = leavesOfDeclared(DEFAULT_APP_SETTINGS, SETTINGS_METADATA);
    const configurable = settingsLeaves();
    expect(leavesOf(DEFAULT_APP_SETTINGS)).toContain('version');
    expect(configurable).not.toContain('version');
    // Every non-internal leaf is configurable.
    for (const leaf of allLeaves) {
      if (!SETTINGS_INTERNAL_KEYS.includes(leaf)) expect(configurable).toContain(leaf);
    }
    // …and the maps are leaves in their own right, not doors into the user's rows.
    expect(allLeaves).toContain('editor.indentByLanguage');
    expect(allLeaves).not.toContain('editor.indentByLanguage.csharp.style');
  });

  it('has unique descriptor keys', () => {
    const seen = new Set<string>();
    for (const d of SETTINGS_METADATA) {
      expect(seen.has(d.key), `duplicate ${d.key}`).toBe(false);
      seen.add(d.key);
    }
  });
});

describe('SETTINGS_METADATA control types (FR-028/029)', () => {
  const byKey = new Map(SETTINGS_METADATA.map((d) => [d.key, d]));

  it('enumerated leaves are a constrained select with the right allowed values', () => {
    const confirm = byKey.get('confirmations.destroyProject');
    expect(confirm?.control).toBe('select');
    expect(confirm?.allowedValues).toEqual(['none', 'single', 'double']);

    expect(byKey.get('editor.openOnClick')?.allowedValues).toEqual(['single', 'double', 'none']);
    expect(byKey.get('explorer.deleteMode')?.allowedValues).toEqual(['recycle', 'permanent']);
    expect(byKey.get('explorer.dragCopyModifier')?.allowedValues).toEqual(['ctrl', 'shift', 'alt']);
    expect(byKey.get('editor.saveAllScope')?.allowedValues).toEqual(['tab', 'project', 'all']);
    expect(byKey.get('editor.defaultLineEnding')?.allowedValues).toEqual(['lf', 'crlf', 'cr']);
  });

  it('every descriptor with allowedValues uses a choice control, never text', () => {
    for (const d of SETTINGS_METADATA) {
      if (d.allowedValues) {
        expect(['select', 'multiselect', 'enum'], d.key).toContain(d.control);
      }
    }
  });

  it('matches control to value type', () => {
    expect(byKey.get('editor.autoSave')?.control).toBe('toggle');
    expect(byKey.get('editor.warnOnMissingFile')?.control).toBe('toggle');
    expect(byKey.get('panes.projects.maxWidth')?.control).toBe('slider'); // 018: a bounded numeric is DRAGGABLE now (FR-032)
    expect(byKey.get('behaviour.tabHoverActivateMs')?.control).toBe('slider');
    // A slider now, in 5 MB steps: the objection to it was about the RANGE, and the STEP answers it.
    expect(byKey.get('editor.maxOpenFileBytes')?.control).toBe('slider');
    // string arrays → array
    expect(byKey.get('explorer.excludeGlobs')?.control).toBe('array');
    // The three terminal-flavour controls are HIDDEN for v1.0.0 (see the dedicated block below):
    // they are no longer in the rendered registry, so `byKey` does not carry them. Their control
    // shapes are asserted against HIDDEN_TERMINAL_FLAVOUR_DESCRIPTORS instead.
  });

  it('groups every descriptor into a labelled section', () => {
    for (const d of SETTINGS_METADATA) {
      expect(d.group.length, d.key).toBeGreaterThan(0);
      expect(d.label.length, d.key).toBeGreaterThan(0);
      expect(d.description.length, d.key).toBeGreaterThan(0);
    }
  });
});

describe('terminal-flavour controls are HIDDEN for v1.0.0 (#67 → vNext)', () => {
  const rendered = new Map(SETTINGS_METADATA.map((d) => [d.key, d]));
  const hidden = new Map(HIDDEN_TERMINAL_FLAVOUR_DESCRIPTORS.map((d) => [d.key, d]));
  const HIDDEN_KEYS = [
    'terminals.flavours',
    'terminals.disabledBuiltins',
    'terminals.defaultParams',
  ] as const;

  it('classifies all three as internal, so they are not in the configurable set', () => {
    for (const key of HIDDEN_KEYS) {
      expect(SETTINGS_INTERNAL_KEYS, key).toContain(key);
      expect(settingsLeaves(), key).not.toContain(key);
    }
  });

  it('does not render them: no descriptor in the rendered SETTINGS_METADATA', () => {
    for (const key of HIDDEN_KEYS) {
      expect(rendered.has(key), key).toBe(false);
    }
  });

  it('keeps their descriptors intact for vNext re-exposure (a hide, not a revert)', () => {
    // The controls are withheld, not deleted — vNext re-exposes them by spreading this array back
    // into SETTINGS_METADATA. Assert the shapes survive so a stray deletion is caught here.
    expect(hidden.get('terminals.flavours')?.control).toBe('records');
    expect(hidden.get('terminals.flavours')?.idKey).toBe('id');
    expect(hidden.get('terminals.disabledBuiltins')?.control).toBe('multiselect');
    expect(hidden.get('terminals.defaultParams')?.control).toBe('map');
  });
});

describe('SETTINGS_METADATA new-project + verb changes (011)', () => {
  const byKey = new Map(SETTINGS_METADATA.map((d) => [d.key, d]));

  it('describes the starting-folder choice as a select', () => {
    const d = byKey.get('newProject.startingFolder');
    expect(d?.control).toBe('select');
    expect(d?.allowedValues).toEqual(['profile', 'lastViewed', 'override']);
  });

  it('describes the override path with the folder control', () => {
    expect(byKey.get('newProject.overridePath')?.control).toBe('folder');
  });

  it('treats lastProjectFolder as internal (no descriptor, not configurable)', () => {
    expect(SETTINGS_INTERNAL_KEYS).toContain('newProject.lastProjectFolder');
    expect(byKey.has('newProject.lastProjectFolder')).toBe(false);
    expect(settingsLeaves()).not.toContain('newProject.lastProjectFolder');
  });

  it('re-aligns the confirmation labels to the new verbs (keys unchanged)', () => {
    expect(byKey.get('confirmations.destroyProject')?.label).toBe('Remove a project');
    expect(byKey.get('confirmations.destroySubWorkspace')?.label).toBe('Destroy a sub-workspace');
  });
});
