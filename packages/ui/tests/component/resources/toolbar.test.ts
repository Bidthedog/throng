/**
 * The monitor's toolbar (055 FR-004a, FR-055, FR-061): the filter field, narrowing to a component or a
 * project, the metric choice, hide-idle and the capture interval.
 *
 * Layer: component — the real controls over the real session and the real config store, with the
 * settings bridge faked at `window.throng.config`. The ORDER these appear in the Tab sequence (filter
 * first, controls last) is `keyboard.test.ts`'s.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, Fragment } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THRONG_THEME, allowedIntervals } from '@throng/core';
import { ConfigProvider } from '../../../src/renderer/config/config-store.js';
import { FilterField, ToolbarControls } from '../../../src/renderer/resources/toolbar.js';
import { __resetSession, getView, ingestFrame, setView, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { frame, sampleHierarchy } from '../helpers/resource-fixtures.js';

const writePatch = vi.fn(() => Promise.resolve({ ok: true }));

function stubConfig(resourceMonitor: Record<string, number> = {}): void {
  window.throng = {
    config: {
      get: () => Promise.resolve({ settings: { resourceMonitor }, theme: THRONG_THEME }),
      onChange: () => () => {},
      writePatch,
    },
  } as unknown as typeof window.throng;
}

beforeEach(() => {
  writePatch.mockClear();
  __resetSession();
  startSession({ intervalSeconds: 2, historyMinutes: 5 });
  act(() => ingestFrame(frame(1, sampleHierarchy())));
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
  __resetSession();
});

async function mount(resourceMonitor: Record<string, number> = {}): Promise<void> {
  stubConfig(resourceMonitor);
  render(createElement(ConfigProvider, null, createElement(Fragment, null, createElement(FilterField), createElement(ToolbarControls))));
  // The config arrives asynchronously; the interval control reads it.
  await waitFor(() => expect(screen.getByTestId('monitor-interval')).toBeInTheDocument());
}

describe('the filter (FR-061)', () => {
  it('writes what is typed to the view, and clears with a titled icon control', async () => {
    await mount();
    const user = userEvent.setup();
    const field = screen.getByTestId('monitor-filter');
    expect(screen.queryByTestId('monitor-filter-clear')).toBeNull();

    await user.type(field, 'node');
    expect(getView().filterText).toBe('node');

    const clear = screen.getByTestId('monitor-filter-clear');
    expect(clear).toHaveAttribute('title', 'Clear filter');
    expect(clear.querySelector('.icon')).not.toBeNull();
    await user.click(clear);
    expect(getView().filterText).toBe('');
    expect(field).toHaveValue('');
    expect(document.activeElement).toBe(field);
  });

  it('shows the filter text the view already holds, so reopening restores it (FR-057)', async () => {
    act(() => setView({ filterText: 'claude' }));
    await mount();
    expect(screen.getByTestId('monitor-filter')).toHaveValue('claude');
    expect(screen.getByTestId('monitor-filter-clear')).toBeInTheDocument();
  });

  it('says what it matches: name, command line or process id', async () => {
    await mount();
    const field = screen.getByTestId('monitor-filter');
    expect(field.getAttribute('aria-label')).toMatch(/name, command line or process id/i);
  });
});

describe('no narrowing (FR-100, US2 scenario 21)', () => {
  it('offers no control that narrows the view to a component or a project', async () => {
    await mount();
    expect(screen.queryByTestId('monitor-narrow')).toBeNull();
    // The one select left is the capture interval.
    expect(screen.getAllByRole('combobox').map((s) => s.getAttribute('data-testid'))).toEqual(['monitor-interval']);
  });
});

describe('the metric (FR-061)', () => {
  it('is a group of four icon toggles, one pressed, and choosing one sets the view', async () => {
    await mount();
    const group = screen.getByRole('group', { name: /size by/i });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('data-testid'))).toEqual([
      'monitor-metric-cpu',
      'monitor-metric-memory',
      'monitor-metric-gpu',
      'monitor-metric-io',
    ]);
    expect(buttons.map((b) => b.getAttribute('title'))).toEqual(['Show by CPU', 'Show by Memory', 'Show by GPU', 'Show by I/O']);
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false']);

    fireEvent.click(screen.getByTestId('monitor-metric-memory'));

    expect(getView().metric).toBe('memory');
    expect(screen.getByTestId('monitor-metric-memory')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('monitor-metric-cpu')).toHaveAttribute('aria-pressed', 'false');
  });

  it('draws each with the theme’s icon for the metric', async () => {
    await mount();
    const icons = THRONG_THEME.icons as Record<string, string>;
    expect(screen.getByTestId('monitor-metric-cpu')).toHaveTextContent(icons.resourceCpu!);
    expect(screen.getByTestId('monitor-metric-memory')).toHaveTextContent(icons.resourceMemory!);
    expect(screen.getByTestId('monitor-metric-gpu')).toHaveTextContent(icons.resourceGpu!);
    expect(screen.getByTestId('monitor-metric-io')).toHaveTextContent(icons.resourceIo!);
  });
});

describe('hide idle (FR-061a)', () => {
  it('is a titled icon toggle on the view', async () => {
    await mount();
    const button = screen.getByTestId('monitor-hide-idle');
    expect(button).toHaveAttribute('title', 'Hide idle processes');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveTextContent((THRONG_THEME.icons as Record<string, string>).resourceHideIdle!);

    fireEvent.click(button);
    expect(getView().hideIdle).toBe(true);
    expect(button).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(button);
    expect(getView().hideIdle).toBe(false);
  });
});

describe('the capture interval (FR-004a)', () => {
  it('offers only the intervals the history window allows', async () => {
    await mount({ captureIntervalSeconds: 2, historyMinutes: 5 });
    const options = within(screen.getByTestId('monitor-interval')).getAllByRole('option').map((o) => Number(o.getAttribute('value')));
    expect(options).toEqual(allowedIntervals(5));
    expect(options[0]).toBe(2);
  });

  it('offers a longer minimum for a longer window, and shows the interval in force', async () => {
    await mount({ captureIntervalSeconds: 2, historyMinutes: 30 });
    const select = screen.getByTestId('monitor-interval') as HTMLSelectElement;
    const options = within(select).getAllByRole('option').map((o) => Number(o.getAttribute('value')));
    expect(options).toEqual(allowedIntervals(30));
    expect(options[0]).toBe(30);
    // The stored 2 s is raised to the window's minimum, and that is what the control shows.
    expect(select.value).toBe('30');
  });

  it('writes resourceMonitor.captureIntervalSeconds through the settings API when changed', async () => {
    await mount();
    fireEvent.change(screen.getByTestId('monitor-interval'), { target: { value: '10' } });

    await waitFor(() => expect(writePatch).toHaveBeenCalledTimes(1));
    expect(writePatch).toHaveBeenCalledWith({ kind: 'settings' }, [{ path: ['resourceMonitor', 'captureIntervalSeconds'], value: 10 }]);
  });

  it('is titled for what it sets', async () => {
    await mount();
    expect(screen.getByTestId('monitor-interval')).toHaveAttribute('title', 'Capture every … seconds');
    // Named by its visible label (FR-092), which is what a screen reader reads.
    expect(screen.getByRole('combobox', { name: 'Capture every' })).toBe(screen.getByTestId('monitor-interval'));
  });
});

describe('every control is a themeable icon control with a hover title (FR-055)', () => {
  it('gives every button an icon and a title, and every select a title', async () => {
    await mount();
    for (const button of screen.getAllByRole('button')) {
      expect(button.getAttribute('title'), `a button with no title: ${button.outerHTML}`).toBeTruthy();
      expect(button.querySelector('.icon'), `a button with no icon: ${button.outerHTML}`).not.toBeNull();
    }
    for (const select of screen.getAllByRole('combobox')) {
      expect(select.getAttribute('title'), `a select with no title: ${select.outerHTML}`).toBeTruthy();
    }
  });
});
