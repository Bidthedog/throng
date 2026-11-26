/**
 * 045 FR-169 – FR-171, FR-170a – FR-170c, S6/S7 — the Markdown preview's Link menu, on the SAME
 * `buildLinkMenu` path a terminal and an editor draw from (T276/T277).
 *
 * ══ WHAT MOVED, AND WHAT DID NOT (S6) ══
 *
 * `previewContentMenu` (`content-menu.ts`) no longer carries any link row: a right-click (or
 * `menu.open`) over a link with nothing selected now opens the ONE Link menu
 * (`preview-link-menu.ts`'s `openPreviewLinkMenu`, built from core's `buildLinkMenu`) INSTEAD of the
 * ordinary body menu — never both, never one leading the other, exactly as FR-171 requires and exactly
 * as a terminal's and an editor's own menus already behave. What is UNCHANGED is what following a
 * link does (044 FR-090 – FR-096): `openPreviewLinkMenu`'s Open Link, and the surface's own
 * Ctrl+click, both run the panel's own `onFollow` — the same function 044 always called.
 *
 * ══ FR-170's ASYNC FILL, PER SC-025 FIXTURE ══
 *
 * A `file` or `outside` PreviewLink is a file link exactly as a terminal or an editor sees one: the
 * menu opens AT ONCE with the renderer-known rows (FR-170c) and sends the SAME menu-open
 * `throng:links:resolve` a terminal and an editor send, filling rows 2 – 6 from its answer. A
 * `heading` link (S6's note: "offers Open Link and Copy Link to Clipboard only"), an `external` link
 * with an `http(s)` URL (web class) and one with `mailto:` (protocol class) need nothing from main —
 * `buildLinkMenu` draws Open Link / Copy Link to Clipboard from the class alone, so none of the three
 * sends a resolution request at all. An `inert` link (FR-091; `tel:`/`slack:` in a preview classify as
 * `inert` too — `classifyPreviewLink` accepts only `http:`, `https:` and `mailto:` as `external`)
 * opens no Link menu; the caller's ordinary body menu applies instead, as it does away from any link.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyPreviewLink,
  createPreviewProviderRegistry,
  previewSettingsDefaults,
  SHIPPED_PREVIEW_PROVIDERS,
  type PreviewLink,
  type ResolvedLink,
} from '@throng/core';
import { openPreviewLinkMenu, type PreviewLinkMenuArgs } from '../../src/renderer/preview/preview-link-menu.js';
import type { LinkActionDeps } from '../../src/renderer/links/link-actions.js';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import type { PreviewBodyProps, PreviewProviderView } from '../../src/renderer/preview/provider-view.js';
import { applyWikiResolution } from '../../src/renderer/preview/providers/markdown/wikilinks.js';
import { linkOf } from '../../src/renderer/preview/link-dom.js';
import { COLD, README, mountMarkdownPreview } from './helpers/mount-preview-panel.js';

const EXTERNAL: PreviewLink = { kind: 'external', url: 'https://example.com/' };

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  delete (window as unknown as { throng?: unknown }).throng;
});

// MOVED DOWN: the `previewContentMenu` (no link row, Synchronise Scrolling) and `linkAddress` cases now live in
// packages/ui/tests/unit/preview-content-menu.test.ts; this file keeps openPreviewLinkMenu and the mounted menu.

/* ── `openPreviewLinkMenu` — one Link menu, per SC-025 fixture (FR-169 – FR-171, T277) ─────────── */

function fakeOpener(): PreviewLinkMenuArgs['opener'] & { opened: MenuAction[][]; updated: [number, MenuAction[]][] } {
  const opened: MenuAction[][] = [];
  const updated: [number, MenuAction[]][] = [];
  let nextId = 0;
  return {
    opened,
    updated,
    openMenu: (_x, _y, items) => {
      opened.push(items);
      return ++nextId;
    },
    updateMenu: (opId, items) => updated.push([opId, items]),
  };
}

function fakeDeps(): LinkActionDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    openInEditor: vi.fn(() => void calls.push('editor')),
    openInPreview: vi.fn(() => void calls.push('preview')),
    revealInOsExplorer: vi.fn(async () => {
      calls.push('osExplorer');
      return { ok: true } as const;
    }),
    openInOsDefaultProgram: vi.fn(async () => {
      calls.push('osDefaultProgram');
      return { ok: true } as const;
    }),
    reportFailure: vi.fn(() => void calls.push('failure')),
  };
}

const resolvedFile: ResolvedLink = {
  path: 'D:\\proj\\docs\\target.md',
  kind: 'file',
  inProject: true,
  executable: false,
  preview: 'enabled',
};

