import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LinkResolution, LinkResolutionRequest, ResolvedLink } from '@throng/core';
import {
  buildLinkDecorations,
  editorLinkExtension,
  setLinkAnswerSubscriber,
  type EditorLinkDeps,
  type LinkScanView,
} from '../../src/renderer/editor/link-decorations.js';
import {
  __resetLinkCacheForTests,
  peekLink,
  requestLink,
  subscribeLinkCache,
} from '../../src/renderer/links/link-cache.js';

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

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * Mounted-view helpers for T151 and T180
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Both of these need a REAL `EditorView`: T151 because the question is whether an answer landing
 * later repaints a view nobody is touching, and T180 because the affordance is the theme CodeMirror
 * mounts. jsdom mounts a view (see `helpers/mount-editor.ts`'s header); what it cannot do is measure
 * text, so the two Range methods CodeMirror's selection layer reaches for are stubbed, exactly as
 * that helper does.
 */
function shimRangeGeometry(): void {
  const proto = globalThis.Range?.prototype as unknown as Record<string, unknown> | undefined;
  if (proto && typeof proto.getClientRects !== 'function') {
    proto.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
    proto.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
  }
}

function mountView(doc: string, deps: EditorLinkDeps): { view: EditorView; parent: HTMLElement } {
  shimRangeGeometry();
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [editorLinkExtension(deps)] }),
    parent,
  });
  return { view, parent };
}

/** Every CSS rule CodeMirror mounted whose selector mentions `.cm-throng-link`, as `{ selector, body }`. */
function linkRules(): { selector: string; body: string }[] {
  const text = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
  const rules: { selector: string; body: string }[] = [];
  for (const chunk of text.split('}')) {
    const open = chunk.indexOf('{');
    if (open < 0) continue;
    const selector = chunk.slice(0, open).trim();
    if (!selector.includes('.cm-throng-link')) continue;
    rules.push({ selector, body: chunk.slice(open + 1).trim() });
  }
  return rules;
}

/** The at-rest rule: `.cm-throng-link` with no pseudo-class and no qualifying modifier class. */
function atRestRule(): { selector: string; body: string } | undefined {
  return linkRules().find((r) => /\.cm-throng-link$/.test(r.selector.split(',')[0]!.trim()) && !r.selector.includes(':'));
}

/**
 * 045 T151 — FR-123 in editors: a late answer redecorates with NO edit, scroll or pointer movement.
 *
 * Expected to PASS on first run: the plugin already subscribes to the cache and repaints when an
 * answer lands. If it does, it is kept as a characterisation pin and no GREEN task follows (T151).
 */
