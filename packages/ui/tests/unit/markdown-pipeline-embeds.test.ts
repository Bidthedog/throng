/**
 * 054 — Mermaid file embeds in the Markdown pipeline (manual test decision, 2026-10-11): `![[x.mmd]]` and
 * `![alt](x.mmd)` become an embed placeholder; every normal link and image keeps its meaning.
 */
import { describe, expect, it, vi } from 'vitest';
import { createMarkdownPipeline, type PipelineContext } from '../../src/renderer/preview/providers/markdown/pipeline.js';

function html(text: string): string {
  const sanitise = vi.fn((out: string, _context: PipelineContext) => out);
  return createMarkdownPipeline(sanitise).render(text).fragment;
}

const embedOf = (out: string): string | null => /data-throng-embed="([^"]*)"/.exec(out)?.[1] ?? null;

describe('the two embed spellings', () => {
  it('![[flow.mmd]] is an embed placeholder', () => {
    expect(embedOf(html('![[flow.mmd]]'))).toBe('flow.mmd');
  });

  it('068 FR-013: only the ![[ ]] spelling carries the project-root fallback flag', () => {
    expect(html('![[flow.mmd]]')).toContain('data-throng-embed-wiki');
    expect(html('![flow](flow.mmd)')).not.toContain('data-throng-embed-wiki');
  });

  it('![[/docs/flow.mermaid]] keeps its project-rooted slash', () => {
    expect(embedOf(html('![[/docs/flow.mermaid]]'))).toBe(encodeURIComponent('/docs/flow.mermaid'));
  });

  it('![Order flow](diagrams/order flow.mmd) is a placeholder carrying the name as written, and its alt as the title', () => {
    const out = html('![Order flow](<diagrams/order flow.mmd>)');
    expect(embedOf(out)).toBe(encodeURIComponent('diagrams/order flow.mmd'));
    expect(out).toContain('title="Order flow"');
    expect(out).not.toContain('<img');
  });
});

// 068 FR-010 – FR-015 — `![[image.png]]` is an image, from the same vault-style reference.
describe('image embeds (068 US2)', () => {
  const imgOf = (out: string): { src: string | null; alt: string | null } => ({
    src: /<img[^>]*\ssrc="([^"]*)"/.exec(out)?.[1] ?? null,
    alt: /<img[^>]*\salt="([^"]*)"/.exec(out)?.[1] ?? null,
  });

  it('![[img.png]] renders an <img> with the file name as alt', () => {
    const out = html('![[img.png]]');
    expect(imgOf(out)).toEqual({ src: 'img.png', alt: 'img.png' });
    expect(embedOf(out)).toBeNull();
  });

  it('![[folder/pic.png|Alt text]] uses the alias as alt', () => {
    expect(imgOf(html('![[folder/pic.png|Alt text]]'))).toEqual({ src: 'folder/pic.png', alt: 'Alt text' });
  });

  // 068 FR-056 (supersedes FR-015) — Obsidian's size forms.
  const sizeOf = (out: string): { width: string | null; height: string | null } => ({
    width: /<img[^>]*\swidth="([^"]*)"/.exec(out)?.[1] ?? null,
    height: /<img[^>]*\sheight="([^"]*)"/.exec(out)?.[1] ?? null,
  });

  it('![[img.png|300]] draws 300 wide, and its alt text is the file name (FR-056)', () => {
    const out = html('![[img.png|300]]');
    expect(imgOf(out).alt).toBe('img.png');
    expect(sizeOf(out)).toEqual({ width: '300', height: null });
  });

  it('![[img.png|200x100]] draws 200 wide and 100 high', () => {
    const out = html('![[img.png|200x100]]');
    expect(imgOf(out).alt).toBe('img.png');
    expect(sizeOf(out)).toEqual({ width: '200', height: '100' });
  });

  it('![[img.png|Alt text|200]] keeps the alt text and draws 200 wide', () => {
    const out = html('![[img.png|Alt text|200]]');
    expect(imgOf(out).alt).toBe('Alt text');
    expect(sizeOf(out)).toEqual({ width: '200', height: null });
  });

  it('![[img.png|Alt text|big]] keeps the whole alias as alt text, with no size', () => {
    const out = html('![[img.png|Alt text|big]]');
    expect(imgOf(out).alt).toBe('Alt text|big');
    expect(sizeOf(out)).toEqual({ width: null, height: null });
  });

  it('![[img.png|0]] draws no size, and 0 is not the alt text', () => {
    const out = html('![[img.png|0]]');
    expect(imgOf(out).alt).toBe('img.png');
    expect(sizeOf(out)).toEqual({ width: null, height: null });
  });

  it('![[/folder/pic.png]] keeps the leading slash', () => {
    expect(imgOf(html('![[/folder/pic.png]]')).src).toBe('/folder/pic.png');
  });

  it('![[note.md]] and ![[a.pdf]] stay literal (FR-014)', () => {
    expect(html('![[note.md]]')).toContain('![[note.md]]');
    expect(html('![[a.pdf]]')).toContain('![[a.pdf]]');
    expect(html('![[a.pdf]]')).not.toContain('<img');
  });

  it('[[img.png]] stays a link', () => {
    const out = html('[[img.png]]');
    expect(out).not.toContain('<img');
    expect(out).toContain('data-throng-wiki-href');
  });

  it('![[flow.mmd]] is still the Mermaid placeholder', () => {
    expect(embedOf(html('![[flow.mmd]]'))).toBe('flow.mmd');
  });

  it('an embed inside inline code stays literal', () => {
    const out = html('`![[img.png]]`');
    expect(out).toContain('<code>![[img.png]]</code>');
    expect(out).not.toContain('<img');
  });
});