/** A row of the menu's Open In ▸ submenu, by label. */
function openInRow(items: readonly MenuAction[] | undefined, label: string): MenuAction | undefined {
  return items?.find((i) => i.label === 'Open In')?.submenu?.find((i) => i.label === label);
}

function baseArgs(over: Partial<PreviewLinkMenuArgs> = {}): PreviewLinkMenuArgs {
  return {
    x: 1,
    y: 2,
    opener: fakeOpener(),
    link: EXTERNAL,
    panelId: 'p1',
    projectId: 'proj-1',
    projectRoot: 'D:\\proj',
    docPath: 'D:\\proj\\README.md',
    previewRegistry: SHIPPED_PREVIEW_PROVIDERS,
    previewSettings: previewSettingsDefaults(SHIPPED_PREVIEW_PROVIDERS),
    ws: { layout: null } as unknown as PreviewLinkMenuArgs['ws'],
    deps: fakeDeps(),
    onFollow: vi.fn(),
    ...over,
  };
}

describe('openPreviewLinkMenu — SC-025: the same Link menu, per fixture (FR-170)', () => {
  it('a `file` link sends the menu-open resolve and fills rows 2 – 6 from its answer', async () => {
    const resolve = vi.fn(() => Promise.resolve({ ok: true as const, link: resolvedFile }));
    (window as unknown as { throng: unknown }).throng = { links: { resolve } };
    const opener = fakeOpener();
    const link: PreviewLink = { kind: 'file', absPath: resolvedFile.path };

    const opened = openPreviewLinkMenu(baseArgs({ link, opener }));

    expect(opened).toBe(true);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0]?.[0]).toMatchObject({ text: resolvedFile.path, kind: 'fileHyperlink' });
    // 081 FR-051 — before main answers, the default-program row is drawn inside Open In ▸, disabled.
    const TOP = ['Open Link', 'Open In', 'Find in File Explorer', 'Copy Link to Clipboard'];
    expect(opener.opened[0]?.map((i) => i.label)).toEqual(TOP);
    expect(openInRow(opener.opened[0], 'Open in OS Default Program')?.disabled).toBe(true);

    await waitFor(() => expect(opener.updated).toHaveLength(1));
    const filled = opener.updated[0]?.[1];
    expect(filled?.map((i) => i.label)).toEqual(TOP);
    // 081 FR-050 — the File Explorer's OS and preview rows, now inside Open In ▸.
    expect(openInRow(filled, 'Open in OS Default Program')?.disabled).toBeFalsy();
    expect(openInRow(filled, 'New Preview Panel')?.disabled).toBeFalsy();
  });

  it('068 FR-006: a resolved wikilink’s menu resolves and copies the file main answered, not candidate 0', async () => {
    const resolve = vi.fn(() => Promise.resolve({ ok: true as const, link: resolvedFile }));
    (window as unknown as { throng: unknown }).throng = { links: { resolve } };
    const a = document.createElement('a');
    a.setAttribute('data-throng-wiki-index', '0');
    a.setAttribute('data-throng-link', JSON.stringify({ kind: 'file', absPath: 'D:\\proj\\docs\\Target.md' }));
    document.body.append(a);
    applyWikiResolution(document.body, ['D:\\proj\\folder\\Target.md'], 'D:\\proj');

    openPreviewLinkMenu(baseArgs({ link: linkOf(a)! }));

    expect(resolve.mock.calls[0]?.[0]).toMatchObject({ text: 'D:\\proj\\folder\\Target.md' });
  });

  it('an `outside` link sends the same resolve, with the document’s own directory as the base', async () => {
    const outsideResolved: ResolvedLink = { ...resolvedFile, path: 'D:\\elsewhere\\x.md', inProject: false };
    const resolve = vi.fn(() => Promise.resolve({ ok: true as const, link: outsideResolved }));
    (window as unknown as { throng: unknown }).throng = { links: { resolve } };
    const opener = fakeOpener();
    const link: PreviewLink = { kind: 'outside', target: '../../x.md' };

    openPreviewLinkMenu(baseArgs({ link, opener, docPath: 'D:\\proj\\docs\\a.md' }));
    expect(resolve.mock.calls[0]?.[0]).toMatchObject({
      text: '../../x.md',
      kind: 'fileHyperlink',
      baseDirectory: 'D:\\proj\\docs',
    });

    await waitFor(() => expect(opener.updated).toHaveLength(1));
    // Out of project once resolved: Open In ▸ holds the two OS rows only (081 FR-051, FR-052).
    const filled = opener.updated[0]?.[1];
    expect(filled?.map((i) => i.label)).toEqual(['Open Link', 'Open In', 'Copy Link to Clipboard']);
    expect(filled?.find((i) => i.label === 'Open In')?.submenu?.map((i) => i.label)).toEqual([
      'OS File Explorer',
      'Open in OS Default Program',
    ]);
  });

  it('a `heading` link maps to the anchor rows — Open Link and Copy Link to Clipboard only, no resolve', () => {
    const resolve = vi.fn();
    (window as unknown as { throng: unknown }).throng = { links: { resolve } };
    const opener = fakeOpener();
    const link: PreviewLink = { kind: 'heading', fragment: 'install' };

    const opened = openPreviewLinkMenu(baseArgs({ link, opener, docPath: 'D:\\proj\\README.md' }));

    expect(opened).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
    expect(opener.opened[0]?.map((i) => i.label)).toEqual(['Open Link', 'Copy Link to Clipboard']);
  });

  it('an `external` http(s) link is the web class — Open Link and Copy Link to Clipboard only, no resolve', () => {
    const resolve = vi.fn();
    (window as unknown as { throng: unknown }).throng = { links: { resolve }, clipboard: { write: vi.fn() } };
    const opener = fakeOpener();

    const opened = openPreviewLinkMenu(baseArgs({ link: EXTERNAL, opener }));

    expect(opened).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
    expect(opener.opened[0]?.map((i) => i.label)).toEqual(['Open Link', 'Copy Link to Clipboard']);
  });

  it('an `external` mailto: link is the protocol class — the same two rows, no resolve', () => {
    const resolve = vi.fn();
    (window as unknown as { throng: unknown }).throng = { links: { resolve }, clipboard: { write: vi.fn() } };
    const opener = fakeOpener();
    const link: PreviewLink = { kind: 'external', url: 'mailto:a@b.c' };

    const opened = openPreviewLinkMenu(baseArgs({ link, opener }));

    expect(opened).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
    expect(opener.opened[0]?.map((i) => i.label)).toEqual(['Open Link', 'Copy Link to Clipboard']);
  });

  it('an `inert` link opens no Link menu — including tel: and slack:, which classify as inert in a preview', () => {
    const opener = fakeOpener();
    expect(openPreviewLinkMenu(baseArgs({ link: { kind: 'inert' }, opener }))).toBe(false);
    expect(opener.opened).toHaveLength(0);

    const ctx = { docPath: 'D:/proj/a.md', projectRoot: 'D:/proj' };
    expect(classifyPreviewLink('tel:+15551234567', ctx).kind).toBe('inert');
    expect(classifyPreviewLink('slack://open', ctx).kind).toBe('inert');
  });

  it('#714: a folder by grammar inside the project offers Find in File Explorer, which reveals that folder', () => {
    const resolve = vi.fn();
    (window as unknown as { throng: unknown }).throng = { links: { resolve } };
    const reveals: (string | undefined)[] = [];
    const listener = (e: Event): void => void reveals.push((e as CustomEvent<{ absPath?: string }>).detail?.absPath);
    window.addEventListener('throng:reveal-in-tree', listener);
    try {
      const opener = fakeOpener();
      openPreviewLinkMenu(baseArgs({ link: { kind: 'outside', target: 'sub/' }, opener, docPath: 'D:\\proj\\README.md' }));

      // FR-158d — a folder by grammar asks main nothing.
      expect(resolve).not.toHaveBeenCalled();
      const find = opener.opened[0]?.find((i) => i.label === 'Find in File Explorer');
      expect(find?.disabled).toBe(false);
      find?.onClick?.();
      expect(reveals).toEqual(['D:\\proj\\sub']);
    } finally {
      window.removeEventListener('throng:reveal-in-tree', listener);
    }
  });

  it('#714: a folder by grammar outside the project, or the project root itself, offers no Find in File Explorer', () => {
    (window as unknown as { throng: unknown }).throng = { links: { resolve: vi.fn() } };
    for (const target of ['D:\\elsewhere\\', 'D:\\proj\\']) {
      const opener = fakeOpener();
      openPreviewLinkMenu(baseArgs({ link: { kind: 'outside', target }, opener }));
      expect(opener.opened[0]?.map((i) => i.label)).toEqual(['Open Link', 'Open In', 'Copy Link to Clipboard']);
    }
  });

  it('Open Link runs the panel’s own follow, exactly as Ctrl+click does (S6)', () => {
    const onFollow = vi.fn();
    const opener = fakeOpener();
    openPreviewLinkMenu(baseArgs({ link: EXTERNAL, opener, onFollow }));
    opener.opened[0]?.find((i) => i.label === 'Open Link')?.onClick?.();
    expect(onFollow).toHaveBeenCalledWith(EXTERNAL);
  });
});

