import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';
import {
  blockRendererFor,
  claimRenderedBlocks,
  registerBlockRenderer,
  type BlockRenderer,
} from '../../src/renderer/preview/blocks/block-renderers.js';
import { createMarkdownPipeline } from '../../src/renderer/preview/providers/markdown/pipeline.js';
import { createSanitiser } from '../../src/renderer/preview/providers/markdown/sanitise.js';

/**
 * 054 T032 — the block-renderer seam (FR-043, research R5): a fenced block whose language has a registered
 * renderer is claimed from the SANITISED document; every other fence stays code for the highlighter. The
 * seam names no diagram language, so a test-only renderer registers exactly as Mermaid does.
 *
 * Node, with a JSDOM window for the real document sanitiser — the claim runs over its output, which is
 * the point: what a block renderer is handed has already been through the document profile.
 */
const { window } = new JSDOM('');
const pipeline = createMarkdownPipeline(createSanitiser(window as unknown as Window & typeof globalThis));
const render = (text: string): DocumentFragment => pipeline.render(text).fragment;

const unregister: (() => void)[] = [];
afterEach(() => {
  for (const off of unregister.splice(0)) off();
});

const fakeRenderer: BlockRenderer = { render: () => Promise.reject(new Error('unused')) };

describe('the registry', () => {
  it('ships a renderer for mermaid', () => {
    expect(blockRendererFor('mermaid')?.lang).toBe('mermaid');
  });

  it('has none for an ordinary language', () => {
    expect(blockRendererFor('ts')).toBeNull();
  });

  it('a test-only renderer registers, and unregisters, without touching the body or the pipeline', async () => {
    unregister.push(registerBlockRenderer({ lang: 'testdiagram', load: () => Promise.resolve(fakeRenderer) }));
    expect(blockRendererFor('testdiagram')?.lang).toBe('testdiagram');
    await expect(blockRendererFor('testdiagram')!.load()).resolves.toBe(fakeRenderer);
    unregister.pop()!();
    expect(blockRendererFor('testdiagram')).toBeNull();
  });
});

describe('claiming blocks from the sanitised document', () => {
  const doc = ['```mermaid', 'graph TD', '  A --> B', '```', '', '```ts', 'const a = 1;', '```', '', '```mermaid', 'pie', '```'].join('\n');

  it('claims each fence whose language has a renderer, in document order, with its source and line', () => {
    const fragment = render(doc);
    const claimed = claimRenderedBlocks(fragment, () => true);
    expect(claimed.map((c) => [c.lang, c.source, c.line])).toEqual([
      ['mermaid', 'graph TD\n  A --> B\n', 0],
      ['mermaid', 'pie\n', 9],
    ]);
    expect(claimed.every((c) => c.pre.tagName === 'PRE')).toBe(true);
  });

  it('leaves every other fence as code', () => {
    const fragment = render(doc);
    claimRenderedBlocks(fragment, () => true);
    const ts = fragment.querySelector('code[data-lang="ts"]');
    expect(ts?.textContent).toBe('const a = 1;\n');
  });

  it('claims nothing for a language its caller has switched off (Render Mermaid diagrams off, FR-041)', () => {
    expect(claimRenderedBlocks(render(doc), (lang) => lang !== 'mermaid')).toEqual([]);
  });

  it('a registered test language is claimed the same way', () => {
    unregister.push(registerBlockRenderer({ lang: 'testdiagram', load: () => Promise.resolve(fakeRenderer) }));
    const claimed = claimRenderedBlocks(render('```testdiagram\nx\n```'), () => true);
    expect(claimed.map((c) => c.lang)).toEqual(['testdiagram']);
  });

  it('never claims raw HTML that only looks like a fence: the sanitised element must be pre > code[data-lang]', () => {
    expect(claimRenderedBlocks(render('<code data-lang="mermaid">graph TD</code>'), () => true)).toEqual([]);
  });
});
