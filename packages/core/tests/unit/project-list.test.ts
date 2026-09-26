/**
 * 046 — the project list model (data-model §7; FR-011, FR-012, FR-050 – FR-054, FR-056, SC-007).
 *
 * One pure module drives the Projects tree, the Next/Previous chords and the cog menu's enabled
 * state, so the three can never disagree about which project is "next".
 */
import { describe, expect, it } from 'vitest';
import {
  listRows,
  mergeIntoDefault,
  reachableProjectIds,
  stepProject,
  validateCategoryName,
  type ListRow,
} from '@throng/core';

interface Cat {
  id: string;
  name: string;
  isDefault: boolean;
  minimised: boolean;
  createdAt: string;
}
interface Proj {
  id: string;
  categoryId: string;
}

const cat = (id: string, createdAt: string, extra: Partial<Cat> = {}): Cat => ({
  id,
  name: id,
  isDefault: false,
  minimised: false,
  createdAt,
  ...extra,
});
const proj = (id: string, categoryId: string): Proj => ({ id, categoryId });

/** A compact picture of the rows, so an order mistake reads as a diff of strings. */
function shape(rows: ReadonlyArray<ListRow<Proj, Cat>>): string[] {
  return rows.map((r) =>
    r.kind === 'category'
      ? `[${r.category.id}:${r.count}${r.collapsible ? '' : ':fixed'}]`
      : `${r.project.id}${r.pinnedActive ? '*' : ''}`,
  );
}

describe('listRows', () => {
  it('lists the default category first, then the rest by createdAt, then by id', () => {
    // Deliberately out of order on input: the default is last and two share a createdAt.
    const categories = [
      cat('zeta', '2026-01-02'),
      cat('beta', '2026-01-01'),
      cat('alpha', '2026-01-02'),
      cat('def', '2026-05-05', { isDefault: true }),
    ];
    const rows = listRows<Proj, Cat>([], categories, null);
    expect(shape(rows)).toEqual(['[def:0:fixed]', '[beta:0]', '[alpha:0]', '[zeta:0]']);
  });

  it('lists each category’s projects in position order — the order they arrive in', () => {
    const categories = [cat('def', '2026-01-01', { isDefault: true }), cat('work', '2026-01-02')];
    // A global order interleaving the two categories: each category keeps its own subsequence.
    const projects = [proj('p1', 'work'), proj('p2', 'def'), proj('p3', 'work'), proj('p4', 'def')];
    expect(shape(listRows(projects, categories, null))).toEqual([
      '[def:2:fixed]',
      'p2',
      'p4',
      '[work:2]',
      'p1',
      'p3',
    ]);
  });

  it('emits only the header for a minimised category, with a count that includes the hidden', () => {
    const categories = [
      cat('def', '2026-01-01', { isDefault: true }),
      cat('old', '2026-01-02', { minimised: true }),
    ];
    const projects = [proj('a', 'def'), proj('b', 'old'), proj('c', 'old')];
    expect(shape(listRows(projects, categories, 'a'))).toEqual(['[def:1:fixed]', 'a', '[old:2]']);
  });

  it('pins the active project under its minimised header', () => {
    const categories = [
      cat('def', '2026-01-01', { isDefault: true }),
      cat('old', '2026-01-02', { minimised: true }),
    ];
    const projects = [proj('a', 'def'), proj('b', 'old'), proj('c', 'old')];
    const rows = listRows(projects, categories, 'c');
    expect(shape(rows)).toEqual(['[def:1:fixed]', 'a', '[old:2]', 'c*']);
    const pinned = rows.find((r) => r.kind === 'project' && r.project.id === 'c');
    expect(pinned).toMatchObject({ kind: 'project', categoryId: 'old', pinnedActive: true });
  });

  it('never marks a project in an EXPANDED category as pinned, active or not', () => {
    const categories = [cat('def', '2026-01-01', { isDefault: true })];
    const rows = listRows([proj('a', 'def')], categories, 'a');
    expect(rows[1]).toMatchObject({ kind: 'project', pinnedActive: false });
  });

  it('makes every category but the default collapsible', () => {
    const categories = [cat('def', '2026-01-01', { isDefault: true }), cat('x', '2026-01-02')];
    const headers = listRows<Proj, Cat>([], categories, null).filter((r) => r.kind === 'category');
    expect(headers.map((h) => (h.kind === 'category' ? [h.category.id, h.collapsible] : null))).toEqual([
      ['def', false],
      ['x', true],
    ]);
  });

  it('lists an empty category with a count of 0', () => {
    const categories = [cat('def', '2026-01-01', { isDefault: true }), cat('empty', '2026-01-02')];
    const rows = listRows([proj('a', 'def')], categories, null);
    expect(rows.at(-1)).toMatchObject({ kind: 'category', count: 0 });
  });

  it('lists a project whose category is unknown under the default — never loses it (R9 heal rule)', () => {
    const categories = [cat('def', '2026-01-01', { isDefault: true })];
    const rows = listRows([proj('a', ''), proj('b', 'gone')], categories, null);
    expect(shape(rows)).toEqual(['[def:2:fixed]', 'a', 'b']);
  });

  it('keeps every project listed when no categories are known yet — projects loaded first, or the fetch failed', () => {
    const projects = [proj('a', 'def'), proj('b', ''), proj('c', 'work')];
    const rows = listRows<Proj, Cat>(projects, [], 'b');
    expect(shape(rows)).toEqual(['a', 'b', 'c']);
    expect(reachableProjectIds(rows)).toEqual(['a', 'b', 'c']);
  });

  it('keeps a project with no resolvable category listed when there is no default category', () => {
    const categories = [cat('work', '2026-01-02')];
    const projects = [proj('a', 'gone'), proj('w', 'work'), proj('b', '')];
    const rows = listRows(projects, categories, null);
    // Nothing to heal them into, so they lead the list, headerless, in position order.
    expect(shape(rows)).toEqual(['a', 'b', '[work:1]', 'w']);
    expect(reachableProjectIds(rows)).toEqual(['a', 'b', 'w']);
  });
});

