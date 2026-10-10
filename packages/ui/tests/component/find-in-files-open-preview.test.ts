/**
 * 054 T025 — a Find in Files result opens where the reader reads the file (FR-030, FR-031, FR-004, research
 * R8): the preview when the file's provider's default open action is Preview, an editor otherwise.
 *
 * Layer: component — the decision is made where the window registers the result opener
 * (`find-in-files-chrome.tsx`), and its outcome is a `preview.open` request or an editor open on the bridge.
 * The window here is the preview harness with the chrome mounted beside it; `preview.open` is main's mock.
 * What the preview then does with the match is T027's (`preview-reveal-match.test.ts`).
 */
import { act, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FindInFilesChrome } from '../../src/renderer/find-in-files/find-in-files-chrome.js';
import { requestOpenResult } from '../../src/renderer/find-in-files/result-open.js';
import { COLD, PROJECT, ROOT, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const PREVIEW_DEFAULT = { editor: { previews: { providers: { markdown: { defaultOpenAction: 'preview' } } } } };

let pv: MountedPreviewWindow | undefined;

afterEach(() => {
  pv?.unmount();
  pv = undefined;
  document.body.replaceChildren();
});

async function mount(settings?: Record<string, unknown>): Promise<MountedPreviewWindow> {
  pv = await mountMarkdownPreview('# Readme\n', undefined, {
    extras: [createElement(FindInFilesChrome, { key: 'fif' })],
    ...(settings ? { settings } : {}),
  });
  await screen.findByText('Readme', {}, COLD);
  // An editor the editor route opens mounts and asks for its document; what it shows is not under test.
  const editor = (window.throng as unknown as { editor: Record<string, unknown> }).editor;
  editor.load = vi.fn(() => new Promise(() => undefined));
  return pv;
}

const row = (relPath: string) => ({ relPath, from: 12, to: 17, line: 3, text: 'hello', projectRoot: ROOT });

describe('Markdown set to open as a Preview (FR-030)', () => {
  it('a result opens through preview.open, asking for the Last Active preview like any other open', async () => {
    const m = await mount(PREVIEW_DEFAULT);
    m.preview.open.mockResolvedValue({ kind: 'focused', panelId: m.id });

    act(() => {
      requestOpenResult(row('docs/guide.md'));
    });

    await waitFor(() => expect(m.preview.open).toHaveBeenCalledTimes(1));
    const request = m.preview.open.mock.calls[0]![0] as { absPath: string; projectId: string; target: { mode: string } };
    expect(request.absPath).toBe(`${ROOT}/docs/guide.md`);
    expect(request.projectId).toBe(PROJECT);
    expect(request.target.mode).toBe('lastActive');
    // The reveal is the renderer's own; main never sees it (contracts/preview-ipc-054.md).
    expect(request).not.toHaveProperty('reveal');
    expect(m.openInto).not.toHaveBeenCalled();
  });

  it('a file already shown by a preview: main answers focused, and no editor is opened or moved (FR-004)', async () => {
    const m = await mount(PREVIEW_DEFAULT);
    m.preview.open.mockResolvedValue({ kind: 'focused', panelId: m.id });

    act(() => {
      requestOpenResult(row('README.md'));
    });

    await waitFor(() => expect(m.preview.open).toHaveBeenCalledTimes(1));
    await act(() => Promise.resolve());
    expect(m.openInto).not.toHaveBeenCalled();
  });

  it('main refusing the preview opens the editor at the match instead, rather than nothing', async () => {
    const m = await mount(PREVIEW_DEFAULT);
    m.preview.open.mockResolvedValue({ kind: 'refused', reason: 'no-file' });

    act(() => {
      requestOpenResult(row('docs/guide.md'));
    });

    await waitFor(() => expect(m.openInto).toHaveBeenCalled());
  });

  it('an Open In row still names its own destination: an editor target opens an editor (044 FR-055)', async () => {
    const m = await mount(PREVIEW_DEFAULT);
    act(() => {
      requestOpenResult({ ...row('docs/guide.md'), target: { kind: 'new' } });
    });
    await waitFor(() => expect(m.openInto).toHaveBeenCalled());
    expect(m.preview.open).not.toHaveBeenCalled();
  });
});

describe('a file whose default is Editor (FR-030, unchanged)', () => {
  it('Markdown left at its shipped Editor default opens an editor at the match', async () => {
    const m = await mount();
    act(() => {
      requestOpenResult(row('docs/guide.md'));
    });
    await waitFor(() => expect(m.openInto).toHaveBeenCalled());
    expect(m.preview.open).not.toHaveBeenCalled();
  });

  it('a file no preview provider claims opens an editor', async () => {
    const m = await mount(PREVIEW_DEFAULT);
    act(() => {
      requestOpenResult(row('src/main.ts'));
    });
    await waitFor(() => expect(m.openInto).toHaveBeenCalled());
    expect(m.preview.open).not.toHaveBeenCalled();
  });
});
