import { describe, expect, it, vi } from 'vitest';
import { createMarkdownPipeline, type PipelineContext } from '../../src/renderer/preview/providers/markdown/pipeline.js';

/**
 * 075 FR-001 – FR-006, FR-012, FR-013, FR-015, FR-016 — the callout markup the pipeline emits, as markdown-it's
 * HTML STRING before the sanitiser (a spy that hands back what it was given stands in for it).
 *
 * This is also FR-015's pin of `markdown-it-obsidian-callouts` against the markdown-it throng ships: a parser
 * or engine upgrade that changes how any of these forms is read fails here.
 */
function render(text: string): { html: string; context: PipelineContext } {
  let seen: PipelineContext | undefined;
  const sanitise = vi.fn((out: string, context: PipelineContext) => {
    seen = context;
    return out;
  });
  const html = createMarkdownPipeline(sanitise).render(text).fragment;
  return { html, context: seen as PipelineContext };
}

const html = (text: string): string => render(text).html;
const squash = (text: string): string => text.replace(/\n/g, '');

/** The opening tags carrying `data-callout=` in `out`. */
const callouts = (out: string): string[] => out.match(/<div data-callout="[^"]*"[^>]*>/g) ?? [];

const attr = (tag: string, name: string): string | null => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

describe('callout syntax (FR-001, FR-002)', () => {
  it('renders a typed blockquote as a callout with its title, the marker gone', () => {
    const out = html('> [!info] Clarification\n> The body.\n');
    expect(callouts(out)).toHaveLength(1);
    expect(attr(callouts(out)[0], 'data-callout')).toBe('info');
    expect(squash(out)).toContain('<span data-callout-title-text>Clarification</span>');
    expect(squash(out)).toMatch(/<div data-callout-body><p[^>]*>The body.<\/p><\/div>/);
    expect(out).not.toContain('[!info]');
    expect(out).not.toContain('<blockquote');
  });

  it('matches the type case-insensitively', () => {
    for (const marker of ['[!NOTE]', '[!Note]', '[!note]']) {
      expect(attr(callouts(html(`> ${marker}\n> x\n`))[0], 'data-callout'), marker).toBe('note');
    }
  });

  it('carries the canonical type for an alias, titled as written', () => {
    const out = html('> [!check]\n> done\n');
    expect(attr(callouts(out)[0], 'data-callout')).toBe('success');
    expect(attr(callouts(out)[0], 'data-callout-role')).toBe('success');
    expect(attr(callouts(html('> [!faq]\n> x\n'))[0], 'data-callout-role')).toBe('question');
    expect(out).toContain('<span data-callout-title-text>Check</span>');
  });

  it('renders an unknown type as note with its own title', () => {
    const out = html('> [!banana] Ripe\n> yellow\n');
    expect(attr(callouts(out)[0], 'data-callout')).toBe('note');
    expect(out).toContain('<span data-callout-title-text>Ripe</span>');
  });

  it('renders a title-only callout with no body area at all (FR-003)', () => {
    const out = html('> [!warning]\n');
    expect(attr(callouts(out)[0], 'data-callout')).toBe('warning');
    expect(out).toContain('<span data-callout-title-text>Warning</span>');
    expect(out).not.toContain('data-callout-body');
    expect(out).not.toMatch(/<p[^>]*><\/p>/);
  });

  it('renders inline Markdown in a title', () => {
    expect(html('> [!tip] Use **this**\n> x\n')).toContain('<span data-callout-title-text>Use <strong>this</strong></span>');
  });

  it('reads `[!info]Title` with no space as the title "Title" (pinned)', () => {
    expect(html('> [!info]Title\n> x\n')).toContain('<span data-callout-title-text>Title</span>');
  });

  it('leaves a plain blockquote exactly as before', () => {
    const out = html('> Just a quote.\n');
    expect(out).toMatch(/^<blockquote data-source-line="0">\s*<p data-source-line="0">Just a quote.<\/p>\s*<\/blockquote>/);
    expect(out).not.toContain('data-callout');
  });

  it('leaves a marker on the second line as text in a plain blockquote', () => {
    const out = html('> First line.\n> [!info] not a marker\n');
    expect(out).toContain('<blockquote');
    expect(out).not.toContain('data-callout');
    expect(out).toContain('[!info] not a marker');
  });

  it('escapes a hostile type and title rather than emitting them as markup', () => {
    const out = html('> [!<img src=x onerror=alert(1)>] <script>alert(2)</script>\n> x\n');
    expect(attr(callouts(out)[0] ?? '', 'data-callout')).toBe('note');
    expect(out).not.toMatch(/<img src=x/);
    expect(out).not.toContain('data-callout="<');
  });
});

