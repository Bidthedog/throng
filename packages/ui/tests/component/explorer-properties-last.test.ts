/**
 * 067 T133 (FR-128, refining FR-045) — Properties is the LAST item of the File Explorer context
 * menu, for a file and for a folder alike. "Last" is the drawn order, so the items are put through
 * the same `groupBySection` the menu renderer uses.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, groupBySection, type TargetNode } from '@throng/core';
import {
  buildContextMenuItems,
  type ContextMenuOps,
} from '../../src/renderer/explorer/context-menu-items.js';

const noop = (): void => undefined;

function drawn(node: TargetNode): string[] {
  const ops: ContextMenuOps = {
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
    properties: vi.fn(),
    excludeFromSearch: noop,
  };
  const items = buildContextMenuItems({
    node,
    selectedRelPaths: [],
    clipboard: null,
    ops,
    keybindings: DEFAULT_KEYBINDINGS,
    projectRoot: 'D:/project',
    undoState: { canUndo: false, canRedo: false },
  });
  return groupBySection(items, (i) => i.section ?? 'content')
    .flat()
    .map((i) => i.label ?? '');
}

describe('Properties is the last item of the explorer context menu (067 FR-128)', () => {
  it('for a file', () => {
    const labels = drawn({ relPath: 'src/a.ts', kind: 'file' });
    expect(labels).toContain('Hide in this project');
    expect(labels.at(-1)).toBe('Properties');
  });

  it('for a folder', () => {
    const labels = drawn({ relPath: 'src', kind: 'folder' });
    expect(labels).toContain('Expand All Children');
    expect(labels.at(-1)).toBe('Properties');
  });

  it('for the project root, which has no Hide row', () => {
    const labels = drawn({ relPath: '', kind: 'folder' });
    expect(labels.at(-1)).toBe('Properties');
  });
});
