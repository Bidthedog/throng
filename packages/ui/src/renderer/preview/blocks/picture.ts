/**
 * Pictures on the block-renderer seam (074 research R2, R3, R9): an SVG source or an image URL, drawn into the
 * SAME diagram frame a Mermaid diagram is drawn in, so an Image Preview, an SVG Preview, a ```` ```svg ```` fence and
 * a framed Markdown image carry exactly a Mermaid diagram's controls (FR-030 – FR-035).
 *
 * ══ THE WRAPPER ══
 *
 * The frame draws an `SVGSVGElement`. A picture is handed to it as a WRAPPER — `<svg viewBox width height><image
 * href/></svg>` — whose one `<image>` references the picture. An SVG referenced by `<image>` is loaded in Chromium's
 * SECURE STATIC IMAGE MODE: no script runs, nothing outside the file loads, nothing is interactive (Q3, FR-040,
 * FR-044). The source text itself is never inserted into the document; it is parsed with `DOMParser` (an inert
 * document) only to read its size and to tell a malformed file from a good one.
 *
 * ══ COPY IMAGE ══
 *
 * The rasteriser draws a wrapper from the bytes its renderer registers (`registerRasterSource`): the SVG source as a
 * blob, or a raster file's bytes read through the preview protocol by `readSource`, so the canvas is never tainted.
 */
import { formatGrouped } from '@throng/core';
import { registerRasterSource } from '../diagram/rasterise.js';
import type { BlockRenderer, BlockRendererEntry } from './block-renderers.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 074 FR-045 — the longest an SVG may take to decode before its notice shows (as `DIAGRAM_RENDER_TIMEOUT_MS`). */
export const SVG_DRAW_TIMEOUT_MS = 5000;
/** 074 FR-025 — the largest picture, in pixels, that is drawn: 10,000 × 10,000. */
export const MAX_IMAGE_PIXELS = 100_000_000;
/** The size an SVG with neither width/height nor a viewBox draws at (the CSS replaced-element default). */
export const DEFAULT_SVG_SIZE = { width: 300, height: 150 } as const;

/** How a picture is loaded and measured. Injected by tests: jsdom decodes no image. */
export interface PictureLoader {
  /** Resolve once `url` has decoded, with its natural size; reject when it cannot be decoded. */
  load(url: string): Promise<{ width: number; height: number }>;
  /**
   * 074 FR-025 — resolve with `url`'s natural size as soon as its header is read, WITHOUT decoding the bitmap; reject
   * when it cannot be read. A raster picture is measured first, so one over the pixel bound is never decoded.
   */
  measure?(url: string): Promise<{ width: number; height: number }>;
}

export const browserPictureLoader: PictureLoader = {
  async load(url) {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  },
  // The load event gives the natural size; Chromium decodes the bitmap only when it is painted or `decode()` asks.
  measure(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error('The picture could not be read.'));
      image.src = url;
    });
  },
};

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** The one-`<image>` wrapper the frame draws (see the module comment). */
export function pictureWrapper(href: string, width: number, height: number, alt?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('data-throng-picture', '');
  svg.setAttribute('role', 'img');
  if (alt !== undefined && alt.length > 0) {
    svg.setAttribute('aria-label', alt);
    // #718 — a `title` attribute, which the app's popup draws (`title-tooltips.tsx`); an SVG `<title>` the OS draws.
    svg.setAttribute('title', alt);
  }
  const image = document.createElementNS(SVG_NS, 'image');
  image.setAttribute('href', href);
  image.setAttribute('width', String(width));
  image.setAttribute('height', String(height));
  image.setAttribute('preserveAspectRatio', 'none');
  svg.appendChild(image);
  return svg;
}

