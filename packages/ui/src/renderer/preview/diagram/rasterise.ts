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

export async function rasteriseSvg(svg: SVGSVGElement): Promise<string> {
  const doc = svg.ownerDocument;
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
