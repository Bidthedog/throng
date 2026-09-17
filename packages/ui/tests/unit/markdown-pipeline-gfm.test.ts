import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  createMarkdownPipeline,
  renderFence,
  type PipelineContext,
} from '../../src/renderer/preview/providers/markdown/pipeline.js';

/**
 * 044 T086 — every FR-080 construct, front matter (FR-085) and the two things that must NOT be typeset
 * (FR-086), as the pipeline's HTML STRING before anything sanitises it.
 *
 * Node, not jsdom: the sanitiser is injected, and a spy that returns what it was handed stands in for it,
 * so what is asserted here is exactly markdown-it's output plus the pipeline's own rules. What the
 * sanitiser then does with it is `preview-sanitise.test.ts`'s and `preview-images.test.ts`'s.
 *
 * The fixtures are read from disk, so the constructs asserted are the ones quickstart §3 renders by hand.
 */
const FIXTURES = fileURLToPath(new URL('../fixtures/preview/', import.meta.url));
const fixture = (name: string): string => readFileSync(`${FIXTURES}${name}`, 'utf8');

function html(text: string): string {
  const sanitise = vi.fn((out: string, _context: PipelineContext) => out);
  return createMarkdownPipeline(sanitise).render(text);
}

/** Every opening tag in `out` whose name matches `tag`, as the tag text. */
function openTags(out: string, tag: string): string[] {
  return out.match(new RegExp(`<${tag}(?=[\\s>])[^>]*>`, 'g')) ?? [];
}

function attr(tagText: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tagText);
  return m ? m[1] : null;
}

describe('gfm.md — each FR-080 construct renders (FR-080)', () => {
  const out = html(fixture('gfm.md'));

  it('renders ATX headings h1 to h6', () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(out, `h${level}`).toMatch(new RegExp(`<h${level}[^>]*>H${level} heading</h${level}>`));
    }
  });

  it('renders emphasis, strong, both, and strikethrough', () => {
    expect(out).toContain('<em>italic</em>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toMatch(/<em><strong>bold italic<\/strong><\/em>|<strong><em>bold italic<\/em><\/strong>/);
    expect(out).toMatch(/<(s|del)>strikethrough<\/\1>/);
  });

  it('renders bullet lists with a nested list, and an ordered list', () => {
    expect(openTags(out, 'ul').length).toBeGreaterThanOrEqual(2);
    expect(out).toMatch(/<li[^>]*>Item two\s*<ul[^>]*>\s*<li[^>]*>Nested item two-a<\/li>/);
    expect(openTags(out, 'ol')).toHaveLength(1);
    expect(out).toMatch(/<li[^>]*>First ordered item<\/li>/);
  });

  it('renders a block quote and a horizontal rule', () => {
    expect(out).toMatch(/<blockquote[^>]*>\s*<p[^>]*>This is a block quote\.\nIt spans two lines\.<\/p>\s*<\/blockquote>/);
    expect(openTags(out, 'hr')).toHaveLength(1);
  });

  it('renders an inline link and an autolink', () => {
    expect(out).toContain('<a href="https://example.com/">An inline link</a>');
    expect(out).toContain('<a href="https://example.com/auto">https://example.com/auto</a>');
  });

  it('renders an image with its alt text', () => {
    const img = openTags(out, 'img')[0];
    expect(attr(img, 'src')).toBe('https://example.com/image.png');
    expect(attr(img, 'alt')).toBe('Alt text for the fixture image');
  });

  it('renders the table with data-align on every aligned cell', () => {
    expect(openTags(out, 'th').map((t) => attr(t, 'data-align'))).toEqual(['left', 'center', 'right']);
    expect(openTags(out, 'td').map((t) => attr(t, 'data-align'))).toEqual(
      ['left', 'center', 'right', 'left', 'center', 'right'],
    );
  });

  it('renders the task list as disabled checkboxes, one checked', () => {
    const inputs = openTags(out, 'input');
    expect(inputs).toHaveLength(2);
    for (const input of inputs) expect(input).toMatch(/\sdisabled(?=[\s>=])/);
    expect(inputs.map((i) => /\schecked(?=[\s>=])/.test(i))).toEqual([false, true]);
    expect(out).toMatch(/<input[^>]*>\s*Unchecked task/);
  });

  it('renders the fenced ts block as escaped code carrying data-lang', () => {
    expect(out).toMatch(/<pre data-source-line="\d+"><code data-lang="ts">function greet\(name: string\): string \{\n {2}return `Hello, \$\{name\}!`;\n\}\n<\/code><\/pre>/);
  });

  it('renders the mermaid fence as ordinary code, never a diagram (FR-086)', () => {
    expect(out).toContain('<code data-lang="mermaid">graph TD\n  A --&gt; B\n  B --&gt; C\n</code>');
    expect(out).not.toMatch(/<svg/i);
  });

  it('renders $…$ and $$…$$ as their literal text (FR-086)', () => {
    expect(out).toContain('Inline math renders as literal text: $x$');
    expect(out).toMatch(/<p[^>]*>\$\$y\$\$<\/p>/);
    expect(out).not.toMatch(/<math|katex/i);
  });
});

