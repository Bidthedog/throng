/**
 * The editor body menu's context-sensitive fold rows (047 T043, US3, FR-036, contracts "Editor body
 * menu" / "Commands").
 *
 * `editorContentMenu` builds a plain `MenuAction[]` from its `markdownFold` argument — this file
 * tests THAT function directly (the `editor-content-menu.test.ts` pattern: a real `EditorState`
 * behind a two-member stand-in view, no DOM, no jsdom layout), never asserting through a mounted
 * gutter or a real chord press. The CALLER building `markdownFold` from the clicked position lives in
 * `use-editor.ts`'s menu-open builder, and is exercised indirectly wherever `editor-markdown-fold`'s
 * own mounted-editor tests drive a real document — this file owns only what the menu SAYS and does
 * once handed a `markdownFold` value, per contracts/menus-commands-controls.md's own split between
 * "what a menu draws" and "what it does".
 */
import { describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { editorContentMenu, type ContentMenuArgs } from '../../src/renderer/editor/content-menu.js';

/** The minimum `ContentMenuArgs` every call needs, so each test only names what it varies. */
function baseArgs(markdownFold?: ContentMenuArgs['markdownFold']): ContentMenuArgs {
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

const labels = (args: ContentMenuArgs): (string | undefined)[] =>
  editorContentMenu(args).map((m) => m.label);

describe('absent entirely for a non-Markdown document (no `markdownFold` at all)', () => {
  it('draws none of the four fold rows', () => {
    const found = labels(baseArgs(undefined));
    expect(found).not.toContain('Collapse All');
    expect(found).not.toContain('Expand All');
    expect(found.some((l) => l?.startsWith('Collapse This H'))).toBe(false);
    expect(found.some((l) => l?.startsWith('Expand This H'))).toBe(false);
  });
});

describe('the This-Section row (FR-036)', () => {
  it('reads "Collapse This H2" for an expanded H2 section, with its chord', () => {
    const items = editorContentMenu(
      baseArgs({
        section: { slug: 'a', level: 2, collapsed: false },
        hasSections: true,
        collapseSection: () => {},
        expandSection: () => {},
        collapseAll: () => {},
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
    const items = editorContentMenu(
      baseArgs({
        section: { slug: 'b', level: 3, collapsed: true },
        hasSections: true,
        collapseSection: () => {},
        expandSection: () => {},
        collapseAll: () => {},
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
    const items = editorContentMenu(
      baseArgs({
        section: { slug: 'a', level: 2, collapsed: false },
        hasSections: true,
        collapseSection,
        expandSection,
        collapseAll: () => {},
        expandAll: () => {},
        chords: {},
      }),
    );
    items.find((m) => m.label === 'Collapse This H2')!.onClick!();
    expect(collapseSection).toHaveBeenCalledTimes(1);
    expect(expandSection).not.toHaveBeenCalled();
  });

  it('is ABSENT before the first heading (`section: null`) — not disabled, not drawn at all', () => {
    const items = editorContentMenu(
      baseArgs({
        section: null,
        hasSections: true,
        collapseSection: () => {},
        expandSection: () => {},
        collapseAll: () => {},
        expandAll: () => {},
        chords: {},
      }),
    );
    expect(items.some((m) => m.label?.includes('This H'))).toBe(false);
    // Collapse All / Expand All are unaffected by the click position — the document still has headings.
    expect(items.some((m) => m.label === 'Collapse All')).toBe(true);
    expect(items.some((m) => m.label === 'Expand All')).toBe(true);
  });
});

describe('Collapse All / Expand All (contracts "Editor body menu")', () => {
  it('are both always present, each with its own chord', () => {
    const items = editorContentMenu(
      baseArgs({
        section: null,
        hasSections: true,
        collapseSection: () => {},
        expandSection: () => {},
        collapseAll: () => {},
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
    const items = editorContentMenu(
      baseArgs({
        section: null,
        hasSections: false,
        collapseSection: () => {},
        expandSection: () => {},
        collapseAll: () => {},
        expandAll: () => {},
        chords: {},
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
    const items = editorContentMenu(
      baseArgs({
        section: null,
        hasSections: true,
        collapseSection: () => {},
        expandSection: () => {},
        collapseAll,
        expandAll,
        chords: {},
      }),
    );
    items.find((m) => m.label === 'Collapse All')!.onClick!();
    items.find((m) => m.label === 'Expand All')!.onClick!();
    expect(collapseAll).toHaveBeenCalledTimes(1);
    expect(expandAll).toHaveBeenCalledTimes(1);
  });
});
