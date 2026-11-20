/**
 * 073 FR-033d — while Synchronise Scrolling moves one view with the other, BOTH mark the place they are in step at:
 * the editor with a soft line highlight, a Markdown preview with an indicator in its gutter beside the block holding
 * that line. Either view may lead; the mark fades 1.5 s after the last sync scroll; with the preview gutter Disabled the
 * preview shows no indicator and the editor's highlight still does.
 *
 * Mounted the way `preview-scroll-sync.test.ts` mounts it (the whole panel, the shipped Markdown body, the editor
 * played by `editor-scroll-store`'s publishing and a registered scroller), with the same stand-in geometry: every block
 * drawn at 20 px per source line, the document thirty paragraphs `Pn` on source line `2n`.
 *
 * Layer: component — what the panel marks and when. The editor's own decoration is `editor-sync-mark.test.ts`'s; the
 * CSV grid's is `csv-body-scroll-sync.test.ts`'s.
 */
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetEditorScrollStore, publishEditorCentreLine, publishEditorDocLines, publishEditorTopLine, registerEditorCentreReader, registerEditorScroller } from '../../src/renderer/editor/editor-scroll-store.js';
import { SYNC_MARK_FADE_MS, SYNC_MARK_QUIET_MS, SYNC_MARK_REMOVE_MS, __resetSyncMarks, subscribeSyncMark, syncMarkOf } from '../../src/renderer/preview/sync-mark-store.js';
import { COLD, README, mountMarkdownPreview, previewUpdate, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const DOC = Array.from({ length: 30 }, (_, i) => `P${i}`).join('\n\n');
const PARENT = { panelId: 'ed-1', title: 'README.md' };
const GUTTER = (on: boolean) => ({ editor: { previews: { providers: { markdown: { gutter: on } } } } });

let m: MountedPreviewWindow | undefined;
let ed1: ReturnType<typeof vi.fn<(line: number) => void>>;
const host = (): HTMLElement => screen.getByTestId(`preview-body-${m!.id}`);
const marked = (): HTMLElement[] => [...host().querySelectorAll<HTMLElement>('.preview-sync-mark')];

function withGeometry(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
    const scroller = document.querySelector<HTMLElement>('.preview-panel__body');
    if (this === scroller) return { top: 100, height: 400, left: 0, width: 400 } as DOMRect;
    const line = Number(this.getAttribute('data-source-line'));
    return { top: 100 + line * 20 - (scroller?.scrollTop ?? 0), height: 40, left: 0, width: 400 } as DOMRect;
  });
}
/** The editor scrolled to `line` at its top, with `centre` under the middle of its viewport (ten lines lower unless told). */
const editorScrolledTo = (line: number, fromSync = false, centre = line + 10): void =>
  act(() => {
    publishEditorCentreLine('ed-1', centre);
    publishEditorTopLine('ed-1', line, fromSync);
  });
/** FR-033g: scrolling stops, and the mark appears after the quiet period. */
const settle = (): void => act(() => void vi.advanceTimersByTime(SYNC_MARK_QUIET_MS));
async function frames(n = 2): Promise<void> {
  for (let i = 0; i < n; i += 1) await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}
async function readerScrolls(scrollTop: number): Promise<void> {
  host().scrollTop = scrollTop;
  host().dispatchEvent(new Event('scroll'));
  await frames();
}
async function mountParented(settings: Record<string, unknown> = GUTTER(true)): Promise<void> {
  m = await mountMarkdownPreview(DOC, README, { settings, attach: { parent: PARENT } });
  await screen.findByText('P29', {}, COLD);
  m.push(previewUpdate({ panelId: m.id, revision: 2, content: null, parent: PARENT }));
  // The editor has published its place before anyone scrolls: the first line seen is not a scroll.
  editorScrolledTo(0);
  await frames();
}

