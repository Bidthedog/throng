/**
 * Printing a preview (075, FR-060 – FR-081, data-model.md "Print settings", research R10).
 *
 * Pure: the shape of what a provider hands over to print, the settings Print Preview offers, their defaults and
 * the tolerant parse that brings a stored file back, and the two mappings to what Electron's PDF render and its
 * print call take. The PDF that Print Preview shows and the job sent to the printer are built from one settings
 * object through these mappings, so the pages shown are the pages printed (FR-068).
 */

import { withUnit } from '../config/numeric-units.js';
import { escapeHtml } from '../text/escape-html.js';

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
      /** FR-068g — the document's own page size, as laid out (a PDF's first page): Print Preview starts on that paper. */
      readonly paper?: { readonly widthMm: number; readonly heightMm: number };
    }
  | { readonly kind: 'pages'; readonly pdf: Uint8Array };

/** What a preview window asks main for, through `throng.print.open`. */
export interface PrintJobRequest {
  readonly title: string;
  readonly output: PrintableOutput;
  /** FR-082 — the printed file's absolute path, where it has one: Save as PDF starts beside it. */
  readonly filePath?: string;
}

/** FR-082 — Save as PDF's answer: saved at `path`, failed with a cause naming the file, or cancelled in the dialog. */
export type PrintSaveResult = { readonly ok: true; readonly path: string } | { readonly ok: false; readonly cause: string } | { readonly cancelled: true };

/**
 * 075 FR-082 — where Save as PDF's dialog starts: the printed file's name with `.pdf`, in its folder. A file that is a
 * PDF already gets ` (printed)`, so the default never names the source. With no path, the title, and no folder.
 */
export function defaultPdfSave(filePath: string | undefined, title: string): { dir?: string; name: string } {
  const cut = filePath === undefined ? -1 : Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  const base = filePath === undefined ? title : filePath.slice(cut + 1);
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : '';
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const name = ext === '.pdf' ? `${stem} (printed).pdf` : `${stem}.pdf`;
  return filePath === undefined || cut < 0 ? { name } : { dir: filePath.slice(0, cut), name };
}

/** What the Print Preview window reads about its job (`throng.print.job`). */
export interface PrintJobView {
  readonly title: string;
  readonly settings: PrintSettings;
  readonly printers: readonly PrinterChoice[];
  readonly fit: 'width' | 'page';
}

/** The answer to `throng.print.render`, a layout's answer: how many pages print, and the PDF Print Preview draws them from (075 FR-068a). */
export type PrintRenderResult =
  | { readonly pageCount: number; readonly pdf: Uint8Array }
  | { readonly error: string }
  /** Every page the range names lies past the last: the document has `pageCount` pages (known gap 1, 2026-11-20). */
  | { readonly outOfRange: true; readonly pageCount: number };

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

/** FR-068g — a listed size, or `Custom`: a document's own page size that none of them is. */
export type PrintPaperSize = PrintPageSize | 'Custom';

/** A paper's size in millimetres, portrait (width ≤ height). */
export interface PaperMm {
  readonly width: number;
  readonly height: number;
}

const turned = ({ width, height }: PaperMm, orientation: PrintOrientation): { width: number; height: number } =>
  orientation === 'landscape' ? { width: height, height: width } : { width, height };

/** 075 FR-068b — `size` in millimetres, turned for `orientation` (width × height). */
export function paperSizeMm(size: PrintPageSize, orientation: PrintOrientation): { width: number; height: number } {
  return turned(PAGE_SIZE_MM[size], orientation);
}

/** The paper `s` prints on, in millimetres, turned for its orientation (FR-068b, FR-068g). */
export function paperOf(s: Pick<PrintSettings, 'pageSize' | 'orientation' | 'customPaper'>): { width: number; height: number } {
  if (s.pageSize === 'Custom') return turned(s.customPaper ?? PAGE_SIZE_MM.A4, s.orientation);
  return paperSizeMm(s.pageSize, s.orientation);
}

const roundMm = (n: number): number => Math.round(n * 10) / 10;

