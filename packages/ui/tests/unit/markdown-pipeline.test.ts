import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { headingSlug, markdownHeadingLine, splitFrontMatter } from '@throng/core';
import {
  createMarkdownPipeline,
  type PipelineContext,
} from '../../src/renderer/preview/providers/markdown/pipeline.js';

/**
 * The Markdown pipeline's string output, before anything sanitises it (044 T045, FR-080, FR-081,
 * contracts/security-policy.md Layer 1).
 *
 * Node, not jsdom: nothing here needs a DOM. The sanitiser is INJECTED, and a spy stands in for it, so
 * these tests see exactly the HTML string markdown-it produced — which is also how the FR-081
 * requirement "a test MUST assert the sanitiser is in the path" is met at this layer: remove the call
 * and the last block fails, not a review.
 */

/** A pipeline whose sanitiser returns the HTML it was handed, recorded. */
function spyPipeline() {
  const sanitise = vi.fn((html: string, _context: PipelineContext) => html);
  return { pipeline: createMarkdownPipeline(sanitise), sanitise };
}

function html(text: string): string {
  return spyPipeline().pipeline.render(text);
}

/** Every opening tag in `out` whose name is `tag`, as the tag text. */
function openTags(out: string, tag: string): string[] {
  return out.match(new RegExp(`<${tag}(?=[\\s>])[^>]*>`, 'g')) ?? [];
}

function attr(tagText: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tagText);
  return m ? m[1] : null;
}

describe('markdown-it configuration (FR-080, research R1)', () => {
  it('is { html: true, linkify: true, typographer: false, breaks: false }', () => {
    const { md } = spyPipeline().pipeline;
    expect(md.options.html).toBe(true);
    expect(md.options.linkify).toBe(true);
    expect(md.options.typographer).toBe(false);
    expect(md.options.breaks).toBe(false);
  });

  it('has no highlight callback: fences are highlighted after sanitising, never as an HTML string (R5)', () => {
    expect(spyPipeline().pipeline.md.options.highlight).toBeFalsy();
  });

  it('linkifies a bare URL', () => {
    expect(html('see https://example.com/x for more')).toMatch(/<a href="https:\/\/example\.com\/x">/);
  });
});

describe('data-source-line on block opens (FR-024, R11)', () => {
  const doc = [
    '# Title', //            0
    '', //                   1
    'A paragraph.', //       2
    '', //                   3
    '- one', //              4
    '- two', //              5
    '', //                   6
    '> quoted', //           7
    '', //                   8
    '---', //                9
    '', //                   10
    '1. first', //           11
    '', //                   12
    '| a |', //              13
    '|---|', //              14
    '| 1 |', //              15
  ].join('\n');

  it("carries markdown-it's 0-based token.map line on each block element", () => {
    const out = html(doc);
    expect(openTags(out, 'h1').map((t) => attr(t, 'data-source-line'))).toEqual(['0']);
    expect(openTags(out, 'ul').map((t) => attr(t, 'data-source-line'))).toEqual(['4']);
    expect(openTags(out, 'li').map((t) => attr(t, 'data-source-line'))).toEqual(['4', '5', '11']);
    expect(openTags(out, 'blockquote').map((t) => attr(t, 'data-source-line'))).toEqual(['7']);
    expect(openTags(out, 'hr').map((t) => attr(t, 'data-source-line'))).toEqual(['9']);
    expect(openTags(out, 'ol').map((t) => attr(t, 'data-source-line'))).toEqual(['11']);
    expect(openTags(out, 'table').map((t) => attr(t, 'data-source-line'))).toEqual(['13']);
    // Line 2's paragraph, and the one inside the quote on line 7; the tight lists' paragraphs are hidden.
    expect(openTags(out, 'p').map((t) => attr(t, 'data-source-line'))).toEqual(['2', '7']);
  });

  it('puts none on an inline element', () => {
    const out = html('some *emphasis* and **strong** and `code`');
    for (const tag of ['em', 'strong', 'code']) {
      for (const t of openTags(out, tag)) expect(attr(t, 'data-source-line')).toBeNull();
    }
  });
});

