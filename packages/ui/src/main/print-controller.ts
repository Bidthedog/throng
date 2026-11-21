/**
 * Print jobs (075 FR-064, FR-068 – FR-071, FR-080, SC-012, data-model.md "Print job", contracts/print.md §IPC).
 *
 * One job at a time, because the Print Preview window is single (FR-071): a second request focuses the open
 * window and changes nothing. A job loads the printable output into the engine's host and lays it out as a PDF
 * for every settings change Print Preview reports, handing the window that PDF's bytes; the window draws its pages
 * one at a time itself (FR-068a), so stepping between pages lays nothing out again. Print sends the SAME host
 * with the SAME settings to the printer, with no OS dialog (Q4). A job whose pages were never laid out for the
 * window cannot print (SC-012). Closing — by the window's Close, by Escape, by its title bar or by its parent
 * closing — saves the last settings and frees the host; a cancelled job raises nothing.
 */
import { randomUUID } from 'node:crypto';
import {
  clipPageRanges,
  logCaught,
  parsePageRanges,
  printerChoices,
  printSheetHtml,
  toPdfOptions,
  toPrintOptions,
  type IPrintEngine,
  type PrinterInfoLike,
  type PrintHostHandle,
  type PrintJobRequest,
  type PrintJobView,
  type PrintRenderResult,
  type PrintSendResult,
  type PrintSettings,
  type PrintSheet,
} from '@throng/core';

/** What the controller needs of the Print Preview window (`print-preview-window.ts`). */
export interface PrintPreviewWindowLike {
  focus(): void;
  close(): void;
  /** Called once, however the window closes. */
  onClosed(listener: () => void): void;
}

export interface PrintSettingsStoreLike {
  read(printers: readonly PrinterInfoLike[]): Promise<PrintSettings>;
  write(settings: PrintSettings): Promise<void>;
}

export interface PrintControllerDeps {
  readonly engine: IPrintEngine;
  readonly store: PrintSettingsStoreLike;
  /** Open the Print Preview window for `jobId`, modal to `parent`. */
  readonly openWindow: (parent: unknown, jobId: string) => PrintPreviewWindowLike;
  readonly newId?: () => string;
}

interface Job {
  readonly id: string;
  readonly request: PrintJobRequest;
  readonly window: PrintPreviewWindowLike;
  host: PrintHostHandle | null;
  /** The host being loaded, shared by every render that needs it, so one job never loads two. */
  hostLoad: Promise<PrintHostHandle> | null;
  printers: readonly PrinterInfoLike[];
  settings: PrintSettings | null;
  /** The settings the window's pages were laid out with; `null` until a layout reached it. */
  shown: PrintSettings | null;
  /** How many pages that layout made: the sheet a print sends must be exactly those. */
  shownPages: number;
  renders: number;
  state: 'open' | 'previewing' | 'printing' | 'closed';
}