/** 075 FR-068b (2026-11-20) — a paper size's option label: its name, and its size in mm for `orientation`. */
export function paperSizeLabel(size: PrintPaperSize, orientation: PrintOrientation, custom?: PaperMm): string {
  const { width, height } = size === 'Custom' ? turned(custom ?? PAGE_SIZE_MM.A4, orientation) : paperSizeMm(size, orientation);
  return `${size} (${roundMm(width)} × ${roundMm(height)} mm)`;
}

/** How near a page must be to a listed size to be it: a PDF's points round a millimetre or so. */
const PAPER_MATCH_MM = 1;

/**
 * 075 FR-068g (the maintainer, 2026-11-21: "A PDF's own page size should choose the print paper size.") — the paper a
 * page `widthMm` × `heightMm` is: the listed size it is within a millimetre of, turned the way the page is, or a
 * custom paper of exactly its size.
 */
export function paperForPage(
  widthMm: number,
  heightMm: number,
): { pageSize: PrintPaperSize; orientation: PrintOrientation; customPaper?: PaperMm } {
  const orientation: PrintOrientation = widthMm > heightMm ? 'landscape' : 'portrait';
  const portrait = { width: Math.min(widthMm, heightMm), height: Math.max(widthMm, heightMm) };
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= PAPER_MATCH_MM;
  const listed = PRINT_PAGE_SIZES.find((size) => near(PAGE_SIZE_MM[size].width, portrait.width) && near(PAGE_SIZE_MM[size].height, portrait.height));
  if (listed !== undefined) return { pageSize: listed, orientation };
  return { pageSize: 'Custom', orientation, customPaper: { width: roundMm(portrait.width), height: roundMm(portrait.height) } };
}
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

/**
 * 075 FR-080 — the largest print document main accepts, in characters. A PDF prints as a document of its pages drawn
 * as images (FR-075c), so its drawn pages count toward it.
 */
export const PRINT_DOCUMENT_MAX_LENGTH = 64 * 1024 * 1024;
export const SCALE_MIN = 10;
export const SCALE_MAX = 200;
export const COPIES_MAX = 99;

/** 077 FR-020 — one of the print dialog's number fields: its hard bounds, the step its arrow keys move by, its unit. */
export interface PrintFieldBounds {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Whole numbers only. */
  readonly integer: boolean;
  /** `%` is written against the number; any other unit after a space (`copies` reads `copy` for 1). */
  readonly unit: string;
}

/** 077 FR-020 — the print dialog's number fields. */
export const PRINT_FIELDS = {
  margin: { min: 0, max: MARGIN_MAX_MM, step: 1, integer: false, unit: 'mm' },
  scale: { min: SCALE_MIN, max: SCALE_MAX, step: 5, integer: true, unit: '%' },
  copies: { min: 1, max: COPIES_MAX, step: 1, integer: true, unit: 'copies' },
} as const satisfies Record<string, PrintFieldBounds>;

/** What is wrong with a print field's text: a bound (with the value to clamp to), or that it is no number. */
export type PrintFieldCheck = { readonly ok: true; readonly value: number } | { readonly ok: false; readonly message: string; readonly clampTo?: number };

/**
 * 077 FR-020 — the print dialog's check, worded as Preferences words it (FR-008): past a bound names that bound and
 * offers it to clamp to on confirm (FR-009); text that is no number says so and offers nothing.
 */
export function checkPrintField(text: string, f: PrintFieldBounds): PrintFieldCheck {
  const t = text.trim();
  if (!(f.integer ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/).test(t)) return { ok: false, message: f.integer ? 'Not a whole number' : 'Not a number' };
  const n = Number(t);
  if (n > f.max) return { ok: false, message: `Up to ${withUnit(f.max, f.unit)}`, clampTo: f.max };
  if (n < f.min) return { ok: false, message: `At least ${withUnit(f.min, f.unit)}`, clampTo: f.min };
  return { ok: true, value: n };
}

/**
 * How a page-shaped printable — a picture, an SVG, a diagram on its own, a PDF's pages — meets its sheet (maintainer,
 * 2026-11-22: a "Fit" drop-down replacing "Fit to page"). A flowing document has Fit to page width or Scale instead
 * (`scale.fitWidth`).
 */
