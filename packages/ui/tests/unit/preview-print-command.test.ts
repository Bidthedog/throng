/**
 * 075 FR-061 – FR-064 — Print…: one command body behind the chord and the title menu (the v1 review, #732, took it off
 * the body menus), drawn on every preview,
 * disabled with the reason for a provider that cannot print, and never printing — it opens Print Preview.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, PREVIEW_KIND, type Panel } from '@throng/core';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import { panelHeaderMenu, type PanelHeaderMenuActions } from '../../src/renderer/workspace/panel-header-menu.js';
import { previewContentMenu } from '../../src/renderer/preview/content-menu.js';
import { PRINT_UNAVAILABLE, printPreviewPanel, printTitle } from '../../src/renderer/preview/print/print-command.js';
import type { PreviewProviderView } from '../../src/renderer/preview/provider-view.js';
import { PrintTooLarge } from '../../src/renderer/print/print-failure.js';

const noop = (): void => {};
const actions = (print: () => void): PanelHeaderMenuActions =>
  new Proxy({ print } as unknown as PanelHeaderMenuActions, {
    get: (target, key) => (key in target ? (target as unknown as Record<string, unknown>)[key as string] : noop),
  });

const panel: Panel = { type: 'panel', id: 'p1', originProjectId: 'proj', title: 'Panel', kind: PREVIEW_KIND };

function header(printable: boolean, print = vi.fn()): MenuAction | undefined {
  return panelHeaderMenu({
    panel,
    panelVerb: 'Destroy',
    keybindings: DEFAULT_KEYBINDINGS,
    otherTabs: [],
    editor: null,
    panelFailure: false,
    detach: null,
    preview: { providerKind: 'text', parented: false, printable },
    actions: actions(print),
  }).find((i) => i.label === 'Print…');
}

function body(): MenuAction | undefined {
  return previewContentMenu({ selectionEmpty: true, find: { run: noop }, goToHeading: { run: noop } }).find((i) => i.label === 'Print…');
}

describe('Print… in the menus (FR-062, FR-063)', () => {
  it('is in the header menu, with its chord, and runs the command', () => {
    const print = vi.fn();
    const row = header(true, print);
    expect(row).toMatchObject({ section: 'navigate', shortcut: 'Ctrl+P', icon: 'print' });
    expect(row?.disabled).toBeFalsy();
    row!.onClick!();
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('is drawn disabled, saying why, for a provider that cannot print', () => {
    expect(header(false)).toMatchObject({ disabled: true, title: PRINT_UNAVAILABLE });
  });

  it('is not in the body menu: it prints the panel, not the content under the pointer (v1 review, #732)', () => {
    expect(body()).toBeUndefined();
  });
});

describe('the command body (FR-061, FR-064)', () => {
  const output = { kind: 'document', html: '<p/>', fit: 'width', remoteImages: [] } as const;

  it('hands the provider\'s printable output to Print Preview, titled with the file name, and prints nothing', async () => {
    const printable = vi.fn(async () => output);
    const open = vi.fn(async () => ({ opened: true }));
    const host = {} as HTMLElement;
    const view = { id: 'x', textSelection: true, load: vi.fn(), printable } as unknown as PreviewProviderView;
    expect(await printPreviewPanel({ view, body: host, filePath: '/proj/docs/a.md' }, open)).toBe(true);
    expect(printable).toHaveBeenCalledWith(host, { title: 'a.md' });
    // FR-082 — the file's path goes with it, for Save as PDF's starting folder.
    expect(open).toHaveBeenCalledExactlyOnceWith({ title: 'a.md', output, filePath: '/proj/docs/a.md' });
  });

  it('does nothing for a view without printable, or before the body has drawn', async () => {
    const open = vi.fn();
    const view = { id: 'x', textSelection: true, load: vi.fn() } as unknown as PreviewProviderView;
    expect(await printPreviewPanel({ view, body: {} as HTMLElement, filePath: '/a.md' }, open)).toBe(false);
    expect(await printPreviewPanel({ view: { ...view, printable: vi.fn() }, body: null, filePath: '/a.md' }, open)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('says a PDF is too large to print in the words the drawing found, not that it could not be made ready', async () => {
    const view = { id: 'pdf', textSelection: true, load: vi.fn(), printable: vi.fn(async () => { throw new PrintTooLarge(103, 400); }) } as unknown as PreviewProviderView;
    const onFailed = vi.fn();
    const open = vi.fn();
    expect(await printPreviewPanel({ view, body: {} as HTMLElement, filePath: '/p/long.pdf' }, open, onFailed)).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledExactlyOnceWith('long.pdf', 'This PDF is too large to print: a print holds at most 64 MB of drawn pages, and this one\'s first 103 of its 400 pages fill it.');
  });

  it('titles a Windows path by its file name', () => {
    expect(printTitle('C:\\proj\\b.md')).toBe('b.md');
  });
});
