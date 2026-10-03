/**
 * 050 T062 (FR-020, US3) — a cross-project move is ONE operation in TWO projects' undo stacks.
 *
 * It is recorded in the target's stack and the source's, matched by the entry's `id`. Undoing or
 * redoing it from either project applies it once (main does the moving, over absolute paths) and then
 * moves the entry, in the OTHER project's persisted stack, to the matching side — so the two histories
 * never disagree about whether it is currently done. A refused undo changes neither stack and raises
 * the 024 FR-008a notice. Entries of the older, within-project kinds still go through the confined,
 * root-relative bridge exactly as before.
 *
 * Only one explorer is mounted at a time (018 FR-062), so the other project's stack is only ever read
 * and written through `FileOpUndoClient` — never held live.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FileOpUndoEntry } from '@throng/core';
import {
  installResizeObserver,
  mountExplorer,
  standardHost,
  uninstallResizeObserver,
  type MountedExplorer,
} from './helpers/explorer-harness.js';
import { TransferCompletionHost } from '../../src/renderer/explorer/transfer-completion.js';
import { resetPendingRevealForTests } from '../../src/renderer/explorer/pending-reveal.js';

beforeAll(installResizeObserver);
afterAll(uninstallResizeObserver);
beforeEach(() => {
  localStorage.clear();
  resetPendingRevealForTests();
});
afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

const CROSS: FileOpUndoEntry = {
  kind: 'move',
  id: 'cross-1',
  items: [{ from: 'C:/projects/demo/src/x.ts', to: 'D:/projects/other/x.ts' }],
  projects: { source: 'project-a', target: 'project-b' },
  at: 100,
};

const B = { projectId: 'project-b', rootFolder: 'D:/projects/other' } as const;
const A = { projectId: 'project-a', rootFolder: 'C:/projects/demo' } as const;

const host = () => createElement(TransferCompletionHost);
/** A key at the tree: whatever holds focus inside the pane, else the pane itself (nothing is focused yet). */
const keyAtTree = (key: string): void => {
  const pane = screen.getByTestId('file-explorer-tree');
  const target = pane.contains(document.activeElement) ? document.activeElement! : pane;
  fireEvent.keyDown(target, { key, ctrlKey: true });
};
const pressUndo = (): void => keyAtTree('z');
const pressRedo = (): void => keyAtTree('y');
/** The tree has read its stack AND the project list — a keypress before that finds nothing to undo. */
async function stacksLoaded(m: MountedExplorer): Promise<void> {
  await waitFor(() => {
    const methods = m.daemon.calls.map((c) => c.method);
    expect(methods).toContain('fileopUndo.get');
    expect(methods).toContain('projects.list');
  });
  await new Promise((r) => setTimeout(r, 30));
}
const ids = (list: readonly FileOpUndoEntry[]): (string | undefined)[] => list.map((e) => e.id);

/** Both projects hold the entry on their UNDO list — the state right after the paste. */
function seedBoth(m: MountedExplorer): void {
  for (const p of ['project-a', 'project-b']) m.daemon.seedStack(p, { undo: [CROSS], redo: [] });
}

