/**
 * 054 T038 — a diagram's view controls (FR-046a – FR-046h, research R6, contracts/menus-commands-controls-054.md
 * "Diagram frame toolbar"), as amended by the MT-04 round: Maximise / Minimise wording, no Full Size mode,
 * a Zoom 100% control, the diagram centred in its viewport, and panel zoom redirected to a focused diagram.
 *
 * Layer: component — the frame's view state, its toolbar, its pointer handling and the classes it sets are
 * all in what it renders. jsdom has no layout, so the viewport's size is stubbed and the SVG's natural size
 * comes from its `viewBox`, which is what the frame reads in the real engine too. That the controls stay put
 * on screen while the diagram moves is structural here — the toolbar is not inside the transformed layer —
 * and the pixels are `preview-mermaid.e2e.ts`'s.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { WINDOWS_HOST_TRAITS, configureHostTraits, macosHostTraits } from '@throng/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DIAGRAM_MAX_SCALE,
  DIAGRAM_RESIZE_DEBOUNCE_MS,
  DIAGRAM_MIN_SCALE,
  DiagramFrame,
} from '../../src/renderer/preview/diagram/diagram-frame.js';
import { zoomFocusedDiagram as zoomFocusedDiagramRaw, type DiagramZoomAction } from '../../src/renderer/preview/diagram/diagram-zoom.js';
import { MaximiseLayer } from '../../src/renderer/workspace/maximise-layer.js';
import {
  __resetMaximise,
  getMaximiseStack,
  registerPanelTabResolver,
} from '../../src/renderer/workspace/maximise-store.js';

/** The routes call this from an event handler; here it is called from the test, so it needs an act. */
function zoomFocusedDiagram(action: DiagramZoomAction, from?: Element | null): boolean {
  let handled = false;
  act(() => {
    handled = from === undefined ? zoomFocusedDiagramRaw(action) : zoomFocusedDiagramRaw(action, from);
  });
  return handled;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgOf(width: number, height: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.appendChild(document.createElementNS(SVG_NS, 'rect'));
  return svg;
}

/** What jsdom cannot measure: the size of every diagram viewport (and frame), set per test. */
let box = { width: 400, height: 200 };
let restoreSizes: (() => void) | null = null;

let unresolve: (() => void) | null = null;

beforeEach(() => {
  // The window's workspace store answers which tab holds a panel; here every panel is in tab `t1`.
  unresolve = registerPanelTabResolver(() => 't1');
  box = { width: 400, height: 200 };
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  const sized = (el: HTMLElement): boolean =>
    el.classList.contains('preview-diagram-frame') || el.classList.contains('preview-diagram-frame__viewport');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return sized(this) ? box.width : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return sized(this) ? box.height : 0;
    },
  });
  restoreSizes = () => {
    if (width) Object.defineProperty(HTMLElement.prototype, 'clientWidth', width);
    if (height) Object.defineProperty(HTMLElement.prototype, 'clientHeight', height);
  };
});

afterEach(() => {
  restoreSizes?.();
  unresolve?.();
  __resetMaximise();
});

function mount(width = 800, height = 300) {
  const view = render(createElement(DiagramFrame, { svg: svgOf(width, height), panelId: 'p1', sectionId: 'diagram-0' }));
  const frame = (): HTMLElement => screen.getByTestId('diagram-frame-p1-diagram-0');
  const layer = (): HTMLElement => frame().querySelector<HTMLElement>('.preview-diagram-frame__layer')!;
  const viewport = (): HTMLElement => frame().querySelector<HTMLElement>('.preview-diagram-frame__viewport')!;
  const button = (title: string): HTMLElement => within(frame()).getByTitle((t) => t === title || t.startsWith(`${title} (`));
  return { view, frame, layer, viewport, button };
}

/** A standalone `.mmd` preview's diagram: it fills the panel (054 FR-046a, manual test change request, 2026-10-13). */
function mountFilling(width = 800, height = 300) {
  const view = render(
    createElement(DiagramFrame, { svg: svgOf(width, height), panelId: 'p1', sectionId: 'diagram-0', maximisable: false, fillsPanel: true }),
  );
  const frame = (): HTMLElement => screen.getByTestId('diagram-frame-p1-diagram-0');
  const layer = (): HTMLElement => frame().querySelector<HTMLElement>('.preview-diagram-frame__layer')!;
  const viewport = (): HTMLElement => frame().querySelector<HTMLElement>('.preview-diagram-frame__viewport')!;
  const button = (title: string): HTMLElement => within(frame()).getByTitle((t) => t === title || t.startsWith(`${title} (`));
  return { view, frame, layer, viewport, button };
}

describe('a diagram that fills its panel — a standalone .mmd preview (FR-046a, 2026-10-13)', () => {
  it('fits both its width and its height, centred in the panel', () => {
    // 400×200 box; a 400×400 diagram is held back by its height: scale 0.5 → 200×200, centred across.
    const { frame, layer } = mountFilling(400, 400);
    expect(Number(frame().getAttribute('data-scale'))).toBe(0.5);
    expect(layer().style.transform).toBe('translate(100px, 0px) scale(0.5)');
  });

  it('takes its height from the panel, never from the drawing, so nothing below it can scroll', () => {
    const { frame, viewport } = mountFilling(400, 400);
    expect(frame()).toHaveClass('preview-diagram-frame--fills');
    expect(viewport().style.height).toBe('');
  });
});

