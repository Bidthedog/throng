import { describe, expect, it } from 'vitest';
import {
  compareRank,
  fieldHaystack,
  filterFields,
  matchesQuery,
  orderRanked,
  rankField,
  searchTokens,
  type SearchableField,
} from '../../src/config/settings-search.js';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';
import { KEYBINDINGS_METADATA } from '../../src/config/keybindings-metadata.js';
import { THEME_METADATA } from '../../src/config/theme-metadata.js';

/**
 * Preferences typeahead search (007 FR-049 as superseded by 079 FR-001–FR-010). Pure matcher: a field
 * matches when EVERY whitespace-separated query token is a case-insensitive substring of its key,
 * label, description, headings or rendered value, and matches are ranked best-first.
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

  it('matches only when EVERY token matches (AND, 079 FR-001)', () => {
    // 'zzz' matches nothing, so the field no longer qualifies even though 'theme' does.
    expect(matchesQuery('zzz theme', THEME, 'throng')).toBe(false);
    // Tokens may be satisfied by different parts of the field: 'theme' by the label, 'whole' by the description.
    expect(matchesQuery('whole theme', THEME, 'throng')).toBe(true);
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

  it('narrows to the fields matching every token (079 FR-001)', () => {
    // No single field holds both "theme" and "globs" any more.
    expect(filterFields('theme globs', FIELDS, valueOf)).toEqual([]);
    expect(filterFields('excluded globs', FIELDS, valueOf)).toEqual([GLOBS]);
  });

  it('narrows by value', () => {
    expect(filterFields('600', FIELDS, valueOf)).toEqual([HOVER]);
  });

  it('returns nothing when no field matches', () => {
    expect(filterFields('nosuchsetting', FIELDS, valueOf)).toEqual([]);
  });
});

/**
 * Section-name search (021, FR-015/016/017). A query that matches a field's GROUP returns the field
 * even when its own name/description/value do not contain the query — so typing a section name returns
 * the whole section, and a parent-area name reaches its nested "Parent · Child" sub-groups. The group
 * is optional: a group-less field behaves exactly as before.
 */
const EDITOR_BG: SearchableField = {
  key: 'colours.editorBg',
  label: 'Editor background',
  description: 'The editor surface colour.',
  group: 'Editor',
};
const SYNTAX_KEYWORD: SearchableField = {
  // Deliberately named so that NEITHER its key, label, description NOR value contains "editor" —
  // only its section ("Editor") does. This is the token the section search must still find.
  key: 'colours.syntaxKeyword',
  label: 'Syntax keyword',
  description: 'Keyword hue.',
  group: 'Editor',
  subgroup: 'Syntax', // 079 FR-014 — the nested block is a subgroup, not an "Editor · Syntax" group string
};
const TERMINAL_FG: SearchableField = {
  key: 'colours.terminalFg',
  label: 'Terminal foreground',
  description: 'The terminal text colour.',
  group: 'Terminal',
};
const GROUPED = [EDITOR_BG, SYNTAX_KEYWORD, TERMINAL_FG];
const groupedValue = (f: SearchableField): unknown =>
  ({ 'colours.editorBg': '#101010', 'colours.syntaxKeyword': '#7ea8ff', 'colours.terminalFg': '#d6deea' } as Record<string, unknown>)[f.key];

describe('section-name search (021, FR-015/016/017)', () => {
  it('includes the group in the haystack, lowercased', () => {
    expect(fieldHaystack(EDITOR_BG, '#101010')).toContain('editor');
    expect(fieldHaystack(SYNTAX_KEYWORD, '#7ea8ff')).toContain('editor');
    expect(fieldHaystack(SYNTAX_KEYWORD, '#7ea8ff')).toContain('syntax');
  });

  it('matches a field by its section name even when its own name does not contain the query', () => {
    // "Syntax keyword" contains no "editor" — only its group does. FR-015.
    expect(matchesQuery('editor', SYNTAX_KEYWORD, '#7ea8ff')).toBe(true);
  });

  it('returns every field of a section for its group name, including nested sub-groups', () => {
    // "editor" matches group "Editor", reaching its Syntax subgroup too; Terminal is excluded. The
    // section's own field comes first (079 FR-009).
    expect(filterFields('editor', GROUPED, groupedValue)).toEqual([EDITOR_BG, SYNTAX_KEYWORD]);
  });

  it('yields each field once, even when the query hits its name and its group', () => {
    // 079 FR-001: "keyword terminal" no longer unions two fields — no field holds both words.
    expect(filterFields('keyword terminal', GROUPED, groupedValue)).toEqual([]);
    expect(filterFields('terminal', GROUPED, groupedValue)).toEqual([TERMINAL_FG]);
  });

  it('leaves a group-less field behaving exactly as before (no throw, group adds nothing)', () => {
    // THEME/HOVER/GLOBS declare no group.
    expect(() => fieldHaystack(THEME, 'throng')).not.toThrow();
    expect(fieldHaystack(THEME, 'throng')).not.toContain('undefined');
    expect(filterFields('theme', FIELDS, valueOf)).toEqual([THEME]);
  });
});

