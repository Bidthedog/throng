/**
 * 054 FR-010 – FR-014 (research R3, contracts/menus-commands-controls-054.md "Outlining submenu") — the ONE
 * builder both the Markdown editor's and the Markdown preview's body menus draw their fold rows from, so
 * the two cannot drift. What each menu does with it is `editor-markdown-fold-menu.test.ts` and
 * `preview-fold-menu.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import { outliningSubmenu, type OutliningArgs } from '../../src/renderer/common/outlining-menu.js';

function args(over: Partial<OutliningArgs> = {}): OutliningArgs {
  return {
    section: { level: 2, collapsed: false },
    hasSections: true,
    collapseSection: vi.fn(),
    expandSection: vi.fn(),
    collapseAllInside: vi.fn(),
    expandAllInside: vi.fn(),
    collapseAll: vi.fn(),
    expandAll: vi.fn(),
    chords: {
      collapseSection: 'Ctrl+M,Ctrl+C',
      expandSection: 'Ctrl+M,Ctrl+E',
      collapseAll: 'Ctrl+M,Ctrl+O',
      expandAll: 'Ctrl+M,Ctrl+P',
    },
    ...over,
  };
}

const labels = (row: MenuAction): string[] => (row.submenu ?? []).map((r) => r.label);

describe('outliningSubmenu (054 FR-010)', () => {
  it('is ONE "Outlining" row in View & state whose submenu holds the rows in contract order', () => {
    const row = outliningSubmenu(args());
    expect(row.label).toBe('Outlining');
    expect(row.section).toBe('viewState');
    expect(labels(row)).toEqual([
      'Collapse This H2',
      'Collapse All Inside This H2',
      'Expand All Inside This H2',
      'Collapse All',
      'Expand All',
    ]);
  });

  it('offers Expand This Hn instead of Collapse when the section is collapsed', () => {
    expect(labels(outliningSubmenu(args({ section: { level: 3, collapsed: true } })))[0]).toBe('Expand This H3');
  });

  it('draws no This-section or All-Inside row before the first heading (FR-012)', () => {
    expect(labels(outliningSubmenu(args({ section: null })))).toEqual(['Collapse All', 'Expand All']);
  });

  it('disables Collapse All / Expand All with no headings', () => {
    const rows = outliningSubmenu(args({ section: null, hasSections: false })).submenu ?? [];
    expect(rows.map((r) => r.disabled)).toEqual([true, true]);
  });

  it('shows each row’s chord, and none for an unbound command (FR-013)', () => {
    const rows = outliningSubmenu(args({ chords: { collapseSection: 'Ctrl+M,Ctrl+C', collapseAllInside: 'Ctrl+K' } })).submenu ?? [];
    expect(rows[0]?.shortcut).toBe('Ctrl+M,Ctrl+C');
    expect(rows[1]?.shortcut).toBe('Ctrl+K');
    expect(rows[2]).not.toHaveProperty('shortcut');
    expect(rows[3]).not.toHaveProperty('shortcut');
  });

  it('runs the matching handler for every row', () => {
    const a = args();
    for (const row of outliningSubmenu(a).submenu ?? []) row.onClick?.();
    expect(a.collapseSection).toHaveBeenCalledTimes(1);
    expect(a.collapseAllInside).toHaveBeenCalledTimes(1);
    expect(a.expandAllInside).toHaveBeenCalledTimes(1);
    expect(a.collapseAll).toHaveBeenCalledTimes(1);
    expect(a.expandAll).toHaveBeenCalledTimes(1);
    expect(a.expandSection).not.toHaveBeenCalled();
  });

  it('every row sits in View & state too', () => {
    expect((outliningSubmenu(args()).submenu ?? []).every((r) => r.section === 'viewState')).toBe(true);
  });
});
