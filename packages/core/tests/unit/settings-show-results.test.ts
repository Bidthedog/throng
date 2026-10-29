import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, SETTINGS_METADATA, parseAppSettings } from '@throng/core';

/** 060 FR-043 — whether Find in Files shows its results collapsed or expanded. */
describe('search.inFiles.showResults', () => {
  const parse = (showResults: unknown) =>
    parseAppSettings({ search: { inFiles: { showResults } } }).search.inFiles.showResults;

  it('ships expanded', () => {
    expect(DEFAULT_APP_SETTINGS.search.inFiles.showResults).toBe('expanded');
  });

  it('honours both values and reads anything else as the default', () => {
    expect(parse('collapsed')).toBe('collapsed');
    expect(parse('expanded')).toBe('expanded');
    expect(parse('sideways')).toBe('expanded');
    expect(parse(1)).toBe('expanded');
  });

  it('is a two-value select under Search · Find in Files, labelled Show results', () => {
    const d = SETTINGS_METADATA.find((m) => m.key === 'search.inFiles.showResults');
    expect(d).toMatchObject({
      label: 'Show results',
      group: 'Search · Find in Files',
      control: 'select',
      allowedValues: ['collapsed', 'expanded'],
    });
  });
});
