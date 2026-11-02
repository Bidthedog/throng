/**
 * 047 T048 (US3, FR-036, FR-038, contracts "Preview body menu" / "Status bar") — the preview body
 * menu's context-sensitive fold rows and the status-bar Collapse All / Expand All toggle.
 *
 * Two layers, mirroring `editor-markdown-fold-menu.test.ts`'s own split:
 *
 * - `previewContentMenu(...)` with a `fold` argument — what the menu SAYS and does once handed one — is
 *   `unit/preview-content-menu.test.ts`'s.
 * - `sectionAtPoint` (`fold-menu-section.ts`) is tested directly against hand-built DOM — the WHERE.
 * - A mounted `preview-panel.tsx` proves the WIRING: a real right-click resolves the clicked section,
 *   a real click on a row changes the real fold state (the body's content actually hides), and the
 *   status-bar toggle is present only for a Markdown provider.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { sectionAtPoint } from '../../src/renderer/preview/fold-menu-section.js';
import { __resetFoldStateStore } from '../../src/renderer/editor/fold-state-store.js';
import { COLD, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

// MOVED DOWN: the `previewContentMenu` fold-row cases (no fold, This-Section, Collapse/Expand All, Outlining submenu)
// now live in packages/ui/tests/unit/preview-content-menu.test.ts; this file keeps sectionAtPoint and the mounted wiring.

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
    fireEvent.click(await screen.findByTestId('menu-item-Outlining'));

    expect(await screen.findByTestId('menu-item-Collapse All')).toBeInTheDocument();
    expect(screen.getByTestId('menu-item-Expand All')).toBeInTheDocument();
    expect(screen.queryByTestId(/menu-item-(Collapse|Expand) This H/)).toBeNull();
  });

  it('opened over content under "Two" (H2): Collapse This H2, and clicking it hides that section only', async () => {
    m = await mountMarkdownPreview(DOC);
    const bodyTwo = await screen.findByText('body two', {}, COLD);
    fireEvent.contextMenu(bodyTwo, { clientX: 5, clientY: 5 });
    fireEvent.click(await screen.findByTestId('menu-item-Outlining'));

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
    fireEvent.click(await screen.findByTestId('menu-item-Outlining'));
    fireEvent.click(await screen.findByTestId('menu-item-Collapse This H2'));
    await waitFor(() => expect(bodyTwo).not.toBeVisible());

    const heading = await screen.findByText('Two');
    fireEvent.contextMenu(heading, { clientX: 5, clientY: 5 });
    fireEvent.click(await screen.findByTestId('menu-item-Outlining'));
    expect(await screen.findByTestId('menu-item-Expand This H2')).toBeInTheDocument();
    expect(screen.queryByTestId('menu-item-Collapse This H2')).toBeNull();
  });

  it('054 — Collapse All Inside This H1 folds the H2 nested in it but leaves One open; Expand All Inside opens it', async () => {
    m = await mountMarkdownPreview(DOC);
    const bodyOne = await screen.findByText('body one', {}, COLD);
    const bodyTwo = screen.getByText('body two');
    fireEvent.contextMenu(bodyOne, { clientX: 5, clientY: 5 });
    fireEvent.click(await screen.findByTestId('menu-item-Outlining'));
    fireEvent.click(await screen.findByTestId('menu-item-Collapse All Inside This H1'));
    await waitFor(() => expect(bodyTwo).not.toBeVisible());
    expect(bodyOne, 'the target heading itself stays open').toBeVisible();

    fireEvent.contextMenu(bodyOne, { clientX: 5, clientY: 5 });
    fireEvent.click(await screen.findByTestId('menu-item-Outlining'));
    fireEvent.click(await screen.findByTestId('menu-item-Expand All Inside This H1'));
    await waitFor(() => expect(bodyTwo).toBeVisible());
    expect(bodyOne).toBeVisible();
  });

  it('Collapse All from the menu hides every section’s content', async () => {
    m = await mountMarkdownPreview(DOC);
    const bodyOne = await screen.findByText('body one', {}, COLD);
    const bodyTwo = screen.getByText('body two');
    fireEvent.contextMenu(bodyOne, { clientX: 5, clientY: 5 });
    fireEvent.click(await screen.findByTestId('menu-item-Outlining'));
    fireEvent.click(await screen.findByTestId('menu-item-Collapse All'));

    await waitFor(() => expect(bodyOne).not.toBeVisible());
    expect(bodyTwo).not.toBeVisible();
  });

  it('Collapse All / Expand All are DISABLED with no headings at all, never absent', async () => {
    m = await mountMarkdownPreview('just a paragraph, no headings\n');
    const p = await screen.findByText('just a paragraph, no headings', {}, COLD);
    fireEvent.contextMenu(p, { clientX: 5, clientY: 5 });
    fireEvent.click(await screen.findByTestId('menu-item-Outlining'));

    const collapseAll = await screen.findByTestId('menu-item-Collapse All');
    expect(collapseAll).toBeInTheDocument();
    expect(collapseAll).toHaveClass('context-menu__item--disabled');
    expect(screen.getByTestId('menu-item-Expand All')).toHaveClass('context-menu__item--disabled');
  });
});

/* ── Mounted: no status-bar toggle (054 FR-046j supersedes 047 FR-038) ───────────────────────────── */

describe('the status-bar Collapse All / Expand All toggle', () => {
  const toggle = (id: string): HTMLElement | null => screen.queryByTestId(`preview-fold-toggle-${id}`);

  it('is ABSENT for a Markdown preview: the Outlining submenu, the gutter and the chords are the routes', async () => {
    m = await mountMarkdownPreview(DOC);
    await screen.findByText('body one', {}, COLD);
    // The bar itself is drawn, so the absence is of the toggle, not of the bar.
    expect(screen.getByTestId(`preview-sync-scroll-${m.id}`)).toBeInTheDocument();
    expect(toggle(m.id)).toBeNull();
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
