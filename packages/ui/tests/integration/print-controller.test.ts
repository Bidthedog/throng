// Layer: integration — the settings file on disk is what this proves; the engine and the window are doubles, since
// printing itself is the OS's.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PRINT_SETTINGS, type PrintJobRequest, type PrintSettings, type PrintSheet } from '@throng/core';
import { RecordingPrintEngine } from '@throng/core/testing';
import { PrintController, countPdfPages, type PrintPreviewWindowLike } from '../../src/main/print-controller.js';
import { PrintSettingsStore } from '../../src/main/print-settings-store.js';

/** 075 FR-064, FR-068 – FR-071, FR-080, SC-012 — the print job, from open to close. */
const REQUEST: PrintJobRequest = { title: 'a.md', output: { kind: 'document', html: '<p>x</p>', fit: 'width', remoteImages: [] } };

class FakeWindow implements PrintPreviewWindowLike {
  focused = 0;
  closed = false;
  private listener: (() => void) | null = null;
  focus(): void {
    this.focused += 1;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.listener?.();
  }
  onClosed(listener: () => void): void {
    this.listener = listener;
  }
}

let dir: string;
let engine: RecordingPrintEngine;
let store: PrintSettingsStore;
let windows: FakeWindow[];
let controller: PrintController;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'throng-print-jobs-'));
  engine = new RecordingPrintEngine();
  store = new PrintSettingsStore(join(dir, 'print-settings.json'));
  windows = [];
  controller = new PrintController({
    engine,
    store,
    openWindow: () => {
      const w = new FakeWindow();
      windows.push(w);
      return w;
    },
    newId: () => 'job-1',
  });
});
afterEach(async () => {
  // A window closed by the test saves its settings on the way out (FR-070), and nothing in the test awaits that write.
  // Deleting the folder under it raced the write's temporary file: ENOTEMPTY on macOS (pipeline 44773457424). The
  // store's read waits for every queued write, so the folder is deleted only once they have landed.
  await store.read([]);
  rmSync(dir, { recursive: true, force: true });
});

/** `count` pages as the window draws them for the printer: an A4 image each. */
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SHEET = (count: number): PrintSheet => ({ widthMm: 210, heightMm: 297, pages: Array.from({ length: count }, () => PIXEL) });

async function openAndShow(): Promise<PrintSettings> {
  await controller.open(null, REQUEST);
  const view = await controller.describe('job-1');
  const settings = view!.settings;
  const result = await controller.render('job-1', settings);
  expect(result).toMatchObject({ pageCount: 3 });
  return settings;
}

describe('opening (FR-064, FR-071)', () => {
  it('opens one window, and a second request focuses it and changes nothing', async () => {
    expect(await controller.open(null, REQUEST)).toEqual({ opened: true });
    expect(await controller.open(null, { ...REQUEST, title: 'b.md' })).toEqual({ opened: false });
    expect(windows).toHaveLength(1);
    expect(windows[0]!.focused).toBe(1);
    expect((await controller.describe('job-1'))?.title).toBe('a.md');
  });

  it('opens one window when a second request arrives before the first has finished opening', async () => {
    // Two Print… presses in quick succession: both IPC requests reach main before the first job's folder exists.
    const [first, second] = await Promise.all([controller.open(null, REQUEST), controller.open(null, { ...REQUEST, title: 'b.md' })]);
    expect(windows).toHaveLength(1);
    expect([first.opened, second.opened].sort()).toEqual([false, true]);
    expect((await controller.describe('job-1'))?.title).toBe('a.md');
  });

  it('checks settings against the printers it last listed, without asking a slow spooler again', async () => {
    await controller.open(null, REQUEST);
    const view = await controller.describe('job-1');
    const asked = engine.calls.filter((c) => c.op === 'printers').length;
    expect(await controller.knownPrinters('job-1')).toEqual(view!.printers);
    expect(await controller.knownPrinters('job-1')).toEqual(view!.printers);
    expect(engine.calls.filter((c) => c.op === 'printers').length).toBe(asked);
    // The window's refresh (every PRINTER_REFRESH_MS) is what brings the list up to date.
    await controller.printers('job-1');
    expect(engine.calls.filter((c) => c.op === 'printers').length).toBe(asked + 1);
  });

  it('describes the job from the stored settings and the OS printers', async () => {
    await controller.open(null, REQUEST);
    expect(await controller.describe('job-1')).toEqual({
      title: 'a.md',
      settings: { ...DEFAULT_PRINT_SETTINGS, printer: 'office' },
      printers: [{ name: 'office', label: 'office' }, { name: 'home', label: 'home' }],
      fit: 'width',
    });
  });
});

