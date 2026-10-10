/**
 * 054 T038 — a diagram's view controls (FR-046a – FR-046h, research R6, contracts/menus-commands-controls-054.md
 * "Diagram frame toolbar").
 *
 * Layer: component — the frame's view state, its toolbar, its pointer handling and the classes it sets are
 * all in what it renders. jsdom has no layout, so the viewport's width is stubbed and the SVG's natural size
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
import { MaximiseLayer } from '../../src/renderer/workspace/maximise-layer.js';
import {
  __resetMaximise,
  getMaximiseStack,
  registerPanelTabResolver,
} from '../../src/renderer/workspace/maximise-store.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgOf(width: number, height: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.appendChild(document.createElementNS(SVG_NS, 'rect'));
  return svg;
}

let viewportWidth = 400;
let restoreWidth: (() => void) | null = null;

let unresolve: (() => void) | null = null;

beforeEach(() => {
  // The window's workspace store answers which tab holds a panel; here every panel is in tab `t1`.
  unresolve = registerPanelTabResolver(() => 't1');
  viewportWidth = 400;
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('preview-diagram-frame') ? viewportWidth : 0;
    },
  });
  restoreWidth = () => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original);
  };
});

afterEach(() => {
  restoreWidth?.();
  unresolve?.();
  __resetMaximise();
});

function mount(width = 800, height = 300) {
  const view = render(createElement(DiagramFrame, { svg: svgOf(width, height), panelId: 'p1', sectionId: 'diagram-0' }));
  const frame = (): HTMLElement => screen.getByTestId('diagram-frame-p1-diagram-0');
  const layer = (): HTMLElement => frame().querySelector<HTMLElement>('.preview-diagram-frame__layer')!;
  const button = (title: string): HTMLElement => within(frame()).getByTitle(title);
  return { view, frame, layer, button };
}

describe('the toolbar (FR-046b, FR-046h)', () => {
  it('holds Fit, Full Size, Zoom In, Zoom Out and Full Pane, in that order, each a focusable titled button', () => {
    const { frame } = mount();
    const toolbar = within(frame()).getByRole('toolbar');
    const buttons = within(toolbar).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('title'))).toEqual([
      'Fit diagram',
      'Fill the panel',
      'Zoom in',
      'Zoom out',
      'Fill the middle section',
    ]);
    for (const b of buttons) {
      b.focus();
      expect(document.activeElement).toBe(b);
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

describe('panning (FR-046e)', () => {
  it('a middle-button drag pans the diagram and prevents the platform autoscroll', () => {
    const { frame, layer, button } = mount(800, 300);
    fireEvent.click(button('Zoom in'));
    const viewport = frame().querySelector<HTMLElement>('.preview-diagram-frame__viewport')!;

    const down = fireEvent.pointerDown(viewport, { button: 1, buttons: 4, clientX: 100, clientY: 100, pointerId: 1 });
    const mouseDown = fireEvent.mouseDown(viewport, { button: 1 });
    fireEvent.pointerMove(viewport, { buttons: 4, clientX: 70, clientY: 90, pointerId: 1 });
    fireEvent.pointerUp(viewport, { button: 1, clientX: 70, clientY: 90, pointerId: 1 });

    expect(down).toBe(false);
    expect(mouseDown).toBe(false);
    expect(layer().style.transform).toContain('translate(-30px, -10px)');
  });

  it('a primary-button drag does not pan (it selects, as anywhere in a preview)', () => {
    const { frame, layer } = mount(800, 300);
    const viewport = frame().querySelector<HTMLElement>('.preview-diagram-frame__viewport')!;
    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(viewport, { buttons: 1, clientX: 50, clientY: 50, pointerId: 1 });
    expect(layer().style.transform).toContain('translate(0px, 0px)');
  });
});

describe('Full Size (FR-046d)', () => {
  it('fills the panel, and Full Size again — or Fit — puts the box back in the document', () => {
    const { frame, button } = mount();
    fireEvent.click(button('Fill the panel'));
    expect(frame().classList.contains('preview-diagram-frame--full-size')).toBe(true);
    fireEvent.click(button('Fill the panel'));
    expect(frame().classList.contains('preview-diagram-frame--full-size')).toBe(false);
    fireEvent.click(button('Fill the panel'));
    fireEvent.click(button('Fit diagram'));
    expect(frame().classList.contains('preview-diagram-frame--full-size')).toBe(false);
  });
});

describe('view state is view state only (FR-046g)', () => {
  it('a remount starts from Fit again', () => {
    const first = mount(800, 300);
    fireEvent.click(first.button('Zoom in'));
    fireEvent.click(first.button('Fill the panel'));
    first.view.unmount();

    const second = mount(800, 300);
    expect(second.frame().getAttribute('data-mode')).toBe('fit');
    expect(second.frame().classList.contains('preview-diagram-frame--full-size')).toBe(false);
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

/** 054 T067 (preview half) — Full Pane through the one maximise mechanism (FR-046f, R7). */
describe('Full Pane (FR-046f)', () => {
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
    fireEvent.click(within(frame()).getByTitle('Fill the middle section'));

    expect(getMaximiseStack('t1')).toEqual([expect.objectContaining({ kind: 'section', panelId: 'p1', sectionId: 'diagram-0' })]);
    const layer = screen.getByTestId('maximise-layer');
    const moved = layer.querySelector<HTMLElement>('.preview-diagram-frame__layer')!;
    expect(moved).not.toBeNull();
    expect(moved.querySelector('svg')).toBeTruthy();
    expect(moved.style.transform).toContain('scale(0.625)');
    // Its place in the document is kept empty, not collapsed.
    expect(frame().querySelector('.preview-diagram-frame__layer')).toBeNull();
  });

  it('its control becomes Restore, which — like Esc — returns it to its place with the same zoom', () => {
    const { frame } = mountWithLayer();
    fireEvent.click(within(frame()).getByTitle('Zoom in'));
    fireEvent.click(within(frame()).getByTitle('Fill the middle section'));
    fireEvent.click(within(screen.getByTestId('maximise-layer')).getByTitle('Restore'));

    expect(getMaximiseStack('t1')).toEqual([]);
    expect(screen.queryByTestId('maximise-layer')).toBeNull();
    expect(frame().querySelector<HTMLElement>('.preview-diagram-frame__layer')!.style.transform).toContain('scale(0.625)');

    fireEvent.click(within(frame()).getByTitle('Fill the middle section'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(getMaximiseStack('t1')).toEqual([]);
    expect(frame().querySelector('svg')).toBeTruthy();
  });

  it('a frame that unmounts (its tab switched away) keeps the target, and the remounted frame fills the layer again (FR-073)', () => {
    const { view, frame } = mountWithLayer();
    fireEvent.click(within(frame()).getByTitle('Fill the middle section'));

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