describe('data-heading-slug from headingSlug, never an id (FR-090b, FR-090d, FR-090f)', () => {
  const doc = ['# Install', '', '## Install', '', '### Hello *World*!', '', 'Setext', '======'].join('\n');

  it('slugs every heading in document order with one de-duplicating set, as core does', () => {
    const taken = new Set<string>();
    const expected = ['Install', 'Install', 'Hello *World*!', 'Setext'].map((t) => headingSlug(t, taken));
    expect(expected).toEqual(['install', 'install-1', 'hello-world', 'setext']);

    const out = html(doc);
    // In document order: the setext heading is an h1, so collecting tag by tag would reorder it.
    const headings = openTags(out, 'h[1-6]');
    expect(headings.map((t) => attr(t, 'data-heading-slug'))).toEqual(expected);
  });

  it('starts the de-duplication afresh on every render', () => {
    const { pipeline } = spyPipeline();
    pipeline.render(doc);
    const second = pipeline.render(doc);
    expect(attr(openTags(second, 'h1')[0], 'data-heading-slug')).toBe('install');
  });

  it('joins a multi-line setext heading with a space, as markdownHeadingLine does', () => {
    const out = html('Getting\nstarted\n---');
    expect(attr(openTags(out, 'h2')[0], 'data-heading-slug')).toBe('getting-started');
  });

  /*
   * 044 T178 — the slug comes from the heading's RENDERED text, never its raw source, so `[x](#foo-baz)`
   * reaches `## [Foo](bar.md) baz`. Core's `markdownInlineText` reads the same text off the source line
   * for the editor's heading reveal (FR-090d); the block below pins the two together.
   */
  describe('the slug is the rendered text, not the source (FR-090b, FR-090f)', () => {
    it.each([
      ['a link keeps its text', '## [Foo](bar.md) baz', 'foo-baz'],
      ['an HTML anchor renders nothing', '## <a name="install"></a>Install', 'install'],
      ['emphasis markers go', '## _Note_', 'note'],
      ['a code span keeps its content', '## `code_span` stays', 'code_span-stays'],
      ['an intraword underscore stays', '## snake_case_name', 'snake_case_name'],
      ['an image contributes no text', '## ![logo](logo.png) Title', 'title'],
      ['an entity is the character it names', '## A &amp; B', 'a--b'],
      ['an escaped marker is a literal', '## \\_literal\\_', '_literal_'],
    ])('%s', (_name, source, slug) => {
      expect(attr(openTags(html(source), 'h2')[0], 'data-heading-slug')).toBe(slug);
    });

    it('agrees with core’s markdownHeadingLine, heading for heading, de-duplication included', () => {
      const doc = [
        '# [Foo](bar.md) baz', //           1
        '## <a name="install"></a>Install', // 2
        '## _Install_', //                  3
        '## `code_span` stays', //          4
        'Getting [started](x.md)', //       5
        '---', //                           6
      ].join('\n');
      const slugs = openTags(html(doc), 'h[1-6]').map((t) => attr(t, 'data-heading-slug'));
      expect(slugs).toEqual(['foo-baz', 'install', 'install-1', 'code_span-stays', 'getting-started']);
      expect(slugs.map((slug) => markdownHeadingLine(doc, slug!))).toEqual([1, 2, 3, 4, 5]);
    });
  });

  it('hands the sanitiser the slug recorded for each heading line', () => {
    const { pipeline, sanitise } = spyPipeline();
    pipeline.render(doc);
    const context = sanitise.mock.calls[0][1];
    expect([...context.headingSlugs.entries()]).toEqual([
      [0, 'install'],
      [2, 'install-1'],
      [4, 'hello-world'],
      [6, 'setext'],
    ]);
  });

  it('emits no id attribute anywhere in its output', () => {
    const everything = [
      doc,
      '[a link](other.md#install) and ![an image](a.png "title")',
      '| a | b |\n|:--|--:|\n| 1 | 2 |',
      '```ts\nconst x = 1;\n```',
      '- [ ] task\n- [x] done',
      '[ref]: https://example.com\n\n[ref]',
    ].join('\n\n');
    expect(html(everything)).not.toMatch(/\sid=/i);
  });
});

describe('table alignment as data-align, never style (R1)', () => {
  it('maps left, center and right to data-align and leaves an unaligned cell bare', () => {
    const out = html('| a | b | c | d |\n|:--|:-:|--:|---|\n| 1 | 2 | 3 | 4 |');
    expect(openTags(out, 'th').map((t) => attr(t, 'data-align'))).toEqual(['left', 'center', 'right', null]);
    expect(openTags(out, 'td').map((t) => attr(t, 'data-align'))).toEqual(['left', 'center', 'right', null]);
    expect(out).not.toMatch(/\sstyle=/i);
  });
});

