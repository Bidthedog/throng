import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { MAX_LINK_CANDIDATES_PER_LINE } from '@throng/core';
import { linkHitsBetween, type EditorLinkDeps } from '../../src/renderer/editor/link-decorations.js';

/**
 * 045 FR-071, review round four (L2) — the per-line cap bounds an EDITOR line's declared addresses.
 *
 * `MAX_LINK_CANDIDATES_PER_LINE` bounded `scanned.paths` and nothing else, so the web and allowlisted
 * protocol spans round four added were built unbounded at all three call sites. `limits.ts`'s
 * rationale — "without a cap each one becomes a mark, a decoration and a hit-test entry inside that
 * callback" — applies identically to them, and `detectProtocolSpans` has no cap of its own.
 *
 * The editor is where it is reachable rather than theoretical: a terminal line is bounded by the
 * column count, and an editor line is not. A one-line minified or generated file dense in `mailto:`
 * or `https:` tokens is an ordinary thing to open, and every visible-range rebuild walked all of them.
 */

const SITE = { panelId: 'editor-1', originProjectId: 'project-1', baseDirectory: 'D:\\p' };

const deps = {
  site: () => SITE,
  ask: () => undefined,
  follow: () => {},
  scanOptions: () => ({ allowlist: new Set(['mailto']) }),
} as unknown as EditorLinkDeps;

function hitsFor(doc: string): number {
  const state = EditorState.create({ doc });
  return linkHitsBetween(state, 0, doc.length, deps).length;
}

describe('L2 — one editor line cannot produce unbounded link hits', () => {
  it('5,000 web urls on one line are capped', () => {
    const count = hitsFor(Array.from({ length: 5_000 }, (_, i) => `https://example.com/p${i}`).join(' '));
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(MAX_LINK_CANDIDATES_PER_LINE);
  });

  it('5,000 allowlisted protocol links on one line are capped', () => {
    const count = hitsFor(Array.from({ length: 5_000 }, (_, i) => `mailto:p${i}@example.com`).join(' '));
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(MAX_LINK_CANDIDATES_PER_LINE);
  });

  it('a line with a handful of each still yields every one of them', () => {
    expect(hitsFor('see https://example.com/a and mailto:me@example.com and src/foo.ts')).toBe(3);
  });
});
