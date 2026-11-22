import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_PRINT_SETTINGS, PRINT_PAGE_SIZES, formatGrouped, type PrintJobView, type PrintSettings } from '@throng/core';
import type { PrintPages } from '../../src/renderer/print-preview/print-pages.js';
import { PRINT_TOAST_MS } from '../../src/renderer/print-preview/print-toast.js';
import { PRINTER_REFRESH_MS, PrintPreview, RANGE_HINT, RENDER_DEBOUNCE_MS, VALIDATE_IDLE_MS, sheetSizeEm } from '../../src/renderer/print-preview/print-preview-app.js';

/** PDF.js stands outside jsdom: the window's pages module is a fake whose draws the test can hold (074's pattern). */
const pdf = vi.hoisted(() => ({
  opened: [] as { pageCount: number; destroy: ReturnType<typeof vi.fn> }[],
  hold: false,
  release: [] as (() => void)[],
}));
vi.mock('../../src/renderer/print-preview/print-pages.js', () => ({
  fitScale: () => 1,
  openPrintPages: vi.fn(async (bytes: Uint8Array): Promise<PrintPages> => {
    const doc = {
      pageCount: bytes[0]! + bytes[1]! * 256,
      draw: vi.fn(async (n: number, canvas: HTMLCanvasElement) => {
        if (pdf.hold) await new Promise<void>((resolve) => pdf.release.push(resolve));
        canvas.dataset.page = String(n);
        return { width: 100, height: 140, widthMm: 210, heightMm: 294 };
      }),
      sheet: vi.fn(async () => ({ widthMm: 210, heightMm: 297, pages: Array.from({ length: bytes[0]! + bytes[1]! * 256 }, () => "data:image/png;base64,AA") })),
      destroy: vi.fn(),
    };
    pdf.opened.push(doc);
    return doc;
  }),
}));


/**
 * 075 FR-068, FR-068a, FR-069, FR-071, FR-080, FR-081 — the Print Preview window's controls and page view against a
 * recorded bridge and a fake PDF.js.
 *
 * Layer: component — the subject is the rendered controls, the page view and what they send.
 */
const JOB: PrintJobView = {
  title: 'a.md',
  settings: { ...DEFAULT_PRINT_SETTINGS, printer: 'office' },
  printers: [{ name: 'office', label: 'Office' }, { name: 'home', label: 'Home' }],
  fit: 'width',
};

/** A laid-out job of `n` pages, as the fake PDF.js reads it. */
const pdfOf = (n: number): Uint8Array => new Uint8Array([n % 256, Math.floor(n / 256)]);

type RenderAnswer = { pageCount: number; pdf: Uint8Array } | { error: string } | { outOfRange: true; pageCount: number };

function bridge(job: PrintJobView = JOB) {
  return {
    open: vi.fn(),
    job: vi.fn(async () => job),
    render: vi.fn(async (_id: string, _s: PrintSettings): Promise<RenderAnswer> => ({ pageCount: 2, pdf: pdfOf(2) })),
    print: vi.fn(async (_id: string, _s: PrintSettings, _sheet?: unknown) => ({ ok: true }) as { ok: true } | { ok: false; cause: string }),
    close: vi.fn(async () => undefined),
    savePdf: vi.fn(async (_id: string, _s: PrintSettings) => ({ ok: true, path: '/p/a.pdf' }) as { ok: true; path: string } | { ok: false; cause: string } | { cancelled: true }),
    remember: vi.fn(async (_id: string, _s: PrintSettings) => undefined),
    printers: vi.fn(async (_id: string) => job.printers),
  };
}

beforeEach(() => {
  pdf.opened = [];
  pdf.hold = false;
  pdf.release = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Let every promise in flight settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function mount(b = bridge()) {
  vi.useFakeTimers();
  render(createElement(PrintPreview, { jobId: 'job-1', bridge: b }));
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RENDER_DEBOUNCE_MS);
  });
  await settle();
  return b;
}

