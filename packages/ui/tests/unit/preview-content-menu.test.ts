/**
 * `previewContentMenu` and `linkAddress` (`preview/content-menu.ts`) — pure builders, no DOM, no mount.
 *
 * Moved down from `component/preview-fold-menu.test.ts` (the `fold` argument: 047 FR-036, 054 FR-010 – FR-014)
 * and `component/preview-link-menu.test.ts` (no link row, FR-169; the copied address, FR-116; Synchronise
 * Scrolling, FR-122b). Those files keep the mounted wiring: a real right-click, the real fold state, the Link
 * menu's async fill.
 *
 * Layer: unit — the builders take plain arguments and return rows; nothing here renders.
 */
import { describe, expect, it, vi } from 'vitest';
import { PREVIEW_KIND, type PreviewLink } from '@throng/core';
import { panelHeaderMenu } from '../../src/renderer/workspace/panel-header-menu.js';
import { linkAddress, previewContentMenu, type PreviewContentMenuArgs } from '../../src/renderer/preview/content-menu.js';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';

/* ── `previewContentMenu`'s `fold` argument (mirrors editor's own `markdownFold`) ─────────────────── */

function baseArgs(fold?: PreviewContentMenuArgs['fold']): PreviewContentMenuArgs {
  return { selectionEmpty: true, find: { run: () => {} }, goToHeading: { run: () => {} }, fold };
}

const labels = (args: PreviewContentMenuArgs): (string | undefined)[] => previewContentMenu(args).map((m) => m.label);

/*
 * 054 FR-010 supersedes 047 FR-036's PLACEMENT: the fold rows live in one Outlining submenu, built by the
 * shared `outliningSubmenu` (`common/outlining-menu.ts`), not at the menu's top level. What each row SAYS
 * and does is unchanged, so the cases below read the submenu's rows; the submenu's own contract is
 * `unit/outlining-menu.test.ts`'s.
 */
const outliningRows = (args: PreviewContentMenuArgs): MenuAction[] =>
  previewContentMenu(args).find((m) => m.label === 'Outlining')?.submenu ?? [];

describe('previewContentMenu — no `fold` at all (a non-Markdown provider)', () => {
  it('draws none of the four fold rows', () => {
    const found = labels(baseArgs(undefined));
    expect(found).not.toContain('Collapse All');
    expect(found).not.toContain('Expand All');
    expect(found.some((l) => l?.startsWith('Collapse This H'))).toBe(false);
    expect(found.some((l) => l?.startsWith('Expand This H'))).toBe(false);
  });
});

