/**
 * 044 T090 — the preview body menu's Contextual section: Open Link and Copy Link Address, only over a
 * followable link with nothing selected (FR-095; contracts/menus-and-controls.md §4).
 *
 * The builder is pure, so its conditions are pinned directly; the one thing only a mounted panel can
 * show — that Copy Link Address really writes through the clipboard bridge — mounts one.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPreviewProviderRegistry, type PreviewLink } from '@throng/core';
import { linkAddress, previewContentMenu } from '../../src/renderer/preview/content-menu.js';
import type { PreviewBodyProps, PreviewProviderView } from '../../src/renderer/preview/provider-view.js';
import { COLD, README, mountMarkdownPreview } from './helpers/mount-preview-panel.js';

const EXTERNAL: PreviewLink = { kind: 'external', url: 'https://example.com/' };

function build(link: PreviewLink | null, selectionEmpty = true) {
  const actions = { openLink: vi.fn(), copyLinkAddress: vi.fn() };
  const items = previewContentMenu({ link, selectionEmpty, followChord: 'Ctrl+Enter', actions });
  return { items, actions };
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe('the Contextual section (FR-095)', () => {
  it('over a followable link with nothing selected: Open Link (with its chord), then Copy Link Address', () => {
    const { items, actions } = build(EXTERNAL);
    const contextual = items.filter((i) => i.section === 'contextual');
    expect(contextual.map((i) => i.label)).toEqual(['Open Link', 'Copy Link Address']);
    expect(contextual[0].shortcut).toBe('Ctrl+Enter');
    expect(contextual[1].icon).toBe('copy');
    // Above the body menu's other items: the section leads.
    expect(items[0].label).toBe('Open Link');

    contextual[0].onClick?.();
    expect(actions.openLink).toHaveBeenCalledWith(EXTERNAL);
    contextual[1].onClick?.();
    expect(actions.copyLinkAddress).toHaveBeenCalledWith(EXTERNAL);
  });

  it.each<[string, PreviewLink]>([
    ['a project file', { kind: 'file', absPath: 'D:/proj/docs/a.md', fragment: 'x' }],
    ['a same-document heading', { kind: 'heading', fragment: 'install' }],
    ['a link outside the project (following it says so)', { kind: 'outside', target: '../../x.md' }],
  ])('is present over %s', (_name, link) => {
    expect(build(link).items.filter((i) => i.section === 'contextual')).toHaveLength(2);
  });

  it('is absent over an inert link', () => {
    expect(build({ kind: 'inert' }).items.filter((i) => i.section === 'contextual')).toEqual([]);
  });

  it('is absent when nothing is under the pointer', () => {
    expect(build(null).items.filter((i) => i.section === 'contextual')).toEqual([]);
  });

  it('is absent whenever text is selected, even over a link — the ordinary menu wins', () => {
    expect(build(EXTERNAL, false).items.filter((i) => i.section === 'contextual')).toEqual([]);
  });

  it('omits the chord when preview.followLink is unbound', () => {
    const items = previewContentMenu({
      link: EXTERNAL,
      selectionEmpty: true,
      followChord: undefined,
      actions: { openLink: vi.fn(), copyLinkAddress: vi.fn() },
    });
    expect(items[0].shortcut).toBeUndefined();
  });
});

/*
 * Iteration 2026-09-15, FR-116 (T193) — the address takes the document the link sits in. A same-document
 * heading link copied `#install` before; it now copies the preview's own file, then the fragment, so what is
 * on the clipboard names a place a reader can reach from outside this panel.
 */
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
  const sync = { on: true, toggle: () => {} };

  it.each<[string, PreviewLink | null, boolean]>([
    ['nothing under the pointer, nothing selected', null, true],
    ['a link under the pointer, nothing selected', EXTERNAL, true],
    ['a link under the pointer, text selected', EXTERNAL, false],
    ['plain text, text selected', null, false],
  ])('is the last item with %s', (_name, link, selectionEmpty) => {
    const items = previewContentMenu({
      link,
      selectionEmpty,
      followChord: 'Ctrl+Enter',
      actions: { openLink: vi.fn(), copyLinkAddress: vi.fn() },
      content: { copyFormat: 'rich', copy: vi.fn(), selectAll: vi.fn() },
      editorRoute: { parented: false, run: vi.fn() },
      syncScroll: sync,
    });
    expect(items.at(-1)).toMatchObject({ testId: SYNC, section: 'viewState', label: 'Synchronise Scrolling ✓' });
  });

  it('is absent when the panel hands the builder none (a binary provider)', () => {
    const items = previewContentMenu({
      link: null,
      selectionEmpty: true,
      followChord: undefined,
      actions: { openLink: vi.fn(), copyLinkAddress: vi.fn() },
      syncScroll: null,
    });
    expect(items.find((i) => i.testId === SYNC)).toBeUndefined();
  });
});

