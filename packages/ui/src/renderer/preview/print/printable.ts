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
import { DIAGRAM_HOST_CLASS, DIAGRAM_SOURCE_ATTRIBUTE } from '../diagram/diagram-host.js';
import { rasterSourceOf } from '../diagram/rasterise.js';
import { IMAGE_PENDING_ATTRIBUTE, PREVIEW_LOADING_CLASS } from '../loading-placeholder.js';
import { MATH_PENDING_ATTRIBUTE, mathLiteralOf } from '../math-host.js';
import { SYNC_MARK_CLASS, SYNC_MARK_ON_CLASS } from '../sync-mark-classes.js';

/** What throng drew that never prints. */
const FURNITURE = [
  '.preview-fold-toggle',
  '.preview-callout__fold',
  '.preview-table-resize-handle',
  '.preview-diagram-frame__toolbar',
  `.${PREVIEW_LOADING_CLASS}`,
  '.preview-link-hint',
  // FR-076 — find's match outlines: a layer beside the content inside the panel body Print… hands over.
  '.preview-match-frames',
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
  /**
   * 075 FR-075a — a picture prints no larger than its own size (an image's pixels, an SVG's width and height):
   * fitted down to the page, never up. Print Preview's Scale still enlarges it, as it enlarges everything.
   */
  readonly noUpscale?: boolean;
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

/** A drawn picture wrapper (074 `picture.ts`) and its copy in the clone. */
interface PrintedPicture {
  readonly live: SVGSVGElement;
  readonly copy: SVGSVGElement;
}

/**
 * Replace each drawn diagram with its SVG, sized for the page; a failed one keeps only its notice. Returns the picture
 * wrappers among them, whose `<image>` may name a `blob:` URL ({@link inlinePictures}).
 */
function flattenDiagrams(live: HTMLElement, clone: HTMLElement, fit: 'width' | 'page', noUpscale = false): PrintedPicture[] {
  const pictures: PrintedPicture[] = [];
  const liveHosts = [...live.querySelectorAll<HTMLElement>(`.${DIAGRAM_HOST_CLASS}`)];
  const cloneHosts = [...clone.querySelectorAll<HTMLElement>(`.${DIAGRAM_HOST_CLASS}`)];
  cloneHosts.forEach((host, i) => {
    const svg = liveHosts[i]?.querySelector<SVGSVGElement>('.preview-diagram-frame__layer > svg') ?? null;
    if (svg === null) {
      const notice = host.querySelector('.preview-diagram__notice');
      // FR-043a — a diagram still drawing prints as itself, as an equation still typesetting does: its source as
      // written, rather than the blank gap its stripped placeholder would leave.
      const source = notice === null ? host.getAttribute(DIAGRAM_SOURCE_ATTRIBUTE) : null;
      if (source !== null) {
        const pre = host.ownerDocument.createElement('pre');
        pre.textContent = source;
        host.replaceChildren(pre);
      } else {
        host.replaceChildren(...(notice !== null ? [notice] : []));
      }
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
    if (svg.hasAttribute('data-throng-picture')) pictures.push({ live: svg, copy });
    const natural = noUpscale ? naturalWidthOf(svg) : null;
    if (natural !== null) copy.style.maxWidth = `${natural}px`;
    figure.append(copy);
    host.replaceWith(figure);
  });
  return pictures;
}

/** A drawing's own width in CSS pixels: its viewBox's, else its width attribute's; `null` when it names none. */
function naturalWidthOf(svg: SVGSVGElement): number | null {
  const box = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const width = box.length === 4 && Number.isFinite(box[2]) && box[2]! > 0 ? box[2]! : Number.parseFloat(svg.getAttribute('width') ?? '');
  return Number.isFinite(width) && width > 0 ? width : null;
}

/** `blob` as a `data:` URL. */
function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('The picture could not be read.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * 074 x 075 FR-066 — a picture drawn from a `blob:` URL (an SVG block, or an animated image's first frame under
 * reduced motion) is inlined from its own registered bytes: a `blob:` URL belongs to the preview's window, and the
 * print host is another, whose policy admits only `throng-preview:`, `data:` and the listed remote images. A
 * picture whose bytes cannot be read prints as its alternative text, never as a request.
 */
async function inlinePictures(pictures: readonly PrintedPicture[]): Promise<void> {
  for (const { live, copy } of pictures) {
    const image = copy.querySelector('image');
    const href = image?.getAttribute('href') ?? '';
    if (image === null || image === undefined || !href.startsWith('blob:')) continue;
    const read = rasterSourceOf(live);
    try {
      if (read === undefined) throw new Error('no registered source');
      image.setAttribute('href', await dataUrlOf(await read()));
    } catch (error) {
      logExpected('printable: inline a picture', 'a picture whose bytes cannot be read prints as its alternative text', error);
      copy.replaceWith(copy.ownerDocument.createTextNode(live.getAttribute('aria-label') ?? ''));
    }
  }
}

/** Open everything a fold hid (FR-074). */
function expandAll(root: HTMLElement): void {
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    if (el.hidden) el.hidden = false;
    el.removeAttribute('data-callout-collapsed');
  }
}

/** A cleaned clone of `body`, ready to serialise; exported for the component test. */
export function printableClone(
  body: HTMLElement,
  fit: 'width' | 'page',
  noUpscale = false,
): { root: HTMLElement; remoteImages: string[]; pictures: PrintedPicture[] } {
  const root = body.cloneNode(true) as HTMLElement;
  const pictures = flattenDiagrams(body, root, fit, noUpscale);
  // FR-043a — what was still loading prints as itself: an equation as written, an image as the image.
  for (const el of root.querySelectorAll<HTMLElement>(`[${MATH_PENDING_ATTRIBUTE}]`)) {
    el.textContent = mathLiteralOf(el);
    el.removeAttribute(MATH_PENDING_ATTRIBUTE);
  }
  for (const img of root.querySelectorAll(`[${IMAGE_PENDING_ATTRIBUTE}]`)) img.removeAttribute(IMAGE_PENDING_ATTRIBUTE);
  for (const el of root.querySelectorAll(FURNITURE)) el.remove();
  for (const notice of root.querySelectorAll('[role="status"], [role="alert"]')) {
    if (!notice.classList.contains('preview-diagram__notice')) notice.remove();
  }
  expandAll(root);
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const name of INTERACTIVE_ATTRIBUTES) el.removeAttribute(name);
    // 073 FR-033d — the scroll-sync mark is a gutter bar beside a block on screen; the block prints, the bar does not.
    el.classList.remove(SYNC_MARK_CLASS, SYNC_MARK_ON_CLASS);
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
  return { root, remoteImages: [...new Set(remoteImages)], pictures };
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

/** The printable output of `body`, as Markdown, Mermaid, Image and SVG hand it to `throng.print.open`. */
export async function buildPrintable(body: HTMLElement, options: PrintableOptions): Promise<PrintableOutput> {
  const { root, remoteImages, pictures } = printableClone(body, options.fit, options.noUpscale === true);
  await inlinePictures(pictures);
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
