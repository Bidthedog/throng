/**
 * A drawn diagram as a PNG data URI, for a rich-text copy (054 FR-049a, research R5 "Copy").
 *
 * The image is the diagram as currently themed at its NATURAL size — the SVG the frame drew, never its zoom
 * or pan, which live on the frame's layer and not on the SVG. The SVG has already been through the diagram
 * profile, so it carries no external reference to taint the canvas, and it is loaded from a `blob:` URL
 * this module mints and revokes itself (the renderer CSP's `img-src`).
 *
 * Isolated in its own module so a component test can stand a fixed image in for it: jsdom has no canvas.
 */
import { DIAGRAM_PNG_DATA_URI } from './diagram-host.js';

function naturalSize(svg: SVGSVGElement): { width: number; height: number } {
  const box = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (box.length === 4 && box.every(Number.isFinite) && box[2]! > 0 && box[3]! > 0) return { width: box[2]!, height: box[3]! };
  return { width: Number.parseFloat(svg.getAttribute('width') ?? '') || 300, height: Number.parseFloat(svg.getAttribute('height') ?? '') || 150 };
}

/**
 * 074 R2 — a picture drawn as a one-`<image>` wrapper is rasterised from its OWN bytes, not by serialising the
 * wrapper: an SVG loaded as an image cannot load the `<image>` inside it, and a `throng-preview:` picture would
 * taint the canvas. The renderer that built the wrapper registers how to read those bytes.
 */
const rasterSources = new WeakMap<SVGSVGElement, () => Promise<Blob>>();

/** Register `read` as `wrapper`'s raster source (see {@link rasterSources}). */
export function registerRasterSource(wrapper: SVGSVGElement, read: () => Promise<Blob>): void {
  rasterSources.set(wrapper, read);
}

/** How `wrapper`'s own bytes are read, when its renderer registered them (075 FR-066: printing a picture). */
export function rasterSourceOf(wrapper: SVGSVGElement): (() => Promise<Blob>) | undefined {
  return rasterSources.get(wrapper);
}

/** A raster picture through `createImageBitmap`; an SVG (which it cannot decode) through an image of its blob. */
async function decodeBlob(blob: Blob): Promise<ImageBitmap> {
  if (blob.type !== 'image/svg+xml') return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return await createImageBitmap(image);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function rasteriseBlob(doc: Document, blob: Blob): Promise<string> {
  const bitmap = await decodeBlob(blob);
  try {
    const canvas = doc.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('No canvas to draw the picture on.');
    context.drawImage(bitmap, 0, 0);
    const png = canvas.toDataURL('image/png');
    if (!DIAGRAM_PNG_DATA_URI.test(png)) throw new Error('The picture could not be encoded.');
    return png;
  } finally {
    bitmap.close();
  }
}

export async function rasteriseSvg(svg: SVGSVGElement): Promise<string> {
  const doc = svg.ownerDocument;
  const source = rasterSources.get(svg);
  if (source !== undefined) return rasteriseBlob(doc, await source());
  const { width, height } = naturalSize(svg);
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', String(width));
  copy.setAttribute('height', String(height));
  const markup = new XMLSerializer().serializeToString(copy);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    const image = new Image(width, height);
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The diagram image could not be loaded.'));
      image.src = url;
    });
    const canvas = doc.createElement('canvas');
    canvas.width = Math.ceil(width);
    canvas.height = Math.ceil(height);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('No canvas to draw the diagram on.');
    context.drawImage(image, 0, 0, width, height);
    const png = canvas.toDataURL('image/png');
    if (!DIAGRAM_PNG_DATA_URI.test(png)) throw new Error('The diagram image could not be encoded.');
    return png;
  } finally {
    URL.revokeObjectURL(url);
  }
}