describe('fenced code as <pre><code data-lang> with escaped text (FR-080, FR-086, R5)', () => {
  it('escapes the code and carries the info string as data-lang, with no class', () => {
    const out = html('```ts\nconst a = "<b>" && 1;\n```');
    expect(out).toContain(
      '<pre data-source-line="0"><code data-lang="ts">const a = &quot;&lt;b&gt;&quot; &amp;&amp; 1;\n</code></pre>',
    );
    expect(out).not.toMatch(/\sclass=/);
  });

  it('carries only the first word of the info string, escaped', () => {
    const out = html('```a"onmouseover=x rest\nbody\n```');
    expect(openTags(out, 'code').map((t) => attr(t, 'data-lang'))).toEqual(['a&quot;onmouseover=x']);
    expect(out).not.toContain('rest');
  });

  it('cuts data-lang at the first colon, so `ts:line-numbers` is `ts` (the sanitiser refuses a colon)', () => {
    expect(openTags(html('```ts:line-numbers\nx\n```'), 'code').map((t) => attr(t, 'data-lang'))).toEqual(['ts']);
  });

  it('gives a fence without an info string an empty data-lang', () => {
    expect(html('```\nplain\n```')).toContain('<code data-lang="">plain\n</code>');
  });

  it('renders a mermaid fence as ordinary code (FR-086)', () => {
    expect(html('```mermaid\ngraph TD; A-->B\n```')).toContain(
      '<code data-lang="mermaid">graph TD; A--&gt;B\n</code>',
    );
  });
});

describe('task lists as disabled checkboxes (FR-080, R1)', () => {
  it('turns a leading [ ] or [x] in a list item into a disabled checkbox and drops the marker', () => {
    const out = html('- [ ] todo\n- [x] done\n- [X] also\n- plain [ ] not a task');
    const inputs = openTags(out, 'input');
    expect(inputs).toHaveLength(3);
    for (const input of inputs) {
      expect(attr(input, 'type')).toBe('checkbox');
      expect(input).toMatch(/\sdisabled(?=[\s>=])/);
    }
    expect(inputs.map((i) => /\schecked(?=[\s>=])/.test(i))).toEqual([false, true, true]);
    expect(out).not.toContain('[ ] todo');
    expect(out).not.toContain('[x] done');
    expect(out).toContain('plain [ ] not a task');
  });

  it('leaves an escaped marker as literal text: `- \\[x] literal` is not a task', () => {
    const out = html('- \\[x] literal\n- \\[ ] also literal');
    expect(openTags(out, 'input')).toHaveLength(0);
    expect(out).toContain('[x] literal');
    expect(out).toContain('[ ] also literal');
  });
});

describe('the sanitiser is in the path (FR-081)', () => {
  it("calls its injected sanitiser exactly once per render, with markdown-it's output, and returns its result", () => {
    const sentinel = { sanitised: true };
    const sanitise = vi.fn((_html: string, _context: PipelineContext) => sentinel);
    const pipeline = createMarkdownPipeline(sanitise);
    const text = '# Heading\n\n<script>alert(1)</script>\n\nbody';

    const result = pipeline.render(text);

    expect(result).toBe(sentinel);
    expect(sanitise).toHaveBeenCalledTimes(1);
    // Each render draws its own random heading nonce (fix round 1), so the two renders agree except there.
    const withoutNonce = (html: string): string => html.replace(/ data-heading-nonce="[0-9a-f]+"/g, '');
    expect(withoutNonce(sanitise.mock.calls[0][0])).toBe(withoutNonce(pipeline.md.render(text)));
    expect(sanitise.mock.calls[0][0]).toContain(`data-heading-nonce="${sanitise.mock.calls[0][1].headingNonce}"`);
    expect(sanitise.mock.calls[0][0]).toContain('<script>alert(1)</script>');

    pipeline.render(text);
    expect(sanitise).toHaveBeenCalledTimes(2);
  });
});

/*
 * Iteration 2026-09-15, FR-117 (T194) — Show front matter off. The block is not shown at all: no table, no
 * code block, and never handed to markdown-it (so no `<hr>` and no setext heading from its fences). The body
 * keeps the front matter's line offset, so every `data-source-line` — and the heading lines FR-090d and the
 * scroll anchors read — is still the DOCUMENT's line.
 */