describe('laying out and printing (FR-068, SC-012)', () => {
  it('lays the pages out once, with the settings given, and hands the window that PDF (FR-068a)', async () => {
    await controller.open(null, REQUEST);
    const view = await controller.describe('job-1');
    const result = await controller.render('job-1', view!.settings);
    const [laidOut] = engine.of('pdf');
    expect(engine.of('pdf')).toHaveLength(1);
    // 075 FR-068f — a document's job is laid out with the document's Centre choice (off by default).
    expect(laidOut!.options.centre).toBe(false);
    expect(laidOut!.options).toMatchObject({ pageSize: 'A4', landscape: false });
    expect(laidOut!.options.pageRanges).toBeUndefined();
    if ('error' in result) throw new Error(result.error);
    expect(result.pageCount).toBe(3);
    expect(countPdfPages(result.pdf)).toBe(3);
    expect(view!.settings.printer).toBe('office');
  });

  it('lays out only the chosen pages, so the window steps through those alone', async () => {
    await controller.open(null, REQUEST);
    const view = await controller.describe('job-1');
    const result = await controller.render('job-1', { ...view!.settings, pages: { all: false, ranges: '1, 3' } });
    expect(engine.of('pdf').at(-1)!.options.pageRanges).toBe('1,3');
    expect(result).toMatchObject({ pageCount: 2 });
  });

  /*
   * Known gap 1 (2026-11-20) — a range past the last page is clipped to the pages there are, never a layout error.
   * Chromium refuses a range that STARTS past the last page, so the controller, which learns the page count by laying
   * the document out, clips before asking for the range.
   */
  it('clips a range past the last page to the pages there are, rather than failing to lay out', async () => {
    await controller.open(null, REQUEST);
    const view = await controller.describe('job-1');
    const result = await controller.render('job-1', { ...view!.settings, pages: { all: false, ranges: '2, 5-9' } });
    expect(result).toEqual({ pageCount: 1, pdf: expect.any(Uint8Array) });
    expect(engine.of('pdf').at(-1)!.options.pageRanges).toBe('2');
  });

  it('lays out the whole document once when the range covers every page there is', async () => {
    await controller.open(null, REQUEST);
    const view = await controller.describe('job-1');
    const result = await controller.render('job-1', { ...view!.settings, pages: { all: false, ranges: '1-9' } });
    expect(result).toMatchObject({ pageCount: 3 });
    expect(engine.of('pdf')).toHaveLength(1);
  });

  it('says how many pages there are when the whole range lies past the last, and prints nothing', async () => {
    await controller.open(null, REQUEST);
    const view = await controller.describe('job-1');
    const settings: PrintSettings = { ...view!.settings, pages: { all: false, ranges: '5-7' } };
    expect(await controller.render('job-1', settings)).toEqual({ outOfRange: true, pageCount: 3 });
    expect((await controller.print('job-1', settings, SHEET(0))).ok).toBe(false);
  });

  it('never prints a job whose pages were not shown', async () => {
    await controller.open(null, REQUEST);
    const view = await controller.describe('job-1');
    expect((await controller.print('job-1', view!.settings, SHEET(3))).ok).toBe(false);
    expect(engine.of('print')).toEqual([]);
  });

  it('never prints with settings other than the ones the shown pages were laid out with', async () => {
    const settings = await openAndShow();
    expect((await controller.print('job-1', { ...settings, orientation: 'landscape' }, SHEET(3))).ok).toBe(false);
    expect(engine.of('print')).toEqual([]);
  });

  it('prints the shown pages silently, to the chosen printer, then closes', async () => {
    const settings = await openAndShow();
    expect(await controller.print('job-1', settings, SHEET(3))).toEqual({ ok: true });
    const [sent] = engine.of('print');
    expect(sent!.options).toMatchObject({ silent: true, deviceName: 'office', copies: 1 });
    expect(windows[0]!.closed).toBe(true);
  });

  /*
   * 075 (2026-11-20), the maintainer: "When a number is entered in Pages (i.e. page 1), all pages are still being
   * printed", and a document whose preview showed one page printed three, losing content between them — "the print
   * preview was also different than what was printed". The printer was handed the whole document again, to lay
   * out a second time with its own margins, scale and page range, rather than the pages the preview showed.
   */
  it('sends the printer exactly the pages the preview showed — the chosen range, nothing laid out again', async () => {
    await controller.open(null, REQUEST);
    const view = await controller.describe('job-1');
    const settings = { ...view!.settings, pages: { all: false, ranges: '1' } };
    expect(await controller.render('job-1', settings)).toMatchObject({ pageCount: 1 });

    expect(await controller.print('job-1', settings, SHEET(1))).toEqual({ ok: true });

    const [sent] = engine.of('print');
    const printed = engine.of('load').find((l) => l.handle === sent!.handle)!.output;
    if (printed.kind !== 'document') throw new Error('expected a document');
    const pages = printed.html.match(/<img\b/g) ?? [];
    expect(pages, 'the printer was sent the whole document to lay out again, not the page shown').toHaveLength(1);
    // Laid out once, by the preview: the printer adds no margin, scale or range of its own.
    expect(sent!.options).toMatchObject({ margins: { marginType: 'none' }, scaleFactor: 100 });
    expect(sent!.options.pageRanges).toBeUndefined();
  });

  it('refuses pages that are not the ones shown', async () => {
    const settings = await openAndShow();
    expect((await controller.print('job-1', settings, SHEET(2))).ok).toBe(false);
    expect(engine.of('print')).toEqual([]);
  });

  it('returns a failure\'s cause and keeps the window open to try again (FR-080)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const settings = await openAndShow();
    engine.failNextPrint = 'Printer is offline';
    expect(await controller.print('job-1', settings, SHEET(3))).toEqual({ ok: false, cause: 'Printer is offline' });
    expect(windows[0]!.closed).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('print: send job'));
    expect(await controller.print('job-1', settings, SHEET(3))).toEqual({ ok: true });
    warn.mockRestore();
  });
});

