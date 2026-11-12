/**
 * 067 T034 (FR-015, FR-019, FR-021) — Open in OS Default Program on the File Explorer menu.
 *
 * It sits in the Open In submenu's OS section for one selected FILE (whether or not throng can preview
 * it), is absent on a folder and on a multi-selection, and is absent when the preference is off.
 */
import { act, render, waitFor } from '@testing-library/react';
import { createElement, createRef, type ReactElement } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TreeApi } from 'react-arborist';
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
import { buildContextMenuItems, type ContextMenuOps } from '../../src/renderer/explorer/context-menu-items.js';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';

const LABEL = 'Open in OS Default Program';

function ops(open = vi.fn()): ContextMenuOps {
  const noop = vi.fn();
  return {
    beginRename: noop,
    cut: noop,
    copy: noop,
    paste: noop,
    remove: noop,
    reveal: noop,
    hide: noop,
    newFolder: noop,
    newFile: noop,
    undoFileOp: noop,
    redoFileOp: noop,
    expandChildren: noop,
    collapseChildren: noop,
    findInFiles: noop,
    openInDefaultProgram: open,
  };
}

function build(over: {
  kind: 'file' | 'folder';
  relPath?: string;
  selected?: string[];
  show?: boolean;
  open?: ReturnType<typeof vi.fn>;
}): MenuAction[] {
  const relPath = over.relPath ?? (over.kind === 'file' ? 'a.txt' : 'Docs');
  return buildContextMenuItems({
    node: { relPath, kind: over.kind },
    selectedRelPaths: over.selected ?? [relPath],
    clipboard: null,
    ops: ops(over.open),
    showOpenInDefaultProgram: over.show ?? true,
    projectRoot: 'C:/projects/demo',
  });
}

const openInSubmenu = (items: MenuAction[]): MenuAction[] =>
  items.find((i) => i.label === 'Open In')!.submenu!;

describe('Open in OS Default Program on the explorer menu (067 US2)', () => {
  it('is in the Open In OS section for a single file, right after OS File Explorer, and opens that file', () => {
    const open = vi.fn();
    const sub = openInSubmenu(build({ kind: 'file', open }));
    const labels = sub.map((i) => i.label);
    expect(labels.indexOf(LABEL)).toBe(labels.indexOf('OS File Explorer') + 1);
    const item = sub.find((i) => i.label === LABEL)!;
    expect(item.group).toBe('os');
    expect(item.section).toBe('navigate');
    item.onClick?.();
    expect(open).toHaveBeenCalledWith('a.txt');
  });

  it('is absent on a folder', () => {
    expect(openInSubmenu(build({ kind: 'folder' })).map((i) => i.label)).not.toContain(LABEL);
  });

  it('is absent on a multi-selection', () => {
    const sub = openInSubmenu(build({ kind: 'file', selected: ['a.txt', 'b.txt'] }));
    expect(sub.map((i) => i.label)).not.toContain(LABEL);
  });

  it('is offered for the right-clicked file when the selection is elsewhere', () => {
    const sub = openInSubmenu(build({ kind: 'file', selected: ['b.txt', 'c.txt'] }));
    expect(sub.map((i) => i.label)).toContain(LABEL);
  });

  it('is absent when the setting is off', () => {
    expect(openInSubmenu(build({ kind: 'file', show: false })).map((i) => i.label)).not.toContain(LABEL);
  });
});

describe('the tree raises one notice when the OS cannot open the file (067 FR-015)', () => {
  beforeAll(installResizeObserver);
  afterAll(uninstallResizeObserver);
  afterEach(() => Reflect.deleteProperty(window, 'throng'));

  async function mount() {
    const files = fakeFiles(DEFAULT_LISTING());
    const daemon = fakeDaemon();
    Reflect.set(window, 'throng', {
      files: files.files,
      fileClipboard: fakeFileClipboard().api,
      transfer: fakeTransfer().api,
    });
    const holder: { api?: ExplorerApi } = {};
    const treeRef = createRef<TreeApi<TreeNodeData>>();
    function Probe(): ReactElement | null {
      holder.api = useExplorerData('C:/projects/demo', 'project-a', treeRef, 'demo', []);
      return null;
    }
    render(standardHost({ services: daemon.services, children: createElement(Probe) }));
    await waitFor(() => expect(holder.api?.ready).toBe(true));
    return { holder, files };
  }

  it('sends the root-relative path to main and raises nothing on success', async () => {
    const { holder, files } = await mount();
    act(() => holder.api!.openInDefaultProgram('a.txt'));
    await waitFor(() => expect(files.files.openInDefaultProgram).toHaveBeenCalledWith('a.txt'));
    expect(holder.api!.error).toBeNull();
  });

  it('reports the failure through the explorer error, which the tree shows as ONE notice, when main answers with an error', async () => {
    const { holder, files } = await mount();
    files.files.openInDefaultProgram.mockResolvedValueOnce({ error: 'No program is set for this file type.' } as never);
    act(() => holder.api!.openInDefaultProgram('a.txt'));
    await waitFor(() => expect(holder.api!.error).toBe('No program is set for this file type.'));
  });
});