describe('reachableProjectIds', () => {
  it('is every listed project in row order, including the pinned active one (FR-012, SC-007)', () => {
    const categories = [
      cat('def', '2026-01-01', { isDefault: true }),
      cat('old', '2026-01-02', { minimised: true }),
      cat('new', '2026-01-03'),
    ];
    const projects = [proj('a', 'def'), proj('b', 'old'), proj('c', 'old'), proj('d', 'new')];
    expect(reachableProjectIds(listRows(projects, categories, 'c'))).toEqual(['a', 'c', 'd']);
    // With the active project elsewhere, the minimised category contributes nothing.
    expect(reachableProjectIds(listRows(projects, categories, 'a'))).toEqual(['a', 'd']);
  });
});

describe('stepProject (FR-011)', () => {
  const reachable = ['a', 'b', 'c'];

  it('moves to the neighbour in either direction', () => {
    expect(stepProject(reachable, 'b', 1)).toBe('c');
    expect(stepProject(reachable, 'b', -1)).toBe('a');
  });

  it('does nothing at either end — it does not wrap', () => {
    expect(stepProject(reachable, 'c', 1)).toBeNull();
    expect(stepProject(reachable, 'a', -1)).toBeNull();
  });

  it('does nothing with fewer than two reachable projects when one is active', () => {
    expect(stepProject(['a'], 'a', 1)).toBeNull();
    expect(stepProject(['a'], 'a', -1)).toBeNull();
  });

  it('skips projects in a minimised category', () => {
    const categories = [
      cat('def', '2026-01-01', { isDefault: true }),
      cat('old', '2026-01-02', { minimised: true }),
      cat('new', '2026-01-03'),
    ];
    const projects = [proj('a', 'def'), proj('hidden', 'old'), proj('d', 'new')];
    const ids = reachableProjectIds(listRows(projects, categories, 'a'));
    expect(stepProject(ids, 'a', 1)).toBe('d');
    expect(stepProject(ids, 'd', -1)).toBe('a');
  });

  it('steps out of a pinned active row in both directions', () => {
    const categories = [
      cat('def', '2026-01-01', { isDefault: true }),
      cat('old', '2026-01-02', { minimised: true }),
      cat('new', '2026-01-03'),
    ];
    const projects = [proj('a', 'def'), proj('b', 'old'), proj('pinned', 'old'), proj('d', 'new')];
    const ids = reachableProjectIds(listRows(projects, categories, 'pinned'));
    expect(stepProject(ids, 'pinned', 1)).toBe('d');
    expect(stepProject(ids, 'pinned', -1)).toBe('a');
  });

  it('with NO active project goes to the first for +1 and the last for -1 (R5)', () => {
    expect(stepProject(reachable, null, 1)).toBe('a');
    expect(stepProject(reachable, null, -1)).toBe('c');
  });

  it('with NO active project and exactly one reachable, goes to it either way (spec FR-011 Recorded)', () => {
    expect(stepProject(['only'], null, 1)).toBe('only');
    expect(stepProject(['only'], null, -1)).toBe('only');
  });

  it('returns null only when nothing is reachable', () => {
    expect(stepProject([], null, 1)).toBeNull();
    expect(stepProject([], null, -1)).toBeNull();
  });
});

