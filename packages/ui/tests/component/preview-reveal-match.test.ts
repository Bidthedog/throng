/**
 * 054 T027 — a preview opened for a Find in Files result shows the match (FR-031, FR-032, research R8):
 * scrolled into view, its section unfolded, painted with the find highlight — or, when what the preview
 * draws cannot show it (hidden front matter, inside a diagram), the editor opens at the match instead.
 *
 * Layer: component — the real panel and the shipped Markdown body; the reveal arrives the way an open
 * hands it over (`setPendingReveal`), after the preview has drawn (a FOCUSED preview draws nothing new) and
 * before (a PLACED one has not drawn yet). jsdom has no layout and no Custom Highlight API, so which element
 * is scrolled to and which range is painted are recorded at their seams.
 */
import { screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialFold, setSection } from '@throng/core';
import {
  __resetFoldStateStore,
  documentFoldState,
  setDocumentFoldState,
} from '../../src/renderer/editor/fold-state-store.js';
import { setPendingReveal, takePendingReveal, type PreviewReveal } from '../../src/renderer/preview/preview-panel-handles.js';
import { COLD, README, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const painted = vi.hoisted(() => [] as { name: string; panelId: string; text: string[] }[]);
vi.mock('../../src/renderer/preview/highlight-registry.js', async (original) => {
  const real = await original<typeof import('../../src/renderer/preview/highlight-registry.js')>();
  return {
    ...real,
    setPanelRanges: (name: string, panelId: string, ranges: readonly Range[]) => {
      painted.push({ name, panelId, text: ranges.map((r) => r.toString()) });
      real.setPanelRanges(name, panelId, ranges);
    },
  };
});

const DOC = [
  '---', //                         0
  'secret: frontneedle', //         1
  '---', //                         2
  '# One', //                       3
  '', //                            4
  'first needle here', //           5
  '', //                            6
  '## Two', //                      7
  '', //                            8
  'a needle and **another needle**', // 9
  '', //                            10
  '```mermaid', //                  11
  'graph TD; needle', //            12
  '```', //                         13
].join('\n');

const offsetOf = (needle: string, nth = 0): number => {
  let at = -1;
  for (let i = 0; i <= nth; i += 1) at = DOC.indexOf(needle, at + 1);
  return at;
};

let m: MountedPreviewWindow | undefined;
let scrolled: Element[];
let fallback: ReturnType<typeof vi.fn>;

beforeEach(() => {
  painted.length = 0;
  scrolled = [];
  fallback = vi.fn();
  Element.prototype.scrollIntoView = vi.fn(function scroll(this: Element) {
    scrolled.push(this);
  });
});

afterEach(() => {
  m?.unmount();
  m = undefined;
  __resetFoldStateStore();
  takePendingReveal('p1');
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  document.body.replaceChildren();
});

async function mount(settings?: Record<string, unknown>): Promise<MountedPreviewWindow> {
  m = await mountMarkdownPreview(DOC, README, settings ? { settings } : {});
  await screen.findByText('first needle here', {}, COLD);
  return m;
}

function reveal(text: string, from: number, line: number): PreviewReveal {
  return { absPath: README, from, to: from + text.length, text, line, fallback };
}

const currentPaint = (): string[] =>
  painted.filter((p) => p.name === 'throng-preview-match-current' && p.panelId === m!.id).at(-1)?.text ?? [];

describe('a match the preview shows (FR-031)', () => {
  it('a reveal handed to a preview already showing the file scrolls its block into view and paints it', async () => {
    const { id } = await mount();
    act(() => setPendingReveal(id, reveal('needle', offsetOf('needle', 1), 5)));

    await waitFor(() => expect(currentPaint()).toEqual(['needle']));
    expect(scrolled.some((el) => el.textContent?.includes('first needle here'))).toBe(true);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('picks the right occurrence when the block holds several', async () => {
    const { id } = await mount();
    const from = offsetOf('needle', 3); // the one inside **another needle**
    act(() => setPendingReveal(id, reveal('needle', from, 9)));
    await waitFor(() => expect(currentPaint()).toEqual(['needle']));
    const range = painted.filter((p) => p.name === 'throng-preview-match-current').at(-1)!;
    expect(range.text).toEqual(['needle']);
    // The second occurrence in that paragraph is the one inside <strong>.
    const strong = screen.getByTestId(`preview-markdown-${id}`).querySelector('strong')!;
    expect(scrolled.some((el) => el.contains(strong) || el === strong.parentElement)).toBe(true);
  });

  it('a reveal handed over before the preview has drawn waits for the draw', async () => {
    setPendingReveal('p1', reveal('needle', offsetOf('needle', 1), 5));
    await mount();
    await waitFor(() => expect(currentPaint()).toEqual(['needle']));
    expect(fallback).not.toHaveBeenCalled();
  });

  it('a match inside a collapsed section unfolds it first', async () => {
    const { id } = await mount();
    act(() => setDocumentFoldState(`panel:${id}`, setSection(initialFold('expanded'), 'two', true), id));
    act(() => setPendingReveal(id, reveal('needle', offsetOf('needle', 2), 9)));
    await waitFor(() => expect(currentPaint()).toEqual(['needle']));
    await waitFor(() => expect(documentFoldState(`panel:${id}`, initialFold('expanded')).flipped).not.toContain('two'));
  });
});

describe('a match the preview cannot show opens the editor at it (FR-032)', () => {
  it('in front matter the preview hides', async () => {
    const { id } = await mount({ editor: { previews: { providers: { markdown: { showFrontMatter: false } } } } });
    act(() => setPendingReveal(id, reveal('frontneedle', offsetOf('frontneedle'), 1)));
    await waitFor(() => expect(fallback).toHaveBeenCalledTimes(1));
    expect(currentPaint()).toEqual([]);
  });

  it('inside a diagram', async () => {
    const { id } = await mount();
    act(() => setPendingReveal(id, reveal('needle', offsetOf('graph TD; needle') + 10, 12)));
    await waitFor(() => expect(fallback).toHaveBeenCalledTimes(1));
  });

  it('a reveal for another file is left for the preview that shows it', async () => {
    const { id } = await mount();
    act(() => setPendingReveal(id, { ...reveal('needle', 0, 0), absPath: 'D:/proj/other.md' }));
    await act(() => Promise.resolve());
    expect(fallback).not.toHaveBeenCalled();
    expect(currentPaint()).toEqual([]);
  });
});
