import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_PRINT_SETTINGS, PRINT_PAGE_SIZES, formatGrouped, type PrintJobView, type PrintSettings } from '@throng/core';
import type { PrintPages } from '../../src/renderer/print-preview/print-pages.js';
import { PRINTER_REFRESH_MS, PrintPreview, RENDER_DEBOUNCE_MS, VALIDATE_IDLE_MS, sheetSizeEm } from '../../src/renderer/print-preview/print-preview-app.js';

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
    expect(screen.getByText('This document has 3 pages.')).toBeTruthy();
    expect((screen.getByTestId('print-print') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId('print-notice')).toBeNull();
    expect(screen.getByTestId('print-status').textContent).not.toBe('Laying out pages…');
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

  it('offers Close alone in its title bar — no minimise, maximise or restore (FR-071, 2026-11-20)', async () => {
    await mount();
    expect(screen.getByTestId('window-close')).toBeTruthy();
    expect(screen.queryByTestId('window-max')).toBeNull();
    expect(screen.queryByTestId('window-min')).toBeNull();
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
  it('stacks a side margin\'s "mm" below its box, and the page fills the space between the boxes (FR-068b)', () => {
    const css = readFileSync(join(__dirname, '../../src/renderer/print-preview/print-preview.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = (selector: string): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const blocks = [...css.matchAll(new RegExp(`(?:^|[},])\\s*${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'gm'))].map((m) => m[1]);
      return blocks.join(';');
    };
    for (const side of ['left', 'right']) {
      expect(rule(`.print-preview__margin-edge--${side}`), `the ${side} box`).toMatch(/flex-direction:\s*column/);
    }
    const sheet = rule('.print-preview__margins-sheet');
    expect(sheet).toMatch(/justify-self:\s*stretch/);
    expect(sheet).toMatch(/align-self:\s*stretch/);
    // 18:10 — its size is the paper's, turned for the orientation (set inline, below).
    expect(sheet).toMatch(/width:\s*var\(--print-sheet-width\)/);
    expect(sheet).toMatch(/height:\s*var\(--print-sheet-height\)/);
  });

  /*
   * FR-069 (pipeline 44791444200) — the drawn page is what decides whether the settings pane fits at the window's
   * minimum size: at a 7em long side it overflowed by 33 px. Measured in Chromium at 640 × 680, a 5em long side fits
   * with 24 px to spare for every paper and orientation, and keeps the four gaps even only while the page is at least
   * as tall as a side box (3.5em). jsdom lays nothing out, so the bounds are pinned here; print-preview.e2e measures.
   */
  it('keeps the drawn page within the height the pane has, and never shorter than a side box (FR-069, FR-068b)', () => {
    for (const pageSize of PRINT_PAGE_SIZES) {
      for (const orientation of ['portrait', 'landscape'] as const) {
        const { width, height } = sheetSizeEm({ pageSize, orientation });
        expect(height, `${pageSize} ${orientation}`).toBeLessThanOrEqual(5.001);
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
    const sheet = (): HTMLElement => screen.getByTestId('print-margins-page').querySelector<HTMLElement>('.print-preview__margins-sheet')!;
    const size = (): { w: number; h: number } => ({
      w: Number.parseFloat(sheet().style.getPropertyValue('--print-sheet-width')),
      h: Number.parseFloat(sheet().style.getPropertyValue('--print-sheet-height')),
    });
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

  it('offers scale as common choices, and a free box for a custom one', async () => {
    const b = await mount(bridge({ ...JOB, settings: { ...JOB.settings, scale: { fitWidth: false, percent: 100 } } }));
    const select = screen.getByTestId('print-scale') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['25', '50', '75', '100', '125', '150', '175', '200', 'custom']);
    expect(select.value).toBe('100');
    expect(screen.queryByTestId('print-scale-custom')).toBeNull();

    fireEvent.change(select, { target: { value: '150' } });
    await idle();
    expect(lastRendered(b).scale).toEqual({ fitWidth: false, percent: 150 });

    fireEvent.change(select, { target: { value: 'custom' } });
    await settle();
    await type('print-scale-custom', '137');
    await idle();
    expect(lastRendered(b).scale).toEqual({ fitWidth: false, percent: 137 });
  });

  it('shows a stored scale that is not a choice as Custom', async () => {
    await mount(bridge({ ...JOB, settings: { ...JOB.settings, scale: { fitWidth: false, percent: 90 } } }));
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
  it('says what is wrong beside the field once it is checked', async () => {
    await mount();
    await type('print-copies', '100');
    await idle();
    expect(screen.getByTestId('print-copies-message').textContent).toBe('Up to 99 copies');
    await type('print-copies', '3');
    await idle();
    expect(screen.queryByTestId('print-copies-message')).toBeNull();
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

  it('keeps text that is no number, with its message, when the field is left', async () => {
    await mount();
    await type('print-copies', 'abc');
    fireEvent.blur(field('print-copies'));
    await idle();
    expect(field('print-copies').value).toBe('abc');
    expect(screen.getByTestId('print-copies-message').textContent).toBe('Not a whole number');
    expect(printButton().disabled).toBe(true);
  });

  it('steps by the field’s declared step on the arrow keys, and no further than its bound', async () => {
    const b = await mount(bridge({ ...JOB, settings: { ...JOB.settings, scale: { fitWidth: false, percent: 90 }, copies: 99 } }));
    fireEvent.keyDown(field('print-scale-custom'), { key: 'ArrowUp' });
    await idle();
    expect(field('print-scale-custom').value).toBe('95');
    expect(lastRendered(b).scale.percent).toBe(95);
    fireEvent.keyDown(field('print-copies'), { key: 'ArrowUp' });
    await idle();
    expect(field('print-copies').value).toBe('99');
  });

  it('applies the same check to the margins and a custom scale', async () => {
    await mount(bridge({ ...JOB, settings: { ...JOB.settings, margins: { preset: 'custom', custom: { top: 10, right: 10, bottom: 10, left: 10 } }, scale: { fitWidth: false, percent: 90 } } }));
    await type('print-margin-left', '51');
    await type('print-scale-custom', '5');
    await idle();
    expect(field('print-margin-left').getAttribute('aria-invalid')).toBe('true');
    expect(field('print-scale-custom').getAttribute('aria-invalid')).toBe('true');
    expect(printButton().disabled).toBe(true);
  });
});
