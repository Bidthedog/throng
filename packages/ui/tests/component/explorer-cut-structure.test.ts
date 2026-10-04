/**
 * 050 T120 (FR-033, R27) — the renderer's twin of the cut repro.
 *
 * Reported: with `test/test.md` and `test.md` selected (a nested file and a root file of the same name),
 * Cut then Paste into `test2` did not do what Copy then Paste does. The main-process half is reproduced
 * through `registerTransferIpc`; this is the half that runs in the renderer: what the tree SENDS to main
 * for a cut of that selection, and for the paste that follows, must be the same as for a copy — same
 * paths, same order, same target — differing only in the mode word.
 */
import { fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  entry,
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

const listing = (): Record<string, ReturnType<typeof entry>[]> => ({
  '': [entry('test', 'folder'), entry('test2', 'folder'), entry('test.md', 'file')],
  test: [entry('test.md', 'file')],
  test2: [],
});

async function selectBothAndSend(mode: 'cut' | 'copy') {
  const m = await mountExplorer(standardHost, { listing: listing() });
  const user = userEvent.setup();
  // Open `test`, so both `test.md` rows exist.
  await user.click(within(m.tree).getByTestId('tree-twisty-test'));
  await waitFor(() => expect(within(m.tree).getAllByText('test.md')).toHaveLength(2));
  const [nested, root] = within(m.tree).getAllByText('test.md') as [HTMLElement, HTMLElement];
  await user.click(nested);
  await user.keyboard('{Control>}');
  await user.click(root);
  await user.keyboard('{/Control}');

  fireEvent.keyDown(document.activeElement ?? m.tree, { key: mode === 'cut' ? 'x' : 'c', ctrlKey: true });
  await waitFor(() => expect(m.clipboard.api.set).toHaveBeenCalledTimes(1));

  await user.click(within(m.tree).getByText('test2'));
  // Main holds the clipboard the renderer sent; the tree only needs to see that one exists.
  m.clipboard.push({
    mode,
    items: m.clipboard.api.set.mock.calls[0]![1].map((rel) => ({
      absPath: `C:/projects/demo/${rel}`,
      projectId: 'project-a',
      projectRoot: 'C:/projects/demo',
    })),
  });
  fireEvent.keyDown(document.activeElement ?? m.tree, { key: 'v', ctrlKey: true });
  await waitFor(() => expect(m.transfer.api.paste).toHaveBeenCalledTimes(1));
  return m;
}

describe('cut of a nested and a root file of the same name (050 T120, FR-033)', () => {
  it('sends main the same items and the same paste target as a copy does', async () => {
    const copied = await selectBothAndSend('copy');
    const copySet = copied.clipboard.api.set.mock.calls[0]!;
    const copyPaste = copied.transfer.api.paste.mock.calls[0]!;
    copied.unmount();
    Reflect.deleteProperty(window, 'throng');
    // The tree remembers which folders were open; the second mount must start closed like the first.
    localStorage.clear();

    const cut = await selectBothAndSend('cut');
    const cutSet = cut.clipboard.api.set.mock.calls[0]!;
    const cutPaste = cut.transfer.api.paste.mock.calls[0]!;

    expect(cutSet[0]).toBe('cut');
    expect(copySet[0]).toBe('copy');
    expect([...cutSet[1]].sort()).toEqual(['test.md', 'test/test.md']);
    expect(cutSet[1]).toEqual(copySet[1]);
    expect(cutPaste).toEqual(['test2']);
    expect(cutPaste).toEqual(copyPaste);
  });
});