describe('the This-Section row (FR-036)', () => {
  it('reads "Collapse This H2" for an expanded H2 section, with its chord, in viewState', () => {
    const items = outliningRows(
      baseArgs({
        section: { level: 2, collapsed: false },
        hasSections: true,
        collapseSection: () => {},
        expandSection: () => {},
        collapseAll: () => {},
        collapseAllInside: () => {},
        expandAllInside: () => {},
        expandAll: () => {},
        chords: { collapseSection: 'Ctrl+M,S' },
      }),
    );
    const row = items.find((m) => m.label === 'Collapse This H2');
    expect(row, 'no "Collapse This H2" row').toBeDefined();
    expect(row!.shortcut).toBe('Ctrl+M,S');
    expect(row!.section).toBe('viewState');
    expect(items.some((m) => m.label?.startsWith('Expand This H'))).toBe(false);
  });

  it('reads "Expand This H3" for a COLLAPSED H3 section, with its own chord — never both rows at once', () => {
    const items = outliningRows(
      baseArgs({
        section: { level: 3, collapsed: true },
        hasSections: true,
        collapseSection: () => {},
        expandSection: () => {},
        collapseAll: () => {},
        collapseAllInside: () => {},
        expandAllInside: () => {},
        expandAll: () => {},
        chords: { expandSection: 'Ctrl+M,E' },
      }),
    );
    const row = items.find((m) => m.label === 'Expand This H3');
    expect(row, 'no "Expand This H3" row').toBeDefined();
    expect(row!.shortcut).toBe('Ctrl+M,E');
    expect(items.some((m) => m.label?.startsWith('Collapse This H'))).toBe(false);
  });

  it('invokes collapseSection / expandSection when clicked', () => {
    const collapseSection = vi.fn();
    const expandSection = vi.fn();
    const items = outliningRows(
      baseArgs({
        section: { level: 2, collapsed: false },
        hasSections: true,
        collapseSection,
        expandSection,
        collapseAll: () => {},
        collapseAllInside: () => {},
        expandAllInside: () => {},
        expandAll: () => {},
      }),
    );
    items.find((m) => m.label === 'Collapse This H2')!.onClick!();
    expect(collapseSection).toHaveBeenCalledTimes(1);
    expect(expandSection).not.toHaveBeenCalled();
  });

  it('is ABSENT before the first heading (`section: null`) — not disabled, not drawn at all', () => {
    const items = outliningRows(
      baseArgs({
        section: null,
        hasSections: true,
        collapseSection: () => {},
        expandSection: () => {},
        collapseAll: () => {},
        collapseAllInside: () => {},
        expandAllInside: () => {},
        expandAll: () => {},
      }),
    );
    expect(items.some((m) => m.label?.includes('This H'))).toBe(false);
    // Collapse All / Expand All are unaffected by the click position — the document still has headings.
    expect(items.some((m) => m.label === 'Collapse All')).toBe(true);
    expect(items.some((m) => m.label === 'Expand All')).toBe(true);
  });
});

describe('Collapse All / Expand All (contracts "Preview body menu")', () => {
  it('are both always present, each with its own chord', () => {
    const items = outliningRows(
      baseArgs({
        section: null,
        hasSections: true,
        collapseSection: () => {},
        expandSection: () => {},
        collapseAll: () => {},
        collapseAllInside: () => {},
        expandAllInside: () => {},
        expandAll: () => {},
        chords: { collapseAll: 'Ctrl+M,A', expandAll: 'Ctrl+M,X' },
      }),
    );
    const collapseAll = items.find((m) => m.label === 'Collapse All');
    const expandAll = items.find((m) => m.label === 'Expand All');
    expect(collapseAll?.shortcut).toBe('Ctrl+M,A');
    expect(expandAll?.shortcut).toBe('Ctrl+M,X');
    expect(collapseAll?.disabled).toBe(false);
    expect(expandAll?.disabled).toBe(false);
  });

  it('are DISABLED, not absent, when the document has no headings at all', () => {
    const items = outliningRows(
      baseArgs({
        section: null,
        hasSections: false,
        collapseSection: () => {},
        expandSection: () => {},
        collapseAll: () => {},
        collapseAllInside: () => {},
        expandAllInside: () => {},
        expandAll: () => {},
      }),
    );
    const collapseAll = items.find((m) => m.label === 'Collapse All');
    const expandAll = items.find((m) => m.label === 'Expand All');
    expect(collapseAll, 'Collapse All must still be drawn, just disabled').toBeDefined();
    expect(expandAll, 'Expand All must still be drawn, just disabled').toBeDefined();
    expect(collapseAll!.disabled).toBe(true);
    expect(expandAll!.disabled).toBe(true);
  });

  it('invoke collapseAll / expandAll when clicked', () => {
    const collapseAll = vi.fn();
    const expandAll = vi.fn();
    const items = outliningRows(
      baseArgs({
        section: null,
        hasSections: true,
        collapseSection: () => {},
        expandSection: () => {},
        collapseAll,
        collapseAllInside: () => {},
        expandAllInside: () => {},
        expandAll,
      }),
    );
    items.find((m) => m.label === 'Collapse All')!.onClick!();
    items.find((m) => m.label === 'Expand All')!.onClick!();
    expect(collapseAll).toHaveBeenCalledTimes(1);
    expect(expandAll).toHaveBeenCalledTimes(1);
  });
});

