/**
 * 073 FR-033c, FR-033g (T076, T077) — what a real CSV Preview Editor panel does per frame while its scroll is in step with
 * the editor it is linked to, in either direction, on 3,000 and 10,000 rows with Wrap off and on.
 *
 * Mounted whole (the chrome, the shipped CSV body, the real grid), the editor played by `editor-scroll-store`'s publishing
 * and a registered scroller that answers like the relay does (a follow comes back as a `fromSync` publish).
 *
 * What this layer CAN show: how many times each piece of work runs per frame — follows asked of the editor, writes to the
 * grid's scroll offset, notifications from the mark store, rectangle reads the chrome makes. Those counts carry over to the
 * app unchanged. What it CANNOT show: how long any of it takes. jsdom has no layout, no compositor, no real
 * `ResizeObserver` and no CodeMirror measure cycle, so a rectangle read costs nothing here that costs a forced reflow
 * in a browser. The bounds below are on COUNTS for that reason; a frame time needs a DevTools Performance trace.
 *
 * Layer: component — the panel's per-frame work. The store's own rules are `sync-mark-store.test.ts`'s; the grid's
 * mark cost is `data-grid-sync-mark-cost.test.ts`'s.
 */
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetEditorScrollStore, publishEditorCentreLine, publishEditorTopLine, registerEditorScroller } from '../../src/renderer/editor/editor-scroll-store.js';
import { SYNC_MARK_QUIET_MS, __resetSyncMarks, subscribeSyncMark, syncMarkOf } from '../../src/renderer/preview/sync-mark-store.js';
import { COLD, mountMarkdownPreview, previewUpdate, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const PARENT = { panelId: 'ed-1', title: 'data.csv' };
const FILE = 'D:/proj/data.csv';
const ROW = 22;
const FRAMES = 30;

/** Every third row is long enough to wrap over several lines at the default column width. */
const csv = (n: number): string =>
  Array.from({ length: n }, (_, i) => `r${i},b${i},${i % 3 === 0 ? 'a long cell value that wraps over several lines when narrow '.repeat(3) : 'c'},d,e`).join('\n') + '\n';

let m: MountedPreviewWindow | undefined;

beforeEach(() => {
  __resetEditorScrollStore();
  __resetSyncMarks();
  // CodeMirror is not mounted, but the status bar and the grid read these in jsdom.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ font: '', measureText: (t: string) => ({ width: t.length * 8 }) }) as unknown as CanvasRenderingContext2D,
  );
});
afterEach(() => {
  vi.useRealTimers();
  m?.unmount();
  m = undefined;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const frame = (): Promise<void> => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

async function mountPair(rows: number, wrap: boolean) {
  m = await mountMarkdownPreview(csv(rows), FILE, {
    providerId: 'csv',
    attach: { parent: PARENT },
    settings: { editor: { previews: { providers: { csv: { wrapCells: wrap } } } } },
  });
  await screen.findByTestId(`csv-grid-${m.id}`, {}, COLD);
  m.push(previewUpdate({ panelId: m.id, revision: 2, content: null, parent: PARENT, providerId: 'csv', filePath: FILE }));
  const scroller = document.querySelector<HTMLElement>('.data-grid__scroller')!;
  let top = 0;
  let writes = 0;
  // jsdom lays nothing out: the scroller's offset and height are the test's to hold, and a write to the offset is counted.
  Object.defineProperty(scroller, 'scrollTop', { get: () => top, set: (v: number) => void ((writes += 1), (top = v)), configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { get: () => 24 + 20 * ROW, configurable: true });
  let follows = 0;
  registerEditorScroller('ed-1', (line) => {
    follows += 1;
    publishEditorTopLine('ed-1', line, true); // the relay's answer: the editor scrolled because it was asked to
  });
  publishEditorCentreLine('ed-1', 10);
  act(() => publishEditorTopLine('ed-1', 0));
  await frame();
  const rects = vi.spyOn(Element.prototype, 'getBoundingClientRect');
  let emits = 0;
  const off = subscribeSyncMark(() => void (emits += 1));
  return {
    scroller,
    gridScrolls: (to: number): void => {
      top = to;
      act(() => void scroller.dispatchEvent(new Event('scroll')));
    },
    counts: () => ({ follows, writes, emits, rects: rects.mock.calls.length }),
    reset: (): void => {
      follows = 0;
      writes = 0;
      emits = 0;
      rects.mockClear();
    },
    done: off,
  };
}

describe.each([
  [3000, false],
  [3000, true],
  [10000, false],
  [10000, true],
])('a %i-row CSV, Wrap %s: per-frame work while the pair scrolls in step (T077)', (rows, wrap) => {
  it('the grid leads: one follow asked of the editor per frame at most, no scroll echoed back into the grid, no mark work, no chrome measuring', async () => {
    const s = await mountPair(rows, wrap);
    s.reset();
    for (let i = 1; i <= FRAMES; i += 1) {
      s.gridScrolls(i * 5 * ROW);
      await frame();
    }
    const c = s.counts();
    expect(c.follows).toBeGreaterThan(0); // sync really ran: the counts below are not vacuous
    expect(c.follows).toBeLessThanOrEqual(FRAMES); // <= 1 per frame
    expect(c.writes).toBe(0); // the editor's echo does not move the grid again
    expect(c.emits).toBe(0); // FR-033g: nothing from the mark store while scrolling
    // Measured at 7 per frame before the status bar held still across a frame that changed nothing it draws.
    expect(c.rects / FRAMES).toBeLessThanOrEqual(1);
    s.done();
  }, 120_000);

  it('the editor leads: one follow of the grid per frame at most, nothing asked of the editor in return, no mark work, no chrome measuring', async () => {
    const s = await mountPair(rows, wrap);
    s.reset();
    for (let i = 1; i <= FRAMES; i += 1) {
      act(() => publishEditorTopLine('ed-1', i * 5));
      await frame();
    }
    const c = s.counts();
    expect(c.writes).toBeGreaterThan(0);
    expect(c.writes).toBeLessThanOrEqual(FRAMES);
    expect(c.follows).toBe(0); // the grid's own follow is claimed: it is not reported back as the reader's scroll
    expect(c.emits).toBe(0);
    expect(c.rects / FRAMES).toBeLessThanOrEqual(1);
    s.done();
  }, 120_000);
});

describe('the mark waits for scrolling to stop on a CSV pair (FR-033g, T076)', () => {
  it('the grid leading: nothing over a 50-frame scroll, exactly one mark 300 ms after the last, cleared when it starts again', async () => {
    const s = await mountPair(3000, false);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    s.reset();
    for (let i = 1; i <= 50; i += 1) {
      s.gridScrolls(i * 3 * ROW);
      await frame();
      act(() => void vi.advanceTimersByTime(16));
    }
    expect(s.counts().follows).toBeGreaterThan(0); // the editor followed every step
    expect(s.counts().emits).toBe(0);
    expect(syncMarkOf('ed-1')).toBeNull();
    expect(document.querySelector('.data-grid__row--sync-mark')).toBeNull();
    act(() => void vi.advanceTimersByTime(SYNC_MARK_QUIET_MS - 16 - 1));
    expect(s.counts().emits).toBe(0);
    act(() => void vi.advanceTimersByTime(1));
    expect(s.counts().emits).toBe(1);
    expect(syncMarkOf('ed-1')?.on).toBe(true);
    expect(document.querySelectorAll('.data-grid__row--sync-mark-on')).toHaveLength(1);

    s.gridScrolls(51 * 3 * ROW);
    await frame();
    expect(syncMarkOf('ed-1')).toBeNull();
    expect(document.querySelector('.data-grid__row--sync-mark')).toBeNull();
    s.done();
  }, 120_000);

  it('the editor leading: nothing over a 50-frame scroll, exactly one mark 300 ms after the last, cleared when it starts again', async () => {
    const s = await mountPair(3000, false);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    s.reset();
    for (let i = 1; i <= 50; i += 1) {
      act(() => publishEditorTopLine('ed-1', i * 3));
      await frame();
      act(() => void vi.advanceTimersByTime(16));
    }
    expect(s.counts().writes).toBeGreaterThan(0); // the grid followed every step
    expect(s.counts().emits).toBe(0);
    expect(syncMarkOf('ed-1')).toBeNull();
    act(() => void vi.advanceTimersByTime(SYNC_MARK_QUIET_MS - 16 - 1));
    expect(s.counts().emits).toBe(0);
    act(() => void vi.advanceTimersByTime(1));
    expect(s.counts().emits).toBe(1);
    expect(syncMarkOf('ed-1')?.on).toBe(true);

    act(() => publishEditorTopLine('ed-1', 400));
    expect(syncMarkOf('ed-1')).toBeNull();
    s.done();
  }, 120_000);
});
