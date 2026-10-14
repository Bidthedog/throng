/**
 * #486 (054 manual test change request, 2026-10-13) — a zoom step shows the new zoom as a percentage in the
 * top-right of whatever zoomed: the editor or preview panel, or the diagram's own box. It fades in, holds,
 * fades out slowly, as browsers do; a further step while it shows updates the figure and restarts the hold.
 * It has no controls and never takes the pointer or focus.
 *
 * Layer: component — the cue (what makes it show, which figure, for how long) is what a test can hold; the
 * fade itself is CSS, held by its declared rule in unit/zoom-indicator-css.test.ts and looked at by hand in MT-10.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { stepZoomLevel, zoomFactor } from '@throng/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiagramFrame } from '../../src/renderer/preview/diagram/diagram-frame.js';
import { ZOOM_INDICATOR_HOLD_MS, ZoomIndicator } from '../../src/renderer/workspace/zoom-indicator.js';
import { COLD, README, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const SHOWN = 'zoom-indicator--shown';

afterEach(() => {
  vi.useRealTimers();
});

describe('the indicator', () => {
  it('stays hidden until cued, then shows the figure, holds, and hides', () => {
    vi.useFakeTimers();
    const { rerender } = render(createElement(ZoomIndicator, { percent: 100, cue: 0, testId: 'zi' }));
    const el = screen.getByTestId('zi');
    expect(el).not.toHaveClass(SHOWN);

    rerender(createElement(ZoomIndicator, { percent: 120, cue: 1, testId: 'zi' }));
    expect(el).toHaveClass(SHOWN);
    expect(el).toHaveTextContent('120%');

    act(() => vi.advanceTimersByTime(ZOOM_INDICATOR_HOLD_MS));
    expect(el).not.toHaveClass(SHOWN);
  });

  it('a further step while it shows updates the figure and restarts the hold', () => {
    vi.useFakeTimers();
    const { rerender } = render(createElement(ZoomIndicator, { percent: 120, cue: 1, testId: 'zi' }));
    act(() => vi.advanceTimersByTime(ZOOM_INDICATOR_HOLD_MS - 100));
    rerender(createElement(ZoomIndicator, { percent: 144, cue: 2, testId: 'zi' }));
    act(() => vi.advanceTimersByTime(ZOOM_INDICATOR_HOLD_MS - 100));
    const el = screen.getByTestId('zi');
    expect(el).toHaveClass(SHOWN);
    expect(el).toHaveTextContent('144%');
  });

  it('carries no controls and is hidden from assistive technology and the pointer', () => {
    render(createElement(ZoomIndicator, { percent: 120, cue: 1, testId: 'zi' }));
    const el = screen.getByTestId('zi');
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0);
  });
});

describe('a diagram’s zoom', () => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function mount() {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.setAttribute('viewBox', '0 0 400 200');
    render(createElement(DiagramFrame, { svg, panelId: 'p1', sectionId: 'diagram-0' }));
    const frame = screen.getByTestId('diagram-frame-p1-diagram-0');
    return { frame, indicator: () => within(frame).getByTestId('diagram-zoom-indicator-p1-diagram-0') };
  }

  it('shows nothing when the diagram is drawn, and its new scale on each zoom step, in its own box', () => {
    const { frame, indicator } = mount();
    expect(indicator()).not.toHaveClass(SHOWN);
    fireEvent.click(within(frame).getByTitle('Zoom 100%'));
    expect(indicator()).toHaveClass(SHOWN);
    expect(indicator()).toHaveTextContent('100%');
    fireEvent.click(within(frame).getByTitle('Zoom in'));
    expect(indicator()).toHaveTextContent('125%');
  });
});

describe('a panel’s zoom', () => {
  let m: MountedPreviewWindow | undefined;
  afterEach(() => {
    m?.unmount();
    m = undefined;
  });

  it('a preview panel shows its new zoom in its top-right corner, and nothing when it opens', async () => {
    m = await mountMarkdownPreview('# Doc\n\nbody text\n', README);
    await screen.findByText('body text', {}, COLD);
    const indicator = (): HTMLElement => screen.getByTestId(`panel-zoom-indicator-${m!.id}`);
    expect(indicator()).not.toHaveClass(SHOWN);
    act(() => m!.ws().bumpZoom(m!.id, 1));
    expect(indicator()).toHaveClass(SHOWN);
    expect(indicator()).toHaveTextContent(`${Math.round(zoomFactor(stepZoomLevel(0, 1)) * 100)}%`);
    act(() => m!.ws().resetZoom(m!.id));
    expect(indicator()).toHaveTextContent('100%');
  });
});
