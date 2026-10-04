/**
 * 050 T029 (FR-025b) — when a paste finishes, the explorer shows what it placed.
 *
 * The folders the items landed in are opened, every placed row is selected, and the first is focused.
 * A paste that finishes while ANOTHER project is showing must not switch to its project: the result
 * waits in `pending-reveal` and the reveal happens the next time that project's tree is ready.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  entry,
  installResizeObserver,
  mountExplorer,
  standardHost,
  uninstallResizeObserver,
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

const ROOT = 'C:/projects/demo';
const extra = (): ReturnType<typeof createElement> => createElement(TransferCompletionHost);

const row = (tree: HTMLElement, label: string): HTMLElement => {
  const found = within(tree)
    .getAllByRole('treeitem')
    .find((r) => r.querySelector('.tree-label')?.textContent === label);
  if (!found) throw new Error(`no row labelled ${label}`);
  return found;
};

describe('reveal after a paste (050 T029)', () => {
  it('opens the folder the items landed in and selects every placed row, the first focused', async () => {
    const m = await mountExplorer(standardHost, { extra: extra() });
    // The paste put two files into the (collapsed, never-listed) Docs folder.
    m.files.dirs.set('Docs', [entry('note.txt', 'file'), entry('x.txt', 'file'), entry('y.txt', 'file')]);

    m.transfer.done({
      jobId: 'job-1',
      targetProjectId: 'project-a',
      placed: [`${ROOT}/Docs/x.txt`, `${ROOT}/Docs/y.txt`],
    });

    await waitFor(() => {
      expect(row(m.tree, 'Docs').getAttribute('aria-expanded')).toBe('true');
      expect(row(m.tree, 'x.txt').getAttribute('aria-selected')).toBe('true');
      expect(row(m.tree, 'y.txt').getAttribute('aria-selected')).toBe('true');
    });
    expect(row(m.tree, 'note.txt').getAttribute('aria-selected')).not.toBe('true');
    expect(row(m.tree, 'Docs').getAttribute('aria-selected')).not.toBe('true');
    // The FIRST placed row is the focused one.
    await waitFor(() => expect(document.activeElement).toBe(row(m.tree, 'x.txt')));
  });

  /*
   * The gate's `explorer-keyboard-selection.e2e.ts:54` red, at the layer that can hold the order still.
   *
   * A cut moves `a.txt` out of the root into the never-listed Docs folder. Two things then race: the
   * root's re-read (the item LEFT it) and the reveal's own listing of Docs (the item LANDED there). On
   * a slow machine the root's re-read commits first, and its passive effects are still queued when the
   * Docs listing arrives and the reveal marks itself settled. Those stale effects then run against the
   * commit WITHOUT Docs' rows, find the placed row absent, and drop the reveal as "gone" — so the folder
   * opens and the moved row is never selected. Measured in the E2E: the drain ran with the tree's map
   * holding only the root, the placed row absent and the settled flag already up.
   *
   * The order is pinned by holding the Docs listing until the root's re-read has reached the DOM (a
   * MutationObserver fires after a commit and before that commit's passive effects), then releasing it.
   */
  it('selects the placed row even when the source folder re-reads first (stale commit, 050 FR-025b)', async () => {
    const m = await mountExplorer(standardHost, { extra: extra() });
    m.files.dirs.set('Docs', [entry('note.txt', 'file'), entry('a.txt', 'file')]);
    // a.txt has LEFT the root — its re-read will change what the tree shows.
    m.files.dirs.set('', [entry('Docs', 'folder'), entry('b.txt', 'file')]);

    // Only the FIRST listing of Docs is held — the reveal's own; later ones (the open's re-read) pass.
    let releaseDocs: (() => void) | null = null;
    let held = false;
    let released = false;
    const original = m.files.files.list.getMockImplementation()!;
    m.files.files.list.mockImplementation((relDir: string) => {
      if (relDir !== 'Docs' || held) return original(relDir);
      held = true;
      return new Promise((resolve) => {
        releaseDocs = () => {
          released = true;
          void original(relDir).then(resolve);
        };
      });
    });
    // Release Docs the moment the root's re-read has been committed (a.txt's row is gone).
    const observer = new MutationObserver(() => {
      if (releaseDocs && within(m.tree).queryByText('a.txt') === null) {
        const go = releaseDocs;
        releaseDocs = null;
        observer.disconnect();
        go();
      }
    });
    observer.observe(m.tree, { childList: true, subtree: true });

    m.transfer.done({
      jobId: 'job-1',
      targetProjectId: 'project-a',
      placed: [`${ROOT}/Docs/a.txt`],
      undo: { kind: 'move', items: [{ from: `${ROOT}/a.txt`, to: `${ROOT}/Docs/a.txt` }] },
    });

    await waitFor(() => {
      expect(row(m.tree, 'Docs').getAttribute('aria-expanded')).toBe('true');
      expect(row(m.tree, 'a.txt').getAttribute('aria-level')).toBe('3');
    });
    expect(released).toBe(true); // the losing order was actually arranged, not bypassed
    await waitFor(() => expect(row(m.tree, 'a.txt').getAttribute('aria-selected')).toBe('true'));
    observer.disconnect();
  });

  it('does NOT reveal for a rolled-back run — nothing was placed', async () => {
    const m = await mountExplorer(standardHost, { extra: extra() });
    m.files.dirs.set('Docs', [entry('note.txt', 'file'), entry('x.txt', 'file')]);

    m.transfer.done({
      jobId: 'job-1',
      outcome: 'rolled-back',
      targetProjectId: 'project-a',
      placed: [`${ROOT}/Docs/x.txt`],
    });

    // Settle, then assert absence: Docs stays closed.
    await new Promise((r) => setTimeout(r, 50));
    expect(row(m.tree, 'Docs').getAttribute('aria-expanded')).not.toBe('true');
  });

  it('queues a run that finished for ANOTHER project and applies it when that project is next shown', async () => {
    const first = await mountExplorer(standardHost, { projectId: 'project-a', extra: extra() });

    // project-b's paste finishes while project-a is showing.
    first.transfer.done({
      jobId: 'job-9',
      targetProjectId: 'project-b',
      placed: ['D:/projects/other/Docs/z.txt'],
    });
    // Project A's tree did nothing about it.
    await new Promise((r) => setTimeout(r, 30));
    expect(within(first.tree).queryByText('z.txt')).toBeNull();
    first.unmount();

    // The user switches to project B: its tree mounts, becomes ready, and reveals what was placed.
    const second = await mountExplorer(standardHost, {
      projectId: 'project-b',
      rootFolder: 'D:/projects/other',
      listing: {
        '': [entry('Docs', 'folder')],
        Docs: [entry('z.txt', 'file')],
      },
      reuse: first,
      extra: extra(),
    });

    await waitFor(() => {
      expect(row(second.tree, 'Docs').getAttribute('aria-expanded')).toBe('true');
      expect(row(second.tree, 'z.txt').getAttribute('aria-selected')).toBe('true');
    });
    expect(screen.queryAllByRole('tree')).toHaveLength(1);
  });
});
