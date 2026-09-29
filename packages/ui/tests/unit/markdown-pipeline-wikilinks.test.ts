import { describe, expect, it, vi } from 'vitest';
import { createMarkdownPipeline, type PipelineContext } from '../../src/renderer/preview/providers/markdown/pipeline.js';

/**
 * 047 T061 (R12, FR-050, FR-056) — the `throng_wikilinks` inline rule, over the pipeline's raw HTML
 * string (the sanitiser is a spy that returns what it was handed, as `markdown-pipeline.test.ts` does):
 * every form renders as an ordinary `<a data-throng-wiki-href="...">` link (never a real `href` at
 * this stage — `wikilinks.ts`'s own comment on `WIKI_HREF_ATTRIBUTE` says why) with the alias or the
 * target's name as its text, `[[…]]` inside code stays literal, and `![[…]]` is never touched.
 * `preview-wikilinks-sanitise.test.ts` proves the REAL sanitiser turns this into a followable link.
 */

function spyPipeline() {
  const sanitise = vi.fn((html: string, _context: PipelineContext) => html);
  return { pipeline: createMarkdownPipeline(sanitise), sanitise };
}

function html(text: string): string {
  return spyPipeline().pipeline.render(text).fragment;
}

/** The single `<a ...>text</a>` in `out`, or `null` if there is none. */
function link(out: string): { attrs: string; text: string } | null {
  const m = /<a([^>]*)>([^<]*)<\/a>/.exec(out);
  return m ? { attrs: m[1], text: m[2] } : null;
}

/** The wikilink's logical href — `throng-wiki:` plus whatever `data-throng-wiki-href` carries. */
function href(out: string): string | null {
  const m = /data-throng-wiki-href="([^"]*)"/.exec(link(out)?.attrs ?? '');
  return m ? `throng-wiki:${m[1]}` : null;
}

describe('the four forms render as links (FR-050)', () => {
  it('[[Target]] — href encodes the path, text is the target’s name', () => {
    const out = html('[[Note]]');
    expect(href(out)).toBe('throng-wiki:Note');
    expect(link(out)?.text).toBe('Note');
  });

  it('[[Target|Alias]] — text is the alias, href unaffected', () => {
    const out = html('[[Note|My Alias]]');
    expect(href(out)).toBe('throng-wiki:Note');
    expect(link(out)?.text).toBe('My Alias');
  });

  it('[[Target#Heading]] — href carries the fragment, text is still the target’s name', () => {
    const out = html('[[Note#Install]]');
    expect(href(out)).toBe('throng-wiki:Note#Install');
    expect(link(out)?.text).toBe('Note');
  });

  it('[[#Heading]] — no path, href is fragment-only, text falls back to the fragment', () => {
    const out = html('[[#Install]]');
    expect(href(out)).toBe('throng-wiki:#Install');
    expect(link(out)?.text).toBe('Install');
  });

  it('a nested target shows only its last segment, without extension', () => {
    const out = html('[[notes/Sub Folder/My Note.md]]');
    expect(link(out)?.text).toBe('My Note');
  });

  it('a rooted target ([[/docs/README]]) encodes the leading / into the path', () => {
    const out = html('[[/docs/README]]');
    expect(href(out)).toBe('throng-wiki:%2Fdocs%2FREADME');
    expect(decodeURIComponent(href(out)!.slice('throng-wiki:'.length))).toBe('/docs/README');
  });

  it('a relative parent target ([[../README]]) round-trips through the encoding', () => {
    const out = html('[[../README]]');
    expect(decodeURIComponent(href(out)!.slice('throng-wiki:'.length))).toBe('../README');
    expect(link(out)?.text).toBe('README');
  });

  it('a target naming a real extension is unaffected by resolution rules at this layer — text still strips it', () => {
    const out = html('[[notes/report.pdf]]');
    expect(link(out)?.text).toBe('report');
  });
});

describe('[[Target#^block]] drops the block id (FR-056)', () => {
  it('links to Target, and the fragment carries nothing', () => {
    const out = html('[[Note#^abc123]]');
    expect(href(out)).toBe('throng-wiki:Note');
    expect(link(out)?.text).toBe('Note');
  });
});

describe('literal cases (FR-050, FR-056)', () => {
  it('[[…]] inside inline code stays literal', () => {
    const out = html('`[[Note]]`');
    expect(out).not.toContain('<a ');
    expect(out).toContain('[[Note]]');
  });

  it('[[…]] inside a fenced code block stays literal', () => {
    const out = html('```\n[[Note]]\n```');
    expect(out).not.toContain('<a ');
    expect(out).toContain('[[Note]]');
  });

  it('![[…]] (an embed) is left untouched — no link, brackets and bang intact', () => {
    const out = html('![[Note]]');
    expect(out).not.toContain('<a ');
    expect(out).toContain('![[Note]]');
  });

  it('a malformed target ([[]], [[|Alias]]) renders as literal text', () => {
    expect(html('[[]]')).toContain('[[]]');
    expect(html('[[|Alias]]')).not.toContain('<a ');
  });

  it('an unterminated [[ with no closing ]] renders as literal text', () => {
    const out = html('[[Note not closed');
    expect(out).not.toContain('<a ');
    expect(out).toContain('[[Note not closed');
  });
});

describe('agrees with the sanitiser context (heading text over a wikilink, R2)', () => {
  it('a heading containing a wikilink slugs on the ALIAS/name, like an ordinary link', () => {
    const out = html('## See [[Note|My Alias]] for details');
    expect(out).toContain('data-heading-slug="see-my-alias-for-details"');
  });
});
