import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  removeEditorState,
  setEditorState,
  useDirtyPathKey,
  useDirtyProjectKey,
  useEditorDirty,
  useEditorState,
} from '../../src/renderer/editor/editor-state.js';

/**
 * ONE dirty document, FOUR unsaved dots — the store they all read (006 FR-006d).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/editor-indicators.e2e.ts:24` (035 T055) —
 * `test('the unsaved dot lights on panel + tab + project and clears on save')`.
 *
 * ══ WHAT THAT TEST WAS ACTUALLY ASSERTING ══
 *
 * It created a project on a real temp directory, opened an editor, typed into a real CodeMirror,
 * looked at three places on screen, stubbed the OS save dialog, pressed Ctrl+S and looked again.
 *
 * The claim underneath is not about any of those surfaces. It is that the four dots share ONE source
 * of truth, so a single document going dirty lights all of them and a single save clears all of
 * them. `editor-state.ts` is that source: a module-level `states` map with four selectors over it —
 *
 *   `useEditorState`      the PANEL dot   (`panel-placeholder.tsx:114`)
 *   `useEditorDirty`      the TAB dot     (`tab-group.tsx:121`)
 *   `useDirtyProjectKey`  the PROJECT dot (`projects-panel.tsx:141`)
 *   `useDirtyPathKey`     the TREE ROW    (one level finer, per file)
 *
 * — and none of them had a test. The store is the join, and the join is what the E2E was buying.
 *
 * ══ WHY THIS IS NOT THE WHOLE E2E, AND WHAT COVERS THE REST ══
 *
 * That each of the four call sites RENDERS a dot from its selector is
 * `packages/ui/tests/unit/unsaved-dot-call-sites.test.ts` — "is drawn at exactly the four known
 * sites", plus the shared accessible name and the testid naming what each marks. That half was
 * already proven. The pair is the claim: four sites, one store, one truth.
 *
 * What stays end-to-end is the SAVE. `Ctrl+S` reaching a stubbed OS dialog, writing bytes, and the
 * document authority reporting itself clean afterwards is a round trip through main, and
 * `editor-indicators.e2e.ts` keeps a test for it. Below, `dirty: false` stands for the answer that
 * round trip produces — which is the honest boundary, and it is why the E2E is not deleted.
 */

const seeded: string[] = [];

/** Seed one panel's editor state, tracking it for teardown. */
function seed(panelId: string, patch: Parameters<typeof setEditorState>[1]): void {
  seeded.push(panelId);
  act(() => setEditorState(panelId, patch));
}

const patch = (panelId: string, next: Parameters<typeof setEditorState>[1]): void => {
  act(() => setEditorState(panelId, next));
};

afterEach(() => {
  for (const id of seeded.splice(0)) act(() => removeEditorState(id));
});

/**
 * All four selectors, over one render, so a change is observed by every one of them at once.
 *
 * Rendered together on purpose. Four separate `renderHook` calls would each be right about their own
 * selector and say nothing about the thing under test, which is that they AGREE.
 */
function dots(panelIds: readonly string[]) {
  return renderHook(() => ({
    panel: useEditorState(panelIds[0]),
    tab: useEditorDirty(panelIds),
    projects: useDirtyProjectKey(),
    paths: useDirtyPathKey(),
  }));
}

/* ────────────────────────────────────────────────────────────────────────── *
 * One document, four dots
 * ────────────────────────────────────────────────────────────────────────── */

