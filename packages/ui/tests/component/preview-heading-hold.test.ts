/**
 * 068 US1 (MT-01, defect against 044 FR-090b) — a `#heading` fragment lands the heading at the top of the body
 * even when content ABOVE it is still taking its size (an image that loads, a Mermaid block that draws).
 *
 * The maintainer's report, twice: "if a .md file contains elements that change the layout of the markdown
 * document AFTER its initial load (an embedded markdown file, a remote image URL etc), then the scroll to the
 * bookmark is too late, and the focus ends up in the wrong position" and then "its a little above it. Can you
 * load the document, wait for the inline elements to render, then navigate to the bookmark?". So:
 *
 * - a body that is NOT yet settled (an image still loading, an embed or diagram pending) is not scrolled yet:
 *   the jump waits for it (the wait is state — `bodySettled` — never a clock) and the history entry names the
 *   heading's own place meanwhile;
 * - once jumped, the heading is HELD at the top across every later size change — a late layout shift is exactly
 *   what lands the reader short — and the hold ends only on the reader: the wheel, a pointer on the scrollbar,
 *   a touch, a key, or a scroll nobody here wrote (scroll-sync's write is exactly that, and is not fought);
 * - the reader's input during the wait cancels the jump.
 *
 * Geometry is supplied as in `preview-follow.test.ts` (the host's viewport starts at y 100, 20px a source line),
 * plus `growth`: pixels the content from `GROWS_FROM` onward has gained.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';
import { COLD, README, mountMarkdownPreview, previewUpdate, type MountedPreview } from './helpers/mount-preview-panel.js';

const DOC = [
  '# Readme', //          0
  '', //                  1
  '[Here](#usage)', //    2
  '', //                  3
  '![pic](pic.png)', //   4
  '', //                  5
  '## Usage', //          6
  '', //                  7
  'Usage text.', //       8
].join('\n');

/** The first source line the growing content pushes down: everything after the image's own block. */
const GROWS_FROM = 5;

let m: MountedPreview | undefined;
let growth = 0;
let imageLoaded = false;
const observers: { cb: ResizeObserverCallback }[] = [];

class RecordingResizeObserver implements ResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    observers.push({ cb });
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Every observer the panel armed hears a size change, as the engine would deliver one. */
function resized(): void {
  for (const o of observers) o.cb([], {} as ResizeObserver);
}

const host = (): HTMLElement => screen.getByTestId(`preview-body-${m!.id}`);

/** The geometry of `preview-follow.test.ts`, with `growth` added to everything the image pushes down. */
function withGeometry(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
    const scroller = document.querySelector<HTMLElement>('.preview-panel__body');
    if (this === scroller) return { top: 100, height: 400, left: 0, width: 400 } as DOMRect;
    const line = Number(this.getAttribute('data-source-line'));
    const pushed = line >= GROWS_FROM ? growth : 0;
    return { top: 100 + line * 20 + pushed - (scroller?.scrollTop ?? 0), height: 40, left: 0, width: 400 } as DOMRect;
  });
}

/** Mount and Ctrl+click the link, with the image still loading: the body is NOT settled. */
async function mountAndFollow(): Promise<void> {
  m = await mountMarkdownPreview(DOC);
  await screen.findByText('Here', {}, COLD);
  m.preview.navigate.mockImplementation(() => new Promise(() => {}));
  fireEvent.click(screen.getByText('Here'), { ctrlKey: true });
}

/** The image finishes loading, taking `pixels` of height: the body is settled, and the waiting jump may go. */
function imageArrives(pixels: number): void {
  growth = pixels;
  imageLoaded = true;
  fireEvent.load(host().querySelector('img')!);
}

/** Follow, let the image arrive: the heading is jumped to and held. `## Usage` is on line 6, so 120 + the growth. */
async function followAndSettle(pixels = 300): Promise<number> {
  await mountAndFollow();
  imageArrives(pixels);
  await waitFor(() => expect(host().scrollTop).toBe(120 + pixels));
  return 120 + pixels;
}

beforeEach(() => {
  __resetPreviewStore();
  growth = 0;
  imageLoaded = false;
  observers.length = 0;
  globalThis.ResizeObserver = RecordingResizeObserver;
  // The image has a src and has not finished loading until a test says so.
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockImplementation(() => imageLoaded);
  withGeometry();
});

afterEach(() => {
  m?.unmount();
  m = undefined;
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, 'ResizeObserver');
  document.body.replaceChildren();
});

