import { EditorState } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import type { LinkResolution, LinkResolutionRequest, ResolvedLink } from '@throng/core';
import {
  buildLinkDecorations,
  editorLinkExtension,
  type EditorLinkDeps,
  type LinkScanView,
} from '../../src/renderer/editor/link-decorations.js';

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
 * ══ WHY "ONLY RESOLVED" IS THE FIRST ASSERTION ══
 *
 * FR-006: a path is not a link until throng has found the file. Underlining a candidate before that
 * is the failure the whole feature is arranged to avoid — a page of prose with `e.g.` and `1.2.3`
 * underlined, and a click that does nothing. The cache answers `undefined` for "not known yet"
 * (FR-071), and `undefined` must draw exactly as much as `{ ok: false }` does: nothing.
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

/** A resolver that answers `ok` for the texts it is given and `undefined` for everything else. */
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
  return { deps: { site: () => site, ask, follow: vi.fn() }, asked, ask };
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

describe('only a RESOLVED link is decorated (FR-002, FR-006, FR-071)', () => {
  it('underlines the path that resolved and leaves the one that did not', () => {
    const doc = 'see src/foo.ts and nope/missing.ts here';
    const { deps } = resolverFor({ 'src/foo.ts': link(), 'nope/missing.ts': false });

    expect(marks(buildLinkDecorations(view(doc), deps))).toEqual([
      [doc.indexOf('src/foo.ts'), doc.indexOf('src/foo.ts') + 'src/foo.ts'.length],
    ]);
  });

  it('draws nothing at all while the answer is still unknown (FR-071)', () => {
    const { deps } = resolverFor({});
    expect(marks(buildLinkDecorations(view('see src/foo.ts here'), deps))).toEqual([]);
  });

  it('asks about the candidate even when it draws nothing, so the next pass can draw it', () => {
    const { deps, asked } = resolverFor({});
    buildLinkDecorations(view('see src/foo.ts here'), deps);
    expect(asked).toContain('src/foo.ts');
  });

  it('draws it once the answer lands — the invalidate-then-redraw path (FR-070)', () => {
    const doc = 'see src/foo.ts here';
    const known: Record<string, ResolvedLink | false> = {};
    const { deps } = resolverFor(known);

    expect(marks(buildLinkDecorations(view(doc), deps))).toEqual([]);
    known['src/foo.ts'] = link();
    expect(marks(buildLinkDecorations(view(doc), deps))).toHaveLength(1);
  });

  it('names the gesture on the mark, so a hover says how to follow it (FR-042)', () => {
    const { deps } = resolverFor({ 'src/foo.ts': link() });
    const set = buildLinkDecorations(view('see src/foo.ts here'), deps);
    const iter = set.iter();
    const spec = iter.value?.spec as { attributes?: Record<string, string>; class?: string };
    expect(spec.class).toContain('cm-throng-link');
    expect(spec.attributes?.title ?? '').toMatch(/click/i);
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

  it('never even ASKS about a candidate outside it — the cost is the point, not the paint', () => {
    const { deps, ask } = resolverFor({ 'src/foo.ts': link() });
    buildLinkDecorations(view(DOC, [{ from: 0, to: DOC.indexOf('\n') }]), deps);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('decorates both when both are visible', () => {
    const { deps } = resolverFor({ 'src/foo.ts': link() });
    expect(marks(buildLinkDecorations(view(DOC), deps))).toHaveLength(2);
  });
});

describe('the switch is the compartment’s CONTENT (FR-060)', () => {
  it('with detection off the extension is empty, so nothing can decorate', () => {
    const off = editorLinkExtension(null);
    expect(Array.isArray(off) ? off : [off]).toEqual([]);
  });

  it('with detection on it is not empty', () => {
    const { deps } = resolverFor({});
    const on = editorLinkExtension(deps);
    expect(Array.isArray(on) ? on.length : 1).toBeGreaterThan(0);
  });
});
