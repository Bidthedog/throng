/**
 * Printing a preview (075, FR-060 – FR-081, data-model.md "Print settings", research R10).
 *
 * Pure: the shape of what a provider hands over to print, the settings Print Preview offers, their defaults and
 * the tolerant parse that brings a stored file back, and the two mappings to what Electron's PDF render and its
 * print call take. The PDF that Print Preview shows and the job sent to the printer are built from one settings
 * object through these mappings, so the pages shown are the pages printed (FR-068).
 */

/** What a provider prints (FR-060): a flowing document throng paginates, or ready-made pages. */
export type PrintableOutput =
  | {
      readonly kind: 'document';
      /** A complete HTML document, built by the renderer's printable builder. */
      readonly html: string;
      /** `width`: the text column's width (a document); `page`: one picture fitted to the page (FR-075). */
      readonly fit: 'width' | 'page';
      /** The `https:` images the preview had already loaded — the only remote requests printing may make (FR-079). */
      readonly remoteImages: readonly string[];
    }
  | { readonly kind: 'pages'; readonly pdf: Uint8Array };

/** What a preview window asks main for, through `throng.print.open`. */
export interface PrintJobRequest {
  readonly title: string;
  readonly output: PrintableOutput;
}

/** What the Print Preview window reads about its job (`throng.print.job`). */
export interface PrintJobView {
  readonly title: string;
  readonly settings: PrintSettings;
  readonly printers: readonly PrinterChoice[];
  readonly fit: 'width' | 'page';
}

/** The answer to `throng.print.render`: the pages laid out, or why they could not be. */
export type PrintRenderResult = { readonly pageCount: number } | { readonly error: string };

/** The paper sizes offered, each a name both of Electron's calls accept (research R10). */
export const PRINT_PAGE_SIZES = ['A3', 'A4', 'A5', 'Letter', 'Legal', 'Tabloid'] as const;
export type PrintPageSize = (typeof PRINT_PAGE_SIZES)[number];

/** Each size in millimetres, portrait (width × height). */
export const PAGE_SIZE_MM: Readonly<Record<PrintPageSize, { readonly width: number; readonly height: number }>> = {
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
  Tabloid: { width: 279.4, height: 431.8 },
};

export type PrintOrientation = 'portrait' | 'landscape';
export type PrintMarginPreset = 'default' | 'none' | 'minimum' | 'custom';