describe('recording a cross-project move (050 T062)', () => {
  it('records it in the target (active) stack AND the source stack, under one id', async () => {
    const m = await mountExplorer(standardHost, { ...B, extra: host() });

    m.transfer.done({
      jobId: 'job-1',
      sourceProjectId: 'project-a',
      targetProjectId: 'project-b',
      placed: ['D:/projects/other/x.ts'],
      undo: CROSS,
    });

    await waitFor(() => {
      expect(ids(m.daemon.stack('project-b').undo)).toEqual(['cross-1']);
      expect(ids(m.daemon.stack('project-a').undo)).toEqual(['cross-1']);
    });
  });

  it('records it even when NEITHER project is the one showing', async () => {
    const m = await mountExplorer(standardHost, {
      projectId: 'project-c',
      rootFolder: 'E:/projects/third',
      extra: host(),
    });

    m.transfer.done({
      jobId: 'job-1',
      sourceProjectId: 'project-a',
      targetProjectId: 'project-b',
      placed: ['D:/projects/other/x.ts'],
      undo: CROSS,
    });

    await waitFor(() => {
      expect(ids(m.daemon.stack('project-b').undo)).toEqual(['cross-1']);
      expect(ids(m.daemon.stack('project-a').undo)).toEqual(['cross-1']);
    });
    expect(m.daemon.stack('project-c').undo).toHaveLength(0);
  });

  it('lets the mounted explorer undo it at once, with no remount', async () => {
    const m = await mountExplorer(standardHost, { ...B, extra: host() });
    m.transfer.done({
      jobId: 'job-1',
      sourceProjectId: 'project-a',
      targetProjectId: 'project-b',
      placed: ['D:/projects/other/x.ts'],
      undo: CROSS,
    });
    await waitFor(() => expect(m.daemon.stack('project-b').undo).toHaveLength(1));

    // The recording happens in the window host; the tree must pick it up and act on it.
    await new Promise((r) => setTimeout(r, 50)); // the tree re-reads the recorded stack
    pressUndo();
    await waitFor(() => expect(m.transfer.api.applyUndo).toHaveBeenCalledTimes(1));
  });

  it('records a within-project paste entry in that project only', async () => {
    const m = await mountExplorer(standardHost, { ...A, extra: host() });
    const within: FileOpUndoEntry = {
      kind: 'paste',
      id: 'p-1',
      moved: [],
      copied: [{ from: 'C:/projects/demo/a.txt', to: 'C:/projects/demo/Docs/a.txt' }],
      replaced: [{ path: 'C:/projects/demo/Docs/a.txt', trashedAt: 9 }],
      at: 5,
    };

    m.transfer.done({ jobId: 'job-1', placed: ['C:/projects/demo/Docs/a.txt'], undo: within });

    await waitFor(() => expect(ids(m.daemon.stack('project-a').undo)).toEqual(['p-1']));
    expect(m.daemon.stack('project-b').undo).toHaveLength(0);
  });
});

