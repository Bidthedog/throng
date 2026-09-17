/**
 * 044 T189 — a parented preview follows its editor's scroll (FR-113, FR-114; plan.md Iteration 2026-09-15,
 * research R23) — and, since T231, drives it back (FR-121, FR-121a, FR-121c, FR-121f, FR-121g; plan.md
 * Iteration 2026-09-16, research R30–R31).
 *
 * The whole panel is mounted with the shipped Markdown body (`helpers/mount-preview-panel.ts`), and the
 * editor side is the store itself: `publishEditorTopLine` is exactly what `editor-scroll-relay.ts` calls when
 * the editor's view scrolls, so publishing here stands in for an editor view scrolled in this window, and a
 * scroller registered through `registerEditorScroller` stands in for that view being asked to move.
 *
 * jsdom has no layout, so the geometry is supplied as `markdown-body.test.ts` and `preview-follow.test.ts`
 * supply it: the body host's viewport starts at client y 100 and every source-mapped block is drawn at 20px
 * per source line. The document is thirty paragraphs, `Pn` on source line `2n`; bringing the block on line
 * L to the top of the host leaves its `scrollTop` at `L * 20`.
 *
 * jsdom also fires no `scroll` event for a `scrollTop` write. A reader's scroll is therefore a `scrollTop`
 * write followed by a dispatched `scroll`, and one animation frame for the body's coalesced report.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPreviewProviderRegistry } from '@throng/core';
import {
  __resetEditorScrollStore,
  editorTopLineOf,
  publishEditorDocLines,
  publishEditorTopLine,
  registerEditorScroller,
  subscribeEditorTopLine,
} from '../../src/renderer/editor/editor-scroll-store.js';
import type { PreviewBodyProps, PreviewProviderView } from '../../src/renderer/preview/provider-view.js';
import { COLD, README, ROOT, mountMarkdownPreview, previewUpdate, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const paragraphs = (n: number, prefix = 'P'): string => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join('\n\n');
const DOC = paragraphs(30);
const PARENT = { panelId: 'ed-1', title: 'README.md' };

let m: MountedPreviewWindow | undefined;
/** The fake editor view's scroller for `ed-1`: what a preview's request reaches. */
let ed1: ReturnType<typeof vi.fn<(line: number) => void>>;

const panel = (): MountedPreviewWindow => m!;
const host = (): HTMLElement => screen.getByTestId(`preview-body-${panel().id}`);

/** Supply layout: the host's viewport starts at y 100; each source line is 20px; a code block is 12 lines tall. */
function withGeometry(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
    const scroller = document.querySelector<HTMLElement>('.preview-panel__body');
    if (this === scroller) return { top: 100, height: 400, left: 0, width: 400 } as DOMRect;
    const line = Number(this.getAttribute('data-source-line'));
    const height = this.tagName === 'PRE' ? 240 : 40;
    return { top: 100 + line * 20 - (scroller?.scrollTop ?? 0), height, left: 0, width: 400 } as DOMRect;
  });
}

/**
 * Give the body host the one thing a real scroller does that jsdom's does not: clamp `scrollTop` to
 * `[0, scrollHeight - clientHeight]`. The content's height is where the last block ends, under the same
 * geometry as {@link withGeometry}; the viewport is its 400px.
 */
function clampHost(): void {
  const el = host();
  let value = el.scrollTop;
  const max = (): number => {
    let bottom = 0;
    for (const b of el.querySelectorAll('[data-source-line]')) {
      const line = Number(b.getAttribute('data-source-line'));
      bottom = Math.max(bottom, line * 20 + (b.tagName === 'PRE' ? 240 : 40));
    }
    return Math.max(0, bottom - 400);
  };
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => value,
    set: (v: number) => {
      value = Math.min(Math.max(0, v), max());
    },
  });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 400 });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => max() + 400 });
}

/** What the editor relay does when the editor view for `editorPanelId` scrolls. */
function editorScrolledTo(editorPanelId: string, line: number, fromSync = false): void {
  act(() => publishEditorTopLine(editorPanelId, line, fromSync));
}

/** Let the body's coalesced scroll report run: a couple of animation frames. */
async function frames(n = 2): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
}

