/**
 * 054 — which references embed a Mermaid file (manual test decision, 2026-10-11): only a Mermaid
 * extension with no scheme, so no normal link or image changes meaning.
 */
import { describe, expect, it } from 'vitest';
import { embedRefusalText, isMermaidEmbedRef } from '../../src/preview/embeds.js';

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

describe('embedRefusalText', () => {
  it('names the reference as written for each refusal', () => {
    expect(embedRefusalText('a.mmd', 'missing')).toBe('Embedded diagram not found: a.mmd');
    expect(embedRefusalText('../a.mmd', 'outside')).toBe('Embedded diagram is outside the project: ../a.mmd');
    expect(embedRefusalText('a.mmd', 'too-large')).toContain('too large');
  });
});