export const PRINT_PAGE_FITS = [
  { id: 'fit', label: 'Fit to page' },
  { id: 'stretch', label: 'Stretch to fit (keep proportions)' },
  { id: 'fill', label: 'Stretch to fill (distorts)' },
  { id: 'crop', label: 'Fill page (crop)' },
  { id: 'actual', label: 'Actual size' },
  { id: 'scale', label: 'Scale' },
] as const;
export type PrintPageFit = (typeof PRINT_PAGE_FITS)[number]['id'];
const isPageFit = (v: unknown): v is PrintPageFit => PRINT_PAGE_FITS.some((f) => f.id === v);

/** Where a header's or a footer's text sits across the page (maintainer, 2026-11-22). */
export const PRINT_BAND_ALIGNS = ['left', 'center', 'right'] as const;
export type PrintBandAlign = (typeof PRINT_BAND_ALIGNS)[number];

/** The placeholders a header's or a footer's text may hold (maintainer, 2026-11-22); any other `{…}` prints as typed. */
export const PRINT_BAND_PLACEHOLDERS = ['fileName', 'fileExt', 'path', 'page', 'totalPages', 'timeStamp'] as const;

/** The longest header or footer text kept. */
export const PRINT_BAND_TEXT_MAX = 500;

/** A header or a footer: whether it prints, its text with placeholders, and where it sits (maintainer, 2026-11-22). */
export interface PrintBand {
  readonly enabled: boolean;
  readonly text: string;
  readonly align: PrintBandAlign;
}

/** Everything Print Preview offers (FR-068). `pages` never persists (FR-070). */
export interface PrintSettings {
  /** The printer's name; `null` when no printer is available. */
  readonly printer: string | null;
  readonly pageSize: PrintPaperSize;
  /** FR-068g — the size `Custom` stands for, portrait; only a document's own page size sets it, and it never persists. */
  readonly customPaper?: PaperMm;
  readonly orientation: PrintOrientation;
  readonly margins: { readonly preset: PrintMarginPreset; readonly custom: PrintMargins };
  /**
   * `fitWidth`: a flowing document fits the page width, else takes `percent`. `pageFit`: how a page-shaped printable
   * meets its sheet, `scale` taking `percent` (maintainer, 2026-11-22). Kept apart, as Centre is.
   */
  readonly scale: { readonly fitWidth: boolean; readonly pageFit: PrintPageFit; readonly percent: number };
  readonly copies: number;
  /**
   * 075 FR-068f (the maintainer, 2026-11-20: "Add an option to 'center' print previews") — centre the content on the
   * printable area, kept apart for the two kinds of printable: `page` (a picture or a PDF's pages, one per sheet:
   * centred both ways) and `width` (a flowing document: anything narrower than the text column centred across it).
   */
  readonly centre: { readonly page: boolean; readonly width: boolean };
  /** Each page's header and footer (maintainer, 2026-11-22). */
  readonly header: PrintBand;
  readonly footer: PrintBand;
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
  scale: Object.freeze({ fitWidth: true, pageFit: 'fit', percent: 100 }),
  copies: 1,
  // A picture sits in the middle of its sheet; a document starts where a document starts.
  centre: Object.freeze({ page: true, width: false }),
  // Off until asked for: a print carries nothing the document does not, unless the reader adds it.
  // Maintainer, 2026-11-22: "Header: {filePath} center aligned. Footer: Page {page} of {totalPages} right aligned".
  header: Object.freeze({ enabled: false, text: '{path}', align: 'center' }),
  footer: Object.freeze({ enabled: false, text: 'Page {page} of {totalPages}', align: 'right' }),
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

function parseBand(raw: unknown, fallback: PrintBand): PrintBand {
  if (!isObject(raw)) return fallback;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : fallback.enabled,
    text: typeof raw.text === 'string' && raw.text.length <= PRINT_BAND_TEXT_MAX ? raw.text : fallback.text,
    align: PRINT_BAND_ALIGNS.find((a) => a === raw.align) ?? fallback.align,
  };
}