describe('saving as a PDF (FR-082)', () => {
  const PARENT = { id: 'the requesting window' };
  let asked: string[];
  let told: { parent: unknown; path: string }[];
  /** A controller whose Save dialog answers `answer(defaultPath)`. */
  const saving = (answer: (defaultPath: string) => string | null): void => {
    asked = [];
    told = [];
    controller = new PrintController({
      engine,
      store,
      openWindow: () => {
        const w = new FakeWindow();
        windows.push(w);
        return w;
      },
      newId: () => 'job-1',
      chooseSavePath: async (_window, defaultPath) => {
        asked.push(defaultPath);
        return answer(defaultPath);
      },
      onSaved: (parent, path) => told.push({ parent, path }),
    });
  };
  const NOTES: PrintJobRequest = { ...REQUEST, title: 'notes.md', filePath: join('/proj', 'docs', 'notes.md') };

  async function show(request: PrintJobRequest): Promise<PrintSettings> {
    await controller.open(PARENT, request);
    const view = await controller.describe('job-1');
    await controller.render('job-1', view!.settings);
    return view!.settings;
  }

  it('writes the PDF the preview shows where the user chose, closes, and tells the window that asked', async () => {
    const target = join(dir, 'out.pdf');
    saving(() => target);
    const settings = await show(NOTES);
    const result = await controller.savePdf('job-1', { ...settings, copies: 3 });
    expect(result).toEqual({ ok: false, cause: 'The pages are still being laid out. Try again when they are shown.' });
    expect(await controller.savePdf('job-1', settings)).toEqual({ ok: true, path: target });
    expect(asked).toEqual([join('/proj', 'docs', 'notes.pdf')]);
    // The very PDF the window was drawn from: the same layout, paper, margins, centring and range.
    const shown = engine.of('pdf');
    expect(new Uint8Array(readFileSync(target))).toEqual(await engine.pdf({ id: 'x' }, shown[shown.length - 1]!.options));
    expect(told).toEqual([{ parent: PARENT, path: target }]);
    expect(windows[0]!.closed).toBe(true);
  });

  // Maintainer, 2026-11-22 — the page's footer, its placeholders filled from the printed file.
  it('lays the pages out with the printed file\'s path in the footer when that is chosen', async () => {
    await controller.open(PARENT, NOTES);
    const view = await controller.describe('job-1');
    await controller.render('job-1', { ...view!.settings, footer: { enabled: true, text: '{path}', align: 'center' } });
    const options = engine.of('pdf').at(-1)!.options;
    expect(options.displayHeaderFooter).toBe(true);
    expect(options.footerTemplate).toContain(join('/proj', 'docs', 'notes.md'));
  });

  it('writes nothing and stays open when the dialog is cancelled', async () => {
    saving(() => null);
    const settings = await show(NOTES);
    expect(await controller.savePdf('job-1', settings)).toEqual({ cancelled: true });
    expect(told).toEqual([]);
    expect(windows[0]!.closed).toBe(false);
  });

  it('names the file and the cause when the write fails, and stays open to try again', async () => {
    saving(() => join(dir, 'no-such-folder', 'notes.pdf'));
    const settings = await show(NOTES);
    const result = await controller.savePdf('job-1', settings);
    expect(result).toMatchObject({ ok: false });
    expect((result as { cause: string }).cause).toMatch(/^notes\.pdf could not be saved: .*ENOENT/);
    expect(told).toEqual([]);
    expect(windows[0]!.closed).toBe(false);
  });
});