describe('validateCategoryName (FR-053)', () => {
  const existing = [
    { id: 'c1', name: 'In Progress' },
    { id: 'c2', name: 'Archive' },
  ];

  it('accepts a new name and returns it trimmed', () => {
    expect(validateCategoryName('  Client work  ', existing)).toEqual({ ok: true, name: 'Client work' });
  });

  it('refuses an empty or whitespace-only name', () => {
    expect(validateCategoryName('', existing)).toMatchObject({ ok: false, reason: 'empty' });
    expect(validateCategoryName('   \t', existing)).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('refuses a duplicate that differs only in case or surrounding space', () => {
    expect(validateCategoryName('archive', existing)).toMatchObject({ ok: false, reason: 'duplicate' });
    expect(validateCategoryName(' IN PROGRESS ', existing)).toMatchObject({
      ok: false,
      reason: 'duplicate',
    });
  });

  it('lets a category be renamed to a re-cased form of its own name', () => {
    expect(validateCategoryName('ARCHIVE', existing, 'c2')).toEqual({ ok: true, name: 'ARCHIVE' });
    // …but not to another category's.
    expect(validateCategoryName('archive', existing, 'c1')).toMatchObject({ ok: false, reason: 'duplicate' });
  });

  /**
   * Hardening (branch review) — a category name had no length cap at all, unlike a project's
   * (`project.ts`'s `MAX_NAME_LENGTH`, 120 chars). Same cap, same boundary shape: exactly 120 is
   * fine, 121 is refused.
   */
  it('accepts a name at exactly 120 characters', () => {
    const name = 'x'.repeat(120);
    expect(validateCategoryName(name, existing)).toEqual({ ok: true, name });
  });

  it('refuses a name over 120 characters', () => {
    const name = 'x'.repeat(121);
    expect(validateCategoryName(name, existing)).toMatchObject({ ok: false, reason: 'tooLong' });
  });
});

describe('mergeIntoDefault (FR-054)', () => {
  it('appends the deleted category’s members after the default’s, keeping their relative order', () => {
    const categoryOf: Record<string, string> = { d1: 'def', x1: 'gone', d2: 'def', o1: 'other', x2: 'gone' };
    const merged = mergeIntoDefault(['x1', 'd1', 'o1', 'x2', 'd2'], (id) => categoryOf[id] ?? '', 'gone', 'def');
    // Every id survives exactly once.
    expect([...merged].sort()).toEqual(['d1', 'd2', 'o1', 'x1', 'x2']);
    // The default category's order, read the way listRows reads it: d1, d2, then x1, x2.
    const defaultOrder = merged.filter((id) => categoryOf[id] === 'def' || categoryOf[id] === 'gone');
    expect(defaultOrder).toEqual(['d1', 'd2', 'x1', 'x2']);
    // Nobody else's order moves.
    expect(merged.filter((id) => categoryOf[id] === 'other')).toEqual(['o1']);
  });

  it('keeps the members’ relative order when the default category is empty', () => {
    const categoryOf: Record<string, string> = { x1: 'gone', o1: 'other', x2: 'gone' };
    const merged = mergeIntoDefault(['x2', 'o1', 'x1'], (id) => categoryOf[id] ?? '', 'gone', 'def');
    expect(merged.filter((id) => categoryOf[id] === 'gone')).toEqual(['x2', 'x1']);
    expect([...merged].sort()).toEqual(['o1', 'x1', 'x2']);
  });

  it('returns the order unchanged when the deleted category has no members', () => {
    const merged = mergeIntoDefault(['a', 'b'], () => 'def', 'gone', 'def');
    expect(merged).toEqual(['a', 'b']);
  });
});
