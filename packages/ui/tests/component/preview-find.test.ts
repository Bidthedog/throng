/**
 * 047 T024 — Find in a preview (US1, research.md R1, contracts/menus-commands-controls.md).
 *
 * Two layers:
 *
 *   1. `createPreviewSearchController` directly, over a detached real DOM subtree with a RECORDING
 *      `HighlightPainter` — proves the controller's own contract (paint calls, current index,
 *      wrap-around, reveal-before-scroll, nearest-match preservation on refresh) without depending on
 *      the CSS Custom Highlight API jsdom does not have.
 *   2. The controller MOUNTED on a real preview panel (`mountMarkdownPreview` + `SearchKeybindings` +
 *      the panel's own `<FindBar>`, T025) — proves the wiring: Ctrl+F opens the bar focused on this
 *      panel, no replace row, the store's count reflects what the controller found, closing clears.
 *
 * `scrollIntoView` is spied rather than asserted on positions: jsdom has no layout, so every rect it
 * would report is zero (`scroll-anchor.test.ts`'s precedent) — the call itself is what proves "scroll
 * the current into view" happened.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDomFramePainter,
  createPreviewSearchController,
  type FramePainter,
  type HighlightPainter,
  type MatchFrame,
  type PreviewSearchController,
} from '../../src/renderer/preview/preview-search.js';
import { SearchKeybindings } from '../../src/renderer/search/search-keybindings.js';
import { unregisterPanelSearch } from '../../src/renderer/search/search-controller.js';
import { __resetFindState, closeFind, findShowingFor, getFindState } from '../../src/renderer/search/search-store.js';
import { COLD, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

/** A recording double for {@link HighlightPainter} (R1) — every call, in order. */
function recordingPainter(): HighlightPainter & { calls: { texts: string[]; current: number }[] } {
  const calls: { texts: string[]; current: number }[] = [];
  return {
    calls,
    paint(ranges, current) {
      calls.push({ texts: ranges.map((r) => r.toString()), current });
    },
    clear() {
      calls.push({ texts: [], current: -1 });
    },
  };
}

function buildHost(html: string): HTMLDivElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