describe('task list markers the u5 review asked to pin (carried to T086)', () => {
  it('turns a NESTED task item into a checkbox as well as its parent', () => {
    const out = html('- [ ] parent\n  - [x] child\n  - plain child');
    const inputs = openTags(out, 'input');
    expect(inputs).toHaveLength(2);
    expect(inputs.map((i) => /\schecked(?=[\s>=])/.test(i))).toEqual([false, true]);
    expect(out).toContain('plain child');
    expect(out).not.toContain('[x] child');
  });

  it('accepts * and + bullets, not only -', () => {
    const out = html('* [ ] star\n\n+ [x] plus');
    const inputs = openTags(out, 'input');
    expect(inputs).toHaveLength(2);
    expect(inputs.map((i) => /\schecked(?=[\s>=])/.test(i))).toEqual([false, true]);
    expect(out).not.toContain('[ ] star');
    expect(out).not.toContain('[x] plus');
  });
});

describe('fence info strings reach data-lang as their first word (carried to T086, T095)', () => {
  it.each([
    ['ts {1,3}', 'ts'],
    ['c++', 'c++'],
    ['objective-c', 'objective-c'],
  ])('```%s → data-lang="%s"', (info, lang) => {
    expect(openTags(html(`\`\`\`${info}\nx\n\`\`\``), 'code').map((t) => attr(t, 'data-lang'))).toEqual([lang]);
  });
});

describe('renderFence — the one entry point every code block goes through (T095, the #392 slot)', () => {
  it('returns an escaped <code> carrying the first word of the info string, cut at a colon', () => {
    expect(renderFence('ts:line-numbers {1}', 'a < b')).toBe('<code data-lang="ts">a &lt; b</code>');
  });

  it('escapes a hostile info word', () => {
    expect(renderFence('a"onmouseover=x', 'x')).toBe('<code data-lang="a&quot;onmouseover=x">x</code>');
  });

  it('is what the fence rule renders inside its <pre>', () => {
    expect(html('```yaml\nk: v\n```')).toContain(`<pre data-source-line="0">${renderFence('yaml', 'k: v\n')}</pre>`);
  });
});

describe('front matter renders as a key/value table, never as Markdown (FR-085)', () => {
  const out = html(fixture('front-matter.md'));

  it('draws one table before the body, anchored at line 0', () => {
    const tables = openTags(out, 'table');
    expect(tables).toHaveLength(1);
    expect(attr(tables[0], 'data-source-line')).toBe('0');
    expect(out.indexOf('<table')).toBeLessThan(out.indexOf('<h1'));
  });

  it('shows each scalar value as text beside its key', () => {
    expect(out).toContain('<tr><th>title</th><td>Front matter fixture</td></tr>');
    expect(out).toContain('<tr><th>draft</th><td>false</td></tr>');
    expect(out).toContain('<tr><th>order</th><td>3</td></tr>');
  });

  it('shows a nested mapping and a sequence as their YAML source, as code', () => {
    expect(out).toContain(`<tr><th>nested</th><td><pre>${renderFence('yaml', 'key: value\nanother: 42')}</pre></td></tr>`);
    expect(out).toContain(`<tr><th>tags</th><td><pre>${renderFence('yaml', '- alpha\n- beta\n- gamma')}</pre></td></tr>`);
  });

  it('renders none of the block as Markdown: no rule, no setext heading from the closing fence', () => {
    expect(openTags(out, 'hr')).toHaveLength(0);
    expect(openTags(out, 'h2')).toHaveLength(0);
  });

  it('offsets every body anchor by the front matter lines, so data-source-line is the document line', () => {
    // `# Front matter fixture` is the 14th line of the file: 0-based line 13.
    expect(openTags(out, 'h1').map((t) => attr(t, 'data-source-line'))).toEqual(['13']);
  });

  it('records the heading slug under its DOCUMENT line for the sanitiser', () => {
    const sanitise = vi.fn((o: string, _context: PipelineContext) => o);
    createMarkdownPipeline(sanitise).render(fixture('front-matter.md'));
    expect([...sanitise.mock.calls[0][1].headingSlugs.entries()]).toEqual([[13, 'front-matter-fixture']]);
  });

  it('escapes keys and values', () => {
    const escaped = html('---\n"<b>k</b>": <script>alert(1)</script>\n---\n');
    expect(escaped).toContain('<th>&lt;b&gt;k&lt;/b&gt;</th><td>&lt;script&gt;alert(1)&lt;/script&gt;</td>');
    expect(escaped).not.toContain('<script>');
  });
});

