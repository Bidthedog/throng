import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createMarkdownRenderer } from '../../src/renderer/preview/providers/markdown/markdown-renderer.js';

/**
 * The hostile fixture through the REAL pipeline and the REAL sanitiser (044 T046, FR-081, FR-082,
 * SC-004 renderer half, contracts/security-policy.md Layer 2).
 *
 * jsdom, because DOMPurify needs a DOM: it parses with the document's own parser, which is the whole
 * reason it was chosen over a string sanitiser (research R2).
 *
 * What this layer cannot see, and so does not claim: whether anything EXECUTES or makes a REQUEST. That
 * is the CSP and the main-process filter, proven in the real engine by `preview-hostile.e2e.ts`. What it
 * can see is that nothing script-bearing, frame-like, form-like or clobbering is left in the fragment.
 *
 * The fixture is read from disk, not inlined, so the vectors asserted here are the ones the E2E renders.
 * Resolved from the working directory: under jsdom `import.meta.url` is an `http:` URL.
 */
const HOSTILE = resolve(process.cwd(), 'packages/ui/tests/fixtures/preview/hostile.md');
const HOSTILE_ENV = { panelId: 'pv-hostile', docPath: 'D:/proj/docs/hostile.md', projectRoot: 'D:/proj', remoteImages: true };

/** The production wiring: the pipeline bound to the real sanitiser, exactly as the panel gets it. */
function render(text: string): DocumentFragment {
  return createMarkdownRenderer().render(text);
}

function elements(fragment: DocumentFragment): Element[] {
  return [...fragment.querySelectorAll('*')];
}