describe('front matter hidden (FR-117)', () => {
  const FIXTURES = fileURLToPath(new URL('../fixtures/preview/', import.meta.url));
  const fixture = (name: string): string => readFileSync(`${FIXTURES}${name}`, 'utf8');
  const ENV = { panelId: 'p1', docPath: 'D:/proj/README.md', projectRoot: 'D:/proj', remoteImages: false };

  const renderWith = (text: string, frontMatter: boolean): string =>
    spyPipeline().pipeline.render(text, { ...ENV, frontMatter });

  it('front-matter.md renders no table, no rule and none of its keys or values', () => {
    const text = fixture('front-matter.md');
    const out = renderWith(text, false);
    expect(openTags(out, 'table')).toHaveLength(0);
    expect(openTags(out, 'hr')).toHaveLength(0);
    expect(openTags(out, 'pre')).toHaveLength(0);
    // The keys and values that do not also occur in the body's own prose or heading.
    for (const word of ['title', 'draft', 'order', 'another', 'key', 'alpha', 'beta', 'gamma']) {
      expect(out, word).not.toContain(word);
    }
    // Positive control: the body is there.
    expect(out).toContain('Body content that follows');
  });

  it('keeps the body line offset: the first body block sits on its document line', () => {
    const text = '---\ntitle: T\n---\n# Heading\n\nPara';
    expect(splitFrontMatter(text).bodyLineOffset).toBe(3);
    const out = renderWith(text, false);
    expect(openTags(out, 'h1').map((t) => attr(t, 'data-source-line'))).toEqual(['3']);
    expect(openTags(out, 'p').map((t) => attr(t, 'data-source-line'))).toEqual(['5']);
    // And the fixture's heading is on line 13 either way.
    expect(openTags(renderWith(fixture('front-matter.md'), false), 'h1').map((t) => attr(t, 'data-source-line'))).toEqual(['13']);
  });

  it('records heading slugs under their document lines, as when it is shown', () => {
    const { pipeline, sanitise } = spyPipeline();
    pipeline.render(fixture('front-matter.md'), { ...ENV, frontMatter: false });
    expect([...sanitise.mock.calls[0][1].headingSlugs.entries()]).toEqual([[13, 'front-matter-fixture']]);
  });

  it('front-matter-invalid.md renders no code block either', () => {
    const out = renderWith(fixture('front-matter-invalid.md'), false);
    expect(openTags(out, 'pre')).toHaveLength(0);
    expect(out).not.toContain('Broken front matter');
    expect(out).toMatch(/<h1 data-source-line="8"[^>]*>Body after invalid front matter<\/h1>/);
  });

  it('true — and an environment that does not say — is unchanged: the table renders', () => {
    const text = fixture('front-matter.md');
    expect(openTags(renderWith(text, true), 'table')).toHaveLength(1);
    expect(openTags(spyPipeline().pipeline.render(text, ENV), 'table')).toHaveLength(1);
    expect(openTags(renderWith(fixture('front-matter-invalid.md'), true), 'pre')).toHaveLength(1);
  });
});

/*
 * Adversarial review (security) I1 and I2: a crafted `.md` whose render never finishes hangs the window —
 * the render is synchronous on the renderer's main thread. A wall-clock bound, far above the linear cost
 * and far below the quadratic one. Measured on a workstation: 50,000 headings render in ~380 ms (that is
 * markdown-it's own linear cost) against ~150 s before the fix; front matter in ~15 ms against ~10.5 s. The
 * bound leaves room for a loaded parallel run without coming near either quadratic figure.
 */
describe('a hostile document renders within a bound (adversarial review I1, I2)', () => {
  const BOUND_MS = 5_000;

  function timed(text: string): { out: string; ms: number } {
    const started = performance.now();
    const out = html(text);
    return { out, ms: performance.now() - started };
  }

  it('front matter: a plain scalar with a 100,000-space run (I1)', () => {
    const { out, ms } = timed(`---\ntitle: a${' '.repeat(100_000)}b\n---\n`);
    expect(ms).toBeLessThan(BOUND_MS);
    expect(out).toContain(`<td>a${' '.repeat(100_000)}b</td>`);
  }, 120_000);

  it('front matter: a nested value with a 100,000-space run (I1, the nested slice)', () => {
    const { out, ms } = timed(`---\nnested:\n  k: a${' '.repeat(100_000)}b\n---\n`);
    expect(ms).toBeLessThan(BOUND_MS);
    expect(out).toContain(`k: a${' '.repeat(100_000)}b</code></pre>`);
  }, 120_000);

  it('front matter: trailing whitespace on a value is still trimmed', () => {
    expect(html('---\nnested:\n  k: v   \n\n---\n')).toContain('<code data-lang="yaml">k: v</code>');
  });

  it.each([
    ['empty', '#\n'],
    ['identical', '# a\n'],
  ])('50,000 %s headings (I2)', (_name, line) => {
    const { out, ms } = timed(line.repeat(50_000));
    expect(ms).toBeLessThan(BOUND_MS);
    const slugs = openTags(out, 'h1').map((t) => attr(t, 'data-heading-slug'));
    expect(slugs).toHaveLength(50_000);
    expect(new Set(slugs).size).toBe(50_000);
  }, 120_000);
});
