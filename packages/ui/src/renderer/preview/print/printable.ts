/**
 * The printable document a preview hands to Print Preview (075, FR-060, FR-066, FR-072 – FR-079, research R9,
 * contracts/print.md).
 *
 * It is a cleaned CLONE of what the body shows now, never the live DOM: the reader's preview is untouched by
 * printing. Every collapsed section and callout is opened (FR-074, Q2 = A). Everything throng drew around the
 * document is removed — fold toggles, callout fold controls, diagram toolbars, link hints, table resize handles,
 * notices — except a failed diagram's own notice, which says why that diagram is not there. Links lose their
 * roles and tab stops (FR-077). A drawn diagram becomes its SVG, sized to the text column, or to the page for a
 * standalone diagram (FR-075). A remote image prints only when the preview had loaded it (FR-079); its URL is
 * listed so the print host may request exactly those, and nothing else.
 *
 * The document carries the preview's own stylesheets, then the fixed print palette (FR-072, Q1 = B) as the same
 * custom properties the theme sets, then `print-stylesheet.ts`. Its CSP admits no script and no network other
 * than the listed images.
 */
import { PRINT_PALETTE, logExpected, type PrintableOutput } from '@throng/core';
import { PRINT_STYLESHEET } from './print-stylesheet.js';
import { DIAGRAM_HOST_CLASS } from '../diagram/diagram-host.js';

/** What throng drew that never prints. */
const FURNITURE = [
  '.preview-fold-toggle',
  '.preview-callout__fold',
  '.preview-table-resize-handle',
  '.preview-diagram-frame__toolbar',
  '.preview-diagram__loading',
  '.preview-link-hint',
  '[data-print-omit]',
].join(', ');

/** Attributes that make a printed element interactive, or hide it. */
const INTERACTIVE_ATTRIBUTES = ['tabindex', 'role', 'aria-expanded', 'aria-controls', 'contenteditable', 'draggable'];

export interface PrintableOptions {
  readonly title: string;
  readonly fit: 'width' | 'page';
  /** The document's stylesheet text; defaults to every readable sheet the window holds. */
  readonly stylesheets?: string;
  /** The base URL relative assets (KaTeX's fonts) resolve against; defaults to the window's. */
  readonly baseHref?: string;
}

/** The window's readable stylesheets as one text, skipping any it cannot read. */
export function collectStylesheets(doc: Document = document): string {
  const out: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      out.push(Array.from(sheet.cssRules, (r) => r.cssText).join('\n'));
    } catch (error) {
      logExpected('print: read a stylesheet', 'a sheet from another origin cannot be read; the preview ships none, so nothing is lost', error);
    }
  }
  return out.join('\n');
}

function isLoadedRemote(img: HTMLImageElement): boolean {
  const src = img.getAttribute('src') ?? '';
  return src.startsWith('https:') && img.complete && img.naturalWidth > 0;
}

/** Replace each drawn diagram with its SVG, sized for the page; a failed one keeps only its notice. */
function flattenDiagrams(live: HTMLElement, clone: HTMLElement, fit: 'width' | 'page'): void {
  const liveHosts = [...live.querySelectorAll<HTMLElement>(`.${DIAGRAM_HOST_CLASS}`)];
  const cloneHosts = [...clone.querySelectorAll<HTMLElement>(`.${DIAGRAM_HOST_CLASS}`)];
  cloneHosts.forEach((host, i) => {
    const svg = liveHosts[i]?.querySelector<SVGSVGElement>('.preview-diagram-frame__layer > svg') ?? null;
    if (svg === null) {
      const notice = host.querySelector('.preview-diagram__notice');
      host.replaceChildren(...(notice !== null ? [notice] : []));
      host.classList.add('throng-print__diagram');
      return;
    }
    const figure = host.ownerDocument.createElement('div');
    figure.className = `throng-print__diagram throng-print__diagram--${fit}`;
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.removeAttribute('style');
    copy.removeAttribute('width');
    copy.removeAttribute('height');
    copy.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    figure.append(copy);
    host.replaceWith(figure);
  });
}

/** Open everything a fold hid (FR-074). */
function expandAll(root: HTMLElement): void {
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    if (el.hidden) el.hidden = false;
    el.removeAttribute('data-callout-collapsed');
  }
}

/** A cleaned clone of `body`, ready to serialise; exported for the component test. */
export function printableClone(body: HTMLElement, fit: 'width' | 'page'): { root: HTMLElement; remoteImages: string[] } {
  const root = body.cloneNode(true) as HTMLElement;
  flattenDiagrams(body, root, fit);
  for (const el of root.querySelectorAll(FURNITURE)) el.remove();
  for (const notice of root.querySelectorAll('[role="status"], [role="alert"]')) {
    if (!notice.classList.contains('preview-diagram__notice')) notice.remove();
  }
  expandAll(root);
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const name of INTERACTIVE_ATTRIBUTES) el.removeAttribute(name);
    if (el instanceof HTMLElement) el.style.removeProperty('transform');
  }
  const liveImages = [...body.querySelectorAll<HTMLImageElement>('img')];
  const remoteImages: string[] = [];
  [...root.querySelectorAll<HTMLImageElement>('img')].forEach((img, i) => {
    const live = liveImages[i];
    const src = img.getAttribute('src') ?? '';
    if (!src.startsWith('https:')) return;
    if (live !== undefined && isLoadedRemote(live)) {
      remoteImages.push(src);
      return;
    }
    // FR-079 — a remote image the preview did not show prints as its alternative text, never as a request.
    img.replaceWith(img.ownerDocument.createTextNode(img.getAttribute('alt') ?? ''));
  });
  return { root, remoteImages: [...new Set(remoteImages)] };
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The print palette as `:root` custom properties (FR-072). */
function paletteCss(): string {
  const declarations = Object.entries(PRINT_PALETTE).map(([token, value]) => `--throng-colour-${token}:${value};`);
  return `:root{${declarations.join('')}}`;
}

/** A content-security policy that runs nothing and requests only the listed images (FR-079). */
function contentSecurityPolicy(remoteImages: readonly string[]): string {
  const images = ['throng-preview:', 'data:', ...remoteImages.map((u) => u.replace(/[;\s]/g, ''))].join(' ');
  return `default-src 'none'; img-src ${images}; style-src 'unsafe-inline'; font-src file: throng-asset: data:`;
}

/** The printable output of `body`, as Markdown and Mermaid hand it to `throng.print.open`. */
export function buildPrintable(body: HTMLElement, options: PrintableOptions): PrintableOutput {
  const { root, remoteImages } = printableClone(body, options.fit);
  const stylesheets = options.stylesheets ?? collectStylesheets(body.ownerDocument);
  const base = options.baseHref ?? body.ownerDocument.baseURI;
  const html = [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(contentSecurityPolicy(remoteImages))}">`,
    `<base href="${escapeHtml(base)}">`,
    `<title>${escapeHtml(options.title)}</title>`,
    `<style>${stylesheets}</style>`,
    `<style>${paletteCss()}</style>`,
    `<style>${PRINT_STYLESHEET}</style>`,
    `</head><body class="throng-print throng-print--fit-${options.fit}">`,
    root.outerHTML,
    '</body></html>',
  ].join('');
  return { kind: 'document', html, fit: options.fit, remoteImages };
}
