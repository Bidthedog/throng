import { describe, it, expect } from 'vitest';
import { MENU_SECTION_ORDER, groupBySection, type MenuSection } from '@throng/core';

/**
 * 033 US5 — the one section vocabulary every context menu groups by
 * (contracts/menu-sections.md §1, M1–M7; spec FR-047 – FR-050; Constitution
 * Principle VI v4.6.0, which is CANONICAL for the sections and their order).
 *
 * The divider rule is not implemented here and never should be: a divider is
 * the rendering of a boundary between two groups, so "a single-section menu
 * carries no divider" has to fall out of `groupBySection` returning ONE group.
 */

interface Item {
  label: string;
  section: MenuSection;
}
const item = (label: string, section: MenuSection): Item => ({ label, section });
const sectionOf = (i: Item): MenuSection => i.section;
const labels = (groups: Item[][]): string[][] => groups.map((g) => g.map((i) => i.label));

describe('MENU_SECTION_ORDER (033 menu-sections.ts)', () => {
  it('is exactly the constitution\'s seven sections, in the constitution\'s order', () => {
    expect(MENU_SECTION_ORDER).toEqual([
      'contextual',
      'content',
      'create',
      'destroy',
      'navigate',
      'viewState',
      'application',
    ]);
  });

  it('holds seven sections with no duplicates', () => {
    expect(MENU_SECTION_ORDER).toHaveLength(7);
    expect(new Set(MENU_SECTION_ORDER).size).toBe(7);
  });

  it('leads with Contextual and ends with Application', () => {
    expect(MENU_SECTION_ORDER[0]).toBe('contextual');
    expect(MENU_SECTION_ORDER[MENU_SECTION_ORDER.length - 1]).toBe('application');
  });

  it('puts Destroy third, ahead of Navigate and View & state (FR-052 is an inventory, not an order)', () => {
    const at = (s: MenuSection): number => MENU_SECTION_ORDER.indexOf(s);
    expect(at('destroy')).toBeLessThan(at('navigate'));
    expect(at('navigate')).toBeLessThan(at('viewState'));
    expect(at('create')).toBeLessThan(at('destroy'));
    expect(at('content')).toBeLessThan(at('create'));
  });
});

describe('groupBySection (033 menu-sections.ts)', () => {
  it('orders the groups by MENU_SECTION_ORDER, not by the order the items arrived in', () => {
    const items = [
      item('About', 'application'),
      item('Delete', 'destroy'),
      item('Open Link', 'contextual'),
      item('Copy Path', 'navigate'),
      item('Rename', 'content'),
    ];
    expect(labels(groupBySection(items, sectionOf))).toEqual([
      ['Open Link'],
      ['Rename'],
      ['Delete'],
      ['Copy Path'],
      ['About'],
    ]);
  });

  it('preserves the order of items WITHIN a section (FR-053)', () => {
    const items = [
      item('Rename', 'content'),
      item('Cut', 'content'),
      item('Copy', 'content'),
      item('Paste', 'content'),
      item('Undo', 'content'),
      item('Redo', 'content'),
      item('New File', 'create'),
      item('New Folder', 'create'),
    ];
    expect(labels(groupBySection(items, sectionOf))).toEqual([
      ['Rename', 'Cut', 'Copy', 'Paste', 'Undo', 'Redo'],
      ['New File', 'New Folder'],
    ]);
  });

  it('gathers items of one section together even when they arrive interleaved', () => {
    const items = [
      item('Rename', 'content'),
      item('New File', 'create'),
      item('Cut', 'content'),
      item('New Folder', 'create'),
    ];
    expect(labels(groupBySection(items, sectionOf))).toEqual([
      ['Rename', 'Cut'],
      ['New File', 'New Folder'],
    ]);
  });

  it('drops empty groups, so no menu can begin or end with a divider (M5)', () => {
    const items = [item('Delete', 'destroy'), item('Settings', 'application')];
    const groups = groupBySection(items, sectionOf);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.length > 0)).toBe(true);
    expect(labels(groups)).toEqual([['Delete'], ['Settings']]);
  });

  it('returns ONE group for a single-section menu — the cog menu draws no divider (M4, FR-050)', () => {
    const cog = [
      item('Settings', 'application'),
      item('Key Bindings', 'application'),
      item('Themes', 'application'),
      item('Open Logs Folder', 'application'),
      item('About', 'application'),
    ];
    const groups = groupBySection(cog, sectionOf);
    expect(groups).toHaveLength(1);
    expect(labels(groups)).toEqual([
      ['Settings', 'Key Bindings', 'Themes', 'Open Logs Folder', 'About'],
    ]);
  });

  it('returns one group for a one-item menu', () => {
    expect(labels(groupBySection([item('Record chord…', 'content')], sectionOf))).toEqual([
      ['Record chord…'],
    ]);
  });

  it('returns no groups at all for an empty menu', () => {
    expect(groupBySection([], sectionOf)).toEqual([]);
  });

  it('groups the shipped Files & Folders menu into its four derived boundaries', () => {
    // contracts/menu-sections.md §3.1 — zero movement: the four hand-pushed
    // separators become the four boundaries between these five groups.
    const explorer = [
      item('Rename', 'content'),
      item('Cut', 'content'),
      item('Copy', 'content'),
      item('Paste', 'content'),
      item('Undo', 'content'),
      item('Redo', 'content'),
      item('New File', 'create'),
      item('New Folder', 'create'),
      item('Delete', 'destroy'),
      item('Open In', 'navigate'),
      item('Copy Path', 'navigate'),
      item('Collapse All Children', 'navigate'),
      item('Expand All Children', 'navigate'),
      item('Hide in this project', 'viewState'),
    ];
    const groups = groupBySection(explorer, sectionOf);
    expect(groups).toHaveLength(5);
    expect(groups.length - 1).toBe(4); // four boundaries === four dividers
    expect(labels(groups)[3]).toEqual([
      'Open In',
      'Copy Path',
      'Collapse All Children',
      'Expand All Children',
    ]);
  });

  it('leads with the Contextual group when the pointer supplied one (terminal link items)', () => {
    const terminal = [
      item('Copy', 'content'),
      item('Paste', 'content'),
      item('Open Link', 'contextual'),
      item('Copy Link Address', 'contextual'),
      item('Refresh / redraw terminal', 'viewState'),
      item('Try again', 'viewState'),
      item('Copy details', 'viewState'),
      item('Clear panel type', 'viewState'),
    ];
    const groups = groupBySection(terminal, sectionOf);
    expect(labels(groups)[0]).toEqual(['Open Link', 'Copy Link Address']);
    // Refresh and Try again are both View & state — no divider between them.
    expect(labels(groups)[2]).toEqual([
      'Refresh / redraw terminal',
      'Try again',
      'Copy details',
      'Clear panel type',
    ]);
    expect(groups).toHaveLength(3);
  });

  it('is generic over the item type — it reads the section through the accessor only', () => {
    const raw = ['a:navigate', 'b:content', 'c:navigate'];
    const groups = groupBySection(raw, (s) => s.split(':')[1] as MenuSection);
    expect(groups).toEqual([['b:content'], ['a:navigate', 'c:navigate']]);
  });

  it('does not mutate or alias the array it was given', () => {
    const items = [item('Delete', 'destroy'), item('Rename', 'content')];
    const before = [...items];
    const groups = groupBySection(items, sectionOf);
    expect(items).toEqual(before);
    groups[0].push(item('Injected', 'content'));
    expect(items).toEqual(before);
  });
});