/** A reader's own scroll of the preview: the position moves, then the engine's `scroll` event. */
async function readerScrolls(scrollTop: number): Promise<void> {
  host().scrollTop = scrollTop;
  host().dispatchEvent(new Event('scroll'));
  await frames();
}

/**
 * Mount a document opened beside `parent` — main's attach answer already names it, as it does for a preview
 * opened from its editor — wait for it to be drawn, and confirm the parent with a later update.
 *
 * T242: the parent is in the ATTACH answer. A parent that first appears in an update after the draw, with the
 * navigation count standing still, is an adoption (FR-121h), where the preview decides — which is
 * `preview-scroll-pairing.test.ts` (i)'s subject, not these cases'.
 */
async function mountParented(
  opts: {
    settings?: Record<string, unknown>;
    parent?: { panelId: string; title: string } | null;
    text?: string;
    last?: string;
  } = {},
): Promise<MountedPreviewWindow> {
  const parent = opts.parent === undefined ? PARENT : opts.parent;
  m = await mountMarkdownPreview(opts.text ?? DOC, README, { settings: opts.settings, attach: { parent } });
  await screen.findByText(opts.last ?? 'P29', {}, COLD);
  m.push(previewUpdate({ panelId: m.id, revision: 2, content: null, parent }));
  return m;
}

beforeEach(() => {
  __resetEditorScrollStore();
  withGeometry();
  ed1 = vi.fn<(line: number) => void>();
  registerEditorScroller('ed-1', ed1);
});