/**
 * SUBSECTION-name search (040, FR-036 over 021 FR-015).
 *
 * 040 gave `FieldDescriptor` a second level of grouping, and every subgroup renders as a VISIBLE
 * `<h4>` heading. 021's invariant — documented on {@link SearchableField.group} — is that a heading
 * the user can read is a heading the user can search by, so a subgroup name must reach its fields
 * exactly as a group name does. It is not a nicety: the heading stays on screen (its group is
 * matched by nothing, so the whole section goes) only when a field survives, so a subgroup name
 * that matches nothing renders "No settings match" while the user is looking at the words they
 * typed.
 *
 * `AUTOSAVE_DELAY` is built so that ONLY its subgroup contains "autosave" — not its key, label,
 * description, group or value. That is the same construction `SYNTAX_KEYWORD` uses for groups, and
 * it is what makes the test fail for the requirement's reason rather than by accident: the one real
 * subgroup shipped today, `Status Bar`, is findable only because "status" and "bar" happen to be
 * substrings of its fields' keys and descriptions.
 */
const AUTOSAVE_DELAY: SearchableField = {
  key: 'editor.persistDelayMs',
  label: 'Persist delay',
  description: 'Dwell time before an unfocused buffer is written back to disk.',
  group: 'Editor',
  subgroup: 'Autosave',
};
const SUBGROUPED = [EDITOR_BG, AUTOSAVE_DELAY, TERMINAL_FG];
const subgroupedValue = (f: SearchableField): unknown =>
  (({
    'colours.editorBg': '#101010',
    'editor.persistDelayMs': 900,
    'colours.terminalFg': '#d6deea',
  }) as Record<string, unknown>)[f.key];

describe('subsection-name search (040, FR-036)', () => {
  it('includes the subgroup in the haystack, lowercased', () => {
    expect(fieldHaystack(AUTOSAVE_DELAY, 900)).toContain('autosave');
  });

  it('matches a field by its SUBSECTION name when nothing else about it does', () => {
    expect(matchesQuery('Autosave', AUTOSAVE_DELAY, 900)).toBe(true);
  });

  it('makes a subsection name as good as a section name — the same field, either way', () => {
    // The invariant in one line: what the group name returns, the subgroup name returns too.
    expect(filterFields('editor', SUBGROUPED, subgroupedValue)).toContain(AUTOSAVE_DELAY);
    expect(filterFields('autosave', SUBGROUPED, subgroupedValue)).toEqual([AUTOSAVE_DELAY]);
  });

  it('leaves a subgroup-less field untouched (absence contributes nothing, not "undefined")', () => {
    expect(fieldHaystack(EDITOR_BG, '#101010')).not.toContain('undefined');
    expect(matchesQuery('autosave', EDITOR_BG, '#101010')).toBe(false);
  });

  // 054 FR-050a — the third heading level obeys the same invariant. Only the subsection says "sketch".
  it('matches a field by its SUBSECTION heading (054 FR-050a)', () => {
    const field: SearchableField = { ...AUTOSAVE_DELAY, subgroup: 'Previews', subsection: 'Sketch' };
    expect(matchesQuery('sketch', field, 900)).toBe(true);
    expect(fieldHaystack(AUTOSAVE_DELAY, 900)).not.toContain('undefined');
  });
});

/**
 * Ranking (079 FR-004–FR-006, the #270 design). A rank is `{ tier, exact }`, lower is better:
 * tier 0 name (label/key) · 1 subgroup (subgroup/subsection) · 2 value · 3 description · 4 group
 * (heading path) · 5 split; exact 0 equals · 1 phrase at start · 2 phrase anywhere · 3 every token at a
 * word boundary · 4 some token mid-word.
 */
const f = (label: string, extra: Partial<SearchableField> = {}): SearchableField => ({
  key: `k.${label.replace(/\s+/g, '')}`,
  label,
  description: '',
  group: 'Navigation',
  ...extra,
});

