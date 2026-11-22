/**
 * 074 FR-086b, FR-086d (R6d) — the preview's one find engine over a body whose content is a same-origin frame (an
 * HTML Preview's page): it searches the frame's text, paints each match through THAT document's highlight registry
 * with the `::highlight()` rules given to it, frames each match where it is on screen, and scrolls it into view.
 *
 * Layer: component — the real controller, painter and registry over a jsdom iframe; jsdom has no Custom Highlight
 * API and no layout, so the frame's window is given a recording registry and its ranges/boxes are stood in for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCssHighlightPainter,
  createDomFramePainter,
  createPreviewSearchController,
  type PreviewSearchController,
} from '../../src/renderer/preview/preview-search.js';
import { clearPanel } from '../../src/renderer/preview/highlight-registry.js';

class FakeHighlight {
  readonly ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

let host: HTMLDivElement;
let layer: HTMLDivElement;
let frame: HTMLIFrameElement;
let frameRegistry: Map<string, FakeHighlight>;
let panelRegistry: Map<string, FakeHighlight>;
let controller: PreviewSearchController;
/** The frame's own `scrollIntoView`: a frame is a realm of its own, with its own `Element.prototype`. */
let frameScroll: ReturnType<typeof vi.fn>;

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect;

beforeEach(() => {
  host = document.createElement('div');
  host.innerHTML = '<p>Outside the page</p>';
  frame = document.createElement('iframe');
  host.appendChild(frame);
  layer = document.createElement('div');
  host.appendChild(layer);
  document.body.appendChild(host);
  const doc = frame.contentDocument!;
  doc.body.innerHTML = '<style>.needle { color: red }</style><h1>A needle</h1><p>Another <b>needle</b> here.</p>';
  frameRegistry = new Map();
  panelRegistry = new Map();
  Object.assign(frame.contentWindow!, { CSS: { highlights: frameRegistry }, Highlight: FakeHighlight });
  vi.stubGlobal('CSS', { highlights: panelRegistry });
  vi.stubGlobal('Highlight', FakeHighlight);
  Element.prototype.scrollIntoView = vi.fn();
  frameScroll = vi.fn();
  (frame.contentWindow as unknown as { Element: typeof Element }).Element.prototype.scrollIntoView = frameScroll;
  controller = createPreviewSearchController({
    host: () => host,
    painter: createCssHighlightPainter('p1'),
    frames: createDomFramePainter(() => layer),
    requestFrame: (cb) => {
      cb();
      return 1;
    },
    cancelFrame: () => undefined,
  });
});

afterEach(() => {
  controller.close({ refocus: false });
  clearPanel('p1');
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('Find in a same-origin frame (FR-086b)', () => {
  it('counts the page’s matches, and never the text of its <style>', () => {
    expect(controller.setQuery('needle', { caseSensitive: false, wholeWord: false })).toEqual({ current: 1, total: 2 });
  });

  it('paints the matches in the frame’s own registry, not the panel’s', () => {
    controller.setQuery('needle', { caseSensitive: false, wholeWord: false });
    const painted = frameRegistry.get('throng-preview-match')?.ranges ?? [];
    expect(painted.map((r) => r.toString())).toEqual(['needle', 'needle']);
    expect(painted[0]!.startContainer.ownerDocument).toBe(frame.contentDocument);
    expect(frameRegistry.get('throng-preview-match-current')?.ranges.map((r) => r.toString())).toEqual(['needle']);
    expect(panelRegistry.has('throng-preview-match')).toBe(false);
  });

  it('steps Next / Previous, scrolling each match into view inside the frame', () => {
    controller.setQuery('needle', { caseSensitive: false, wholeWord: false });
    frameScroll.mockClear();
    expect(controller.findNext()).toEqual({ current: 2, total: 2 });
    const scrolled = frameScroll.mock.contexts as Element[];
    expect(scrolled.map((el) => el.tagName)).toEqual(['B']);
    expect(scrolled[0]!.ownerDocument).toBe(frame.contentDocument);
    expect(controller.findPrevious()).toEqual({ current: 1, total: 2 });
  });

  it('frames each match where the frame shows it, through the frame’s box and zoom (FR-074 parity)', () => {
    const FrameRange = frame.contentWindow!.Range as unknown as { prototype: Range };
    FrameRange.prototype.getClientRects = function (this: Range) {
      return [rect(10, 20, 30, 10)] as unknown as DOMRectList;
    };
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(rect(100, 50, 400, 300));
    Object.defineProperty(frame, 'offsetWidth', { value: 200 });
    Object.defineProperty(frame, 'clientWidth', { value: 200 });
    Object.defineProperty(frame, 'clientHeight', { value: 150 });
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 800, 600));
    vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 0, 0));
    controller.setQuery('needle', { caseSensitive: false, wholeWord: false });
    const frames = [...layer.children] as HTMLElement[];
    // Scale 2 (400 / 200): the rect at (10, 20) inside the frame is at (120, 90), 60 × 20, in the panel.
    expect(frames.map((f) => [f.style.left, f.style.top, f.style.width, f.style.height])).toEqual([
      ['120px', '90px', '60px', '20px'],
      ['120px', '90px', '60px', '20px'],
    ]);
    expect(frames[0]!.classList.contains('preview-match-frame--current')).toBe(true);
  });

  it('seeds the find input from a selection inside the frame', () => {
    const doc = frame.contentDocument!;
    const range = doc.createRange();
    range.selectNodeContents(doc.querySelector('b')!);
    doc.getSelection()!.removeAllRanges();
    doc.getSelection()!.addRange(range);
    expect(controller.seedFromSelection()).toBe('needle');
  });

  it('close clears the frame’s paint', () => {
    controller.setQuery('needle', { caseSensitive: false, wholeWord: false });
    controller.close({ refocus: false });
    expect(frameRegistry.has('throng-preview-match')).toBe(false);
    expect(frameRegistry.has('throng-preview-match-current')).toBe(false);
  });
});
