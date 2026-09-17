/**
 * 044 T116 — every action in a preview's HEADER menu does its job on a preview (FR-012, FR-028, FR-033,
 * FR-034, FR-042; 030 FR-042c; contracts/menus-and-controls.md §1, §9; US3 scenario 1).
 *
 * `menu-sections.test.ts` pins what the menu IS — its rows, sections and conditions. This file pins what
 * each row DOES once it is clicked on a mounted preview, through the preview's own paths:
 *
 * | Row                             | On a preview                                                         |
 * |---------------------------------|----------------------------------------------------------------------|
 * | Close Panel                     | destroyed, no prompt (FR-042)                                         |
 * | Reveal File in Files & Folders  | `throng:reveal-in-tree` for the file the PREVIEW shows                |
 * | Open in OS Explorer             | `files.revealDocument` for that file                                  |
 * | Refresh                         | `preview.refresh` (FR-028)                                            |
 * | Zoom ▸ Zoom In                  | this panel's zoom, never its parent editor's (FR-034)                 |
 * | Try again                       | the banner's own retry — for a file notice, `preview.refresh`         |
 * | Copy details                    | the failure's own message and path, through the clipboard bridge      |
 * | Clear panel type                | `destroyed`, then the type cleared, no prompt; the file is no longer open (FR-012) |
 *
 * The three banner rows are present exactly while a banner with them is up — an attach or body failure,
 * or an FR-026 file notice. The FR-027 notice (the file type has no preview) offers Close only, so none of
 * the three appears for it.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectPanels,
  createPreviewProviderRegistry,
  panelZoomLevel,
  type Panel,
  type PreviewNotice,
  type PreviewUpdate,
} from '@throng/core';
import type { PreviewBodyProps, PreviewProviderView } from '../../src/renderer/preview/provider-view.js';
import { isPreviewOpen } from '../../src/renderer/preview/preview-open-store.js';
import { mountMarkdownPreview, previewUpdate, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const FILE = 'D:/proj/notes.prvtxt';
const registry = createPreviewProviderRegistry([
  { id: 'testText', displayName: 'Test text', extensions: ['.prvtxt'], kind: 'text' },
]);
function FakeBody({ panelId, content }: PreviewBodyProps): ReactElement {
  return createElement('div', { 'data-testid': `fake-body-${panelId}` }, content.kind === 'text' ? content.text : '');
}
const views: Record<string, PreviewProviderView> = {
  testText: { id: 'testText', textSelection: true, load: () => Promise.resolve(FakeBody) },
};

let m: MountedPreviewWindow | undefined;

async function mountText(): Promise<MountedPreviewWindow> {
  m = await mountMarkdownPreview('hello', FILE, {
    providers: { registry, views },
    providerId: 'testText',
    openPaths: [FILE],
  });
  await screen.findByTestId(`fake-body-${m.id}`);
  return m;
}

const update = (over: Partial<PreviewUpdate> & { revision: number }): PreviewUpdate =>
  previewUpdate({ panelId: m!.id, providerId: 'testText', filePath: FILE, content: null, ...over });

const pushNotice = (revision: number, notice: PreviewNotice | null): void => m!.push(update({ revision, notice }));

async function openHeaderMenu(): Promise<void> {
  fireEvent.contextMenu(screen.getByTestId(`panel-handle-${m!.id}`));
  await screen.findByTestId('menu-item-Close Panel');
}
const item = (label: string): HTMLElement => screen.getByTestId(`menu-item-${label}`);
const hasItem = (label: string): boolean => screen.queryByTestId(`menu-item-${label}`) !== null;
const panels = (): Panel[] => collectPanels(m!.ws().layout!.tabs[0].root) as Panel[];

afterEach(() => {
  m?.unmount();
  m = undefined;
  document.body.replaceChildren();
});

describe('the ordinary rows (FR-033)', () => {
  it('Close Panel sends destroyed and removes the panel, with no prompt (FR-042)', async () => {
    const { id } = await mountText();
    act(() => {
      m!.ws().addPanel(m!.ws().layout!.tabs[0].id);
      m!.ws().clearLastAddedPanel();
    });
    // Parented to a dirty document — the state in which an editor WOULD ask.
    m!.push(update({ revision: 2, dirty: true, parent: { panelId: 'ed', title: 'notes' } }));
    await openHeaderMenu();

    fireEvent.click(item('Close Panel'));

    await waitFor(() => expect(panels().map((p) => p.id)).not.toContain(id));
    expect(m!.preview.destroyed).toHaveBeenCalledWith(id);
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    expect(screen.queryByTestId('dirty-close-dialog')).toBeNull();
  });

  it('Reveal File in Files & Folders dispatches throng:reveal-in-tree for the previewed file', async () => {
    await mountText();
    const heard: unknown[] = [];
    const listener = (e: Event): void => {
      heard.push((e as CustomEvent).detail);
    };
    window.addEventListener('throng:reveal-in-tree', listener);
    try {
      await openHeaderMenu();
      fireEvent.click(item('Reveal File in Files & Folders'));
      expect(heard).toEqual([{ absPath: FILE }]);
    } finally {
      window.removeEventListener('throng:reveal-in-tree', listener);
    }
  });

  it('Open in OS Explorer asks revealDocument for the previewed file (revealPanelFile)', async () => {
    await mountText();
    await openHeaderMenu();
    fireEvent.click(item('Open in OS Explorer'));
    expect(m!.revealDocument).toHaveBeenCalledWith(FILE);
  });

  it('reveals the file the run shows NOW — a followed link moved it', async () => {
    await mountText();
    const moved = 'D:/proj/docs/setup.prvtxt';
    m!.push(update({ revision: 2, filePath: moved, content: { kind: 'text', text: 'setup' } }));
    await openHeaderMenu();
    fireEvent.click(item('Open in OS Explorer'));
    expect(m!.revealDocument).toHaveBeenCalledWith(moved);
  });

  it('Refresh calls preview.refresh for this panel (FR-028)', async () => {
    const { id } = await mountText();
    await openHeaderMenu();
    fireEvent.click(item('Refresh'));
    await waitFor(() => expect(m!.preview.refresh).toHaveBeenCalledWith(id));
  });

  it('Refresh applies the update main answers with', async () => {
    const { id } = await mountText();
    m!.preview.refresh.mockImplementation(() =>
      Promise.resolve({ update: update({ revision: 5, content: { kind: 'text', text: 'read again' } }) }),
    );
    await openHeaderMenu();
    fireEvent.click(item('Refresh'));
    await waitFor(() => expect(screen.getByTestId(`fake-body-${id}`)).toHaveTextContent('read again'));
  });

  it('Zoom In changes the preview’s zoom and not its parent editor’s (FR-034)', async () => {
    const { id } = await mountText();
    let parentId = '';
    act(() => {
      parentId = m!.ws().addPanel(m!.ws().layout!.tabs[0].id);
      m!.ws().clearLastAddedPanel();
    });
    m!.push(update({ revision: 2, parent: { panelId: parentId, title: 'notes' } }));
    await openHeaderMenu();

    fireEvent.click(item('Zoom'));
    fireEvent.click(await screen.findByTestId('menu-item-Zoom In'));

    await waitFor(() => expect(panelZoomLevel(panels().find((p) => p.id === id)!)).toBeGreaterThan(0));
    expect(panelZoomLevel(panels().find((p) => p.id === parentId)!)).toBe(0);
  });

  it('Send to Tab is offered', async () => {
    await mountText();
    await openHeaderMenu();
    expect(hasItem('Send to Tab')).toBe(true);
  });
});

describe('the banner rows are there exactly while a banner is up (030 FR-042c)', () => {
  it('absent while the preview shows its file', async () => {
    await mountText();
    await openHeaderMenu();
    expect(hasItem('Try again')).toBe(false);
    expect(hasItem('Copy details')).toBe(false);
    expect(hasItem('Clear panel type')).toBe(false);
  });

  it('present while an FR-026 file notice is up, and gone when it clears', async () => {
    await mountText();
    pushNotice(2, { kind: 'unreadable' });
    await openHeaderMenu();
    expect(hasItem('Try again')).toBe(true);
    expect(hasItem('Copy details')).toBe(true);
    expect(hasItem('Clear panel type')).toBe(true);

    pushNotice(3, null);
    await openHeaderMenu();
    expect(hasItem('Try again')).toBe(false);
  });

  it('the FR-027 notice offers Close only: none of the three, and Close Panel is there', async () => {
    await mountText();
    pushNotice(2, { kind: 'no-provider' });
    await openHeaderMenu();
    expect(hasItem('Try again')).toBe(false);
    expect(hasItem('Copy details')).toBe(false);
    expect(hasItem('Clear panel type')).toBe(false);
    expect(hasItem('Close Panel')).toBe(true);
  });
});

describe('each banner row does its job on a preview', () => {
  it('Try again on a file notice calls preview.refresh (the banner’s own retry)', async () => {
    const { id } = await mountText();
    pushNotice(2, { kind: 'deleted' });
    await openHeaderMenu();

    fireEvent.click(item('Try again'));

    await waitFor(() => expect(m!.preview.refresh).toHaveBeenCalledWith(id));
  });

  it('Try again that finds the condition unchanged leaves the banner saying so', async () => {
    const { id } = await mountText();
    pushNotice(2, { kind: 'deleted' });
    m!.preview.refresh.mockImplementation(() =>
      Promise.resolve({ update: update({ revision: 3, notice: { kind: 'deleted', repeat: true } }) }),
    );
    await openHeaderMenu();

    fireEvent.click(item('Try again'));

    await waitFor(() =>
      expect(screen.getByTestId(`panel-failure-${id}`).querySelector('.panel-failure__retry-failed')).not.toBeNull(),
    );
  });

  it('Copy details writes the notice’s message and path through the clipboard bridge — the banner’s own text', async () => {
    const { id } = await mountText();
    pushNotice(2, { kind: 'too-large' });
    await openHeaderMenu();

    fireEvent.click(item('Copy details'));
    await waitFor(() => expect(m!.clipboardWrite).toHaveBeenCalledTimes(1));
    const fromMenu = (m!.clipboardWrite.mock.calls[0] as unknown as [{ text: string }])[0].text;
    expect(fromMenu).toMatch(/too large/i);
    expect(fromMenu).toContain('notes.prvtxt');
    expect(fromMenu).not.toContain('too-large');

    // The banner's own Copy details puts identical text on the clipboard (FR-042c).
    fireEvent.click(
      screen.getByTestId(`panel-failure-${id}`).querySelector('[title="Copy details"]') as HTMLElement,
    );
    await waitFor(() => expect(m!.clipboardWrite).toHaveBeenCalledTimes(2));
    expect((m!.clipboardWrite.mock.calls[1] as unknown as [{ text: string }])[0].text).toBe(fromMenu);
  });

  it('Copy details on an attach failure copies THAT failure’s text, not a notice’s', async () => {
    m = await mountMarkdownPreview('hello', FILE, { providers: { registry, views }, providerId: 'testText' });
    // Clear the first mount's view and re-type the panel so its attach fails.
    const { id } = m;
    await screen.findByTestId(`fake-body-${id}`);
    m.preview.attach.mockImplementation(() => Promise.resolve({ ok: false, reason: 'failed' } as never));
    act(() => m!.ws().clearPanelType(id));
    act(() => m!.ws().setPanelType(id, 'preview', { filePath: FILE }));
    await screen.findByTestId(`panel-failure-${id}`);

    await openHeaderMenu();
    fireEvent.click(item('Copy details'));

    await waitFor(() => expect(m!.clipboardWrite).toHaveBeenCalledTimes(1));
    const text = (m!.clipboardWrite.mock.calls[0] as unknown as [{ text: string }])[0].text;
    expect(text).toMatch(/could not be opened/i);
  });

  it('Clear panel type sends destroyed, then clears the type with no prompt; the file is no longer open (FR-012)', async () => {
    const { id } = await mountText();
    // Main's seed says the file has its preview.
    await waitFor(() => expect(isPreviewOpen(FILE)).toBe(true));
    pushNotice(2, { kind: 'unreadable' });
    await openHeaderMenu();

    const order: string[] = [];
    m!.preview.destroyed.mockImplementationOnce(((panelId: string) => {
      order.push(`destroyed:${panels().find((p) => p.id === panelId)?.kind ?? 'untyped'}`);
      // Main broadcasts that the path is no longer open, as its destroyed handler does.
      m!.preview.onOpenChanged.mock.calls.forEach(([cb]) => (cb as (e: unknown) => void)({ path: FILE, open: false }));
    }) as never);

    fireEvent.click(item('Clear panel type'));

    await waitFor(() => expect(panels().find((p) => p.id === id)?.kind).toBeUndefined());
    // destroyed went first, while the panel was still a preview.
    expect(order).toEqual(['destroyed:preview']);
    expect(m!.preview.destroyed).toHaveBeenCalledWith(id);
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    expect(isPreviewOpen(FILE)).toBe(false);
    // The panel itself stays (030 FR-043).
    expect(panels().map((p) => p.id)).toContain(id);
  });
});
