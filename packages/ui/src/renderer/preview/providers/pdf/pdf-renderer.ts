/**
 * The PDF provider's one door to PDF.js (074 research R5, FR-060 – FR-069).
 *
 * Everything PDF.js-specific lives here, behind a small interface the body draws from — so the body names no
 * library, and a component test stands a fake in for this module alone. PDF.js (`pdfjs-dist`, Apache-2.0) is
 * reached only by `preview/pdf-library.ts`'s dynamic import, which Print Preview shares: no window, and no other
 * preview, loads it (FR-065).
 *
 * ══ NOTHING IN A PDF RUNS OR FETCHES (FR-066) ══
 *
 * - The bytes arrive from main (`preview.readSource`), passed as `data`: PDF.js is given no URL, and with no
 *   `cMapUrl`, `standardFontDataUrl`, `iccUrl` or `wasmUrl` it has nowhere to fetch from. `useWasm: false` keeps
 *   it from trying (the WASM decoders would also need `wasm-unsafe-eval`, which the renderer CSP does not grant —
 *   plan Complexity Tracking: JPX/JBIG2 images are absent).
 * - Only the core display API is used: it has no scripting (that is the viewer's sandbox, never loaded), and
 *   `enableXfa: false` keeps XFA forms out. Pages are painted to a canvas; no annotation layer is built, so no
 *   form field is live — `AnnotationMode.ENABLE` paints their static appearance onto the canvas. The one DOM a page
 *   adds is its TEXT layer (FR-068a): spans whose `textContent` PDF.js sets, so a PDF's text never becomes markup.
 * - Links are not PDF.js's to follow. {@link PdfPage.links} hands back only two kinds — a page inside this
 *   document, or an `http:`/`https:`/`mailto:` URL — and the body draws and follows them itself (FR-079's
 *   gesture). Every other action (launch, file, submit, JavaScript, sound, movie) is dropped here.
 *
 * (PDF.js 6 no longer evaluates code for fonts at all, so the `isEvalSupported` option research R5 named no
 * longer exists.)
 */
import { exclusiveTextLayer } from './text-layer-guard.js';
import { logExpected } from '@throng/core';
import { loadPdfJs } from '../../pdf-library.js';

/** One page, at scale 1 in CSS pixels. */
export interface PdfPage {
  readonly width: number;
  readonly height: number;
  /** Paint the page into `canvas` at `scale` CSS px per PDF px, times `pixelRatio` device pixels per CSS px. */
  render(canvas: HTMLCanvasElement, scale: number, pixelRatio: number): Promise<void>;
  /** The page's followable links, rectangles in CSS px at scale 1 from the page's top-left. */
  links(): Promise<readonly PdfLink[]>;
  /**
   * 074 FR-068a (2026-11-19) — lay the page's text out in `container` as transparent, selectable spans over the
   * canvas at `scale` (PDF.js's text layer), so a reader can select and copy it. The spans carry text only: PDF.js
   * sets each one's `textContent`, so nothing in the PDF becomes markup. Resolves with a cancel for a layer that is
   * replaced before it finishes.
   */
  renderText(container: HTMLElement, scale: number): Promise<() => void>;
}

export interface PdfLink {
  /** `[left, top, width, height]`. */
  readonly rect: readonly [number, number, number, number];
  readonly target: { kind: 'page'; page: number } | { kind: 'url'; url: string };
}

export interface PdfDocument {
  readonly pageCount: number;
  /** 1-based. */
  page(n: number): Promise<PdfPage>;
  destroy(): void;
}

export type PdfOpenResult =
  | { ok: true; doc: PdfDocument }
  /** FR-067 — `reason` is the sentence's tail: "This PDF cannot be displayed: <reason>." */
  | { ok: false; reason: string };

const EXTERNAL = /^(https?:|mailto:)/i;

/** Open `bytes` as a PDF. Never rejects for a bad document — that is `{ ok: false }`; a library failure rejects. */
export async function openPdf(bytes: Uint8Array): Promise<PdfOpenResult> {
  const { lib, worker } = await loadPdfJs();
  const task = lib.getDocument({
    worker,
    // A copy: PDF.js transfers the buffer it is given to its worker.
    data: bytes.slice(),
    enableXfa: false,
    useWasm: false,
    useSystemFonts: false,
    stopAtErrors: false,
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
  });
  let proxy: Awaited<typeof task.promise>;
  try {
    proxy = await task.promise;
  } catch (error) {
    logExpected('pdf-renderer: open', 'a PDF may be encrypted, malformed or truncated; the preview names which', error);
    const name = (error as { name?: unknown } | null)?.name;
    if (name === 'PasswordException') return { ok: false, reason: 'it is protected by a password' };
    if (name === 'InvalidPDFException') return { ok: false, reason: 'it is not a valid PDF file' };
    return { ok: false, reason: 'it is damaged or incomplete' };
  }

  const pageIndexOf = async (dest: unknown): Promise<number | null> => {
    try {
      const explicit = typeof dest === 'string' ? await proxy.getDestination(dest) : dest;
      if (!Array.isArray(explicit) || explicit.length === 0) return null;
      const ref = explicit[0] as unknown;
      if (typeof ref === 'number') return ref + 1;
      return (await proxy.getPageIndex(ref as Parameters<typeof proxy.getPageIndex>[0])) + 1;
    } catch (error) {
      logExpected('pdf-renderer: resolve a link destination', 'a link may name a page the document does not have; it is not drawn', error);
      return null;
    }
  };

  const doc: PdfDocument = {
    pageCount: proxy.numPages,
    async page(n) {
      const page = await proxy.getPage(n);
      const base = page.getViewport({ scale: 1 });
      return {
        width: base.width,
        height: base.height,
        async render(canvas, scale, pixelRatio) {
          const viewport = page.getViewport({ scale: scale * pixelRatio });
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          await page.render({ canvas, viewport, annotationMode: lib.AnnotationMode.ENABLE }).promise;
        },
        async renderText(container, scale) {
          const viewport = page.getViewport({ scale });
          // The layer sizes itself and its spans from `--total-scale-factor`, which the page element carries at the
          // view's CURRENT zoom (`pdf-body.tsx`) — never set here, at the paint's, where it would go stale. One layer
          // streams into a container at a time: the paint and Find's background build both lay text out.
          return exclusiveTextLayer(
            container,
            () => new lib.TextLayer({ textContentSource: page.streamTextContent(), container, viewport }),
          );
        },
        async links() {
          const annotations = (await page.getAnnotations({ intent: 'display' })) as Array<Record<string, unknown>>;
          const out: PdfLink[] = [];
          for (const a of annotations) {
            if (a.subtype !== 'Link' || !Array.isArray(a.rect)) continue;
            const r = a.rect as number[];
            const [x1, y1] = base.convertToViewportPoint(r[0]!, r[1]!) as number[];
            const [x2, y2] = base.convertToViewportPoint(r[2]!, r[3]!) as number[];
            const rect = [Math.min(x1!, x2!), Math.min(y1!, y2!), Math.abs(x2! - x1!), Math.abs(y2! - y1!)] as const;
            if (typeof a.url === 'string' && EXTERNAL.test(a.url)) {
              out.push({ rect, target: { kind: 'url', url: a.url } });
            } else if (a.dest !== undefined && a.dest !== null) {
              const target = await pageIndexOf(a.dest);
              if (target !== null) out.push({ rect, target: { kind: 'page', page: target } });
            }
            // Anything else — a launch, file, JavaScript or form action — is not a link here (FR-066).
          }
          return out;
        },
      };
    },
    destroy() {
      void task.destroy();
    },
  };
  return { ok: true, doc };
}
