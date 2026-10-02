/**
 * `editor.highlightOccurrences` — the one setting governing selection-occurrence tinting in editors AND
 * Markdown previews (049 FR-019, contracts/surfaces-tokens-setting.md *Setting*). Unit tier: every claim is
 * about the two pure registries, `DEFAULT_APP_SETTINGS` and `SETTINGS_METADATA`.
 */
import { describe, it, expect } from 'vitest';
import { SETTINGS_METADATA, settingsLeaves } from '../../src/config/settings-metadata.js';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '../../src/config/app-settings.js';
import type { FieldDescriptor } from '../../src/config/metadata.js';

const KEY = 'editor.highlightOccurrences';

const descriptor = (): FieldDescriptor => {
  const found = SETTINGS_METADATA.find((d) => d.key === KEY);
  expect(found, `no descriptor for ${KEY}`).toBeDefined();
  return found as FieldDescriptor;
};

describe('editor.highlightOccurrences exists and ships on (FR-019)', () => {
  it('is a boolean defaulting to true', () => {
    expect(DEFAULT_APP_SETTINGS.editor.highlightOccurrences).toBe(true);
  });

  it('is a configurable leaf', () => {
    expect(settingsLeaves()).toContain(KEY);
  });

  it('survives the parse path — a stored false comes back false (the silent-drop guard)', () => {
    expect(parseAppSettings({ editor: { highlightOccurrences: false } }).editor.highlightOccurrences).toBe(false);
    expect(parseAppSettings({ editor: { highlightOccurrences: true } }).editor.highlightOccurrences).toBe(true);
  });

  it('falls back to the default for a non-boolean', () => {
    expect(parseAppSettings({ editor: { highlightOccurrences: 'yes' } }).editor.highlightOccurrences).toBe(true);
    expect(parseAppSettings({ editor: {} }).editor.highlightOccurrences).toBe(true);
  });
});

describe('it is a plain Editor toggle with the contract copy', () => {
  it('is a toggle under Editor with no subgroup', () => {
    const d = descriptor();
    expect(d.control).toBe('toggle');
    expect(d.group).toBe('Editor');
    expect(d.subgroup).toBeUndefined();
  });

  it('is labelled as the contract says', () => {
    expect(descriptor().label).toBe('Highlight other occurrences of the selection');
  });

  it('says it covers previews as well as editors, and that it is only a tint', () => {
    const text = descriptor().description.toLowerCase();
    expect(text).toContain('editor');
    expect(text).toContain('preview');
    expect(text).toMatch(/tint/);
  });
});
