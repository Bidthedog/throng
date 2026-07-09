import { describe, expect, it } from 'vitest';
import {
  fieldHaystack,
  filterFields,
  matchesQuery,
  searchTokens,
  type SearchableField,
} from '../../src/config/settings-search.js';

/**
 * Settings typeahead search (feature 007, FR-049). Pure matcher: a field matches
 * when ANY whitespace-separated query token is a case-insensitive substring of
 * its key, label, description, or rendered value.
 */

const THEME: SearchableField = {
  key: 'appearance.theme',
  label: 'Theme',
  description: 'The active appearance theme applied across the whole app.',
};
const HOVER: SearchableField = {
  key: 'behaviour.tabHoverActivateMs',
  label: 'Tab hover-activate delay',
  description: 'Dwell time (ms) hovering a tab during a panel drag before it activates.',
};
const GLOBS: SearchableField = {
  key: 'explorer.excludeGlobs',
  label: 'Excluded globs',
  description: 'Paths hidden from the file explorer.',
};
const FIELDS = [THEME, HOVER, GLOBS];
const VALUES: Record<string, unknown> = {
  'appearance.theme': 'throng',
  'behaviour.tabHoverActivateMs': 600,
  'explorer.excludeGlobs': ['**/node_modules', '**/.git'],
};
const valueOf = (f: SearchableField): unknown => VALUES[f.key];

describe('searchTokens', () => {
  it('splits on whitespace, lowercases, and drops empty tokens', () => {
    expect(searchTokens('  Tab   HOVER ')).toEqual(['tab', 'hover']);
  });

  it('is empty for a blank query', () => {
    expect(searchTokens('   ')).toEqual([]);
  });
});

describe('fieldHaystack', () => {
  it('includes the key, label, description and rendered value, lowercased', () => {
    const hay = fieldHaystack(HOVER, 600);
    expect(hay).toContain('behaviour.tabhoveractivatems');
    expect(hay).toContain('tab hover-activate delay');
    expect(hay).toContain('dwell time');
    expect(hay).toContain('600');
  });

  it('flattens array values so any element is searchable', () => {
    expect(fieldHaystack(GLOBS, ['**/node_modules', '**/.git'])).toContain('node_modules');
  });

  it('renders booleans and tolerates null/undefined', () => {
    expect(fieldHaystack(THEME, true)).toContain('true');
    expect(() => fieldHaystack(THEME, null)).not.toThrow();
    expect(() => fieldHaystack(THEME, undefined)).not.toThrow();
  });
});

describe('matchesQuery', () => {
  it('matches on the label', () => {
    expect(matchesQuery('theme', THEME, 'throng')).toBe(true);
  });

  it('matches on the description', () => {
    expect(matchesQuery('dwell', HOVER, 600)).toBe(true);
  });

  it('matches on the value', () => {
    expect(matchesQuery('600', HOVER, 600)).toBe(true);
    expect(matchesQuery('node_modules', GLOBS, VALUES['explorer.excludeGlobs'])).toBe(true);
  });

  it('is case-insensitive and matches partial substrings', () => {
    expect(matchesQuery('HOV', HOVER, 600)).toBe(true);
  });

  it('matches when ANY token matches (OR), not only when all do', () => {
    // 'zzz' matches nothing; 'theme' matches — the field still qualifies.
    expect(matchesQuery('zzz theme', THEME, 'throng')).toBe(true);
  });

  it('does not match when no token matches', () => {
    expect(matchesQuery('zzz qqq', THEME, 'throng')).toBe(false);
  });

  it('matches every field for a blank query', () => {
    expect(matchesQuery('', THEME, 'throng')).toBe(true);
    expect(matchesQuery('   ', HOVER, 600)).toBe(true);
  });
});

describe('filterFields', () => {
  it('returns all fields for a blank query', () => {
    expect(filterFields('', FIELDS, valueOf)).toEqual(FIELDS);
  });

  it('narrows to the fields matching any token, preserving registry order', () => {
    expect(filterFields('theme globs', FIELDS, valueOf)).toEqual([THEME, GLOBS]);
  });

  it('narrows by value', () => {
    expect(filterFields('600', FIELDS, valueOf)).toEqual([HOVER]);
  });

  it('returns nothing when no field matches', () => {
    expect(filterFields('nosuchsetting', FIELDS, valueOf)).toEqual([]);
  });
});
