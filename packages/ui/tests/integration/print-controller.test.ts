// Layer: integration — the settings file on disk (and the PDF written to disk) is what this proves; the engine and the window
// are doubles, since printing itself is the OS's. The rest of the job's logic is in tests/unit/print-controller.test.ts.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PRINT_SETTINGS, type PrintJobRequest, type PrintSettings } from '@throng/core';
import { RecordingPrintEngine } from '@throng/core/testing';
import { PrintController, type PrintPreviewWindowLike } from '../../src/main/print-controller.js';
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

async function openAndShow(): Promise<PrintSettings> {
  await controller.open(null, REQUEST);
  const view = await controller.describe('job-1');
  const settings = view!.settings;
  const result = await controller.render('job-1', settings);
  expect(result).toMatchObject({ pageCount: 3 });
  return settings;
}

describe('saving as a PDF (FR-082)', () => {
  const PARENT = { id: 'the requesting window' };
  const NOTES: PrintJobRequest = { ...REQUEST, title: 'notes.md', filePath: join('/proj', 'docs', 'notes.md') };

  it('writes the PDF the preview shows where the user chose, closes, and tells the window that asked', async () => {
    const target = join(dir, 'out.pdf');
    const told: { parent: unknown; path: string }[] = [];
    const asked: string[] = [];
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
        return target;
      },
      onSaved: (parent, path) => told.push({ parent, path }),
    });
    await controller.open(PARENT, NOTES);
    const view = await controller.describe('job-1');
    await controller.render('job-1', view!.settings);
    const settings = view!.settings;
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
});
