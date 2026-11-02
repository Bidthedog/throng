import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LinkResolution, LinkResolutionRequest, ResolvedLink } from '@throng/core';
import {
  editorLinkExtension,
  type EditorLinkDeps,
} from '../../src/renderer/editor/link-decorations.js';

/**
 * (The pure scan — which paths are decorated, the visible-range bound — is `unit/link-decorations-scan.test.ts`;
 * this file keeps what needs a mounted view.)
 *
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
 * 045 T151 — FR-123 in editors asked that a late answer redecorate an untouched view. Round four
 * (T263, FR-155) has no answer to be late: a mounted view marks a path on a slow share on its FIRST
 * paint, and a bridge that never answers changes nothing.
 */
describe('T151, superseded by FR-155 — a path on a slow share is marked on the first paint', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'throng');
    document.body.innerHTML = '';
  });

  it('marked at once, with a resolve that would take 3 s never called', () => {
    const resolve = vi.fn(() => new Promise<LinkResolution>(() => {}));
    Reflect.set(window, 'throng', { links: { resolve } });
    const { deps } = resolverFor({});
    const { view, parent } = mountView('see src/foo.ts here', deps);

    const marked = [...parent.querySelectorAll('.cm-throng-link')].map((el) => el.textContent);
    expect(marked).toEqual(['src/foo.ts']);
    expect(resolve).not.toHaveBeenCalled();
    view.destroy();
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

  /*
   * 045 T238 — FR-164 supersedes FR-135's third row: the hand shows on EVERY hover of a valid link,
   * with or without the modifier. This case used to assert the opposite (no pointer at rest, the hand
   * only under the modifier-held class); FR-164 withdrew that row.
   */
  it('FR-164: the link mark carries the hand pointer with no modifier held', () => {
    const { deps } = resolverFor({ 'src/foo.ts': link() });
    const { view } = mountView('see src/foo.ts here', deps);

    const rule = atRestRule();
    expect(rule, 'an at-rest rule for .cm-throng-link is mounted').toBeDefined();
    expect(rule!.body, 'the unqualified link rule gives the hand').toMatch(/cursor\s*:\s*pointer/);
    for (const r of linkRules().filter((x) => /cursor\s*:\s*pointer/.test(x.body))) {
      expect(r.selector, 'no pointer rule waits for the modifier').not.toMatch(/linkHeld/);
    }
    view.destroy();
  });
});

describe('the switch is the compartment’s CONTENT (FR-060)', () => {
  // DELETED: 'with detection off the extension is empty' — link-detection-switches.test.ts asserts
  // `editorLinkExtension(null)` toEqual([]) ('the compartment’s off position holds NOTHING').

  it('with detection on it is not empty', () => {
    const { deps } = resolverFor({});
    const on = editorLinkExtension(deps);
    expect(Array.isArray(on) ? on.length : 1).toBeGreaterThan(0);
  });
});