describe('Print Preview', () => {
  it('starts from the job, and lays the pages out once (FR-068)', async () => {
    const b = await mount();
    expect((screen.getByTestId('print-printer') as HTMLSelectElement).value).toBe('office');
    expect(b.render).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('print-status').textContent).toBe('Page 1 of 2');
  });

  it('digit-groups the page count (constitution 5.4.0)', async () => {
    const b = bridge();
    b.render.mockResolvedValue({ pageCount: 1234, pdf: pdfOf(1234) });
    await mount(b);
    expect(screen.getByTestId('print-status').textContent).toBe(`Page 1 of ${formatGrouped(1234)}`);
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
    // 2026-11-20 — with the pages shown, drawn: the printer lays nothing out again.
    expect(b.print).toHaveBeenCalledWith('job-1', b.render.mock.calls[0]![1], expect.objectContaining({ widthMm: 210, heightMm: 297, pages: expect.any(Array) }));
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

  it('saves the pages shown as a PDF, with the settings they were laid out with, with no printer needed (FR-082)', async () => {
    const b = await mount(bridge({ ...JOB, printers: [], settings: { ...JOB.settings, printer: null } }));
    const save = screen.getByTestId('print-save-pdf') as HTMLButtonElement;
    expect(save.textContent).toBe('Save as PDF…');
    expect(save.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(save);
    });
    expect(b.savePdf).toHaveBeenCalledWith('job-1', b.render.mock.calls[0]![1]);
  });

  it('waits for the pages to be laid out before it saves (FR-082)', async () => {
    await mount();
    fireEvent.change(screen.getByTestId('print-orientation'), { target: { value: 'landscape' } });
    expect((screen.getByTestId('print-save-pdf') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the failed save as one inline notice naming the file, and a cancelled one as nothing (FR-082)', async () => {
    const b = bridge();
    b.savePdf.mockResolvedValueOnce({ cancelled: true }).mockResolvedValueOnce({ ok: false, cause: 'a.pdf could not be saved: EACCES' });
    await mount(b);
    await act(async () => {
      fireEvent.click(screen.getByTestId('print-save-pdf'));
    });
    expect(screen.queryByTestId('print-notice')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId('print-save-pdf'));
    });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByTestId('print-notice').textContent).toBe('Saving as PDF failed: a.pdf could not be saved: EACCES');
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

  it('outlines the range in red and names the page count when every page it names is past the last (gap 1)', async () => {
    const b = bridge();
    const b2 = await mount(b);
    b2.render.mockImplementation(async () => ({ outOfRange: true as const, pageCount: 3 }));
    fireEvent.click(screen.getByTestId('print-pages-range'));
    fireEvent.change(screen.getByTestId('print-pages-text'), { target: { value: '5-7' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RENDER_DEBOUNCE_MS);
    });
    await settle();
    expect(screen.getByTestId('print-pages-text').getAttribute('aria-invalid')).toBe('true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VALIDATE_IDLE_MS);
    });
    expect(screen.getByTestId('print-toast').textContent).toBe('Pages: This document has 3 pages.');
    expect((screen.getByTestId('print-print') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId('print-notice')).toBeNull();
    expect(screen.getByTestId('print-status').textContent).not.toBe('Laying out pages…');
  });

  /*
   * FR-069 (pipeline 44800348820) — on Windows the pane overflowed the window's minimum size by 2 px with the range
   * chosen and empty: "Enter pages as numbers and ranges, such as 1-3, 5." wrapped onto a second line. The message and
   * every choice now stand one line tall whatever their text or the platform's font; jsdom lays nothing out, so the
   * rules are pinned here and print-preview.e2e measures the pane.
   */
  it('says a malformed range in the toast, and keeps every choice to one line (FR-069; toast 2026-11-22)', async () => {
    await mount();
    fireEvent.click(screen.getByTestId('print-pages-range'));
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VALIDATE_IDLE_MS);
    });
    expect(screen.getByTestId('print-toast').textContent).toBe(`Pages: ${RANGE_HINT}`);
    // Nothing is drawn in the pane for it: the pane keeps its height (FR-069).
    expect(screen.queryByText(RANGE_HINT, { selector: '.print-preview__controls *' })).toBeNull();

    const css = readFileSync(join(__dirname, '../../src/renderer/print-preview/print-preview.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = (selector: string): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return [...css.matchAll(new RegExp(`(?:^|[},])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'gm'))].map((m) => m[1]).join(';');
    };
    for (const selector of ['.print-preview__controls select']) {
      expect(rule(selector), selector).toMatch(/white-space:\s*nowrap/);
      expect(rule(selector), selector).toMatch(/overflow:\s*hidden/);
      expect(rule(selector), selector).toMatch(/text-overflow:\s*ellipsis/);
    }
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

  it('picks up a printer the OS finds while it is open, and keeps the one chosen (2026-11-20)', async () => {
    const b = await mount();
    const options = () => [...(screen.getByTestId('print-printer') as HTMLSelectElement).options].map((o) => o.value);
    expect(options()).toEqual(['office', 'home']);
    b.printers.mockResolvedValue([...JOB.printers, { name: 'laser', label: 'Laser' }]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRINTER_REFRESH_MS);
    });
    await settle();
    expect(options()).toEqual(['office', 'home', 'laser']);
    expect((screen.getByTestId('print-printer') as HTMLSelectElement).value).toBe('office');
  });

  it('moves to another printer when the chosen one goes away', async () => {
    const b = await mount();
    b.printers.mockResolvedValue([{ name: 'home', label: 'Home' }]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRINTER_REFRESH_MS);
    });
    await settle();
    expect((screen.getByTestId('print-printer') as HTMLSelectElement).value).toBe('home');
  });

  it('offers Maximise / Restore and Close in its title bar, and no minimise (FR-068b, amended 2026-11-22)', async () => {
    await mount();
    expect(screen.getByTestId('window-close')).toBeTruthy();
    expect(screen.getByTestId('window-max')).toBeTruthy();
    expect(screen.queryByTestId('window-min')).toBeNull();
  });

  it('tells main every change at once, so a close from the title bar keeps it (FR-070)', async () => {
    const b = await mount();
    // Inside the layout's debounce: nothing has been laid out with it yet, so main has not seen it any other way.
    fireEvent.change(screen.getByTestId('print-orientation'), { target: { value: 'landscape' } });
    expect(b.render).not.toHaveBeenCalledWith('job-1', expect.objectContaining({ orientation: 'landscape' }));
    expect(b.remember).toHaveBeenLastCalledWith('job-1', expect.objectContaining({ orientation: 'landscape' }));
  });

  it("offers and selects a document's own paper when no listed size is it (FR-068g)", async () => {
    await mount(bridge({ ...JOB, settings: { ...JOB.settings, pageSize: 'Custom', customPaper: { width: 100, height: 150 } } }));
    const select = screen.getByTestId('print-page-size') as HTMLSelectElement;
    expect(select.value).toBe('Custom');
    expect(select.selectedOptions[0]?.textContent).toBe('Custom (100 × 150 mm)');
    expect([...select.options].map((o) => o.value)).toEqual(['A3', 'A4', 'A5', 'Letter', 'Legal', 'Tabloid', 'Custom']);
  });

  it('offers no custom paper when the document has none of its own (FR-068g)', async () => {
    await mount();
    expect([...(screen.getByTestId('print-page-size') as HTMLSelectElement).options].map((o) => o.value)).not.toContain('Custom');
  });

  it('closes on Escape with the current settings (FR-071)', async () => {
    const b = await mount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(b.close).toHaveBeenCalledWith('job-1', expect.objectContaining({ printer: 'office' }));
  });
});

