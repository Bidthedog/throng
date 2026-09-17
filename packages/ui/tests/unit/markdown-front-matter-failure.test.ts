import { describe, expect, it, vi } from 'vitest';
import {
  createMarkdownPipeline,
  renderFence,
  type PipelineContext,
} from '../../src/renderer/preview/providers/markdown/pipeline.js';

/**
 * 044 fix round 1, item 11 — a YAML parser that THROWS on front matter (pathological nesting, a parser
 * defect) must not take the document with it (FR-085: "never as a notice"). A throw out of `render` would
 * reach the body's failure banner and hide a document whose body is perfectly readable.
 *
 * The throw is forced with a module mock rather than hunted for with a real input: which inputs make
 * `yaml` throw rather than report is that library's business, and this file is about the pipeline's.
 */
vi.mock('yaml', async (importOriginal) => {
  const actual = await importOriginal<typeof import('yaml')>();
  return {
    ...actual,
    parseDocument: vi.fn(() => {
      throw new RangeError('Maximum call stack size exceeded');
    }),
  };
});

describe('front matter the YAML parser throws on (FR-085)', () => {
  it('renders as an escaped code block of its source, and the body still renders beneath it', () => {
    const sanitise = vi.fn((out: string, _context: PipelineContext) => out);
    const source = 'deep: [[[[<b>x</b>]]]]';
    const out = createMarkdownPipeline(sanitise).render(`---\n${source}\n---\n\n# Body\n`);

    expect(out).toContain(`<pre data-source-line="0">${renderFence('yaml', source)}</pre>`);
    expect(out).not.toContain('<b>');
    expect(out).toMatch(/<h1 data-source-line="4"[^>]*>Body<\/h1>/);
  });
});
