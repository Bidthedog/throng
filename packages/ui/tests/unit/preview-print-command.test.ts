/**
 * 075 FR-061 – FR-064 — Print…: one command body behind the chord and both menus, drawn on every preview,
 * disabled with the reason for a provider that cannot print, and never printing — it opens Print Preview.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, PREVIEW_KIND, type Panel } from '@throng/core';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import { panelHeaderMenu, type PanelHeaderMenuActions } from '../../src/renderer/workspace/panel-header-menu.js';
import { previewContentMenu } from '../../src/renderer/preview/content-menu.js';
import { PRINT_UNAVAILABLE, printPreviewPanel, printTitle } from '../../src/renderer/preview/print/print-command.js';
import type { PreviewProviderView } from '../../src/renderer/preview/provider-view.js';

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

function body(unavailable?: string, run = vi.fn()): MenuAction | undefined {
  return previewContentMenu({
    selectionEmpty: true,
    find: { run: noop },
    goToHeading: { run: noop },
    print: { run, chord: 'Ctrl+P', ...(unavailable !== undefined ? { unavailable } : {}) },
  }).find((i) => i.label === 'Print…');
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
    expect(body(PRINT_UNAVAILABLE)).toMatchObject({ disabled: true, title: PRINT_UNAVAILABLE });
  });

  it('is in the body menu, enabled, and runs the command', () => {
    const run = vi.fn();
    const row = body(undefined, run);
    expect(row).toMatchObject({ section: 'navigate', shortcut: 'Ctrl+P' });
    expect(row?.disabled).toBeFalsy();
    row!.onClick!();
    expect(run).toHaveBeenCalledTimes(1);
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
    expect(open).toHaveBeenCalledExactlyOnceWith({ title: 'a.md', output });
  });

  it('does nothing for a view without printable, or before the body has drawn', async () => {
    const open = vi.fn();
    const view = { id: 'x', textSelection: true, load: vi.fn() } as unknown as PreviewProviderView;
    expect(await printPreviewPanel({ view, body: {} as HTMLElement, filePath: '/a.md' }, open)).toBe(false);
    expect(await printPreviewPanel({ view: { ...view, printable: vi.fn() }, body: null, filePath: '/a.md' }, open)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('titles a Windows path by its file name', () => {
    expect(printTitle('C:\\proj\\b.md')).toBe('b.md');
  });
});
