import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_PRINT_SETTINGS, formatGrouped, type PrintJobView, type PrintSettings } from '@throng/core';
import { PrintPreview, RENDER_DEBOUNCE_MS } from '../../src/renderer/print-preview/print-preview-app.js';

/**
 * 075 FR-068, FR-069, FR-071, FR-080, FR-081 — the Print Preview window's controls against a recorded bridge.
 *
 * Layer: component — the subject is the rendered controls and what they send.
 */
const JOB: PrintJobView = {
  title: 'a.md',
  settings: { ...DEFAULT_PRINT_SETTINGS, printer: 'office' },
  printers: [{ name: 'office', label: 'Office' }, { name: 'home', label: 'Home' }],
  fit: 'width',
};

function bridge(job: PrintJobView = JOB) {
  return {
    open: vi.fn(),
    job: vi.fn(async () => job),
    render: vi.fn(async (_id: string, _s: PrintSettings) => ({ pageCount: 2 }) as const),
    setPageArea: vi.fn(async () => undefined),
    print: vi.fn(async (_id: string, _s: PrintSettings) => ({ ok: true }) as { ok: true } | { ok: false; cause: string }),
    close: vi.fn(async () => undefined),
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function mount(b = bridge()) {
  vi.useFakeTimers();
  render(createElement(PrintPreview, { jobId: 'job-1', bridge: b }));
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RENDER_DEBOUNCE_MS);
  });
  return b;
}

describe('Print Preview', () => {
  it('starts from the job, and lays the pages out once (FR-068)', async () => {
    const b = await mount();
    expect((screen.getByTestId('print-printer') as HTMLSelectElement).value).toBe('office');
    expect(b.render).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('print-status').textContent).toBe('2 pages');
  });

  it('digit-groups the page count (constitution 5.4.0)', async () => {
    const b = bridge();
    b.render.mockResolvedValue({ pageCount: 1234 });
    await mount(b);
    expect(screen.getByTestId('print-status').textContent).toBe(`${formatGrouped(1234)} pages`);
  });

  it('lays the pages out again, once, after a burst of changes', async () => {
    const b = await mount();
    fireEvent.change(screen.getByTestId('print-orientation'), { target: { value: 'landscape' } });
    fireEvent.change(screen.getByTestId('print-page-size'), { target: { value: 'Letter' } });
    expect(screen.getByTestId('print-status').textContent).toBe('Laying out pages…');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RENDER_DEBOUNCE_MS);
    });
    expect(b.render).toHaveBeenCalledTimes(2);
    expect(b.render.mock.calls[1]![1]).toMatchObject({ orientation: 'landscape', pageSize: 'Letter' });
  });

  it('prints with the settings the pages were laid out with (Q4)', async () => {
    const b = await mount();
    await act(async () => {
      fireEvent.click(screen.getByTestId('print-print'));
    });
    expect(b.print).toHaveBeenCalledWith('job-1', b.render.mock.calls[0]![1]);
  });

  it('keeps Print disabled while the pages are out of date', async () => {
    await mount();
    fireEvent.change(screen.getByTestId('print-copies'), { target: { value: '3' } });
    expect((screen.getByTestId('print-print') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('print-print').getAttribute('title')).toBe('The pages are still being laid out.');
  });

  it('says there is no printer, and disables Print (FR-081)', async () => {
    await mount(bridge({ ...JOB, printers: [], settings: { ...JOB.settings, printer: null } }));
    expect(screen.getByTestId('print-no-printer').textContent).toBe('No printer is available.');
    expect((screen.getByTestId('print-print') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows one inline notice when printing fails, and Print retries (FR-080)', async () => {
    const b = bridge();
    b.print.mockResolvedValueOnce({ ok: false, cause: 'Printer is offline' });
    await mount(b);
    await act(async () => {
      fireEvent.click(screen.getByTestId('print-print'));
    });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByTestId('print-notice').textContent).toBe('Printing failed: Printer is offline');
    await act(async () => {
      fireEvent.click(screen.getByTestId('print-print'));
    });
    expect(b.print).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('print-notice')).toBeNull();
  });

  it('refuses a malformed page range without laying out', async () => {
    const b = await mount();
    fireEvent.click(screen.getByTestId('print-pages-range'));
    fireEvent.change(screen.getByTestId('print-pages-text'), { target: { value: '3-1' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RENDER_DEBOUNCE_MS);
    });
    expect(b.render).toHaveBeenCalledTimes(1);
    expect((screen.getByTestId('print-print') as HTMLButtonElement).disabled).toBe(true);
  });

  it('stops saying it is laying out when a range becomes malformed before the layout starts', async () => {
    await mount();
    fireEvent.click(screen.getByTestId('print-pages-range'));
    fireEvent.change(screen.getByTestId('print-pages-text'), { target: { value: '1' } });
    expect(screen.getByTestId('print-status').textContent).toBe('Laying out pages…');
    // Typed on, inside the debounce: `1-` names no pages, so nothing is laid out — and nothing is being.
    fireEvent.change(screen.getByTestId('print-pages-text'), { target: { value: '1-' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RENDER_DEBOUNCE_MS);
    });
    expect(screen.getByTestId('print-status').textContent).not.toBe('Laying out pages…');
  });

  it('closes on Escape with the current settings (FR-071)', async () => {
    const b = await mount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(b.close).toHaveBeenCalledWith('job-1', expect.objectContaining({ printer: 'office' }));
  });
});
