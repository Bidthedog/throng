/**
 * 047 T021 — the preview's find text model: what a preview's find bar actually searches over.
 *
 * research.md R1 — a `TreeWalker(SHOW_TEXT)` over the rendered body, concatenated, with a parallel
 * offset → (node, offset) map, so `editorMatches` (the same matcher the editor uses) can run over
 * RENDERED text rather than markdown source (`**bold**` is found as `bold`, FR-002).
 *
 * ══ WHY FAKE NODES ══
 *
 * The unit project runs in Node — no DOM (`scroll-anchor.test.ts`'s precedent). The walk is a decision
 * over a node's type, its children and its attributes; those are the inputs, so a structural fake
 * (`nodeType`, `nodeValue`, `childNodes`, `getAttribute`) stands in for the real `Text`/`Element`, and
 * a real DOM node satisfies the same shape unchanged when this runs against the actual preview body.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPreviewTextModel,
  findPreviewMatches,
  locate,
  type TextModelNode,
} from '../../src/renderer/preview/preview-search-model.js';

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** A fake text node — the leaves the walk collects. */
function text(value: string): TextModelNode {
  return { nodeType: TEXT_NODE, nodeValue: value, childNodes: [] };
}

/** A fake element — attrs as a plain map, so `aria-hidden` and `class` read like the real DOM. */
function el(children: TextModelNode[], attrs: Record<string, string> = {}): TextModelNode {
  return {
    nodeType: ELEMENT_NODE,
    childNodes: children,
    getAttribute: (name: string) => attrs[name] ?? null,
  };
}

describe('buildPreviewTextModel — the walk (R1)', () => {
  it('concatenates every text node in document order', () => {
    const root = el([text('Hello '), el([text('world')]), text('!')]);
    expect(buildPreviewTextModel(root).text).toBe('Hello world!');
  });

  it('finds **bold** as "bold" — the model reads RENDERED text, never markdown source', () => {
    // markdown-it turns **bold** into <strong>bold</strong> long before this walk ever runs; the walk
    // just sees an element with the plain text "bold" inside it, exactly as any other span would.
    const root = el([text('before '), el([text('bold')], { class: 'strong' }), text(' after')]);
    const model = buildPreviewTextModel(root);
    expect(model.text).toBe('before bold after');
    expect(findPreviewMatches(model, 'bold', { caseSensitive: false, wholeWord: false })).toEqual([
      { from: 7, to: 11 },
    ]);
  });

  it('excludes anything aria-hidden — hidden front matter is absent from the model', () => {
    const root = el([
      el([text('title: Example\n')], { 'aria-hidden': 'true' }),
      el([text('# Heading')]),
    ]);
    expect(buildPreviewTextModel(root).text).toBe('# Heading');
  });

  it('excludes fold toggle and gutter controls, never their glyph text', () => {
    const root = el([
      el([text('▾')], { class: 'preview-fold-toggle' }),
      el([text('Section')]),
    ]);
    expect(buildPreviewTextModel(root).text).toBe('Section');
  });

  // 054 FR-032 — a diagram's labels are drawn, not text the reader can find; a match there opens the editor.
  it('excludes a rendered diagram, its labels and its toolbar', () => {
    const root = el([
      el([text('Before ')]),
      el([el([text('A node label')]), el([text('Fit')])], { class: 'preview-diagram-host' }),
      el([text('after')]),
    ]);
    expect(buildPreviewTextModel(root).text).toBe('Before after');
  });

  it('includes collapsed sections — folding hides them visually, not from the model', () => {
    // A collapsed section carries no aria-hidden and no fold-toggle class of its own: it is ordinary
    // content the reader has chosen not to look at, and Find must still be able to land on it (edge
    // case "Find across a fold", FR-040 reveals it on the way to the current match).
    const root = el([
      text('Intro '),
      el([text('Hidden by a fold, but still findable')], { class: 'section-body section-body--collapsed' }),
    ]);
    expect(buildPreviewTextModel(root).text).toBe('Intro Hidden by a fold, but still findable');
  });

  it('skips a text node with no characters without breaking the offset run', () => {
    const root = el([text('a'), text(''), text('b')]);
    const model = buildPreviewTextModel(root);
    expect(model.text).toBe('ab');
    expect(model.entries).toHaveLength(2);
  });
});

describe('locate — offset → (node, offset), for building a Range', () => {
  it('maps an offset back to its exact node and node-local offset', () => {
    const a = text('Hello ');
    const b = text('world');
    const model = buildPreviewTextModel(el([a, b]));
    expect(locate(model, 0)).toEqual({ node: a, offset: 0 });
    expect(locate(model, 5)).toEqual({ node: a, offset: 5 });
    expect(locate(model, 6)).toEqual({ node: b, offset: 0 }); // first char of the SECOND node
    expect(locate(model, 11)).toEqual({ node: b, offset: 5 }); // one past the last char, still valid
  });

  it('answers null past the end of the model', () => {
    const model = buildPreviewTextModel(el([text('abc')]));
    expect(locate(model, 4)).toBeNull();
  });
});

describe('findPreviewMatches — the same matcher the editor uses (FR-001)', () => {
  const model = buildPreviewTextModel(el([text('Cat cat CATEGORY')]));

  it('is case-insensitive and matches substrings by default', () => {
    expect(findPreviewMatches(model, 'cat', { caseSensitive: false, wholeWord: false })).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 7 },
      { from: 8, to: 11 },
    ]);
  });

  it('honours match case', () => {
    expect(findPreviewMatches(model, 'cat', { caseSensitive: true, wholeWord: false })).toEqual([
      { from: 4, to: 7 },
    ]);
  });

  it('honours whole word', () => {
    expect(findPreviewMatches(model, 'cat', { caseSensitive: false, wholeWord: true })).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 7 },
    ]);
  });

  it('an empty term matches nothing', () => {
    expect(findPreviewMatches(model, '', { caseSensitive: false, wholeWord: false })).toEqual([]);
  });
});