/* ── Mounted panel: the two menus never mix (FR-171) ─────────────────────────────────────────────── */

describe('in a mounted panel', () => {
  it('right-clicking a link opens the Link menu, and Copy Link to Clipboard writes through the clipboard bridge', async () => {
    const m = await mountMarkdownPreview('# T\n\n[Site](https://example.com/)\n');
    try {
      const site = await screen.findByText('Site', {}, COLD);
      fireEvent.contextMenu(site, { clientX: 20, clientY: 20 });
      // The Link menu opened INSTEAD of the ordinary body menu — no Sync Scrolling beside it.
      expect(screen.queryByTestId('menu-item-Synchronise Scrolling')).toBeNull();
      fireEvent.click(await screen.findByTestId('menu-item-Copy Link to Clipboard'));
      expect(m.clipboardWrite).toHaveBeenCalledWith({ text: 'https://example.com/', mode: 'verbatim' });
    } finally {
      m.unmount();
    }
  });

  it('Copy Link to Clipboard on a same-document heading link writes the preview’s own path, then the fragment (FR-116)', async () => {
    const m = await mountMarkdownPreview('# T\n\n## Install\n\n[Jump](#install)\n');
    try {
      const jump = await screen.findByText('Jump', {}, COLD);
      fireEvent.contextMenu(jump, { clientX: 20, clientY: 20 });
      fireEvent.click(await screen.findByTestId('menu-item-Copy Link to Clipboard'));
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

  it('right-clicking an inert link opens no Link menu — the ordinary menu applies instead', async () => {
    const m = await mountMarkdownPreview('# T\n\n<a href="javascript:alert(1)">Bad</a>\n');
    try {
      const bad = await screen.findByText('Bad', {}, COLD);
      fireEvent.contextMenu(bad, { clientX: 20, clientY: 20 });
      expect(screen.queryByTestId('menu-item-Open Link')).toBeNull();
    } finally {
      m.unmount();
    }
  });

  it('a `file` link’s Link menu sends throng:links:resolve and offers Open In ▸ New Preview Panel once it answers', async () => {
    const m = await mountMarkdownPreview('# T\n\n[Other](other.md)\n', 'D:/proj/docs/a.md');
    try {
      m.links.resolve.mockResolvedValue({
        ok: true,
        link: { path: 'D:\\proj\\docs\\other.md', kind: 'file', inProject: true, executable: false, preview: 'enabled' },
      });
      const other = await screen.findByText('Other', {}, COLD);
      fireEvent.contextMenu(other, { clientX: 20, clientY: 20 });
      await screen.findByTestId('menu-item-Open Link');
      await waitFor(() => expect(m.links.resolve).toHaveBeenCalledTimes(1));
      fireEvent.click(await screen.findByTestId('menu-item-Open In'));
      await waitFor(() => expect(screen.getByTestId('menu-item-New Preview Panel').getAttribute('aria-disabled')).toBe('false'));
    } finally {
      m.unmount();
    }
  });

  it('#714: Find in File Explorer on a `file` link reveals the resolved file, as the header’s Reveal File does', async () => {
    const m = await mountMarkdownPreview('# T\n\n[Other](other.md)\n', 'D:/proj/docs/a.md');
    const reveals: (string | undefined)[] = [];
    const listener = (e: Event): void => void reveals.push((e as CustomEvent<{ absPath?: string }>).detail?.absPath);
    window.addEventListener('throng:reveal-in-tree', listener);
    try {
      m.links.resolve.mockResolvedValue({
        ok: true,
        link: { path: 'D:\\proj\\docs\\other.md', kind: 'file', inProject: true, executable: false, preview: 'enabled' },
      });
      const other = await screen.findByText('Other', {}, COLD);
      fireEvent.contextMenu(other, { clientX: 20, clientY: 20 });
      await waitFor(() =>
        expect(screen.getByTestId('menu-item-Find in File Explorer').getAttribute('aria-disabled')).toBe('false'),
      );
      fireEvent.click(screen.getByTestId('menu-item-Find in File Explorer'));
      expect(reveals).toEqual(['D:\\proj\\docs\\other.md']);
    } finally {
      window.removeEventListener('throng:reveal-in-tree', listener);
      m.unmount();
    }
  });

  it('is never offered on a binary provider’s preview (no link, ordinary menu only)', async () => {
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
      expect(screen.queryByTestId('menu-item-Synchronise Scrolling')).toBeNull();
      expect(screen.queryByTestId('menu-item-Open Link')).toBeNull();
    } finally {
      m.unmount();
    }
  });
});
