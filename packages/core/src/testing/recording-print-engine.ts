import type { IPrintEngine, PrintHostHandle, PrintSendResult } from '../abstractions/print-engine.js';
import type { PdfOptions, PrintableOutput, PrinterInfoLike, PrintOptions } from '../preview/print.js';

/** One call the engine received, in order. */
export type PrintEngineCall =
  | { readonly op: 'printers' }
  | { readonly op: 'load'; readonly output: PrintableOutput; readonly handle: string }
  | { readonly op: 'pdf'; readonly handle: string; readonly options: PdfOptions }
  | { readonly op: 'print'; readonly handle: string; readonly options: PrintOptions }
  | { readonly op: 'dispose'; readonly handle: string };

/**
 * An in-memory `IPrintEngine` for tests (075 T035): records every call, answers `pdf` with a PDF whose page count
 * is `pageCount`, and fails the next `print` with `failNextPrint` when set.
 */
export class RecordingPrintEngine implements IPrintEngine {
  readonly calls: PrintEngineCall[] = [];
  readonly live = new Set<string>();
  pageCount = 3;
  failNextPrint: string | null = null;
  private next = 0;

  constructor(public printerList: PrinterInfoLike[] = [{ name: 'office', isDefault: true }, { name: 'home' }]) {}

  async printers(): Promise<readonly PrinterInfoLike[]> {
    this.calls.push({ op: 'printers' });
    return this.printerList;
  }

  async load(output: PrintableOutput): Promise<PrintHostHandle> {
    const id = `host-${++this.next}`;
    this.live.add(id);
    this.calls.push({ op: 'load', output, handle: id });
    return { id };
  }

  async pdf(handle: PrintHostHandle, options: PdfOptions): Promise<Uint8Array> {
    this.calls.push({ op: 'pdf', handle: handle.id, options });
    const pages = Array.from({ length: this.pageCount }, () => '<< /Type /Page >>').join('\n');
    return new TextEncoder().encode(`%PDF-1.7\n${pages}\n%%EOF`);
  }

  async print(handle: PrintHostHandle, options: PrintOptions): Promise<PrintSendResult> {
    this.calls.push({ op: 'print', handle: handle.id, options });
    if (this.failNextPrint !== null) {
      const cause = this.failNextPrint;
      this.failNextPrint = null;
      return { ok: false, cause };
    }
    return { ok: true };
  }

  dispose(handle: PrintHostHandle): void {
    this.live.delete(handle.id);
    this.calls.push({ op: 'dispose', handle: handle.id });
  }

  /** The calls of one kind. */
  of<K extends PrintEngineCall['op']>(op: K): Extract<PrintEngineCall, { op: K }>[] {
    return this.calls.filter((c): c is Extract<PrintEngineCall, { op: K }> => c.op === op);
  }
}