describe('createPreviewSearchController — the controller itself', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  function controllerOver(html: string): { host: HTMLDivElement; controller: PreviewSearchController; painter: ReturnType<typeof recordingPainter> } {
    const host = buildHost(html);
    const painter = recordingPainter();
    const controller = createPreviewSearchController({ host: () => host, painter });
    return { host, controller, painter };
  }

  it('setQuery paints every match with the first one current (FR-001, FR-003)', () => {
    const { controller, painter } = controllerOver('<p>foo bar foo baz foo</p>');
    const count = controller.setQuery('foo', { caseSensitive: false, wholeWord: false });
    expect(count).toEqual({ current: 1, total: 3 });
    const last = painter.calls.at(-1)!;
    expect(last.texts).toEqual(['foo', 'foo', 'foo']);
    expect(last.current).toBe(0);
  });

  it('an empty term paints nothing and reports no results', () => {
    const { controller, painter } = controllerOver('<p>foo bar</p>');
    const count = controller.setQuery('', { caseSensitive: false, wholeWord: false });
    expect(count).toEqual({ current: 0, total: 0 });
    expect(painter.calls.at(-1)!.texts).toEqual([]);
  });

  it('findNext / findPrevious wrap at both ends', () => {
    const { controller } = controllerOver('<p>a a a</p>');
    controller.setQuery('a', { caseSensitive: false, wholeWord: false });
    expect(controller.findNext()).toEqual({ current: 2, total: 3 });
    expect(controller.findNext()).toEqual({ current: 3, total: 3 });
    expect(controller.findNext()).toEqual({ current: 1, total: 3 }); // wraps forward
    expect(controller.findPrevious()).toEqual({ current: 3, total: 3 }); // wraps backward
  });

  it('scrolls the current match into view on every step (Element.scrollIntoView)', () => {
    const { controller, host } = controllerOver('<p>alpha beta alpha</p>');
    const spy = vi.spyOn(host.firstElementChild! as HTMLElement, 'scrollIntoView').mockImplementation(() => {});
    // The match is a bare text node under <p>; scrollIntoView is called on its parent element.
    controller.setQuery('alpha', { caseSensitive: false, wholeWord: false });
    expect(spy).toHaveBeenCalledWith({ block: 'center' });
    spy.mockClear();
    controller.findNext();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('reveals the section containing the current match BEFORE scrolling (FR-040)', () => {
    const host = buildHost('<div class="section"><p>needle in a haystack</p></div>');
    const painter = recordingPainter();
    const revealed: Node[] = [];
    const controller = createPreviewSearchController({
      host: () => host,
      painter,
      revealBeforeScroll: (node) => revealed.push(node),
    });
    controller.setQuery('needle', { caseSensitive: false, wholeWord: false });
    expect(revealed).toHaveLength(1);
    expect(revealed[0]!.textContent).toBe('needle in a haystack');
  });

  it('refresh keeps the current match nearest to its OLD text offset, not its old index (FR-005)', () => {
    const host = buildHost('<p>xx needle yy</p>');
    const painter = recordingPainter();
    const controller = createPreviewSearchController({ host: () => host, painter });
    controller.setQuery('needle', { caseSensitive: false, wholeWord: false });
    // The document re-renders with a match INSERTED before the one the reader was on.
    host.innerHTML = '<p>needle at the start, xx needle yy</p>';
    const count = controller.refresh();
    expect(count).toEqual({ current: 2, total: 2 }); // the SECOND occurrence — nearest the old offset
  });

  it('refresh is a no-op with no active query', () => {
    const { controller, painter } = controllerOver('<p>anything</p>');
    expect(controller.refresh()).toEqual({ current: 0, total: 0 });
    expect(painter.calls).toHaveLength(0);
  });

  it('close clears the painter and hands focus back to the body', () => {
    const { controller, host, painter } = controllerOver('<p>foo</p>');
    controller.setQuery('foo', { caseSensitive: false, wholeWord: false });
    const focusSpy = vi.spyOn(host, 'focus');
    controller.close();
    expect(painter.calls.at(-1)).toEqual({ texts: [], current: -1 });
    expect(focusSpy).toHaveBeenCalled();
  });

  it('close({ refocus: false }) does not pull focus back', () => {
    const { controller, host } = controllerOver('<p>foo</p>');
    const focusSpy = vi.spyOn(host, 'focus');
    controller.close({ refocus: false });
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it('seedFromSelection reads a non-empty selection made inside the host, and only inside it', () => {
    const host = buildHost('<p id="p1">select me</p>');
    const outside = document.createElement('p');
    outside.textContent = 'not in the host';
    document.body.appendChild(outside);
    const controller = createPreviewSearchController({ host: () => host, painter: recordingPainter() });

    // No selection at all.
    expect(controller.seedFromSelection()).toBe('');

    // A selection inside the host.
    const range = document.createRange();
    range.selectNodeContents(host.querySelector('p')!);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(controller.seedFromSelection()).toBe('select me');

    // A selection OUTSIDE the host must not seed it.
    const outsideRange = document.createRange();
    outsideRange.selectNodeContents(outside);
    sel.removeAllRanges();
    sel.addRange(outsideRange);
    expect(controller.seedFromSelection()).toBe('');
  });
});

const README_TEXT = '# Title\n\nfoo bar foo baz foo\n';

let m: MountedPreviewWindow | undefined;

afterEach(() => {
  m?.unmount();
  if (m) unregisterPanelSearch(m.id);
  m = undefined;
  __resetFindState();
});

async function mountPreviewWithFind(): Promise<MountedPreviewWindow> {
  m = await mountMarkdownPreview(README_TEXT, undefined, {
    extras: [createElement(SearchKeybindings, { key: 'search-kb' })],
  });
  await screen.findByTestId(`preview-markdown-${m.id}`, {}, COLD);
  return m;
}

const press = (user: ReturnType<typeof userEvent.setup>, key: string): Promise<void> =>
  user.keyboard(`{Control>}${key}{/Control}`);

describe('Find mounted on a preview panel (T025)', () => {
  it('Ctrl+F opens the bar on a focused preview, with focus in the query (FR-007)', async () => {
    const mounted = await mountPreviewWithFind();
    const user = userEvent.setup();
    expect(screen.queryByTestId(`find-bar-${mounted.id}`)).toBeNull();

    await press(user, 'f');

    await waitFor(() => expect(screen.getByTestId(`find-bar-${mounted.id}`)).toBeVisible());
    expect(screen.getByTestId('find-input')).toHaveFocus();
    // A preview's find is read-only: no replace disclosure, no replace row (find-bar.tsx `isEditor`).
    expect(screen.queryByTestId('find-toggle-replace')).toBeNull();
    expect(screen.queryByTestId('find-replace-row')).toBeNull();
  });

  it('typing paints matches and shows the editor bar\'s N of M count format', async () => {
    const mounted = await mountPreviewWithFind();
    const user = userEvent.setup();
    await press(user, 'f');
    await waitFor(() => expect(screen.getByTestId(`find-bar-${mounted.id}`)).toBeVisible());

    await user.type(screen.getByTestId('find-input'), 'foo');

    await waitFor(() => expect(screen.getByTestId('find-count')).toHaveTextContent('1 of 3'));
  });

  it('find next/previous step and wrap through the store', async () => {
    const mounted = await mountPreviewWithFind();
    const user = userEvent.setup();
    await press(user, 'f');
    await waitFor(() => expect(screen.getByTestId(`find-bar-${mounted.id}`)).toBeVisible());
    await user.type(screen.getByTestId('find-input'), 'foo');
    await waitFor(() => expect(screen.getByTestId('find-count')).toHaveTextContent('1 of 3'));

    await user.click(screen.getByTestId('find-next'));
    await waitFor(() => expect(screen.getByTestId('find-count')).toHaveTextContent('2 of 3'));
    await user.click(screen.getByTestId('find-previous'));
    await waitFor(() => expect(screen.getByTestId('find-count')).toHaveTextContent('1 of 3'));
  });

  it('re-render re-runs the active query from the body\'s onDrawn (FR-005)', async () => {
    const mounted = await mountPreviewWithFind();
    const user = userEvent.setup();
    await press(user, 'f');
    await waitFor(() => expect(screen.getByTestId(`find-bar-${mounted.id}`)).toBeVisible());
    await user.type(screen.getByTestId('find-input'), 'foo');
    await waitFor(() => expect(screen.getByTestId('find-count')).toHaveTextContent('1 of 3'));

    // A live update — the body redraws under this session's feet — must not lose the search.
    act(() => {
      mounted.push({
        panelId: mounted.id,
        filePath: 'D:/proj/README.md',
        providerId: 'markdown',
        content: { kind: 'text', text: '# Title\n\nfoo bar foo baz foo\n' },
        dirty: false,
        parent: null,
        notice: null,
        navigationSeq: 0,
        revision: 2,
      });
    });

    await waitFor(() => expect(screen.getByTestId('find-count')).toHaveTextContent('1 of 3'));
  });

  it('closing clears the session and hides the bar', async () => {
    const mounted = await mountPreviewWithFind();
    const user = userEvent.setup();
    await press(user, 'f');
    await waitFor(() => expect(screen.getByTestId(`find-bar-${mounted.id}`)).toBeVisible());
    await user.type(screen.getByTestId('find-input'), 'foo');
    await waitFor(() => expect(screen.getByTestId('find-count')).toHaveTextContent('1 of 3'));

    act(() => closeFind(mounted.id));

    expect(screen.queryByTestId(`find-bar-${mounted.id}`)).toBeNull();
    expect(findShowingFor()).toBeNull();
    expect(getFindState().panelId).toBeNull();
  });
});

/*
 * Reported in review (MT-02, 2026-09-28): "if a preview is opened in an active preview, it should close
 * that preview's find dialog if it is open and clear the search text." A Last Active open reaches the
 * panel as a NAVIGATION onto another file (main's `moveRun`: new path, `navigationSeq` raised); a live
 * update of the same file is not one, and keeps the search (FR-005, the case above).
 */
describe('a preview navigated onto ANOTHER file closes its find bar (MT-02)', () => {
  it('closes the bar, and re-opening it starts with an empty query', async () => {
    const mounted = await mountPreviewWithFind();
    const user = userEvent.setup();
    await press(user, 'f');
    await waitFor(() => expect(screen.getByTestId(`find-bar-${mounted.id}`)).toBeVisible());
    await user.type(screen.getByTestId('find-input'), 'foo');
    await waitFor(() => expect(screen.getByTestId('find-count')).toHaveTextContent('1 of 3'));

    mounted.push({
      panelId: mounted.id,
      filePath: 'D:/proj/OTHER.md',
      providerId: 'markdown',
      content: { kind: 'text', text: '# Other\n\nfoo here too\n' },
      dirty: false,
      parent: null,
      notice: null,
      navigationSeq: 1,
      revision: 2,
    });
    await screen.findByText('foo here too');

    await waitFor(() => expect(screen.queryByTestId(`find-bar-${mounted.id}`)).toBeNull());
    await press(user, 'f');
    await waitFor(() => expect(screen.getByTestId(`find-bar-${mounted.id}`)).toBeVisible());
    expect(screen.getByTestId('find-input')).toHaveValue('');
  });
});

/**
 * T028 — the preview body menu AND header menu each offer Find…, with its chord
 * (contracts/menus-commands-controls.md "Preview body menu" / "Preview header menu").
 */
describe('Find… on the preview\'s menus (T028)', () => {
  it('the body menu offers Find… with the search.find chord, and opens the bar', async () => {
    const mounted = await mountMarkdownPreview(README_TEXT);
    try {
      const body = await screen.findByTestId(`preview-body-${mounted.id}`, {}, COLD);
      fireEvent.contextMenu(body, { clientX: 10, clientY: 10 });

      const item = await screen.findByTestId('menu-item-Find…');
      expect(item).toHaveTextContent('Ctrl+F');

      fireEvent.click(item);
      await waitFor(() => expect(screen.getByTestId(`find-bar-${mounted.id}`)).toBeVisible());
    } finally {
      mounted.unmount();
    }
  });

  it('the header menu offers Find… beside Back/Forward, with the same chord', async () => {
    const mounted = await mountMarkdownPreview(README_TEXT);
    try {
      await screen.findByTestId(`preview-body-${mounted.id}`, {}, COLD);
      fireEvent.contextMenu(screen.getByTestId(`panel-handle-${mounted.id}`), { clientX: 10, clientY: 10 });

      const item = await screen.findByTestId('menu-item-Find…');
      expect(item).toHaveTextContent('Ctrl+F');

      fireEvent.click(item);
      await waitFor(() => expect(screen.getByTestId(`find-bar-${mounted.id}`)).toBeVisible());
    } finally {
      mounted.unmount();
    }
  });
});

/*
 * ── 047 FR-074 (T078, research R16) — the match-frame layer ───────────────────────────────────────
 *
 * `::highlight()` accepts no `outline`, so a preview's matches are framed by a layer of their own: one 1px
 * frame per client rect of each match range INSIDE the body's viewport, the current match's in its own colour.
 * The controller computes the frames and hands them to a `FramePainter` (the seam, as `HighlightPainter` is for
 * the fill); repaints on scroll, resize and redraw go through ONE requestAnimationFrame.
 *
 * jsdom has no layout: `Range.getClientRects` does not exist, and every element rect is zero. The tests install
 * a geometry that keys on the range's text, so a frame's position proves WHICH range it was drawn for.
 */
describe('the match-frame layer (FR-074, R16)', () => {
  const NONE = { caseSensitive: false, wholeWord: false };
  const rect = (left: number, top: number, width = 20, height = 10): DOMRect =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

  /** Rects per range, by the range's text and its ordinal among ranges of that text. */
  let geometry: Map<string, DOMRect[][]>;
  let viewport: DOMRect;
  let rangeProto: { getClientRects?: () => unknown };
  let hadGetClientRects: boolean;
  let originalGetClientRects: unknown;
  const seen = new WeakMap<Range, number>();
  let counters: Map<string, number>;

  beforeEach(() => {
    geometry = new Map();
    counters = new Map();
    viewport = rect(0, 0, 400, 300);
    rangeProto = Range.prototype as unknown as { getClientRects?: () => unknown };
    hadGetClientRects = 'getClientRects' in rangeProto;
    originalGetClientRects = rangeProto.getClientRects;
    rangeProto.getClientRects = function (this: Range) {
      const text = this.toString();
      let ordinal = seen.get(this);
      if (ordinal === undefined) {
        ordinal = counters.get(text) ?? 0;
        counters.set(text, ordinal + 1);
        seen.set(this, ordinal);
      }
      return geometry.get(text)?.[ordinal] ?? [];
    };
  });
  afterEach(() => {
    if (hadGetClientRects) rangeProto.getClientRects = originalGetClientRects as () => unknown;
    else delete rangeProto.getClientRects;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  function recordingFrames(): FramePainter & { paints: MatchFrame[][]; clears: number } {
    const rec = {
      paints: [] as MatchFrame[][],
      clears: 0,
      paint(frames: MatchFrame[]) {
        rec.paints.push(frames);
      },
      clear() {
        rec.clears += 1;
      },
    };
    return rec;
  }

  function over(html: string, opts: { requestFrame?: (cb: () => void) => number; cancelFrame?: (h: number) => void } = {}) {
    const host = buildHost(html);
    vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => viewport);
    const frames = recordingFrames();
    const controller = createPreviewSearchController({
      host: () => host,
      painter: recordingPainter(),
      frames,
      ...opts,
    });
    return { host, frames, controller };
  }

  it('frames each match, the current one flagged — one frame per client rect (a wrapped match has two)', () => {
    const { controller, frames } = over('<p>foo bar foo baz foo</p>');
    // ranges are created in match order: first foo (one rect), second foo wraps (two rects), third one rect.
    geometry.set('foo', [[rect(10, 20)], [rect(100, 20), rect(0, 40, 15)], [rect(200, 60)]]);

    controller.setQuery('foo', NONE);

    expect(frames.paints.at(-1)).toEqual([
      { left: 10, top: 20, width: 20, height: 10, current: true },
      { left: 100, top: 20, width: 20, height: 10, current: false },
      { left: 0, top: 40, width: 15, height: 10, current: false },
      { left: 200, top: 60, width: 20, height: 10, current: false },
    ]);
  });

  it('findNext moves the current flag to the next match’s frame', () => {
    const { controller, frames } = over('<p>foo bar foo</p>');
    geometry.set('foo', [[rect(10, 20)], [rect(100, 20)]]);
    controller.setQuery('foo', NONE);

    // Ranges are rebuilt on every paint, so the geometry is keyed by ordinal again from zero.
    counters.clear();
    controller.findNext();

    expect(frames.paints.at(-1)!.map((f) => [f.left, f.current])).toEqual([
      [10, false],
      [100, true],
    ]);
  });

  it('frames the matches in a band around the body’s viewport (three viewports each way), not the whole document', () => {
    const { controller, frames } = over('<p>foo foo foo foo foo</p>');
    geometry.set('foo', [
      [rect(10, 20)], // inside
      [rect(10, 400)], // below, within the band (viewport is 300 tall: band reaches 300 + 900)
      [rect(10, -500)], // above, within the band
      [rect(10, 5000)], // far below: outside the band
      [rect(2000, 20)], // far right: outside the band
    ]);

    controller.setQuery('foo', NONE);

    expect(frames.paints.at(-1)!.map((f) => f.top)).toEqual([20, 400, -500]);
  });

  describe('scrolling (049 FR-029)', () => {
    function scroller(host: HTMLElement, state: { top: number }): void {
      Object.defineProperty(host, 'scrollTop', { configurable: true, get: () => state.top });
      Object.defineProperty(host, 'scrollLeft', { configurable: true, get: () => 0 });
      Object.defineProperty(host, 'clientHeight', { configurable: true, get: () => 300 });
      Object.defineProperty(host, 'clientWidth', { configurable: true, get: () => 400 });
    }

    it('a scroll inside the painted band measures nothing and requests no frame', () => {
      const queued: (() => void)[] = [];
      const { controller, host } = over('<p>foo</p>', { requestFrame: (cb) => queued.push(cb), cancelFrame: () => {} });
      const state = { top: 0 };
      scroller(host, state);
      geometry.set('foo', [[rect(10, 20)]]);
      controller.setQuery('foo', NONE);
      const measured = counters.get('foo') ?? 0;

      state.top = 600; // the band reaches 900 below the viewport's top
      controller.scrolled();
      state.top = 900;
      controller.scrolled();

      expect(queued).toEqual([]);
      expect(counters.get('foo') ?? 0).toBe(measured);
    });

    it('a scroll that leaves the band repaints once, around where the viewport is now', () => {
      const queued: (() => void)[] = [];
      const { controller, host, frames } = over('<p>foo</p>', { requestFrame: (cb) => queued.push(cb), cancelFrame: () => {} });
      const state = { top: 0 };
      scroller(host, state);
      geometry.set('foo', [[rect(10, 20)]]);
      controller.setQuery('foo', NONE);
      const paints = frames.paints.length;

      state.top = 1500; // the viewport's bottom (1800) is beyond the band's (1200)
      controller.scrolled();
      controller.scrolled();
      expect(queued).toHaveLength(1);

      queued[0]!();
      expect(frames.paints).toHaveLength(paints + 1);
    });
  });

  it('a match with no client rects (a collapsed section is display:none) has no frame, and the rest still do', () => {
    const { controller, frames } = over('<p>foo foo</p>');
    geometry.set('foo', [[], [rect(50, 50)]]);
    controller.setQuery('foo', NONE);
    expect(frames.paints.at(-1)).toEqual([{ left: 50, top: 50, width: 20, height: 10, current: false }]);
  });

  it('an empty query paints no frames', () => {
    const { controller, frames } = over('<p>foo</p>');
    geometry.set('foo', [[rect(10, 20)]]);
    controller.setQuery('', NONE);
    expect(frames.paints.at(-1)).toEqual([]);
  });

  it('repaintFrames coalesces to ONE requestAnimationFrame and re-reads the geometry when it runs', () => {
    const queued: (() => void)[] = [];
    const { controller, frames } = over('<p>foo</p>', {
      requestFrame: (cb) => queued.push(cb),
      cancelFrame: () => {},
    });
    geometry.set('foo', [[rect(10, 20)]]);
    controller.setQuery('foo', NONE);
    const paintsAfterQuery = frames.paints.length;

    // The body scrolls, the panel resizes, a redraw lands: three triggers, one frame.
    controller.repaintFrames();
    controller.repaintFrames();
    controller.repaintFrames();
    expect(queued).toHaveLength(1);
    expect(frames.paints).toHaveLength(paintsAfterQuery);

    // The match moved by the time the frame runs — the frame paints where it is NOW.
    counters.clear();
    geometry.set('foo', [[rect(10, 70)]]);
    queued[0]!();

    expect(frames.paints).toHaveLength(paintsAfterQuery + 1);
    expect(frames.paints.at(-1)).toEqual([{ left: 10, top: 70, width: 20, height: 10, current: true }]);
    // …and the next trigger may ask for a new frame.
    controller.repaintFrames();
    expect(queued).toHaveLength(2);
  });

  it('repaintFrames with no active query paints nothing and requests no frame', () => {
    const queued: (() => void)[] = [];
    const { controller, frames } = over('<p>foo</p>', { requestFrame: (cb) => queued.push(cb), cancelFrame: () => {} });
    controller.repaintFrames();
    expect(queued).toEqual([]);
    expect(frames.paints).toEqual([]);
  });

  it('refresh (a redraw) repaints the frames', () => {
    const { controller, frames, host } = over('<p>xx needle yy</p>');
    geometry.set('needle', [[rect(10, 20)]]);
    controller.setQuery('needle', NONE);
    const before = frames.paints.length;

    host.innerHTML = '<p>needle at the start, xx needle yy</p>';
    counters.clear();
    geometry.set('needle', [[rect(10, 20)], [rect(90, 20)]]);
    controller.refresh();

    expect(frames.paints.length).toBeGreaterThan(before);
    expect(frames.paints.at(-1)!.map((f) => [f.left, f.current])).toEqual([
      [10, false],
      [90, true],
    ]);
  });

  it('close clears the frames and cancels a frame already requested', () => {
    const cancelled: number[] = [];
    const { controller, frames } = over('<p>foo</p>', { requestFrame: () => 7, cancelFrame: (h) => cancelled.push(h) });
    geometry.set('foo', [[rect(10, 20)]]);
    controller.setQuery('foo', NONE);
    controller.repaintFrames();

    controller.close({ refocus: false });

    expect(frames.clears).toBe(1);
    expect(cancelled).toEqual([7]);
  });

  describe('the DOM painter (createDomFramePainter)', () => {
    it('draws one aria-hidden-layer child per frame, positioned relative to the layer, the current one marked', () => {
      const layer = document.createElement('div');
      layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(layer);
      vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue(rect(5, 7, 400, 300));
      const painter = createDomFramePainter(() => layer);

      painter.paint([
        { left: 15, top: 27, width: 20, height: 10, current: true },
        { left: 105, top: 27, width: 30, height: 10, current: false },
      ]);

      const kids = [...layer.children] as HTMLElement[];
      expect(kids).toHaveLength(2);
      expect(kids.map((k) => [k.style.left, k.style.top, k.style.width, k.style.height])).toEqual([
        ['10px', '20px', '20px', '10px'],
        ['100px', '20px', '30px', '10px'],
      ]);
      expect(kids[0]!.classList.contains('preview-match-frame--current')).toBe(true);
      expect(kids[1]!.classList.contains('preview-match-frame--current')).toBe(false);
      expect(kids.every((k) => k.classList.contains('preview-match-frame'))).toBe(true);

      // A repaint REPLACES the frames — none linger from the last paint.
      painter.paint([{ left: 5, top: 7, width: 1, height: 1, current: false }]);
      expect(layer.children).toHaveLength(1);
      painter.clear();
      expect(layer.children).toHaveLength(0);
    });

    it('sets no clip-path: the layer is inside the scroller, so the scroller clips frames under the header and bars', () => {
      const layer = document.createElement('div');
      document.body.appendChild(layer);
      vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue(rect(5, 7, 400, 300));
      const painter = createDomFramePainter(() => layer);
      painter.paint([{ left: 15, top: 27, width: 20, height: 10, current: false }]);
      expect(layer.style.clipPath).toBe('');
    });

    it('does nothing while the layer is not mounted', () => {
      const painter = createDomFramePainter(() => null);
      expect(() => painter.paint([{ left: 0, top: 0, width: 1, height: 1, current: false }])).not.toThrow();
      expect(() => painter.clear()).not.toThrow();
    });
  });
});

describe('the match-frame layer on a mounted preview panel (FR-074, R16)', () => {
  it('sits OUTSIDE the sanitised body, aria-hidden, and frames the matches once a query runs', async () => {
    const rangeProto = Range.prototype as unknown as { getClientRects?: () => unknown };
    const had = 'getClientRects' in rangeProto;
    const original = rangeProto.getClientRects;
    rangeProto.getClientRects = () => [{ left: 30, top: 40, width: 25, height: 12, right: 55, bottom: 52, x: 30, y: 40 }];
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    try {
      const mounted = await mountPreviewWithFind();
      const user = userEvent.setup();
      const layer = screen.getByTestId(`preview-match-frames-${mounted.id}`);
      const body = screen.getByTestId(`preview-body-${mounted.id}`);

      expect(layer.getAttribute('aria-hidden')).toBe('true');
      // 049 FR-029 — inside the scroller, so frames scroll with their text; not inside what the sanitiser
      // produced, copy reads, or find's text model walks (the rendered content is its own element).
      expect(layer.parentElement).toBe(body);
      expect(body.querySelector('.preview-markdown')?.contains(layer)).toBe(false);
      expect(layer.children).toHaveLength(0);

      await press(user, 'f');
      await waitFor(() => expect(screen.getByTestId(`find-bar-${mounted.id}`)).toBeVisible());
      await user.type(screen.getByTestId('find-input'), 'foo');

      await waitFor(() => expect(layer.querySelectorAll('.preview-match-frame')).toHaveLength(3));
      expect(layer.querySelectorAll('.preview-match-frame--current')).toHaveLength(1);
      // …and it never entered the body's own text, so the count is still the body's three matches.
      expect(screen.getByTestId('find-count')).toHaveTextContent('1 of 3');

      // 049 FR-029 — a scroll of the body re-measures nothing and re-positions nothing.
      const measure = rangeProto.getClientRects as () => unknown;
      let measured = 0;
      rangeProto.getClientRects = () => {
        measured += 1;
        return measure();
      };
      const kids = [...layer.children];
      act(() => {
        body.dispatchEvent(new Event('scroll'));
      });
      await new Promise((r) => setTimeout(r, 60)); // longer than a requestAnimationFrame
      expect(measured).toBe(0);
      expect([...layer.children]).toEqual(kids);
      rangeProto.getClientRects = measure as () => unknown;

      act(() => closeFind(mounted.id));
      await waitFor(() => expect(layer.children).toHaveLength(0));
    } finally {
      bounds.mockRestore();
      if (had) rangeProto.getClientRects = original as () => unknown;
      else delete rangeProto.getClientRects;
    }
  });
});
