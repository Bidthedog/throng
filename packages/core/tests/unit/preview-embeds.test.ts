/**
 * 054 — which references embed a Mermaid file (manual test decision, 2026-10-11): only a Mermaid
 * extension with no scheme, so no normal link or image changes meaning.
 */
import { describe, expect, it } from 'vitest';
import { embedRefusalText, isImageEmbedRef, isMermaidEmbedRef, parseImageEmbedAlias, PREVIEW_IMAGE_EXTENSIONS, splitTrailingImageSize } from '../../src/preview/embeds.js';

describe('isMermaidEmbedRef', () => {
  it.each(['flow.mmd', 'diagrams/flow.mmd', '/docs/flow.mermaid', 'Flow.MMD', 'flow.mmd?v=2', 'flow.mmd#top', 'my%20flow.mmd'])(
    'embeds %s',
    (ref) => expect(isMermaidEmbedRef(ref)).toBe(true),
  );

  it.each([
    'image.png',
    'notes.md',
    'flow.mmd.png',
    '.mmd',
    'https://example.com/flow.mmd',
    'file:///c:/flow.mmd',
    '//host/flow.mmd',
    '#flow.mmd',
    '',
    `${'a'.repeat(1100)}.mmd`,
  ])('does not embed %s', (ref) => expect(isMermaidEmbedRef(ref)).toBe(false));
});

describe('isImageEmbedRef (068 FR-010, FR-014)', () => {
  it.each(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg'])('is true for .%s in any case', (ext) => {
    expect(isImageEmbedRef(`pic.${ext}`)).toBe(true);
    expect(isImageEmbedRef(`folder/Pic.${ext.toUpperCase()}`)).toBe(true);
  });

  it.each(['note.md', 'flow.mmd', 'a.pdf', 'noextension', 'pic.png.txt', '.png', ''])('is false for %j', (ref) => {
    expect(isImageEmbedRef(ref)).toBe(false);
  });

  it('PREVIEW_IMAGE_EXTENSIONS lists exactly the nine', () => {
    expect([...PREVIEW_IMAGE_EXTENSIONS].sort()).toEqual(
      ['.avif', '.bmp', '.gif', '.ico', '.jpeg', '.jpg', '.png', '.svg', '.webp'],
    );
  });
});

// 068 FR-056 (supersedes FR-015) — Obsidian's size forms on an image embed's alias.
describe('parseImageEmbedAlias (068 FR-056)', () => {
  it('no alias: no alt text (the caller falls back to the file name), no size', () => {
    expect(parseImageEmbedAlias(null)).toEqual({ alt: null, width: null, height: null });
  });

  it('|200 is a width of 200', () => {
    expect(parseImageEmbedAlias('200')).toEqual({ alt: null, width: 200, height: null });
  });

  it('|200x100 is a width of 200 and a height of 100', () => {
    expect(parseImageEmbedAlias('200x100')).toEqual({ alt: null, width: 200, height: 100 });
  });

  it('|Alt text|200 is the alt text and a width', () => {
    expect(parseImageEmbedAlias('Alt text|200')).toEqual({ alt: 'Alt text', width: 200, height: null });
  });

  it('|Alt text|200x100 is the alt text, a width and a height', () => {
    expect(parseImageEmbedAlias('Alt text|200x100')).toEqual({ alt: 'Alt text', width: 200, height: 100 });
  });

  it('plain alt text has no size', () => {
    expect(parseImageEmbedAlias('Alt text')).toEqual({ alt: 'Alt text', width: null, height: null });
  });

  it('a last segment of any other form stays the alt text', () => {
    expect(parseImageEmbedAlias('Alt text|big')).toEqual({ alt: 'Alt text|big', width: null, height: null });
    expect(parseImageEmbedAlias('20px')).toEqual({ alt: '20px', width: null, height: null });
    expect(parseImageEmbedAlias('200x')).toEqual({ alt: '200x', width: null, height: null });
  });

  it('a size of 0 is ignored [derived]: no size, and the segment is not alt text', () => {
    expect(parseImageEmbedAlias('0')).toEqual({ alt: null, width: null, height: null });
    expect(parseImageEmbedAlias('Alt text|0')).toEqual({ alt: 'Alt text', width: null, height: null });
    expect(parseImageEmbedAlias('200x0')).toEqual({ alt: null, width: 200, height: null });
    expect(parseImageEmbedAlias('0x100')).toEqual({ alt: null, width: null, height: 100 });
  });
});

// 068 FR-066 — the same size forms on a STANDARD image's destination or alt text.
describe('splitTrailingImageSize (068 FR-066)', () => {
  it('splits a last |W or |WxH segment off, keeping what came before', () => {
    expect(splitTrailingImageSize('sample-documents/sample.png|200')).toEqual({ rest: 'sample-documents/sample.png', width: 200, height: null });
    expect(splitTrailingImageSize('pic.png|200x100')).toEqual({ rest: 'pic.png', width: 200, height: 100 });
    expect(splitTrailingImageSize('embedded image|200')).toEqual({ rest: 'embedded image', width: 200, height: null });
  });

  it('only the LAST segment counts, and the rest keeps its other pipes', () => {
    expect(splitTrailingImageSize('a|b|50')).toEqual({ rest: 'a|b', width: 50, height: null });
  });

  it('a last segment that is not a size form is no size at all (null: use the text as written)', () => {
    expect(splitTrailingImageSize('pic.png')).toBeNull();
    expect(splitTrailingImageSize('pic.png|big')).toBeNull();
    expect(splitTrailingImageSize('pic.png|20px')).toBeNull();
    expect(splitTrailingImageSize('|200')).toBeNull(); // nothing before it to be a path or alt text
  });

  it('a dimension of 0 is dropped, the segment still removed [derived, as FR-056]', () => {
    expect(splitTrailingImageSize('pic.png|0')).toEqual({ rest: 'pic.png', width: null, height: null });
    expect(splitTrailingImageSize('pic.png|200x0')).toEqual({ rest: 'pic.png', width: 200, height: null });
  });
});

describe('embedRefusalText', () => {
  it('names the reference as written for each refusal', () => {
    expect(embedRefusalText('a.mmd', 'missing')).toBe('Embedded diagram not found: a.mmd');
    expect(embedRefusalText('../a.mmd', 'outside')).toBe('Embedded diagram is outside the project: ../a.mmd');
    expect(embedRefusalText('a.mmd', 'too-large')).toContain('too large');
  });
});