/** A settings file from before the header and footer: its `fileLabel` choice, as the band it now is. */
function legacyBand(fileLabel: unknown, where: 'header' | 'footer'): PrintBand | undefined {
  const m = typeof fileLabel === 'string' ? /^(name|path)-(header|footer)$/.exec(fileLabel) : null;
  if (m === null || m[2] !== where) return undefined;
  return { enabled: true, text: m[1] === 'name' ? '{fileName}{fileExt}' : '{path}', align: 'center' };
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
      // A file from before the Fit choice: a scale it applied applies to pictures too, as it did then.
      pageFit: isPageFit(scale.pageFit) ? scale.pageFit : scale.fitWidth === false ? 'scale' : d.scale.pageFit,
      percent: inRange(scale.percent, SCALE_MIN, SCALE_MAX) ? Math.round(scale.percent as number) : d.scale.percent,
    },
    copies: Number.isInteger(o.copies) && inRange(o.copies, 1, COPIES_MAX) ? (o.copies as number) : d.copies,
    centre: {
      page: isObject(o.centre) && typeof o.centre.page === 'boolean' ? o.centre.page : d.centre.page,
      width: isObject(o.centre) && typeof o.centre.width === 'boolean' ? o.centre.width : d.centre.width,
    },
    header: parseBand(o.header, legacyBand(o.fileLabel, 'header') ?? d.header),
    footer: parseBand(o.footer, legacyBand(o.fileLabel, 'footer') ?? d.footer),
    pages: { all: true },
  };
}

const paperMm = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 10 && v <= 2000;

/**
 * The settings Print Preview sends to be laid out or printed: the stored fields as {@link parsePrintSettings} checks
 * them, plus what only a live window carries — the page range, and a custom paper (FR-068g) with its size, which a
 * stored file never holds. A Custom paper with no valid size takes the default paper.
 */
export function parseRenderSettings(raw: unknown, printers: readonly PrinterInfoLike[]): PrintSettings {
  const parsed = parsePrintSettings(raw, printers);
  const o = isObject(raw) ? raw : {};
  const pages: PrintSettings['pages'] =
    isObject(o.pages) && o.pages.all === false && typeof o.pages.ranges === 'string' ? { all: false, ranges: o.pages.ranges.slice(0, 200) } : { all: true };
  const c = isObject(o.customPaper) ? o.customPaper : null;
  if (o.pageSize === 'Custom' && c !== null && paperMm(c.width) && paperMm(c.height)) {
    return { ...parsed, pageSize: 'Custom', customPaper: { width: c.width, height: c.height }, pages };
  }
  return { ...parsed, pages };
}

/** The file `print-settings.json` holds: every field but the page range (FR-070). */
export function serialisePrintSettings(s: PrintSettings): { version: 1; settings: Omit<PrintSettings, 'pages'> } {
  const { pages: _pages, ...kept } = s;
  return { version: 1, settings: kept };
}

/**
 * A page-range string — `1-3, 5` — as sorted, merged 1-based ranges, or `null` when it is malformed or names no
 * page. A range past the last page is clipped by the caller, which knows the page count ({@link clipPageRanges}).
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

/**
 * Known gap 1 (2026-11-20) — `ranges` kept to a document of `pageCount` pages: a range running past the last page
 * ends there, and one starting past it is dropped. Empty when every page named is past the last.
 */
export function clipPageRanges(ranges: readonly { from: number; to: number }[], pageCount: number): { from: number; to: number }[] {
  return ranges.filter((r) => r.from <= pageCount).map((r) => ({ from: r.from, to: Math.min(r.to, pageCount) }));
}

