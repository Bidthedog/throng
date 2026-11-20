/**
 * The printable document for a panel that holds TEXT — an editor today, any later text panel tomorrow.
 *
 * A text panel prints its whole document, not what is on screen: monospace, every space and tab kept, a long line
 * wrapping at the page edge rather than being cut off. Where the document's language is known the caller passes
 * its Lezer syntax tree, and the text is highlighted with the EDITOR's own highlight style
 * (`editor/highlight-style.ts`), so the printed colours are the ten syntax roles an editor shows. Those roles
 * resolve to the fixed print palette (`PRINT_PALETTE`), written as the same `--throng-colour-<token>` properties
 * the theme sets: never the active theme, so a dark theme never prints a page of ink.
 *
 * Every piece of the file's text is escaped before it is written: file content never becomes markup. The document
 * runs no script and requests nothing (its CSP admits inline style only).
 *
 * A panel joins by handing {@link printTextDocument} its text, title and tree; the Print Preview window and main's
 * print controller are shared with previews and need nothing of their own.
 */
import { highlightCode } from '@lezer/highlight';
import { logCaught, printPaletteCss, type PrintJobRequest, type PrintableOutput } from '@throng/core';
import { LONG_LINE_THRESHOLD, throngHighlightStyle } from '../editor/highlight-style.js';

/** Lezer's syntax tree, named through the highlighter that reads it (`@lezer/common` is not a direct dependency). */
export type Tree = Parameters<typeof highlightCode>[1];

/**
 * The most characters highlighted in one printed document; a longer one prints plain. Printing is a one-off, so the
 * bound is far above the preview's per-render budget — it guards against a pasted multi-megabyte bundle stalling
 * the window before Print Preview opens, not against ordinary source files.
 */
export const PRINT_HIGHLIGHT_LIMIT = 2_000_000;

/** The font a printed document falls back to when the panel names none. */
const DEFAULT_FONT = "Consolas, 'Courier New', monospace";

export interface TextPrintableSource {
  /** The whole document, as the panel holds it now (unsaved edits included). */
  readonly text: string;
  /** What the job is titled — the file name. */
  readonly title: string;
  /** The document's syntax tree, when its language is known; absent or `null` prints plain text. */
  readonly tree?: Tree | null;
  /** The panel's font family (a CSS `font-family` value); monospace is always the last fallback. */
  readonly fontFamily?: string;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A font-family value safe inside a `<style>`: nothing that could close a rule or the element. */
function safeFontFamily(family: string | undefined): string {
  const cleaned = (family ?? '').replace(/[<>{};\\]/g, '').trim();
  return cleaned.length === 0 ? DEFAULT_FONT : `${cleaned}, monospace`;
}

/** The text as escaped markup: highlighted spans where `tree` says so, plain text elsewhere. */
function highlightedHtml(text: string, tree: Tree | null | undefined): string {
  if (tree === null || tree === undefined || text.length > PRINT_HIGHLIGHT_LIMIT) return escapeHtml(text);
  const out: string[] = [];
  const put = (piece: string, classes: string): void => {
    if (piece.length === 0) return;
    out.push(classes.length === 0 ? escapeHtml(piece) : `<span class="${escapeHtml(classes)}">${escapeHtml(piece)}</span>`);
  };
  /*
   * One `highlightCode` pass per run of ordinary lines; a line over the editor's long-line threshold prints plain,
   * as the editor shows it (016 FR-008a) — the preview's fenced-code highlighter does the same.
   */
  let rangeStart = -1;
  const flush = (end: number): void => {
    if (rangeStart < 0) return;
    highlightCode(text, tree, throngHighlightStyle, put, () => out.push('\n'), rangeStart, end);
    rangeStart = -1;
  };
  let offset = 0;
  for (const line of text.split('\n')) {
    const lineEnd = offset + line.length;
    if (line.length > LONG_LINE_THRESHOLD) {
      flush(offset);
      put(line, '');
      if (lineEnd < text.length) out.push('\n');
    } else if (rangeStart < 0) {
      rangeStart = offset;
    }
    offset = lineEnd + 1;
  }
  flush(text.length);
  return out.join('');
}

/** Lays the text out for paper. Every colour is the palette's, through the theme's custom properties. */
function textStylesheet(fontFamily: string): string {
  return `
:root { color-scheme: light; }
html, body {
  margin: 0;
  padding: 0;
  height: auto;
  overflow: visible;
  background: var(--throng-colour-editorBg);
  color: var(--throng-colour-editorFg);
}
.throng-print-text__code {
  margin: 0;
  font-family: ${fontFamily};
  font-size: 9.5pt;
  line-height: 1.4;
  tab-size: 4;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow: visible;
}
`;
}

/** The printable document for `source`, as a text panel hands it to `throng.print.open`. */
export function buildTextPrintable(source: TextPrintableSource): PrintableOutput {
  const highlightRules = throngHighlightStyle.module?.getRules() ?? '';
  const html = [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    `<title>${escapeHtml(source.title)}</title>`,
    `<style>${printPaletteCss()}</style>`,
    `<style>${highlightRules}</style>`,
    `<style>${textStylesheet(safeFontFamily(source.fontFamily))}</style>`,
    '</head><body class="throng-print throng-print-text">',
    `<pre class="throng-print-text__code">${highlightedHtml(source.text, source.tree)}</pre>`,
    '</body></html>',
  ].join('');
  return { kind: 'document', html, fit: 'width', remoteImages: [] };
}

/** The bridge call that opens Print Preview; `window.throng.print.open` in the app. */
export type PrintOpen = (request: PrintJobRequest) => Promise<{ opened: boolean }>;

/**
 * Open Print Preview for a text document. It never prints: only Print Preview's own Print button sends a job.
 * Resolves `false` when there is no bridge or the request failed, `true` when main was asked.
 */
export async function printTextDocument(source: TextPrintableSource, open: PrintOpen | undefined = window.throng?.print?.open): Promise<boolean> {
  if (open === undefined) return false;
  try {
    await open({ title: source.title, output: buildTextPrintable(source) });
    return true;
  } catch (error) {
    logCaught('print: open Print Preview for a text document', error);
    return false;
  }
}