describe('T151 / FR-123 — a late answer redecorates an untouched editor', () => {
  afterEach(() => {
    __resetLinkCacheForTests();
    setLinkAnswerSubscriber(() => () => {});
    Reflect.deleteProperty(window, 'throng');
    document.body.innerHTML = '';
  });

  it('a path whose answer lands 3 s later becomes a link with nothing else happening', async () => {
    vi.useFakeTimers();
    try {
      __resetLinkCacheForTests();
      setLinkAnswerSubscriber(subscribeLinkCache);
      Reflect.set(window, 'throng', {
        links: {
          // A slow share: the answer takes far longer than the first paint.
          resolve: (request: LinkResolutionRequest): Promise<LinkResolution> =>
            new Promise((resolve) =>
              setTimeout(
                () => resolve(request.text === 'src/foo.ts' ? { ok: true, link: link() } : { ok: false }),
                3000,
              ),
            ),
        },
      });
      const deps: EditorLinkDeps = {
        site: () => site,
        ask: (request) => {
          const cached = peekLink(request);
          if (cached === undefined) requestLink(request);
          return cached;
        },
        follow: vi.fn(),
      };
      const { view, parent } = mountView('see src/foo.ts here', deps);
      expect(parent.querySelectorAll('.cm-throng-link'), 'nothing is a link before the answer').toHaveLength(0);

      // No dispatch, no scroll, no pointer: only time passes and the answer lands.
      await vi.advanceTimersByTimeAsync(3000);

      const marked = [...parent.querySelectorAll('.cm-throng-link')].map((el) => el.textContent);
      expect(marked, 'the late answer must reach the view that asked').toEqual(['src/foo.ts']);
      view.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * 045 T180 — FR-135, FR-136, FR-138: one affordance, marked at rest (second round).
 *
 * The colour assertions the file used to imply (the accent-coloured text of 045's first cut) are
 * superseded as the second round permits: a link is marked with a DASHED underline in the
 * `linkUnderline` token at rest and a SOLID one in `linkUnderlineHover` on hover, the text's own
 * colour is left alone (FR-008; an editor's syntax colours must win), and the hand pointer appears
 * only while the modifier is held, because that is the only time a click follows (FR-040).
 *
 * What the user sees today: link text recoloured in the accent, a solid underline at rest, and a
 * hand pointer over every link whether or not a click would follow it — and a web URL in an editor
 * not marked at all.
 */
describe('T180 / FR-135 – FR-138 — the editor’s link affordance', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('a resolved file link and a web link carry the SAME mark', () => {
    const doc = 'see src/foo.ts and https://example.com/x here';
    const { deps } = resolverFor({ 'src/foo.ts': link() });
    const { view, parent } = mountView(doc, deps);

    const marked = [...parent.querySelectorAll('.cm-throng-link')].map((el) => el.textContent);
    expect(marked).toEqual(['src/foo.ts', 'https://example.com/x']);
    view.destroy();
  });

  it('at rest: a DASHED underline in var(--throng-colour-linkUnderline)', () => {
    const { deps } = resolverFor({ 'src/foo.ts': link() });
    const { view } = mountView('see src/foo.ts here', deps);

    const rule = atRestRule();
    expect(rule, 'an at-rest rule for .cm-throng-link is mounted').toBeDefined();
    expect(rule!.body).toMatch(/dashed/);
    expect(rule!.body).toContain('var(--throng-colour-linkUnderline)');
    view.destroy();
  });

  it('on hover: a SOLID underline in var(--throng-colour-linkUnderlineHover)', () => {
    const { deps } = resolverFor({ 'src/foo.ts': link() });
    const { view } = mountView('see src/foo.ts here', deps);

    const hover = linkRules().find((r) => r.selector.includes(':hover'));
    expect(hover, 'a hover rule for .cm-throng-link is mounted').toBeDefined();
    expect(hover!.body).toMatch(/solid/);
    expect(hover!.body).toContain('var(--throng-colour-linkUnderlineHover)');
    view.destroy();
  });

  it('sets NO text colour, at rest or on hover (FR-135: the text’s own colour is unchanged)', () => {
    const { deps } = resolverFor({ 'src/foo.ts': link() });
    const { view } = mountView('see src/foo.ts here', deps);

    for (const rule of linkRules()) {
      // `text-decoration-color` is the underline and is expected; a bare `color` is the text.
      expect(rule.body, rule.selector).not.toMatch(/(^|[;{\s])color\s*:/);
    }
    view.destroy();
  });

  it('the hand pointer is NOT part of the at-rest mark — it belongs to the modifier-held state only', () => {
    const { deps } = resolverFor({ 'src/foo.ts': link() });
    const { view } = mountView('see src/foo.ts here', deps);

    const rule = atRestRule();
    expect(rule, 'an at-rest rule for .cm-throng-link is mounted').toBeDefined();
    expect(rule!.body, 'a pointer at rest says "click me" when a click would not follow').not.toMatch(
      /cursor\s*:\s*pointer/,
    );
    const pointerRules = linkRules().filter((r) => /cursor\s*:\s*pointer/.test(r.body));
    expect(
      pointerRules.length,
      'some rule, qualified by the modifier-held state, still gives the hand pointer',
    ).toBeGreaterThan(0);
    for (const r of pointerRules) {
      expect(r.selector, 'the pointer rule is qualified by more than the link class').not.toMatch(
        /^[^\s,]*\s*\.cm-throng-link$/,
      );
    }
    view.destroy();
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
