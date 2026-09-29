/**
 * 047 T048 (US3, FR-036, FR-038, contracts "Preview body menu" / "Status bar") — the preview body
 * menu's context-sensitive fold rows and the status-bar Collapse All / Expand All toggle.
 *
 * Two layers, mirroring `editor-markdown-fold-menu.test.ts`'s own split:
 *
 * - `previewContentMenu(...)` is tested directly with a `fold` argument (no DOM, no mount) — what the
 *   menu SAYS and does once handed one, exactly the editor's own file's pattern for `markdownFold`.
 * - `sectionAtPoint` (`fold-menu-section.ts`) is tested directly against hand-built DOM — the WHERE.
 * - A mounted `preview-panel.tsx` proves the WIRING: a real right-click resolves the clicked section,
 *   a real click on a row changes the real fold state (the body's content actually hides), and the
 *   status-bar toggle is present only for a Markdown provider.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewContentMenu, type PreviewContentMenuArgs } from '../../src/renderer/preview/content-menu.js';
import { sectionAtPoint } from '../../src/renderer/preview/fold-menu-section.js';
import { __resetFoldStateStore } from '../../src/renderer/editor/fold-state-store.js';
import { COLD, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

/* ── `previewContentMenu`'s `fold` argument (mirrors editor's own `markdownFold`) ─────────────────── */

function baseArgs(fold?: PreviewContentMenuArgs['fold']): PreviewContentMenuArgs {
  return { selectionEmpty: true, find: { run: () => {} }, goToHeading: { run: () => {} }, fold };
}

