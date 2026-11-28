/**
 * 081 FR-032 (#733 item 3) — every scroll stop highlights a line. A stop with a blank line under the centre of the
 * scrolled view highlights the next non-blank line and its block in the other view, or the previous one at the end of
 * the document. And an editor scroll that moves its centre line without moving its top line still marks the place.
 *
 * Mounted as `preview-sync-mark.test.ts` mounts it, with its stand-in geometry (blocks 20 px a source line apart, 40 px tall), the document
 * thirty paragraphs `Pn` on source line `2n` with a blank line between each. The editor's centre is read through the
 * shipped `editorCentreLine`, over a stand-in view whose middle row lands on a chosen line.
 *
 * Layer: component — which line the panel marks for a stop; no layout is involved.
 */
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetEditorScrollStore,
  editorCentreLine,
  noteEditorScrolled,
  publishEditorTopLine,
  registerEditorCentreReader,
  registerEditorScroller,
  type TopLineView,
} from '../../src/renderer/editor/editor-scroll-store.js';
import { SYNC_MARK_QUIET_MS, __resetSyncMarks, syncMarkOf } from '../../src/renderer/preview/sync-mark-store.js';
import { COLD, README, mountMarkdownPreview, previewUpdate, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const PARAGRAPHS = Array.from({ length: 30 }, (_, i) => `P${i}`);
const DOC = PARAGRAPHS.join('\n\n');
const PARENT = { panelId: 'ed-1', title: 'README.md' };
const GUTTER = { editor: { previews: { providers: { markdown: { gutter: true } } } } };

let m: MountedPreviewWindow | undefined;
let ed1: ReturnType<typeof vi.fn<(line: number) => void>>;
const host = (): HTMLElement => screen.getByTestId(`preview-body-${m!.id}`);
const marked = (): string[] => [...host().querySelectorAll<HTMLElement>('.preview-sync-mark')].map((e) => e.textContent ?? '');

async function frames(n = 2): Promise<void> {
  for (let i = 0; i < n; i += 1) await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

/** An editor view over `lines` whose middle row is `centre` (0-based) — what `editorCentreLine` reads of a real one. */
function editorView(lines: readonly string[], centre: () => number): TopLineView {
  return {
    scrollDOM: { getBoundingClientRect: () => ({ top: 0, left: 0, height: 400 }) as DOMRect },
    contentDOM: { getBoundingClientRect: () => ({ top: 0, left: 0 }) as DOMRect },
    posAtCoords: ({ y }) => (y > 1 ? centre() : 0),
    state: { doc: { lines: lines.length, lineAt: (pos: number) => ({ number: pos + 1 }), line: (n: number) => ({ from: 0, text: lines[n - 1] ?? '' }) } },
  };
}

async function mountParented(): Promise<void> {
  m = await mountMarkdownPreview(DOC, README, { settings: GUTTER, attach: { parent: PARENT } });
  await screen.findByText('P29', {}, COLD);
  m.push(previewUpdate({ panelId: m.id, revision: 2, content: null, parent: PARENT }));
  act(() => publishEditorTopLine('ed-1', 0));
  await frames();
}

beforeEach(() => {
  __resetEditorScrollStore();
  __resetSyncMarks();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
    const scroller = document.querySelector<HTMLElement>('.preview-panel__body');
    if (this === scroller) return { top: 100, height: 400, left: 0, width: 400 } as DOMRect;
    const line = Number(this.getAttribute('data-source-line'));
    return { top: 100 + line * 20 - (scroller?.scrollTop ?? 0), height: 40, left: 0, width: 400 } as DOMRect;
  });
  ed1 = vi.fn<(line: number) => void>();
  registerEditorScroller('ed-1', ed1);
});
afterEach(() => {
  m?.unmount();
  m = undefined;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('the editor stops on a blank line (081 FR-032)', () => {
  it('marks the next non-blank line in the editor and the block holding it in the preview', async () => {
    await mountParented();
    registerEditorCentreReader('ed-1', () => editorCentreLine(editorView(DOC.split('\n'), () => 23)));
    act(() => publishEditorTopLine('ed-1', 13));
    // Line 23 is the blank between P11 (line 22) and P12 (line 24).
    await waitFor(() => expect(syncMarkOf('ed-1')).not.toBeNull());
    expect(syncMarkOf('ed-1')).toEqual({ line: 24, on: true });
    await frames(1);
    expect(marked()).toEqual(['P12']);
  });

  it('marks the previous non-blank line when only blank lines follow, at the end of the document', async () => {
    await mountParented();
    const lines = [...DOC.split('\n'), '', ''];
    registerEditorCentreReader('ed-1', () => editorCentreLine(editorView(lines, () => lines.length - 1)));
    act(() => publishEditorTopLine('ed-1', 40));
    await waitFor(() => expect(syncMarkOf('ed-1')).not.toBeNull());
    expect(syncMarkOf('ed-1')).toEqual({ line: 58, on: true });
    await frames(1);
    expect(marked()).toEqual(['P29']);
  });
});

describe('the preview stops with a margin under its centre (081 FR-032)', () => {
  it('marks the next block and its line in the editor', async () => {
    await mountParented();
    // P12 (line 24) straddles the top; the middle, 200 px down, falls on line 34's block: P17.
    host().scrollTop = 500;
    host().dispatchEvent(new Event('scroll'));
    await frames();
    expect(ed1).toHaveBeenCalledWith(24);
    await waitFor(() => expect(syncMarkOf('ed-1')).toEqual({ line: 34, on: true }), { timeout: 2000 });
    await frames(1);
    expect(marked()).toEqual(['P17']);
  });
});

describe('an editor scroll that moves the centre but not the top (081 FR-032, R7)', () => {
  it('still marks the place it stopped at', async () => {
    await mountParented();
    let centre = 23;
    registerEditorCentreReader('ed-1', () => editorCentreLine(editorView(DOC.split('\n'), () => centre)));
    act(() => publishEditorTopLine('ed-1', 13));
    await waitFor(() => expect(syncMarkOf('ed-1')).not.toBeNull());
    expect(syncMarkOf('ed-1')?.line).toBe(24);

    // A wrapped line at the top: the view scrolls within it, its top line stays 13, its centre moves on to P14.
    centre = 28;
    act(() => {
      publishEditorTopLine('ed-1', 13);
      noteEditorScrolled('ed-1');
    });
    // The mark is drawn once the editor has been still for the quiet period (073 FR-033g): wait that out, then look.
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, SYNC_MARK_QUIET_MS + 100)));
    expect(syncMarkOf('ed-1')).toEqual({ line: 28, on: true });
    await frames(1);
    expect(marked()).toEqual(['P14']);
  });
});
