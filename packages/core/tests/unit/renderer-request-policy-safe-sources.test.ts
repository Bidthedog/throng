// Layer: unit — 074 FR-072a, FR-092a, FR-093: an HTML Preview frame's safe sources at the request filter.
import { describe, expect, it } from 'vitest';
import { decideRendererRequest } from '../../src/preview/request-policy.js';

const policy = { rendererDir: 'D:/app/renderer', remoteImages: true };
const SOURCES = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://*.example.com'];
const fromFrame = (url: string, resourceType: string) =>
  decideRendererRequest({ url, resourceType, fromSubFrame: true, frameSources: SOURCES }, policy);

describe('a sub-frame with safe sources (FR-072a)', () => {
  it.each([
    ['https://fonts.googleapis.com/css2?family=Inter', 'stylesheet'],
    ['https://fonts.gstatic.com/s/inter.woff2', 'font'],
    ['https://img.example.com/a.png', 'image'],
  ])('allows %s as a %s', (url, type) => {
    expect(fromFrame(url, type)).toBe('allow');
  });

  it.each(['script', 'xhr', 'fetch', 'media', 'subFrame', 'object', 'ping', 'webSocket', 'other'])(
    'cancels a %s even from a safe source',
    (type) => {
      expect(fromFrame('https://fonts.gstatic.com/x', type)).toBe('cancel');
    },
  );

  it('cancels an unlisted origin, the bare wildcard domain and http:', () => {
    expect(fromFrame('https://evil.net/a.css', 'stylesheet')).toBe('cancel');
    expect(fromFrame('https://example.com/a.png', 'image')).toBe('cancel');
    expect(fromFrame('http://fonts.gstatic.com/x.woff2', 'font')).toBe('cancel');
  });

  it('a sub-frame with no registered sources reaches nothing (FR-093: SVG, PDF, an unregistered frame)', () => {
    expect(decideRendererRequest({ url: 'https://fonts.gstatic.com/x.woff2', resourceType: 'font', fromSubFrame: true }, policy)).toBe(
      'cancel',
    );
    expect(decideRendererRequest({ url: 'https://img.example.com/a.png', resourceType: 'image', fromSubFrame: true }, policy)).toBe(
      'cancel',
    );
  });
});

describe('the top-level renderer document is unchanged by FR-092a', () => {
  it('still refuses an https stylesheet or font, whatever sources are passed', () => {
    for (const resourceType of ['stylesheet', 'font']) {
      expect(
        decideRendererRequest({ url: 'https://fonts.gstatic.com/x', resourceType, fromSubFrame: false, frameSources: SOURCES }, policy),
      ).toBe('cancel');
    }
  });
});
