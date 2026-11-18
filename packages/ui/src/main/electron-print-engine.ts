/**
 * Electron's print engine (075, research R8, contracts/print.md §Engine port) — the `IPrintEngine` adapter.
 *
 * A printable document loads into a hidden, sandboxed host window with JavaScript disabled, from a temporary file.
 * Its pages are `printToPDF` of that host; printing is `print({ silent: true })` of the same host with the same
 * settings, so the pages Print Preview shows are the pages the printer gets (FR-068). No OS print dialog ever
 * opens (Q4).
 *
 * The host's session refuses every request except the document itself, its bundled assets (fonts, the preview's
 * own images through `throng-preview:`) and the remote images the preview had already shown (FR-079, Complexity
 * Tracking): a printable document can name a URL, but only those can be fetched.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, session as electronSession, webContents as electronWebContents } from 'electron';
import {
  logCaught,
  logExpected,
  type IPrintEngine,
  type PdfOptions,
  type PrintableOutput,
  type PrinterInfoLike,
  type PrintHostHandle,
  type PrintOptions,
  type PrintSendResult,
} from '@throng/core';

/** A partition of its own, so the host's request filter governs nothing else. */
const PRINT_PARTITION = 'throng-print-host';

interface Host {
  readonly window: BrowserWindow;
  readonly file: string;
  readonly allowed: ReadonlySet<string>;
}

export interface ElectronPrintEngineDeps {
  /** Where the hosts' documents are written. */
  readonly dir: string;
  /** Whether a URL is one of the app's own bundled assets (the renderer bundle, its fonts). */
  readonly isBundledAsset: (url: string) => boolean;
  /** Register the preview's image route on the host's session, as the app's own session has it. */
  readonly registerPreviewRoute?: (session: Electron.Session) => void;
}

export class ElectronPrintEngine implements IPrintEngine {
  private readonly hosts = new Map<string, Host>();
  private filterInstalled = false;

  constructor(private readonly deps: ElectronPrintEngineDeps) {}

  async printers(): Promise<readonly PrinterInfoLike[]> {
    const any = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())?.webContents ?? electronWebContents.getAllWebContents()[0];
    if (any === undefined) return [];
    const printers = await any.getPrintersAsync();
    return printers.map((p) => ({
      name: p.name,
      displayName: p.displayName,
      isDefault: (p as { isDefault?: boolean }).isDefault,
      options: p.options as Record<string, string> | undefined,
    }));
  }

  private session(): Electron.Session {
    const s = electronSession.fromPartition(PRINT_PARTITION);
    if (!this.filterInstalled) {
      this.filterInstalled = true;
      this.deps.registerPreviewRoute?.(s);
      s.webRequest.onBeforeRequest((details, callback) => {
        const host = [...this.hosts.values()].find((h) => h.window.webContents.id === details.webContentsId);
        const url = details.url;
        const ok =
          host !== undefined &&
          (url === pathToFileURL(host.file).href || host.allowed.has(url) || url.startsWith('data:') || url.startsWith('throng-preview:') || this.deps.isBundledAsset(url));
        callback({ cancel: !ok });
      });
    }
    return s;
  }

  async load(output: PrintableOutput): Promise<PrintHostHandle> {
    const id = randomUUID();
    await mkdir(this.deps.dir, { recursive: true });
    const file = join(this.deps.dir, `${id}.${output.kind === 'document' ? 'html' : 'pdf'}`);
    await writeFile(file, output.kind === 'document' ? output.html : output.pdf);
    const window = new BrowserWindow({
      show: false,
      width: 800,
      height: 1100,
      webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, session: this.session(), offscreen: false },
    });
    const allowed = new Set(output.kind === 'document' ? output.remoteImages : []);
    this.hosts.set(id, { window, file, allowed });
    try {
      await window.loadFile(file);
    } catch (error) {
      this.dispose({ id });
      throw error;
    }
    return { id };
  }

  async pdf(handle: PrintHostHandle, options: PdfOptions): Promise<Uint8Array> {
    const host = this.hosts.get(handle.id);
    if (host === undefined) throw new Error('The print host has closed.');
    const buffer = await host.window.webContents.printToPDF({
      pageSize: options.pageSize,
      landscape: options.landscape,
      margins: options.margins,
      scale: options.scale,
      printBackground: options.printBackground,
      preferCSSPageSize: options.preferCSSPageSize,
      ...(options.pageRanges !== undefined ? { pageRanges: options.pageRanges } : {}),
    });
    return new Uint8Array(buffer);
  }

  print(handle: PrintHostHandle, options: PrintOptions): Promise<PrintSendResult> {
    const host = this.hosts.get(handle.id);
    if (host === undefined) return Promise.resolve({ ok: false, cause: 'The print host has closed.' });
    return new Promise((resolve) => {
      try {
        host.window.webContents.print(
          {
            silent: options.silent,
            deviceName: options.deviceName,
            pageSize: options.pageSize,
            landscape: options.landscape,
            margins: options.margins,
            scaleFactor: options.scaleFactor,
            copies: options.copies,
            printBackground: options.printBackground,
            ...(options.pageRanges !== undefined ? { pageRanges: [...options.pageRanges] } : {}),
          },
          (success, failureReason) => resolve(success ? { ok: true } : { ok: false, cause: failureReason || 'The printer did not accept the job.' }),
        );
      } catch (error) {
        logCaught('print: start the job', error);
        resolve({ ok: false, cause: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  dispose(handle: PrintHostHandle): void {
    const host = this.hosts.get(handle.id);
    if (host === undefined) return;
    this.hosts.delete(handle.id);
    if (!host.window.isDestroyed()) host.window.destroy();
    void rm(host.file, { force: true }).catch((error: unknown) =>
      logExpected('print: remove a host document', 'the job folder is removed as a whole when the window closes', error),
    );
  }
}