/** FR-046m (manual test change request, 2026-10-13) — an inline diagram's box keeps its height. */
describe('an inline diagram’s box height (FR-046m, 2026-10-13)', () => {
  it('is the fitted drawing’s, and does not change when the diagram is zoomed', () => {
    const { viewport, button } = mount(800, 300);
    expect(viewport().style.height).toBe('150px');
    fireEvent.click(button('Zoom in'));
    expect(viewport().style.height).toBe('150px');
    fireEvent.click(button('Zoom 100%'));
    expect(viewport().style.height).toBe('150px');
  });

  it('is the height the document gives, with Fit using both extents inside it', () => {
    render(createElement(DiagramFrame, { svg: svgOf(200, 600), panelId: 'p1', sectionId: 'diagram-0', height: 300 }));
    const frame = screen.getByTestId('diagram-frame-p1-diagram-0');
    const viewport = frame.querySelector<HTMLElement>('.preview-diagram-frame__viewport')!;
    const layer = frame.querySelector<HTMLElement>('.preview-diagram-frame__layer')!;
    expect(viewport.style.height).toBe('300px');
    // 200×600 into 400×300 → held back by the height: 0.5 → 100×300, centred across.
    expect(layer.style.transform).toBe('translate(150px, 0px) scale(0.5)');
  });
});

/** Where the viewport sits on screen: jsdom lays nothing out, so the rect is stubbed at the origin. */
function placeAtOrigin(el: HTMLElement): void {
  el.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: box.width, bottom: box.height, width: box.width, height: box.height, toJSON: () => ({}) });
}

/** An Image or SVG preview's picture (074): the wrapper `blocks/picture.ts` draws, marked as a picture. */
function pictureOf(width: number, height: number): SVGSVGElement {
  const svg = svgOf(width, height);
  svg.setAttribute('data-throng-picture', '');
  return svg;
}

/** 074 FR-031a — a picture filling its panel, whose viewport scrolls. */
function mountScrolling(width: number, height: number, extra: { hatch?: boolean; initialMode?: 'fit' | 'actual' | 'open' } = {}) {
  render(
    createElement(DiagramFrame, {
      svg: pictureOf(width, height),
      panelId: 'p1',
      sectionId: 'diagram-0',
      maximisable: false,
      fillsPanel: true,
      scrolls: true,
      ...extra,
    }),
  );
  const frame = (): HTMLElement => screen.getByTestId('diagram-frame-p1-diagram-0');
  const layer = (): HTMLElement => frame().querySelector<HTMLElement>('.preview-diagram-frame__layer')!;
  const stage = (): HTMLElement => frame().querySelector<HTMLElement>('.preview-diagram-frame__stage')!;
  const viewport = (): HTMLElement => frame().querySelector<HTMLElement>('.preview-diagram-frame__viewport')!;
  const hatch = (): HTMLElement | null => screen.queryByTestId('diagram-hatch-p1-diagram-0');
  const button = (title: string): HTMLElement => within(frame()).getByTitle((t) => t === title || t.startsWith(`${title} (`));
  return { frame, layer, stage, viewport, hatch, button };
}

