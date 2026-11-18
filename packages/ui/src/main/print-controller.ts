/**
 * Print jobs (075 FR-064, FR-068 – FR-071, FR-080, SC-012, data-model.md "Print job", contracts/print.md §IPC).
 *
 * One job at a time, because the Print Preview window is single (FR-071): a second request focuses the open
 * window and changes nothing. A job loads the printable output into the engine's host, lays it out as a PDF for
 * every settings change Print Preview reports, and shows that PDF in the window. Print sends the SAME host with
 * the SAME settings to the printer, with no OS dialog (Q4). A job whose pages were never shown cannot print
 * (SC-012). Closing — by the window's Close, by Escape, by its title bar or by its parent closing — saves the
 * last settings and removes the job's files; a cancelled job raises nothing.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  logCaught,
  printerChoices,
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
} from '@throng/core';

/** The page area inside the window, in CSS pixels, where the pages are shown. */
export interface PageArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What the controller needs of the Print Preview window (`print-preview-window.ts`). */
export interface PrintPreviewWindowLike {
  focus(): void;
  close(): void;
  /** Show the PDF at `path` in the page area. */
  showPages(path: string): Promise<void>;
  setPageArea(area: PageArea): void;
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
  /** Where a job's files go; each job has a folder of its own, removed when it closes. */
  readonly jobsDir: string;
  readonly newId?: () => string;
}

interface Job {
  readonly id: string;
  readonly request: PrintJobRequest;
  readonly window: PrintPreviewWindowLike;
  readonly dir: string;
  /** Its folder exists; every write into it waits for this. */
  readonly ready: Promise<void>;
  host: PrintHostHandle | null;
  /** The host being loaded, shared by every render that needs it, so one job never loads two. */
  hostLoad: Promise<PrintHostHandle> | null;
  printers: readonly PrinterInfoLike[];
  settings: PrintSettings | null;
  /** The settings the pages on screen were laid out with; `null` until they are shown. */
  shown: PrintSettings | null;
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
  async open(parent: unknown, request: PrintJobRequest): Promise<{ opened: boolean }> {
    if (this.job !== null) {
      this.job.window.focus();
      return { opened: false };
    }
    // Claimed before anything is awaited: a second request arriving while this one opens must find it (FR-071).
    const id = this.newId();
    const dir = join(this.deps.jobsDir, id);
    const ready = mkdir(dir, { recursive: true }).then(() => undefined);
    const window = this.deps.openWindow(parent, id);
    const job: Job = { id, request, window, dir, ready, host: null, hostLoad: null, printers: [], settings: null, shown: null, renders: 0, state: 'open' };
    this.job = job;
    window.onClosed(() => void this.finish(job));
    await ready;
    return { opened: true };
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

  /** FR-068 — lay the pages out with `settings` and show them. */
  async render(jobId: string, settings: PrintSettings): Promise<PrintRenderResult> {
    const job = this.live(jobId);
    if (job === null) return { error: 'This print job has closed.' };
    job.settings = settings;
    const render = ++job.renders;
    try {
      const host = await this.hostOf(job);
      const pdf = await this.deps.engine.pdf(host, toPdfOptions(settings));
      if (job.state === 'closed' || render !== job.renders) return { pageCount: countPdfPages(pdf) };
      const path = join(job.dir, `pages-${render}.pdf`);
      await job.ready;
      await writeFile(path, pdf);
      await job.window.showPages(path);
      job.shown = settings;
      if (job.state === 'open') job.state = 'previewing';
      return { pageCount: countPdfPages(pdf) };
    } catch (error) {
      // A job closed mid-layout is a cancel, not a failure (FR-080).
      if (job.state === 'closed') return { error: 'This print job has closed.' };
      logCaught('print: lay out the pages', error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  setPageArea(jobId: string, area: PageArea): void {
    this.live(jobId)?.window.setPageArea(area);
  }

  /**
   * Print with `settings`, with no OS dialog. Refused unless the pages on screen were laid out with exactly these
   * settings (SC-012). On success the window closes; a failure returns its cause, for the window to show (FR-080).
   */
  async print(jobId: string, settings: PrintSettings): Promise<PrintSendResult> {
    const job = this.live(jobId);
    if (job === null) return { ok: false, cause: 'This print job has closed.' };
    if (job.state !== 'previewing' || job.host === null || !sameSettings(job.shown, settings)) {
      return { ok: false, cause: 'The pages are still being laid out. Try again when they are shown.' };
    }
    const options = toPrintOptions(settings);
    if (options === null) return { ok: false, cause: 'No printer is available.' };
    job.state = 'printing';
    const result = await this.deps.engine.print(job.host, options);
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

  /** However the window went: save, free the host, remove the files. Runs once. */
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
    await rm(job.dir, { recursive: true, force: true }).catch((error: unknown) => logCaught('print: remove the job files', error));
  }
}