describe('hostile.md through the pipeline and the sanitiser (FR-081, FR-082, SC-004)', () => {
  let fragment: DocumentFragment;
  let all: Element[];

  beforeAll(() => {
    const text = readFileSync(HOSTILE, 'utf8');
    // A guard on the guard: if the fixture lost its vectors, every negative below would pass vacuously.
    const vectors = [
      '<script>',
      'onerror=',
      '<iframe',
      '<form name="throng">',
      '<div id="throng">',
      '<mark>',
      '<text>svgtext</text>',
      'aria-hidden="true"',
      'aria-label=',
      '<input type="image" src="//host/x">',
      '<video><img src="//host/y"></video>',
    ];
    for (const vector of vectors) {
      expect(text).toContain(vector);
    }
    // With a real document, project and remote images ON — the production path, where the image and link
    // hooks actually resolve rather than failing closed for want of an environment (fix round 1, item 2).
    fragment = createMarkdownRenderer().render(text, HOSTILE_ENV);
    all = elements(fragment);
  });

  it('returns a DocumentFragment with content', () => {
    expect(fragment).toBeInstanceOf(DocumentFragment);
    expect(all.length).toBeGreaterThan(0);
  });

  it('leaves no script, frame, form, object, embed, link, meta, base or style element', () => {
    const forbidden = ['script', 'iframe', 'frame', 'form', 'object', 'embed', 'link', 'meta', 'base', 'style'];
    for (const tag of forbidden) {
      expect(fragment.querySelectorAll(tag), tag).toHaveLength(0);
    }
    // Not in the allowlist either, and each of them is a request or a script host.
    for (const tag of ['svg', 'video', 'audio', 'template', 'noscript', 'math']) {
      expect(fragment.querySelectorAll(tag), tag).toHaveLength(0);
    }
  });

  it('drops the content of a script, style and svg along with the element', () => {
    const text = fragment.textContent ?? '';
    expect(text).not.toContain("alert('script')");
    expect(text).not.toContain('@import');
    expect(text).not.toContain('svgtext');
  });

  it("drops a video's content, keeping DOMPurify's default forbid-contents list", () => {
    // `<video><img src="//host/y"></video>`: a network-path reference has no colon, so the URI regexp
    // admits it. Only `video` staying on the default FORBID_CONTENTS list keeps this img out.
    for (const el of fragment.querySelectorAll('[src]')) {
      expect(el.getAttribute('src'), el.outerHTML).not.toMatch(/^\/\/host\/y/);
    }
  });

  it('leaves no aria-* attribute, so a document cannot relabel or hide content from assistive tech', () => {
    for (const el of all) {
      for (const { name } of [...el.attributes]) {
        expect(name.toLowerCase().startsWith('aria-'), `${el.tagName} ${name}`).toBe(false);
      }
    }
    // The text of the relabelled and hidden elements is ordinary content and stays.
    expect(fragment.textContent).toContain('aria-hidden paragraph');
    expect(fragment.textContent).toContain('aria-label span');
  });

  it('removes every input that is not a checkbox — the image input with a network-path src included (T096)', () => {
    // `<input type="image" src="//host/x">` survives the PROFILE: input is allowlisted for task
    // checkboxes, and `//host/x` has no colon for the URI regexp to refuse. Only the input hook stops it.
    for (const input of fragment.querySelectorAll('input')) {
      expect(input.getAttribute('type'), input.outerHTML).toBe('checkbox');
    }
    expect(fragment.querySelector('input[type="image"]')).toBeNull();
    expect(fragment.querySelector('input[type="text"]')).toBeNull();
    for (const el of fragment.querySelectorAll('[src]')) {
      expect(el.getAttribute('src'), el.outerHTML).not.toMatch(/^\/\/host\//);
    }
  });

  it('strips the spoofed data-heading-slug from the raw <h2> (T096 heading hook)', () => {
    const spoof = [...fragment.querySelectorAll('h2')].find((h) => h.textContent === 'Spoofed heading slug');
    expect(spoof).toBeDefined();
    expect(spoof!.hasAttribute('data-heading-slug')).toBe(false);
    expect(fragment.querySelector('[data-heading-slug="spoof"]')).toBeNull();
  });

  it('leaves the http: image with no src (T096 image hook)', () => {
    const img = [...fragment.querySelectorAll('img')].find((i) => i.getAttribute('alt') === 'no-https remote image');
    expect(img).toBeDefined();
    expect(img!.hasAttribute('src')).toBe(false);
  });

  it('leaves no attribute starting "on", and no style attribute', () => {
    for (const el of all) {
      for (const { name } of [...el.attributes]) {
        expect(name.toLowerCase().startsWith('on'), `${el.tagName} ${name}`).toBe(false);
        expect(name.toLowerCase(), el.tagName).not.toBe('style');
      }
    }
  });

  it('leaves no href attribute at all — links are classified by a hook, never carried (R6)', () => {
    expect(fragment.querySelectorAll('[href]')).toHaveLength(0);
  });

  it('leaves every surviving src on throng-preview://asset/ — hostile.md holds no https: image (fix round 1, item 2)', () => {
    const sources = [...fragment.querySelectorAll('[src]')].map((el) => el.getAttribute('src') ?? '');
    // Positive control: `<img src="x" onerror=…>` is a relative image and must have resolved.
    expect(sources).toContain('throng-preview://asset/pv-hostile/docs/x');
    for (const src of sources) {
      expect(src.startsWith('throng-preview://asset/pv-hostile/') || /^https:\/\//.test(src), src).toBe(true);
    }
    expect(sources.filter((s) => s.startsWith('https:'))).toEqual([]);
  });

  it('classifies every followable link to an allowed kind (fix round 1, item 2)', () => {
    for (const el of fragment.querySelectorAll('[data-throng-link]')) {
      const link = JSON.parse(el.getAttribute('data-throng-link') ?? 'null') as { kind: string; url?: string; absPath?: string };
      expect(['external', 'file', 'heading', 'outside'], el.outerHTML).toContain(link.kind);
      if (link.kind === 'external') expect(link.url, el.outerHTML).toMatch(/^(https?:|mailto:)/i);
      if (link.kind === 'file') expect(link.absPath?.startsWith('D:/proj/'), el.outerHTML).toBe(true);
    }
    // Every <a> left is either followable or inert — and an inert one carries nothing to follow with.
    for (const a of fragment.querySelectorAll('a:not([data-throng-link])')) {
      expect(a.hasAttribute('tabindex') || a.hasAttribute('role') || a.hasAttribute('href'), a.outerHTML).toBe(false);
    }
  });

  it('leaves no src beginning javascript:, data: or file:', () => {
    for (const el of fragment.querySelectorAll('[src]')) {
      const src = (el.getAttribute('src') ?? '').trim().toLowerCase();
      expect(src, el.outerHTML).not.toMatch(/^(?:javascript|data|file):/);
    }
  });

  it('leaves no element carrying an id or a name, so the clobbering attempts have nothing left', () => {
    expect(fragment.querySelectorAll('[id]')).toHaveLength(0);
    expect(fragment.querySelectorAll('[name]')).toHaveLength(0);
    // The clobbering elements' TEXT is harmless and kept; only the handles are gone.
    expect(fragment.textContent).toContain('DOM-clobbering attempt via a raw id');
  });

  it('removes the mark element and keeps its text (FR-083)', () => {
    expect(fragment.querySelectorAll('mark')).toHaveLength(0);
    expect(fragment.textContent).toContain('kept text');
  });

  it('keeps an img from the fixture, without its onerror', () => {
    const imgs = fragment.querySelectorAll('img');
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) expect(img.hasAttribute('onerror')).toBe(false);
  });

  it('carries only allowlisted data attributes, plus the two the hooks set themselves', () => {
    // The four the profile admits from the pipeline, and the hooks' own `data-throng-link` (a followable
    // link's classification) and `data-throng-alt` (a blocked image) — set after sanitising, never read
    // from the document.
    const allowed = new Set([
      'data-source-line',
      'data-lang',
      'data-align',
      'data-heading-slug',
      'data-throng-link',
      'data-throng-alt',
    ]);
    for (const el of all) {
      for (const { name } of [...el.attributes]) {
        if (name.startsWith('data-')) expect(allowed.has(name), `${el.tagName} ${name}`).toBe(true);
      }
    }
  });
});

describe("FR-081's inline HTML floor survives sanitising", () => {
  it('keeps details, summary, kbd, sub, sup, br and img', () => {
    const fragment = render(
      [
        '<details open><summary>More</summary>',
        '',
        'Press <kbd>Ctrl</kbd>+<kbd>S</kbd>, H<sub>2</sub>O, x<sup>2</sup>,<br>next line.',
        '',
        '<img src="diagram.png" alt="A diagram">',
        '',
        '</details>',
      ].join('\n'),
    );
    for (const tag of ['details', 'summary', 'kbd', 'sub', 'sup', 'br', 'img']) {
      expect(fragment.querySelectorAll(tag).length, tag).toBeGreaterThan(0);
    }
    expect(fragment.querySelector('details')?.hasAttribute('open')).toBe(true);
    expect(fragment.querySelector('img')?.getAttribute('alt')).toBe('A diagram');
  });

  it("keeps the pipeline's own attributes: data-source-line, data-heading-slug, data-lang, data-align", () => {
    const fragment = render('# Title\n\n| a |\n|--:|\n| 1 |\n\n```ts\nx\n```');
    expect(fragment.querySelector('h1')?.getAttribute('data-heading-slug')).toBe('title');
    expect(fragment.querySelector('h1')?.getAttribute('data-source-line')).toBe('0');
    expect(fragment.querySelector('th')?.getAttribute('data-align')).toBe('right');
    expect(fragment.querySelector('pre > code')?.getAttribute('data-lang')).toBe('ts');
  });

  it('keeps data-lang for an info string with a colon suffix, as `ts:line-numbers`', () => {
    // DOMPurify runs every non-URI-safe attribute value through ALLOWED_URI_REGEXP, and `[^:]*$`
    // refuses a colon — so `data-lang="ts:line-numbers"` would be removed outright, not shortened.
    const code = render('```ts:line-numbers\nconst x = 1;\n```').querySelector('pre > code');
    expect(code?.getAttribute('data-lang')).toBe('ts');
  });
});

describe('what a document cannot plant through the hooks (T096)', () => {
  it('forces disabled on a raw checkbox the document left enabled', () => {
    const input = render('<input type="checkbox" checked>').querySelector('input');
    expect(input?.hasAttribute('disabled')).toBe(true);
    expect(input?.hasAttribute('checked')).toBe(true);
  });

  it('removes an input with no type at all (a text box by default)', () => {
    expect(render('<input value="x">').querySelector('input')).toBeNull();
  });

  it('never honours a data-throng-link, role or tabindex the document wrote itself', () => {
    const fragment = render(
      [
        '<span data-throng-link=\'{"kind":"external","url":"https://evil.example/"}\' role="link" tabindex="0">span</span>',
        '<a data-throng-link=\'{"kind":"external","url":"https://evil.example/"}\'>no href</a>',
      ].join('\n\n'),
    );
    expect(fragment.querySelectorAll('[data-throng-link]')).toHaveLength(0);
    expect(fragment.querySelectorAll('[role]')).toHaveLength(0);
    expect(fragment.querySelectorAll('[tabindex]')).toHaveLength(0);
  });
});

describe('fix round 1 — the heading nonce and the hooks’ single registration (items 6, 9)', () => {
  const ENV = { panelId: 'pv', docPath: 'D:/proj/README.md', projectRoot: 'D:/proj', remoteImages: true };

  it('a raw heading BEFORE the real one cannot claim the real heading’s line and slug', () => {
    const fragment = createMarkdownRenderer().render(
      '<h2 data-source-line="2" data-heading-slug="real">spoof</h2>\n\n# Real\n',
      ENV,
    );
    const spoof = [...fragment.querySelectorAll('h2')].find((h) => h.textContent === 'spoof');
    expect(spoof?.hasAttribute('data-heading-slug')).toBe(false);
    expect(fragment.querySelector('h1')?.getAttribute('data-heading-slug')).toBe('real');
    expect(fragment.querySelectorAll('[data-heading-slug="real"]')).toHaveLength(1);
  });

  it('the pipeline’s verification attribute never reaches the DOM', () => {
    const fragment = createMarkdownRenderer().render('# One\n\n## Two\n', ENV);
    for (const el of fragment.querySelectorAll('*')) {
      for (const { name } of [...el.attributes]) expect(name, el.outerHTML).not.toMatch(/nonce/i);
    }
    expect(fragment.querySelectorAll('[data-heading-slug]')).toHaveLength(2);
  });

  it('rendering twice with ONE renderer leaves the link hook’s output intact — the hooks are added once', () => {
    const renderer = createMarkdownRenderer();
    const text = '# T\n\n[Site](https://example.com/)\n';
    renderer.render(text, ENV);
    const second = renderer.render(text, ENV);
    const a = second.querySelector('a');
    expect(a?.getAttribute('title')).toBe('https://example.com/');
    expect(a?.getAttribute('data-throng-link')).toBe('{"kind":"external","url":"https://example.com/"}');
  });
});

/*
 * Adversarial review (security) I3. Chromium shows the tooltip of the INNERMOST element that has a title, so
 * a title on anything inside a followable link replaces the link's own while the pointer is over it — and
 * Ctrl+click still follows the real target. The link's title is the only one a reader may see over a link.
 *
 * FR-169a sharpened this rather than changing it. A title is now the bare target address, so a forged one
 * is indistinguishable from a real one by shape alone — there is no "— Ctrl+Click to…" suffix left for a
 * reader to notice is missing. The decoy below is spelled in the new form for exactly that reason.
 */
describe('nothing inside a followable link can show a title of its own (adversarial review I3)', () => {
  const ENV = { panelId: 'pv', docPath: 'D:/proj/README.md', projectRoot: 'D:/proj', remoteImages: true };
  const FORGED = 'https://safe.example/';

  function titlesInsideLinks(fragment: DocumentFragment): string[] {
    return [...fragment.querySelectorAll('[data-throng-link] [title]')].map((el) => el.outerHTML);
  }

  it.each([
    ['an image title inside a Markdown link', `[![logo](logo.png "${FORGED}")](https://evil.example/)`],
    ['a raw span title inside a raw link', `<a href="https://evil.example/"><span title="${FORGED}">click</span></a>`],
    ['a raw title nested two deep', `<a href="https://evil.example/"><em><span title="${FORGED}">click</span></em></a>`],
  ])('%s', (_name, text) => {
    const fragment = createMarkdownRenderer().render(text, ENV);
    const link = fragment.querySelector('[data-throng-link]');
    // Positive control: the link really is followable, and its own title names the real target.
    expect(link).not.toBeNull();
    expect(link!.getAttribute('title')).toBe('https://evil.example/');
    expect(link!.children.length).toBeGreaterThan(0);
    expect(titlesInsideLinks(fragment)).toEqual([]);
    expect(fragment.querySelectorAll(`[title="${FORGED}"]`)).toHaveLength(0);
  });

  // Amended for FR-120 (iteration 2026-09-15): the authored title is kept, after the source as written.
  it('an image title OUTSIDE any link is the document’s own tooltip and is kept, after the image’s source', () => {
    const fragment = createMarkdownRenderer().render('![logo](logo.png "The logo")', ENV);
    expect(fragment.querySelector('img')?.getAttribute('title')).toBe('logo.png — The logo');
  });
});

describe('an image src the URL filter must refuse, written as raw HTML', () => {
  /*
   * Not in hostile.md, which has only a `data:` LINK and a markdown `file:` image (and markdown-it
   * itself refuses to make an <img> of the latter). Raw HTML reaches the sanitiser verbatim, so these
   * are the cases where the profile — not markdown-it — is the only thing in the way.
   */
  it.each([
    ['javascript:', '<img src="javascript:alert(1)" alt="j">'],
    ['data:', '<img src="data:image/svg+xml,&lt;svg onload=alert(1)&gt;" alt="d">'],
    ['file:', '<img src="file:///C:/Windows/win.ini" alt="f">'],
  ])('removes a %s src from an img', (_scheme, raw) => {
    const img = render(raw).querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.hasAttribute('src')).toBe(false);
  });
});