describe('054 — one Outlining submenu (FR-010 – FR-014)', () => {
  const fold = (over: Partial<NonNullable<PreviewContentMenuArgs['fold']>> = {}): PreviewContentMenuArgs['fold'] => ({
    section: { level: 2, collapsed: false },
    hasSections: true,
    collapseSection: () => {},
    expandSection: () => {},
    collapseAllInside: () => {},
    expandAllInside: () => {},
    collapseAll: () => {},
    expandAll: () => {},
    ...over,
  });

  it('a Markdown document has exactly one Outlining row and no fold row at the top level', () => {
    const top = labels(baseArgs(fold()));
    expect(top.filter((l) => l === 'Outlining')).toHaveLength(1);
    expect(top.some((l) => /^(Collapse|Expand) /.test(l ?? ''))).toBe(false);
  });

  it('a non-Markdown provider has no Outlining row', () => {
    expect(labels(baseArgs(undefined))).not.toContain('Outlining');
  });

  it('All Inside rows sit after This H2 and call their own handlers', () => {
    const collapseAllInside = vi.fn();
    const expandAllInside = vi.fn();
    const rows = outliningRows(baseArgs(fold({ collapseAllInside, expandAllInside })));
    expect(rows.map((r) => r.label)).toEqual([
      'Collapse This H2',
      'Collapse All Inside This H2',
      'Expand All Inside This H2',
      'Collapse All',
      'Expand All',
    ]);
    rows.find((r) => r.label === 'Collapse All Inside This H2')!.onClick!();
    rows.find((r) => r.label === 'Expand All Inside This H2')!.onClick!();
    expect(collapseAllInside).toHaveBeenCalledTimes(1);
    expect(expandAllInside).toHaveBeenCalledTimes(1);
  });
});

/* ── A moved-out preview disables its Open in Editor rows (050 FR-035; from component/preview-moved-out) ── */

describe('a moved-out preview (050 FR-035)', () => {
  it('disables the header menu and content menu rows', () => {
    const keybindings = { bindings: {} };
    const header = panelHeaderMenu({
      panel: {
        type: 'panel',
        id: 'x',
        kind: PREVIEW_KIND,
        title: 'P',
        config: { filePath: 'E:/other/README.md', movedOut: true },
      },
      panelVerb: 'Destroy',
      keybindings,
      otherTabs: [],
      editor: null,
      panelFailure: false,
      detach: null,
      preview: { providerKind: 'text', parented: false },
      actions: new Proxy({}, { get: () => () => {} }),
    } as never) as unknown as { label?: string; disabled?: boolean }[];
    expect(header.find((i) => i.label === 'Open in Editor')?.disabled).toBe(true);

    const content = previewContentMenu({
      selectionEmpty: true,
      editorRoute: { parented: false, run: () => {}, disabled: true },
      find: { run: () => {} },
      goToHeading: { run: () => {} },
    } as never) as unknown as { label?: string; disabled?: boolean }[];
    expect(content.find((i) => i.label === 'Open in Editor')?.disabled).toBe(true);
  });
});

/* ── The ordinary body menu: no link row at all (FR-169) ─────────────────────────────────────────── */

const EXTERNAL: PreviewLink = { kind: 'external', url: 'https://example.com/' };

