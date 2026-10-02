/**
 * 049 T056 — collapsing or expanding a section while find is open repaints the match outline frames over the text
 * as it now lies (FR-001, FR-002).
 *
 * The frames are DIVS, positioned from each match range's client rects when they were last painted. The
 * highlights themselves are ranges and follow their text; the frames do not. They were repainted on the body's
 * scroll and on a resize of the body's BOX — and folding a section changes the content's height without changing
 * the box, so the outlines stayed where the text used to be: over blank space, or over unrelated text.
 *
 * jsdom lays nothing out, so `Range.getClientRects` is replaced with a layout of its own: one 50px row per block
 * that is not inside a `[hidden]` section, in document order. Folding a section above a match moves its row up;
 * a match in a folded section has no rows at all — what Chromium reports for `display: none`.
 */
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initialFold, setSection, type FoldState } from '@throng/core';
import {
  __resetFoldStateStore,
  setDocumentFoldState,
} from '../../src/renderer/editor/fold-state-store.js';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';
import { __resetFindState, openFind, setTerm } from '../../src/renderer/search/search-store.js';
import { COLD, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

class FakeHighlight {
  readonly ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

const DOC = [
  '# Top',
  '',
  'top text',
  '',
  '## One',
  '',
  'one first',
  '',
  'one second',
  '',
  '## Two',
  '',
  'two needle',
  '',
  '## Three',
  '',
  'three needle',
].join('\n');

const BLOCKS = 'h1,h2,h3,p';
const ROW_PX = 50;

let m: MountedPreviewWindow | undefined;
let realGetClientRects: typeof Range.prototype.getClientRects | undefined;
let realElementRect: typeof Element.prototype.getBoundingClientRect | undefined;

/** The top, in px, of the row a block sits on in the fake layout — or null when it is hidden. */
function rowTop(block: Element, host: Element): number | null {
  if (block.closest('[hidden]')) return null;
  const visible = [...host.querySelectorAll(BLOCKS)].filter((b) => !b.closest('[hidden]'));
  const at = visible.indexOf(block);
  return at < 0 ? null : at * ROW_PX;
}

beforeEach(() => {
  __resetPreviewStore();
  Reflect.set(globalThis, 'CSS', { highlights: new Map() });
  Reflect.set(globalThis, 'Highlight', FakeHighlight);
  realGetClientRects = Range.prototype.getClientRects;
  realElementRect = Element.prototype.getBoundingClientRect;
  // The body's viewport: tall enough that no fake row is scrolled out of it.
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const tall = (this.getAttribute('data-testid') ?? '').startsWith('preview-body-');
    const right = tall ? 800 : 0;
    const bottom = tall ? 4000 : 0;
    return { x: 0, y: 0, left: 0, top: 0, right, bottom, width: right, height: bottom, toJSON: () => ({}) } as DOMRect;
  };
  Range.prototype.getClientRects = function (this: Range): DOMRectList {
    const node = this.startContainer;
    const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
    const host = element?.closest('[data-testid^="preview-body-"]');
    const block = element?.closest(BLOCKS);
    const top = block && host ? rowTop(block, host) : null;
    const rects = top === null ? [] : [{ left: 0, right: 100, top, bottom: top + 20, width: 100, height: 20 }];
    return Object.assign(rects, { item: (i: number) => rects[i] ?? null }) as unknown as DOMRectList;
  };
});

afterEach(() => {
  m?.unmount();
  m = undefined;
  if (realGetClientRects) Range.prototype.getClientRects = realGetClientRects;
  if (realElementRect) Element.prototype.getBoundingClientRect = realElementRect;
  __resetFoldStateStore();
  __resetFindState();
  Reflect.deleteProperty(globalThis, 'CSS');
  Reflect.deleteProperty(globalThis, 'Highlight');
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

const collapse = (...slugs: string[]): FoldState =>
  slugs.reduce((state, slug) => setSection(state, slug, true), initialFold('expanded'));

/** The frames on screen, as the px tops they were drawn at relative to the (0-origin) frame layer. */
const frameTops = (): number[] =>
  [...document.querySelectorAll<HTMLElement>('.preview-match-frame')].map((f) => parseFloat(f.style.top));

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

describe('the match frames follow the text when a section is folded or unfolded while find is open', () => {
  it('moves a frame up when a section ABOVE its match is collapsed, and back when it is expanded', async () => {
    m = await mountMarkdownPreview(DOC);
    await screen.findByText('two needle', {}, COLD);
    act(() => {
      openFind(m!.id, 'preview');
      setTerm(m!.id, 'needle');
    });
    await nextFrame();
    // Blocks above "two needle": Top, top text, One, one first, one second, Two — row 6 of the fake layout;
    // "three needle" is row 8.
    await waitFor(() => expect(frameTops()).toEqual([6 * ROW_PX, 8 * ROW_PX]));

    // Fold "One" away: its two blocks leave the layout, so the match moves up two rows.
    act(() => setDocumentFoldState(`panel:${m!.id}`, collapse('one')));
    await waitFor(() => expect(screen.getByText('one first')).not.toBeVisible());
    await waitFor(() => expect(frameTops()).toEqual([4 * ROW_PX, 6 * ROW_PX]));

    // Unfold it: back where it was.
    act(() => setDocumentFoldState(`panel:${m!.id}`, initialFold('expanded')));
    await waitFor(() => expect(screen.getByText('one first')).toBeVisible());
    await waitFor(() => expect(frameTops()).toEqual([6 * ROW_PX, 8 * ROW_PX]));
  });

  it('drops the frame of a match whose own section is collapsed', async () => {
    m = await mountMarkdownPreview(DOC);
    await screen.findByText('two needle', {}, COLD);
    act(() => {
      openFind(m!.id, 'preview');
      setTerm(m!.id, 'needle');
    });
    await nextFrame();
    await waitFor(() => expect(frameTops()).toHaveLength(2));

    act(() => setDocumentFoldState(`panel:${m!.id}`, collapse('three')));
    await waitFor(() => expect(screen.getByText('three needle')).not.toBeVisible());
    await waitFor(() => expect(frameTops()).toHaveLength(1));
  });
});