describe('undo and redo from either side (050 T062, FR-020)', () => {
  it('Ctrl+Z in the TARGET applies once, and moves the entry in the source stack by id', async () => {
    const m = await mountExplorer(standardHost, B);
    seedBoth(m);
    m.unmount();
    const again = await mountExplorer(standardHost, { ...B, reuse: m });

    await stacksLoaded(again);
    pressUndo();
    await waitFor(() => expect(again.transfer.api.applyUndo).toHaveBeenCalled());
    expect(again.transfer.api.applyUndo).toHaveBeenCalledTimes(1);
    expect(again.transfer.api.applyUndo).toHaveBeenCalledWith(CROSS, 'undo');

    await waitFor(() => {
      // Here: moved from undo to redo.
      expect(again.daemon.stack('project-b').undo).toHaveLength(0);
      expect(ids(again.daemon.stack('project-b').redo)).toEqual(['cross-1']);
      // There: taken off its undo list and put on its redo list.
      expect(again.daemon.stack('project-a').undo).toHaveLength(0);
      expect(ids(again.daemon.stack('project-a').redo)).toEqual(['cross-1']);
    });
  });

  it('Ctrl+Z in the SOURCE behaves symmetrically', async () => {
    const seed = await mountExplorer(standardHost, A);
    seedBoth(seed);
    seed.unmount();
    const m = await mountExplorer(standardHost, { ...A, reuse: seed });

    await stacksLoaded(m);
    pressUndo();
    await waitFor(() => expect(m.transfer.api.applyUndo).toHaveBeenCalled());
    expect(m.transfer.api.applyUndo).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(ids(m.daemon.stack('project-a').redo)).toEqual(['cross-1']);
      expect(ids(m.daemon.stack('project-b').redo)).toEqual(['cross-1']);
      expect(m.daemon.stack('project-b').undo).toHaveLength(0);
    });
  });

  it('redo from the other project puts the entry back on BOTH undo lists', async () => {
    const seed = await mountExplorer(standardHost, B);
    for (const p of ['project-a', 'project-b']) seed.daemon.seedStack(p, { undo: [], redo: [CROSS] });
    seed.unmount();
    const m = await mountExplorer(standardHost, { ...B, reuse: seed });

    await stacksLoaded(m);
    pressRedo();
    await waitFor(() => expect(m.transfer.api.applyUndo).toHaveBeenCalled());
    expect(m.transfer.api.applyUndo).toHaveBeenCalledWith(CROSS, 'redo');
    await waitFor(() => {
      expect(ids(m.daemon.stack('project-b').undo)).toEqual(['cross-1']);
      expect(ids(m.daemon.stack('project-a').undo)).toEqual(['cross-1']);
      expect(m.daemon.stack('project-a').redo).toHaveLength(0);
    });
  });

  it('a REFUSED undo leaves both stacks as they were and raises the error notice (024 FR-008a)', async () => {
    const seed = await mountExplorer(standardHost, B);
    seedBoth(seed);
    seed.unmount();
    const m = await mountExplorer(standardHost, { ...B, reuse: seed });
    m.transfer.api.applyUndo.mockResolvedValue({ error: 'x.ts is no longer there.' } as never);

    await stacksLoaded(m);
    pressUndo();
    await waitFor(() => expect(m.transfer.api.applyUndo).toHaveBeenCalled());

    await waitFor(() => {
      const card = screen.getByTestId('explorer-error');
      expect(card.className).toContain('notice--error');
    });
    expect(ids(m.daemon.stack('project-b').undo)).toEqual(['cross-1']);
    expect(m.daemon.stack('project-b').redo).toHaveLength(0);
    expect(ids(m.daemon.stack('project-a').undo)).toEqual(['cross-1']);
    expect(m.daemon.stack('project-a').redo).toHaveLength(0);
  });

  it('routes a `paste` entry to main BY KIND, even without `projects`', async () => {
    const seed = await mountExplorer(standardHost, A);
    const paste: FileOpUndoEntry = {
      kind: 'paste',
      id: 'p-1',
      moved: [],
      copied: [{ from: 'C:/projects/demo/a.txt', to: 'C:/projects/demo/Docs/a.txt' }],
      replaced: [{ path: 'C:/projects/demo/Docs/a.txt', trashedAt: 9 }],
      at: 5,
    };
    seed.daemon.seedStack('project-a', { undo: [paste], redo: [] });
    seed.unmount();
    const m = await mountExplorer(standardHost, { ...A, reuse: seed });

    await stacksLoaded(m);
    pressUndo();
    await waitFor(() => expect(m.transfer.api.applyUndo).toHaveBeenCalled());
    expect(m.transfer.api.applyUndo).toHaveBeenCalledWith(paste, 'undo');
    await waitFor(() => expect(ids(m.daemon.stack('project-a').redo)).toEqual(['p-1']));
  });
});

describe('a redo that refreshes the entry (050 T061)', () => {
  const original: FileOpUndoEntry = {
    kind: 'paste',
    id: 'p-9',
    moved: [{ from: 'C:/projects/demo/m.txt', to: 'D:/projects/other/m.txt' }],
    copied: [],
    replaced: [{ path: 'D:/projects/other/m.txt', trashedAt: 9 }],
    projects: { source: 'project-a', target: 'project-b' },
    at: 5,
  };
  const refreshed: FileOpUndoEntry = { ...original, replaced: [{ path: 'D:/projects/other/m.txt', trashedAt: 99 }] };

  it('stores the refreshed entry (same id) in BOTH stacks, so the next undo sends it', async () => {
    const seed = await mountExplorer(standardHost, B);
    for (const p of ['project-a', 'project-b']) seed.daemon.seedStack(p, { undo: [], redo: [original] });
    seed.unmount();
    const m = await mountExplorer(standardHost, { ...B, reuse: seed });
    m.transfer.api.applyUndo.mockResolvedValueOnce({ ok: true, entry: refreshed } as never);

    await stacksLoaded(m);
    pressRedo();
    await waitFor(() => expect(m.transfer.api.applyUndo).toHaveBeenCalledWith(original, 'redo'));
    await waitFor(() => {
      expect(m.daemon.stack('project-b').undo).toEqual([refreshed]);
      expect(m.daemon.stack('project-a').undo).toEqual([refreshed]);
    });

    pressUndo();
    await waitFor(() => expect(m.transfer.api.applyUndo).toHaveBeenCalledTimes(2));
    expect(m.transfer.api.applyUndo).toHaveBeenLastCalledWith(refreshed, 'undo');
  });
});

