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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DIAGRAM_MAX_SCALE,
  DIAGRAM_MIN_SCALE,
  DiagramFrame,
  MIN_READABLE_SCALE,
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
  const button = (title: string): HTMLElement => within(frame()).getByTitle(title);
  return { view, frame, layer, viewport, button };
}

describe('the toolbar (FR-046b, FR-046h)', () => {
  it('holds Fit, Zoom In, Zoom 100%, Zoom Out and Maximise, in that order, each a focusable titled button', () => {
    const { frame } = mount();
    const toolbar = within(frame()).getByRole('toolbar');
    const buttons = within(toolbar).getAllByRole('button');
    // Zoom 100% sits between the two zoom steps (A2); there is no "Fill the panel" any more.
    expect(buttons.map((b) => b.getAttribute('title'))).toEqual([
      'Fit diagram',
      'Zoom in',
      'Zoom 100%',
      'Zoom out',
      'Maximise',
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

  it('stops at the minimum readable scale and scrolls sideways below it', () => {
    const { frame } = mount(4000, 300);
    expect(Number(frame().getAttribute('data-scale'))).toBe(MIN_READABLE_SCALE);
    expect(frame().classList.contains('preview-diagram-frame--scrolls')).toBe(true);
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

  it('works alongside Fit: Fit puts the shrunk view back, Zoom 100% the actual one', () => {
    const { frame, button } = mount(800, 300);
    fireEvent.click(button('Zoom 100%'));
    fireEvent.click(button('Fit diagram'));
    expect(frame().getAttribute('data-mode')).toBe('fit');
    expect(Number(frame().getAttribute('data-scale'))).toBe(0.5);
    fireEvent.click(button('Zoom 100%'));
    expect(Number(frame().getAttribute('data-scale'))).toBe(1);
  });

  it('brings the diagram back to the centre of the viewport, as Fit does', () => {
    const { layer, viewport, button } = mount(800, 300);
    fireEvent.click(button('Zoom in'));
    fireEvent.pointerDown(viewport(), { button: 1, buttons: 4, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(viewport(), { buttons: 4, clientX: 20, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(viewport(), { button: 1, clientX: 20, clientY: 40, pointerId: 1 });
    fireEvent.click(button('Zoom 100%'));
    // 400×200 box, 800×300 diagram at 1:1 → half of the overhang off each side.
    expect(layer().style.transform).toBe('translate(-200px, -50px) scale(1)');
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
    // box 400×200, diagram 200×100 at 1:1 → (400−200)/2, (200−100)/2.
    expect(layer().style.transform).toBe('translate(100px, 50px) scale(1)');
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
    // Centred at scale 0.625 (500×187.5 in 400×200) is (−50, 6.25); the drag moves it by (−30, −10) from there.
    expect(layer().style.transform).toContain('translate(-80px, -3.75px)');
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
    fireEvent.click(within(frame()).getByTitle('Zoom in'));
    fireEvent.click(within(frame()).getByTitle('Maximise'));

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
    fireEvent.click(within(frame()).getByTitle('Zoom in'));
    fireEvent.click(within(frame()).getByTitle('Maximise'));
    const inLayer = within(screen.getByTestId('maximise-layer'));
    expect(inLayer.queryByTitle('Restore')).toBeNull();
    expect(inLayer.queryByTitle('Maximise')).toBeNull();
    fireEvent.click(inLayer.getByTitle('Minimise'));

    expect(getMaximiseStack('t1')).toEqual([]);
    expect(screen.queryByTestId('maximise-layer')).toBeNull();
    expect(frame().querySelector<HTMLElement>('.preview-diagram-frame__layer')!.style.transform).toContain('scale(0.625)');

    fireEvent.click(within(frame()).getByTitle('Maximise'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(getMaximiseStack('t1')).toEqual([]);
    expect(frame().querySelector('svg')).toBeTruthy();
  });

  it('centres the diagram in the maximised viewport on both axes (A4)', () => {
    const { frame } = mountWithLayer();
    fireEvent.click(within(frame()).getByTitle('Zoom in')); // scale 0.625 → 500×187.5
    box = { width: 600, height: 400 }; // the maximised viewport is bigger than the inline one
    fireEvent.click(within(frame()).getByTitle('Maximise'));

    const moved = screen.getByTestId('maximise-layer').querySelector<HTMLElement>('.preview-diagram-frame__layer')!;
    expect(moved.style.transform).toBe('translate(50px, 106.25px) scale(0.625)');
  });

  it('a diagram maximised in Fit is fitted to, and centred in, the maximised viewport (A4)', () => {
    const { frame } = mountWithLayer();
    box = { width: 600, height: 400 };
    fireEvent.click(within(frame()).getByTitle('Maximise'));

    const moved = screen.getByTestId('maximise-layer').querySelector<HTMLElement>('.preview-diagram-frame__layer')!;
    // 600 / 800 = 0.75 → 600×225 in 600×400.
    expect(moved.style.transform).toBe('translate(0px, 87.5px) scale(0.75)');
  });

  it('a frame that unmounts (its tab switched away) keeps the target, and the remounted frame fills the layer again (FR-073)', () => {
    const { view, frame } = mountWithLayer();
    fireEvent.click(within(frame()).getByTitle('Maximise'));

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
  it('a focused diagram zooms in, out and to 100% — and the frame is focusable to begin with', () => {
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
    expect(Number(frame().getAttribute('data-scale'))).toBe(1);
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
    fireEvent.click(within(screen.getByTestId('diagram-frame-p1-diagram-0')).getByTitle('Maximise'));
    const pane = screen.getByTestId('maximise-layer');
    pane.querySelector<HTMLElement>('.preview-diagram-frame__viewport')!.focus();
    expect(zoomFocusedDiagram('in')).toBe(true);
    expect(pane.querySelector<HTMLElement>('.preview-diagram-frame__layer')!.style.transform).toContain('scale(0.');
    expect(pane.querySelector<HTMLElement>('.preview-diagram-frame__layer')!.style.transform).not.toContain('scale(0.5)');
  });
});