afterEach(() => {
  m?.unmount();
  m = undefined;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('a parented preview follows its editor (FR-113)', () => {
  it('(1) brings the block on the greatest source line at or before the editor’s top line to the top', async () => {
    await mountParented();
    // Line 13 is blank between P6 (line 12) and P7 (line 14): the block at or before it is P6.
    editorScrolledTo('ed-1', 13);
    await waitFor(() => expect(host().scrollTop).toBe(240));

    editorScrolledTo('ed-1', 30);
    await waitFor(() => expect(host().scrollTop).toBe(600));
  });

  it('(2) does nothing while the setting is off', async () => {
    await mountParented({ settings: { editor: { previews: { syncScroll: false } } } });
    editorScrolledTo('ed-1', 13);
    await act(() => Promise.resolve());
    expect(host().scrollTop).toBe(0);
  });

  it('(2b) takes effect without a restart: turned off, the preview stops following (FR-114)', async () => {
    await mountParented();
    editorScrolledTo('ed-1', 13);
    await waitFor(() => expect(host().scrollTop).toBe(240));

    panel().setSettings({ editor: { previews: { syncScroll: false } } });
    editorScrolledTo('ed-1', 30);
    await act(() => Promise.resolve());
    expect(host().scrollTop).toBe(240);
  });

  it('(3) a standalone preview is unaffected', async () => {
    await mountParented({ parent: null });
    editorScrolledTo('ed-1', 13);
    await act(() => Promise.resolve());
    expect(host().scrollTop).toBe(0);
  });

  it('(3b) a binary provider, which has no source lines, is handed no line', async () => {
    const registry = createPreviewProviderRegistry([
      { id: 'testBinary', displayName: 'Test binary', extensions: ['.prvbin'], kind: 'binary', sourceMimeTypes: ['application/pdf'] },
    ]);
    const seen: unknown[] = [];
    function Body({ panelId, syncLine }: PreviewBodyProps): ReactElement {
      seen.push(syncLine);
      return createElement('div', { 'data-testid': `fake-body-${panelId}` }, 'a page');
    }
    const views: Record<string, PreviewProviderView> = {
      testBinary: { id: 'testBinary', textSelection: false, load: () => Promise.resolve(Body) },
    };
    m = await mountMarkdownPreview('', 'D:/proj/manual.prvbin', { providers: { registry, views }, providerId: 'testBinary' });
    await screen.findByTestId(`fake-body-${m.id}`);
    m.push(
      previewUpdate({ panelId: m.id, filePath: 'D:/proj/manual.prvbin', providerId: 'testBinary', revision: 2, content: null, parent: PARENT }),
    );
    editorScrolledTo('ed-1', 13);
    await act(() => Promise.resolve());

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((line) => line === null || line === undefined)).toBe(true);
  });

  it('(4) re-parented to another editor, it follows that editor and ignores the first', async () => {
    await mountParented();
    editorScrolledTo('ed-1', 13);
    await waitFor(() => expect(host().scrollTop).toBe(240));

    panel().push(previewUpdate({ panelId: panel().id, revision: 3, content: null, parent: { panelId: 'ed-2', title: 'README.md' } }));
    editorScrolledTo('ed-2', 20);
    await waitFor(() => expect(host().scrollTop).toBe(400));

    editorScrolledTo('ed-1', 4);
    await act(() => Promise.resolve());
    expect(host().scrollTop).toBe(400);
  });

  it('(5) a line published before the file is drawn is applied once it is', async () => {
    m = await mountMarkdownPreview(DOC, README);
    editorScrolledTo('ed-1', 13);
    // The update that parents the preview carries the content, and nothing has been drawn yet: the line
    // arrives first.
    expect(document.querySelectorAll('.preview-markdown p')).toHaveLength(0);
    m.push(previewUpdate({ panelId: m.id, revision: 2, content: { kind: 'text', text: DOC }, parent: PARENT }));

    await screen.findByText('P29', {}, COLD);
    await waitFor(() => expect(host().scrollTop).toBe(240));
  });

  it('(6) a live update keeps the synchronised place, and a reader’s own later scroll, rather than line N (FR-024)', async () => {
    await mountParented();
    editorScrolledTo('ed-1', 13);
    await waitFor(() => expect(host().scrollTop).toBe(240));

    // Typed at the end of the source: nothing above the reader moves.
    panel().push(previewUpdate({ panelId: panel().id, revision: 3, content: { kind: 'text', text: `${DOC}\n\nP30` }, parent: PARENT }));
    await screen.findByText('P30');
    expect(host().scrollTop).toBe(240);

    // The reader scrolls the preview by hand — a quarter of the way into P7 — and then another edit lands.
    host().scrollTop = 290;
    panel().push(previewUpdate({ panelId: panel().id, revision: 4, content: { kind: 'text', text: `${DOC}\n\nP30\n\nP31` }, parent: PARENT }));
    await screen.findByText('P31');
    expect(host().scrollTop).toBe(290);
  });

  /*
   * Was: "(7) scrolling the preview publishes nothing and navigates nowhere (FR-101)". Superseded by FR-121
   * (two-way sync): the reader's scroll now REQUESTS the editor at the top block's line. What stands of the
   * old case: the preview still writes no line into the store and still records no history.
   */
  it('(7) a reader’s scroll of the preview requests the parent editor at the top block’s line, once, and navigates nowhere (FR-121, FR-101)', async () => {
    await mountParented();
    editorScrolledTo('ed-1', 13);
    await waitFor(() => expect(host().scrollTop).toBe(240));
    const published = vi.fn();
    const unsubscribe = subscribeEditorTopLine(published);
    try {
      // 500px down: P12 (line 24) straddles the viewport's top.
      await readerScrolls(500);

      expect(ed1).toHaveBeenCalledTimes(1);
      expect(ed1).toHaveBeenCalledWith(24);
      expect(published).not.toHaveBeenCalled();
      expect(editorTopLineOf('ed-1')).toEqual({ line: 13, fromSync: false });
      expect(panel().preview.navigate).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('(7b) drives nothing while the setting is off, for a standalone preview, or with no view of the parent in this window (FR-121a)', async () => {
    await mountParented({ settings: { editor: { previews: { syncScroll: false } } } });
    editorScrolledTo('ed-1', 13);
    await readerScrolls(500);
    expect(ed1).not.toHaveBeenCalled();
    m!.unmount();

    await mountParented({ parent: null });
    editorScrolledTo('ed-1', 13);
    await readerScrolls(500);
    expect(ed1).not.toHaveBeenCalled();
    m!.unmount();

    // The parent's view is in another window: its line may be known here from an earlier view, but no
    // scroller answers for it.
    __resetEditorScrollStore();
    const elsewhere = vi.fn<(line: number) => void>();
    const unregister = registerEditorScroller('ed-1', elsewhere);
    await mountParented();
    editorScrolledTo('ed-1', 13);
    await waitFor(() => expect(host().scrollTop).toBe(240));
    unregister();
    await readerScrolls(500);
    expect(elsewhere).not.toHaveBeenCalled();
  });

  it('(7c) a binary provider’s preview drives nothing, whatever its body reports', async () => {
    const registry = createPreviewProviderRegistry([
      { id: 'testBinary', displayName: 'Test binary', extensions: ['.prvbin'], kind: 'binary', sourceMimeTypes: ['application/pdf'] },
    ]);
    function Body({ panelId, onTopLineChange }: PreviewBodyProps): ReactElement {
      onTopLineChange?.(40);
      return createElement('div', { 'data-testid': `fake-body-${panelId}` }, 'a page');
    }
    const views: Record<string, PreviewProviderView> = {
      testBinary: { id: 'testBinary', textSelection: false, load: () => Promise.resolve(Body) },
    };
    m = await mountMarkdownPreview('', 'D:/proj/manual.prvbin', { providers: { registry, views }, providerId: 'testBinary' });
    await screen.findByTestId(`fake-body-${m.id}`);
    m.push(
      previewUpdate({ panelId: m.id, filePath: 'D:/proj/manual.prvbin', providerId: 'testBinary', revision: 2, content: null, parent: PARENT }),
    );
    editorScrolledTo('ed-1', 13);
    await frames();
    expect(ed1).not.toHaveBeenCalled();
  });
});

/*
 * FR-121a — a preview that followed a link is bound to the new file: it never drives the editor it was
 * beside, and drives the new file's parent editor only if there is one.
 */
describe('a followed link re-binds what the preview drives (FR-121a)', () => {
  const setupUpdate = (parent: { panelId: string; title: string } | null) =>
    previewUpdate({
      panelId: panel().id,
      revision: 3,
      filePath: `${ROOT}/docs/setup.md`,
      content: { kind: 'text', text: paragraphs(30, 'S') },
      parent,
      navigationSeq: 1,
    });

  it('a link to a file with no editor, then a reader’s scroll → the old editor is not requested', async () => {
    await mountParented();
    editorScrolledTo('ed-1', 13);
    await waitFor(() => expect(host().scrollTop).toBe(240));

    panel().push(setupUpdate(null));
    await screen.findByText('S29');
    await frames();
    await readerScrolls(500);

    expect(ed1).not.toHaveBeenCalled();
  });

  it('a link to a file with its own editor → that editor is requested at the start position, and the old one never', async () => {
    await mountParented();
    editorScrolledTo('ed-1', 13);
    await waitFor(() => expect(host().scrollTop).toBe(240));
    const ed2 = vi.fn<(line: number) => void>();
    registerEditorScroller('ed-2', ed2);
    editorScrolledTo('ed-2', 30);

    panel().push(setupUpdate({ panelId: 'ed-2', title: 'setup.md' }));
    await screen.findByText('S29');
    await frames();

    expect(host().scrollTop).toBe(0);
    expect(ed2).toHaveBeenCalledTimes(1);
    expect(ed2).toHaveBeenCalledWith(0);
    expect(ed1).not.toHaveBeenCalled();
  });
});

/*
 * FR-121g — the loop guard: an echo is never applied or relayed, a side already there does nothing, and the
 * difference in granularity (a preview block covers several editor lines) moves neither side.
 */
describe('the loop guard (FR-121c, FR-121g)', () => {
  it('an echo — a line the editor went to FOLLOW this preview — does not scroll the preview', async () => {
    await mountParented();
    editorScrolledTo('ed-1', 13);
    await waitFor(() => expect(host().scrollTop).toBe(240));

    editorScrolledTo('ed-1', 40, true);
    await frames();
    expect(host().scrollTop).toBe(240);
    expect(ed1).not.toHaveBeenCalled();
  });

  it('the preview’s own scroll to follow the editor requests nothing', async () => {
    await mountParented();
    editorScrolledTo('ed-1', 30);
    await waitFor(() => expect(host().scrollTop).toBe(600));
    // The engine's event for the body's own `scrollTop` write.
    host().dispatchEvent(new Event('scroll'));
    await frames();

    expect(ed1).not.toHaveBeenCalled();
  });

  it('granularity: an editor line inside the preview’s top block moves nothing, either way', async () => {
    const code = Array.from({ length: 9 }, (_, i) => `code ${i}`).join('\n');
    // P0–P9 on lines 0–18, a fenced block on lines 20–30, then Q0 from line 32.
    const text = `${paragraphs(10)}\n\n\`\`\`\n${code}\n\`\`\`\n\n${paragraphs(20, 'Q')}`;
    await mountParented({ text, last: 'Q19' });
    editorScrolledTo('ed-1', 20);
    await waitFor(() => expect(host().scrollTop).toBe(400));

    editorScrolledTo('ed-1', 25);
    await frames();
    expect(host().scrollTop).toBe(400);

    // The reader scrolls within the code block: still the same block as the editor's line 25.
    await readerScrolls(460);
    expect(ed1).not.toHaveBeenCalled();
  });

  it('end of document: an editor that could not go as far as asked does not pull the preview back', async () => {
    await mountParented({ text: paragraphs(110), last: 'P109' });
    editorScrolledTo('ed-1', 13);
    await waitFor(() => expect(host().scrollTop).toBe(240));

    // P100 (line 200) at the top.
    await readerScrolls(4000);
    expect(ed1).toHaveBeenCalledWith(200);

    // The editor's last page starts at line 150: it went as far as it could, and says so as an echo.
    editorScrolledTo('ed-1', 150, true);
    await frames();
    expect(host().scrollTop).toBe(4000);
    expect(ed1).toHaveBeenCalledTimes(1);
  });

  /*
   * Review round 2, I1. Near the end the preview hits its own bottom and cannot bring the editor's block to its
   * top; that is at rest, not a place the preview moved to. A character typed there redraws the preview, keeps
   * its place, and must not send the editor up to the preview's top block — on every keystroke.
   */
  it('at the preview’s bottom, short of the editor’s block, a live update that keeps the place requests nothing', async () => {
    await mountParented();
    clampHost();
    act(() => publishEditorDocLines('ed-1', 59));
    // P25 is on line 50: at the top it would need 1000px, and the host stops at 800 (P20, line 40).
    editorScrolledTo('ed-1', 50);
    await waitFor(() => expect(host().scrollTop).toBe(800));
    host().dispatchEvent(new Event('scroll'));
    await frames();
    expect(ed1).not.toHaveBeenCalled();

    // One character typed at the end of the last paragraph: the line count stands.
    panel().push(previewUpdate({ panelId: panel().id, revision: 3, content: { kind: 'text', text: `${DOC}x` }, parent: PARENT }));
    await screen.findByText('P29x');
    // The engine's event for the restore's write, where it sends one.
    host().dispatchEvent(new Event('scroll'));
    await frames(3);

    expect(host().scrollTop).toBe(800);
    expect(ed1).not.toHaveBeenCalled();

    // The reader's own scroll from there still drives the editor (FR-121f).
    await readerScrolls(600);
    expect(ed1).toHaveBeenCalledTimes(1);
    expect(ed1).toHaveBeenCalledWith(30);
  });

  /*
   * Hands-on report 2026-09-17. Content that lays out after a draw — a project image that fails and is swapped
   * for its alternative text — can make the document shorter; at the preview's bottom the engine then clamps
   * `scrollTop` down. That clamp is not the reader's scroll and must not send the editor up.
   */
  it('at the preview’s bottom, a later shrink that clamps the position requests nothing', async () => {
    await mountParented();
    clampHost();
    act(() => publishEditorDocLines('ed-1', 59));
    editorScrolledTo('ed-1', 50);
    await waitFor(() => expect(host().scrollTop).toBe(800));
    host().dispatchEvent(new Event('scroll'));
    await frames();

    panel().push(previewUpdate({ panelId: panel().id, revision: 3, content: { kind: 'text', text: `${DOC}x` }, parent: PARENT }));
    await screen.findByText('P29x');
    host().dispatchEvent(new Event('scroll'));
    await frames(3);
    expect(ed1).not.toHaveBeenCalled();

    // The last block loses its height after the draw; the engine clamps the position and says so.
    screen.getByText('P29x').remove();
    host().scrollTop = host().scrollTop;
    expect(host().scrollTop).toBe(760);
    host().dispatchEvent(new Event('scroll'));
    await frames(3);
    expect(ed1).not.toHaveBeenCalled();

    // The reader's own scroll from there still drives the editor (FR-121f).
    await readerScrolls(600);
    expect(ed1).toHaveBeenCalledTimes(1);
    expect(ed1).toHaveBeenCalledWith(30);
  });

  it('a live update that keeps the top block requests nothing; one whose remap moves it requests the new line once (FR-024 with FR-121f)', async () => {
    await mountParented();
    editorScrolledTo('ed-1', 13);
    await waitFor(() => expect(host().scrollTop).toBe(240));

    panel().push(previewUpdate({ panelId: panel().id, revision: 3, content: { kind: 'text', text: `${DOC}\n\nP30` }, parent: PARENT }));
    await screen.findByText('P30');
    await frames();
    expect(ed1).not.toHaveBeenCalled();

    // Two lines typed at the very top: the reader's block, P6, is now on line 14.
    panel().push(
      previewUpdate({ panelId: panel().id, revision: 4, content: { kind: 'text', text: `X\n\n${DOC}\n\nP30` }, parent: PARENT }),
    );
    await screen.findByText('X');
    await frames();
    expect(host().scrollTop).toBe(280);
    expect(ed1).toHaveBeenCalledTimes(1);
    expect(ed1).toHaveBeenCalledWith(14);

    await frames();
    expect(ed1).toHaveBeenCalledTimes(1);
  });
});

/*
 * Analysis U2 — the editor publishes its renumbered line one frame after an edit, but this preview draws the
 * edited text only after its update delay. Until then its `data-source-line`s number the OLD text, so the
 * preview neither follows nor drives: an edit above the viewport must not jump the preview a block. The
 * editor relay publishes its document's line count beside its line; DOC has 59 lines.
 */
describe('while the drawn text is behind the editor’s document (U2)', () => {
  it('holds the editor’s renumbered line until the edited text is drawn, and then moves nothing', async () => {
    await mountParented();
    act(() => publishEditorDocLines('ed-1', 59));
    editorScrolledTo('ed-1', 13);
    await waitFor(() => expect(host().scrollTop).toBe(240));

    // Two lines typed at the very top: the editor's top line is now 15 of 61 — the same text as before.
    act(() => publishEditorDocLines('ed-1', 61));
    editorScrolledTo('ed-1', 15);
    await frames();
    expect(host().scrollTop).toBe(240);

    // The edited text arrives: P6 is on line 14, the block the editor's line 15 falls in.
    panel().push(previewUpdate({ panelId: panel().id, revision: 3, content: { kind: 'text', text: `X\n\n${DOC}` }, parent: PARENT }));
    await screen.findByText('X');
    await frames();
    expect(host().scrollTop).toBe(280);
    expect(ed1).not.toHaveBeenCalled();
  });

  /*
   * The race the first case met under load (1 run in the wide set): the body's post-draw report ran BEFORE
   * React committed the render that hands down the editor's renumbered line, so the body compared new block
   * numbers with the old line and requested 14. Here the frame is forced into a microtask right after the draw,
   * which is always before that render.
   */
  it('holds the same when the frame after the draw comes before the render that releases the editor’s line', async () => {
    await mountParented();
    act(() => publishEditorDocLines('ed-1', 59));
    editorScrolledTo('ed-1', 13);
    await waitFor(() => expect(host().scrollTop).toBe(240));
    act(() => publishEditorDocLines('ed-1', 61));
    editorScrolledTo('ed-1', 15);
    await frames();

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      queueMicrotask(() => cb(0));
      return 1;
    });
    panel().push(previewUpdate({ panelId: panel().id, revision: 3, content: { kind: 'text', text: `X\n\n${DOC}` }, parent: PARENT }));
    await screen.findByText('X');
    await frames();

    expect(host().scrollTop).toBe(280);
    expect(ed1).not.toHaveBeenCalled();
  });

  it('a reader’s scroll while behind requests nothing then, and its kept place drives the editor once the text is drawn', async () => {
    await mountParented();
    act(() => publishEditorDocLines('ed-1', 59));
    editorScrolledTo('ed-1', 13);
    await waitFor(() => expect(host().scrollTop).toBe(240));

    act(() => publishEditorDocLines('ed-1', 61));
    editorScrolledTo('ed-1', 15);
    // Half-way into P12 (line 24) of the OLD text.
    await readerScrolls(500);
    expect(ed1).not.toHaveBeenCalled();

    panel().push(previewUpdate({ panelId: panel().id, revision: 3, content: { kind: 'text', text: `X\n\n${DOC}` }, parent: PARENT }));
    await screen.findByText('X');
    await frames();
    // The kept place, renumbered: half-way into P12, now on line 26 — not snapped back to the editor's block.
    expect(host().scrollTop).toBe(540);
    expect(ed1).toHaveBeenCalledTimes(1);
    expect(ed1).toHaveBeenCalledWith(26);
  });

  it('the reader’s kept place still drives the editor when the frame after the draw comes before the release', async () => {
    await mountParented();
    act(() => publishEditorDocLines('ed-1', 59));
    editorScrolledTo('ed-1', 13);
    await waitFor(() => expect(host().scrollTop).toBe(240));
    act(() => publishEditorDocLines('ed-1', 61));
    editorScrolledTo('ed-1', 15);
    await readerScrolls(500);

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      queueMicrotask(() => cb(0));
      return 1;
    });
    panel().push(previewUpdate({ panelId: panel().id, revision: 3, content: { kind: 'text', text: `X\n\n${DOC}` }, parent: PARENT }));
    await screen.findByText('X');
    await frames();

    expect(host().scrollTop).toBe(540);
    expect(ed1).toHaveBeenCalledTimes(1);
    expect(ed1).toHaveBeenCalledWith(26);
  });
});