// FR-046m (manual test change request, 2026-10-13) — ![[flow.mmd|300]]: Obsidian's size slot is the box height.
describe('an embed’s height', () => {
  const heightOf = (out: string): string | null => /data-diagram-height="([^"]*)"/.exec(out)?.[1] ?? null;

  it('![[flow.mmd|300]] embeds flow.mmd with a 300px box', () => {
    const out = html('![[flow.mmd|300]]');
    expect(embedOf(out)).toBe('flow.mmd');
    expect(heightOf(out)).toBe('300');
  });

  it('a non-numeric alias is a title, not a height', () => {
    const out = html('![[flow.mmd|Order flow]]');
    expect(heightOf(out)).toBeNull();
    expect(out).toContain('title="Order flow"');
  });
});

describe('nothing else changes meaning', () => {
  it('[x](flow.mmd) stays a link', () => {
    const out = html('[x](flow.mmd)');
    expect(embedOf(out)).toBeNull();
    expect(out).toContain('<a href="flow.mmd">x</a>');
  });

  it('[[flow.mmd]] stays a wikilink', () => {
    const out = html('[[flow.mmd]]');
    expect(embedOf(out)).toBeNull();
    expect(out).toContain('data-throng-wiki-href="flow.mmd"');
  });

  it('![photo](photo.png) stays an image', () => {
    const out = html('![photo](photo.png)');
    expect(embedOf(out)).toBeNull();
    expect(out).toContain('<img src="photo.png" alt="photo">');
  });

  it('![[note.md]] stays literal text (047 FR-056)', () => {
    const out = html('![[note.md]]');
    expect(embedOf(out)).toBeNull();
    expect(out).toContain('![[note.md]]');
  });

  it('a remote ![x](https://example.com/flow.mmd) is not embedded', () => {
    const out = html('![x](https://example.com/flow.mmd)');
    expect(embedOf(out)).toBeNull();
  });
});

// 068 FR-066 — a STANDARD image takes the same size forms as an embed: a last |W or |WxH segment of its
// destination or of its alt text sizes it and is removed from whichever it was in.
describe('a standard image’s size (068 FR-066)', () => {
  const attr = (out: string, name: string): string | null => new RegExp(`<img[^>]*\\s${name}="([^"]*)"`).exec(out)?.[1] ?? null;
  const read = (text: string): Record<'src' | 'alt' | 'width' | 'height', string | null> => {
    const out = html(text);
    return { src: attr(out, 'src'), alt: attr(out, 'alt'), width: attr(out, 'width'), height: attr(out, 'height') };
  };

  it('![alt](path.png|200): drawn 200 wide, the size gone from the path', () => {
    expect(read('![embedded image](sample-documents/sample.png|200)')).toEqual({
      src: 'sample-documents/sample.png',
      alt: 'embedded image',
      width: '200',
      height: null,
    });
  });

  it('![alt|200](path.png): drawn 200 wide, the size gone from the alt text', () => {
    expect(read('![embedded image|200](sample-documents/sample.png)')).toEqual({
      src: 'sample-documents/sample.png',
      alt: 'embedded image',
      width: '200',
      height: null,
    });
  });

  it('|200x100 in either place: 200 by 100', () => {
    expect(read('![a](p.png|200x100)')).toMatchObject({ src: 'p.png', alt: 'a', width: '200', height: '100' });
    expect(read('![a|200x100](p.png)')).toMatchObject({ src: 'p.png', alt: 'a', width: '200', height: '100' });
  });

  it('a destination whose last segment is not a size is used as written', () => {
    expect(read('![a](p.png|big)')).toMatchObject({ src: 'p.png%7Cbig', alt: 'a', width: null, height: null });
  });

  it('an alt text whose last segment is not a size is used as written', () => {
    expect(read('![a|big](p.png)')).toMatchObject({ src: 'p.png', alt: 'a|big', width: null, height: null });
  });

  it('the size applies whatever the source: a remote image too', () => {
    expect(read('![a](https://example.com/p.png|200)')).toMatchObject({ src: 'https://example.com/p.png', width: '200' });
  });

  it('an image with no size carries no width or height (the control)', () => {
    expect(read('![a](p.png)')).toMatchObject({ src: 'p.png', alt: 'a', width: null, height: null });
  });
});
