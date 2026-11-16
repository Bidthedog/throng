import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import type { NodeRendererProps } from 'react-arborist';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_ICON_SET, type IconKey } from '@throng/core';
import { TreeRow } from '../../src/renderer/explorer/tree-node.js';
import type { TreeNodeData } from '../../src/renderer/explorer/use-explorer-data.js';

/**
 * 069 FR-056 — the tree row draws a folder's kind, and a linked folder's badge is a folder.
 *
 * Layer: component — what a row renders; the name-to-key table is tree-icons.test.ts's.
 */
afterEach(cleanup);

function mountRow(data: Partial<TreeNodeData>, isOpen = false): HTMLElement {
  const node = {
    data: { id: 'x', name: 'x', kind: 'file', relPath: 'x', isSymlink: false, ...data },
    isOpen,
    isEditing: false,
    isSelected: false,
    isFocused: false,
    willReceiveDrop: false,
  } as unknown as NodeRendererProps<TreeNodeData>['node'];
  const { container } = render(
    createElement(TreeRow, { node, style: {}, dragHandle: undefined } as unknown as NodeRendererProps<TreeNodeData>),
  );
  return container;
}

/** Markup as the DOM serialises it, so it compares with what a row drew. */
const asDrawn = (key: IconKey): string =>
  Object.assign(document.createElement('span'), { innerHTML: DEFAULT_ICON_SET[key] }).innerHTML;

describe('tree row icons (069 FR-056)', () => {
  it('draws a dependency folder as its kind, not as a plain folder', () => {
    const row = mountRow({ name: 'node_modules', kind: 'folder', relPath: 'node_modules' });
    expect(row.querySelector('.tree-icon .icon')!.innerHTML).toBe(asDrawn('folderDependencies'));
  });

  it('marks a file icon with its category, and leaves an unknown file and a folder unmarked (069 FR-061)', () => {
    expect(mountRow({ name: 'app.py', relPath: 'app.py' }).querySelector('.tree-icon')).toHaveAttribute('data-icon-category', 'code');
    cleanup();
    expect(mountRow({ name: 'notes.xyz', relPath: 'notes.xyz' }).querySelector('.tree-icon')).not.toHaveAttribute('data-icon-category');
    cleanup();
    expect(mountRow({ name: 'src', kind: 'folder', relPath: 'src' }).querySelector('.tree-icon')).not.toHaveAttribute('data-icon-category');
  });

  it('keeps the root open, whatever it is called', () => {
    const row = mountRow({ name: '.git', kind: 'folder', relPath: '' });
    expect(row.querySelector('.tree-icon .icon')!.innerHTML).toBe(asDrawn('folderOpen'));
  });

  it('badges a linked folder with the folder link, and a linked file with the file link', () => {
    const folder = mountRow({ name: 'shared', kind: 'folder', relPath: 'shared', isSymlink: true });
    expect(folder.querySelector('.tree-symlink .icon')!.innerHTML).toBe(asDrawn('folderSymlink'));
    cleanup();
    const file = mountRow({ name: 'a.txt', kind: 'file', relPath: 'a.txt', isSymlink: true });
    expect(file.querySelector('.tree-symlink .icon')!.innerHTML).toBe(asDrawn('symlink'));
  });
});
