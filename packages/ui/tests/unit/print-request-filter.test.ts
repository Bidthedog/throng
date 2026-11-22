/**
 * 075 FR-079, FR-066 — what a print host may load. A picture prints only if its URL is one of these: the maintainer's
 * blank SVG print (2026-11-20 18:10) was a picture whose `blob:` URL the print partition never serves, so a printable
 * inlines such pictures as `data:` URLs, which it does.
 *
 * Layer: unit — the decision `electron-print-engine.ts` applies to every request from the print partition.
 */
import { describe, expect, it } from 'vitest';
import { printRequestAllowed } from '../../src/main/print-request-filter.js';

const host = { fileUrl: 'file:///tmp/print-jobs/hosts/a.html', allowed: new Set(['https://e.com/loaded.png']) };
const bundled = (url: string): boolean => url.startsWith('file:///app/dist/');
const allowed = (url: string): boolean => printRequestAllowed(url, host, bundled);

describe('the print partition', () => {
  it('loads an inlined picture: an SVG or a raster image as a data: URL', () => {
    expect(allowed('data:image/svg+xml;base64,PHN2Zy8+')).toBe(true);
    expect(allowed('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
  });

  it('loads the preview\'s own route: an image preview\'s source, a Markdown image beside the document', () => {
    expect(allowed('throng-preview://source/p1')).toBe(true);
    expect(allowed('throng-preview://asset/p1/img/a.svg')).toBe(true);
  });

  it('never loads a blob: URL: it belongs to the preview\'s window', () => {
    expect(allowed('blob:file:///aa-bb')).toBe(false);
  });

  it('loads its own document, the listed remote images and the app\'s bundled assets, and nothing else', () => {
    expect(allowed(host.fileUrl)).toBe(true);
    expect(allowed('https://e.com/loaded.png')).toBe(true);
    expect(allowed('file:///app/dist/fonts/KaTeX.woff2')).toBe(true);
    expect(allowed('https://e.com/other.png')).toBe(false);
    expect(allowed('file:///etc/passwd')).toBe(false);
  });
});
