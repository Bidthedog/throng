import { describe, expect, it, vi } from 'vitest';
import { createMarkdownPipeline, type PipelineContext, type RenderEnvironment } from '../../src/renderer/preview/providers/markdown/pipeline.js';

/**
 * 075 FR-040 – FR-042, FR-045, contracts/math-markup.md — the placeholders the pipeline emits for maths, as
 * markdown-it's HTML string before the sanitiser (a spy stands in for it). Typesetting happens later, on the
 * sanitised DOM; what is pinned here is WHERE maths is recognised.
 */
const ON: RenderEnvironment = { panelId: 'p', docPath: '/proj/a.md', projectRoot: '/proj', remoteImages: false, typesetMath: true };
const OFF: RenderEnvironment = { ...ON, typesetMath: false };

function html(text: string, environment: RenderEnvironment = ON): string {
  const sanitise = vi.fn((out: string, _context: PipelineContext) => out);
  return createMarkdownPipeline(sanitise).render(text, environment).fragment;
}

describe('inline maths (FR-040, FR-041)', () => {
  it('emits $…$ as an inline placeholder holding its source', () => {
    expect(html('Cost $O(n \\log n)$ here.\n')).toContain('<span data-math="inline" data-math-open="$">O(n \\log n)</span>');
  });

  it('emits $`…`$ and an inline $$…$$', () => {
    expect(html('A $`x<y`$ b\n')).toContain('<span data-math="inline" data-math-open="$`">x&lt;y</span>');
    expect(html('A $$\\sum x$$ b\n')).toContain('<span data-math="display" data-math-open="$$">\\sum x</span>');
  });

  it('leaves prose dollars, escaped dollars and code alone', () => {
    const out = html('costs $5 and $10\n\nan \\$x$ and `$y$`\n');
    expect(out).not.toContain('data-math');
    expect(out).toContain('costs $5 and $10');
    expect(out).toContain('an $x$');
    expect(out).toContain('<code>$y$</code>');
  });

  it('escapes HTML in an expression rather than emitting it', () => {
    const out = html('$<img src=x onerror=alert(1)>$\n');
    expect(out).toContain('data-math="inline"');
    expect(out).not.toContain('<img');
  });
});

describe('display maths (FR-040, FR-045)', () => {
  it('emits a $$ block with its source line', () => {
    const out = html('Intro\n\n$$\n\\sum_{i=1}^n i\n$$\n');
    expect(out).toContain('<div data-math="display" data-math-open="$$" data-source-line="2">\\sum_{i=1}^n i</div>');
  });

  it('emits a ```math fence as display maths with its source line', () => {
    expect(html('```math\na^2+b^2\n```\n')).toContain('<div data-math="display" data-math-open="fence" data-source-line="0">a^2+b^2\n</div>');
  });

  it('reads maths inside a callout, a list and a table cell', () => {
    expect(html('> [!note]\n> $x$\n')).toContain('data-math="inline"');
    expect(html('- $x$\n')).toContain('data-math="inline"');
    expect(html('| a |\n|---|\n| $x$ |\n')).toContain('data-math="inline"');
  });

  it('leaves an unclosed $$ as text', () => {
    const out = html('$$\nx\n\nmore\n');
    expect(out).not.toContain('data-math');
    expect(out).toContain('$$');
  });

  it('never reads a fenced code block\'s dollars', () => {
    expect(html('```\n$x$\n$$\ny\n$$\n```\n')).not.toContain('data-math');
  });
});

describe('Typeset math off (FR-042)', () => {
  it('renders exactly what it rendered before this feature', () => {
    const doc = 'A $x$ b $$y$$ c\n\n$$\nz\n$$\n\n```math\nw\n```\n';
    const before = html(doc, { ...ON, typesetMath: undefined } as unknown as RenderEnvironment);
    expect(html(doc, OFF)).toBe(before);
    expect(before).not.toContain('data-math');
    expect(before).toContain('<code data-lang="math">w\n</code>');
  });
});