describe('previewContentMenu carries no Contextual section any more (FR-169)', () => {
  it('draws only Navigate (Find…, Go to Heading…), Content, Navigate and View & state — never Open Link or Copy Link to Clipboard', () => {
    const items = previewContentMenu({
      selectionEmpty: false,
      content: { copyFormat: 'rich', copy: vi.fn(), selectAll: vi.fn() },
      editorRoute: { parented: false, run: vi.fn() },
      syncScroll: { on: true, toggle: vi.fn() },
      find: { run: vi.fn() },
      goToHeading: { run: vi.fn() },
    });
    // 047 US1/US4 (FR-007) — Find… and Go to Heading… are pushed first (`content-menu.ts`'s own raw
    // order), ahead of Content.
    expect(items.map((i) => i.section)).toEqual([
      'navigate',
      'navigate',
      'content',
      'content',
      'content',
      'content',
      'navigate',
      'viewState',
    ]);
    expect(items.some((i) => i.label === 'Open Link')).toBe(false);
    expect(items.some((i) => i.label.startsWith('Copy Link'))).toBe(false);
  });

  it('with nothing else to draw, the menu still carries Find… and Go to Heading… (FR-007, always present)', () => {
    const items = previewContentMenu({ selectionEmpty: true, find: { run: vi.fn() }, goToHeading: { run: vi.fn() } });
    expect(items).toEqual([
      expect.objectContaining({ label: 'Find…', section: 'navigate' }),
      expect.objectContaining({ label: 'Go to Heading…', section: 'navigate' }),
    ]);
  });
});

describe('the address a link copies (FR-116)', () => {
  const DOC_PATH = 'D:/proj/README.md';

  it.each<[PreviewLink, string]>([
    [EXTERNAL, 'https://example.com/'],
    [{ kind: 'external', url: 'mailto:a@b.c' }, 'mailto:a@b.c'],
    [{ kind: 'file', absPath: 'D:/proj/docs/a.md' }, 'D:/proj/docs/a.md'],
    [{ kind: 'file', absPath: 'D:/proj/docs/a.md', fragment: 'x' }, 'D:/proj/docs/a.md#x'],
    [{ kind: 'heading', fragment: 'install' }, `${DOC_PATH}#install`],
    [{ kind: 'outside', target: '../../x.md' }, '../../x.md'],
  ])('%j → %s', (link, address) => {
    expect(linkAddress(link, DOC_PATH)).toBe(address);
  });

  it('never copies a bare #fragment, for any link kind', () => {
    const links: PreviewLink[] = [
      EXTERNAL,
      { kind: 'file', absPath: 'D:/proj/docs/a.md', fragment: 'x' },
      { kind: 'heading', fragment: 'install' },
      { kind: 'outside', target: '../../x.md' },
    ];
    for (const link of links) expect(linkAddress(link, DOC_PATH).startsWith('#'), JSON.stringify(link)).toBe(false);
  });
});

/*
 * 044 T234 — Synchronise Scrolling on the preview body menu (FR-122a, FR-122b; contracts/menus-and-controls.md
 * §4, §10): a View & state section, last, on every text-provider preview, whatever is under the pointer.
 */
describe('Synchronise Scrolling on the body menu (FR-122b)', () => {
  const SYNC = 'menu-item-Synchronise Scrolling';

  it.each<[string, boolean]>([
    ['nothing selected', true],
    ['text selected', false],
  ])('is the last item with %s', (_name, selectionEmpty) => {
    const items = previewContentMenu({
      selectionEmpty,
      content: { copyFormat: 'rich', copy: vi.fn(), selectAll: vi.fn() },
      editorRoute: { parented: false, run: vi.fn() },
      syncScroll: { on: true, toggle: vi.fn() },
      find: { run: vi.fn() },
      goToHeading: { run: vi.fn() },
    });
    expect(items.at(-1)).toMatchObject({ testId: SYNC, section: 'viewState', label: 'Synchronise Scrolling ✓' });
  });

  it('is absent when the panel hands the builder none (a binary provider)', () => {
    const items = previewContentMenu({
      selectionEmpty: true,
      syncScroll: null,
      find: { run: () => {} },
      goToHeading: { run: () => {} },
    });
    expect(items.find((i) => i.testId === SYNC)).toBeUndefined();
  });
});
