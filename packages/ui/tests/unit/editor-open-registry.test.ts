/**
 * `findEditorPanelByPath` — the app-wide one-buffer oracle (006 FR-011a/011b, 018).
 *
 * PLACE AT: `packages/ui/tests/unit/editor-open-registry.test.ts`
 * NEW COVERAGE (035). This function is what decides, for every open gesture in the app, whether a
 * file is ALREADY open somewhere. `panel-body.tsx:194` consults it before a tree drop and focuses
 * the holding panel instead of opening a second view; the drop and tree routes in `editor-open.tsx`
 * lean on the same rule through main's `openInto`. It had no test at any layer.
 *
 * ══ WHY IT IS WORTH ITS OWN FILE ══
 *
 * It is seven lines and every one of them is a path-comparison rule, on a platform where path
 * comparison is exactly where this class of bug lives. Windows paths arrive from four sources that
 * disagree with each other: the tree gives forward slashes, `path.join` gives back-slashes, a
 * drag payload gives whatever the OS handed it, and a persisted layout gives whatever was stored
 * last release. `norm()` exists to reconcile them, and a regression in it does not throw — it
 * quietly answers "not open", and the user gets a second buffer over the same file.
 *
 * That is the failure FR-011a exists to prevent, and it would be invisible to every E2E in the
 * suite, because they all open files by one route and so never mix separator styles or cases.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  setEditorState,
  removeEditorState,
  findEditorPanelByPath,
  allEditorStates,
} from '../../src/renderer/editor/editor-state.js';

const open = (panelId: string, filePath: string | null): void => {
  setEditorState(panelId, { filePath, displayName: panelId });
};

afterEach(() => {
  for (const s of allEditorStates()) removeEditorState(s.panelId);
});

describe('findEditorPanelByPath', () => {
  it('finds the panel holding the file', () => {
    open('p1', 'D:/proj/a.txt');
    open('p2', 'D:/proj/b.txt');
    expect(findEditorPanelByPath('D:/proj/b.txt')).toBe('p2');
  });

  it('returns null when the file is open nowhere', () => {
    open('p1', 'D:/proj/a.txt');
    expect(findEditorPanelByPath('D:/proj/never.txt')).toBeNull();
  });

  it('ignores panels holding no file at all', () => {
    // An editor panel that has been created but never pointed at anything carries `filePath: null`.
    // A null-unsafe comparison here would match it against every lookup.
    open('p1', null);
    expect(findEditorPanelByPath('D:/proj/a.txt')).toBeNull();
  });

  it('matches across separator styles', () => {
    /*
     * The case this function exists for. The tree hands out forward slashes and `path.join` hands
     * back back-slashes, so the SAME file reaches this lookup spelled two ways within one gesture.
     * Answering "not open" here opens a second buffer over a file already being edited — silently,
     * and with no error anywhere.
     */
    open('p1', 'D:\\proj\\src\\a.txt');
    expect(findEditorPanelByPath('D:/proj/src/a.txt')).toBe('p1');

    open('p2', 'D:/proj/src/b.txt');
    expect(findEditorPanelByPath('D:\\proj\\src\\b.txt')).toBe('p2');
  });

  it('matches regardless of case, because Windows paths are case-insensitive', () => {
    open('p1', 'D:/Proj/README.md');
    expect(findEditorPanelByPath('d:/proj/readme.md')).toBe('p1');
  });

  it('does not match a DIFFERENT file whose path merely starts the same', () => {
    // A prefix/`startsWith` implementation would pass every test above and fail this one — which is
    // why it is here rather than left to the equality operator to be obvious.
    open('p1', 'D:/proj/a.txt');
    expect(findEditorPanelByPath('D:/proj/a.txt.bak')).toBeNull();
    expect(findEditorPanelByPath('D:/proj/a')).toBeNull();
  });

  it('does not match a file in a sibling folder with a shared prefix', () => {
    open('p1', 'D:/proj/src/a.txt');
    expect(findEditorPanelByPath('D:/proj/src-old/a.txt')).toBeNull();
  });

  it('stops at the first holder when a file is somehow open twice', () => {
    /*
     * Should not happen — preventing it is this function's whole job — but if the invariant is ever
     * broken, the caller focuses SOMETHING rather than throwing or returning null and opening a
     * third. Recorded as the deliberate behaviour it is, so a future reader does not "fix" it into
     * an error path that would strand the user.
     */
    open('p1', 'D:/proj/a.txt');
    open('p2', 'D:/proj/a.txt');
    expect(['p1', 'p2']).toContain(findEditorPanelByPath('D:/proj/a.txt'));
  });
});