describe('rankField — field tier (079 FR-004.1, FR-005)', () => {
  it('is undefined for a non-match and for a blank query', () => {
    expect(rankField('zzz', f('Go To Line'), '')).toBeUndefined();
    expect(rankField('   ', f('Go To Line'), '')).toBeUndefined();
  });

  it('ranks a name hit in tier 0, via the label or the key', () => {
    expect(rankField('go to line', f('Go To Line'), '')).toEqual({ tier: 0, exact: 0 });
    expect(rankField('editor.wordwrap', { ...f('Word wrap'), key: 'editor.wordWrap' }, '')).toEqual({ tier: 0, exact: 0 });
  });

  it('counts the key as a name only when the query IS the key — a key prefix is not a name hit', () => {
    // Every `terminals.*` key starts with "terminal"; if that counted as a name hit, typing "terminal"
    // would rank every terminal field level with one whose label really begins "Terminal".
    const byKeyOnly = { ...f('Quiet time', { group: 'Terminal' }), key: 'terminals.attention.quietMs' };
    const byLabel = f('Terminal bell', { group: 'Terminal' });
    expect(rankField('terminal', byKeyOnly, '')?.tier).not.toBe(0);
    expect(rankField('terminal', byLabel, '')).toEqual({ tier: 0, exact: 1 });
  });

  it('ranks a subgroup or subsection heading hit in tier 1', () => {
    expect(rankField('autosave', f('Persist delay', { subgroup: 'Autosave' }), '')?.tier).toBe(1);
    expect(rankField('sketch', f('Persist delay', { subgroup: 'Previews', subsection: 'Sketch' }), '')?.tier).toBe(1);
  });

  it('ranks value, then description, then group, then split', () => {
    expect(rankField('600', f('Delay'), 600)?.tier).toBe(2);
    expect(rankField('dwell', f('Delay', { description: 'Dwell time' }), 0)?.tier).toBe(3);
    expect(rankField('navigation', f('Delay'), 0)?.tier).toBe(4);
    // "delay" is in the label, "dwell" only in the description: no single text holds both.
    expect(rankField('delay dwell', f('Delay', { description: 'Dwell time' }), 0)?.tier).toBe(5);
  });

  it('reads the heading path as one text, so a nested heading name lands in the group tier', () => {
    expect(rankField('editor syntax', f('Keyword', { group: 'Editor', subgroup: 'Syntax' }), '')?.tier).toBe(4);
  });

  it('lets tier dominate exactness: a partial name match beats an exact value match', () => {
    const partialName = rankField('throng', f('Throng window title'), 'x')!;
    const exactValue = rankField('throng', f('Theme'), 'throng')!;
    expect(partialName).toEqual({ tier: 0, exact: 1 });
    expect(exactValue).toEqual({ tier: 2, exact: 0 });
    expect(compareRank(partialName, exactValue)).toBeLessThan(0);
  });
});

describe('rankField — exactness ladder (079 FR-004.2, FR-006)', () => {
  it.each([
    ['go to line', 'Go To Line', 0],
    ['go to', 'Go To Line', 1],
    ['go to', 'Skip Go To Next', 2],
    ['go to', 'To Go Away', 3],
    ['go to', 'Autosave Go', 4], // "to" ⊂ "Auto" — mid-word only
  ])('%s vs %s → exact %i', (query, label, exact) => {
    expect(rankField(query, f(label), '')).toEqual({ tier: 0, exact });
  });

  it('compares case-insensitively and collapses whitespace runs in query and text', () => {
    expect(rankField('  GO   to  LINE ', f('Go  To Line'), '')).toEqual({ tier: 0, exact: 0 });
  });

  it('reads a word boundary as start-of-text or a preceding non-letter, non-digit character', () => {
    expect(rankField('activate', f('Tab hover-activate delay'), '')?.exact).toBe(2);
    expect(rankField('delay activate', f('Tab hover-activate delay'), '')?.exact).toBe(3);
  });
});

describe('filterFields — the #270 worked examples (079 US1)', () => {
  const KEYS = [
    f('Autosave Go'),
    f('Go Away'),
    f('Line Numbers'),
    f('Skip Go To Next'),
    f('To Go Away'),
    f('Go To Line'),
  ];
  const labels = (q: string): string[] => filterFields(q, KEYS, () => '').map((x) => x.label);

  it('puts the exact name first for "go to line"', () => {
    expect(labels('go to line')[0]).toBe('Go To Line');
  });

  it('requires every word: "Go to" excludes Go Away', () => {
    expect(labels('Go to')).not.toContain('Go Away');
    expect(labels('Go to')).toEqual(['Go To Line', 'Skip Go To Next', 'To Go Away', 'Autosave Go']);
  });

  it('ranks a phrase at the start above a phrase inside for "line"', () => {
    expect(labels('line')).toEqual(['Line Numbers', 'Go To Line']);
  });

  it('keeps registry order as the tie-break', () => {
    const a = f('Alpha toggle');
    const b = f('Beta toggle');
    expect(filterFields('toggle', [b, a], () => '')).toEqual([b, a]);
  });
});