describe('an unsettled body is not scrolled until it has settled (068 US1, FR-090b)', () => {
  it('following the link scrolls nothing while the image is still loading', async () => {
    await mountAndFollow();

    expect(host().scrollTop).toBe(0);
  });

  it('the jump goes when the body settles, to the heading where it NOW is', async () => {
    await mountAndFollow();

    imageArrives(300); // the image's real height arrives, and with it the settled body

    await waitFor(() => expect(host().scrollTop).toBe(420)); // 120 + 300: the heading is at the top
  });

  it('a body that was already settled is jumped at once (the control for the three above)', async () => {
    m = await mountMarkdownPreview(DOC);
    await screen.findByText('Here', {}, COLD);
    imageLoaded = true;
    m.preview.navigate.mockImplementation(() => new Promise(() => {}));

    fireEvent.click(screen.getByText('Here'), { ctrlKey: true });

    expect(host().scrollTop).toBe(120);
  });

  it('the history entry names the heading’s own place while the jump waits, sent once', async () => {
    await mountAndFollow();

    await waitFor(() => expect(m!.preview.navigate).toHaveBeenCalledTimes(1));
    expect(m!.preview.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ target: { absPath: README, fragment: 'usage' }, arrivingViewState: { line: 6, offsetRatio: 0 } }),
    );
  });

  it('the reader taking over during the wait cancels the jump', async () => {
    await mountAndFollow();

    fireEvent.wheel(host());
    imageArrives(300);
    resized();

    expect(host().scrollTop).toBe(0);
  });
});

describe('the heading is held for as long as the reader has not scrolled (068 US1)', () => {
  it('content above it growing after the jump moves the scroll with it', async () => {
    const at = await followAndSettle();

    growth = 450; // a diagram above it draws, long after the body was "settled"
    resized();

    await waitFor(() => expect(host().scrollTop).toBe(at + 150));
  });

  it('every later growth is followed too', async () => {
    const at = await followAndSettle();
    growth = 450;
    resized();
    await waitFor(() => expect(host().scrollTop).toBe(at + 150));

    growth = 600;
    resized();

    await waitFor(() => expect(host().scrollTop).toBe(at + 300));
  });
});

describe('the reader’s own scroll ends the hold', () => {
  it.each([
    ['the wheel', (el: HTMLElement) => fireEvent.wheel(el)],
    ['a pointer on the scrollbar', (el: HTMLElement) => fireEvent.pointerDown(el)],
    ['a key', (el: HTMLElement) => fireEvent.keyDown(el, { key: 'PageDown' })],
    ['a touch', (el: HTMLElement) => fireEvent.touchStart(el)],
  ])('%s', async (_name, input) => {
    const at = await followAndSettle();
    growth = 450;
    resized();
    await waitFor(() => expect(host().scrollTop).toBe(at + 150)); // positive control: it was holding

    input(host());
    growth = 600;
    resized();

    expect(host().scrollTop).toBe(at + 150);
  });

  it('a scroll nobody here wrote (scroll-sync’s write, a dragged scrollbar) ends it, and is not fought', async () => {
    const at = await followAndSettle();
    growth = 450;
    resized();
    await waitFor(() => expect(host().scrollTop).toBe(at + 150));

    host().scrollTop = 40;
    fireEvent.scroll(host());
    growth = 600;
    resized();

    expect(host().scrollTop).toBe(40);
  });
});

describe('the hold writes no history (FR-115 stays one entry per jump)', () => {
  it('growth followed by the hold sends nothing more to main', async () => {
    const at = await followAndSettle();
    await waitFor(() => expect(m!.preview.navigate).toHaveBeenCalledTimes(1));

    growth = 450;
    resized();
    await waitFor(() => expect(host().scrollTop).toBe(at + 150));

    expect(m!.preview.navigate).toHaveBeenCalledTimes(1);
  });
});

/*
 * B17 — a REDRAW of the same file is not the end of the hold. A new file's first draw answers its embed reads
 * with an empty map, so the first read answer redraws the body (same file, same text) and `onDrawn` fires
 * again: the hold must survive it, or the Mermaid block that draws next pushes the heading down unheld. A live
 * edit (different text) is the reader's, and does end it.
 */
describe('a redraw of the same file keeps the hold (B17)', () => {
  /** Let the draw the change caused (and its own report to the panel) finish. */
  const drawn = (): Promise<void> => act(async () => new Promise<void>((done) => setTimeout(done, 100)));
  /** A setting the body draws with, flipped: the same text and file are drawn again, its nodes replaced. */
  const redraw = (): void => m!.setSettings({ editor: { previews: { providers: { markdown: { loadRemoteImages: false } } } } });

  it('the body redrawing after the jump, then content above growing: the heading is still held', async () => {
    await followAndSettle();
    act(() => redraw());
    await drawn();
    const placed = host().scrollTop;

    growth += 300;
    resized();

    await waitFor(() => expect(host().scrollTop).toBe(placed + 300));
  });

  it('a live edit (different text) ends the hold', async () => {
    await followAndSettle();
    act(() => m!.push(previewUpdate({ panelId: m!.id, filePath: README, revision: 2, content: { kind: 'text', text: `${DOC}\n\nMore.\n` } })));
    await screen.findByText('More.', {}, COLD); // positive control: the new text was drawn
    await drawn();
    const placed = host().scrollTop;

    growth += 300;
    resized();

    expect(host().scrollTop).toBe(placed);
  });
});