/** A length attribute in user units (`120`, `120px`), else `null` — a `%` or `em` names no intrinsic size. */
function userLength(value: string | null): number | null {
  if (value === null) return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/.exec(value);
  const n = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 074 FR-043 — an SVG's intrinsic size: its `width`/`height`, else its `viewBox`, else {@link DEFAULT_SVG_SIZE}.
 * Throws an `Error` naming the problem when the text is not a well-formed SVG document.
 */
export function svgIntrinsicSize(source: string): { width: number; height: number } {
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  if (error !== undefined) {
    const detail = (error.textContent ?? '').trim().split('\n')[0]?.trim() ?? '';
    throw new Error(detail.length > 0 ? `The SVG is not well formed: ${detail}` : 'The SVG is not well formed.');
  }
  const root = doc.documentElement;
  if (root.localName !== 'svg') throw new Error('The file is not an SVG: its root element is not <svg>.');
  return sizeFrom(root.getAttribute('width'), root.getAttribute('height'), root.getAttribute('viewBox'));
}

/** B2 — below this many characters the whole-document parse costs a few milliseconds and keeps its early error. */
const LARGE_SVG_CHARS = 256 * 1024;

/** The prolog an SVG file may open with before its root: an XML declaration, comments and whitespace. */
const PROLOG = /^(?:\uFEFF)?(?:\s+|<\?xml\b[^>]*\?>|<!--[\s\S]*?-->)*/;

/**
 * 074 SC-003 (B2) — the size {@link svgIntrinsicSize} would give, read from the root tag alone, or `null` when the
 * root cannot be read that cheaply (a DOCTYPE, which may define entities, or anything but a plain `<svg …>` first).
 * A large SVG spends most of a second in a whole-document parse whose only use here is the size; the root tag
 * carries it. Attribute values are unescaped only for the plain cases a length or a viewBox uses.
 */
export function svgRootSize(source: string): { width: number; height: number } | null {
  const start = PROLOG.exec(source)?.[0].length ?? 0;
  const tag = /^<svg\b((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/.exec(source.slice(start, start + 16_384));
  if (tag === null) return null;
  const attrs = new Map<string, string>();
  for (const m of (tag[1] ?? '').matchAll(/([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const value = m[2] ?? m[3] ?? '';
    if (value.includes('&')) return null;
    attrs.set(m[1]!, value);
  }
  return sizeFrom(attrs.get('width') ?? null, attrs.get('height') ?? null, attrs.get('viewBox') ?? null);
}

function sizeFrom(w: string | null, h: string | null, viewBox: string | null): { width: number; height: number } {
  const box = (viewBox ?? '').trim().split(/[\s,]+/).map(Number);
  const boxOk = box.length === 4 && box.every(Number.isFinite) && box[2]! > 0 && box[3]! > 0;
  const width = userLength(w);
  const height = userLength(h);
  if (width !== null && height !== null) return { width, height };
  if (boxOk) {
    const [, , bw, bh] = box as [number, number, number, number];
    if (width !== null) return { width, height: (width * bh) / bw };
    if (height !== null) return { width: (height * bw) / bh, height };
    return { width: bw, height: bh };
  }
  return { width: width ?? DEFAULT_SVG_SIZE.width, height: height ?? DEFAULT_SVG_SIZE.height };
}

/**
 * Blob URLs by key, newest last, so a picture redrawn on every edit or every change on disk does not leak one URL per
 * draw: the oldest is revoked once {@link MAX_BLOB_URLS} are held (a frame still showing it keeps its decoded drawing).
 */
const MAX_BLOB_URLS = 64;

class BoundedBlobUrls {
  private readonly urls = new Map<string, string>();

  async get(key: string, make: () => Promise<Blob>): Promise<string> {
    const held = this.take(key);
    if (held !== undefined) return held;
    return this.add(key, await make());
  }

  getSync(key: string, make: () => Blob): string {
    return this.take(key) ?? this.add(key, make());
  }

  private take(key: string): string | undefined {
    const held = this.urls.get(key);
    if (held === undefined) return undefined;
    this.urls.delete(key);
    this.urls.set(key, held);
    return held;
  }

  private add(key: string, blob: Blob): string {
    const held = this.take(key); // a concurrent draw of the same key got there first
    if (held !== undefined) return held;
    const url = URL.createObjectURL(blob);
    this.urls.set(key, url);
    if (this.urls.size > MAX_BLOB_URLS) {
      const [oldest, oldUrl] = this.urls.entries().next().value as [string, string];
      this.urls.delete(oldest);
      URL.revokeObjectURL(oldUrl);
    }
    return url;
  }
}

/** SVG sources, keyed by the source: a live-edited SVG mints one per keystroke. */
const svgUrls = new BoundedBlobUrls();
/** 074 FR-026 first frames, keyed by the picture's URL: a regenerated picture mints a new `?rev=` per change. */
const firstFrameUrls = new BoundedBlobUrls();

function svgUrlFor(source: string): string {
  return svgUrls.getSync(source, () => new Blob([source], { type: 'image/svg+xml' }));
}

/** Draw SVG `source` as an isolated picture (FR-040, FR-044, FR-045). */
export async function drawSvgSource(source: string, loader: PictureLoader = browserPictureLoader): Promise<SVGSVGElement> {
  // B2 — the root tag gives the size; the whole-document parse runs only when it cannot, or to say what is wrong.
  const fast = source.length > LARGE_SVG_CHARS ? svgRootSize(source) : null;
  const size = fast ?? svgIntrinsicSize(source);
  const url = svgUrlFor(source);
  await withTimeout(loader.load(url), SVG_DRAW_TIMEOUT_MS, 'The SVG took too long to draw.').catch((error: unknown) => {
    if (error instanceof Error && error.message === 'The SVG took too long to draw.') throw error;
    // A picture that will not draw is most often a malformed document: the full parse names the fault (FR-043).
    if (fast !== null) svgIntrinsicSize(source);
    throw new Error('The SVG could not be drawn as a picture.');
  });
  const wrapper = pictureWrapper(url, size.width, size.height);
  registerRasterSource(wrapper, () => Promise.resolve(new Blob([source], { type: 'image/svg+xml' })));
  return wrapper;
}

/** The `svg` block renderer: a ```` ```svg ```` fence, and the SVG Preview's one picture (FR-054, FR-040). */
export function svgBlockEntry(loader: PictureLoader = browserPictureLoader): BlockRendererEntry {
  const renderer: BlockRenderer = { render: (source) => drawSvgSource(source, loader) };
  return { lang: 'svg', noun: 'SVG', load: () => Promise.resolve(renderer) };
}

export interface ImageEntryOptions {
  loader?: PictureLoader;
  /** The picture's bytes, for Copy Image and the reduced-motion first frame; absent, neither is available. */
  readBytes?: (url: string) => Promise<Blob | null>;
  /** Told the natural size of every picture drawn (the Image Preview's status readout, FR-022). */
  onMeasured?: (size: { width: number; height: number }) => void;
  /** 074 FR-026 — draw an animated picture's first frame only. Read on every draw. */
  reducedMotion?: () => boolean;
  /** The picture's alternative text, where the document gives one. */
  alt?: (url: string) => string | undefined;
}

/** 074 FR-026 — the first frame of `blob` as a PNG (an animated GIF, WebP or APNG stops). */
async function firstFramePng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (png === null) throw new Error('The first frame could not be drawn.');
    return png;
  } finally {
    bitmap.close();
  }
}

/** The pixel-bound notice (FR-025), digit-grouped. */
export function tooManyPixelsMessage(width: number, height: number): string {
  return `This image is ${formatGrouped(width)} × ${formatGrouped(height)} pixels, more than throng draws (${formatGrouped(MAX_IMAGE_PIXELS)} pixels).`;
}

/**
 * The `image-url` renderer: a raster picture at a `throng-preview:` URL (FR-020 – FR-028, FR-055). Not a fence
 * language: a body or the framed-image pass constructs it with the options it has.
 */
export function imageUrlEntry(options: ImageEntryOptions = {}): BlockRendererEntry {
  const loader = options.loader ?? browserPictureLoader;
  const renderer: BlockRenderer = {
    async render(url) {
      const unshowable = 'This file is not an image throng can show.';
      let size: { width: number; height: number };
      try {
        // FR-025 — measured before it is decoded, so a picture over the bound is refused without decoding it.
        size = await (loader.measure ?? loader.load).call(loader, url);
      } catch {
        throw new Error(unshowable);
      }
      if (!(size.width > 0 && size.height > 0)) throw new Error(unshowable);
      if (size.width * size.height > MAX_IMAGE_PIXELS) throw new Error(tooManyPixelsMessage(size.width, size.height));
      if (loader.measure !== undefined) {
        try {
          await loader.load(url);
        } catch {
          throw new Error(unshowable);
        }
      }
      options.onMeasured?.(size);
      const readBytes = options.readBytes;
      let href = url;
      if (readBytes !== undefined && options.reducedMotion?.() === true) {
        const blob = await readBytes(url);
        if (blob !== null) href = await firstFrameUrls.get(url, () => firstFramePng(blob));
      }
      const wrapper = pictureWrapper(href, size.width, size.height, options.alt?.(url));
      if (readBytes !== undefined) {
        registerRasterSource(wrapper, async () => {
          const blob = await readBytes(url);
          if (blob === null) throw new Error('The picture could not be read.');
          return blob;
        });
      }
      return wrapper;
    },
  };
  return { lang: 'image-url', noun: 'picture', load: () => Promise.resolve(renderer) };
}

/** Whether the OS asks for reduced motion (FR-026). */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
