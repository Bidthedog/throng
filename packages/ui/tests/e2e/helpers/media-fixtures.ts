/**
 * 074 — media files generated at run time for the preview E2E specs: a PDF of any page count, a PNG of any size, an SVG
 * of any weight. Generated rather than committed: a 10 MB image and a 500-page PDF have no place in the repository.
 */
import { randomBytes } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';

/** A Letter-sized PDF of `pages` pages, each saying its number. Hand-written, as `pages-3.pdf` is: PDF.js rebuilds the xref. */
export function longPdf(pages: number): string {
  // 1 the catalogue, 2 the page tree, 3 the font; then each page and its content stream.
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids: string[] = [];
  for (let n = 1; n <= pages; n += 1) {
    const page = objects.length + 1;
    const stream = `BT /F1 24 Tf 72 720 Td (Page ${n} of a long document) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${page + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(`${page} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`;
  const body = objects.map((o, i) => `${i + 1} 0 obj\n${o}\nendobj`).join('\n');
  return `%PDF-1.4\n${body}\ntrailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\n%%EOF\n`;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed) >>> 0);
  return Buffer.concat([head, typed, crc]);
}

/**
 * An RGBA PNG of `side` × `side` pixels of noise: noise does not compress, so the file is about `side² × 4` bytes —
 * 1600 gives a 10 MB image (SC-003).
 */
export function noisePng(side: number): Buffer {
  const row = side * 4 + 1;
  const raw = Buffer.alloc(row * side);
  for (let y = 0; y < side; y += 1) {
    raw[y * row] = 0; // filter: none
    randomBytes(side * 4).copy(raw, y * row + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0);
  ihdr.writeUInt32BE(side, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** An SVG of at least `bytes` bytes: a grid of small coloured squares (SC-003's 5 MB SVG). */
export function heavySvg(bytes: number): string {
  const parts: string[] = [];
  let size = 0;
  for (let i = 0; size < bytes; i += 1) {
    const x = (i % 400) * 5;
    const y = Math.floor(i / 400) * 5;
    const rect = `<rect x="${x}" y="${y}" width="4" height="4" fill="#${(i * 2654435761 >>> 8).toString(16).padStart(6, '0').slice(0, 6)}"/>`;
    parts.push(rect);
    size += rect.length;
  }
  const height = Math.ceil(parts.length / 400) * 5;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="${height}" viewBox="0 0 2000 ${height}">${parts.join('')}</svg>`;
}