describe('front matter that is not a valid mapping renders as a code block of its source (FR-085)', () => {
  it('invalid YAML → an escaped yaml code block, and the body still renders beneath it', () => {
    const out = html(fixture('front-matter-invalid.md'));
    expect(openTags(out, 'table')).toHaveLength(0);
    const source = 'title: Broken front matter\nnested:\n  key: value\n bad_indent: oops\nlist: [unclosed';
    expect(out).toContain(`<pre data-source-line="0">${renderFence('yaml', source)}</pre>`);
    expect(out).toMatch(/<h1 data-source-line="8"[^>]*>Body after invalid front matter<\/h1>/);
  });

  it.each([
    ['a sequence', '- a\n- b'],
    ['a bare scalar', 'just text'],
  ])('%s → a code block, not a table', (_name, source) => {
    const out = html(`---\n${source}\n---\n\n# Body`);
    expect(openTags(out, 'table')).toHaveLength(0);
    expect(out).toContain(`<pre data-source-line="0">${renderFence('yaml', source)}</pre>`);
  });

  it('escapes the source of an invalid block', () => {
    const out = html('---\n<img src=x onerror=alert(1)>: [\n---\n');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

/**
 * A file a Windows author saved has CRLF line endings, and one from a classic Mac editor has lone CRs.
 * markdown-it's own `normalize` rule folds both to LF before it parses, so the BODY has never carried a
 * carriage return into the HTML — but the front matter block never reaches markdown-it: the pipeline
 * slices it out with core's `splitFrontMatter`, whose source is a faithful slice of the document
 * (`front-matter.test.ts` pins that), and renders it itself.
 *
 * So the rule these pin is the one the body already kept: THE HTML A DOCUMENT PRODUCES DOES NOT DEPEND
 * ON HOW ITS LINES END. That matters twice over — the source of an invalid block is text the reader
 * sees (FR-085), and the block is handed to `yaml.parseDocument`, so a line-ending quirk there would
 * turn a perfectly good table into a code block.
 */
describe("a document's line endings never reach the HTML (FR-085)", () => {
  /** Two renders differ by their random `data-heading-nonce`; everything else must match. */
  const stable = (out: string): string => out.replace(/data-heading-nonce="[0-9a-f]+"/g, 'data-heading-nonce="N"');

  const DOC = '---\ntitle: Front matter\nnested:\n  key: value\n  another: 42\n---\n\n# Body\n\nA paragraph.\n';
  const INVALID = '---\ntitle: Broken\n bad_indent: oops\nlist: [unclosed\n---\n\n# Body after invalid front matter\n';

  it.each([
    ['CRLF', '\r\n'],
    ['a lone CR', '\r'],
  ])('renders a %s document exactly as the same document with LF', (_name, br) => {
    expect(stable(html(DOC.replace(/\n/g, br)))).toBe(stable(html(DOC)));
    expect(stable(html(INVALID.replace(/\n/g, br)))).toBe(stable(html(INVALID)));
  });

  it('puts no carriage return in the code block of an invalid CRLF block', () => {
    const out = html(INVALID.replace(/\n/g, '\r\n'));
    expect(out).not.toContain('\r');
    expect(out).toContain(
      `<pre data-source-line="0">${renderFence('yaml', 'title: Broken\n bad_indent: oops\nlist: [unclosed')}</pre>`,
    );
  });

  it('puts no carriage return in a nested value of a CRLF table', () => {
    const out = html(DOC.replace(/\n/g, '\r\n'));
    expect(out).not.toContain('\r');
    expect(out).toContain(`<tr><th>nested</th><td><pre>${renderFence('yaml', 'key: value\nanother: 42')}</pre></td></tr>`);
  });
});