/** Ranges as the range string Chromium takes: `1-3,5`. */
export function formatPageRanges(ranges: readonly { from: number; to: number }[]): string {
  return ranges.map((r) => (r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`)).join(',');
}

/** The margins in effect, in millimetres. */
export function marginsMm(s: PrintSettings): PrintMargins {
  if (s.margins.preset === 'custom') return s.margins.custom;
  const all = MARGIN_PRESETS_MM[s.margins.preset];
  return { top: all, right: all, bottom: all, left: all };
}

const MM_PER_INCH = 25.4;

/** What `webContents.printToPDF` takes (inches, a 0.1 – 2 scale, a 1-based range string). */
export interface PdfOptions {
  /** A listed size by name, or a custom paper in inches, portrait (FR-068g). */
  readonly pageSize: PrintPageSize | { readonly width: number; readonly height: number };
  readonly landscape: boolean;
  readonly margins: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
  readonly scale: number;
  readonly pageRanges?: string;
  readonly printBackground: true;
  readonly preferCSSPageSize: false;
  /** 075 FR-068f — lay the content out centred ({@link PRINT_CENTRE_CSS}). */
  readonly centre: boolean;
  /** A page-shaped printable's Fit choice, as the stylesheet the host lays it out under ({@link printPageFitCss}). */
  readonly pageFitCss?: string;
  /** A scale applies (Fit off): diagrams are laid out at their own size ({@link PRINT_NATURAL_DIAGRAM_CSS}). */
  readonly naturalDiagrams: boolean;
  /** The page's header and footer ({@link PrintBand}); absent when neither prints. */
  readonly displayHeaderFooter?: true;
  readonly headerTemplate?: string;
  readonly footerTemplate?: string;
}

/**
 * What `webContents.print` takes to print a {@link PrintSheet}: the sheet is already the pages, laid out once by
 * `printToPDF` and drawn by Print Preview, so the printer adds no margin, scale or page range of its own.
 */
export interface PrintOptions {
  readonly silent: true;
  readonly deviceName: string;
  /** A listed size by name, or a custom paper in microns, portrait (FR-068g). */
  readonly pageSize: PrintPageSize | { readonly width: number; readonly height: number };
  readonly landscape: boolean;
  readonly margins: { readonly marginType: 'none' };
  readonly scaleFactor: 100;
  readonly copies: number;
  readonly pageRanges?: never;
  readonly printBackground: true;
}

/**
 * The pages a print sends (075, 2026-11-20): each page Print Preview shows, drawn as an image of the whole sheet of
 * paper, margins included. Printing these rather than laying the document out again for the printer is what makes
 * the paper match the preview — the range, the margins, the scale and every page break (FR-068).
 */
export interface PrintSheet {
  /** The paper's size, the same for every page. */
  readonly widthMm: number;
  readonly heightMm: number;
  /** One `data:image/png` URL per page, in order. */
  readonly pages: readonly string[];
}

/** The HTML document that prints a sheet: one image per sheet of paper, nothing else on it. */
export function printSheetHtml(sheet: PrintSheet): string {
  const w = `${sheet.widthMm}mm`;
  const h = `${sheet.heightMm}mm`;
  const pages = sheet.pages.map((src) => `<img src="${src}" alt="">`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${w} ${h};margin:0}html,body{margin:0;padding:0;background:#fff}img{display:block;width:${w};height:${h};break-after:page}img:last-child{break-after:auto}</style></head><body>${pages}</body></html>`;
}

/** A custom paper, portrait, in the unit `perMm` converts millimetres to. */
const customSize = (s: PrintSettings, perMm: number): { width: number; height: number } => {
  const paper = s.customPaper ?? PAGE_SIZE_MM.A4;
  return { width: paper.width * perMm, height: paper.height * perMm };
};

/** `printToPDF`'s scale, in percent: a flowing document's chosen scale; a page-shaped printable is never scaled whole (`pageFitCss`). */
const scaleOf = (s: PrintSettings, fit: 'width' | 'page'): number => (fit === 'width' && !s.scale.fitWidth ? s.scale.percent : 100);

/** The file a job prints: its name, extension and path fill a header's or a footer's placeholders. */
function fileParts(file: PrintedFile | undefined): { fileName: string; fileExt: string; path: string } {
  const path = file?.path ?? file?.title ?? '';
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? { fileName: base.slice(0, dot), fileExt: base.slice(dot), path } : { fileName: base, fileExt: '', path };
}

const PLACEHOLDER = /(\{(?:fileName|fileExt|path|page|totalPages|timeStamp)\})/;

/**
 * `{timeStamp}` (maintainer, 2026-11-22: "the current date in the user's current locale (short - `01/12/26 @ 13:01`)"):
 * `at`'s date with a two-digit day, month and year, and its time to the minute, each in `locale`'s own order and
 * separators (the runtime's when omitted), joined by " @ ".
 */
export function formatPrintTimeStamp(at: Date, locale?: string): string {
  const date = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: '2-digit' }).format(at);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(at);
  return `${date} @ ${time}`;
}

