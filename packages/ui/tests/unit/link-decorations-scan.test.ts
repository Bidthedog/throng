import { EditorState } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import type { LinkResolution, LinkResolutionRequest, ResolvedLink } from '@throng/core';
import {
  buildLinkDecorations,
  type EditorLinkDeps,
  type LinkScanView,
} from '../../src/renderer/editor/link-decorations.js';
import { linkFirstReadingByName } from '../../src/renderer/links/path-by-name.js';

/**
 * 045 FR-002, FR-060, FR-070, FR-071, FR-073 — what an editor underlines (T089).
 *
 * ══ THE SUBJECT IS A FUNCTION, NOT A MOUNTED VIEW ══
 *
 * jsdom has no layout: every rect is 0×0, so a real `EditorView`'s viewport is not a measurement of
 * anything and `view.visibleRanges` would answer the same thing for a four-line document and a
 * forty-thousand-line one. FR-073's whole claim is that the scan is bounded by that range — so the
 * range is SUPPLIED here, and what is asserted is that nothing outside it is ever looked at. The
 * measurement itself is CodeMirror's and is not throng's to re-prove.
 *
 * ══ ROUND FOUR: VALIDITY IS SYNTACTIC (FR-155) ══
 *
 * FR-006 used to make a path a link only once throng had found the file. The maintainer ruled the
 * other way (M1): a link is drawn when the grammar accepts it, and resolved when it is followed. Prose
 * (`e.g.`, `1.2.3`) stays unmarked because the grammar refuses it, not because a check failed.
 */

const link = (over: Partial<ResolvedLink> = {}): ResolvedLink => ({
  path: 'D:\\project\\src\\foo.ts',
  kind: 'file',
  inProject: true,
  executable: false,
  preview: 'none',
  ...over,
});

const site = { panelId: 'panel-1', originProjectId: 'project-1', baseDirectory: 'D:\\project' };

/** A view CodeMirror would give us, minus everything that needs a browser. */
function view(doc: string, visible?: { from: number; to: number }[]): LinkScanView {
  const state = EditorState.create({ doc });
  return { state, visibleRanges: visible ?? [{ from: 0, to: state.doc.length }] };
}

/**
 * The editor's deps, handed a COUNTING resolver in the slot it used to have (`ask`), so a build that
 * still asked would be counted rather than silently starved. Round four (T263, FR-155): it is never
 * called — the answers below exist only to prove they make no difference.
 */
function resolverFor(known: Record<string, ResolvedLink | false>): {
  deps: EditorLinkDeps;
  asked: string[];
  ask: ReturnType<typeof vi.fn>;
} {
  const asked: string[] = [];
  const ask = vi.fn((request: LinkResolutionRequest): LinkResolution | undefined => {
    asked.push(request.text);
    const answer = known[request.text];
    if (answer === undefined) return undefined;
    return answer === false ? { ok: false } : { ok: true, link: answer };
  });
  return { deps: { site: () => site, ask, follow: vi.fn() } as EditorLinkDeps, asked, ask };
}

/** Every decorated span, as `[from, to]` pairs. */
function marks(set: ReturnType<typeof buildLinkDecorations>): [number, number][] {
  const out: [number, number][] = [];
  const iter = set.iter();
  while (iter.value !== null) {
    out.push([iter.from, iter.to]);
    iter.next();
  }
  return out;
}

/*
 * *Round four (T263; FR-155 supersedes FR-006 / FR-071 for rendering):* this block asserted that only a
 * RESOLVED path was decorated, that nothing was drawn while the answer was unknown, and that every
 * candidate was asked about. Validity is syntactic now: every path the grammar accepts is decorated on
 * the first pass, whatever exists at it, and nothing is asked — prose stays unmarked by the grammar
 * alone (SC-003), not by a failed existence check.
 */
describe('every path the grammar accepts is decorated, and nothing is asked (FR-002, FR-155)', () => {
  it('underlines a path that exists and one that does not, alike', () => {
    const doc = 'see src/foo.ts and nope/missing.ts here';
    const { deps, asked } = resolverFor({ 'src/foo.ts': link(), 'nope/missing.ts': false });

    expect(marks(buildLinkDecorations(view(doc), deps))).toEqual([
      [doc.indexOf('src/foo.ts'), doc.indexOf('src/foo.ts') + 'src/foo.ts'.length],
      [doc.indexOf('nope/missing.ts'), doc.indexOf('nope/missing.ts') + 'nope/missing.ts'.length],
    ]);
    expect(asked, 'drawing asks main nothing (SC-021)').toEqual([]);
  });

  // DELETED: 'draws it on the FIRST pass, with no answer anywhere' — the test above marks both paths
  // on a single `buildLinkDecorations` call with no answer known for one of them and asserts `asked`.

  it('leaves prose unmarked by the grammar alone (SC-003)', () => {
    const { deps } = resolverFor({});
    expect(marks(buildLinkDecorations(view('e.g. version 1.2.3 is fine, i.e. not a path'), deps))).toEqual([]);
  });

  it('the mark’s native title is the link’s own target, read by name — not a gesture hint (round five, FR-042)', () => {
    const { deps } = resolverFor({ 'src/foo.ts': link() });
    const set = buildLinkDecorations(view('see src/foo.ts here'), deps);
    const iter = set.iter();
    const spec = iter.value?.spec as { attributes?: Record<string, string>; class?: string };
    expect(spec.class).toContain('cm-throng-link');
    // FR-155: nothing is resolved to word a link — `linkFirstReadingByName` is the SAME by-name
    // reading the status-strip readout shows, over the same `site.baseDirectory`.
    expect(spec.attributes?.title).toBe(
      linkFirstReadingByName({ text: 'src/foo.ts', baseDirectory: site.baseDirectory, projectRoot: null }),
    );
    expect(spec.attributes?.title ?? '').not.toMatch(/click/i);
  });

  it('a web link’s title is its address, verbatim — not the click-hint wording', () => {
    const { deps } = resolverFor({});
    const set = buildLinkDecorations(view('see https://example.com/x here'), deps);
    const iter = set.iter();
    const spec = iter.value?.spec as { attributes?: Record<string, string> };
    expect(spec.attributes?.title).toBe('https://example.com/x');
  });
});

describe('the scan is bounded by the visible range (FR-073)', () => {
  const DOC = [
    'first src/foo.ts line',
    'padding',
    'padding',
    'padding',
    'last src/foo.ts line',
  ].join('\n');

  it('decorates only inside the range it was given', () => {
    const { deps } = resolverFor({ 'src/foo.ts': link() });
    const firstLineEnd = DOC.indexOf('\n');

    const decorated = marks(buildLinkDecorations(view(DOC, [{ from: 0, to: firstLineEnd }]), deps));

    expect(decorated).toHaveLength(1);
    expect(decorated[0]![0]).toBeLessThan(firstLineEnd);
  });

  // DELETED: 'never asks about any candidate' — 'underlines a path that exists and one that does
  // not, alike' asserts `asked` is empty after a build, and the T151 mount test asserts no resolve.

  it('decorates both when both are visible', () => {
    const { deps } = resolverFor({ 'src/foo.ts': link() });
    expect(marks(buildLinkDecorations(view(DOC), deps))).toHaveLength(2);
  });
});

