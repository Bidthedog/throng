/**
 * 054 MT-04 B5 — what a panel resize costs a Markdown preview that holds a Mermaid diagram.
 *
 * The report: resizing panels is laggy when the document has a diagram, horizontally most of all. This pins
 * the WORK done per resize notification — not the milliseconds, which are the maintainer's machine's — so
 * the claim is checkable here: a drag fires a notification per frame, and each one should cost the diagram
 * (almost) nothing, as the document's tables already do (`TABLE_RESIZE_DEBOUNCE_MS`).
 *
 * Layer: component — jsdom lays nothing out, but the cost is countable without layout: every notification
 * that changes the box width makes the frame rewrite its layer's `transform` and its viewport's `height`,
 * and each such write is a style recalculation, a layout and a repaint of the whole SVG in a real engine.
 * The widths are stubbed and ResizeObserver is a recorder that the test fires by hand.
 *
 * Two controls come with it, because a cause is a hypothesis until the alternatives are ruled out:
 * mermaid is NOT run again and the SVG is NOT cloned again on a resize (both pass today).
 */
import { act, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownBody } from '../../src/renderer/preview/providers/markdown/markdown-body.js';
import { registerBlockRenderer, type BlockRenderer, type BlockRendererEntry } from '../../src/renderer/preview/blocks/block-renderers.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NOTIFICATIONS = 30;

const fake: BlockRenderer & { render: ReturnType<typeof vi.fn> } = {
  render: vi.fn(() => {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.setAttribute('viewBox', '0 0 200 100');
    svg.appendChild(document.createElementNS(SVG_NS, 'text'));
    return Promise.resolve(svg);
  }),
};
const ENTRY: BlockRendererEntry = { lang: 'mermaid', load: () => Promise.resolve(fake as BlockRenderer) };

/** Every ResizeObserver the code under test creates; the test fires them. */
const observers: Array<{ callback: ResizeObserverCallback; targets: Element[] }> = [];
let originalObserver: typeof ResizeObserver | undefined;
let width = 200;
let restoreWidth: (() => void) | null = null;
let restoreRegistry: (() => void) | null = null;

beforeEach(() => {
  observers.length = 0;
  fake.render.mockClear();
  originalObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    private readonly entry: { callback: ResizeObserverCallback; targets: Element[] };
    constructor(callback: ResizeObserverCallback) {
      this.entry = { callback, targets: [] };
      observers.push(this.entry);
    }
    observe(target: Element): void {
      this.entry.targets.push(target);
    }
    unobserve(): void {}
    disconnect(): void {
      this.entry.targets.length = 0;
    }
  } as unknown as typeof ResizeObserver;

  width = 200;
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('preview-diagram-frame__viewport') || this.classList.contains('preview-diagram-frame') ? width : 0;
    },
  });
  restoreWidth = () => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original);
  };
  restoreRegistry = registerBlockRenderer(ENTRY);
});

afterEach(() => {
  restoreRegistry?.();
  restoreWidth?.();
  if (originalObserver) globalThis.ResizeObserver = originalObserver;
});

const bodyProps = (text: string): PreviewBodyProps => ({
  panelId: 'p1',
  content: { kind: 'text', text },
  filePath: 'D:/proj/README.md',
  projectRoot: 'D:/proj',
  providerSettings: { enabled: true },
  initialViewState: undefined,
  onViewStateCapture: () => {},
  onFollow: () => {},
  onNotice: () => {},
  onDrawn: () => {},
  onBodyFailure: () => {},
});

/** A window drag: a run of notifications, each at a new width, within one animation frame's worth of time. */
function drag(from: number, steps: number): void {
  for (let i = 0; i < steps; i += 1) {
    width = from + i;
    act(() => {
      for (const o of observers) if (o.targets.length > 0) o.callback([], {} as ResizeObserver);
    });
  }
}

async function mountDiagram() {
  render(createElement(MarkdownBody, bodyProps('# Doc\n\n```mermaid\ngraph TD\n```\n')));
  const frame = await screen.findByTestId('diagram-frame-p1-diagram-0', undefined, { timeout: 10_000 });
  const layer = frame.querySelector<HTMLElement>('.preview-diagram-frame__layer')!;
  const viewport = frame.querySelector<HTMLElement>('.preview-diagram-frame__viewport')!;
  return { frame, layer, viewport };
}

describe('a resize drag over a preview holding a diagram (B5)', () => {
  it('costs the diagram at most a couple of style writes in total, not one per notification', async () => {
    const { layer, viewport } = await mountDiagram();
    const writes = { layer: 0, viewport: 0 };
    const watch = new MutationObserver((records) => {
      for (const r of records) {
        if (r.attributeName !== 'style') continue;
        if (r.target === layer) writes.layer += 1;
        if (r.target === viewport) writes.viewport += 1;
      }
    });
    watch.observe(layer, { attributes: true, attributeFilter: ['style'] });
    watch.observe(viewport, { attributes: true, attributeFilter: ['style'] });

    // 110 → 139 wide: every step is a different Fit scale (110/200 … 139/200, above the 0.5 floor).
    drag(110, NOTIFICATIONS);
    watch.takeRecords().forEach((r) => {
      if (r.attributeName !== 'style') return;
      if (r.target === layer) writes.layer += 1;
      if (r.target === viewport) writes.viewport += 1;
    });
    watch.disconnect();

    // Observed today: layer = 30 and viewport = 30 — one transform and one height rewrite per notification,
    // each a layout and a repaint of the whole SVG. A resize that settles before the next frame is one write.
    expect.soft(writes.layer, `transform rewrites over ${NOTIFICATIONS} notifications`).toBeLessThanOrEqual(2);
    expect.soft(writes.viewport, `height rewrites over ${NOTIFICATIONS} notifications`).toBeLessThanOrEqual(2);
  });

  it('control: mermaid is not run again by a resize', async () => {
    await mountDiagram();
    expect(fake.render).toHaveBeenCalledTimes(1);
    drag(110, NOTIFICATIONS);
    expect(fake.render).toHaveBeenCalledTimes(1);
  });

  it('control: the SVG is not cloned into the layer again by a resize', async () => {
    const { layer } = await mountDiagram();
    const drawn = layer.querySelector('svg');
    expect(drawn).not.toBeNull();
    drag(110, NOTIFICATIONS);
    expect(layer.querySelector('svg')).toBe(drawn);
  });
});
