/**
 * The editor body menu's fold rows (047 T043, US3, FR-036 — placement SUPERSEDED by 054 FR-010).
 *
 * 047 FR-036 drew the fold rows at the menu's top level; 054 FR-010 moves every one of them into ONE
 * **Outlining** submenu, built by `common/outlining-menu.ts` for the editor and the preview alike, and
 * adds *Collapse / Expand All Inside This Hn* (FR-011). The rows' own rules — order, labels, absent before
 * the first heading, disabled with no headings, chords — are the builder's, asserted once in
 * `unit/outlining-menu.test.ts`. This file owns what the EDITOR's menu does with it: one Outlining row,
 * no fold row left at the top level, none for a non-Markdown document, and each row reaching the editor's
 * own handler.
 *
 * `editorContentMenu` builds a plain `MenuAction[]` from its `markdownFold` argument — tested directly
 * (the `editor-content-menu.test.ts` pattern), never through a mounted gutter or a real chord press.
 */
import { describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { editorContentMenu, type ContentMenuArgs } from '../../src/renderer/editor/content-menu.js';
import { outliningSubmenu } from '../../src/renderer/common/outlining-menu.js';

type Fold = NonNullable<ContentMenuArgs['markdownFold']>;

/** The minimum `ContentMenuArgs` every call needs, so each test only names what it varies. */
function baseArgs(markdownFold?: Fold): ContentMenuArgs {
  return {
    view: {} as EditorView,
    panelId: 'p1',
    viewId: 'v1',
    lineEnding: () => 'lf',
    wordWrap: { on: false, toggle: () => {} },
    gotoLine: { open: () => {} },
    markdownFold,
  };
}

function fold(over: Partial<Fold> = {}): Fold {
  return {
    section: { slug: 'a', level: 2, collapsed: false },
    hasSections: true,
    collapseSection: vi.fn(),
    expandSection: vi.fn(),
    collapseAllInside: vi.fn(),
    expandAllInside: vi.fn(),
    collapseAll: vi.fn(),
    expandAll: vi.fn(),
    chords: { collapseSection: 'Ctrl+M,S', collapseAll: 'Ctrl+M,A' },
    ...over,
  };
}

const FOLD_ROW = /^(Collapse|Expand) (This|All)/;

describe('a non-Markdown document (no `markdownFold`) has no Outlining submenu (FR-014)', () => {
  it('draws no Outlining row and no fold row', () => {
    const items = editorContentMenu(baseArgs(undefined));
    expect(items.some((m) => m.label === 'Outlining')).toBe(false);
    expect(items.some((m) => FOLD_ROW.test(m.label ?? ''))).toBe(false);
  });
});

describe('a Markdown document has ONE Outlining submenu (054 FR-010)', () => {
  it('holds the shared builder’s rows, with no fold row left at the top level', () => {
    const f = fold();
    const items = editorContentMenu(baseArgs(f));
    const outlining = items.filter((m) => m.label === 'Outlining');
    expect(outlining).toHaveLength(1);
    expect(outlining[0]!.section).toBe('viewState');
    expect(items.some((m) => FOLD_ROW.test(m.label ?? ''))).toBe(false);
    // Identical to the preview's by construction: the same builder, the same rows and chords.
    const strip = (rows: typeof items) => rows.map(({ label, shortcut, disabled, section }) => ({ label, shortcut, disabled, section }));
    expect(strip(outlining[0]!.submenu ?? [])).toEqual(strip(outliningSubmenu(f).submenu ?? []));
    expect((outlining[0]!.submenu ?? []).map((r) => r.label)).toEqual([
      'Collapse This H2',
      'Collapse All Inside This H2',
      'Expand All Inside This H2',
      'Collapse All',
      'Expand All',
    ]);
  });

  it('runs the editor’s own handler for each row, the two All Inside rows included', () => {
    const f = fold();
    const rows = editorContentMenu(baseArgs(f)).find((m) => m.label === 'Outlining')!.submenu ?? [];
    for (const row of rows) row.onClick?.();
    expect(f.collapseSection).toHaveBeenCalledTimes(1);
    expect(f.collapseAllInside).toHaveBeenCalledTimes(1);
    expect(f.expandAllInside).toHaveBeenCalledTimes(1);
    expect(f.collapseAll).toHaveBeenCalledTimes(1);
    expect(f.expandAll).toHaveBeenCalledTimes(1);
  });

  it('before the first heading keeps only Collapse All / Expand All (FR-012)', () => {
    const rows = editorContentMenu(baseArgs(fold({ section: null }))).find((m) => m.label === 'Outlining')!.submenu ?? [];
    expect(rows.map((r) => r.label)).toEqual(['Collapse All', 'Expand All']);
  });
});
