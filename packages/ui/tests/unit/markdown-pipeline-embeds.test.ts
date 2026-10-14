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
