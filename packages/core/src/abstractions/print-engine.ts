/**
 * The OS print engine (075, contracts/print.md §Engine port, Principle II).
 *
 * Main lays a printable document out in a hidden host, renders it to PDF for Print Preview and sends the same
 * host, with the same settings, to a printer without the OS dialog. Electron's adapter lives in `ui/main`; core's
 * `RecordingPrintEngine` (testing) records every call so a test can prove nothing printed unseen (SC-012).
 */
import type { PdfOptions, PrintableOutput, PrinterInfoLike, PrintOptions } from '../preview/print.js';

/** An opaque handle to one loaded printable document. */
export interface PrintHostHandle {
  readonly id: string;
}

export type PrintSendResult = { readonly ok: true } | { readonly ok: false; readonly cause: string };

export interface IPrintEngine {
  /** The printers the OS offers, in its order. */
  printers(): Promise<readonly PrinterInfoLike[]>;
  /** Load `output` into a host ready to lay out. */
  load(output: PrintableOutput): Promise<PrintHostHandle>;
  /** The pages `options` lays the host out as. */
  pdf(handle: PrintHostHandle, options: PdfOptions): Promise<Uint8Array>;
  /** Send the host to a printer, with no OS dialog. Never throws: a failure is its cause. */
  print(handle: PrintHostHandle, options: PrintOptions): Promise<PrintSendResult>;
  /** Free the host. Idempotent. */
  dispose(handle: PrintHostHandle): void;
}
