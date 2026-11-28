/**
 * Section folding in a Markdown editor (047 T041, US3, FR-030 – FR-041d, research R3/R4/R5).
 *
 * Two altitudes: the range-application (`syncFoldRanges`) run against a headless `EditorState`/`EditorView` — no DOM,
 * no jsdom layout, fast — and the gutter, the click, the seeding and the dirty/history guarantee run
 * against a REAL mounted editor (`mountEditor`), which is what proves the wiring in `use-editor.ts`
 * and `editor-language.ts` (T042) rather than only the module in isolation.
 */
import { act, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { codeFolding, foldedRanges } from '@codemirror/language';
import { DEFAULT_KEYBINDINGS, headingSlug, initialFold, isCollapsed, type FoldState, type HeadingRecord } from '@throng/core';
import {
  foldRangeFor,
  liveSections,
  markdownFoldCommand,
  markdownSections,
  syncFoldRanges,
} from '../../src/renderer/editor/markdown-fold.js';
import { __resetFoldStateStore, documentFoldState } from '../../src/renderer/editor/fold-state-store.js';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';

/* ────────────────────────────────────────────────────────────────────────── *
 * Pure derivation — no DOM
 * ────────────────────────────────────────────────────────────────────────── */

function heading(level: HeadingRecord['level'], text: string, line: number, taken: Set<string>): HeadingRecord {
  return { level, text, slug: headingSlug(text, taken), line };
}

describe('liveSections — scanned once per editor state, not once per gutter line', () => {
  it('answers the SAME sections for the same state, and fresh ones after an edit', () => {
    // The gutter asks for a marker on every visible line; each ask re-parsing the whole document
    // made a redraw cost lines × document.
    const view = new EditorView({
      state: EditorState.create({ doc: '# A\n\ntext\n\n## B\n\nmore\n', extensions: [markdown()] }),
    });
    const first = liveSections(view);
    expect(first.map((s) => s.slug)).toEqual(['a', 'b']);
    expect(liveSections(view)).toBe(first);

    view.dispatch({ changes: { from: view.state.doc.length, insert: '\n## C\n' } });
    expect(liveSections(view).map((s) => s.slug)).toEqual(['a', 'b', 'c']);
    view.destroy();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * syncFoldRanges — a headless EditorView, no jsdom layout needed
 * ────────────────────────────────────────────────────────────────────────── */

describe('syncFoldRanges (R4) — CodeMirror\'s folded set equals the derivation', () => {
  const DOC = ['# Intro', 'p0', '## A', 'p1', '## B', 'p2'].join('\n');
  const taken = new Set<string>();
  const HEADINGS = [heading(1, 'Intro', 0, taken), heading(2, 'A', 2, taken), heading(2, 'B', 4, taken)];
  const SECTIONS = markdownSections(HEADINGS, 5);

  function headlessView(doc = DOC): EditorView {
    // `codeFolding()` registers the `foldState` field `foldEffect`/`unfoldEffect` attach to — without
    // it in the extensions the effects have nothing to land on and are silently no-ops.
    return new EditorView({ state: EditorState.create({ doc, extensions: [markdown(), codeFolding()] }) });
  }

  afterEach(() => {
    // no teardown needed — each view is discarded, not mounted
  });

  it('folds exactly the collapsed sections\' content ranges', () => {
    const view = headlessView();
    const state: FoldState = { base: 'expanded', flipped: ['a'] };
    syncFoldRanges(view, SECTIONS, state);

    const folded: Array<{ from: number; to: number }> = [];
    foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => folded.push({ from, to }));
    expect(folded).toEqual([foldRangeFor(SECTIONS[1]!, view.state.doc)]);
  });

  it('re-expanding un-does exactly that fold, restoring a nested one independently (FR-030a)', () => {
    const view = headlessView();
    // Collapse the H1 AND its H2 child B.
    syncFoldRanges(view, SECTIONS, { base: 'expanded', flipped: ['intro', 'b'] });
    let folded: Array<{ from: number; to: number }> = [];
    foldedRanges(view.state).between(0, view.state.doc.length, (f, t) => folded.push({ from: f, to: t }));
    expect(folded.length).toBeGreaterThan(0);

    // Re-expand the H1 only — B's own fold must still be in effect afterwards.
    syncFoldRanges(view, SECTIONS, { base: 'expanded', flipped: ['b'] });
    folded = [];
    foldedRanges(view.state).between(0, view.state.doc.length, (f, t) => folded.push({ from: f, to: t }));
    expect(folded).toEqual([foldRangeFor(SECTIONS[2]!, view.state.doc)]);
  });

  it('never changes the document, the selection, or the history (FR-035)', () => {
    const view = headlessView();
    view.dispatch({ selection: { anchor: 3, head: 3 } });
    const before = view.state.doc.toString();

    syncFoldRanges(view, SECTIONS, { base: 'expanded', flipped: ['a'] });

    expect(view.state.doc.toString()).toBe(before);
    expect(view.state.selection.main.head).toBe(3);
  });

  it('a no-op update (the same state twice) dispatches nothing the second time', () => {
    const view = headlessView();
    const state: FoldState = { base: 'expanded', flipped: ['a'] };
    syncFoldRanges(view, SECTIONS, state);
    const generationBefore = view.state;
    syncFoldRanges(view, SECTIONS, state);
    expect(view.state).toBe(generationBefore); // no transaction dispatched at all
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * markdownFoldCommand — a headless view, the six actions
 * ────────────────────────────────────────────────────────────────────────── */

describe('markdownFoldCommand — the six markdown.* actions', () => {
  const DOC = ['# Intro', 'p0', '## A', 'p1', '## B', 'p2'].join('\n');

  function harness(): { view: EditorView; key: string } {
    const view = new EditorView({ state: EditorState.create({ doc: DOC, extensions: [markdown()] }) });
    return { view, key: `test-key-${Math.random()}` };
  }

  const deps = (key: string) => ({
    docKey: () => key,
    panelId: 'p1',
    seedDefault: () => initialFold('expanded'),
  });

  afterEach(() => __resetFoldStateStore());

  it('toggleSection at the cursor toggles the innermost containing section only', () => {
    const { view, key } = harness();
    view.dispatch({ selection: { anchor: view.state.doc.line(4).from } }); // inside "## A"'s content
    expect(markdownFoldCommand('toggleSection', deps(key))(view)).toBe(true);
    expect(documentFoldState(key, initialFold('expanded'))).toEqual({ base: 'expanded', flipped: ['a'] });
  });

  it('collapseSection is idempotent; expandSection restores', () => {
    const { view, key } = harness();
    view.dispatch({ selection: { anchor: view.state.doc.line(4).from } });
    markdownFoldCommand('collapseSection', deps(key))(view);
    markdownFoldCommand('collapseSection', deps(key))(view);
    expect(documentFoldState(key, initialFold('expanded')).flipped).toEqual(['a']);
    markdownFoldCommand('expandSection', deps(key))(view);
    expect(documentFoldState(key, initialFold('expanded')).flipped).toEqual([]);
  });

  it('is a no-op before the first heading', () => {
    const { view, key } = harness();
    view.dispatch({ selection: { anchor: 0 } }); // "# Intro" is the FIRST heading — but line 0 IS it
    // Move before any heading by using a document with leading text.
    const view2 = new EditorView({
      state: EditorState.create({ doc: `no heading yet\n${DOC}`, extensions: [markdown()] }),
    });
    expect(markdownFoldCommand('toggleSection', deps(key))(view2)).toBe(false);
    view.destroy();
  });

  it('collapseAll collapses every section; expandAll clears them all', () => {
    const { view, key } = harness();
    expect(markdownFoldCommand('collapseAll', deps(key))(view)).toBe(true);
    expect(documentFoldState(key, initialFold('expanded'))).toEqual({ base: 'collapsed', flipped: [] });
    expect(markdownFoldCommand('expandAll', deps(key))(view)).toBe(true);
    expect(documentFoldState(key, initialFold('expanded'))).toEqual({ base: 'expanded', flipped: [] });
  });

  it('toggleAll collapses when any section is expanded, else expands all', () => {
    const { view, key } = harness();
    expect(markdownFoldCommand('toggleAll', deps(key))(view)).toBe(true);
    expect(documentFoldState(key, initialFold('expanded')).base).toBe('collapsed');
    expect(markdownFoldCommand('toggleAll', deps(key))(view)).toBe(true);
    expect(documentFoldState(key, initialFold('expanded')).base).toBe('expanded');
  });

  it('is a no-op over a document with no headings at all', () => {
    const view = new EditorView({ state: EditorState.create({ doc: 'just a paragraph', extensions: [markdown()] }) });
    expect(markdownFoldCommand('collapseAll', deps('k'))(view)).toBe(false);
  });

  /*
   * 054 FR-011 — Collapse / Expand All Inside This Hn: the section at the cursor and everything nested
   * beneath it, each set individually; sections outside it untouched.
   */
  it('collapseAllInside folds the descendants of the cursor’s section only; expandAllInside undoes exactly that', () => {
    const doc = ['# Intro', 'p0', '## A', 'p1', '### A1', 'p2', '## B', 'p3'].join('\n');
    const view = new EditorView({ state: EditorState.create({ doc, extensions: [markdown()] }) });
    const key = `test-key-${Math.random()}`;
    view.dispatch({ selection: { anchor: view.state.doc.line(4).from } }); // inside "## A", above "### A1"
    expect(markdownFoldCommand('collapseAllInside', deps(key))(view)).toBe(true);
    expect([...documentFoldState(key, initialFold('expanded')).flipped].sort()).toEqual(['a1']);
    expect(markdownFoldCommand('expandAllInside', deps(key))(view)).toBe(true);
    expect(documentFoldState(key, initialFold('expanded')).flipped).toEqual([]);
  });

  it('All Inside is a no-op before the first heading', () => {
    const view = new EditorView({ state: EditorState.create({ doc: `lead\n${DOC}`, extensions: [markdown()] }) });
    view.dispatch({ selection: { anchor: 0 } });
    expect(markdownFoldCommand('collapseAllInside', deps('k2'))(view)).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The mounted editor — gutter, click, seeding, sync, dirty/history (T041, T042's wiring)
 * ────────────────────────────────────────────────────────────────────────── */

const MD_DOC = [
  '# Intro',
  '',
  'para one',
  '',
  '## A',
  '',
  '```',
  '# not a heading',
  '```',
  '',
  '> quote',
  '',
  '| h |',
  '|---|',
  '| x |',
  '',
  '## B',
  '',
  'para two',
].join('\n');

async function mountMarkdown(opts: {
  settings?: Record<string, unknown>;
  path?: string;
  foldAuthority?: FoldState;
}): Promise<EditorHarness> {
  const h = mountEditor({
    doc: { text: MD_DOC, version: 1, absPath: opts.path ?? 'C:/proj/note.md' },
    ...(opts.settings ? { settings: opts.settings } : {}),
    ...(opts.foldAuthority ? { foldAuthority: { base: opts.foldAuthority.base, flipped: [...opts.foldAuthority.flipped] } } : {}),
  });
  await waitFor(() => expect(h.text()).toContain('Intro'));
  await waitFor(() => expect(h.settingsLoaded()).toBe(true));
  return h;
}

/** Every `.cm-throng-fold-marker` gutter element currently in the DOM, in document order. */
function markers(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.cm-throng-fold-marker'));
}

/** The heading `slug` a marker acts on (`data-slug` — see `markdown-fold.ts`'s `HeadingFoldMarker`). */
function markerSlug(marker: HTMLElement): string | undefined {
  return marker.dataset.slug;
}

afterEach(() => {
  __resetFoldStateStore();
  Reflect.deleteProperty(window, 'throng');
});

describe('the heading gutter (contracts "Editor gutter", R4)', () => {
  it('marks each heading line and no other — not code, not a quote, not a table', async () => {
    const h = await mountMarkdown({});
    // Three headings: `# Intro`, `## A`, `## B` — none for the fenced `# not a heading`, the
    // blockquote or the table.
    await waitFor(() => expect(markers().length).toBe(3));
    const slugs = markers().map(markerSlug);
    expect(slugs).toEqual(['intro', 'a', 'b']);
    h.unmount();
  });

  it('is absent entirely with editor.showGutter off', async () => {
    const h = await mountMarkdown({ settings: { editor: { showGutter: false } } });
    expect(document.querySelector('.cm-throng-fold-gutter')).toBeNull();
    h.unmount();
  });

  it('is absent entirely for a non-Markdown document', async () => {
    const h = await mountMarkdown({ path: 'C:/proj/note.txt' });
    expect(document.querySelector('.cm-throng-fold-gutter')).toBeNull();
    h.unmount();
  });
});

describe('clicking a marker collapses that section, published through the store (Principle XI)', () => {
  it('folds the section\'s content and flips the marker\'s title', async () => {
    const h = await mountMarkdown({});
    await waitFor(() => expect(markers().length).toBe(3));
    const before = markers()[0]!;
    expect(before.title).toBe('Collapse section');

    act(() => {
      fireEvent.mouseDown(before);
    });

    await waitFor(() => {
      const folded: Array<{ from: number; to: number }> = [];
      foldedRanges(h.view().state).between(0, h.view().state.doc.length, (f, t) => folded.push({ from: f, to: t }));
      expect(folded.length).toBeGreaterThan(0);
    });
    await waitFor(() => expect(markers()[0]!.title).toBe('Expand section'));
    h.unmount();
  });
});

describe('an incoming fold-state sync folds/unfolds this view to match (Principle XI)', () => {
  it('applies a state that arrived from another view of the same document', async () => {
    const h = await mountMarkdown({});
    await waitFor(() => expect(markers().length).toBe(3));

    act(() => {
      h.pushSync({ foldState: { key: 'file:C:/proj/note.md', state: { base: 'collapsed', flipped: [] } } });
    });

    await waitFor(() => expect(markers()[0]!.title).toBe('Expand section'));
    h.unmount();
  });

  it("applies a relay keyed in MAIN's form — forward-slashed and lower-cased (editor-coordinator fileKey)", async () => {
    // Main keys `file:` entries by `fileKey`, not by the path as the renderer spelled it, so a
    // Windows path arrives with its backslashes and case normalised. Another window's toggle must
    // still land here.
    const h = await mountMarkdown({ path: 'C:\\Proj\\Note.md' });
    await waitFor(() => expect(markers().length).toBe(3));

    act(() => {
      h.pushSync({ foldState: { key: 'file:c:/proj/note.md', state: { base: 'collapsed', flipped: [] } } });
    });

    await waitFor(() => expect(markers()[0]!.title).toBe('Expand section'));
    h.unmount();
  });
});

describe('a newly opened document seeds from editor.markdownSectionsOpen (FR-039)', () => {
  it('seeds every marker collapsed when the preference is collapsed', async () => {
    const h = await mountMarkdown({ settings: { editor: { markdownSectionsOpen: 'collapsed' } } });
    // Only the top-level heading shows: `# Intro` is collapsed, and its H2s are folded away inside it
    // (MT-04 — this used to count three markers, because nothing was actually folded).
    await waitFor(() => {
      expect(markers().map(markerSlug)).toEqual(['intro']);
      expect(markers()[0]!.title).toBe('Expand section');
    });
    h.unmount();
  });
});

/*
 * Reported in review (MT-04, 2026-09-28): "Works if the editor version is already open, but if it is
 * opened separately, the outlining is all screwed up until you click the outline icons a few times in
 * either preview or editor." Measured in the running app (`preview-fold-pair.e2e.ts`): placing a
 * preview beside an editor re-parents the editor, its view is rebuilt, and the rebuilt view had no
 * fold gutter and no folding at all. And a state already collapsed when the text arrives — a preview
 * collapsed first, or `markdownSectionsOpen: collapsed` — marked the headings `+` while folding nothing.
 */
describe('the text is actually folded to the document\'s state, however the editor came to show it (MT-04)', () => {
  const foldedCount = (h: EditorHarness): number => {
    let n = 0;
    foldedRanges(h.view().state).between(0, h.view().state.doc.length, () => {
      n += 1;
    });
    return n;
  };

  it('a remounted editor (a split re-parented it) still has its fold gutter, and still folds', async () => {
    const h = await mountMarkdown({});
    await waitFor(() => expect(markers().length).toBe(3));

    act(() => h.remount());
    await waitFor(() => expect(h.text()).toContain('Intro'));

    await waitFor(() => expect(markers().length).toBe(3));
    act(() => {
      fireEvent.mouseDown(markers()[1]!);
    });
    await waitFor(() => expect(foldedCount(h)).toBe(1));
    h.unmount();
  });

  it('a document opened with sections collapsed has its sections folded, not only marked', async () => {
    const h = await mountMarkdown({ settings: { editor: { markdownSectionsOpen: 'collapsed' } } });
    await waitFor(() => expect(markers()[0]?.title).toBe('Expand section'));

    await waitFor(() => expect(foldedCount(h)).toBeGreaterThan(0));
    h.unmount();
  });

  it('typing a new heading into a collapsed-by-default document does not fold the text under it', async () => {
    const h = await mountMarkdown({ settings: { editor: { markdownSectionsOpen: 'collapsed' } } });
    await waitFor(() => expect(foldedCount(h)).toBeGreaterThan(0));
    // Let every scheduled sync land before typing, so what follows can only come from the typing.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const settled = foldedCount(h);

    act(() => {
      const end = h.view().state.doc.length;
      h.view().dispatch({ changes: { from: end, insert: '\n\n# Typed\n\nwritten under it\n' }, userEvent: 'input.type' });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(foldedCount(h)).toBe(settled);
    expect(h.content().textContent).toContain('written under it');
    h.unmount();
  });

  it('a state already collapsed for the document (its preview collapsed it first) folds the text as it opens', async () => {
    const h = await mountMarkdown({ foldAuthority: { base: 'expanded', flipped: ['b'] } });
    await waitFor(() => expect(markers()[2]?.title).toBe('Expand section'));

    await waitFor(() => expect(foldedCount(h)).toBe(1));
    h.unmount();
  });
});

/*
 * 049 T062 / 047 FR-037a — "Collapse All on a document with one H1 therefore leaves only the H1 showing". The
 * maintainer saw the H1's marker still reading `−` (expanded) afterwards while every other section read `+`.
 */
describe('Collapse All on a document with one H1 (047 FR-037a)', () => {
  const collapseAllDeps = {
    docKey: () => 'file:C:/proj/note.md',
    panelId: 'p-ed',
    seedDefault: () => initialFold('expanded'),
  };

  it('leaves the H1 showing, collapsed (`+`), with its content folded away', async () => {
    const h = await mountMarkdown({});
    await waitFor(() => expect(markers().map(markerSlug)).toEqual(['intro', 'a', 'b']));
    expect(markers()[0]!.title).toBe('Collapse section');

    act(() => {
      markdownFoldCommand('collapseAll', collapseAllDeps)(h.view());
    });

    expect(documentFoldState('file:C:/proj/note.md', initialFold('expanded')).base).toBe('collapsed');
    await waitFor(() => {
      // Only the H1 is left showing — its H2s are folded away inside it — and it reads collapsed.
      expect(markers().map(markerSlug)).toEqual(['intro']);
      expect(markers()[0]!.title).toBe('Expand section');
    });
    h.unmount();
  });

  it('after Expand All the H1 is open again and shows its H2s collapsed', async () => {
    const h = await mountMarkdown({});
    await waitFor(() => expect(markers().length).toBe(3));
    act(() => {
      markdownFoldCommand('collapseAll', collapseAllDeps)(h.view());
    });
    await waitFor(() => expect(markers().map(markerSlug)).toEqual(['intro']));

    // Expanding the H1 alone (its marker) shows its H2s, each still collapsed (047 FR-037a).
    act(() => {
      fireEvent.mouseDown(markers()[0]!);
    });
    await waitFor(() => expect(markers().map(markerSlug)).toEqual(['intro', 'a', 'b']));
    expect(markers().map((m) => m.title)).toEqual(['Collapse section', 'Expand section', 'Expand section']);
    h.unmount();
  });
});

/*
 * Reported in v1 review (#732, 2026-11-28): "When I click on the ellipses on a collapsed section in a markdown editor
 * with the preview open, the editor collapses (but the icon in the gutter does not change), but the preview does not.
 * The ellipses should do exactly the same as the gutter button." CodeMirror's own placeholder unfolded the range
 * and never told the document's fold state, so the marker and the linked preview kept reading collapsed.
 */
describe('clicking the "…" placeholder on a collapsed section does what its gutter marker does (047 FR-031)', () => {
  it('expands the section in the document fold state, so the marker and every linked view follow', async () => {
    const h = await mountMarkdown({ foldAuthority: { base: 'expanded', flipped: ['b'] } });
    await waitFor(() => expect(markers()[2]?.title).toBe('Expand section'));
    expect(documentFoldState('file:C:/proj/note.md', initialFold('expanded')).flipped).toContain('b');
    const placeholder = await waitFor(() => {
      const el = h.content().querySelector<HTMLElement>('.cm-foldPlaceholder');
      expect(el).not.toBeNull();
      return el!;
    });

    act(() => {
      fireEvent.click(placeholder);
    });

    // The store is what main relays to the preview (setDocumentFoldState → setFoldState).
    await waitFor(() =>
      expect(documentFoldState('file:C:/proj/note.md', initialFold('expanded')).flipped).not.toContain('b'),
    );
    await waitFor(() => expect(markers()[2]!.title).toBe('Collapse section'));
    expect(h.content().querySelector('.cm-foldPlaceholder')).toBeNull();
    h.unmount();
  });
});

/*
 * Reported in v1 review (#732, 2026-11-28): "All the expand / collapse outline actions need working keyboard shortcuts
 * in the editor." Every row of the editor's Outlining submenu runs a command; each must ship a chord, and pressing
 * that chord in a Markdown editor must do what the row does.
 */
describe('every Outlining action has a shipped chord that works in a Markdown editor (047 FR-037b, 054 FR-013)', () => {
  /** One stroke of a binding token as a US keyboard reports it; the first stroke's modifiers stay held (046 FR-124). */
  function strokeEvent(stroke: string, held: readonly string[]): KeyboardEventInit & { keyCode: number } {
    const parts = stroke.split('+');
    const key = parts.pop()!;
    const mods = new Set([...held, ...parts]);
    const upper = key.toUpperCase();
    const named: Record<string, { key: string; code: string; keyCode: number }> = {
      '[': { key: '[', code: 'BracketLeft', keyCode: 219 },
      ']': { key: ']', code: 'BracketRight', keyCode: 221 },
    };
    const base =
      named[key] ??
      (/^[0-9]$/.test(key)
        ? { key, code: `Digit${key}`, keyCode: 48 + Number(key) }
        : // A browser reports Shift+S as `S`.
          { key: mods.has('Shift') ? upper : key.toLowerCase(), code: `Key${upper}`, keyCode: upper.charCodeAt(0) });
    return {
      ...base,
      ctrlKey: mods.has('Ctrl'),
      shiftKey: mods.has('Shift'),
      altKey: mods.has('Alt'),
      metaKey: mods.has('Meta'),
    };
  }

  function pressChord(el: HTMLElement, token: string): void {
    const strokes = token.split(',');
    const held = strokes[0]!.split('+').slice(0, -1);
    strokes.forEach((stroke, index) => {
      act(() => {
        fireEvent.keyDown(el, { bubbles: true, cancelable: true, ...strokeEvent(stroke, index === 0 ? [] : held) });
      });
    });
  }

  const KEY = 'file:C:/proj/note.md';
  const state = (): FoldState => documentFoldState(KEY, initialFold('expanded'));
  /** The caret on 1-based `line`: line 3 is `# Intro`'s content (A and B nest under it), line 6 is `## A`'s. */
  const caretAt = (h: EditorHarness, line: number): void => {
    act(() => {
      h.view().focus();
      h.view().dispatch({ selection: { anchor: h.view().state.doc.line(line).from } });
    });
  };
  /** Which of the three sections read collapsed. */
  const collapsed = (s: FoldState): string[] => ['intro', 'a', 'b'].filter((slug) => isCollapsed(s, slug));

  const CASES: Array<{ action: string; line: number; start?: FoldState; after: string[] }> = [
    { action: 'markdown.collapseSection', line: 6, after: ['a'] },
    { action: 'markdown.expandSection', line: 6, start: { base: 'expanded', flipped: ['a', 'b'] }, after: ['b'] },
    { action: 'markdown.collapseAll', line: 6, after: ['intro', 'a', 'b'] },
    { action: 'markdown.expandAll', line: 6, start: { base: 'collapsed', flipped: [] }, after: [] },
    // Inside Intro: everything nested under it folds, Intro itself stays as it was (054 FR-013).
    { action: 'markdown.collapseAllInside', line: 3, after: ['a', 'b'] },
    { action: 'markdown.expandAllInside', line: 3, start: { base: 'collapsed', flipped: [] }, after: [] },
  ];

  it.each(CASES)('$action', async ({ action, line, start, after }) => {
    const chord = DEFAULT_KEYBINDINGS.bindings[action as keyof typeof DEFAULT_KEYBINDINGS.bindings]?.[0];
    expect(chord, `${action} ships no chord`).toBeDefined();
    const h = await mountMarkdown(start ? { foldAuthority: start } : {});
    await waitFor(() => expect(markers().length).toBeGreaterThan(0));
    if (start) await waitFor(() => expect(state()).toEqual(start));
    caretAt(h, line);

    pressChord(h.content(), chord!);

    await waitFor(() => expect(collapsed(state())).toEqual(after));
    h.unmount();
  });
});

describe('folding never dirties the document, changes its text, or adds a history entry (FR-035)', () => {
  it('a click leaves the dispatched authority messages exactly as they were', async () => {
    const h = await mountMarkdown({});
    await waitFor(() => expect(markers().length).toBe(3));
    const textBefore = h.view().state.doc.toString();
    const dispatchedBefore = h.dispatched.length;

    act(() => {
      fireEvent.mouseDown(markers()[0]!);
    });
    await waitFor(() => expect(markers()[0]!.title).toBe('Expand section'));

    expect(h.view().state.doc.toString()).toBe(textBefore);
    // Folding is not a document edit: nothing new reaches the document authority's dispatch channel.
    expect(h.dispatched.length).toBe(dispatchedBefore);
    h.unmount();
  });
});