/**
 * A header's or a footer's text as `printToPDF` draws it: every character escaped, the file's placeholders filled in,
 * and `{page}` / `{totalPages}` as the elements Chromium fills with each page's number and the page count.
 */
export function printBandHtml(text: string, file: PrintedFile | undefined): string {
  const parts = fileParts(file);
  return text
    .split(PLACEHOLDER)
    .map((part) => {
      switch (part) {
        case '{page}':
          return '<span class="pageNumber"></span>';
        case '{totalPages}':
          return '<span class="totalPages"></span>';
        case '{fileName}':
          return escapeHtml(parts.fileName);
        case '{fileExt}':
          return escapeHtml(parts.fileExt);
        case '{path}':
          return escapeHtml(parts.path);
        case '{timeStamp}':
          return escapeHtml(file?.timeStamp ?? '');
        default:
          return escapeHtml(part);
      }
    })
    .join('');
}

/** The least room either side of a header or a footer, so a page with no side margin keeps its text off the edge. */
const BAND_MIN_INSET_MM = 5;

/**
 * `printToPDF`'s header and footer (maintainer, 2026-11-22): each one's text, small, where its alignment says across
 * the page, inset by the page's side margins; a band that does not print is an empty template, or Chromium draws its
 * own date and title there. Drawn in the top and bottom margins, so a page with none has no room for them.
 */
function bandTemplates(s: PrintSettings, file: PrintedFile | undefined): Pick<PdfOptions, 'displayHeaderFooter' | 'headerTemplate' | 'footerTemplate'> {
  if (!s.header.enabled && !s.footer.enabled) return {};
  const m = marginsMm(s);
  const left = Math.max(m.left, BAND_MIN_INSET_MM);
  const right = Math.max(m.right, BAND_MIN_INSET_MM);
  const band = (b: PrintBand): string =>
    b.enabled
      ? `<div style="box-sizing:border-box;width:100%;padding:0 ${right}mm 0 ${left}mm;font-family:sans-serif;font-size:8pt;color:#444;` +
        `text-align:${b.align};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${printBandHtml(b.text, file)}</div>`
      : '<span></span>';
  return { displayHeaderFooter: true, headerTemplate: band(s.header), footerTemplate: band(s.footer) };
}

/** The file a job prints, for its name or path on the page. */
export interface PrintedFile {
  readonly path?: string;
  readonly title: string;
  /** `{timeStamp}`: when the pages were drawn, as `formatPrintTimeStamp` writes it. */
  readonly timeStamp?: string;
}

/**
 * `printToPDF`'s options for `s`; with `pageCount`, its page range is clipped to that many pages first. `fit` is the
 * job's kind, which picks the Centre setting that applies (FR-068f). `file` fills the header's and footer's placeholders.
 */
export function toPdfOptions(s: PrintSettings, pageCount?: number, fit: 'width' | 'page' = 'width', file?: PrintedFile): PdfOptions {
  const m = marginsMm(s);
  const parsed = s.pages.all ? null : parsePageRanges(s.pages.ranges);
  const ranges = parsed !== null && pageCount !== undefined ? clipPageRanges(parsed, pageCount) : parsed;
  return {
    pageSize: s.pageSize === 'Custom' ? customSize(s, 1 / MM_PER_INCH) : s.pageSize,
    landscape: s.orientation === 'landscape',
    margins: { top: m.top / MM_PER_INCH, right: m.right / MM_PER_INCH, bottom: m.bottom / MM_PER_INCH, left: m.left / MM_PER_INCH },
    scale: scaleOf(s, fit) / 100,
    ...(ranges !== null ? { pageRanges: formatPageRanges(ranges) } : {}),
    printBackground: true,
    preferCSSPageSize: false,
    centre: s.centre[fit],
    naturalDiagrams: fit === 'width' && !s.scale.fitWidth,
    ...(fit === 'page' ? { pageFitCss: printPageFitCss(s.scale.pageFit, s.scale.percent) } : {}),
    ...bandTemplates(s, file),
  };
}