describe('Synchronise Scrolling in a mounted preview (FR-122, FR-122a, FR-122b)', () => {
  const SYNC = 'menu-item-Synchronise Scrolling';

  /** Capture `writePatch` on the mounted window's config bridge; `writeConfigPatch` reads it per call. */
  function spyPatches(result: { ok: boolean } = { ok: true }) {
    const writePatch = vi.fn((_id: unknown, _changes: unknown) => Promise.resolve(result));
    (window.throng as unknown as { config: Record<string, unknown> }).config.writePatch = writePatch;
    return writePatch;
  }

  it('is offered over plain text, checked while on, and choosing it flips the setting once', async () => {
    const m = await mountMarkdownPreview('# T\n\nplain words\n');
    try {
      const writePatch = spyPatches();
      fireEvent.contextMenu(await screen.findByText('plain words', {}, COLD), { clientX: 20, clientY: 20 });
      const item = await screen.findByTestId(SYNC);
      expect(item).toHaveTextContent('Synchronise Scrolling ✓');
      fireEvent.click(item);
      await waitFor(() => expect(writePatch).toHaveBeenCalledTimes(1));
      expect(writePatch.mock.calls[0]?.[1]).toEqual([{ path: ['editor', 'previews', 'syncScroll'], value: false }]);
    } finally {
      m.unmount();
    }
  });

  it('is offered over a link too, beside Open Link', async () => {
    const m = await mountMarkdownPreview('# T\n\n[Site](https://example.com/)\n');
    try {
      fireEvent.contextMenu(await screen.findByText('Site', {}, COLD), { clientX: 20, clientY: 20 });
      expect(await screen.findByTestId('menu-item-Open Link')).toBeInTheDocument();
      expect(screen.getByTestId(SYNC)).toBeInTheDocument();
    } finally {
      m.unmount();
    }
  });

  it('reads the bare label while the setting is off', async () => {
    const m = await mountMarkdownPreview('# T\n\nplain words\n', README, {
      settings: { editor: { previews: { syncScroll: false } } },
    });
    try {
      fireEvent.contextMenu(await screen.findByText('plain words', {}, COLD), { clientX: 20, clientY: 20 });
      const item = await screen.findByTestId(SYNC);
      expect(item).toHaveTextContent('Synchronise Scrolling');
      expect(item.textContent).not.toContain('✓');
    } finally {
      m.unmount();
    }
  });

  it('stays in the menu, enabled, while the status bar is hidden (G1)', async () => {
    const m = await mountMarkdownPreview('# T\n\nplain words\n', README, {
      settings: { editor: { showStatusBar: false } },
    });
    try {
      await waitFor(() => expect(screen.queryByTestId(`preview-status-bar-${m.id}`)).toBeNull());
      fireEvent.contextMenu(await screen.findByText('plain words', {}, COLD), { clientX: 20, clientY: 20 });
      const item = await screen.findByTestId(SYNC);
      expect(item).not.toHaveAttribute('aria-disabled', 'true');
      expect(item).not.toBeDisabled();
    } finally {
      m.unmount();
    }
  });

  it('is never offered on a binary provider’s preview', async () => {
    const registry = createPreviewProviderRegistry([
      { id: 'testBinary', displayName: 'Test binary', extensions: ['.prvbin'], kind: 'binary', sourceMimeTypes: ['application/pdf'] },
    ]);
    const FakeBody = ({ panelId }: PreviewBodyProps): ReactElement =>
      createElement('div', { 'data-testid': `fake-body-${panelId}` }, 'binary');
    const views: Record<string, PreviewProviderView> = {
      testBinary: { id: 'testBinary', textSelection: false, load: () => Promise.resolve(FakeBody) },
    };
    const m = await mountMarkdownPreview('', 'D:/proj/manual.prvbin', { providers: { registry, views }, providerId: 'testBinary' });
    try {
      fireEvent.contextMenu(await screen.findByTestId(`fake-body-${m.id}`), { clientX: 20, clientY: 20 });
      await act(() => Promise.resolve());
      expect(screen.queryByTestId(SYNC)).toBeNull();
    } finally {
      m.unmount();
    }
  });
});

describe('in a mounted panel', () => {
  it('right-clicking a link opens the menu, and Copy Link Address writes through the clipboard bridge', async () => {
    const m = await mountMarkdownPreview('# T\n\n[Site](https://example.com/)\n');
    try {
      const site = await screen.findByText('Site', {}, COLD);
      fireEvent.contextMenu(site, { clientX: 20, clientY: 20 });
      fireEvent.click(await screen.findByTestId('menu-item-Copy Link Address'));
      expect(m.clipboardWrite).toHaveBeenCalledWith({ text: 'https://example.com/', mode: 'verbatim' });
    } finally {
      m.unmount();
    }
  });

  it('Copy Link Address on a same-document heading link writes the preview’s own path, then the fragment (FR-116)', async () => {
    const m = await mountMarkdownPreview('# T\n\n## Install\n\n[Jump](#install)\n');
    try {
      const jump = await screen.findByText('Jump', {}, COLD);
      fireEvent.contextMenu(jump, { clientX: 20, clientY: 20 });
      fireEvent.click(await screen.findByTestId('menu-item-Copy Link Address'));
      expect(m.clipboardWrite).toHaveBeenCalledWith({ text: `${README}#install`, mode: 'verbatim' });
    } finally {
      m.unmount();
    }
  });

  it('Open Link from the menu follows the link exactly as Ctrl+click does', async () => {
    const m = await mountMarkdownPreview('# T\n\n[Site](https://example.com/)\n');
    try {
      const site = await screen.findByText('Site', {}, COLD);
      fireEvent.contextMenu(site, { clientX: 20, clientY: 20 });
      fireEvent.click(await screen.findByTestId('menu-item-Open Link'));
      expect(m.openExternal).toHaveBeenCalledWith('https://example.com/');
    } finally {
      m.unmount();
    }
  });

  it('right-clicking an inert link opens no link menu', async () => {
    const m = await mountMarkdownPreview('# T\n\n<a href="javascript:alert(1)">Bad</a>\n');
    try {
      const bad = await screen.findByText('Bad', {}, COLD);
      fireEvent.contextMenu(bad, { clientX: 20, clientY: 20 });
      expect(screen.queryByTestId('menu-item-Open Link')).toBeNull();
    } finally {
      m.unmount();
    }
  });
});
