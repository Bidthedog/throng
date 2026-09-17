/**
 * 044 T087 — images through the REAL pipeline and the REAL sanitiser's image hook (FR-084, FR-092,
 * FR-093), and the heading hook on `hostile.md` (FR-090b, FR-090e; contracts/security-policy.md Layer 2).
 *
 * jsdom, because DOMPurify needs a DOM. Nothing here can observe a network request — that is the CSP and
 * the request filter, in the real engine (T163). What it CAN see is the `src` every image is left with:
 * an image with no `src`, or one on `throng-preview:`, cannot be what makes a request anywhere else.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMarkdownRenderer } from '../../src/renderer/preview/providers/markdown/markdown-renderer.js';
import { MarkdownBody } from '../../src/renderer/preview/providers/markdown/markdown-body.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';
import { findHeading } from '../../src/renderer/preview/link-dom.js';
import { COLD, mountMarkdownPreview } from './helpers/mount-preview-panel.js';

const HOSTILE = resolve(process.cwd(), 'packages/ui/tests/fixtures/preview/hostile.md');
const ROOT = 'D:/proj';
const DOC = `${ROOT}/docs/guide.md`;

function renderImages(text: string, remoteImages = true): DocumentFragment {
  return createMarkdownRenderer().render(text, { panelId: 'pv-1', docPath: DOC, projectRoot: ROOT, remoteImages });
}

const img = (fragment: DocumentFragment): HTMLImageElement => {
  const found = fragment.querySelector('img');
  if (!found) throw new Error('no img in the fragment');
  return found;
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('a relative image resolves against the document and is served by throng-preview: (FR-084)', () => {
  it('beside the document → throng-preview://asset/<panelId>/<root-relative path>', () => {
    expect(img(renderImages('![diagram](diagram.png)')).getAttribute('src')).toBe(
      'throng-preview://asset/pv-1/docs/diagram.png',
    );
  });

  it('percent-encodes each path segment, and the panel id', () => {
    const out = createMarkdownRenderer().render('![a](<my pics/a b.png>)', {
      panelId: 'pv 1',
      docPath: DOC,
      projectRoot: ROOT,
      remoteImages: true,
    });
    expect(img(out).getAttribute('src')).toBe('throng-preview://asset/pv%201/docs/my%20pics/a%20b.png');
  });

  it('a root-relative path is relative to the PROJECT root', () => {
    expect(img(renderImages('![logo](/assets/logo.png)')).getAttribute('src')).toBe(
      'throng-preview://asset/pv-1/assets/logo.png',
    );
  });

  it('`../../outside.png` escapes the project → no src, alt kept, marked for the alt fallback', () => {
    const image = img(renderImages('![outside](../../outside.png)'));
    expect(image.hasAttribute('src')).toBe(false);
    expect(image.getAttribute('alt')).toBe('outside');
    expect(image.hasAttribute('data-throng-alt')).toBe(true);
  });
});

describe('an https: image loads only while Load remote images is on (FR-092)', () => {
  const badge = '![Build status](https://img.shields.io/badge/build-passing-brightgreen)';

  it('on → the badge keeps its https: src', () => {
    expect(img(renderImages(badge, true)).getAttribute('src')).toBe(
      'https://img.shields.io/badge/build-passing-brightgreen',
    );
  });

  it('off → no src, the alt text kept', () => {
    const image = img(renderImages(badge, false));
    expect(image.hasAttribute('src')).toBe(false);
    expect(image.getAttribute('alt')).toBe('Build status');
    expect(image.hasAttribute('data-throng-alt')).toBe(true);
  });

  it('remote-images.md with the setting off leaves no https: src anywhere', () => {
    const text = readFileSync(resolve(process.cwd(), 'packages/ui/tests/fixtures/preview/remote-images.md'), 'utf8');
    const fragment = renderImages(text, false);
    for (const el of fragment.querySelectorAll('[src]')) {
      expect(el.getAttribute('src')).not.toMatch(/^https:/i);
    }
    // The relative image is still the project's own.
    expect([...fragment.querySelectorAll('img[src]')].map((i) => i.getAttribute('src'))).toEqual([
      'throng-preview://asset/pv-1/docs/image.png',
    ]);
  });
});

describe('every other image source is removed, whatever the setting (FR-093)', () => {
  it.each([
    ['http:', '<img src="http://example.com/a.png" alt="h">'],
    ['file:', '<img src="file:///C:/Windows/win.ini" alt="f">'],
    ['a network path', '<img src="//host/x.png" alt="n">'],
    ['javascript:', '<img src="javascript:alert(1)" alt="j">'],
  ])('%s → no src', (_name, raw) => {
    for (const remoteImages of [true, false]) {
      const image = img(renderImages(raw, remoteImages));
      expect(image.hasAttribute('src'), `remoteImages=${remoteImages}`).toBe(false);
      expect(image.hasAttribute('data-throng-alt')).toBe(true);
    }
  });
});

describe('an image that cannot load shows its alt text (FR-084)', () => {
  const props = (text: string): PreviewBodyProps => ({
    panelId: 'pv-1',
    content: { kind: 'text', text },
    filePath: DOC,
    projectRoot: ROOT,
    providerSettings: { enabled: true, loadRemoteImages: true },
    initialViewState: undefined,
    onViewStateCapture: () => {},
    onFollow: () => {},
    onNotice: () => {},
    onDrawn: () => {},
    onBodyFailure: () => {},
  });

  it('replaces an image whose load fails with its alternative text', async () => {
    render(createElement(MarkdownBody, props('![A diagram](missing.png)')));
    const host = screen.getByTestId('preview-markdown-pv-1');
    const image = await waitFor(() => {
      const found = host.querySelector('img');
      expect(found).not.toBeNull();
      return found!;
    }, COLD);

    fireEvent.error(image);

    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('A diagram');
  });

  it('shows a BLOCKED image as its alternative text at once, with nothing to load', async () => {
    render(createElement(MarkdownBody, props('![Outside](../../../outside.png)')));
    const host = screen.getByTestId('preview-markdown-pv-1');
    await waitFor(() => expect(host.textContent).toContain('Outside'), COLD);
    expect(host.querySelector('img')).toBeNull();
  });
});

/*
 * Iteration 2026-09-15, FR-120 (T196) — an image's tooltip names its source AS WRITTEN, then the document's own
 * title. Never the live `src`: a project image's is `throng-preview://asset/<panelId>/…`, which would expose
 * the internal scheme and the panel id. An image shown as its alternative text carries the same tooltip on
 * the span. An image inside a followable link carries none, so the link's own title shows (security I3).
 */
