import { describe, expect, it } from 'vitest';
import { createMarkdownRenderer } from '../../src/renderer/preview/providers/markdown/markdown-renderer.js';

/**
 * 047 T061/T063 — a wikilink through the REAL pipeline AND the real sanitiser (not the spy
 * `markdown-pipeline-wikilinks.test.ts` uses), the same way `preview-sanitise.test.ts` proves an
 * ordinary link survives DOMPurify's `ALLOWED_URI_REGEXP`. jsdom, because DOMPurify needs a DOM.
 */
const ENV = { panelId: 'pv', docPath: 'D:/proj/docs/note.md', projectRoot: 'D:/proj', remoteImages: false };

function render(text: string): DocumentFragment {
  return createMarkdownRenderer().render(text, ENV).fragment;
}

describe('a wikilink survives the real sanitiser and carries data-throng-link (R12, FR-051)', () => {
  it('[[Note]] becomes a followable <a> classified as a file, with a data-throng-wiki-index', () => {
    const fragment = render('[[Note]]');
    const a = fragment.querySelector('a');
    expect(a).not.toBeNull();
    expect(a?.getAttribute('href')).toBeNull(); // onLink always removes it (existing convention)
    const link = JSON.parse(a?.getAttribute('data-throng-link') ?? 'null');
    expect(link?.kind).toBe('file');
    expect(link?.absPath).toBe('D:/proj/docs/Note.md');
    expect(a?.getAttribute('data-throng-wiki-index')).toBe('0');
    expect(a?.textContent).toBe('Note');
  });

  it('[[/docs/README]] resolves rooted from the project root', () => {
    const fragment = render('[[/docs/README]]');
    const link = JSON.parse(fragment.querySelector('a')?.getAttribute('data-throng-link') ?? 'null');
    expect(link?.kind).toBe('file');
    expect(link?.absPath).toBe('D:/proj/docs/README.md');
  });

  it('[[../outside]] escaping the project classifies as outside (FR-054)', () => {
    const fragment = render('[[../../outside]]');
    const link = JSON.parse(fragment.querySelector('a')?.getAttribute('data-throng-link') ?? 'null');
    expect(link?.kind).toBe('outside');
  });

  it('two wikilinks in one document get distinct, ordered indices', () => {
    const fragment = render('[[One]] and [[Two]]');
    const indices = [...fragment.querySelectorAll('[data-throng-wiki-index]')].map((el) =>
      el.getAttribute('data-throng-wiki-index'),
    );
    expect(indices).toEqual(['0', '1']);
  });
});
