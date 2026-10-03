/**
 * 050 T041 (FR-017, FR-019e) — a drag-and-drop goes through the transfer engine too.
 *
 * It was `files.move` / `files.copy` called straight from the tree, which could not ask about a name
 * that already exists. Now `drop` calls `transfer.drop(items, dest, mode)` and works from what comes
 * back: the undo entry main built from the journal (so a drag that REPLACED something is undoable
 * with the replaced item restored), the reload of the folders involved, and the language override
 * following whatever really moved. A drag has no progress and no cancel (FR-019e) — the call simply
 * resolves when the job ends.
 *
 * react-arborist's drop maths measures the DOM (`getBoundingClientRect`, 0×0 in jsdom), so the drop
 * itself is driven through the hook's own `drop`, which is what `FileTree`'s `onMove` calls.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement, createRef, type ReactElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TreeApi } from 'react-arborist';
import type { TransferResult } from '@throng/core';
import {
  DEFAULT_LISTING,
  fakeDaemon,
  fakeFileClipboard,
  fakeFiles,
  fakeTransfer,
  installResizeObserver,
  standardHost,
  uninstallResizeObserver,
} from './helpers/explorer-harness.js';
import {
  useExplorerData,
  type ExplorerApi,
  type TreeNodeData,
} from '../../src/renderer/explorer/use-explorer-data.js';
import { resetFileClipboardStoreForTests } from '../../src/renderer/explorer/file-clipboard-store.js';

beforeAll(installResizeObserver);
afterAll(uninstallResizeObserver);
beforeEach(() => {
  localStorage.clear();
  resetFileClipboardStoreForTests();
});
afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

const ROOT = 'C:/projects/demo';

async function mount() {
  const clipboard = fakeFileClipboard();
  const transfer = fakeTransfer();
  const daemon = fakeDaemon();
  const files = fakeFiles(DEFAULT_LISTING());
  Reflect.set(window, 'throng', {
    files: files.files,
    fileClipboard: clipboard.api,
    transfer: transfer.api,
  });
  const holder: { api?: ExplorerApi } = {};
  const treeRef = createRef<TreeApi<TreeNodeData>>();
  function Probe(): ReactElement | null {
    holder.api = useExplorerData(ROOT, 'project-a', treeRef, 'demo', []);
    return null;
  }
  render(standardHost({ services: daemon.services, children: createElement(Probe) }));
  await waitFor(() => expect(holder.api?.ready).toBe(true));
  return { holder, transfer, daemon, files };
}

const result = (over: Partial<TransferResult> = {}): TransferResult => ({
  jobId: 'drag-1',
  kind: 'drag',
  outcome: 'completed',
  placed: [],
  undo: null,
  failures: [],
  rollbackFailures: [],
  sourceProjectId: 'project-a',
  targetProjectId: 'project-a',
  ...over,
});

const notices = (): HTMLElement[] => [
  ...(screen.queryByTestId('notices')?.querySelectorAll<HTMLElement>('.notice') ?? []),
];

describe('a drop is a transfer job (050 T041)', () => {
  it('calls transfer.drop with the dragged items, the destination and the mode — never files.move/copy', async () => {
    const { holder, transfer, files } = await mount();
    transfer.api.drop.mockResolvedValue(result());

    act(() => holder.api!.drop(['a.txt', 'b.txt'], 'Docs', false));
    await waitFor(() => expect(transfer.api.drop).toHaveBeenCalledTimes(1));
    expect(transfer.api.drop).toHaveBeenCalledWith(['a.txt', 'b.txt'], 'Docs', 'cut');
    expect(files.files.move).not.toHaveBeenCalled();

    act(() => holder.api!.drop(['a.txt'], 'Docs', true));
    await waitFor(() => expect(transfer.api.drop).toHaveBeenCalledTimes(2));
    expect(transfer.api.drop).toHaveBeenLastCalledWith(['a.txt'], 'Docs', 'copy');
    expect(files.files.copy).not.toHaveBeenCalled();
  });

  it('records the undo entry the result carries — and does not invent one when it carries none', async () => {
    const { holder, transfer, daemon } = await mount();
    transfer.api.drop.mockResolvedValueOnce(
      result({
        undo: {
          kind: 'move',
          id: 'e1',
          items: [{ from: `${ROOT}/a.txt`, to: `${ROOT}/Docs/a.txt` }],
          at: 5,
        },
      }),
    );
    act(() => holder.api!.drop(['a.txt'], 'Docs', false));
    await waitFor(() => expect(holder.api!.canUndoFileOp).toBe(true));
    await waitFor(() => expect(daemon.stack('project-a').undo).toHaveLength(1));
    expect(daemon.stack('project-a').undo[0]).toMatchObject({ kind: 'move', id: 'e1' });

    transfer.api.drop.mockResolvedValueOnce(result({ undo: null }));
    act(() => holder.api!.drop(['b.txt'], 'Docs', true));
    await waitFor(() => expect(transfer.api.drop).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(daemon.stack('project-a').undo).toHaveLength(1);
  });

  it('re-reads the folders the drop touched', async () => {
    const { holder, transfer, files } = await mount();
    transfer.api.drop.mockResolvedValue(
      result({
        undo: { kind: 'move', items: [{ from: `${ROOT}/a.txt`, to: `${ROOT}/Docs/a.txt` }], at: 1 },
      }),
    );
    const before = files.files.list.mock.calls.length;

    act(() => holder.api!.drop(['a.txt'], 'Docs', false));

    await waitFor(() => expect(files.files.list.mock.calls.length).toBeGreaterThan(before));
  });

  it('carries the language override to where the file REALLY landed (a kept-both name differs)', async () => {
    const { holder, transfer, daemon } = await mount();
    daemon.seedOverride('project-a', 'a.txt', 'markdown');
    transfer.api.drop.mockResolvedValue(
      result({
        undo: {
          kind: 'move',
          items: [{ from: `${ROOT}/a.txt`, to: `${ROOT}/Docs/a (2).txt` }],
          at: 1,
        },
      }),
    );

    act(() => holder.api!.drop(['a.txt'], 'Docs', false));

    await waitFor(() => expect(daemon.override('project-a', 'Docs/a (2).txt')).toBe('markdown'));
  });

  it('reports the items that failed as ONE error notice', async () => {
    const { holder, transfer } = await mount();
    transfer.api.drop.mockResolvedValue(
      result({
        failures: [
          { name: 'a.txt', message: 'It is open in another program.' },
          { name: 'b.txt', message: 'It could not be found.' },
        ],
      }),
    );

    act(() => holder.api!.drop(['a.txt', 'b.txt'], 'Docs', false));

    await waitFor(() => expect(notices()).toHaveLength(1));
    const text = notices()[0]!.textContent ?? '';
    expect(text).toContain('a.txt');
    expect(text).toContain('b.txt');
  });

  it('reports a refused job (`{ error }`) through the explorer error, not as a result', async () => {
    const { holder, transfer } = await mount();
    transfer.api.drop.mockResolvedValue({ error: 'Nothing to move.' } as unknown as TransferResult);

    act(() => holder.api!.drop(['a.txt'], 'Docs', false));

    await waitFor(() => expect(holder.api!.error).toBe('Nothing to move.'));
    expect(vi.isMockFunction(transfer.api.drop)).toBe(true);
  });
});
