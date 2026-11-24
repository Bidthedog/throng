/**
 * #720 — 074 FR-018's Default OS Program target, asked by a surface with no panel of its own (Quick Open,
 * File Explorer through the open router), must reach the OS.
 *
 * `window.throng.links.open` is wired to the handler main's REAL `registerLinkIpc` registers, over a fake
 * service that records what it is asked: main's gate refuses a request with no panel id (I2), so a renderer
 * that sends `panelId: ''` gets `{ ok: false, reason: 'refused', path: '' }` and the OS opens nothing. The
 * window is the preview helper's, with `EditorOpenListener` mounted beside it, which is where both routes
 * are served.
 */
import { act, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { LinkResolutionRequest } from '@throng/core';
import { registerLinkIpc, type LinkIpcMain, type LinkIpcService } from '../../src/main/link-ipc.js';
import { EditorOpenListener } from '../../src/renderer/editor/editor-open.js';
import { requestOpenInOs } from '../../src/renderer/links/use-open-in-os.js';
import { COLD, PROJECT, ROOT, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

type Listener = (event: unknown, payload: unknown) => unknown;

const GUIDE = `${ROOT}/docs/guide.md`;

let m: MountedPreviewWindow | undefined;

/** Mount the window and route its `links.open` through main's real gate; returns what the service was asked. */
async function mountWithRealGate(settings: Record<string, unknown> = {}): Promise<LinkResolutionRequest[]> {
  m = await mountMarkdownPreview('# Readme', undefined, {
    settings,
    extras: [createElement(EditorOpenListener, { key: 'open' })],
  });
  await screen.findByText('Readme', {}, COLD);
  const handles = new Map<string, Listener>();
  const ipc: LinkIpcMain = {
    handle: (channel, listener) => void handles.set(channel, listener as Listener),
    on: () => undefined,
  };
  const opened: LinkResolutionRequest[] = [];
  const service = {
    resolve: () => Promise.resolve({ ok: false }),
    revealInFileManager: () => Promise.resolve({ ok: true }),
    openWithDefaultProgram: (request: LinkResolutionRequest) => {
      opened.push(request);
      return Promise.resolve({ ok: true });
    },
    follow: () => Promise.resolve({ kind: 'revealed' }),
  } as unknown as LinkIpcService;
  registerLinkIpc(ipc, service);
  const open = handles.get('throng:links:open')!;
  m.links.open.mockImplementation((payload: unknown) => open({ sender: { id: 1 } }, payload));
  return opened;
}

afterEach(() => {
  m?.unmount();
  m = undefined;
  document.body.replaceChildren();
});

describe('Default OS Program from a surface with no panel reaches the OS (#720, 074 FR-018)', () => {
  it('Quick Open’s request: main is asked to open the file, and no refusal is raised', async () => {
    const opened = await mountWithRealGate();
    act(() => void requestOpenInOs(GUIDE, PROJECT));
    await waitFor(() => expect(m!.links.open).toHaveBeenCalledTimes(1));
    await expect(m!.links.open.mock.results[0]!.value).resolves.toEqual({ ok: true });
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ text: GUIDE, kind: 'detectedPath', originProjectId: PROJECT });
  });

  it('the open router’s OS action (File Explorer open of a file whose default is the OS): main is asked to open it', async () => {
    const opened = await mountWithRealGate({
      editor: { previews: { providers: { markdown: { enabled: true, defaultOpenAction: 'os' } } } },
    });
    act(() => {
      window.dispatchEvent(new CustomEvent('throng:open-file', { detail: { absPath: GUIDE, projectId: PROJECT } }));
    });
    await waitFor(() => expect(m!.links.open).toHaveBeenCalledTimes(1));
    await expect(m!.links.open.mock.results[0]!.value).resolves.toEqual({ ok: true });
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ text: GUIDE, kind: 'detectedPath', originProjectId: PROJECT });
  });
});