describe('an image’s tooltip is its source as written, then its title (FR-120)', () => {
  const RLO = String.fromCharCode(0x202e);
  const LRI = String.fromCharCode(0x2066);

  const bodyProps = (text: string, loadRemoteImages = true): PreviewBodyProps => ({
    panelId: 'pv-1',
    content: { kind: 'text', text },
    filePath: DOC,
    projectRoot: ROOT,
    providerSettings: { enabled: true, loadRemoteImages },
    initialViewState: undefined,
    onViewStateCapture: () => {},
    onFollow: () => {},
    onNotice: () => {},
    onDrawn: () => {},
    onBodyFailure: () => {},
  });

  /** The alternative-text span a blocked or failed image became, once the body has drawn. */
  async function altSpan(text: string, loadRemoteImages = true): Promise<HTMLElement> {
    render(createElement(MarkdownBody, bodyProps(text, loadRemoteImages)));
    const host = screen.getByTestId('preview-markdown-pv-1');
    return waitFor(() => {
      const span = host.querySelector<HTMLElement>('.preview-markdown__alt');
      expect(span).not.toBeNull();
      return span!;
    }, COLD);
  }

  it('a project image: the path as written, never the throng-preview: src', () => {
    const image = img(renderImages('![](image.png)'));
    expect(image.getAttribute('src')).toMatch(/^throng-preview:/);
    expect(image.getAttribute('title')).toBe('image.png');
    expect(image.getAttribute('title')).not.toContain('throng-preview');
    expect(image.getAttribute('title')).not.toContain('pv-1');
  });

  it('an authored title follows the source', () => {
    expect(img(renderImages('![](image.png "Diagram")')).getAttribute('title')).toBe('image.png — Diagram');
  });

  it('a remote https: image, setting on: its URL', () => {
    expect(img(renderImages('![b](https://img.example/b.svg)', true)).getAttribute('title')).toBe('https://img.example/b.svg');
  });

  it('a blocked http: image: its alternative-text span carries the same tooltip', async () => {
    const span = await altSpan('![h](http://example.com/a.png "Old")');
    expect(span.textContent).toBe('h');
    expect(span.getAttribute('title')).toBe('http://example.com/a.png — Old');
  });

  it('an https: image with Load remote images off: the same', async () => {
    expect(img(renderImages('![b](https://img.example/b.svg)', false)).getAttribute('title')).toBe('https://img.example/b.svg');
    const span = await altSpan('![b](https://img.example/b.svg)', false);
    expect(span.getAttribute('title')).toBe('https://img.example/b.svg');
  });

  it('an image inside a followable link has no title, and the link keeps its generated one (I3)', () => {
    const fragment = renderImages('[![](a.png "x")](https://real/)');
    const image = img(fragment);
    expect(image.hasAttribute('title')).toBe(false);
    expect(fragment.querySelector('[data-throng-link]')?.getAttribute('title')).toBe('https://real/ — Ctrl+click to follow');
  });

  it('strips bidi controls from the source and the title', () => {
    const title = img(renderImages(`<img src="docs/${RLO}gnp.exe.png" alt="a" title="A ${LRI}title">`)).getAttribute('title') ?? '';
    expect(title).toBe('docs/gnp.exe.png — A title');
    expect(title.includes(RLO) || title.includes(LRI)).toBe(false);
  });

  it('an image whose error fires becomes an alternative-text span carrying its tooltip', async () => {
    render(createElement(MarkdownBody, bodyProps('![A diagram](missing.png "Missing")')));
    const host = screen.getByTestId('preview-markdown-pv-1');
    const image = await waitFor(() => {
      const found = host.querySelector('img');
      expect(found).not.toBeNull();
      return found!;
    }, COLD);

    fireEvent.error(image);

    const span = host.querySelector('.preview-markdown__alt');
    expect(span?.textContent).toBe('A diagram');
    expect(span?.getAttribute('title')).toBe('missing.png — Missing');
  });
});

