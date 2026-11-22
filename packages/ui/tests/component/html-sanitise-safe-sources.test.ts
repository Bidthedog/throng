/**
 * 074 FR-072a, FR-072c, FR-093a — the HTML sanitiser keeps a remote stylesheet, font or image only from a Safe HTML
 * preview source, widens the frame's policy to exactly those sources, and records every remote resource it leaves
 * out, with the source that would allow it.
 *
 * Layer: component — DOMPurify needs a DOM, and the unit project runs in node.
 */
import { describe, expect, it } from 'vitest';
import { frameCsp, sanitiseHtmlPage } from '../../src/renderer/preview/providers/html/html-sanitise.js';

const CTX = { panelId: 'p1', docPath: 'D:/proj/page.html', projectRoot: 'D:/proj' };
const SAFE = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://*.example.com'];

const PAGE = `<!doctype html><html><head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
<link rel="stylesheet" href="https://evil.net/site.css">
<script src="https://cdn.example.com/app.js"></script>
<style>
  @import "https://evil.net/more.css";
  @font-face { font-family: X; src: url("https://fonts.gstatic.com/x.woff2"); }
  @font-face { font-family: Y; src: url(https://evil.net/y.woff2); }
  body { background: url("http://plain.org/bg.png"); }
</style>
</head><body>
<img alt="ok" src="https://img.example.com/a.png">
<img alt="bare" src="https://example.com/a.png">
<img alt="evil" src="//evil.net/b.png" srcset="https://img.example.com/1x.png 1x, https://evil.net/2x.png 2x">
<img alt="local" src="img/c.png">
<img alt="data" src="data:image/png;base64,AAAA">
</body></html>`;

const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

describe('safe sources are kept (FR-072a)', () => {
  const page = sanitiseHtmlPage(PAGE, { ...CTX, safeSources: SAFE });
  const doc = parse(page.html);

  it('keeps a stylesheet, a font and an image from a safe source, and a srcset candidate from one', () => {
    expect([...doc.querySelectorAll('link')].map((l) => l.getAttribute('href'))).toEqual(['https://fonts.googleapis.com/css2?family=Inter']);
    expect(doc.querySelector('style')?.textContent).toContain('url("https://fonts.gstatic.com/x.woff2")');
    expect(doc.querySelector('img[alt="ok"]')?.getAttribute('src')).toBe('https://img.example.com/a.png');
    expect(doc.querySelector('img[alt="evil"]')?.getAttribute('srcset')).toBe('https://img.example.com/1x.png 1x');
    expect(doc.querySelector('img[alt="local"]')?.getAttribute('src')).toBe('throng-preview://asset/p1/img/c.png');
  });

  it('leaves out everything else remote, and never keeps a script', () => {
    expect(doc.querySelector('img[alt="bare"]')?.hasAttribute('src')).toBe(false);
    expect(doc.querySelector('img[alt="evil"]')?.hasAttribute('src')).toBe(false);
    expect(doc.querySelectorAll('script')).toHaveLength(0);
    const css = doc.querySelector('style')?.textContent ?? '';
    expect(css).not.toContain('evil.net');
    expect(css).not.toContain('plain.org');
  });

  it('widens the frame policy to the safe sources for images, styles and fonts only', () => {
    const csp = doc.head.firstElementChild?.getAttribute('content') ?? '';
    expect(csp).toBe(frameCsp(SAFE));
    expect(csp).toContain("img-src throng-preview: https://fonts.googleapis.com https://fonts.gstatic.com https://*.example.com");
    expect(csp).toContain("style-src 'unsafe-inline' throng-preview: https://fonts.googleapis.com");
    expect(csp).toContain('font-src throng-preview: https://fonts.googleapis.com');
    expect(csp).not.toMatch(/script-src/);
    expect(csp).toContain("default-src 'none'");
  });

  it('with no sources the policy is the closed one', () => {
    expect(frameCsp([])).toBe(
      "default-src 'none'; img-src throng-preview:; style-src 'unsafe-inline' throng-preview:; font-src throng-preview:; media-src throng-preview:",
    );
  });
});

describe('what was left out is recorded (FR-093a)', () => {
  const page = sanitiseHtmlPage(PAGE, { ...CTX, safeSources: SAFE });
  const by = (url: string) => page.blocked.find((b) => b.url === url);

  it('records each remote resource left out once, with its kind and source', () => {
    expect(by('https://evil.net/site.css')).toEqual({ url: 'https://evil.net/site.css', kind: 'stylesheet', source: 'https://evil.net', allowable: true });
    expect(by('https://evil.net/more.css')).toMatchObject({ kind: 'stylesheet', allowable: true });
    expect(by('https://evil.net/y.woff2')).toMatchObject({ kind: 'font', allowable: true });
    expect(by('https://example.com/a.png')).toMatchObject({ kind: 'image', source: 'https://example.com', allowable: true });
    expect(by('//evil.net/b.png')).toMatchObject({ kind: 'image', source: 'https://evil.net', allowable: true });
    expect(by('https://evil.net/2x.png')).toMatchObject({ kind: 'image', allowable: true });
  });

  it('records a script and an http: resource as never allowable', () => {
    expect(by('https://cdn.example.com/app.js')).toMatchObject({ kind: 'script', source: 'https://cdn.example.com', allowable: false });
    expect(by('http://plain.org/bg.png')).toMatchObject({ kind: 'image', source: 'http://plain.org', allowable: false });
  });

  it('records nothing kept, local, data: or duplicated', () => {
    const urls = page.blocked.map((b) => b.url);
    expect(urls).not.toContain('https://img.example.com/a.png');
    expect(urls.some((u) => u.startsWith('data:') || u.includes('img/c.png'))).toBe(false);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('without safe sources every remote resource is left out and recorded', () => {
    const closed = sanitiseHtmlPage(PAGE, CTX);
    expect(parse(closed.html).querySelectorAll('link')).toHaveLength(0);
    expect(closed.blocked.map((b) => b.url)).toContain('https://fonts.googleapis.com/css2?family=Inter');
  });
});

describe('an @import is a stylesheet, however it is written (FR-093a)', () => {
  const page = sanitiseHtmlPage(
    `<html><head><style>
      @import url('https://cdn.other.com/a.css');
      @import url(https://cdn.other.com/b.css);
      @import url("https://fonts.googleapis.com/c.css");
    </style></head><body></body></html>`,
    { ...CTX, safeSources: SAFE },
  );

  it('lists a left-out @import url(...) as a stylesheet, never as an image', () => {
    const imports = page.blocked.filter((b) => b.url.startsWith('https://cdn.other.com/'));
    expect(imports.map((b) => [b.url, b.kind])).toEqual([
      ['https://cdn.other.com/a.css', 'stylesheet'],
      ['https://cdn.other.com/b.css', 'stylesheet'],
    ]);
  });

  it('keeps an @import url(...) from a safe source, and drops the rest', () => {
    const css = parse(page.html).querySelector('style')?.textContent ?? '';
    expect(css).toContain('@import url("https://fonts.googleapis.com/c.css")');
    expect(css).not.toContain('cdn.other.com');
  });
});
