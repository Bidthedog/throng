/**
 * 074 FR-072 – FR-082, FR-090 (research R6, step 1–4) — the HTML preview's own sanitiser profile, over the hostile
 * fixture: what is removed, how every resource URL and link is rewritten, and the CSP injected into the frame.
 *
 * Layer: component — DOMPurify needs a DOM, and the unit project runs in node. One sanitise, shared read-only.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { previewLinkHoverText } from '../../src/renderer/preview/link-dom.js';
import { primaryModifierLabel } from '../../src/renderer/config/host-modifiers.js';
import {
  FRAME_CSP,
  sanitiseHtmlPage,
  type SanitisedHtmlPage,
} from '../../src/renderer/preview/providers/html/html-sanitise.js';

// Resolved from the working directory: under jsdom `import.meta.url` is an `http:` URL.
const HOSTILE = readFileSync(resolve(process.cwd(), 'packages/ui/tests/fixtures/preview/hostile.html'), 'utf8');
const ROOT = 'D:/proj';
const DOC = 'D:/proj/site/pages/hostile.html';
const ASSET = 'throng-preview://asset/panel-1/';

let page: SanitisedHtmlPage;
let doc: Document;

beforeAll(() => {
  page = sanitiseHtmlPage(HOSTILE, {
    panelId: 'panel-1',
    docPath: DOC,
    projectRoot: ROOT,
    defaults: { background: 'rgb(1, 2, 3)', text: 'rgb(4, 5, 6)' },
  });
  doc = new DOMParser().parseFromString(page.html, 'text/html');
});

const styles = (): string => [...doc.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
const link = (text: string): HTMLAnchorElement | undefined => [...doc.querySelectorAll('a')].find((a) => a.textContent === text);

describe('nothing that runs survives (FR-074, FR-077)', () => {
  it('removes every script, noscript, frame, object, embed and base', () => {
    for (const tag of ['script', 'noscript', 'iframe', 'frame', 'object', 'embed', 'base']) {
      expect(doc.querySelectorAll(tag), tag).toHaveLength(0);
    }
  });

  it('keeps no event-handler attribute and no javascript: URL anywhere', () => {
    for (const el of doc.querySelectorAll('*')) {
      for (const attr of el.attributes) {
        expect(attr.name.startsWith('on'), `${el.tagName} ${attr.name}`).toBe(false);
        expect(attr.value.toLowerCase().includes('javascript:'), `${el.tagName} ${attr.name}`).toBe(false);
      }
    }
  });

  it('strips form actions, targets, pings, srcdoc and autofocus', () => {
    for (const name of ['action', 'formaction', 'target', 'ping', 'srcdoc', 'autofocus']) {
      expect(doc.querySelectorAll(`[${name}]`), name).toHaveLength(0);
    }
  });

  it('reports that the page carried script, and that a plain page did not (FR-081)', () => {
    expect(page.scriptsRemoved).toBe(true);
    expect(sanitiseHtmlPage('<p>plain</p>', { panelId: 'p', docPath: DOC, projectRoot: ROOT }).scriptsRemoved).toBe(false);
  });
});

describe('the frame policy (FR-075, FR-076)', () => {
  it('injects the frame CSP as the very first element of the head, and keeps no page meta', () => {
    const first = doc.head.firstElementChild;
    expect(first?.tagName).toBe('META');
    expect(first?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(first?.getAttribute('content')).toBe(FRAME_CSP);
    expect(doc.querySelectorAll('meta')).toHaveLength(1);
  });

  it("allows nothing but the preview protocol and the page's own inline style", () => {
    expect(FRAME_CSP).toBe(
      "default-src 'none'; img-src throng-preview:; style-src 'unsafe-inline' throng-preview:; font-src throng-preview:; media-src throng-preview:",
    );
  });
});

describe('resources load from the project through the asset route, and nothing else does (FR-072, FR-073, FR-075)', () => {
  it('rewrites a relative image against the document folder', () => {
    expect(doc.querySelector('img[alt="logo"]')?.getAttribute('src')).toBe(`${ASSET}site/pages/img/logo.png`);
  });

  it('drops a remote, a data: and an outside-the-project image source', () => {
    for (const alt of ['remote', 'data', 'outside']) {
      expect(doc.querySelector(`img[alt="${alt}"]`)?.hasAttribute('src'), alt).toBe(false);
    }
  });

  it('keeps only the local srcset candidates, rewritten', () => {
    expect(doc.querySelector('img[alt="srcset"]')?.getAttribute('srcset')).toBe(`${ASSET}site/pages/img/small.png 1x`);
  });

  it('keeps a relative stylesheet, rewritten, and no other link at all', () => {
    expect([...doc.querySelectorAll('link')].map((l) => [l.getAttribute('rel'), l.getAttribute('href')])).toEqual([
      ['stylesheet', `${ASSET}site/pages/hostile-style.css`],
    ]);
  });

  it('rewrites url() and @import in a style element and drops the remote ones', () => {
    expect(styles()).toContain(`url("${ASSET}site/pages/img/local-bg.png")`);
    expect(styles()).toContain(`@import url("${ASSET}site/pages/local-import.css")`);
    expect(styles()).not.toContain('evil.test');
  });

  it('drops a remote url() from a style attribute', () => {
    expect(doc.body.querySelector('p')?.getAttribute('style') ?? '').not.toContain('evil.test');
  });

  it('keeps no remote reference anywhere but in a link the reader may choose to follow', () => {
    const copy = doc.documentElement.cloneNode(true) as HTMLElement;
    for (const anchor of copy.querySelectorAll('a')) anchor.remove();
    expect(copy.outerHTML).not.toContain('evil.test');
  });
});

describe('links follow only by the gesture (FR-079)', () => {
  const follow = (href: string): string => `throng-preview://follow/panel-1?href=${encodeURIComponent(href)}`;

  // 074 convergence T067 — titled as every preview titles a link: what following it does, under the platform's modifier.
  it('points every non-fragment link at the follow route, titled as every preview titles a link', () => {
    expect(link('External link')?.getAttribute('href')).toBe(follow('https://example.test/page'));
    expect(link('External link')?.getAttribute('title')).toBe(
      previewLinkHoverText({ kind: 'external', url: 'https://example.test/page' }, primaryModifierLabel()),
    );
    expect(link('Relative link')?.getAttribute('href')).toBe(follow('other.html#part'));
  });

  // 074 convergence T061 — the body follows it on the gesture only (`frame-fragments.ts`); the sanitiser titles it.
  it('keeps a same-document fragment link as a fragment, titled with the gesture', () => {
    expect(link('Fragment link')?.getAttribute('href')).toBe('#top');
    expect(link('Fragment link')?.getAttribute('title')).toBe(
      previewLinkHoverText({ kind: 'heading', fragment: 'top' }, primaryModifierLabel()),
    );
  });

  it('leaves a javascript: link with no href at all', () => {
    expect(link('JavaScript link')?.hasAttribute('href')).toBe(false);
  });
});

// 074 convergence T072 — FR-072 / FR-093a: the legacy `background` attribute is an image resource like any other: a
// relative one loads from the project, a remote one is left out and listed.
describe('a background attribute is resolved as an image (FR-072, FR-093a)', () => {
  const legacy = sanitiseHtmlPage(
    '<body background="img/bg.png"><table background="https://remote.example/t.png"><tr><td>x</td></tr></table></body>',
    { panelId: 'panel-1', docPath: DOC, projectRoot: ROOT },
  );
  const legacyDoc = new DOMParser().parseFromString(legacy.html, 'text/html');

  it('points a relative background at the project’s asset route', () => {
    const value = legacyDoc.body.getAttribute('background') ?? '';
    expect(value.startsWith(ASSET)).toBe(true);
    expect(value).toContain('bg.png');
  });

  it('leaves a remote background out, and lists it as a blocked image', () => {
    expect(legacyDoc.querySelector('table')!.hasAttribute('background')).toBe(false);
    expect(legacy.blocked).toContainEqual(expect.objectContaining({ url: 'https://remote.example/t.png', kind: 'image' }));
  });
});

describe('the themed defaults (FR-082)', () => {
  it('sets a background and text colour at zero specificity, so any page rule wins', () => {
    expect(styles()).toContain(':where(html) { background: rgb(1, 2, 3); color: rgb(4, 5, 6); }');
  });
});
