import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, SETTINGS_METADATA, parseAppSettings } from '@throng/core';

/**
 * 060 FR-046 — `search.inFiles.rememberGrouping` is RETIRED. A panel's grouping choice now sets
 * `search.inFiles.defaultGrouping` itself, so "keep the grouping you chose" has nothing left to say.
 * A persisted value is dropped by the parse, not migrated (019 FR-023's mechanism).
 */
describe('search.inFiles.rememberGrouping (retired)', () => {
  it('is not in the shipped settings', () => {
    expect('rememberGrouping' in DEFAULT_APP_SETTINGS.search.inFiles).toBe(false);
  });

  it('is dropped from a file that still carries it, and its siblings survive', () => {
    const parsed = parseAppSettings({ search: { inFiles: { rememberGrouping: false, defaultGrouping: 'folderTree' } } });
    expect('rememberGrouping' in parsed.search.inFiles).toBe(false);
    expect(parsed.search.inFiles.defaultGrouping).toBe('folderTree');
  });

  it('has no row in Preferences', () => {
    expect(SETTINGS_METADATA.some((d) => d.key === 'search.inFiles.rememberGrouping')).toBe(false);
  });
});