export interface PrintMargins {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** The fixed presets, in millimetres, so the PDF and the job always agree (research R10). */
export const MARGIN_PRESETS_MM: Readonly<Record<Exclude<PrintMarginPreset, 'custom'>, number>> = {
  default: 10,
  minimum: 5,
  none: 0,
};
export const MARGIN_MAX_MM = 50;
export const SCALE_MIN = 10;
export const SCALE_MAX = 200;
export const COPIES_MAX = 99;

/** Everything Print Preview offers (FR-068). `pages` never persists (FR-070). */
export interface PrintSettings {
  /** The printer's name; `null` when no printer is available. */
  readonly printer: string | null;
  readonly pageSize: PrintPageSize;
  readonly orientation: PrintOrientation;
  readonly margins: { readonly preset: PrintMarginPreset; readonly custom: PrintMargins };
  readonly scale: { readonly fitWidth: boolean; readonly percent: number };
  readonly copies: number;
  readonly pages: { readonly all: true } | { readonly all: false; readonly ranges: string };
}

/** The parts of a printer the settings read: Electron's `PrinterInfo` subset. */
export interface PrinterInfoLike {
  readonly name: string;
  readonly displayName?: string;
  readonly isDefault?: boolean;
  readonly options?: Readonly<Record<string, string>>;
}

/** A printer as Print Preview lists it. */
export interface PrinterChoice {
  readonly name: string;
  readonly label: string;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = Object.freeze({
  printer: null,
  pageSize: 'A4',
  orientation: 'portrait',
  margins: Object.freeze({ preset: 'default', custom: Object.freeze({ top: 10, right: 10, bottom: 10, left: 10 }) }),
  scale: Object.freeze({ fitWidth: true, percent: 100 }),
  copies: 1,
  pages: Object.freeze({ all: true }),
}) as PrintSettings;

/** The OS default printer: `isDefault` where the OS says, else CUPS' `printer-is-default`, else the first. */
export function pickDefaultPrinter(printers: readonly PrinterInfoLike[]): string | null {
  const flagged = printers.find((p) => p.isDefault === true) ?? printers.find((p) => p.options?.['printer-is-default'] === 'true');
  return (flagged ?? printers[0])?.name ?? null;
}

export function printerChoices(printers: readonly PrinterInfoLike[]): PrinterChoice[] {
  return printers.map((p) => ({ name: p.name, label: p.displayName !== undefined && p.displayName.length > 0 ? p.displayName : p.name }));
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const inRange = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

function parseMargins(raw: unknown): PrintSettings['margins'] {
  const fallback = DEFAULT_PRINT_SETTINGS.margins;
  if (!isObject(raw)) return fallback;
  const preset = (['default', 'none', 'minimum', 'custom'] as const).find((p) => p === raw.preset) ?? fallback.preset;
  const c = isObject(raw.custom) ? raw.custom : {};
  const side = (k: keyof PrintMargins): number => (inRange(c[k], 0, MARGIN_MAX_MM) ? (c[k] as number) : fallback.custom[k]);
  return { preset, custom: { top: side('top'), right: side('right'), bottom: side('bottom'), left: side('left') } };
}

/**
 * The stored settings, as Print Preview starts from them (FR-070): each field validated on its own, an invalid
 * one taking its default; a printer no longer present falling back to the default printer; the page range
 * always All. `raw` is the parsed file's `settings` object, or anything at all.
 */
export function parsePrintSettings(raw: unknown, printers: readonly PrinterInfoLike[]): PrintSettings {
  const d = DEFAULT_PRINT_SETTINGS;
  const o = isObject(raw) ? raw : {};
  const known = typeof o.printer === 'string' && printers.some((p) => p.name === o.printer);
  const scale = isObject(o.scale) ? o.scale : {};
  return {
    printer: known ? (o.printer as string) : pickDefaultPrinter(printers),
    pageSize: PRINT_PAGE_SIZES.find((s) => s === o.pageSize) ?? d.pageSize,
    orientation: o.orientation === 'landscape' || o.orientation === 'portrait' ? o.orientation : d.orientation,
    margins: parseMargins(o.margins),
    scale: {
      fitWidth: typeof scale.fitWidth === 'boolean' ? scale.fitWidth : d.scale.fitWidth,
      percent: inRange(scale.percent, SCALE_MIN, SCALE_MAX) ? Math.round(scale.percent as number) : d.scale.percent,
    },
    copies: Number.isInteger(o.copies) && inRange(o.copies, 1, COPIES_MAX) ? (o.copies as number) : d.copies,
    pages: { all: true },
  };
}

/** The file `print-settings.json` holds: every field but the page range (FR-070). */
export function serialisePrintSettings(s: PrintSettings): { version: 1; settings: Omit<PrintSettings, 'pages'> } {
  const { pages: _pages, ...kept } = s;
  return { version: 1, settings: kept };
}

/**
 * A page-range string — `1-3, 5` — as sorted, merged 1-based ranges, or `null` when it is malformed or names no
 * page. A range past the last page is clipped by the caller, which knows the page count.
 */
export function parsePageRanges(text: string): { from: number; to: number }[] | null {
  const parts = text.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const ranges: { from: number; to: number }[] = [];
  for (const part of parts) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (m === null) return null;
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (from < 1 || to < from) return null;
    ranges.push({ from, to });
  }
  ranges.sort((a, b) => a.from - b.from);
  const merged: { from: number; to: number }[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last !== undefined && r.from <= last.to + 1) last.to = Math.max(last.to, r.to);
    else merged.push({ ...r });
  }
  return merged;
}

/** The margins in effect, in millimetres. */
export function marginsMm(s: PrintSettings): PrintMargins {
  if (s.margins.preset === 'custom') return s.margins.custom;
  const all = MARGIN_PRESETS_MM[s.margins.preset];
  return { top: all, right: all, bottom: all, left: all };
}

const MM_PER_INCH = 25.4;
const POINTS_PER_INCH = 72;

/** What `webContents.printToPDF` takes (inches, a 0.1 – 2 scale, a 1-based range string). */
export interface PdfOptions {
  readonly pageSize: PrintPageSize;
  readonly landscape: boolean;
  readonly margins: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
  readonly scale: number;
  readonly pageRanges?: string;
  readonly printBackground: true;
  readonly preferCSSPageSize: false;
}

/** What `webContents.print` takes (points for custom margins, a percentage scale, 0-based ranges). */
export interface PrintOptions {
  readonly silent: true;
  readonly deviceName: string;
  readonly pageSize: PrintPageSize;
  readonly landscape: boolean;
  readonly margins: { readonly marginType: 'custom'; readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
  readonly scaleFactor: number;
  readonly copies: number;
  readonly pageRanges?: readonly { readonly from: number; readonly to: number }[];
  readonly printBackground: true;
}

const scaleOf = (s: PrintSettings): number => (s.scale.fitWidth ? 100 : s.scale.percent);

export function toPdfOptions(s: PrintSettings): PdfOptions {
  const m = marginsMm(s);
  const ranges = s.pages.all ? null : parsePageRanges(s.pages.ranges);
  return {
    pageSize: s.pageSize,
    landscape: s.orientation === 'landscape',
    margins: { top: m.top / MM_PER_INCH, right: m.right / MM_PER_INCH, bottom: m.bottom / MM_PER_INCH, left: m.left / MM_PER_INCH },
    scale: scaleOf(s) / 100,
    ...(ranges !== null ? { pageRanges: ranges.map((r) => (r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`)).join(',') } : {}),
    printBackground: true,
    preferCSSPageSize: false,
  };
}

/** `null` when there is no printer to send to. */
export function toPrintOptions(s: PrintSettings): PrintOptions | null {
  if (s.printer === null) return null;
  const m = marginsMm(s);
  const pt = (mm: number): number => Math.round((mm / MM_PER_INCH) * POINTS_PER_INCH);
  const ranges = s.pages.all ? null : parsePageRanges(s.pages.ranges);
  return {
    silent: true,
    deviceName: s.printer,
    pageSize: s.pageSize,
    landscape: s.orientation === 'landscape',
    margins: { marginType: 'custom', top: pt(m.top), right: pt(m.right), bottom: pt(m.bottom), left: pt(m.left) },
    scaleFactor: scaleOf(s),
    copies: s.copies,
    ...(ranges !== null ? { pageRanges: ranges.map((r) => ({ from: r.from - 1, to: r.to - 1 })) } : {}),
    printBackground: true,
  };
}