describe('one page at a time (FR-068a)', () => {
  const button = (id: string) => screen.getByTestId(id) as HTMLButtonElement;
  const shownPage = () => screen.getByTestId('print-page-view').querySelector('canvas')?.dataset.page;
  const key = async (k: string, target: EventTarget = window) => {
    fireEvent.keyDown(target, { key: k });
    await settle();
  };

  it('shows page 1 once it is drawn, with Back disabled and Forward enabled', async () => {
    await mount();
    expect(shownPage()).toBe('1');
    expect(screen.getByTestId('print-page-view').getAttribute('aria-busy')).toBe('false');
    expect(button('print-page-back').disabled).toBe(true);
    expect(button('print-page-forward').disabled).toBe(false);
    expect(button('print-page-back').getAttribute('title')).toBe('Previous page');
    expect(button('print-page-forward').getAttribute('title')).toBe('Next page');
  });

  it('outlines the margins in dashes on the page, where the printed content stops (2026-11-20)', async () => {
    await mount();
    const guide = screen.getByTestId('print-margin-guide');
    // A 100 × 140 px page of 210 × 294 mm, with the default 10 mm margins: 10 / 210 of its width in from each side.
    for (const side of ['left', 'right'] as const) expect(parseFloat(guide.style[side])).toBeCloseTo((100 * 10) / 210, 2);
    for (const side of ['top', 'bottom'] as const) expect(parseFloat(guide.style[side])).toBeCloseTo((140 * 10) / 294, 2);
    expect(guide.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows a spinner, and no page, until the first page is drawn', async () => {
    pdf.hold = true;
    await mount();
    expect(shownPage()).toBeUndefined();
    expect(screen.getByTestId('print-page-view').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByTestId('print-page-view').querySelector('[role="status"]')).not.toBeNull();
    pdf.release.splice(0).forEach((r) => r());
    await settle();
    expect(shownPage()).toBe('1');
    expect(screen.getByTestId('print-page-view').querySelector('[role="status"]')).toBeNull();
  });

  it('keeps the page on screen until the next one is fully drawn, never a half-drawn one', async () => {
    await mount();
    pdf.hold = true;
    fireEvent.click(button('print-page-forward'));
    await settle();
    expect(screen.getByTestId('print-status').textContent).toBe('Page 2 of 2');
    expect(shownPage()).toBe('1');
    pdf.release.splice(0).forEach((r) => r());
    await settle();
    expect(shownPage()).toBe('2');
  });

  it('steps with Back and Forward, laying nothing out again', async () => {
    const b = await mount();
    fireEvent.click(button('print-page-forward'));
    await settle();
    expect(shownPage()).toBe('2');
    expect(button('print-page-forward').disabled).toBe(true);
    fireEvent.click(button('print-page-back'));
    await settle();
    expect(shownPage()).toBe('1');
    expect(b.render).toHaveBeenCalledTimes(1);
    expect(pdf.opened).toHaveLength(1);
  });

  it('steps with the arrow keys and Page Up / Page Down, and jumps with Home and End', async () => {
    const b = bridge();
    b.render.mockResolvedValue({ pageCount: 5, pdf: pdfOf(5) });
    await mount(b);
    await key('ArrowRight');
    expect(shownPage()).toBe('2');
    await key('ArrowDown');
    expect(shownPage()).toBe('3');
    await key('PageDown');
    expect(shownPage()).toBe('4');
    await key('ArrowLeft');
    expect(shownPage()).toBe('3');
    await key('ArrowUp');
    expect(shownPage()).toBe('2');
    await key('PageUp');
    expect(shownPage()).toBe('1');
    await key('End');
    expect(shownPage()).toBe('5');
    expect(screen.getByTestId('print-status').textContent).toBe('Page 5 of 5');
    await key('Home');
    expect(shownPage()).toBe('1');
  });

  it('leaves the keys to a field that takes them', async () => {
    const b = bridge();
    b.render.mockResolvedValue({ pageCount: 5, pdf: pdfOf(5) });
    await mount(b);
    await key('ArrowUp', screen.getByTestId('print-copies'));
    await key('End', screen.getByTestId('print-pages-text'));
    expect(shownPage()).toBe('1');
  });

  it('steps a page per wheel notch over the pages, and not for a small nudge', async () => {
    const b = bridge();
    b.render.mockResolvedValue({ pageCount: 5, pdf: pdfOf(5) });
    await mount(b);
    const view = screen.getByTestId('print-page-view');
    fireEvent.wheel(view, { deltaY: 100 });
    await settle();
    expect(shownPage()).toBe('2');
    fireEvent.wheel(view, { deltaY: 10 });
    await settle();
    expect(shownPage()).toBe('2');
    fireEvent.wheel(view, { deltaY: -100 });
    await settle();
    expect(shownPage()).toBe('1');
  });

  it('keeps the page it was on when the settings change, and lets the old layout go', async () => {
    const b = bridge();
    b.render.mockResolvedValue({ pageCount: 5, pdf: pdfOf(5) });
    await mount(b);
    await key('End');
    fireEvent.change(screen.getByTestId('print-orientation'), { target: { value: 'landscape' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RENDER_DEBOUNCE_MS);
    });
    await settle();
    expect(pdf.opened).toHaveLength(2);
    expect(pdf.opened[0]!.destroy).toHaveBeenCalled();
    expect(shownPage()).toBe('5');
  });

  it('shows the last page when there are fewer pages now', async () => {
    const b = bridge();
    b.render.mockResolvedValueOnce({ pageCount: 5, pdf: pdfOf(5) });
    await mount(b);
    await key('End');
    b.render.mockResolvedValueOnce({ pageCount: 2, pdf: pdfOf(2) });
    fireEvent.change(screen.getByTestId('print-orientation'), { target: { value: 'landscape' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RENDER_DEBOUNCE_MS);
    });
    await settle();
    expect(screen.getByTestId('print-status').textContent).toBe('Page 2 of 2');
    expect(shownPage()).toBe('2');
    expect(button('print-page-forward').disabled).toBe(true);
  });

  it('disables both while the pages are being laid out', async () => {
    await mount();
    fireEvent.change(screen.getByTestId('print-orientation'), { target: { value: 'landscape' } });
    expect(button('print-page-back').disabled).toBe(true);
    expect(button('print-page-forward').disabled).toBe(true);
  });
});

/**
 * 2026-11-20 — the maintainer's form: margins drawn as a page, scale as common choices, and numbers typed freely
 * and checked once typing stops or the field is left; an invalid field is outlined red and Print waits for it.
 */
describe('the settings form (FR-066, FR-069; 2026-11-20)', () => {
  const field = (id: string) => screen.getByTestId(id) as HTMLInputElement;
  const printButton = () => screen.getByTestId('print-print') as HTMLButtonElement;
  const type = async (id: string, value: string) => {
    fireEvent.change(field(id), { target: { value } });
    await settle();
  };
  /** Typing stops: the field is checked, then — once the committed value has rendered — the pages laid out. */
  const idle = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VALIDATE_IDLE_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RENDER_DEBOUNCE_MS);
    });
    await settle();
  };
  const lastRendered = (b: ReturnType<typeof bridge>) => b.render.mock.calls.at(-1)![1];

  it('draws custom margins as a page, a millimetre box at each edge and no labels', async () => {
    await mount(bridge({ ...JOB, settings: { ...JOB.settings, margins: { preset: 'custom', custom: { top: 10, right: 12, bottom: 14, left: 16 } } } }));
    const diagram = screen.getByTestId('print-margins-page');
    expect(diagram.querySelector('.print-preview__margins-sheet')).not.toBeNull();
    for (const [side, mm] of [['top', '10'], ['right', '12'], ['bottom', '14'], ['left', '16']] as const) {
      const input = field(`print-margin-${side}`);
      expect(input.type).toBe('text');
      expect(input.value).toBe(mm);
      expect(input.getAttribute('aria-label')).toBe(`${side[0]!.toUpperCase()}${side.slice(1)} margin, mm`);
      expect(input.closest('[data-edge]')?.getAttribute('data-edge')).toBe(side);
    }
    expect(diagram.textContent?.replace(/\s+/g, '')).toBe('mmmmmmmm');
  });

  /*
   * The maintainer, 2026-11-20 17:21 — "the 'mm' for the left and right margins should be underneath the box so they
   * do not push the page sideways. The page can be a little larger so the spacing around it is uniform." jsdom lays
   * nothing out, so what is pinned here is the stylesheet that does: each side box stacks its unit below it, and the
   * sheet fills its grid cell, so the grid's one gap is the space on every side. print-preview.e2e.ts measures it.
   */
  /*
   * Walk-through, 2026-11-21 — at the window's smallest, Print, Save as PDF… and Cancel did not fit one row, and the
   * middle button broke its label over three lines ("Save / as / PDF…"). Wrapping the row instead (c16575ac) cost the
   * pane a second row, which the margins drawing gave up: it spilled 11–21 px on every platform (pipeline 44911226402).
   * Each label stays on one line, the row never wraps, and the pane is wide enough for the three at its smallest
   * (measured: 224 of 267 px in the default theme).
   */
  it('keeps the actions on one row, each label on one line, in a pane wide enough for them (FR-082, FR-069)', () => {
    const css = readFileSync(join(__dirname, '../../src/renderer/print-preview/print-preview.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = (selector: string): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return [...css.matchAll(new RegExp(`(?:^|[},])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'gm'))].map((m) => m[1]).join(';');
    };
    expect(rule('.print-preview__actions button')).toMatch(/white-space:\s*nowrap/);
    expect(rule('.print-preview__actions')).toMatch(/flex-wrap:\s*nowrap/);
    expect(rule('.print-preview__controls')).toMatch(/flex:\s*0 0 300px/);
  });

  it('hangs a side margin\'s "mm" below its box, and the page fills the space between the boxes (FR-068b)', () => {
    const css = readFileSync(join(__dirname, '../../src/renderer/print-preview/print-preview.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = (selector: string): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const blocks = [...css.matchAll(new RegExp(`(?:^|[},])\\s*${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'gm'))].map((m) => m[1]);
      return blocks.join(';');
    };
    // 2026-11-22 — out of flow below the box (the centring test, below), so it takes no width beside the page.
    for (const side of ['left', 'right']) {
      expect(rule(`.print-preview__margin-edge--${side} .print-preview__margin-unit`), `the ${side} box's unit`).toMatch(/top:\s*100%/);
    }
    const sheet = rule('.print-preview__margins-sheet');
    // 18:10 — its size is the paper's, turned for the orientation (set inline, below): a height, and the width from it.
    expect(sheet).toMatch(/(?:^|[;{\s])height:\s*var\(--print-sheet-height\)/);
    expect(sheet).toMatch(/aspect-ratio:\s*var\(--print-sheet-ratio\)/);
    // FR-069 (pipeline 44800348820) — the drawing is the one part of the pane that gives way: the page never stands
    // taller than its row, which may shrink to a side box's height, and never narrower than its column, so the four
    // gaps stay even while it does. jsdom lays nothing out; print-preview.e2e measures the pane at the minimum size.
    expect(sheet).toMatch(/max-height:\s*100%/);
    expect(sheet).toMatch(/min-width:\s*100%/);
    const page = rule('.print-preview__margins-page');
    expect(page).toMatch(/flex:\s*0 1 auto/);
    expect(page).toMatch(/min-height:\s*0/);
    expect(page).toMatch(/grid-template-rows:\s*auto minmax\(var\(--print-sheet-min-height\), auto\) auto/);
  });

  /*
   * FR-069 (pipeline 44791444200) — the drawn page is what decides whether the settings pane fits at the window's
   * minimum size: at a 7em long side it overflowed by 33 px. Measured in Chromium at 640 × 680, a 5em long side fits
   * with 24 px to spare for every paper and orientation, and keeps the four gaps even only while the page is at least
   * as tall as a side box (3.5em). 2026-11-22 (maintainer: "a little larger") — 6em, still at least 3.5em tall, with the window's
   * minimum height raised to 740 px to keep the room. jsdom lays nothing out, so the bounds are pinned here;
   * print-preview.e2e measures.
   */
  it('keeps the drawn page within the height the pane has, and never shorter than a side box (FR-069, FR-068b)', () => {
    for (const pageSize of PRINT_PAGE_SIZES) {
      for (const orientation of ['portrait', 'landscape'] as const) {
        const { width, height } = sheetSizeEm({ pageSize, orientation });
        expect(height, `${pageSize} ${orientation}`).toBeLessThanOrEqual(6.001);
        expect(height, `${pageSize} ${orientation}`).toBeGreaterThanOrEqual(3.499);
        // Wider than a margin box, so the top and bottom boxes never stand wider than the page.
        expect(width, `${pageSize} ${orientation}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  // The maintainer, 2026-11-20 18:10 — "When 'landscape' is selected, the example page for margins should switch to
  // landscape", and "For 'Paper size', show the size in mm next to each option, depending on the orientation selected".
  it('draws the margins page in the paper\'s shape, and labels each paper size in mm, both turned with the orientation (FR-068b)', async () => {
    await mount(bridge({ ...JOB, settings: { ...JOB.settings, pageSize: 'A4', orientation: 'portrait', margins: { preset: 'custom', custom: { top: 10, right: 10, bottom: 10, left: 10 } } } }));
    // Set on the drawing, whose grid reads the least height; the page inherits them.
    const drawing = (): HTMLElement => screen.getByTestId('print-margins-page');
    const size = (): { w: number; h: number } => {
      const h = Number.parseFloat(drawing().style.getPropertyValue('--print-sheet-height'));
      return { w: h * Number.parseFloat(drawing().style.getPropertyValue('--print-sheet-ratio')), h };
    };
    const label = (value: string): string | null => (screen.getByTestId('print-page-size') as HTMLSelectElement).querySelector(`option[value="${value}"]`)!.textContent;

    expect(size().h).toBeGreaterThan(size().w);
    expect(size().h / size().w).toBeCloseTo(297 / 210, 2);
    expect(label('A4')).toBe('A4 (210 × 297 mm)');

    fireEvent.change(screen.getByTestId('print-orientation'), { target: { value: 'landscape' } });
    await settle();
    expect(size().w).toBeGreaterThan(size().h);
    expect(size().w / size().h).toBeCloseTo(297 / 210, 2);
    expect(label('A4')).toBe('A4 (297 × 210 mm)');
    expect(label('Letter')).toBe('Letter (279.4 × 215.9 mm)');
  });

  // The maintainer, 2026-11-20 18:00 — "center align the top and bottom boxes, and have the 'mm' offset so the boxes are
  // aligned center, but the 'mm' follows them": the unit hangs after the box, out of flow, so the box alone is centred.
  it('centres the top and bottom boxes by the box alone, their "mm" following out of flow (FR-068b)', async () => {
    await mount(bridge({ ...JOB, settings: { ...JOB.settings, margins: { preset: 'custom', custom: { top: 10, right: 12, bottom: 14, left: 16 } } } }));
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const unit = screen.getByTestId('print-margins-page').querySelector(`[data-edge="${side}"] .print-preview__margin-unit`);
      expect(unit?.textContent, `the ${side} box's unit`).toBe('mm');
    }
    const css = readFileSync(join(__dirname, '../../src/renderer/print-preview/print-preview.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ selectors: m[1]!.split(',').map((s) => s.trim()), body: m[2]! }));
    const declared = (selector: string): string =>
      rules.filter((r) => r.selectors.includes(selector)).map((r) => r.body).join(';');
    for (const side of ['top', 'bottom']) {
      const unit = declared(`.print-preview__margin-edge--${side} .print-preview__margin-unit`);
      expect(unit, `the ${side} box's unit`).toMatch(/position:\s*absolute/);
      expect(unit, `the ${side} box's unit`).toMatch(/left:\s*100%/);
    }
    // 2026-11-22 (maintainer) — the side boxes likewise: centred on the page by the box alone, their "mm" hanging below.
    for (const side of ['left', 'right']) {
      const unit = declared(`.print-preview__margin-edge--${side} .print-preview__margin-unit`);
      expect(unit, `the ${side} box's unit`).toMatch(/position:\s*absolute/);
      expect(unit, `the ${side} box's unit`).toMatch(/top:\s*100%/);
      expect(declared(`.print-preview__margin-edge--${side}`), `the ${side} box`).not.toMatch(/flex-direction:\s*column/);
    }
  });

  it('offers Centre on page, on for a picture and off for a document by default, and lays out with the choice (FR-068f)', async () => {
    const picture = await mount(bridge({ ...JOB, fit: 'page', settings: { ...JOB.settings, centre: { page: true, width: false } } }));
    const box = (): HTMLInputElement => screen.getByTestId('print-centre') as HTMLInputElement;
    expect(box().checked).toBe(true);
    fireEvent.click(box());
    await idle();
    expect(lastRendered(picture).centre).toEqual({ page: false, width: false });
    cleanup();

    await mount(bridge({ ...JOB, fit: 'width', settings: { ...JOB.settings, centre: { page: true, width: false } } }));
    expect(box().checked).toBe(false);
  });

  // Maintainer, 2026-11-22 — "Fit" replaces the Fit to page checkbox: six ways for a page-shaped printable, two for a
  // flowing document, each kind keeping its own choice; Scale shows the percentages.
  it('offers a picture or PDF six ways to fit, and Scale shows the percentages', async () => {
    const b = await mount(bridge({ ...JOB, fit: 'page' }));
    const fit = screen.getByTestId('print-fit') as HTMLSelectElement;
    expect([...fit.options].map((o) => o.textContent)).toEqual([
      'Fit to page',
      'Stretch to fit (keep proportions)',
      'Stretch to fill (distorts)',
      'Fill page (crop)',
      'Actual size',
      'Scale',
    ]);
    expect(fit.value).toBe('fit');
    expect(screen.queryByTestId('print-scale')).toBeNull();
    fireEvent.change(fit, { target: { value: 'crop' } });
    await idle();
    expect(lastRendered(b).scale).toMatchObject({ pageFit: 'crop', fitWidth: true });
    fireEvent.change(fit, { target: { value: 'scale' } });
    await settle();
    expect(screen.getByTestId('print-scale')).toBeTruthy();
  });

  it('offers a document Fit to page width or Scale, leaving a picture\'s choice alone', async () => {
    const b = await mount(bridge({ ...JOB, fit: 'width', settings: { ...JOB.settings, scale: { fitWidth: true, pageFit: 'crop', percent: 100 } } }));
    const fit = screen.getByTestId('print-fit') as HTMLSelectElement;
    expect([...fit.options].map((o) => o.textContent)).toEqual(['Fit to page width', 'Scale']);
    fireEvent.change(fit, { target: { value: 'scale' } });
    await idle();
    expect(lastRendered(b).scale).toEqual({ fitWidth: false, pageFit: 'crop', percent: 100 });
    expect(screen.getByTestId('print-scale')).toBeTruthy();
  });

  it('offers scale as common choices, and a free box for a custom one', async () => {
    const b = await mount(bridge({ ...JOB, settings: { ...JOB.settings, scale: { fitWidth: false, pageFit: 'fit', percent: 100 } } }));
    const select = screen.getByTestId('print-scale') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['25', '50', '75', '100', '125', '150', '175', '200', 'custom']);
    expect(select.value).toBe('100');
    expect(screen.queryByTestId('print-scale-custom')).toBeNull();

    fireEvent.change(select, { target: { value: '150' } });
    await idle();
    expect(lastRendered(b).scale).toEqual({ fitWidth: false, pageFit: 'fit', percent: 150 });

    fireEvent.change(select, { target: { value: 'custom' } });
    await settle();
    await type('print-scale-custom', '137');
    await idle();
    expect(lastRendered(b).scale).toEqual({ fitWidth: false, pageFit: 'fit', percent: 137 });
  });

  it('shows a stored scale that is not a choice as Custom', async () => {
    await mount(bridge({ ...JOB, settings: { ...JOB.settings, scale: { fitWidth: false, pageFit: 'fit', percent: 90 } } }));
    expect((screen.getByTestId('print-scale') as HTMLSelectElement).value).toBe('custom');
    expect(field('print-scale-custom').value).toBe('90');
  });

  it('takes any text while typing, and checks it once typing stops', async () => {
    const b = await mount();
    const before = b.render.mock.calls.length;
    await type('print-copies', '1');
    await type('print-copies', '12');
    expect(field('print-copies').getAttribute('aria-invalid')).toBeNull();
    // Nothing is laid out, and Print waits, until the field has been checked.
    expect(b.render.mock.calls.length).toBe(before);
    expect(printButton().disabled).toBe(true);
    await idle();
    expect(lastRendered(b).copies).toBe(12);
    expect(printButton().disabled).toBe(false);
  });

  it('checks a field at once when it is left', async () => {
    const b = await mount();
    await type('print-copies', '4');
    fireEvent.blur(field('print-copies'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RENDER_DEBOUNCE_MS);
    });
    await settle();
    expect(lastRendered(b).copies).toBe(4);
  });

  it('outlines an invalid number in red and disables Print until it is put right', async () => {
    const b = await mount();
    const before = b.render.mock.calls.length;
    for (const bad of ['abc', '0', '100', '2.5', '']) {
      await type('print-copies', bad);
      await idle();
      expect(field('print-copies').getAttribute('aria-invalid'), bad).toBe('true');
      expect(printButton().disabled, bad).toBe(true);
    }
    expect(b.render.mock.calls.length).toBe(before);
    await type('print-copies', '2');
    await idle();
    expect(field('print-copies').getAttribute('aria-invalid')).toBeNull();
    expect(printButton().disabled).toBe(false);
  });

  // 077 FR-020 — the bound in words, a clamp when the field is left, and the declared step on the arrow keys.
  // Maintainer, 2026-11-22 — a brief toast over the window, not a message beside the field the pane had no room for.
  // Maintainer, 2026-11-22 — a header and a footer, each printed or not, its text with placeholders, and its alignment.
  it('offers a header and a footer, each off by default, and lays out with what is chosen', async () => {
    const b = await mount();
    const header = screen.getByTestId('print-header-enabled') as HTMLInputElement;
    expect(header.checked).toBe(false);
    expect((screen.getByTestId('print-footer-enabled') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('print-header-text') as HTMLInputElement).value).toBe('{path}');
    expect((screen.getByTestId('print-footer-text') as HTMLInputElement).value).toBe('Page {page} of {totalPages}');
    const align = screen.getByTestId('print-footer-align') as HTMLSelectElement;
    expect([...align.options].map((o) => o.textContent)).toEqual(['Left', 'Centre', 'Right']);
    expect(align.value).toBe('right');

    fireEvent.click(header);
    fireEvent.change(screen.getByTestId('print-header-text'), { target: { value: '{path} — {page}' } });
    fireEvent.change(screen.getByTestId('print-header-align'), { target: { value: 'left' } });
    await idle();
    expect(lastRendered(b).header).toEqual({ enabled: true, text: '{path} — {page}', align: 'left' });
    expect(lastRendered(b).footer.enabled).toBe(false);
  });

  it('says what the placeholders stand for in its "?" helper', async () => {
    await mount();
    fireEvent.click(screen.getByTestId('print-bands-help'));
    const note = screen.getByTestId('info-helper-popover').textContent ?? '';
    for (const p of ['{fileName}', '{fileExt}', '{path}', '{page}', '{totalPages}', '{timeStamp}']) expect(note).toContain(p);
  });

  it('says what is wrong in a toast once the field is checked, for two seconds', async () => {
    await mount();
    await type('print-copies', '100');
    await idle();
    expect(screen.getByTestId('print-toast').textContent).toBe('Copies: Up to 99 copies');
    expect(screen.queryByTestId('print-copies-message')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRINT_TOAST_MS);
    });
    expect(screen.queryByTestId('print-toast')).toBeNull();
    expect(field('print-copies').getAttribute('aria-invalid')).toBe('true');
  });

  it('stores the bound when a value past it is left or confirmed with Enter', async () => {
    const b = await mount();
    await type('print-copies', '100');
    fireEvent.blur(field('print-copies'));
    await idle();
    expect(field('print-copies').value).toBe('99');
    expect(field('print-copies').getAttribute('aria-invalid')).toBeNull();
    expect(lastRendered(b).copies).toBe(99);
    await type('print-copies', '0');
    fireEvent.keyDown(field('print-copies'), { key: 'Enter' });
    await idle();
    expect(field('print-copies').value).toBe('1');
    expect(lastRendered(b).copies).toBe(1);
  });

  // Maintainer, 2026-11-22: "the toast messages on the print preview need to state which control they relate to."
  it('names the field a toast is about', async () => {
    await mount(bridge({ ...JOB, settings: { ...JOB.settings, margins: { preset: 'custom', custom: { top: 10, right: 12, bottom: 14, left: 16 } } } }));
    await type('print-margin-top', 'abc');
    await idle();
    expect(screen.getByTestId('print-toast').textContent).toMatch(/^Top margin: /);
  });

  // 077 T062 (FR-020): "the field keeps its red outline until put right" — not only until the next keystroke.
  it('keeps the red outline while an invalid field is edited, until a check passes', async () => {
    await mount();
    await type('print-copies', 'abc');
    await idle();
    expect(field('print-copies').getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(field('print-copies'), { target: { value: 'abcd' } });
    expect(field('print-copies').getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(field('print-copies'), { target: { value: '3' } });
    await idle();
    expect(field('print-copies').getAttribute('aria-invalid')).toBeNull();
  });

  it('keeps text that is no number, with its message, when the field is left', async () => {
    await mount();
    await type('print-copies', 'abc');
    fireEvent.blur(field('print-copies'));
    await idle();
    expect(field('print-copies').value).toBe('abc');
    expect(screen.getByTestId('print-toast').textContent).toBe('Copies: Not a whole number');
    expect(printButton().disabled).toBe(true);
  });

  it('steps by the field’s declared step on the arrow keys, and no further than its bound', async () => {
    const b = await mount(bridge({ ...JOB, settings: { ...JOB.settings, scale: { fitWidth: false, pageFit: 'fit', percent: 90 }, copies: 99 } }));
    fireEvent.keyDown(field('print-scale-custom'), { key: 'ArrowUp' });
    await idle();
    expect(field('print-scale-custom').value).toBe('95');
    expect(lastRendered(b).scale.percent).toBe(95);
    fireEvent.keyDown(field('print-copies'), { key: 'ArrowUp' });
    await idle();
    expect(field('print-copies').value).toBe('99');
  });

  it('applies the same check to the margins and a custom scale', async () => {
    await mount(bridge({ ...JOB, settings: { ...JOB.settings, margins: { preset: 'custom', custom: { top: 10, right: 10, bottom: 10, left: 10 } }, scale: { fitWidth: false, pageFit: 'fit', percent: 90 } } }));
    await type('print-margin-left', '51');
    await type('print-scale-custom', '5');
    await idle();
    expect(field('print-margin-left').getAttribute('aria-invalid')).toBe('true');
    expect(field('print-scale-custom').getAttribute('aria-invalid')).toBe('true');
    expect(printButton().disabled).toBe(true);
  });
});
