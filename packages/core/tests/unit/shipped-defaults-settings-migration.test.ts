import { describe, it, expect } from 'vitest';
import {
  V4_EXCLUDE_GLOBS,
  planSettingsUpgrade,
  applySettingsUpgrade,
  buildShippedDefaults,
} from '../../src/config/shipped-defaults.js';
import { DEFAULT_EXCLUDE_GLOBS } from '../../src/explorer/exclude.js';

/**
 * 033 FR-070a/FR-070b — the one-leaf settings migration that carries `**\/node_modules` to an
 * EXISTING installation.
 *
 * ══ WHY A MIGRATION AT ALL, WHEN THE CONSTANT ALREADY CHANGED ══
 *
 * First-run `seed()` materialises the WHOLE settings document to disk, so every install that has
 * ever started the app holds `explorer.excludeGlobs: [".git", ".svn", …]` literally, and
 * `parseAppSettings` honours a present array. Changing `DEFAULT_EXCLUDE_GLOBS` therefore reaches
 * fresh installs only — and a fresh install is the one population every E2E in this repository can
 * see, which is exactly why the gap survives review.
 *
 * ══ WHAT THE GUARD IS FOR ══
 *
 * FR-070b: a user who has customised the list keeps EXACTLY what they set. So the migration fires
 * on one condition — the on-disk array deep-equals the v4 list — and on nothing else. An explicit
 * `[]` is a customisation (the user chose to exclude nothing), an extra entry is a customisation,
 * and a reordering is a customisation, because none of the three is the shipped value.
 *
 * That guard is also what makes the migration idempotent: after it fires the array equals the v5
 * list, which does not equal the v4 list, so a second run plans nothing.
 */
describe('the guarded `explorer.excludeGlobs` upgrade (FR-070a, FR-070b)', () => {
  const V5 = [...buildShippedDefaults().settings.explorer.excludeGlobs];

  const docWith = (globs: unknown): Record<string, unknown> => ({
    // Two siblings the migration must never touch — one in the same section, one outside it.
    explorer: { excludeGlobs: globs, deleteMode: 'recycle' },
    editor: { autoSave: true },
  });

  it('the v4 list is the six VS Code defaults, and the shipped list is those plus node_modules', () => {
    // Guards the whole suite against a vacuous pass: if these two were ever equal, every assertion
    // below would hold for the wrong reason.
    expect([...V4_EXCLUDE_GLOBS]).toEqual([
      '**/.git',
      '**/.svn',
      '**/.hg',
      '**/CVS',
      '**/.DS_Store',
      '**/Thumbs.db',
    ]);
    expect(V5).toEqual([...V4_EXCLUDE_GLOBS, '**/node_modules']);
    expect(V5).toEqual([...DEFAULT_EXCLUDE_GLOBS]);
  });

  it('rewrites a document still holding the v4 list', () => {
    const plan = planSettingsUpgrade(docWith([...V4_EXCLUDE_GLOBS]));
    expect(plan).toEqual([{ path: 'explorer.excludeGlobs', value: V5 }]);
  });

  it('leaves every sibling of the rewritten leaf alone', () => {
    const before = docWith([...V4_EXCLUDE_GLOBS]);
    const after = applySettingsUpgrade(before) as Record<string, Record<string, unknown>>;
    expect(after.explorer.excludeGlobs).toEqual(V5);
    expect(after.explorer.deleteMode).toBe('recycle');
    expect(after.editor).toEqual({ autoSave: true });
    // …and the input is never mutated.
    expect((before.explorer as Record<string, unknown>).excludeGlobs).toEqual([
      ...V4_EXCLUDE_GLOBS,
    ]);
  });

  it('leaves a customised list untouched — one extra entry (FR-070b)', () => {
    expect(planSettingsUpgrade(docWith([...V4_EXCLUDE_GLOBS, '**/dist']))).toEqual([]);
  });

  it('leaves a customised list untouched — one entry removed (FR-070b)', () => {
    expect(planSettingsUpgrade(docWith(V4_EXCLUDE_GLOBS.slice(1)))).toEqual([]);
  });

  it('leaves a customised list untouched — the same entries reordered (FR-070b)', () => {
    const reordered = [...V4_EXCLUDE_GLOBS].reverse();
    expect(planSettingsUpgrade(docWith(reordered))).toEqual([]);
  });

  it('treats an explicit empty list as a customisation, not as an absent value', () => {
    // FR-022c's precedent: an explicit `[]` means "exclude nothing", and a migration that read it
    // as "unset" would silently restore six globs the user had deliberately cleared.
    expect(planSettingsUpgrade(docWith([]))).toEqual([]);
  });

  it('plans nothing for a document already on the v5 list', () => {
    expect(planSettingsUpgrade(docWith([...V5]))).toEqual([]);
  });

  it('plans nothing when the document has no `explorer.excludeGlobs` at all', () => {
    // A document written before the key existed, or a hand-trimmed one: `seed` and the parser's
    // fallback already give it the shipped value, so there is nothing for a migration to do.
    expect(planSettingsUpgrade({ editor: { autoSave: true } })).toEqual([]);
    expect(planSettingsUpgrade({})).toEqual([]);
  });

  it('plans nothing for a value that is not an array of strings', () => {
    expect(planSettingsUpgrade(docWith('**/.git'))).toEqual([]);
    expect(planSettingsUpgrade(docWith(null))).toEqual([]);
    expect(planSettingsUpgrade(docWith([1, 2, 3]))).toEqual([]);
  });

  it('plans nothing for something that is not a document', () => {
    expect(planSettingsUpgrade(null)).toEqual([]);
    expect(planSettingsUpgrade('settings')).toEqual([]);
  });

  it('re-running the migration on its own output changes nothing (idempotence)', () => {
    const once = applySettingsUpgrade(docWith([...V4_EXCLUDE_GLOBS]));
    expect(planSettingsUpgrade(once), 'a second run must plan no work').toEqual([]);
    const twice = applySettingsUpgrade(once);
    expect(twice).toEqual(once);
  });
});