/*
 * 044 T192 / T203 (FR-115 beside FR-113) — a history step restores the reader's place (FR-107, FR-101),
 * and the editor's line must not land on top of it. Since T231 (FR-121f) the editor then FOLLOWS the place
 * restored. The two steps reach the body by different routes, so both are covered here:
 *
 *  - SAME FILE (8): the update carries `content: null`, so the text never changes and the body never
 *    redraws — the place arrives through the body's "a place for the file already drawn" effect.
 *  - ANOTHER FILE (10): the text changes, so the body redraws down its NAVIGATION branch, and the run
 *    passed through a file with no editor — which stops sync. The draw has to claim the editor's current
 *    line for the place it just restored, or the editor's line is re-applied on top of it (review finding 1).
 *
 * Neither writes the editor store nor sends a second navigate.
 */
describe('a history place in a synchronised preview (FR-113, FR-115, FR-121f)', () => {
  /*
   * Was: "(8) a same-file history step restores its place over the editor’s line, and starts no echo".
   * Superseded by FR-121f: the place is still restored over the editor's line, and the editor now follows it.
   */
  it('(8) a same-file history step restores its place over the editor’s line, and then the editor follows it (FR-121f)', async () => {
    await mountParented();
    editorScrolledTo('ed-1', 13);
    await waitFor(() => expect(host().scrollTop).toBe(240));
    const drawn = screen.getByText('P20');
    const published = vi.fn();
    const unsubscribe = subscribeEditorTopLine(published);
    try {
      // Main's same-file step: the next revision, content unchanged, the entry's place (P20, line 40).
      panel().push(previewUpdate({ panelId: panel().id, revision: 3, content: null, parent: PARENT, viewState: { line: 40, offsetRatio: 0 } }));
      await waitFor(() => expect(host().scrollTop).toBe(800));
      await frames();

      expect(host().scrollTop).toBe(800);
      expect(screen.getByText('P20')).toBe(drawn);
      expect(ed1).toHaveBeenCalledTimes(1);
      expect(ed1).toHaveBeenCalledWith(40);
      expect(published).not.toHaveBeenCalled();
      expect(panel().preview.navigate).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }

    // Sync is still live: the editor's NEXT move is followed.
    editorScrolledTo('ed-1', 20);
    await waitFor(() => expect(host().scrollTop).toBe(400));
  });

  /*
   * Was: "(9) a heading jump in a synchronised preview sends one heading intent and moves the editor store not
   * at all". Superseded by FR-121f: a followed heading link is a scroll, and the editor follows it.
   */
  it('(9) a heading jump in a synchronised preview sends one heading intent and requests the editor at the heading’s line', async () => {
    const text = `[Jump](#end)\n\n${DOC}\n\n## End\n\nEnd text.`;
    await mountParented({ text, last: 'End text.' });
    editorScrolledTo('ed-1', 13);
    // P5 is on line 12 once the link's two lines are above it.
    await waitFor(() => expect(host().scrollTop).toBe(240));
    const published = vi.fn();
    const unsubscribe = subscribeEditorTopLine(published);
    panel().preview.navigate.mockImplementation((req) =>
      Promise.resolve({ kind: 'shown', update: previewUpdate({ panelId: req.panelId, revision: 2, content: null, parent: PARENT }) }),
    );
    try {
      host().scrollTop = 0;
      fireEvent.click(screen.getByText('Jump'), { ctrlKey: true });
      // `## End` is on line 62.
      expect(host().scrollTop).toBe(1240);
      // The engine's event for the chrome's `scrollTop` write.
      host().dispatchEvent(new Event('scroll'));
      await waitFor(() => expect(panel().preview.navigate).toHaveBeenCalledTimes(1));
      await frames();

      expect(panel().preview.navigate.mock.calls[0][0]).toMatchObject({
        intent: { kind: 'heading' },
        leavingViewState: { line: 0, offsetRatio: 0 },
        arrivingViewState: { line: 62, offsetRatio: 0 },
      });
      expect(panel().preview.navigate).toHaveBeenCalledTimes(1);
      expect(host().scrollTop).toBe(1240);
      expect(ed1).toHaveBeenCalledTimes(1);
      expect(ed1).toHaveBeenCalledWith(62);
      expect(published).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  /*
   * Was: "(10) Back from a file with no editor restores the place the reader left, not the editor’s line
   * (FR-107, FR-101)". Superseded by FR-121f: the place still wins, and the editor then follows it.
   */
  it('(10) Back from a file with no editor restores the place the reader left, and then the editor follows it (FR-107, FR-121f)', async () => {
    await mountParented();
    editorScrolledTo('ed-1', 13);
    await waitFor(() => expect(host().scrollTop).toBe(240));
    // The reader scrolls the preview itself down to P20 (line 40), and follows a link from there.
    host().scrollTop = 800;
    const published = vi.fn();
    const unsubscribe = subscribeEditorTopLine(published);
    try {
      // The link's file has no editor open, so main sends it with no parent: sync stops.
      panel().push(
        previewUpdate({
          panelId: panel().id,
          revision: 3,
          filePath: `${ROOT}/docs/setup.md`,
          content: { kind: 'text', text: '# Setup\n\nStep one.' },
          parent: null,
          navigationSeq: 1,
        }),
      );
      await screen.findByText('Step one.');
      await frames();
      ed1.mockClear();

      // Alt+Left: main sends the entry back, with the place the reader left it at and README's editor again.
      panel().push(
        previewUpdate({
          panelId: panel().id,
          revision: 4,
          content: { kind: 'text', text: DOC },
          parent: PARENT,
          navigationSeq: 2,
          viewState: { line: 40, offsetRatio: 0 },
        }),
      );
      await screen.findByText('P29', {}, COLD);
      await frames();

      expect(host().scrollTop).toBe(800);
      expect(ed1).toHaveBeenCalledTimes(1);
      expect(ed1).toHaveBeenCalledWith(40);
      expect(published).not.toHaveBeenCalled();
      expect(panel().preview.navigate).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }

    // Sync is live again, so the editor's NEXT move is followed from where the reader was put back.
    editorScrolledTo('ed-1', 20);
    await waitFor(() => expect(host().scrollTop).toBe(400));
  });
});
