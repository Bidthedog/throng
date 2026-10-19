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
import { __resetSession, getSelection, getView, ingestFrame, setSelection, setView, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { ToolbarControls } from '../../../src/renderer/resources/toolbar.js';
import { frame, sampleHierarchy } from '../helpers/resource-fixtures.js';


beforeEach(() => {
  __resetSession();
  startSession({ intervalSeconds: 2, historyMinutes: 5 });
  act(() => ingestFrame(frame(1, sampleHierarchy())));
});
afterEach(() => __resetSession());

const mount = (): void => void render(createElement(Fragment, null, createElement(Breakdown), createElement(ToolbarControls)));

describe('the header (FR-092)', () => {
  it('has a Back button, disabled at the top, and says what the rows are sorted by', () => {
    mount();
    const back = screen.getByTestId('breakdown-back');
    expect(back).toBeDisabled();
    expect(back).toHaveAttribute('title', 'Back');
    expect(screen.getByTestId('breakdown-sorted-by')).toHaveTextContent('Sorted by CPU');
  });

  it('names the metric the rows are sorted by as it changes', () => {
    mount();
    act(() => setView({ metric: 'memory' }));
    expect(screen.getByTestId('breakdown-sorted-by')).toHaveTextContent('Sorted by Memory');
    act(() => setView({ metric: 'io' }));
    expect(screen.getByTestId('breakdown-sorted-by')).toHaveTextContent('Sorted by I/O');
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

  it('is one Tab stop with the rest of the breakdown: Back is reached with the mouse', () => {
    mount();
    expect(screen.getByTestId('breakdown-back')).toHaveAttribute('tabindex', '-1');
  });

  it('keeps the breadcrumb (a segment is still a way back to that level)', () => {
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1'] }));
    const labels = within(screen.getByTestId('breadcrumb')).getAllByRole('button').map((b) => b.textContent);
    expect(labels).toEqual(['throng', 'Projects', 'Alpha']);
  });
});

describe('column headers over the rows (FR-092)', () => {
  const columns = (section: string): HTMLElement[] => within(screen.getByTestId(`breakdown-columns-${section}`)).getAllByTestId(/^breakdown-column-/);

  it('names Trend, CPU, Memory, GPU and I/O over each section’s rows', () => {
    mount();
    for (const section of ['components', 'projects']) {
      expect(columns(section).map((c) => c.textContent)).toEqual(['Trend', 'CPU', 'Memory', 'GPU', 'I/O']);
    }
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

  it('is decoration for assistive technology — each figure already names itself', () => {
    mount();
    expect(screen.getByTestId('breakdown-columns-components')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('labels on the toolbar’s choices (FR-092)', () => {
  it('says “Size by” over the metric buttons and “Capture every” by the interval', () => {
    mount();
    expect(screen.getByTestId('monitor-size-by-label')).toHaveTextContent('Size by');
    expect(screen.getByTestId('monitor-interval-label')).toHaveTextContent('Capture every');
    // The visible words are the controls' names too, not a second label beside an unnamed control.
    expect(screen.getByRole('group', { name: 'Size by' })).toBeInTheDocument();
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
