/**
 * The monitor explains itself in place (055 FR-092): a header naming where the user is, with a Back
 * button and what the rows are sorted by; column headers over the rows with the chosen metric's marked; visible
 * labels on the metric choice and the capture interval; and a count of what the filter matched and of the
 * idle processes hidden.
 *
 * Layer: component — the real `Breakdown` and `ToolbarControls` over the real session store.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Breakdown } from '../../../src/renderer/resources/breakdown.js';
import { MonitorLocation } from '../../../src/renderer/resources/monitor-location.js';
import { __resetSession, getSelection, getView, ingestFrame, setSelection, setView, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { ToolbarControls } from '../../../src/renderer/resources/toolbar.js';
import { NETWORK_ELEVATION_REQUIRED, NETWORK_TRACE_FAILED, unavailable } from '@throng/core';
import { frame, sampleHierarchy, withNetwork } from '../helpers/resource-fixtures.js';


beforeEach(() => {
  __resetSession();
  startSession({ intervalSeconds: 2, historyMinutes: 5 });
  act(() => ingestFrame(frame(1, sampleHierarchy())));
});
afterEach(() => __resetSession());

const mount = (): void =>
  void render(createElement(Fragment, null, createElement(MonitorLocation), createElement(Breakdown), createElement(ToolbarControls)));

describe('the header (FR-092, FR-099)', () => {
  it('has a Back button, disabled at the top', () => {
    mount();
    const back = screen.getByTestId('breakdown-back');
    expect(back).toBeDisabled();
    expect(back).toHaveAttribute('title', 'Back');
  });

  it('has no "Ordered by" header: the marked column and the Order by control say it (FR-117)', () => {
    mount();
    expect(screen.queryByTestId('breakdown-sorted-by')).toBeNull();
    expect(screen.queryByTestId('breakdown-header')).toBeNull();
    expect(screen.getByTestId('breakdown')).not.toHaveTextContent(/Ordered by/);
    act(() => setView({ metric: 'memory' }));
    expect(screen.getByTestId('breakdown')).not.toHaveTextContent(/Ordered by/);
    // What says it instead: the chosen column is marked, and the Order by control is pressed.
    expect(screen.getByTestId('breakdown-column-memory')).toHaveAttribute('data-chosen', 'true');
    expect(screen.getByTestId('monitor-metric-memory')).toHaveAttribute('aria-pressed', 'true');
  });

  it('goes up one level on Back, and clears the selection', () => {
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1', 't:t1'] }));
    act(() => setSelection('n:n2'));
    const back = screen.getByTestId('breakdown-back');
    expect(back).toBeEnabled();

    fireEvent.click(back);

    expect(getView().focusPath).toEqual(['root', 'c:projects', 'p:p1']);
    expect(getSelection()).toBeNull();
  });

  it('is a Tab stop of the header’s breadcrumb, not of the list (FR-112)', () => {
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects'] }));
    const back = screen.getByTestId('breakdown-back');
    expect(back).not.toHaveAttribute('tabindex', '-1');
    expect(screen.getByTestId('breakdown').contains(back)).toBe(false);
  });

  it('names the level the list shows when a filter has taken the focused node away', () => {
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1'], filterText: 'no-such-thing' }));
    const labels = within(screen.getByTestId('breadcrumb')).getAllByRole('button').map((b) => b.textContent);
    expect(labels).not.toContain('Alpha');
  });

  it('keeps the breadcrumb (a segment is still a way back to that level)', () => {
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1'] }));
    const labels = within(screen.getByTestId('breadcrumb')).getAllByRole('button').map((b) => b.textContent);
    expect(labels).toEqual(['throng', 'Projects', 'Alpha']);
  });
});

describe('column headers over the rows (FR-092, FR-099)', () => {
  const columns = (section: string): HTMLElement[] => within(screen.getByTestId(`breakdown-columns-${section}`)).getAllByTestId(/^breakdown-column-/);
  const header = (id: string): HTMLElement => screen.getByTestId(`breakdown-column-${id}`);

  it('names Trend, CPU, Memory, GPU, I/O and Network over the rows', () => {
    mount();
    expect(columns('components').map((c) => c.textContent)).toEqual(['Trend', 'CPU', 'Memory', 'GPU', 'I/O', 'Network']);
  });

  it('makes each metric’s header a button that orders by it; Trend is not one', () => {
    mount();
    for (const id of ['cpu', 'memory', 'gpu', 'io', 'network']) {
      expect(header(id).tagName.toLowerCase(), id).toBe('button');
      // Reachable from the keyboard: a real button, not taken out of the Tab order.
      expect(header(id)).not.toHaveAttribute('tabindex', '-1');
      expect(header(id).getAttribute('title')).toBe(`Order by ${header(id).textContent}`);
    }
    expect(header('trend').tagName.toLowerCase()).not.toBe('button');
  });

  it('orders by Memory on a click of its header: marked there, and shown by the toolbar’s Order by (US2 scenario 20)', () => {
    mount();
    fireEvent.click(header('memory'));

    expect(getView().metric).toBe('memory');
    expect(header('memory')).toHaveAttribute('data-chosen', 'true');
    expect(header('memory')).toHaveAttribute('aria-pressed', 'true');
    expect(header('cpu')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('monitor-metric-memory')).toHaveAttribute('aria-pressed', 'true');
  });

  it('marks the chosen metric’s column, and moves the mark with the choice', () => {
    mount();
    const chosen = (): (string | null)[] => columns('components').filter((c) => c.getAttribute('data-chosen') === 'true').map((c) => c.getAttribute('data-column'));
    expect(chosen()).toEqual(['cpu']);

    act(() => setView({ metric: 'gpu' }));
    expect(chosen()).toEqual(['gpu']);
  });

  it('is sticky, so it stays over the rows when the list scrolls', () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/theme.css'), 'utf8');
    expect(/\.breakdown__columns\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').toMatch(/position:\s*sticky/);
  });
});

describe('ordering by Network (FR-099, FR-113)', () => {
  const network = (): HTMLElement => screen.getByTestId('breakdown-column-network');

  it('is disabled while throng is not elevated, titled “Elevate to show”', () => {
    act(() => ingestFrame(frame(2, withNetwork(sampleHierarchy(), unavailable(NETWORK_ELEVATION_REQUIRED)))));
    mount();
    expect(network()).toBeDisabled();
    expect(network()).toHaveAttribute('title', 'Elevate to show');
  });

  it('is disabled, titled “Network unavailable”, when the trace failed', () => {
    act(() => ingestFrame(frame(2, withNetwork(sampleHierarchy(), unavailable(NETWORK_TRACE_FAILED)))));
    mount();
    expect(network()).toBeDisabled();
    expect(network()).toHaveAttribute('title', 'Network unavailable');
  });

  it('orders by CPU while a chosen Network is not measured, and by Network again once it is (derived)', () => {
    act(() => setView({ metric: 'network' }));
    act(() => ingestFrame(frame(2, withNetwork(sampleHierarchy(), unavailable(NETWORK_ELEVATION_REQUIRED)))));
    mount();
    expect(screen.getByTestId('breakdown-column-cpu')).toHaveAttribute('data-chosen', 'true');
    // The choice is kept, to come back to.
    expect(getView().metric).toBe('network');

    act(() => ingestFrame(frame(3, withNetwork(sampleHierarchy(), 1024))));
    expect(screen.getByTestId('breakdown-column-network')).toHaveAttribute('data-chosen', 'true');
  });
});

describe('labels on the toolbar’s choices (FR-092, FR-099)', () => {
  it('says “Order by” over the metric buttons and “Capture every” by the interval', () => {
    mount();
    expect(screen.getByTestId('monitor-size-by-label')).toHaveTextContent('Order by');
    expect(screen.getByTestId('monitor-interval-label')).toHaveTextContent('Capture every');
    // The visible words are the controls' names too, not a second label beside an unnamed control.
    expect(screen.getByRole('group', { name: 'Order by' })).toBeInTheDocument();
    expect(screen.getByLabelText('Capture every')).toBe(screen.getByTestId('monitor-interval'));
  });
});

describe('what the filter and Hide idle did (FR-092)', () => {
  it('counts what the filter matched', () => {
    mount();
    act(() => setView({ filterText: 'node' }));
    expect(screen.getByTestId('breakdown-filter-status')).toHaveTextContent("2 processes match 'node'");
  });

  it('counts one in the singular', () => {
    mount();
    act(() => setView({ filterText: 'pwsh' }));
    expect(screen.getByTestId('breakdown-filter-status')).toHaveTextContent("1 process matches 'pwsh'");
  });

  it('says so when the filter matches nothing, instead of an empty list', () => {
    mount();
    act(() => setView({ filterText: 'zzz' }));
    const status = screen.getByTestId('breakdown-filter-status');
    expect(status).toHaveTextContent("No process matches 'zzz'");
    expect(status).toHaveAttribute('role', 'status');
  });

  it('says nothing about the filter when there is none', () => {
    mount();
    expect(screen.queryByTestId('breakdown-filter-status')).toBeNull();
  });

  it('counts the idle processes Hide idle left out', () => {
    // Three frames of nothing: conhost.exe (0% CPU, no I/O) is idle; the others are not.
    act(() => ingestFrame(frame(2, sampleHierarchy())));
    act(() => ingestFrame(frame(3, sampleHierarchy())));
    mount();
    expect(screen.queryByTestId('breakdown-idle-status')).toBeNull();

    act(() => setView({ hideIdle: true }));

    expect(screen.getByTestId('breakdown-idle-status')).toHaveTextContent(/^1 idle process hidden$/);
  });
});