describe('the stacks on load and the older entry kinds (050 T062)', () => {
  it('drops an entry that names a project which no longer exists', async () => {
    const seed = await mountExplorer(standardHost, B);
    const orphan: FileOpUndoEntry = { ...CROSS, projects: { source: 'project-gone', target: 'project-b' } };
    seed.daemon.seedStack('project-b', { undo: [orphan], redo: [] });
    seed.unmount();
    const m = await mountExplorer(standardHost, { ...B, reuse: seed });
    await waitFor(() => expect(m.daemon.calls.map((c) => c.method)).toContain('projects.list'));
    await new Promise((r) => setTimeout(r, 30));

    pressUndo();
    await new Promise((r) => setTimeout(r, 30));

    expect(m.transfer.api.applyUndo, 'an orphaned entry was offered for undo').not.toHaveBeenCalled();
  });

  it('still applies a within-project rename through the root-relative bridge', async () => {
    const seed = await mountExplorer(standardHost, A);
    const rename: FileOpUndoEntry = {
      kind: 'rename',
      from: 'C:/projects/demo/old.txt',
      to: 'C:/projects/demo/a.txt',
      at: 1,
    };
    seed.daemon.seedStack('project-a', { undo: [rename], redo: [] });
    seed.unmount();
    const m = await mountExplorer(standardHost, { ...A, reuse: seed });

    await stacksLoaded(m);
    pressUndo();
    await waitFor(() => expect(m.files.files.rename).toHaveBeenCalled());
    expect(m.files.files.rename).toHaveBeenCalledWith('a.txt', 'old.txt');
    expect(m.transfer.api.applyUndo).not.toHaveBeenCalled();
  });

  it('keeps a within-project cut (`move` with no `projects`) on the root-relative bridge', async () => {
    const seed = await mountExplorer(standardHost, A);
    const move: FileOpUndoEntry = {
      kind: 'move',
      id: 'm-1',
      items: [{ from: 'C:/projects/demo/b.txt', to: 'C:/projects/demo/Docs/b.txt' }],
      at: 1,
    };
    seed.daemon.seedStack('project-a', { undo: [move], redo: [] });
    seed.unmount();
    const m = await mountExplorer(standardHost, {
      ...A,
      reuse: seed,
      listing: {
        '': [
          { name: 'Docs', kind: 'folder', isSymlink: false, hasChildren: true },
          { name: 'a.txt', kind: 'file', isSymlink: false, hasChildren: false },
        ],
        Docs: [{ name: 'b.txt', kind: 'file', isSymlink: false, hasChildren: false }],
      },
    });

    await stacksLoaded(m);
    pressUndo();
    await waitFor(() => expect(m.files.files.move).toHaveBeenCalled());
    expect(m.files.files.move).toHaveBeenCalledWith(['Docs/b.txt'], '');
    expect(m.transfer.api.applyUndo).not.toHaveBeenCalled();
  });
});

describe('an entry that created folders (050 T085, R16, FR-033)', () => {
  it('applies a within-project `move` carrying createdDirs through main, not the root-relative bridge', async () => {
    const seed = await mountExplorer(standardHost, A);
    const move: FileOpUndoEntry = {
      kind: 'move',
      id: 'm-2',
      items: [{ from: 'C:/projects/demo/test/test.md', to: 'C:/projects/demo/test2/test/test.md' }],
      createdDirs: ['C:/projects/demo/test2/test'],
      at: 1,
    };
    seed.daemon.seedStack('project-a', { undo: [move], redo: [] });
    seed.unmount();
    const m = await mountExplorer(standardHost, { ...A, reuse: seed });

    await stacksLoaded(m);
    pressUndo();

    // The bridge cannot remove a folder, so main applies it (it also recreates them on redo).
    await waitFor(() => expect(m.transfer.api.applyUndo).toHaveBeenCalledWith(move, 'undo'));
    expect(m.files.files.move).not.toHaveBeenCalled();
    await waitFor(() => expect(ids(m.daemon.stack('project-a').redo)).toEqual(['m-2']));
  });
});
