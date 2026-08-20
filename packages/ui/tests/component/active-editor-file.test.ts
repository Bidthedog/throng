import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The file the user is actually working in — or null, which is most of the interesting answers (#188).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/explorer-follow-active-editor.e2e.ts:276` (035 T055) —
 * `test('a terminal or unsaved editor becoming active does not move the tree selection')`.
 *
 * ══ WHAT THAT TEST COST, AND WHAT IT WAS PROVING ══
 *
 * It created a project on a real temp directory, opened an editor, expanded to a nested file,
 * selected it, added a second panel, **started a real Windows PowerShell**, waited up to twenty
 * seconds for the prompt to show the project's basename, clicked the terminal, and then waited
 * 500 ms to see that the tree selection had not moved. Then it added a third panel with an unsaved
 * editor and waited another 500 ms for the same reason.
 *
 * What it was proving is this hook returning `null`. `file-tree.tsx:189` reads it and its effect is
 * one line — `if (!ready || !autoRevealActiveFile || !activeFileRel) return;` — so "the tree does not
 * follow a terminal" is "the hook says null", and everything between the two was scenery.
 *
 * ══ THE TWO SLEEPS WERE HONEST, AND THEY ARE STILL GONE ══
 *
 * Both carried a `sleep-justified` marker, and the justification was correct: the reveal effect is a
 * plain `useEffect` with no debounce and no completion signal, so there is nothing to wait ON for
 * *"it did not fire late"* — only time for it to have had the chance to. That is a real problem when
 * the effect is behind an app. It is not one here: the hook returns synchronously, and `null` is
 * `null` at the first render.
 *
 * ══ NOTHING TESTED THIS ══
 *
 * `useActiveEditorFilePath` joins two stores that each hold half the answer — the workspace layout
 * knows which panel is active, the per-panel editor store knows what it has open — and it had no
 * test at any layer. Sixth instance of this spec's recurring shape: two proven halves, an untested
 * join, and an E2E standing in for it at a hundred times the price.
 *
 * ══ WHAT IS NOT HERE ══
 *
 * That the tree's selection VISIBLY stays put, and that `revealInTree` is not called. Both are
 * `file-tree.tsx`'s, and `explorer-follow-active-editor.e2e.ts` keeps the tests that follow a real
 * editor to a real row.
 */

const workspace = vi.hoisted(() => ({ value: { layout: null as unknown } }));

vi.mock('../../src/renderer/state/workspace-store.js', () => ({
  useWorkspace: () => workspace.value,
}));

const { useActiveEditorFilePath } = await import('../../src/renderer/editor/active-editor-file.js');
const { setEditorState, removeEditorState } = await import(
  '../../src/renderer/editor/editor-state.js'
);

/* ────────────────────────────────────────────────────────────────────────── *
 * The fixture
 * ────────────────────────────────────────────────────────────────────────── */

interface PanelSpec {
  id: string;
  kind: string;
  /** The file this panel's editor has open; omit for an unsaved (never-saved) document. */
  file?: string;
}

const seeded: string[] = [];

/** One tab holding `panels`, with `activeId` active. */
function layoutOf(panels: PanelSpec[], activeId: string): void {
  for (const p of panels) {
    if (p.kind !== 'editor') continue;
    seeded.push(p.id);
    setEditorState(p.id, { filePath: p.file ?? null, displayName: p.file ?? 'Untitled' });
  }
  workspace.value = {
    layout: {
      activeTabId: 't1',
      tabs: [
        {
          id: 't1',
          title: 'T',
          activePanelId: activeId,
          root:
            panels.length === 1
              ? { type: 'panel', id: panels[0].id, kind: panels[0].kind, title: panels[0].id }
              : {
                  type: 'split',
                  id: 'split',
                  direction: 'row',
                  children: panels.map((p) => ({
                    type: 'panel',
                    id: p.id,
                    kind: p.kind,
                    title: p.id,
                  })),
                },
        },
      ],
    },
  };
}

const path = (): string | null => renderHook(() => useActiveEditorFilePath()).result.current;

beforeEach(() => {
  workspace.value = { layout: null };
});

afterEach(() => {
  for (const id of seeded.splice(0)) removeEditorState(id);
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The one positive, first — every negative below is measured against it
 * ────────────────────────────────────────────────────────────────────────── */

describe('the active editor’s file', () => {
  it('is the path of the active EDITOR panel', () => {
    layoutOf([{ id: 'e1', kind: 'editor', file: 'C:/proj/deep.txt' }], 'e1');

    expect(path()).toBe('C:/proj/deep.txt');
  });

  it('follows the ACTIVE panel, not the first editor in the tab', () => {
    // Two editors side by side. Answering with either one regardless of which is active would pass
    // the single-panel case above and be wrong in every real workspace.
    layoutOf(
      [
        { id: 'e1', kind: 'editor', file: 'C:/proj/first.txt' },
        { id: 'e2', kind: 'editor', file: 'C:/proj/second.txt' },
      ],
      'e2',
    );

    expect(path()).toBe('C:/proj/second.txt');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * …and the answers that are null, which is the whole point (#188)
 * ────────────────────────────────────────────────────────────────────────── */

describe('it is null for anything that is not an editor showing a file (#188)', () => {
  it('is null when a TERMINAL is the active panel', () => {
    /*
     * The E2E started a real PowerShell to reach this line. A terminal has no file, so a tree that
     * followed the active panel blindly would blank its selection the moment the user clicked into
     * a shell — losing the place they were keeping.
     */
    layoutOf(
      [
        { id: 'e1', kind: 'editor', file: 'C:/proj/deep.txt' },
        { id: 't1p', kind: 'terminal' },
      ],
      't1p',
    );

    expect(path()).toBeNull();
  });

  it('is null for an UNSAVED editor — a document with no file to reveal', () => {
    layoutOf(
      [
        { id: 'e1', kind: 'editor', file: 'C:/proj/deep.txt' },
        { id: 'e2', kind: 'editor' },
      ],
      'e2',
    );

    expect(path()).toBeNull();
  });

  it('is null for a panel that WAS an editor and is now a terminal, stale state and all', () => {
    /*
     * THE CASE THE KIND CHECK EXISTS FOR, and the only one in which it is load-bearing.
     *
     * The other negatives here are over-determined: a terminal panel usually has no editor state at
     * all, so deleting `if (activePanel?.kind !== 'editor') return null;` leaves them null anyway
     * and the mutation passes. Measured — `no-kind-check` reddens nothing without this test.
     *
     * A panel changed IN PLACE through the type picker keeps its id, and its editor state is keyed
     * by that id. So the layout says terminal while the editor store still says C:/proj/stale.txt,
     * and the kind check is the only thing standing between the tree and a reveal of a file the
     * user closed.
     */
    seeded.push('p1');
    setEditorState('p1', { filePath: 'C:/proj/stale.txt', displayName: 'stale.txt' });
    layoutOf([{ id: 'p1', kind: 'terminal' }], 'p1');

    expect(path()).toBeNull();
  });

  it('is null for an untyped PLACEHOLDER panel', () => {
    // The panel a new tab starts with. It is not an editor and has no editor state at all.
    layoutOf([{ id: 'p1', kind: 'placeholder' }], 'p1');

    expect(path()).toBeNull();
  });

  it('is null when there is no layout at all', () => {
    workspace.value = { layout: null };

    expect(path()).toBeNull();
  });

  it('falls back to a REAL panel when the recorded active id names nothing', () => {
    /*
     * Not a null case, and asserted here so the boundary is written down rather than assumed. A tab
     * whose `activePanelId` points at a destroyed panel still has to show something, so
     * `effectiveActivePanelId` resolves to a panel that exists — and this hook follows it.
     *
     * The first draft of this test asserted null, reasoning that inventing a path for a panel that
     * is gone is how a stale reveal points at the wrong file. That reasoning is about a DANGLING
     * id, and the fallback does not produce one: it answers with a panel the user can actually see.
     */
    layoutOf([{ id: 'e1', kind: 'editor', file: 'C:/proj/deep.txt' }], 'gone');

    expect(path()).toBe('C:/proj/deep.txt');
  });

  it('does not fall back to a NEIGHBOURING editor when the active panel is a terminal', () => {
    /*
     * The specific wrong answer that would satisfy "#188 works" in a one-editor workspace and be
     * silently wrong in every other: reaching past the active panel for whichever editor has a file.
     * The tree would then follow a panel the user is not in.
     */
    layoutOf(
      [
        { id: 'e1', kind: 'editor', file: 'C:/proj/a.txt' },
        { id: 'e2', kind: 'editor', file: 'C:/proj/b.txt' },
        { id: 't1p', kind: 'terminal' },
      ],
      't1p',
    );

    expect(path()).toBeNull();
  });
});
