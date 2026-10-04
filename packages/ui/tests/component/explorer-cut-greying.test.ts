/**
 * 050 T031 (FR-004, FR-005) — a cut row is greyed wherever it is shown, and stays greyed across a
 * project switch.
 *
 * The cut set is built from ABSOLUTE paths held by main, so it survives what the old per-tree state did
 * not: the tree remounting for another project and back. Escape (`clearClipboard`) empties main's
 * clipboard and every tree drops its grey.
 */
import { fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  installResizeObserver,
  mountExplorer,
  standardHost,
  uninstallResizeObserver,
} from './helpers/explorer-harness.js';

beforeAll(installResizeObserver);
afterAll(uninstallResizeObserver);
beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

const item = (absPath: string, projectId = 'project-a', projectRoot = 'C:/projects/demo') => ({
  absPath,
  projectId,
  projectRoot,
});

const cutRows = (tree: HTMLElement): string[] =>
  [...tree.querySelectorAll('.tree-row--cut .tree-label')].map((el) => el.textContent ?? '');

describe('cut greying follows the application clipboard (050 T031)', () => {
  it('greys exactly the rows whose absolute path is on the clipboard as a cut', async () => {
    const m = await mountExplorer(standardHost, {
      clipboard: { mode: 'cut', items: [item('C:/projects/demo/a.txt')] },
    });
    await waitFor(() => expect(cutRows(m.tree)).toEqual(['a.txt']));
  });

  it('does not grey a COPY', async () => {
    const m = await mountExplorer(standardHost, {
      clipboard: { mode: 'copy', items: [item('C:/projects/demo/a.txt')] },
    });
    await waitFor(() => expect(m.clipboard.api.get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(cutRows(m.tree)).toEqual([]);
  });

  it('does not grey a row that merely shares a name with an item cut in ANOTHER project', async () => {
    const m = await mountExplorer(standardHost, {
      clipboard: { mode: 'cut', items: [item('D:/projects/other/a.txt', 'project-b', 'D:/projects/other')] },
    });
    await waitFor(() => expect(m.clipboard.api.get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(cutRows(m.tree)).toEqual([]);
  });

  it('is still greyed after the tree remounts for another project and back (FR-004)', async () => {
    const first = await mountExplorer(standardHost, {
      clipboard: { mode: 'cut', items: [item('C:/projects/demo/a.txt')] },
    });
    await waitFor(() => expect(cutRows(first.tree)).toEqual(['a.txt']));
    first.unmount();

    // The user is on project B meanwhile: its tree greys nothing of project A's.
    const other = await mountExplorer(standardHost, {
      projectId: 'project-b',
      rootFolder: 'D:/projects/other',
      reuse: first,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(cutRows(other.tree)).toEqual([]);
    other.unmount();

    // …and back: the clipboard was never lost with the old tree.
    const again = await mountExplorer(standardHost, { reuse: first });
    await waitFor(() => expect(cutRows(again.tree)).toEqual(['a.txt']));
  });

  it('un-greys when the clipboard is emptied — Escape in the tree (FR-005)', async () => {
    const m = await mountExplorer(standardHost, {
      clipboard: { mode: 'cut', items: [item('C:/projects/demo/a.txt')] },
    });
    await waitFor(() => expect(cutRows(m.tree)).toEqual(['a.txt']));

    await userEvent.click(within(m.tree).getByText('Docs'));
    fireEvent.keyDown(document.activeElement ?? m.tree, { key: 'Escape' });

    expect(m.clipboard.api.clear).toHaveBeenCalled();
    await waitFor(() => expect(cutRows(m.tree)).toEqual([]));
  });

  it('un-greys when ANOTHER window empties the clipboard', async () => {
    const m = await mountExplorer(standardHost, {
      clipboard: { mode: 'cut', items: [item('C:/projects/demo/a.txt')] },
    });
    await waitFor(() => expect(cutRows(m.tree)).toEqual(['a.txt']));

    m.clipboard.push(null);

    await waitFor(() => expect(cutRows(m.tree)).toEqual([]));
  });
});