describe('closing (FR-070)', () => {
  it('saves the settings and frees the host', async () => {
    const settings = await openAndShow();
    controller.close('job-1', { ...settings, copies: 4 });
    await vi.waitFor(() => expect(engine.live.size).toBe(0));
    expect((await store.read(engine.printerList)).copies).toBe(4);
    expect(controller.openJobId).toBeNull();
  });

  it('saves the settings the window last told it, when the window is closed from outside (FR-070)', async () => {
    const settings = await openAndShow();
    controller.remember('job-1', { ...settings, copies: 7 });
    windows[0]!.close(); // the title bar's close, or the OS's
    await vi.waitFor(() => expect(controller.openJobId).toBeNull());
    await vi.waitFor(async () => expect((await store.read(engine.printerList)).copies).toBe(7));
  });

  it("starts a document with its own page size on that paper, and saves the paper the user had (FR-068g)", async () => {
    await store.write({ ...DEFAULT_PRINT_SETTINGS, printer: engine.printerList[0]?.name ?? null, pageSize: 'Letter' });
    const pdf: PrintJobRequest = { title: 'a.pdf', output: { kind: 'document', html: '<p>x</p>', fit: 'page', remoteImages: [], paper: { widthMm: 150, heightMm: 100 } } };
    await controller.open(null, pdf);
    const view = await controller.describe('job-1');
    expect(view!.settings).toMatchObject({ pageSize: 'Custom', orientation: 'landscape', customPaper: { width: 100, height: 150 } });
    // Closed on the PDF's own paper: the next Markdown print still starts on Letter.
    controller.close('job-1', { ...view!.settings, copies: 2 });
    await vi.waitFor(() => expect(controller.openJobId).toBeNull());
    const saved = await store.read(engine.printerList);
    expect(saved).toMatchObject({ pageSize: 'Letter', orientation: 'portrait', copies: 2 });
  });

  it('saves a paper the user chose over the document\'s own (FR-068g)', async () => {
    const pdf: PrintJobRequest = { title: 'a.pdf', output: { kind: 'document', html: '<p>x</p>', fit: 'page', remoteImages: [], paper: { widthMm: 210, heightMm: 297 } } };
    await controller.open(null, pdf);
    const view = await controller.describe('job-1');
    expect(view!.settings).toMatchObject({ pageSize: 'A4', orientation: 'portrait' });
    controller.close('job-1', { ...view!.settings, pageSize: 'A3' });
    await vi.waitFor(() => expect(controller.openJobId).toBeNull());
    expect((await store.read(engine.printerList)).pageSize).toBe('A3');
  });

  it('frees a host that finishes loading after the window closed', async () => {
    // Escape while the pages are still being laid out: the host arrives after the job is gone.
    const held: (() => void)[] = [];
    const release = (): void => held.splice(0).forEach((r) => r());
    const load = engine.load.bind(engine);
    vi.spyOn(engine, 'load').mockImplementation(async (output) => {
      await new Promise<void>((resolve) => held.push(resolve));
      return load(output);
    });
    await controller.open(null, REQUEST);
    const view = await controller.describe('job-1');
    const rendering = controller.render('job-1', view!.settings);
    await vi.waitFor(() => expect(engine.load).toHaveBeenCalled());
    windows[0]!.close();
    release();
    await rendering;
    await vi.waitFor(() => expect(engine.of('load')).toHaveLength(1));
    expect(engine.live.size).toBe(0);
  });

  it('loads one host for renders that overlap the first load', async () => {
    // A control changed while the first layout's host is still loading: both renders need the host.
    const held: (() => void)[] = [];
    const release = (): void => held.splice(0).forEach((r) => r());
    const load = engine.load.bind(engine);
    vi.spyOn(engine, 'load').mockImplementation(async (output) => {
      await new Promise<void>((resolve) => held.push(resolve));
      return load(output);
    });
    await controller.open(null, REQUEST);
    const view = await controller.describe('job-1');
    const a = controller.render('job-1', view!.settings);
    await vi.waitFor(() => expect(engine.load).toHaveBeenCalled());
    const b = controller.render('job-1', { ...view!.settings, orientation: 'landscape' });
    release();
    await Promise.all([a, b]);
    windows[0]!.close();
    await vi.waitFor(() => expect(controller.openJobId).toBeNull());
    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(engine.live.size).toBe(0);
  });

  it('reads the OS printers again for an open window, and answers nothing once it has closed (2026-11-20)', async () => {
    await controller.open(null, REQUEST);
    await controller.describe('job-1');
    engine.printerList = [...engine.printerList, { name: 'laser', displayName: 'Laser' }];
    expect(await controller.printers('job-1')).toEqual([
      { name: 'office', label: 'office' },
      { name: 'home', label: 'home' },
      { name: 'laser', label: 'Laser' },
    ]);
    windows[0]!.close();
    expect(await controller.printers('job-1')).toBeNull();
  });

  it('accepts a new job once the last has closed', async () => {
    await openAndShow();
    windows[0]!.close();
    await vi.waitFor(() => expect(controller.openJobId).toBeNull());
    expect(await controller.open(null, REQUEST)).toEqual({ opened: true });
  });
});

describe('countPdfPages', () => {
  it('counts page objects, not the page tree', () => {
    expect(countPdfPages(new TextEncoder().encode('<< /Type /Pages /Count 2 >> << /Type /Page >> << /Type/Page >>'))).toBe(2);
  });
});
