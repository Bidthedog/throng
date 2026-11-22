/**
 * 073 SC-009, MT-01 — what a real CSV Preview Editor panel does per frame while the reader scrolls its grid SIDEWAYS, in step
 * with an editor, on 3,000 rows with Wrap off and on: the chrome and the body do not re-render or re-measure, the editor is
 * not asked to move, and the grid's own commit draws only inside its scroller.
 *
 * What a count CAN show: DOM written outside the grid's window, rectangle reads, follows asked of the editor. What it CANNOT
 * show: how long the cells that do enter take to draw — jsdom has no layout or paint — nor CodeMirror's measure cycle, which
 * is not mounted here. Those need a DevTools Performance trace (see the report that came with this test).
 *
 * Layer: component — the panel's per-frame work; the grid's own commit counts are `data-grid-scroll-cost.test.ts`'s.
 */
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetEditorScrollStore, publishEditorCentreLine, publishEditorTopLine, registerEditorScroller } from '../../src/renderer/editor/editor-scroll-store.js';
import { __resetSyncMarks } from '../../src/renderer/preview/sync-mark-store.js';
import { COLD, mountMarkdownPreview, previewUpdate, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const PARENT = { panelId: 'ed-1', title: 'data.csv' };
const FILE = 'D:/proj/data.csv';
const FRAMES = 20;

const csv = (n: number): string =>
  Array.from({ length: n }, (_, i) => `r${i},b${i},${i % 3 === 0 ? 'a long cell value that wraps over several lines when narrow '.repeat(3) : 'c'},d,e,f,g,h,i,j,k,l`).join('\n') + '\n';

let m: MountedPreviewWindow | undefined;

beforeEach(() => {
  __resetEditorScrollStore();
  __resetSyncMarks();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ font: '', measureText: (t: string) => ({ width: t.length * 8 }) }) as unknown as CanvasRenderingContext2D,
  );
});
afterEach(() => {
  m?.unmount();
  m = undefined;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const frame = (): Promise<void> => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

describe.each([false, true])('a 3,000-row CSV pair, Wrap %s, grid scrolled sideways (MT-01)', (wrap) => {
  it('writes nothing outside the grid window, measures nothing, and asks the editor for nothing', async () => {
    m = await mountMarkdownPreview(csv(3000), FILE, {
      providerId: 'csv',
      attach: { parent: PARENT },
      settings: { editor: { previews: { providers: { csv: { wrapCells: wrap } } } } },
    });
    const grid = await screen.findByTestId(`csv-grid-${m.id}`, {}, COLD);
    m.push(previewUpdate({ panelId: m.id, revision: 2, content: null, parent: PARENT, providerId: 'csv', filePath: FILE }));
    const scroller = document.querySelector<HTMLElement>('.data-grid__scroller')!;
    let left = 0;
    Object.defineProperty(scroller, 'scrollLeft', { get: () => left, set: (v: number) => void (left = v), configurable: true });
    let follows = 0;
    registerEditorScroller('ed-1', (line) => {
      follows += 1;
      publishEditorTopLine('ed-1', line, true);
    });
    publishEditorCentreLine('ed-1', 10);
    act(() => publishEditorTopLine('ed-1', 0));
    // Let the mount finish: the status strip fills its readouts and ruler as the body reports, a few frames after draw.
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 400)));
    await frame();

    const outside: MutationRecord[] = [];
    const watch = new MutationObserver((records) => {
      for (const r of records) if (!scroller.contains(r.target)) outside.push(r);
    });
    watch.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    const rects = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    follows = 0;
    for (let i = 1; i <= FRAMES; i += 1) {
      left = i * 150;
      act(() => void scroller.dispatchEvent(new Event('scroll')));
      await frame();
    }
    watch.disconnect();
    const why = outside.map((r) => `${r.type}:${(r.target as Element).nodeName}.${(r.target as Element).className ?? ''}:${r.attributeName ?? ''}`);
    expect(why).toEqual([]);
    expect(grid.querySelectorAll('[data-grid-cell]').length).toBeGreaterThan(0);
    expect(left).toBeGreaterThan(0);
    expect(outside).toHaveLength(0); // no chrome, status bar or body re-render wrote anything for a sideways frame
    expect(rects).not.toHaveBeenCalled(); // and nothing re-measured the chrome
    expect(follows).toBe(0); // a sideways scroll keeps the same top record, so the editor is not asked to move
  }, 120_000);
});
