import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_SEARCH_EXCLUDE_GLOBS,
  SETTINGS_METADATA,
  parseAppSettings,
} from '@throng/core';

/**
 * 060 #532 T042 (FR-026, FR-028, FR-039, research R20) — Find in Files' own exclusion preferences.
 */
describe('search.inFiles.excludeGlobs', () => {
  it('ships the search exclusion list, not the File Explorer’s', () => {
    expect(DEFAULT_APP_SETTINGS.search.inFiles.excludeGlobs).toEqual([...DEFAULT_SEARCH_EXCLUDE_GLOBS]);
    expect(DEFAULT_APP_SETTINGS.search.inFiles.excludeGlobs).not.toEqual(DEFAULT_APP_SETTINGS.explorer.excludeGlobs);
  });

  it('honours an explicit list, an explicit empty list, and drops non-strings', () => {
    const parse = (excludeGlobs: unknown) =>
      parseAppSettings({ search: { inFiles: { excludeGlobs } } }).search.inFiles.excludeGlobs;
    expect(parse(['**/a', 3, '**/b'])).toEqual(['**/a', '**/b']);
    expect(parse([])).toEqual([]);
    expect(parse('nope')).toEqual([...DEFAULT_SEARCH_EXCLUDE_GLOBS]);
  });

  it('is filled with the default when a file written before #532 has no such key', () => {
    expect(parseAppSettings({ search: { inFiles: { trigger: 'run' } } }).search.inFiles.excludeGlobs).toEqual([
      ...DEFAULT_SEARCH_EXCLUDE_GLOBS,
    ]);
  });

  it('is copied, not shared, when the defaults are parsed from nothing', () => {
    const copy = parseAppSettings(undefined);
    expect(copy.search.inFiles.excludeGlobs).not.toBe(DEFAULT_APP_SETTINGS.search.inFiles.excludeGlobs);
  });

  it('is edited as a list under Search · Find in Files', () => {
    const d = SETTINGS_METADATA.find((m) => m.key === 'search.inFiles.excludeGlobs');
    expect(d).toMatchObject({ group: 'Search · Find in Files', control: 'array', itemControl: 'text' });
  });
});

describe('search.inFiles.useExcludeGlobs', () => {
  it('defaults to on, and is a toggle under Search · Find in Files', () => {
    expect(DEFAULT_APP_SETTINGS.search.inFiles.useExcludeGlobs).toBe(true);
    const d = SETTINGS_METADATA.find((m) => m.key === 'search.inFiles.useExcludeGlobs');
    expect(d).toMatchObject({ group: 'Search · Find in Files', control: 'toggle' });
  });

  it('falls back to its default for a non-boolean', () => {
    expect(parseAppSettings({ search: { inFiles: { useExcludeGlobs: 'yes' } } }).search.inFiles.useExcludeGlobs).toBe(true);
    expect(parseAppSettings({ search: { inFiles: { useExcludeGlobs: false } } }).search.inFiles.useExcludeGlobs).toBe(false);
  });
});
