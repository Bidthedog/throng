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