/** How many pages a PDF holds: its page objects, not its page tree. */
export function countPdfPages(pdf: Uint8Array): number {
  const text = Buffer.from(pdf).toString('latin1');
  return (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
}

const sameSettings = (a: PrintSettings | null, b: PrintSettings): boolean => a !== null && JSON.stringify(a) === JSON.stringify(b);

export class PrintController {
  private job: Job | null = null;
  private readonly newId: () => string;

  constructor(private readonly deps: PrintControllerDeps) {
    this.newId = deps.newId ?? randomUUID;
  }

  /** The open job's id, or `null`. */
  get openJobId(): string | null {
    return this.job?.id ?? null;
  }

  /** FR-064, FR-071 — open Print Preview, or focus the one already open. */
  open(parent: unknown, request: PrintJobRequest): Promise<{ opened: boolean }> {
    if (this.job !== null) {
      this.job.window.focus();
      return Promise.resolve({ opened: false });
    }
    // Claimed before anything else: a second request arriving while this one opens must find it (FR-071).
    const id = this.newId();
    const window = this.deps.openWindow(parent, id);
    const job: Job = { id, request, window, host: null, hostLoad: null, printers: [], settings: null, shown: null, shownPages: 0, renders: 0, state: 'open' };
    this.job = job;
    window.onClosed(() => void this.finish(job));
    return Promise.resolve({ opened: true });
  }

  /** What the window starts from: the stored settings against today's printers. */
  async describe(jobId: string): Promise<PrintJobView | null> {
    const job = this.live(jobId);
    if (job === null) return null;
    job.printers = await this.deps.engine.printers();
    job.settings ??= await this.deps.store.read(job.printers);
    const fit = job.request.output.kind === 'document' ? job.request.output.fit : 'page';
    return { title: job.request.title, settings: job.settings, printers: printerChoices(job.printers), fit };
  }

  /**
   * The printers this job last listed, to check settings against: render, print and close never ask the OS again
   * (a slow spooler would hold each of them, Escape included). The window's refresh ({@link printers}) keeps the list
   * current; a job that has listed none yet asks once. `null` once the job closed.
   */
  async knownPrinters(jobId: string): Promise<PrintJobView['printers'] | null> {
    const job = this.live(jobId);
    if (job === null) return null;
    if (job.printers.length === 0) job.printers = await this.deps.engine.printers();
    return printerChoices(job.printers);
  }

  /** 2026-11-20 — the OS's printers now, for a window that keeps its list current; `null` once the job closed. */
  async printers(jobId: string): Promise<PrintJobView['printers'] | null> {
    const job = this.live(jobId);
    if (job === null) return null;
    job.printers = await this.deps.engine.printers();
    return printerChoices(job.printers);
  }

  /**
   * FR-068, FR-068a — lay the pages out with `settings`, and hand the window the PDF to draw them from. Only the
   * latest render counts as what the window shows: one superseded on its way is answered, but prints nothing.
   */
  async render(jobId: string, settings: PrintSettings): Promise<PrintRenderResult> {
    const job = this.live(jobId);
    if (job === null) return { error: 'This print job has closed.' };
    job.settings = settings;
    const render = ++job.renders;
    try {
      const host = await this.hostOf(job);
      const pdf = await this.pagesOf(host, settings, job.request.output.kind === 'document' ? job.request.output.fit : 'page');
      if (!(pdf instanceof Uint8Array)) {
        // Nothing the range names exists: nothing is shown, so nothing can print (SC-012).
        if (job.state !== 'closed' && render === job.renders) job.shown = null;
        return pdf;
      }
      const pageCount = countPdfPages(pdf);
      if (job.state !== 'closed' && render === job.renders) {
        job.shown = settings;
        job.shownPages = pageCount;
        if (job.state === 'open') job.state = 'previewing';
      }
      return { pageCount, pdf };
    } catch (error) {
      // A job closed mid-layout is a cancel, not a failure (FR-080).
      if (job.state === 'closed') return { error: 'This print job has closed.' };
      logCaught('print: lay out the pages', error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Known gap 1 (2026-11-20) — the PDF of the pages `settings` names. Chromium refuses a range that starts past the
   * last page ("Page range exceeds page count") and nothing else here knows the page count, so a range is laid out
   * against the whole document first: past its end, the range is clipped to the pages there are, and a range left
   * with none says how many there are instead. A range covering every page is that first layout, laid out once.
   */
  private async pagesOf(
    host: PrintHostHandle,
    settings: PrintSettings,
    fit: 'width' | 'page',
  ): Promise<Uint8Array | { outOfRange: true; pageCount: number }> {
    const ranges = settings.pages.all ? null : parsePageRanges(settings.pages.ranges);
    if (ranges === null) return this.deps.engine.pdf(host, toPdfOptions(settings, undefined, fit));
    const whole = await this.deps.engine.pdf(host, toPdfOptions({ ...settings, pages: { all: true } }, undefined, fit));
    const total = countPdfPages(whole);
    const kept = clipPageRanges(ranges, total);
    if (kept.length === 0) return { outOfRange: true, pageCount: total };
    if (kept.length === 1 && kept[0]!.from === 1 && kept[0]!.to === total) return whole;
    return this.deps.engine.pdf(host, toPdfOptions(settings, total, fit));
  }

  /**
   * Print `sheet` — the pages the window shows, drawn — with `settings`' printer and copies, and no OS dialog.
   * Refused unless the window's pages were laid out with exactly these settings and the sheet holds exactly those
   * pages (SC-012). The printer lays nothing out again (2026-11-20): what prints is what was shown. On success the
   * window closes; a failure returns its cause, for the window to show (FR-080).
   */
  async print(jobId: string, settings: PrintSettings, sheet: PrintSheet): Promise<PrintSendResult> {
    const job = this.live(jobId);
    if (job === null) return { ok: false, cause: 'This print job has closed.' };
    if (job.state !== 'previewing' || job.host === null || !sameSettings(job.shown, settings) || sheet.pages.length !== job.shownPages) {
      return { ok: false, cause: 'The pages are still being laid out. Try again when they are shown.' };
    }
    const options = toPrintOptions(settings);
    if (options === null) return { ok: false, cause: 'No printer is available.' };
    job.state = 'printing';
    let result: PrintSendResult;
    let paper: PrintHostHandle | null = null;
    try {
      paper = await this.deps.engine.load({ kind: 'document', html: printSheetHtml(sheet), fit: 'page', remoteImages: [] });
      result = await this.deps.engine.print(paper, options);
    } catch (error) {
      // Logged with the failed send below, once, whichever step threw.
      result = { ok: false, cause: error instanceof Error ? error.message : String(error) };
      logCaught('print: load the pages to print', error);
    } finally {
      if (paper !== null) this.deps.engine.dispose(paper);
    }
    if (!result.ok) {
      logCaught('print: send job', new Error(result.cause));
      job.state = 'previewing';
      return result;
    }
    job.settings = settings;
    job.window.close();
    return result;
  }

  /** Save `settings` and close (Close, Escape). */
  /**
   * FR-070 — the window's settings as they stand, sent on every change. The window can close without saying so (its
   * title bar's close, the OS's), and `finish` then saves these: a change still inside the layout's debounce, or
   * made while the page range names no pages, is kept rather than lost to the last settings laid out.
   */
  remember(jobId: string, settings: PrintSettings): void {
    const job = this.live(jobId);
    if (job !== null) job.settings = settings;
  }

  close(jobId: string, settings: PrintSettings): void {
    const job = this.live(jobId);
    if (job === null) return;
    job.settings = settings;
    job.window.close();
  }

  /**
   * The job's host, loading it on first use. Renders that overlap the first load share it; a host that arrives
   * after the window closed is freed at once, since the close found nothing to free.
   */
  private hostOf(job: Job): Promise<PrintHostHandle> {
    job.hostLoad ??= this.deps.engine.load(job.request.output).then(
      (host) => {
        if (job.state === 'closed') {
          this.deps.engine.dispose(host);
          throw new Error('This print job has closed.');
        }
        job.host = host;
        return host;
      },
      (error: unknown) => {
        job.hostLoad = null;
        throw error;
      },
    );
    return job.hostLoad;
  }

  private live(jobId: string): Job | null {
    const job = this.job;
    return job !== null && job.id === jobId && job.state !== 'closed' ? job : null;
  }

  /** However the window went: save and free the host. Runs once. */
  private async finish(job: Job): Promise<void> {
    if (job.state === 'closed') return;
    job.state = 'closed';
    if (this.job === job) this.job = null;
    if (job.host !== null) this.deps.engine.dispose(job.host);
    try {
      if (job.settings !== null) await this.deps.store.write(job.settings);
    } catch (error) {
      logCaught('print: save the settings', error);
    }
  }
}