/**
 * 075 FR-068f — what Centre adds to a printable while it is laid out. A picture, a diagram and each of a PDF's pages
 * sit in the middle of their sheet, both ways; in a flowing document, anything narrower than the text column — an
 * image, a diagram, a table — sits in the middle of it. Text is never centred: it is not narrower than its column.
 */
export const PRINT_CENTRE_CSS = [
  '.throng-print--fit-page .throng-print__diagram{display:flex;align-items:center;justify-content:center;min-height:95vh}',
  '.throng-print__pdf-page{align-items:center;justify-content:center}',
  '.throng-print--fit-width img,.throng-print--fit-width .throng-print__diagram svg,.throng-print--grid table{margin-left:auto;margin-right:auto}',
].join('');

/**
 * Scale reaches a diagram (maintainer, 2026-11-22). A diagram drawn at its column's full width fills that column at
 * any scale, since `printToPDF`'s scale widens the column as it shrinks it. While a scale applies, each diagram is
 * laid out at its own width instead (the printable sets `--throng-print-natural-width` on it), never wider than its
 * column, so the scale shrinks or grows it with everything else.
 */
export const PRINT_NATURAL_DIAGRAM_CSS = '.throng-print__diagram svg{width:var(--throng-print-natural-width,100%);max-width:100%}';

/**
 * A page-shaped printable's Fit choice as a stylesheet (maintainer, 2026-11-22). Its two kinds of drawing: a picture or
 * diagram on its own (an `svg` in `.throng-print__diagram--page`, held to 95vh) and a PDF page (an `img` in
 * `.throng-print__pdf-page`, 99vh). The printable gives each its own width (`--throng-print-natural-width`) and shape
 * (`--throng-print-ratio`, width over height); a picture whose shape is known draws with `preserveAspectRatio="none"`,
 * so the box set here is the shape drawn, and only Stretch to fill sets a box of another shape.
 */
export function printPageFitCss(fit: PrintPageFit, percent: number): string {
  const kinds = [
    { box: '.throng-print--fit-page .throng-print__diagram--page', el: '.throng-print--fit-page .throng-print__diagram--page>svg', h: '95vh' },
    // `html body` outranks the PDF document's own page rules, which an inserted stylesheet otherwise loses a tie to.
    { box: 'html body .throng-print__pdf-page', el: 'html body .throng-print__pdf-page img', h: '99vh' },
  ];
  const N = 'var(--throng-print-natural-width)';
  const R = 'var(--throng-print-ratio,1)';
  const shaped = 'height:auto;aspect-ratio:var(--throng-print-ratio,auto);max-width:none;max-height:none;flex:none';
  return kinds
    .map(({ box, el, h }) => {
      switch (fit) {
        case 'fit':
          // A picture never past its own width (FR-075a, `--throng-print-cap`); a diagram or a PDF page fills the page.
          return `${el}{width:min(var(--throng-print-cap,100%),100%,calc(${h} * ${R}));${shaped}}`;
        case 'stretch':
          return `${el}{width:min(100%,calc(${h} * ${R}));${shaped}}`;
        case 'fill':
          return `${el}{width:100%;height:${h};aspect-ratio:auto;max-width:none;max-height:none;flex:none}`;
        case 'crop':
          return `${box}{height:${h};overflow:hidden;display:flex;align-items:center;justify-content:center}${el}{width:max(100%,calc(${h} * ${R}));${shaped}}`;
        case 'actual':
          return `${box}{height:${h};overflow:hidden}${el}{width:${N};${shaped}}`;
        case 'scale':
          return `${box}{height:${h};overflow:hidden}${el}{width:calc(${N} * ${percent / 100});${shaped}}`;
      }
    })
    .join('');
}

/** How a {@link PrintSheet} goes to the printer; `null` when there is no printer to send to. */
export function toPrintOptions(s: PrintSettings): PrintOptions | null {
  if (s.printer === null) return null;
  return {
    silent: true,
    deviceName: s.printer,
    pageSize: s.pageSize === 'Custom' ? customSize(s, 1000) : s.pageSize,
    landscape: s.orientation === 'landscape',
    margins: { marginType: 'none' },
    scaleFactor: 100,
    copies: s.copies,
    printBackground: true,
  };
}