describe('filterFields — sections rank and never split (079 FR-007–FR-010)', () => {
  const termExact = f('Copy', { group: 'Terminal' });
  const editorPartial = f('Copy line', { group: 'Editor' });
  const editorExact = f('Copy', { group: 'Editor' });
  const searchDesc = f('Find', { group: 'Search', description: 'copy matches' });

  it('orders sections by their best member, alphabetically on a tie, members in rank order', () => {
    const out = filterFields('copy', [searchDesc, termExact, editorPartial, editorExact], () => '');
    // Editor and Terminal both hold an exact name match → tie → A→Z. Search's best is a description hit.
    expect(out).toEqual([editorExact, editorPartial, termExact, searchDesc]);
  });

  it("draws a section's own fields before its subgroups, and orders subgroups by the same rule", () => {
    const own = f('Copy colour', { group: 'Editor' });
    const subZ = f('Copy', { group: 'Editor', subgroup: 'Zeta' });
    const subA = f('Copy', { group: 'Editor', subgroup: 'Alpha' });
    const subB = f('Copy faster', { group: 'Editor', subgroup: 'Beta' });
    const out = filterFields('copy', [subB, subZ, own, subA], () => '');
    expect(out).toEqual([own, subA, subZ, subB]);
  });

  it('returns every field under a typed heading name, ranked in the group tier (021 FR-015)', () => {
    const named = f('Editor font', { group: 'Editor' });
    const plain = f('Tab size', { group: 'Editor' });
    const other = f('Bell', { group: 'Terminal' });
    expect(filterFields('editor', [plain, other, named], () => '')).toEqual([named, plain]);
    expect(rankField('editor', plain, '')?.tier).toBe(4);
  });

  it('leaves a blank or whitespace-only query in registry order (079 FR-003)', () => {
    const list = [searchDesc, termExact, editorPartial];
    expect(filterFields('', list, () => '')).toEqual(list);
    expect(filterFields('  \t ', list, () => '')).toEqual(list);
  });
});

describe('orderRanked — a caller adding its own field (079 research R6)', () => {
  it('orders caller-built entries exactly as filterFields would', () => {
    const a = f('Copy', { group: 'Terminal' });
    const b = f('Copy', { group: 'Editor' });
    const entries = [a, b].map((field, index) => ({ field, index, rank: rankField('copy', field, '')! }));
    expect(orderRanked(entries)).toEqual(filterFields('copy', [a, b], () => ''));
  });
});

describe('the real registries (079 SC-001–SC-003)', () => {
  const registries: [string, readonly SearchableField[]][] = [
    ['settings', SETTINGS_METADATA],
    ['key bindings', KEYBINDINGS_METADATA],
    ['themes', THEME_METADATA],
  ];

  // SC-002: first under its own heading; the first row overall is an exact name match. Key Bindings
  // declares no sub-headings, so there (SC-001) that is simply "first".
  const heading = (x: SearchableField): string => JSON.stringify([x.group, x.subgroup, x.subsection]);
  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
  it.each(registries)('%s: searching a full label puts that label first under its heading', (_name, reg) => {
    for (const d of reg) {
      const out = filterFields(d.label, reg, () => '');
      const firstUnderHeading = out.find((x) => heading(x) === heading(d));
      expect(norm(firstUnderHeading?.label ?? ''), d.key).toBe(norm(d.label));
      // The first SECTION holds an exact name match (its best member sets its place, FR-008).
      const firstSection = out.filter((x) => x.group === out[0].group);
      expect(firstSection.some((x) => compareRank(rankField(d.label, x, '')!, { tier: 0, exact: 0 }) === 0), d.key).toBe(true);
    }
  });

  it('key bindings: searching a full label puts a binding with that label first overall (SC-001)', () => {
    for (const d of KEYBINDINGS_METADATA) {
      expect(norm(filterFields(d.label, KEYBINDINGS_METADATA, () => '')[0]?.label ?? ''), d.key).toBe(norm(d.label));
    }
  });

  it('never widens: "a b" returns a subset of "a" (SC-003)', () => {
    for (const d of SETTINGS_METADATA) {
      const words = searchTokens(d.label);
      for (let i = 0; i + 1 < words.length; i++) {
        const narrow = new Set(filterFields(`${words[i]} ${words[i + 1]}`, SETTINGS_METADATA, () => ''));
        const wide = new Set(filterFields(words[i], SETTINGS_METADATA, () => ''));
        for (const x of narrow) expect(wide.has(x), `${words[i]} ${words[i + 1]}`).toBe(true);
      }
    }
  });
});
