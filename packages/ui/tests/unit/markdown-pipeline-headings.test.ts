import { describe, expect, it, vi } from 'vitest';
import { headingSlug } from '@throng/core';
import { createMarkdownPipeline, type PipelineContext } from '../../src/renderer/preview/providers/markdown/pipeline.js';

/**
 * 047 T004/T005 (R2, data-model §DocumentSymbol) — `render()` now returns `{ fragment, headings }`: one
 * `HeadingRecord` (`{ level, text, slug, line }`) per heading TOKEN markdown-it produced, in document
 * order, sharing the pipeline's own slug de-duplication (the same `headingSlugs` handed to the
 * sanitiser). This is node-only, like `markdown-pipeline.test.ts`: the sanitiser is a spy that returns
 * whatever it is handed, so `fragment` here is the HTML string, not a real DOM fragment.
 */

/** A pipeline whose sanitiser returns the HTML it was handed, recorded. */
function spyPipeline() {
  const sanitise = vi.fn((html: string, _context: PipelineContext) => html);
  return { pipeline: createMarkdownPipeline(sanitise), sanitise };
}

function headingsOf(text: string) {
  return spyPipeline().pipeline.render(text).headings;
}

describe('render() returns { fragment, headings } (T004, T005, R2)', () => {
  it('still returns the sanitiser result as fragment', () => {
    const { pipeline, sanitise } = spyPipeline();
    sanitise.mockReturnValueOnce('SANITISED');
    const result = pipeline.render('# Title');
    expect(result.fragment).toBe('SANITISED');
  });

  it('one HeadingRecord per ATX heading, in document order', () => {
    const headings = headingsOf('# One\n\n## Two\n\n### Three');
    expect(headings).toEqual([
      { level: 1, text: 'One', slug: 'one', line: 0 },
      { level: 2, text: 'Two', slug: 'two', line: 2 },
      { level: 3, text: 'Three', slug: 'three', line: 4 },
    ]);
  });

  it('a setext heading records its own level (h1 for ===, h2 for ---)', () => {
    const headings = headingsOf('Title\n=====\n\nSubtitle\n--------');
    expect(headings).toEqual([
      { level: 1, text: 'Title', slug: 'title', line: 0 },
      { level: 2, text: 'Subtitle', slug: 'subtitle', line: 3 },
    ]);
  });

  it('duplicate heading text gets distinct slugs from the same de-dup set as data-heading-slug', () => {
    const headings = headingsOf('# Install\n\n## Install\n\n### Install');
    const taken = new Set<string>();
    const expected = ['Install', 'Install', 'Install'].map((t) => headingSlug(t, taken));
    expect(headings.map((h) => h.slug)).toEqual(expected);
    expect(new Set(headings.map((h) => h.slug)).size).toBe(3);
  });

  it('records none for a # inside front matter', () => {
    const headings = headingsOf('---\ntitle: "# not a heading"\n---\n\n# Real Heading');
    expect(headings).toEqual([{ level: 1, text: 'Real Heading', slug: 'real-heading', line: 4 }]);
  });

  it('records none for a # inside a fenced code block', () => {
    const headings = headingsOf('```\n# not a heading\n```\n\n# Real Heading');
    expect(headings).toEqual([{ level: 1, text: 'Real Heading', slug: 'real-heading', line: 4 }]);
  });

  it('records none for a # inside an indented code block', () => {
    const headings = headingsOf('    # not a heading\n\n# Real Heading');
    expect(headings).toEqual([{ level: 1, text: 'Real Heading', slug: 'real-heading', line: 2 }]);
  });

  it('records none for a raw-HTML heading, even one spoofing a slug attribute', () => {
    const headings = headingsOf('<h2 data-heading-slug="spoof">Spoofed</h2>\n\n# Real Heading');
    expect(headings).toEqual([{ level: 1, text: 'Real Heading', slug: 'real-heading', line: 2 }]);
  });

  it('agrees with the sanitiser context headingSlugs, keyed by the same document line', () => {
    const { pipeline, sanitise } = spyPipeline();
    pipeline.render('# One\n\n## Two');
    const context = sanitise.mock.calls[0]![1] as PipelineContext;
    const fromHeadings = new Map(headingsOf('# One\n\n## Two').map((h) => [h.line, h.slug]));
    expect([...context.headingSlugs.entries()]).toEqual([...fromHeadings.entries()]);
  });

  it('an empty document has no headings', () => {
    expect(headingsOf('just a paragraph, no headings')).toEqual([]);
  });
});