describe('callout folding and nesting (FR-005, FR-006)', () => {
  it('marks `-` closed, `+` open, and no sign as not foldable', () => {
    expect(attr(callouts(html('> [!tip]-\n> x\n'))[0], 'data-callout-fold')).toBe('closed');
    expect(attr(callouts(html('> [!tip]+\n> x\n'))[0], 'data-callout-fold')).toBe('open');
    expect(attr(callouts(html('> [!tip]\n> x\n'))[0], 'data-callout-fold')).toBeNull();
  });

  it('nests a callout inside a callout, to any depth', () => {
    const out = html('> [!example] Outer\n> > [!warning] Middle\n> > > [!bug] Inner\n> > > deep\n');
    expect(callouts(out).map((t) => attr(t, 'data-callout'))).toEqual(['example', 'warning', 'bug']);
    expect(squash(out)).toMatch(/data-callout="example"[^]*data-callout-body>[^]*data-callout="warning"[^]*data-callout-body>[^]*data-callout="bug"/);
  });

  it('renders a Mermaid diagram and a display equation in a callout as it does outside one (US2/AS4)', () => {
    // Maths on, as the provider's Typeset math setting ships (075 FR-042); otherwise $$ stays literal and proves nothing.
    const env = { panelId: 'p', docPath: '/proj/a.md', projectRoot: '/proj', remoteImages: false, typesetMath: true };
    const out = (text: string): string =>
      squash(createMarkdownPipeline((h: string) => h).render(text, env).fragment).replace(/ data-source-line="\d+"/g, '');
    for (const block of ['```mermaid\ngraph TD; A-->B\n```', '$$\nx^2 + y^2\n$$']) {
      const plain = out(`${block}\n`).trim();
      expect(plain, `${block} was not recognised on its own`).not.toMatch(/^<p>/);
      const quoted = block.split('\n').map((l) => `> ${l}`).join('\n');
      expect(out(`> [!note] T\n${quoted}\n`), `${block} inside a callout`).toContain(plain);
    }
  });

  it('renders the body as ordinary Markdown: list, task, code, link (FR-004)', () => {
    const out = html('> [!note]\n> - [ ] task\n> - item\n>\n> ```js\n> x()\n> ```\n>\n> [link](a.md)\n');
    expect(out).toMatch(/<input type="checkbox" data-task-line="1"/);
    expect(out).toContain('<code data-lang="js">x()\n</code>');
    expect(out).toMatch(/<a href="a.md">link<\/a>/);
  });
});

describe('source lines (FR-012)', () => {
  it('maps the callout and every block in it to the line a plain blockquote would', () => {
    const doc = 'Intro\n\n> [!note] T\n> first\n>\n> second\n';
    const plain = html(doc.replace('[!note] T', 'T'));
    const out = html(doc);
    expect(attr(callouts(out)[0], 'data-source-line')).toBe('2');
    const lines = (s: string): string[] => [...s.matchAll(/<p data-source-line="(\d+)"/g)].map((m) => m[1]);
    // The plain blockquote's first paragraph holds the title line; the callout's body starts on the same line.
    expect(lines(out)).toEqual(lines(plain));
  });

  it('carries this render\'s nonce on every callout the pipeline emitted', () => {
    const { html: out, context } = render('> [!note]\n> x\n');
    expect(attr(callouts(out)[0], 'data-heading-nonce')).toBe(context.headingNonce);
  });
});

describe('admonition fences stay code (FR-016)', () => {
  it('renders ```ad-note as an ordinary fenced code block', () => {
    const out = html('```ad-note\ntitle: T\nbody\n```\n');
    expect(out).toContain('<code data-lang="ad-note">title: T\nbody\n</code>');
    expect(out).not.toContain('data-callout');
    expect(out).not.toContain('class="callout"');
  });
});

describe('the parser package reaches nothing (FR-013)', () => {
  it('emits none of its classes, icons or data-callout aliases', () => {
    const out = html('> [!caution]- Look\n> x\n');
    expect(out).not.toContain('class=');
    expect(out).not.toContain('<svg');
    expect(out).not.toContain('<details');
    expect(attr(callouts(out)[0], 'data-callout')).toBe('warning');
  });
});
