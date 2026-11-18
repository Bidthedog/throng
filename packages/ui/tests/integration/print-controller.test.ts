// Layer: integration — a job's files on disk and the settings file are what this proves; the engine and the window
// are doubles, since printing itself is the OS's.
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PRINT_SETTINGS, type PrintJobRequest, type PrintSettings } from '@throng/core';
import { RecordingPrintEngine } from '@throng/core/testing';
import { PrintController, countPdfPages, type PrintPreviewWindowLike } from '../../src/main/print-controller.js';
import { PrintSettingsStore } from '../../src/main/print-settings-store.js';

/** 075 FR-064, FR-068 – FR-071, FR-080, SC-012 — the print job, from open to close. */
const REQUEST: PrintJobRequest = { title: 'a.md', output: { kind: 'document', html: '<p>x</p>', fit: 'width', remoteImages: [] } };

class FakeWindow implements PrintPreviewWindowLike {
  focused = 0;
  closed = false;
  shown: string[] = [];
  private listener: (() => void) | null = null;
  focus(): void {
    this.focused += 1;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.listener?.();
  }
  async showPages(path: string): Promise<void> {
    this.shown.push(path);
  }
  setPageArea(): void {}
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
    jobsDir: join(dir, 'print-jobs'),
    openWindow: () => {
      const w = new FakeWindow();
      windows.push(w);
      return w;
    },
    newId: () => 'job-1',
  });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function openAndShow(): Promise<PrintSettings> {
  await controller.open(null, REQUEST);
  const view = await controller.describe('job-1');
  const settings = view!.settings;
  expect(await controller.render('job-1', settings)).toEqual({ pageCount: 3 });
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
  it('shows the pages it laid out, with the settings given', async () => {
    const settings = await openAndShow();
    expect(engine.of('pdf')[0]!.options).toMatchObject({ pageSize: 'A4', landscape: false });
    expect(windows[0]!.shown).toHaveLength(1);
    expect(existsSync(windows[0]!.shown[0]!)).toBe(true);
    expect(settings.printer).toBe('office');
  });

  it('never prints a job whose pages were not shown', async () => {
    await controller.open(null, REQUEST);
    const view = await controller.describe('job-1');
    expect((await controller.print('job-1', view!.settings)).ok).toBe(false);
    expect(engine.of('print')).toEqual([]);
  });

  it('never prints with settings other than the ones the shown pages were laid out with', async () => {
    const settings = await openAndShow();
    expect((await controller.print('job-1', { ...settings, orientation: 'landscape' })).ok).toBe(false);
    expect(engine.of('print')).toEqual([]);
  });

  it('prints the shown host silently, to the chosen printer, then closes', async () => {
    const settings = await openAndShow();
    expect(await controller.print('job-1', settings)).toEqual({ ok: true });
    const [sent] = engine.of('print');
    expect(sent!.options).toMatchObject({ silent: true, deviceName: 'office', copies: 1 });
    expect(sent!.handle).toBe(engine.of('load')[0]!.handle);
    expect(windows[0]!.closed).toBe(true);
  });

  it('returns a failure\'s cause and keeps the window open to try again (FR-080)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const settings = await openAndShow();
    engine.failNextPrint = 'Printer is offline';
    expect(await controller.print('job-1', settings)).toEqual({ ok: false, cause: 'Printer is offline' });
    expect(windows[0]!.closed).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('print: send job'));
    expect(await controller.print('job-1', settings)).toEqual({ ok: true });
    warn.mockRestore();
  });
});

describe('closing (FR-070)', () => {
  it('saves the settings, frees the host and removes the job files', async () => {
    const settings = await openAndShow();
    controller.close('job-1', { ...settings, copies: 4 });
    await vi.waitFor(() => expect(readdirSync(join(dir, 'print-jobs'))).toEqual([]));
    expect(engine.live.size).toBe(0);
    expect((await store.read(engine.printerList)).copies).toBe(4);
    expect(controller.openJobId).toBeNull();
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