describe('a dirty document lights every dot, and a save clears every dot', () => {
  it('lights panel, tab, project and tree together — from one edit', () => {
    seed('p1', { filePath: 'C:/proj/doc.txt', ownerProjectId: 'proj-1', dirty: false });
    const { result, rerender } = dots(['p1']);

    // Clean: nothing marked anywhere. The negative comes first so the positive is a CHANGE.
    expect(result.current.panel?.dirty).toBe(false);
    expect(result.current.tab).toBe(false);
    expect(result.current.projects).toBe('');
    expect(result.current.paths).toBe('');

    patch('p1', { dirty: true });
    rerender();

    expect(result.current.panel?.dirty, 'the PANEL dot').toBe(true);
    expect(result.current.tab, 'the TAB dot').toBe(true);
    expect(result.current.projects, 'the PROJECT dot').toBe('proj-1');
    expect(result.current.paths, 'the TREE ROW dot').toBe('c:/proj/doc.txt');
  });

  it('clears all four when the document reports itself saved', () => {
    /*
     * `dirty: false` is what the save round trip produces. What Ctrl+S does to reach it — the OS
     * dialog, the bytes, the authority — is `editor-indicators.e2e.ts`'s, and stays there.
     */
    seed('p1', { filePath: 'C:/proj/doc.txt', ownerProjectId: 'proj-1', dirty: true });
    const { result, rerender } = dots(['p1']);
    expect(result.current.tab).toBe(true);

    patch('p1', { dirty: false });
    rerender();

    expect(result.current.panel?.dirty).toBe(false);
    expect(result.current.tab).toBe(false);
    expect(result.current.projects).toBe('');
    expect(result.current.paths).toBe('');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * …and the cases the E2E's single dirty file could not reach
 * ────────────────────────────────────────────────────────────────────────── */

describe('what each dot is scoped to', () => {
  it('marks a TAB when ANY of its panels is dirty, not only the first', () => {
    // The E2E had one editor in one tab, so "the tab is dirty" and "this panel is dirty" were the
    // same statement. A tab dot reading only its active panel would have passed it.
    seed('p1', { filePath: 'C:/proj/a.txt', ownerProjectId: 'proj-1', dirty: false });
    seed('p2', { filePath: 'C:/proj/b.txt', ownerProjectId: 'proj-1', dirty: false });
    const { result, rerender } = dots(['p1', 'p2']);
    expect(result.current.tab).toBe(false);

    patch('p2', { dirty: true });
    rerender();

    expect(result.current.tab, 'the SECOND panel is dirty and the tab must say so').toBe(true);
    expect(result.current.panel?.dirty, 'and the FIRST panel is still clean').toBe(false);
  });

  it('marks every project that has an unsaved editor, in a stable order', () => {
    // Two projects open at once is ordinary, and the key is sorted so the Set derived from it does
    // not churn on every store write.
    seed('p1', { filePath: 'C:/b/x.txt', ownerProjectId: 'zeta', dirty: true });
    seed('p2', { filePath: 'C:/a/y.txt', ownerProjectId: 'alpha', dirty: true });
    const { result } = dots(['p1', 'p2']);

    expect(result.current.projects).toBe('alpha,zeta');
  });

  it('names a project ONCE however many of its editors are dirty', () => {
    seed('p1', { filePath: 'C:/p/x.txt', ownerProjectId: 'proj-1', dirty: true });
    seed('p2', { filePath: 'C:/p/y.txt', ownerProjectId: 'proj-1', dirty: true });
    const { result } = dots(['p1', 'p2']);

    expect(result.current.projects).toBe('proj-1');
  });

  it('leaves the PROJECT dot alone for a dirty editor no project owns', () => {
    // A sub-workspace-owned editor has no `ownerProjectId`. It still marks its panel and its tab —
    // it is unsaved work — but there is no project row for it to light.
    seed('p1', { filePath: 'C:/p/x.txt', dirty: true });
    const { result } = dots(['p1']);

    expect(result.current.tab).toBe(true);
    expect(result.current.projects).toBe('');
  });

  it('normalises the TREE key, because Windows calls those the same file', () => {
    /*
     * The tree composes each row's path from its project root, and the store holds whatever spelling
     * the editor was opened with. Comparing them raw means a file opened as `C:\Proj\Doc.txt` never
     * matches the row for `C:/proj/doc.txt`, and the dot silently never appears.
     */
    seed('p1', { filePath: 'C:\\Proj\\Doc.txt', ownerProjectId: 'proj-1', dirty: true });
    const { result } = dots(['p1']);

    expect(result.current.paths).toBe('c:/proj/doc.txt');
  });

  it('leaves the TREE key alone for a dirty document that was never saved', () => {
    // No path yet, so no row to mark — but the panel and tab dots still report the unsaved work.
    seed('p1', { ownerProjectId: 'proj-1', dirty: true });
    const { result } = dots(['p1']);

    expect(result.current.tab).toBe(true);
    expect(result.current.paths).toBe('');
    expect(result.current.projects).toBe('proj-1');
  });

  it('forgets a panel entirely when its editor goes away', () => {
    // A destroyed panel must not leave a dot lit on a tab or a project that has nothing unsaved.
    seed('p1', { filePath: 'C:/p/x.txt', ownerProjectId: 'proj-1', dirty: true });
    const { result, rerender } = dots(['p1']);
    expect(result.current.projects).toBe('proj-1');

    act(() => removeEditorState('p1'));
    rerender();

    expect(result.current.tab).toBe(false);
    expect(result.current.projects).toBe('');
    expect(result.current.paths).toBe('');
  });
});