describe('the heading hook: only the pipeline plants a fragment target (FR-090b, FR-090e)', () => {
  const hostile = (): DocumentFragment => renderImages(readFileSync(HOSTILE, 'utf8'));

  it('strips data-heading-slug from the raw <h2 data-heading-slug="spoof">', () => {
    const fragment = hostile();
    const spoof = [...fragment.querySelectorAll('h2')].find((h) => h.textContent === 'Spoofed heading slug');
    expect(spoof).toBeDefined();
    expect(spoof!.hasAttribute('data-heading-slug')).toBe(false);
    expect(fragment.querySelector('[data-heading-slug="spoof"]')).toBeNull();
  });

  it('keeps the slug on a heading the pipeline generated', () => {
    expect(hostile().querySelector('h1')?.getAttribute('data-heading-slug')).toBe('hostile-fixture');
  });

  it('refuses a raw heading claiming a real heading line with a different slug', () => {
    const fragment = renderImages('# Real\n\n<h2 data-source-line="0" data-heading-slug="other">x</h2>');
    expect(fragment.querySelector('[data-heading-slug="other"]')).toBeNull();
    expect(fragment.querySelector('h1')?.getAttribute('data-heading-slug')).toBe('real');
  });

  it('removes data-heading-slug from any element that is not a heading', () => {
    const fragment = renderImages('# Real\n\n<p data-source-line="0" data-heading-slug="real">x</p>');
    expect(fragment.querySelectorAll('[data-heading-slug]')).toHaveLength(1);
  });

  it('finds no heading for #spoof, so following it raises link-missing-heading', async () => {
    expect(findHeading(hostile(), 'spoof')).toBeNull();

    const m = await mountMarkdownPreview(`${readFileSync(HOSTILE, 'utf8')}\n\n[to the spoof](#spoof)\n`);
    try {
      const link = await screen.findByText('to the spoof', {}, COLD);
      fireEvent.click(link, { ctrlKey: true });
      const notice = await screen.findByTestId(`preview-link-notice-${m.id}`);
      expect(notice.getAttribute('data-notice-kind')).toBe('link-missing-heading');
      expect(notice.textContent).toContain('spoof');
    } finally {
      m.unmount();
    }
  });
});