describe('following the panel as it resizes (074, 2026-11-19)', () => {
  let notify: (() => void) | null = null;
  let frames: FrameRequestCallback[] = [];
  beforeEach(() => {
    notify = null;
    frames = [];
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          notify = cb;
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const flushFrame = (): void => {
    const due = frames.splice(0);
    act(() => due.forEach((cb) => cb(0)));
  };

  it('an Image or SVG preview refits on the next frame of a drag, not once the drag pauses', () => {
    const { frame } = mountScrolling(800, 100); // 400 wide → 0.5
    expect(Number(frame().getAttribute('data-scale'))).toBe(0.5);
    box = { width: 800, height: 200 };
    act(() => notify!());
    act(() => notify!()); // coalesced: one measure per frame
    expect(frames).toHaveLength(1);
    flushFrame();
    expect(Number(frame().getAttribute('data-scale'))).toBe(1);
  });

  it('a diagram in a document still refits once the drag pauses (054 B5)', () => {
    render(createElement(DiagramFrame, { svg: svgOf(800, 100), panelId: 'p1', sectionId: 'diagram-0' }));
    const frame = screen.getByTestId('diagram-frame-p1-diagram-0');
    expect(Number(frame.getAttribute('data-scale'))).toBe(0.5);
    box = { width: 800, height: 200 };
    act(() => notify!());
    flushFrame();
    expect(Number(frame.getAttribute('data-scale'))).toBe(0.5);
    act(() => vi.advanceTimersByTime(DIAGRAM_RESIZE_DEBOUNCE_MS));
    expect(Number(frame.getAttribute('data-scale'))).toBe(1);
  });
});

describe('a picture that scrolls (074 FR-031a, 2026-11-19)', () => {
  // FR-020a (2026-11-20) — the zoom reset returns a picture to the view it opened in, not to Fit.
  it('the zoom reset returns a small picture to 100% and a large one to Fit: its opening view', () => {
    const small = mountScrolling(100, 100, { initialMode: 'open' });
    fireEvent.click(small.button('Fit picture'));
    expect(Number(small.frame().getAttribute('data-scale'))).toBe(2);
    small.viewport().focus();
    expect(zoomFocusedDiagram('reset')).toBe(true);
    expect(small.frame().getAttribute('data-mode')).toBe('open');
    expect(Number(small.frame().getAttribute('data-scale'))).toBe(1);
    document.body.replaceChildren();
    const large = mountScrolling(800, 100, { initialMode: 'open' });
    large.viewport().focus();
    expect(zoomFocusedDiagram('in')).toBe(true);
    expect(zoomFocusedDiagram('reset')).toBe(true);
    expect(Number(large.frame().getAttribute('data-scale'))).toBe(0.5);
  });

  it('names the zoom reset chord on Zoom 100% for a picture, on Fit for a diagram', () => {
    const { frame } = mountScrolling(100, 100, { initialMode: 'open' });
    expect(within(frame()).getByTitle(/^Zoom 100% \(/)).toBeInTheDocument();
    expect(within(frame()).getByTitle('Fit picture')).toBeInTheDocument();
  });

  it('a fitted view clips rather than scrolls, so rounding never raises a scrollbar; a chosen zoom scrolls', () => {
    const { viewport, button } = mountScrolling(800, 100, { initialMode: 'open' });
    expect(viewport()).toHaveClass('preview-diagram-frame__viewport--fitted');
    fireEvent.click(button('Zoom in'));
    expect(viewport()).not.toHaveClass('preview-diagram-frame__viewport--fitted');
    fireEvent.click(button('Fit picture'));
    expect(viewport()).toHaveClass('preview-diagram-frame__viewport--fitted');
  });

  it('Fit fills the panel with a small picture, enlarged and centred, with nothing to scroll (FR-031b)', () => {
    // 100×100 in 400×200: Fit fills, held by the height → scale 2, 200×200, centred across at (100, 0).
    const { frame, layer, stage } = mountScrolling(100, 100);
    expect(frame()).toHaveClass('preview-diagram-frame--scrolls');
    expect(Number(frame().getAttribute('data-scale'))).toBe(2);
    expect(layer().style.transform).toBe('translate(100px, 0px) scale(2)');
    // The stage is the picture's extent, never less than the viewport (a CSS minimum, not a measured width).
    expect(stage().style.width).toBe('200px');
    expect(stage().style.height).toBe('200px');
    expect(stage().style.minWidth).toBe('100%');
    expect(stage().style.minHeight).toBe('100%');
  });

  // FR-020a (2026-11-19) — the opening view: 100% where the picture fits, Fit where it is larger than the viewport.
  it('opens a picture smaller than the panel at 100%, centred', () => {
    const { frame, layer } = mountScrolling(100, 100, { initialMode: 'open' });
    expect(frame().getAttribute('data-mode')).toBe('open');
    expect(Number(frame().getAttribute('data-scale'))).toBe(1);
    expect(layer().style.transform).toBe('translate(150px, 50px) scale(1)');
  });

  it('opens a picture larger than the panel on either axis at Fit, and Fit stays there', () => {
    // 800×100 in 400×200: too wide → 0.5. 100×400: too tall → 0.5.
    expect(Number(mountScrolling(800, 100, { initialMode: 'open' }).frame().getAttribute('data-scale'))).toBe(0.5);
    document.body.replaceChildren();
    const { frame, button } = mountScrolling(100, 400, { initialMode: 'open' });
    expect(Number(frame().getAttribute('data-scale'))).toBe(0.5);
    fireEvent.click(button('Zoom in'));
    expect(frame().getAttribute('data-mode')).toBe('zoom');
    expect(Number(frame().getAttribute('data-scale'))).toBe(0.625);
  });

  it('Fit after the opening view fills the panel, enlarging a small picture (FR-031b)', () => {
    const { frame, button } = mountScrolling(100, 100, { initialMode: 'open' });
    fireEvent.click(button('Fit picture'));
    expect(Number(frame().getAttribute('data-scale'))).toBe(2);
  });

  it('Zoom 100% shows a small picture at its own size in the centre', () => {
    const { layer, button } = mountScrolling(100, 100);
    fireEvent.click(button('Zoom 100%'));
    expect(layer().style.transform).toBe('translate(150px, 50px) scale(1)');
  });

  it('a tiny picture fitted far past the usual zoom ceiling can still be zoomed in from Fit', () => {
    // 4×2 in 400×200 → Fit 100; a step in goes to 125, not down to the ceiling of 8.
    const { frame, button } = mountScrolling(4, 2);
    expect(Number(frame().getAttribute('data-scale'))).toBe(100);
    fireEvent.click(button('Zoom in'));
    expect(Number(frame().getAttribute('data-scale'))).toBe(125);
  });

  it('a middle-button drag moves a picture smaller than the panel, on each axis it fits (FR-031c)', () => {
    const { layer, viewport, button } = mountScrolling(100, 100);
    fireEvent.click(button('Zoom 100%')); // 100×100 at (150, 50) in 400×200: fits both ways
    fireEvent.pointerDown(viewport(), { button: 1, buttons: 4, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(viewport(), { buttons: 4, clientX: 60, clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(viewport(), { button: 1, clientX: 60, clientY: 130, pointerId: 1 });
    expect(layer().style.transform).toBe('translate(110px, 80px) scale(1)');
    expect(viewport().scrollLeft).toBe(0);
    // Fit puts it back in the middle.
    fireEvent.click(button('Fit picture'));
    expect(layer().style.transform).toBe('translate(100px, 0px) scale(2)');
  });

  it('dragging a picture wider than the panel but shorter scrolls across and moves it up and down', () => {
    // 800×100 at 100% in 400×200: overflows across, fits down.
    const { layer, viewport } = mountScrolling(800, 100, { initialMode: 'actual' });
    const fromLeft = viewport().scrollLeft;
    fireEvent.pointerDown(viewport(), { button: 1, buttons: 4, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(viewport(), { buttons: 4, clientX: 80, clientY: 120, pointerId: 1 });
    expect(viewport().scrollLeft).toBe(fromLeft + 20);
    expect(layer().style.transform).toBe('translate(0px, 70px) scale(1)');
  });

  it('a picture larger than the panel at actual size gets a stage its size, scrolled to its centre', () => {
    const { layer, stage, viewport } = mountScrolling(800, 400, { initialMode: 'actual' });
    expect(stage().style.width).toBe('800px');
    expect(stage().style.height).toBe('400px');
    // Larger on both axes, so the picture starts at the stage's corner and the scroll position centres it.
    expect(layer().style.transform).toBe('translate(0px, 0px) scale(1)');
    expect(viewport().scrollLeft).toBe(200);
    expect(viewport().scrollTop).toBe(100);
  });

  it('zooming about the pointer scrolls so the point under it stays put', () => {
    // Fit: 800×300 in 400×200 → 0.5, drawn 400×150 at (0, 25). The pointer at (300, 150) is over drawing (600, 250).
    const { stage, viewport } = mountScrolling(800, 300);
    placeAtOrigin(viewport());
    viewport().focus();
    act(() => {
      zoomFocusedDiagramRaw('in', viewport(), { clientX: 300, clientY: 150 });
    });
    // At 0.625 the drawing is 500×187.5: wider than the viewport, so the stage is 500 wide and drawing x 600 sits at
    // 375 — scrolled 75 to stay under the pointer.
    expect(stage().style.width).toBe('500px');
    expect(viewport().scrollLeft).toBe(75);
  });

  it('a middle-button drag scrolls instead of moving the picture, and prevents the platform autoscroll', () => {
    const { layer, viewport, button } = mountScrolling(800, 400, { initialMode: 'actual' });
    const before = layer().style.transform;
    fireEvent.click(button('Zoom in'));
    const fromLeft = viewport().scrollLeft;
    const fromTop = viewport().scrollTop;
    const down = fireEvent.pointerDown(viewport(), { button: 1, buttons: 4, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(viewport(), { buttons: 4, clientX: 70, clientY: 90, pointerId: 1 });
    fireEvent.pointerUp(viewport(), { button: 1, clientX: 70, clientY: 90, pointerId: 1 });
    expect(down).toBe(false);
    expect(viewport().scrollLeft).toBe(fromLeft + 30);
    expect(viewport().scrollTop).toBe(fromTop + 10);
    expect(before).toBe('translate(0px, 0px) scale(1)');
    expect(layer().style.transform).toBe('translate(0px, 0px) scale(1.25)');
  });

  it('Fit after a zoom returns the scroll to the start, with the picture centred again', () => {
    const { layer, viewport, button } = mountScrolling(100, 100);
    fireEvent.click(button('Zoom in'));
    fireEvent.click(button('Zoom in'));
    fireEvent.click(button('Zoom in'));
    fireEvent.click(button('Fit picture'));
    expect(layer().style.transform).toBe('translate(100px, 0px) scale(2)');
    expect(viewport().scrollLeft).toBe(0);
    expect(viewport().scrollTop).toBe(0);
  });
});

describe('the transparency hatch (074 FR-027b, 2026-11-19)', () => {
  it('lies under a picture, the size of the picture at its scale, where the picture is', () => {
    const { hatch } = mountScrolling(100, 100);
    expect(hatch()).not.toBeNull();
    expect(hatch()!.style.width).toBe('200px');
    expect(hatch()!.style.height).toBe('200px');
    expect(hatch()!.style.transform).toBe('translate(100px, 0px)');
  });

  it('follows the zoom at screen scale rather than being scaled with the picture', () => {
    const { hatch, button } = mountScrolling(100, 100);
    fireEvent.click(button('Zoom in'));
    expect(hatch()!.style.width).toBe('250px');
    expect(hatch()!.style.transform).not.toContain('scale');
  });

  it('is absent when the setting is off, and under a drawing that is not a picture', () => {
    expect(mountScrolling(200, 100, { hatch: false }).hatch()).toBeNull();
    document.body.replaceChildren();
    mount(200, 100);
    expect(screen.queryByTestId('diagram-hatch-p1-diagram-0')).toBeNull();
  });
});

describe('zooming about a point (FR-046l, 2026-10-13)', () => {
  it('Ctrl+wheel keeps the point under the pointer where it is', () => {
    // Fit: 800×300 in 400×200 → scale 0.5, drawn 400×150 at (0, 25).
    const { layer, viewport } = mountFilling(800, 300);
    placeAtOrigin(viewport());
    viewport().focus();
    act(() => {
      zoomFocusedDiagramRaw('in', viewport(), { clientX: 300, clientY: 150 });
    });
    // The pointer is over drawing point (600, 250); at 0.625 that point is still at (300, 150).
    expect(layer().style.transform).toBe('translate(-75px, -6.25px) scale(0.625)');
  });

  it('an inline diagram zooms about the pointer too', () => {
    const { layer, viewport, button } = mount(800, 300);
    fireEvent.click(button('Zoom 100%')); // centred in its 400×150 box (the fitted height, FR-046m) → (−200, −75)
    placeAtOrigin(viewport());
    viewport().focus();
    act(() => {
      zoomFocusedDiagramRaw('in', viewport(), { clientX: 300, clientY: 100 });
    });
    // Drawing point (500, 175) is under the pointer; at 1.25 it still is.
    expect(layer().style.transform).toBe('translate(-325px, -118.75px) scale(1.25)');
  });

  it('a pointer outside the diagram zooms about the centre instead', () => {
    const { layer, viewport } = mountFilling(800, 300);
    placeAtOrigin(viewport());
    viewport().focus();
    act(() => {
      zoomFocusedDiagramRaw('in', viewport(), { clientX: 900, clientY: 150 });
    });
    // About (200, 100): drawing point (400, 150) stays there.
    expect(layer().style.transform).toBe('translate(-50px, 6.25px) scale(0.625)');
  });

  it('the Zoom in control zooms about the centre of the visible box, keeping a pan', () => {
    const { layer, viewport, button } = mountFilling(800, 300);
    fireEvent.click(button('Zoom 100%')); // 800×300 at 1:1 → (−200, −50)
    fireEvent.pointerDown(viewport(), { button: 1, buttons: 4, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(viewport(), { buttons: 4, clientX: 60, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(viewport(), { button: 1, clientX: 60, clientY: 80, pointerId: 1 });
    expect(layer().style.transform).toBe('translate(-240px, -70px) scale(1)');
    fireEvent.click(button('Zoom in'));
    // Drawing point (440, 170) is at the centre (200, 100); at 1.25 it still is.
    expect(layer().style.transform).toBe('translate(-350px, -112.5px) scale(1.25)');
  });
});

describe('the toolbar (FR-046b, FR-046h)', () => {
  it('holds Fit, Zoom In, Zoom 100%, Zoom Out and Maximise, in that order, each a focusable titled button', () => {
    const { frame } = mount();
    const toolbar = within(frame()).getByRole('toolbar');
    const buttons = within(toolbar).getAllByRole('button');
    // Zoom 100% sits between the two zoom steps (A2); there is no "Fill the panel" any more.
    expect(buttons.map((b) => b.getAttribute('title'))).toEqual([
      'Fit diagram (Ctrl+Alt+Numpad0)',
      'Zoom in (Ctrl+Alt++)',
      'Zoom 100%',
      'Zoom out (Ctrl+Alt+-)',
      'Enter Focus Mode',
    ]);
    for (const b of buttons) {
      b.focus();
      expect(document.activeElement).toBe(b);
    }
  });

  it('has no Fill the panel (Full Size) control or mode', () => {
    const { frame, button } = mount();
    expect(within(frame()).queryByTitle('Fill the panel')).toBeNull();
    for (const title of ['Zoom in', 'Zoom 100%', 'Zoom out', 'Fit diagram']) {
      fireEvent.click(button(title));
      expect(frame().getAttribute('data-mode')).not.toBe('fullSize');
      expect(frame().className).not.toContain('full-size');
    }
  });

  it('is outside the transformed layer, so zoom and pan never move it', () => {
    const { frame, layer, button } = mount();
    fireEvent.click(button('Zoom in'));
    expect(layer().style.transform).toMatch(/scale/);
    expect(layer().contains(within(frame()).getByRole('toolbar'))).toBe(false);
  });
});

describe('Fit (FR-046a, FR-046c)', () => {
  it('shrinks a wide diagram to the box width', () => {
    const { frame } = mount(800, 300);
    expect(frame().getAttribute('data-mode')).toBe('fit');
    expect(Number(frame().getAttribute('data-scale'))).toBe(0.5);
  });

  it('never enlarges a small one past its natural size', () => {
    const { frame } = mount(200, 100);
    expect(Number(frame().getAttribute('data-scale'))).toBe(1);
  });

  it('fits a very wide one entirely, with no floor and no sideways scroll (MT-04 B1)', () => {
    const { frame } = mount(4000, 300);
    expect(Number(frame().getAttribute('data-scale'))).toBe(0.1);
    expect(frame().classList.contains('preview-diagram-frame--scrolls')).toBe(false);
  });

  it('returns to the fit view after a zoom', () => {
    const { frame, button } = mount(800, 300);
    fireEvent.click(button('Zoom in'));
    fireEvent.click(button('Fit diagram'));
    expect(frame().getAttribute('data-mode')).toBe('fit');
    expect(Number(frame().getAttribute('data-scale'))).toBe(0.5);
  });
});

describe('Zoom In / Zoom Out (FR-046c)', () => {
  it('steps the scale by ×1.25', () => {
    const { frame, button } = mount(800, 300);
    fireEvent.click(button('Zoom in'));
    expect(frame().getAttribute('data-mode')).toBe('zoom');
    expect(Number(frame().getAttribute('data-scale'))).toBeCloseTo(0.625);
    fireEvent.click(button('Zoom out'));
    expect(Number(frame().getAttribute('data-scale'))).toBeCloseTo(0.5);
  });

  it(`stays within [${DIAGRAM_MIN_SCALE}, ${DIAGRAM_MAX_SCALE}]`, () => {
    const { frame, button } = mount(800, 300);
    for (let i = 0; i < 40; i += 1) fireEvent.click(button('Zoom in'));
    expect(Number(frame().getAttribute('data-scale'))).toBe(DIAGRAM_MAX_SCALE);
    for (let i = 0; i < 80; i += 1) fireEvent.click(button('Zoom out'));
    expect(Number(frame().getAttribute('data-scale'))).toBe(DIAGRAM_MIN_SCALE);
  });
});

/** A2 — Zoom 100% shows the diagram at its actual size, alongside Fit. */
describe('Zoom 100%', () => {
  it('sets the diagram to its actual size (scale 1) from Fit and from any other zoom', () => {
    const { frame, button } = mount(800, 300);
    expect(Number(frame().getAttribute('data-scale'))).toBe(0.5);
    fireEvent.click(button('Zoom 100%'));
    expect(frame().getAttribute('data-mode')).toBe('zoom');
    expect(Number(frame().getAttribute('data-scale'))).toBe(1);

    fireEvent.click(button('Zoom in'));
    fireEvent.click(button('Zoom in'));
    fireEvent.click(button('Zoom 100%'));
    expect(Number(frame().getAttribute('data-scale'))).toBe(1);
  });

  // DELETED: "works alongside Fit" — "sets the diagram to its actual size" asserts Zoom 100% from Fit and from any
  // zoom, and "returns to the fit view after a zoom" asserts Fit restores mode fit at scale 0.5.

  it('brings the diagram back to the centre of the viewport, as Fit does', () => {
    const { layer, viewport, button } = mount(800, 300);
    fireEvent.click(button('Zoom in'));
    fireEvent.pointerDown(viewport(), { button: 1, buttons: 4, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(viewport(), { buttons: 4, clientX: 20, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(viewport(), { button: 1, clientX: 20, clientY: 40, pointerId: 1 });
    fireEvent.click(button('Zoom 100%'));
    // The 400×150 box (its fitted height, kept at every zoom, FR-046m), 800×300 at 1:1 → half the overhang off each side.
    expect(layer().style.transform).toBe('translate(-200px, -75px) scale(1)');
  });

  // Ctrl+middle-click is Zoom 100% (Ctrl+MiddleClick → panel.zoomReset); the press must stay unprevented so
  // Chromium still sends the mousedown that gesture listens for (B9 drives the real one, 2026-10-13).
  it('a Ctrl+middle press starts no pan, is left unprevented and focuses the diagram', () => {
    const { viewport } = mount(800, 300);
    const notPrevented = fireEvent.pointerDown(viewport(), { button: 1, buttons: 4, ctrlKey: true, clientX: 100, clientY: 100, pointerId: 1 });
    expect(notPrevented).toBe(true);
    expect(viewport().classList.contains('preview-diagram-frame__viewport--panning')).toBe(false);
    expect(document.activeElement).toBe(viewport());
  });

  // On macOS the gesture is Cmd+middle-click (070 FR-030: mouse-zoom reads the platform's primary modifier), so the
  // press it begins with must be left alone there too — a pan would prevent it and the reset would never fire.
  it('on macOS a Cmd+middle press starts no pan, is left unprevented and focuses the diagram', () => {
    configureHostTraits(macosHostTraits('/tmp/throng-ipc', []));
    try {
      const { viewport } = mount(800, 300);
      const notPrevented = fireEvent.pointerDown(viewport(), { button: 1, buttons: 4, metaKey: true, clientX: 100, clientY: 100, pointerId: 1 });
      expect(notPrevented).toBe(true);
      expect(viewport().classList.contains('preview-diagram-frame__viewport--panning')).toBe(false);
      expect(document.activeElement).toBe(viewport());
    } finally {
      configureHostTraits(WINDOWS_HOST_TRAITS);
    }
  });

  it('shows the move cursor for exactly as long as a middle-button pan lasts', () => {
    const { viewport } = mount(800, 300);
    const panning = () => viewport().classList.contains('preview-diagram-frame__viewport--panning');
    expect(panning()).toBe(false);
    fireEvent.pointerDown(viewport(), { button: 1, buttons: 4, clientX: 100, clientY: 100, pointerId: 1 });
    expect(panning()).toBe(true);
    fireEvent.pointerUp(viewport(), { button: 1, clientX: 20, clientY: 40, pointerId: 1 });
    expect(panning()).toBe(false);
  });
});

/** A3 — a diagram is centred in its viewport, whatever mode it starts in. */
describe('centring (A3)', () => {
  // In place and fitted, the viewport is as tall as the diagram (CSS sets its height from the scale), so it
  // is centred vertically by construction and the layer needs no vertical offset: the stubbed 200px height
  // below is deliberately taller than the diagram and must NOT be centred in.
  it('a small diagram on load is centred horizontally in the viewport, and fills its own height', () => {
    const { layer, viewport } = mount(200, 100);
    // box 400 wide, diagram 200 at scale 1 → (400−200)/2.
    expect(layer().style.transform).toBe('translate(100px, 0px) scale(1)');
    expect(viewport().style.height).toBe('100px');
  });

  it('a wide diagram fitted to the width has no horizontal offset and fills its own height', () => {
    const { layer, viewport } = mount(800, 300);
    expect(layer().style.transform).toBe('translate(0px, 0px) scale(0.5)');
    expect(viewport().style.height).toBe('150px');
  });

  it('a zoomed diagram is centred on both axes in the viewport', () => {
    const { layer, button } = mount(200, 100);
    fireEvent.click(button('Zoom 100%'));
    // In place the box keeps its fitted height (FR-046m): 400×100 for a 200×100 diagram → (400−200)/2, 0.
    expect(layer().style.transform).toBe('translate(100px, 0px) scale(1)');
  });
});

describe('panning (FR-046e)', () => {
  it('a middle-button drag pans the diagram and prevents the platform autoscroll', () => {
    const { layer, viewport, button } = mount(800, 300);
    fireEvent.click(button('Zoom in'));

    const down = fireEvent.pointerDown(viewport(), { button: 1, buttons: 4, clientX: 100, clientY: 100, pointerId: 1 });
    const mouseDown = fireEvent.mouseDown(viewport(), { button: 1 });
    fireEvent.pointerMove(viewport(), { buttons: 4, clientX: 70, clientY: 90, pointerId: 1 });
    fireEvent.pointerUp(viewport(), { button: 1, clientX: 70, clientY: 90, pointerId: 1 });

    expect(down).toBe(false);
    expect(mouseDown).toBe(false);
    // Zoomed about the centre of its 400×150 box to 0.625 is (−50, −18.75); the drag moves it by (−30, −10).
    expect(layer().style.transform).toContain('translate(-80px, -28.75px)');
  });

  it('a primary-button drag does not pan (it selects, as anywhere in a preview)', () => {
    const { layer, viewport } = mount(800, 300);
    fireEvent.pointerDown(viewport(), { button: 0, buttons: 1, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(viewport(), { buttons: 1, clientX: 50, clientY: 50, pointerId: 1 });
    // Still the centred position at the fit scale.
    expect(layer().style.transform).toContain('translate(0px, 0px)');
  });
});

describe('view state is view state only (FR-046g)', () => {
  it('a remount starts from Fit again', () => {
    const first = mount(800, 300);
    fireEvent.click(first.button('Zoom in'));
    first.view.unmount();

    const second = mount(800, 300);
    expect(second.frame().getAttribute('data-mode')).toBe('fit');
  });

  it('a new SVG for the same frame (a live re-render) keeps the zoom', () => {
    const { view, frame, button } = mount(800, 300);
    fireEvent.click(button('Zoom in'));
    act(() => {
      view.rerender(createElement(DiagramFrame, { svg: svgOf(800, 320), panelId: 'p1', sectionId: 'diagram-0' }));
    });
    expect(frame().getAttribute('data-mode')).toBe('zoom');
    expect(Number(frame().getAttribute('data-scale'))).toBeCloseTo(0.625);
  });
});

/** 054 T067 (preview half) — Maximise through the one maximise mechanism (FR-046f, R7), reworded by A1. */
describe('Maximise (FR-046f)', () => {
  function mountWithLayer() {
    const view = render(
      createElement(
        'div',
        null,
        createElement(DiagramFrame, { svg: svgOf(800, 300), panelId: 'p1', sectionId: 'diagram-0' }),
        createElement(MaximiseLayer, { tabId: 't1' }),
      ),
    );
    const frame = (): HTMLElement => screen.getByTestId('diagram-frame-p1-diagram-0');
    return { view, frame };
  }

  it('maximises the diagram as a section of its panel, drawn in the maximise layer with its view kept', () => {
    const { frame } = mountWithLayer();
    fireEvent.click(within(frame()).getByTitle(/^Zoom in \(/));
    fireEvent.click(within(frame()).getByTitle('Enter Focus Mode'));

    expect(getMaximiseStack('t1')).toEqual([expect.objectContaining({ kind: 'section', panelId: 'p1', sectionId: 'diagram-0' })]);
    const layer = screen.getByTestId('maximise-layer');
    const moved = layer.querySelector<HTMLElement>('.preview-diagram-frame__layer')!;
    expect(moved).not.toBeNull();
    expect(moved.querySelector('svg')).toBeTruthy();
    expect(moved.style.transform).toContain('scale(0.625)');
    // Its place in the document is kept empty, not collapsed.
    expect(frame().querySelector('.preview-diagram-frame__layer')).toBeNull();
  });

  it('its control becomes Minimise, which — like Esc — returns it to its place with the same zoom', () => {
    const { frame } = mountWithLayer();
    fireEvent.click(within(frame()).getByTitle(/^Zoom in \(/));
    fireEvent.click(within(frame()).getByTitle('Enter Focus Mode'));
    const inLayer = within(screen.getByTestId('maximise-layer'));
    expect(inLayer.queryByTitle('Restore')).toBeNull();
    expect(inLayer.queryByTitle('Enter Focus Mode')).toBeNull();
    fireEvent.click(inLayer.getByTitle('Exit Focus Mode'));

    expect(getMaximiseStack('t1')).toEqual([]);
    expect(screen.queryByTestId('maximise-layer')).toBeNull();
    expect(frame().querySelector<HTMLElement>('.preview-diagram-frame__layer')!.style.transform).toContain('scale(0.625)');

    fireEvent.click(within(frame()).getByTitle('Enter Focus Mode'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(getMaximiseStack('t1')).toEqual([]);
    expect(frame().querySelector('svg')).toBeTruthy();
  });

  it('centres the diagram in the maximised viewport on both axes (A4)', () => {
    const { frame } = mountWithLayer();
    fireEvent.click(within(frame()).getByTitle(/^Zoom in \(/)); // scale 0.625 → 500×187.5
    box = { width: 600, height: 400 }; // the maximised viewport is bigger than the inline one
    fireEvent.click(within(frame()).getByTitle('Enter Focus Mode'));

    const moved = screen.getByTestId('maximise-layer').querySelector<HTMLElement>('.preview-diagram-frame__layer')!;
    expect(moved.style.transform).toBe('translate(50px, 106.25px) scale(0.625)');
  });

  it('a diagram maximised in Fit is fitted to, and centred in, the maximised viewport (A4)', () => {
    const { frame } = mountWithLayer();
    box = { width: 600, height: 400 };
    fireEvent.click(within(frame()).getByTitle('Enter Focus Mode'));

    const moved = screen.getByTestId('maximise-layer').querySelector<HTMLElement>('.preview-diagram-frame__layer')!;
    // 600 / 800 = 0.75 → 600×225 in 600×400.
    expect(moved.style.transform).toBe('translate(0px, 87.5px) scale(0.75)');
  });

  it('a frame that unmounts (its tab switched away) keeps the target, and the remounted frame fills the layer again (FR-073)', () => {
    const { view, frame } = mountWithLayer();
    fireEvent.click(within(frame()).getByTitle('Enter Focus Mode'));

    // Tab away: the panel, and so the frame, unmounts. The target is the tab's, not the frame's.
    view.rerender(createElement('div', null, createElement(MaximiseLayer, { tabId: 't1' })));
    expect(getMaximiseStack('t1')).toEqual([expect.objectContaining({ kind: 'section', sectionId: 'diagram-0' })]);

    // Tab back: a new frame for the same section takes the layer over.
    view.rerender(
      createElement(
        'div',
        null,
        createElement(DiagramFrame, { svg: svgOf(800, 300), panelId: 'p1', sectionId: 'diagram-0' }),
        createElement(MaximiseLayer, { tabId: 't1' }),
      ),
    );
    expect(screen.getByTestId('maximise-layer').querySelector('.preview-diagram-frame__layer svg')).toBeTruthy();
    expect(getMaximiseStack('t1')).toHaveLength(1);
  });
});

/** A5 — panel zoom redirects to the diagram that has keyboard focus (the callers are `diagram-focus-zoom.test.ts`'s). */
describe('panel zoom while a diagram has focus (A5)', () => {
  // The reset is Fit, the diagram's default view (manual test change request, 2026-10-13); Zoom 100% is the
  // toolbar's.
  it('a focused diagram zooms in, out and back to Fit — and the frame is focusable to begin with', () => {
    const { frame, viewport } = mount(800, 300);
    expect(viewport().tabIndex).toBe(0);
    viewport().focus();

    expect(zoomFocusedDiagram('in')).toBe(true);
    expect(frame().getAttribute('data-mode')).toBe('zoom');
    expect(Number(frame().getAttribute('data-scale'))).toBeCloseTo(0.625);
    expect(zoomFocusedDiagram('out')).toBe(true);
    expect(Number(frame().getAttribute('data-scale'))).toBeCloseTo(0.5);
    expect(zoomFocusedDiagram('in')).toBe(true);
    expect(zoomFocusedDiagram('reset')).toBe(true);
    expect(frame().getAttribute('data-mode')).toBe('fit');
    expect(Number(frame().getAttribute('data-scale'))).toBe(0.5);
  });

  it('focus on one of the frame’s own buttons counts as the diagram having focus', () => {
    const { frame, button } = mount(800, 300);
    button('Fit diagram').focus();
    expect(zoomFocusedDiagram('in')).toBe(true);
    expect(Number(frame().getAttribute('data-scale'))).toBeCloseTo(0.625);
  });

  it('with focus anywhere else it declines, so the caller zooms the panel as before', () => {
    const { frame } = mount(800, 300);
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    elsewhere.focus();
    expect(zoomFocusedDiagram('in')).toBe(false);
    expect(Number(frame().getAttribute('data-scale'))).toBe(0.5);
    elsewhere.remove();
  });

  it('after the frame unmounts, nothing is left registered to zoom', () => {
    const { view, viewport } = mount(800, 300);
    const stale = viewport();
    stale.focus();
    view.unmount();
    document.body.append(stale);
    stale.focus();
    expect(zoomFocusedDiagram('in', stale)).toBe(false);
    stale.remove();
  });

  it('a maximised diagram zooms the same state from inside the maximise layer', () => {
    render(
      createElement(
        'div',
        null,
        createElement(DiagramFrame, { svg: svgOf(800, 300), panelId: 'p1', sectionId: 'diagram-0' }),
        createElement(MaximiseLayer, { tabId: 't1' }),
      ),
    );
    fireEvent.click(within(screen.getByTestId('diagram-frame-p1-diagram-0')).getByTitle('Enter Focus Mode'));
    const pane = screen.getByTestId('maximise-layer');
    pane.querySelector<HTMLElement>('.preview-diagram-frame__viewport')!.focus();
    expect(zoomFocusedDiagram('in')).toBe(true);
    expect(pane.querySelector<HTMLElement>('.preview-diagram-frame__layer')!.style.transform).toContain('scale(0.');
    expect(pane.querySelector<HTMLElement>('.preview-diagram-frame__layer')!.style.transform).not.toContain('scale(0.5)');
  });
});