const labels = (args: PreviewContentMenuArgs): (string | undefined)[] => previewContentMenu(args).map((m) => m.label);

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
    const items = previewContentMenu(
      baseArgs({
        section: { level: 2, collapsed: false },
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
    const items = previewContentMenu(
      baseArgs({
        section: { level: 3, collapsed: true },
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
    const items = previewContentMenu(
      baseArgs({
        section: { level: 2, collapsed: false },
        hasSections: true,
        collapseSection,
        expandSection,
        collapseAll: () => {},
        expandAll: () => {},
      }),
    );
    items.find((m) => m.label === 'Collapse This H2')!.onClick!();
    expect(collapseSection).toHaveBeenCalledTimes(1);
    expect(expandSection).not.toHaveBeenCalled();
  });

  it('is ABSENT before the first heading (`section: null`) — not disabled, not drawn at all', () => {
    const items = previewContentMenu(
      baseArgs({
        section: null,
        hasSections: true,
        collapseSection: () => {},
        expandSection: () => {},
        collapseAll: () => {},
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
    const items = previewContentMenu(
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
    const items = previewContentMenu(
      baseArgs({
        section: null,
        hasSections: false,
        collapseSection: () => {},
        expandSection: () => {},
        collapseAll: () => {},
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
    const items = previewContentMenu(
      baseArgs({
        section: null,
        hasSections: true,
        collapseSection: () => {},
        expandSection: () => {},
        collapseAll,
        expandAll,
      }),
    );
    items.find((m) => m.label === 'Collapse All')!.onClick!();
    items.find((m) => m.label === 'Expand All')!.onClick!();
    expect(collapseAll).toHaveBeenCalledTimes(1);
    expect(expandAll).toHaveBeenCalledTimes(1);
  });
});

/* ── `sectionAtPoint` — the innermost section a DOM point falls in ────────────────────────────────── */

describe('sectionAtPoint', () => {
  function buildRoot(): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = [
      '<p id="intro">intro</p>',
      '<h1 data-heading-slug="one">One</h1>',
      '<p id="p-one">body one</p>',
      '<h2 data-heading-slug="one-a">One A</h2>',
      '<p id="p-one-a">body one a</p>',
      '<h1 data-heading-slug="two">Two</h1>',
      '<p id="p-two">body two</p>',
    ].join('');
    document.body.appendChild(root);
    return root;
  }

  afterEach(() => document.body.replaceChildren());

  it('is `null` for a point before the first heading', () => {
    const root = buildRoot();
    expect(sectionAtPoint(root, root.querySelector('#intro'))).toBeNull();
  });

  it('is the nearest preceding heading, whatever its level (the innermost section)', () => {
    const root = buildRoot();
    expect(sectionAtPoint(root, root.querySelector('#p-one'))).toBe('one');
    expect(sectionAtPoint(root, root.querySelector('#p-one-a'))).toBe('one-a');
    expect(sectionAtPoint(root, root.querySelector('#p-two'))).toBe('two');
  });

  it('is the heading itself when the point IS the heading (a click on the heading line)', () => {
    const root = buildRoot();
    expect(sectionAtPoint(root, root.querySelector('[data-heading-slug="two"]'))).toBe('two');
  });

  it('resolves from a NESTED text node inside a block, not just a direct child', () => {
    const root = buildRoot();
    const textNode = root.querySelector('#p-one-a')!.firstChild;
    expect(sectionAtPoint(root, textNode)).toBe('one-a');
  });

  it('is `null` for a point outside `root` entirely, and for `null`', () => {
    const root = buildRoot();
    const outside = document.createElement('p');
    document.body.appendChild(outside);
    expect(sectionAtPoint(root, outside)).toBeNull();
    expect(sectionAtPoint(root, null)).toBeNull();
  });
});

/* ── Mounted: the panel resolves the click, and a row really folds the document ──────────────────── */

const DOC = 'intro text\n\n# One\n\nbody one\n\n## Two\n\nbody two\n';

let m: MountedPreviewWindow | undefined;

afterEach(() => {
  m?.unmount();
  m = undefined;
  __resetFoldStateStore();
});

describe('the body menu, mounted over a real Markdown preview', () => {
  it('opened over the intro paragraph (before any heading): no This-Section row, Collapse/Expand All present', async () => {
    m = await mountMarkdownPreview(DOC);
    const intro = await screen.findByText('intro text', {}, COLD);
    fireEvent.contextMenu(intro, { clientX: 5, clientY: 5 });

    expect(await screen.findByTestId('menu-item-Collapse All')).toBeInTheDocument();
    expect(screen.getByTestId('menu-item-Expand All')).toBeInTheDocument();
    expect(screen.queryByTestId(/menu-item-(Collapse|Expand) This H/)).toBeNull();
  });

  it('opened over content under "Two" (H2): Collapse This H2, and clicking it hides that section only', async () => {
    m = await mountMarkdownPreview(DOC);
    const bodyTwo = await screen.findByText('body two', {}, COLD);
    fireEvent.contextMenu(bodyTwo, { clientX: 5, clientY: 5 });

    const row = await screen.findByTestId('menu-item-Collapse This H2');
    fireEvent.click(row);

    await waitFor(() => expect(bodyTwo).not.toBeVisible());
    // "One"'s own content is untouched.
    expect(screen.getByText('body one')).toBeVisible();
  });

  it('re-opened after a collapse reads "Expand This H2" instead — never both at once', async () => {
    m = await mountMarkdownPreview(DOC);
    const bodyTwo = await screen.findByText('body two', {}, COLD);
    fireEvent.contextMenu(bodyTwo, { clientX: 5, clientY: 5 });
    fireEvent.click(await screen.findByTestId('menu-item-Collapse This H2'));
    await waitFor(() => expect(bodyTwo).not.toBeVisible());

    const heading = await screen.findByText('Two');
    fireEvent.contextMenu(heading, { clientX: 5, clientY: 5 });
    expect(await screen.findByTestId('menu-item-Expand This H2')).toBeInTheDocument();
    expect(screen.queryByTestId('menu-item-Collapse This H2')).toBeNull();
  });

  it('Collapse All from the menu hides every section’s content', async () => {
    m = await mountMarkdownPreview(DOC);
    const bodyOne = await screen.findByText('body one', {}, COLD);
    const bodyTwo = screen.getByText('body two');
    fireEvent.contextMenu(bodyOne, { clientX: 5, clientY: 5 });
    fireEvent.click(await screen.findByTestId('menu-item-Collapse All'));

    await waitFor(() => expect(bodyOne).not.toBeVisible());
    expect(bodyTwo).not.toBeVisible();
  });

  it('Collapse All / Expand All are DISABLED with no headings at all, never absent', async () => {
    m = await mountMarkdownPreview('just a paragraph, no headings\n');
    const p = await screen.findByText('just a paragraph, no headings', {}, COLD);
    fireEvent.contextMenu(p, { clientX: 5, clientY: 5 });

    const collapseAll = await screen.findByTestId('menu-item-Collapse All');
    expect(collapseAll).toBeInTheDocument();
    expect(collapseAll).toHaveClass('context-menu__item--disabled');
    expect(screen.getByTestId('menu-item-Expand All')).toHaveClass('context-menu__item--disabled');
  });
});

/* ── Mounted: the status-bar toggle (contracts "Status bar", FR-038) ─────────────────────────────── */

describe('the status-bar Collapse All / Expand All toggle', () => {
  const toggle = (id: string): HTMLElement | null => screen.queryByTestId(`preview-fold-toggle-${id}`);

  it('is present for a Markdown preview, left of the scroll-sync toggle, token collapseAll while expanded', async () => {
    m = await mountMarkdownPreview(DOC);
    await screen.findByText('body one', {}, COLD);

    const t = await screen.findByTestId(`preview-fold-toggle-${m.id}`);
    expect(t).toHaveAttribute('aria-pressed', 'false');
    // The default `markdown.collapseAll` binding (Ctrl+M,A) is named in the title, per the status-bar
    // contract ("title ... with the chord") — the same pattern the sync-scroll toggle's own title uses.
    expect(t.title).toMatch(/^Collapse All( \(.+\))?$/);
    expect(t.nextElementSibling).toBe(screen.getByTestId(`preview-sync-scroll-${m.id}`));
  });

  it('clicking it collapses the whole document, then flips its own token/title to Expand All', async () => {
    m = await mountMarkdownPreview(DOC);
    const bodyOne = await screen.findByText('body one', {}, COLD);
    const t = await screen.findByTestId(`preview-fold-toggle-${m.id}`);

    fireEvent.click(t);

    await waitFor(() => expect(bodyOne).not.toBeVisible());
    await waitFor(() => expect(toggle(m!.id)!.title).toMatch(/^Expand All( \(.+\))?$/));
  });

  it('is ABSENT for a non-Markdown text provider', async () => {
    const { createPreviewProviderRegistry } = await import('@throng/core');
    const registry = createPreviewProviderRegistry([{ id: 'testText', displayName: 'Test text', extensions: ['.prvtxt'], kind: 'text' }]);
    const FakeBody = ({ panelId, content }: { panelId: string; content: { kind: string; text?: string } }) =>
      createElement('div', { 'data-testid': `fake-body-${panelId}` }, content.kind === 'text' ? content.text : '');
    const views = { testText: { id: 'testText', textSelection: true, load: () => Promise.resolve(FakeBody) } };
    m = await mountMarkdownPreview('hello', 'D:/proj/notes.prvtxt', {
      providers: { registry, views: views as never },
      providerId: 'testText',
    });
    await screen.findByTestId(`fake-body-${m.id}`);
    expect(toggle(m.id)).toBeNull();
  });
});
