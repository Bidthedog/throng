/**
 * 067 T138 (FR-131) — a link followed in a preview to a file throng cannot open (binary) goes to the OS
 * default program under `explorer.openUnsupportedInOs`, as a File Explorer double-click sends it.
 *
 * The panel is mounted with the shipped Markdown body and `EditorOpenListener` beside it: the preview
 * raises `throng:open-file` when main answers a follow with `openedInEditor`, and that listener is where
 * the editor's refusal is known. Off, an out-of-project link, and a file whose default open action is its
 * preview each keep the route they had.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorOpenListener } from '../../src/renderer/editor/editor-open.js';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';
import { COLD, ROOT, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const DOC = ['# Readme', '', '[Logo](img/logo.png) and [Out](../outside.png)', '', '[Guide](docs/guide.md)'].join('\n');
const LOGO = `${ROOT}/img/logo.png`;
const BINARY = { action: 'refuse', reason: 'binary' };

let m: MountedPreviewWindow | undefined;

async function mountDoc(settings: Record<string, unknown>, decision: unknown = BINARY): Promise<MountedPreviewWindow> {
  m = await mountMarkdownPreview(DOC, undefined, { settings, extras: [createElement(EditorOpenListener, { key: 'open' })] });
  m.openInto.mockImplementation(() => Promise.resolve(decision));
  m.links.open.mockResolvedValue({ ok: true });
  // A file the editor does open mounts a real editor, which asks main to load it; this test is not about that load.
  Object.assign((window.throng as unknown as { editor: object }).editor, { load: () => new Promise(() => {}) });
  await screen.findByText('Logo', {}, COLD);
  return m;
}

const on = { explorer: { openUnsupportedInOs: true } };
const off = { explorer: { openUnsupportedInOs: false } };

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

beforeEach(() => __resetPreviewStore());
afterEach(() => {
  m?.unmount();
  m = undefined;
  document.body.replaceChildren();
});

describe('a preview link to a binary file (FR-131)', () => {
  it('on: opens in the OS default program, naming the file by its absolute path, and not in an editor', async () => {
    const p = await mountDoc(on);
    p.preview.navigate.mockResolvedValue({ kind: 'openedInEditor' });
    fireEvent.click(screen.getByText('Logo'), { ctrlKey: true });
    await waitFor(() => expect(p.links.open).toHaveBeenCalledTimes(1));
    expect(p.links.open.mock.calls[0]![0]).toMatchObject({ text: LOGO, kind: 'detectedPath', panelId: p.id });
    await settle();
    expect(p.ws().layout?.tabs.flatMap((t) => JSON.stringify(t.root)).join('')).not.toContain('"kind":"editor"');
  });

  it('on, and the OS refuses: the one notice, not silence', async () => {
    const p = await mountDoc(on);
    p.links.open.mockResolvedValue({ ok: false, reason: 'refused', path: LOGO, osReason: 'no program' });
    p.preview.navigate.mockResolvedValue({ kind: 'openedInEditor' });
    fireEvent.click(screen.getByText('Logo'), { ctrlKey: true });
    await waitFor(() => expect(document.body.textContent).toContain('no program'));
  });

  it('off: today’s route — the editor is asked, the OS is not', async () => {
    const p = await mountDoc(off);
    p.preview.navigate.mockResolvedValue({ kind: 'openedInEditor' });
    fireEvent.click(screen.getByText('Logo'), { ctrlKey: true });
    await waitFor(() => expect(p.openInto).toHaveBeenCalled());
    await settle();
    expect(p.links.open).not.toHaveBeenCalled();
  });

  it('on, but a file the editor can open: the editor, not the OS', async () => {
    const p = await mountDoc(on, { action: 'open' });
    p.preview.navigate.mockResolvedValue({ kind: 'openedInEditor' });
    fireEvent.click(screen.getByText('Logo'), { ctrlKey: true });
    await waitFor(() => expect(p.openInto).toHaveBeenCalled());
    await settle();
    expect(p.links.open).not.toHaveBeenCalled();
  });

  it('a link outside every project keeps its own notice and never reaches the OS', async () => {
    const p = await mountDoc(on);
    fireEvent.click(screen.getByText('Out'), { ctrlKey: true });
    await screen.findByTestId(`preview-link-notice-${p.id}`);
    expect(p.preview.navigate).not.toHaveBeenCalled();
    expect(p.links.open).not.toHaveBeenCalled();
  });

  it('a file whose default open action is its preview keeps today’s route, even when asked as a link', async () => {
    const p = await mountDoc({
      ...on,
      editor: { previews: { providers: { markdown: { enabled: true, defaultOpenAction: 'preview' } } } },
    });
    act(() => {
      window.dispatchEvent(
        new CustomEvent('throng:open-file', {
          detail: { absPath: `${ROOT}/docs/guide.md`, link: { panelId: p.id, originProjectId: 'proj-1' } },
        }),
      );
    });
    await settle();
    expect(p.links.open).not.toHaveBeenCalled();
  });
});
