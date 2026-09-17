/**
 * 044 T177 — a preview whose FILE changed with no link followed and no history step keeps the reader's
 * place (FR-024 with FR-013c): an in-app rename or move, or a Save As from the parent editor.
 *
 * The chrome's half of it. `markdown-body.test.ts` proves the body's rule over its props; here the whole
 * panel is mounted, so what is proved is the wire: main's `navigationSeq` on the update, carried by
 * `preview-store`, reaching the body. A run that has NOT been navigated since the last update is showing
 * the same document under a new path, and the reader stays where they were reading.
 */
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLD, ROOT, mountMarkdownPreview, previewUpdate, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const DOC = Array.from({ length: 30 }, (_, i) => `P${i}`).join('\n\n');
const RENAMED = `${ROOT}/GUIDE.md`;
const OTHER = `${ROOT}/docs/other.md`;

let pv: MountedPreviewWindow | undefined;

/** The host's viewport starts at y 100; every source line is 20px tall (as the other preview tests supply it). */
function withGeometry(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
    const scroller = document.querySelector<HTMLElement>('.preview-panel__body');
    if (this === scroller) return { top: 100, height: 400, left: 0, width: 400 } as DOMRect;
    const line = Number(this.getAttribute('data-source-line'));
    return { top: 100 + line * 20 - (scroller?.scrollTop ?? 0), height: 40, left: 0, width: 400 } as DOMRect;
  });
}

async function mount(): Promise<{ id: string; host: () => HTMLElement }> {
  withGeometry();
  pv = await mountMarkdownPreview(DOC);
  await screen.findByText('P29', {}, COLD);
  // The attach carried the run's navigation count, as every update does; nothing has been navigated yet.
  return { id: pv.id, host: () => screen.getByTestId(`preview-body-${pv!.id}`) };
}

afterEach(() => {
  pv?.unmount();
  pv = undefined;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('a re-pointed preview keeps the reader’s place (T177, FR-024, FR-013c)', () => {
  it('a rename or move: the file changes, the navigation count does not', async () => {
    const { id, host } = await mount();
    host().scrollTop = 250;

    pv!.push(
      previewUpdate({
        panelId: id,
        filePath: RENAMED,
        revision: 3,
        content: { kind: 'text', text: DOC },
        navigationSeq: 0,
      }),
    );

    await waitFor(() => expect(screen.getByText('P29')).toBeInTheDocument());
    await act(() => Promise.resolve());
    expect(host().scrollTop).toBe(250);
  });

  it('a Save As that carries no content (“unchanged”) keeps it too', async () => {
    const { id, host } = await mount();
    host().scrollTop = 250;

    pv!.push(previewUpdate({ panelId: id, filePath: RENAMED, revision: 3, content: null, navigationSeq: 0 }));

    await act(() => Promise.resolve());
    await waitFor(() => expect(host().scrollTop).toBe(250));
  });

  it('a NAVIGATION to another file still starts at the top', async () => {
    const { id, host } = await mount();
    host().scrollTop = 250;

    pv!.push(
      previewUpdate({
        panelId: id,
        filePath: OTHER,
        revision: 3,
        content: { kind: 'text', text: `# Other\n\n${DOC}` },
        navigationSeq: 1,
      }),
    );

    await screen.findByText('Other');
    await waitFor(() => expect(host().scrollTop).toBe(0));
  });
});