beforeEach(() => {
  __resetEditorScrollStore();
  __resetSyncMarks();
  withGeometry();
  ed1 = vi.fn<(line: number) => void>();
  registerEditorScroller('ed-1', ed1);
});
afterEach(() => {
  vi.useRealTimers();
  m?.unmount();
  m = undefined;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('the editor leads (FR-033d, FR-033e)', () => {
  it('marks the editor line at the vertical CENTRE and the block holding it in the preview gutter, not the top line', async () => {
    await mountParented();
    expect(marked()).toEqual([]);
    editorScrolledTo(13); // top 13; the line under the middle of the editor is 23
    await waitFor(() => expect(syncMarkOf('ed-1')).toEqual({ line: 23, on: true }));
    // Line 23 is blank between P11 (line 22) and P12 (line 24): the block holding it is P11 - not P6, which holds the top.
    await waitFor(() => expect(marked().map((e) => e.textContent)).toEqual(['P11']));
    expect(marked()[0]).toHaveClass('preview-sync-mark--on');
  });

  it('names the centre however far it is from the top (a tall viewport), and falls back to the top with no centre', async () => {
    await mountParented();
    editorScrolledTo(13, false, 40);
    await waitFor(() => expect(syncMarkOf('ed-1')?.line).toBe(40));
    await waitFor(() => expect(marked().map((e) => e.textContent)).toEqual(['P20']));
  });

  it('leaves the preview\'s focus and selection alone', async () => {
    await mountParented();
    const before = document.activeElement;
    editorScrolledTo(13);
    await waitFor(() => expect(marked()).toHaveLength(1));
    expect(document.activeElement).toBe(before);
    expect(window.getSelection()?.rangeCount ?? 0).toBe(0);
  });

  it('moves the indicator to the new block on the next sync scroll, never two at once', async () => {
    await mountParented();
    editorScrolledTo(13);
    await waitFor(() => expect(marked().map((e) => e.textContent)).toEqual(['P11']));
    editorScrolledTo(30);
    await waitFor(() => expect(marked().map((e) => e.textContent)).toEqual(['P20']));
  });

  it('marks the pair even when the preview is clamped short of the line (the follower part way down)', async () => {
    // The preview cannot scroll that far (no layout here), yet the block holding the editor's line is marked.
    await mountParented();
    editorScrolledTo(58); // centre 68, past the end: the block at or before it is the last, P29
    await waitFor(() => expect(marked().map((e) => e.textContent)).toEqual(['P29']));
  });

  it('does not mark the echo of the preview having asked the editor to move (FR-121g)', async () => {
    await mountParented();
    editorScrolledTo(13, true);
    await frames();
    expect(syncMarkOf('ed-1')).toBeNull();
    expect(marked()).toEqual([]);
  });

  it('marks nothing while Synchronise Scrolling is off', async () => {
    await mountParented({ ...GUTTER(true), editor: { previews: { syncScroll: false, providers: { markdown: { gutter: true } } } } });
    editorScrolledTo(13);
    await frames();
    expect(syncMarkOf('ed-1')).toBeNull();
    expect(marked()).toEqual([]);
  });
});

describe('the preview leads (FR-033d, FR-033e)', () => {
  it('asks the editor to follow the TOP block, but marks the block at the vertical CENTRE and that line in the editor', async () => {
    await mountParented();
    await readerScrolls(500); // P12 (line 24) straddles the top; P17 (line 34, 180-220 px) straddles the middle, 200 px down
    expect(ed1).toHaveBeenCalledWith(24);
    await waitFor(() => expect(syncMarkOf('ed-1')).toEqual({ line: 34, on: true }), { timeout: 2000 });
    await waitFor(() => expect(marked().map((e) => e.textContent)).toEqual(['P17']));
  });
});

describe('the mark fades after the last sync scroll (FR-033d)', () => {
  it('goes off 1.5 s after the last scroll, and is gone after the transition', async () => {
    await mountParented();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    editorScrolledTo(13);
    settle();
    expect(syncMarkOf('ed-1')?.on).toBe(true);

    act(() => void vi.advanceTimersByTime(SYNC_MARK_FADE_MS - 1));
    expect(syncMarkOf('ed-1')?.on).toBe(true);
    act(() => void vi.advanceTimersByTime(1));
    expect(syncMarkOf('ed-1')).toEqual({ line: 23, on: false });
    expect(marked()[0]).toHaveClass('preview-sync-mark');
    expect(marked()[0]).not.toHaveClass('preview-sync-mark--on');

    act(() => void vi.advanceTimersByTime(SYNC_MARK_REMOVE_MS));
    expect(syncMarkOf('ed-1')).toBeNull();
    expect(marked()).toEqual([]);
  });

  it('each further scroll restarts the timer', async () => {
    await mountParented();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    editorScrolledTo(13);
    settle();
    act(() => void vi.advanceTimersByTime(1000));
    editorScrolledTo(30);
    settle();
    act(() => void vi.advanceTimersByTime(1000));
    expect(syncMarkOf('ed-1')).toEqual({ line: 40, on: true });
    act(() => void vi.advanceTimersByTime(500));
    expect(syncMarkOf('ed-1')?.on).toBe(false);
  });
});

describe('the preview gutter is Disabled (FR-033d, 047 FR-032b)', () => {
  it('draws no indicator in the preview, and the editor line is still marked', async () => {
    await mountParented(GUTTER(false));
    editorScrolledTo(13);
    await waitFor(() => expect(syncMarkOf('ed-1')).toEqual({ line: 23, on: true }));
    await frames();
    expect(marked()).toEqual([]);
    expect(host().querySelector('.preview-markdown--gutter')).toBeNull();
  });

  it('shows the indicator when the gutter is switched on while a mark is showing', async () => {
    await mountParented(GUTTER(false));
    editorScrolledTo(13);
    await waitFor(() => expect(syncMarkOf('ed-1')).not.toBeNull());
    m!.setSettings(GUTTER(true));
    await waitFor(() => expect(marked().map((e) => e.textContent)).toEqual(['P11']));
  });
});

describe('Scroll-sync highlight duration (FR-033f)', () => {
  const seconds = (s: number) => ({ editor: { previews: { syncHighlightSeconds: s, providers: { markdown: { gutter: true } } } } });

  it('at 4 seconds the mark stays bright for 4 s, in the editor store and the preview gutter, then fades', async () => {
    await mountParented(seconds(4));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    editorScrolledTo(13);
    settle();
    act(() => void vi.advanceTimersByTime(3999));
    expect(syncMarkOf('ed-1')?.on).toBe(true);
    expect(marked()[0]).toHaveClass('preview-sync-mark--on');
    act(() => void vi.advanceTimersByTime(1));
    expect(syncMarkOf('ed-1')).toEqual({ line: 23, on: false });
    expect(marked()[0]).not.toHaveClass('preview-sync-mark--on');
  });

  it('at 0 no highlight is drawn in any view, whichever view leads, while the preview still follows the editor', async () => {
    await mountParented(seconds(0));
    editorScrolledTo(13);
    await waitFor(() => expect(host().scrollTop).toBe(240)); // sync itself is untouched
    expect(syncMarkOf('ed-1')).toBeNull();
    expect(marked()).toEqual([]);
    await readerScrolls(500);
    expect(ed1).toHaveBeenCalledWith(24);
    expect(syncMarkOf('ed-1')).toBeNull();
    expect(marked()).toEqual([]);
  });

  it('is read live: the next scroll after the setting changes uses the new value', async () => {
    await mountParented(seconds(1.5));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    editorScrolledTo(13);
    settle();
    act(() => void vi.advanceTimersByTime(1500));
    expect(syncMarkOf('ed-1')?.on).toBe(false);

    m!.setSettings(seconds(4));
    editorScrolledTo(30);
    settle();
    act(() => void vi.advanceTimersByTime(3999));
    expect(syncMarkOf('ed-1')?.on).toBe(true);
    act(() => void vi.advanceTimersByTime(1));
    expect(syncMarkOf('ed-1')?.on).toBe(false);
  });
});

describe('the work per sync scroll is bounded by the viewport, not the document (073 T075)', () => {
  /** A pair over a 3,000-line Markdown file: 1,500 paragraphs, every one a block the old scan measured. */
  async function mountLarge(): Promise<void> {
    const doc = Array.from({ length: 1500 }, (_, i) => `P${i}`).join('\n\n');
    m = await mountMarkdownPreview(doc, README, { settings: GUTTER(true), attach: { parent: PARENT } });
    await screen.findByText('P1499', {}, COLD);
    m.push(previewUpdate({ panelId: m.id, revision: 2, content: null, parent: PARENT }));
    editorScrolledTo(0);
    await frames();
  }

  it('an editor-led scroll reads a handful of rectangles and attributes, where the full scan read one per block', async () => {
    await mountLarge();
    const scroller = host(); // looked up before counting: the lookup is a query of its own
    const rect = Element.prototype.getBoundingClientRect as unknown as ReturnType<typeof vi.fn>;
    const attr = vi.spyOn(Element.prototype, 'getAttribute');
    const qsa = vi.spyOn(Element.prototype, 'querySelectorAll');
    rect.mockClear();
    const SCROLLS = 30;
    for (let i = 1; i <= SCROLLS; i += 1) {
      editorScrolledTo(i * 12);
      await frames(1);
    }
    expect(scroller.scrollTop).toBeGreaterThan(0); // the preview really followed: the counts are not vacuous
    // Measured before the index: ~3,016 rects, ~12,028 attribute reads and 5 whole-document queries per scroll.
    expect(rect.mock.calls.length / SCROLLS).toBeLessThanOrEqual(60);
    expect(attr.mock.calls.length / SCROLLS).toBeLessThanOrEqual(150);
    expect(qsa.mock.calls.length / SCROLLS).toBeLessThanOrEqual(1);
  }, 60_000);

  it('a preview-led scroll is just as bounded', async () => {
    await mountLarge();
    const scroller = host();
    const rect = Element.prototype.getBoundingClientRect as unknown as ReturnType<typeof vi.fn>;
    const attr = vi.spyOn(Element.prototype, 'getAttribute');
    rect.mockClear();
    const SCROLLS = 30;
    for (let i = 1; i <= SCROLLS; i += 1) {
      scroller.scrollTop = i * 600;
      scroller.dispatchEvent(new Event('scroll'));
      await frames(1);
    }
    expect(ed1).toHaveBeenCalled();
    expect(rect.mock.calls.length / SCROLLS).toBeLessThanOrEqual(60);
    expect(attr.mock.calls.length / SCROLLS).toBeLessThanOrEqual(150);
  }, 60_000);

  it('moving the mark touches the class of two blocks at most, and publishes at most once a frame', async () => {
    await mountLarge();
    const scroller = host();
    const touched: Set<Element>[] = [];
    let current = new Set<Element>();
    const mo = new MutationObserver((records) => records.forEach((r) => current.add(r.target as Element)));
    mo.observe(scroller, { subtree: true, attributes: true, attributeFilter: ['class'] });
    let emits = 0;
    const off = subscribeSyncMark(() => void (emits += 1));
    const SCROLLS = 20;
    for (let i = 1; i <= SCROLLS; i += 1) {
      current = new Set();
      editorScrolledTo(i * 12);
      await frames(1);
      current = new Set([...current, ...mo.takeRecords().map((r) => r.target as Element)]);
      touched.push(current);
    }
    off();
    mo.disconnect();
    expect(touched.every((t) => t.size <= 2)).toBe(true);
    expect(emits).toBeLessThanOrEqual(SCROLLS);
  }, 60_000);

  it('typing publishes no mark and reads no centre: the editor\'s top line stands still while its document changes', async () => {
    await mountLarge();
    const centre = vi.fn(() => 10);
    const unregister = registerEditorCentreReader('ed-1', centre);
    let emits = 0;
    const off = subscribeSyncMark(() => void (emits += 1));
    for (let lines = 3001; lines < 3041; lines += 1) {
      act(() => {
        publishEditorDocLines('ed-1', lines);
        publishEditorTopLine('ed-1', 0);
      });
      await frames(1);
    }
    off();
    unregister();
    expect(emits).toBe(0);
    expect(centre).not.toHaveBeenCalled();
    expect(syncMarkOf('ed-1')).toBeNull();
  }, 60_000);

  it('reads the editor\'s centre once per published mark, and only then', async () => {
    await mountLarge();
    const centre = vi.fn(() => 40);
    const unregister = registerEditorCentreReader('ed-1', centre);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    for (let i = 1; i <= 10; i += 1) {
      act(() => publishEditorTopLine('ed-1', i * 12));
      settle();
    }
    unregister();
    expect(centre).toHaveBeenCalledTimes(10);
  }, 60_000);
});

describe('the mark waits until scrolling has stopped (073 FR-033g, Q41)', () => {
  /** Frames at 16 ms apiece on the fake clock, so a continuous scroll never leaves a 300 ms gap. */
  const FRAMES = 50;

  it('the editor leading: no publish, no centre read and no notification over a 50-frame scroll; exactly one mark 300 ms after the last', async () => {
    await mountParented();
    const centre = vi.fn(() => 40);
    const unregister = registerEditorCentreReader('ed-1', centre);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let emits = 0;
    const off = subscribeSyncMark(() => void (emits += 1));
    for (let i = 1; i <= FRAMES; i += 1) {
      act(() => publishEditorTopLine('ed-1', i * 3));
      act(() => void vi.advanceTimersByTime(16));
    }
    expect(emits).toBe(0);
    expect(centre).not.toHaveBeenCalled();
    expect(syncMarkOf('ed-1')).toBeNull();
    expect(marked()).toEqual([]);
    act(() => void vi.advanceTimersByTime(SYNC_MARK_QUIET_MS - 16 - 1));
    expect(emits).toBe(0);
    act(() => void vi.advanceTimersByTime(1));
    expect(emits).toBe(1);
    expect(centre).toHaveBeenCalledTimes(1);
    expect(syncMarkOf('ed-1')).toEqual({ line: 40, on: true });
    off();
    unregister();
  }, 60_000);

  it('the editor leading: scrolling again clears the mark that is showing and draws nothing until it stops once more', async () => {
    await mountParented();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    editorScrolledTo(13);
    settle();
    expect(syncMarkOf('ed-1')?.on).toBe(true);
    expect(marked()).toHaveLength(1);

    editorScrolledTo(30);
    expect(syncMarkOf('ed-1')).toBeNull();
    expect(marked()).toEqual([]);
    act(() => void vi.advanceTimersByTime(SYNC_MARK_QUIET_MS - 1));
    expect(syncMarkOf('ed-1')).toBeNull();
    settle();
    expect(syncMarkOf('ed-1')).toEqual({ line: 40, on: true });
  });

  it('the preview leading: no publish over a 50-frame scroll, one mark 300 ms after the last, cleared when it starts again', async () => {
    await mountParented();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let emits = 0;
    const off = subscribeSyncMark(() => void (emits += 1));
    for (let i = 1; i <= FRAMES; i += 1) {
      await readerScrolls(i * 20);
      act(() => void vi.advanceTimersByTime(16));
    }
    expect(ed1).toHaveBeenCalled(); // sync itself followed
    expect(emits).toBe(0);
    expect(syncMarkOf('ed-1')).toBeNull();
    act(() => void vi.advanceTimersByTime(SYNC_MARK_QUIET_MS - 16 - 1));
    expect(emits).toBe(0);
    act(() => void vi.advanceTimersByTime(1));
    expect(emits).toBe(1);
    expect(syncMarkOf('ed-1')?.on).toBe(true);

    await readerScrolls(FRAMES * 20 + 40);
    expect(syncMarkOf('ed-1')).toBeNull();
    off();
  }, 60_000);

  it('still follows every frame while the mark waits: the preview moves with each editor scroll', async () => {
    await mountParented();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    editorScrolledTo(13);
    await frames();
    expect(host().scrollTop).toBe(240);
    editorScrolledTo(20);
    await frames();
    expect(host().scrollTop).toBe(400);
    expect(syncMarkOf('ed-1')).toBeNull();
  });
});
