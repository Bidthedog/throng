/**
 * 054 (manual test change requests, 2026-10-12) — a right-click on a diagram: it takes focus, and the menu
 * finds that diagram's actions — Copy Diagram as Image, and Enter / Exit Focus Mode (the diagram's own
 * inline; the panel's for a standalone `.mmd` preview, which has no inline Focus Mode). Entering a diagram's
 * Focus Mode puts focus in it; entering a panel's puts focus in the panel.
 *
 * Layer: component — the real `DiagramFrame` and maximise layer; the rasteriser and the clipboard bridge are
 * fakes (jsdom has no canvas, and the clipboard is main's, covered by `clipboard-ipc.test.ts`).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/preview/diagram/rasterise.js', () => ({
  rasteriseSvg: vi.fn(() => Promise.resolve('data:image/png;base64,AAAA')),
}));

const { DiagramFrame } = await import('../../src/renderer/preview/diagram/diagram-frame.js');
const { diagramActionsAt } = await import('../../src/renderer/preview/diagram/diagram-actions.js');
const { MaximiseLayer } = await import('../../src/renderer/workspace/maximise-layer.js');
const { __resetMaximise, getMaximiseStack, maximisePanel, registerPanelTabResolver } = await import(
  '../../src/renderer/workspace/maximise-store.js'
);
const { registerPanelFocus, unregisterPanelFocus } = await import('../../src/renderer/workspace/panel-focus.js');

function svgOf(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 200 100');
  return svg;
}

let unresolve: (() => void) | null = null;
const writeImage = vi.fn(() => Promise.resolve());

beforeEach(() => {
  unresolve = registerPanelTabResolver(() => 't1');
  writeImage.mockClear();
  (window as unknown as { throng: unknown }).throng = { clipboard: { writeImage } };
});

afterEach(() => {
  unresolve?.();
  __resetMaximise();
  delete (window as unknown as { throng?: unknown }).throng;
});

function mount(maximisable = true) {
  render(
    createElement(
      'div',
      null,
      createElement(DiagramFrame, { svg: svgOf(), panelId: 'p1', sectionId: 'diagram-0', maximisable }),
      createElement(MaximiseLayer, { tabId: 't1' }),
    ),
  );
  const viewport = (): HTMLElement =>
    screen.getAllByRole('group', { name: 'Diagram' }).at(-1) as HTMLElement;
  return { viewport };
}

describe('a right-click on a diagram', () => {
  it('gives the diagram focus', () => {
    const { viewport } = mount();
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.contextMenu(viewport());
    expect(document.activeElement).toBe(viewport());
  });

  it('finds the diagram’s actions, whose Copy puts its PNG on the clipboard', async () => {
    const { viewport } = mount();
    const actions = diagramActionsAt(viewport());
    expect(actions).not.toBeNull();
    await act(async () => actions!.copyImage());
    expect(writeImage).toHaveBeenCalledWith({ dataUri: 'data:image/png;base64,AAAA' });
  });

  it('an inline diagram’s Focus Mode is its own, and entering it focuses the maximised diagram', () => {
    const { viewport } = mount();
    const actions = diagramActionsAt(viewport())!;
    expect(actions.inFocus()).toBe(false);
    act(() => actions.toggleFocus());
    expect(getMaximiseStack('t1')).toEqual([expect.objectContaining({ kind: 'section', sectionId: 'diagram-0' })]);
    expect(diagramActionsAt(viewport())!.inFocus()).toBe(true);
    expect(screen.getByTestId('maximise-layer').contains(document.activeElement), 'focus is in the maximised diagram').toBe(true);
  });

  it('a .mmd preview’s diagram enters its PANEL’s Focus Mode instead', () => {
    const { viewport } = mount(false);
    act(() => diagramActionsAt(viewport())!.toggleFocus());
    expect(getMaximiseStack('t1')).toEqual([{ kind: 'panel', panelId: 'p1' }]);
    expect(diagramActionsAt(viewport())!.inFocus()).toBe(true);
  });

  it('outside any diagram, there are no diagram actions', () => {
    mount();
    expect(diagramActionsAt(document.body)).toBeNull();
  });
});

describe('entering a panel’s Focus Mode', () => {
  it('moves focus into that panel', () => {
    const focus = vi.fn();
    registerPanelFocus('p9', focus);
    try {
      act(() => maximisePanel('t1', 'p9'));
      expect(focus).toHaveBeenCalled();
    } finally {
      unregisterPanelFocus('p9');
    }
  });
});
