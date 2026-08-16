/**
 * 033 US4 (T090) — **Collapse All Children** and **Expand All Children** on the explorer's
 * right-click menu (contracts/explorer-actions.md §B.3, E1–E3; spec FR-038, FR-047).
 *
 * At the builder, because that is where every guarantee in §B.3 is actually decided: whether the
 * rows exist at all for this node, which section they declare, what order they sit in, and what
 * they call. The E2E (`subtree-expand-collapse.e2e.ts`) proves the half a builder cannot — that
 * choosing one of them really moves the tree, and leaves no folder open over unloaded children.
 *
 * E2 is the assertion worth naming: for a FILE neither row is drawn AT ALL, not even disabled.
 * That is the deliberate opposite of US3's Terminal parent (drawn disabled with no project), and
 * the difference is Principle VI's own test — "would any future state enable it?". A file can
 * never acquire children, so the answer is no, and a permanently-dead row teaches nothing.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, type TargetNode } from '@throng/core';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import { withDividers } from '../../src/renderer/workspace/menu-dividers.js';
import {
  buildContextMenuItems,
  type ContextMenuOps,
} from '../../src/renderer/explorer/context-menu-items.js';

const noop = (): void => undefined;

const COLLAPSE = 'Collapse All Children';
const EXPAND = 'Expand All Children';

function ops(over: Partial<ContextMenuOps> = {}): ContextMenuOps {
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
    ...over,
  };
}

function build(node: TargetNode, over: Partial<ContextMenuOps> = {}): MenuAction[] {
  return buildContextMenuItems({
    node,
    selectedRelPaths: [],
    clipboard: null,
    ops: ops(over),
    keybindings: DEFAULT_KEYBINDINGS,
    projectRoot: 'D:/project',
    undoState: { canUndo: false, canRedo: false },
  });
}

const labels = (items: MenuAction[]): string[] =>
  items.map((i) => i.label ?? '(no label)');

const row = (items: MenuAction[], label: string): MenuAction => {
  const found = items.find((i) => i.label === label);
  if (!found) throw new Error(`no "${label}" item`);
  return found;
};

describe('Collapse / Expand All Children on a FOLDER (033 US4, E1, FR-038/FR-047)', () => {
  it('E1 — both are drawn, in the Navigate section, immediately after Copy Path', () => {
    const items = build({ relPath: 'src', kind: 'folder' });
    const navigate = labels(items.filter((i) => i.section === 'navigate'));
    expect(navigate).toEqual(['Open In', 'Copy Path', COLLAPSE, EXPAND]);
  });

  it('E1 — Collapse comes BEFORE Expand, which is the order the task states', () => {
    const names = labels(build({ relPath: 'src', kind: 'folder' }));
    expect(names.indexOf(COLLAPSE)).toBeLessThan(names.indexOf(EXPAND));
  });

  it('E1 — both declare section "navigate", so neither adds a divider to the menu', () => {
    const items = build({ relPath: 'src', kind: 'folder' });
    expect(row(items, COLLAPSE).section).toBe('navigate');
    expect(row(items, EXPAND).section).toBe('navigate');
    const rows = withDividers(items);
    const at = (label: string): number => rows.findIndex((r) => 'label' in r && r.label === label);
    // No boundary anywhere between Copy Path and the two new rows.
    const between = rows.slice(at('Copy Path'), at(EXPAND) + 1);
    expect(between.filter((r) => 'separator' in r)).toEqual([]);
  });

  it('E1 — they still appear when no project root is supplied (no Copy Path to sit after)', () => {
    const items = buildContextMenuItems({
      node: { relPath: 'src', kind: 'folder' },
      selectedRelPaths: [],
      clipboard: null,
      ops: ops(),
    });
    const navigate = labels(items.filter((i) => i.section === 'navigate'));
    expect(navigate).toEqual(['Open In', COLLAPSE, EXPAND]);
  });

  it('D3 — the project ROOT is a folder, so its menu offers both as well', () => {
    const items = build({ relPath: '', kind: 'folder' });
    expect(labels(items)).toEqual(expect.arrayContaining([COLLAPSE, EXPAND]));
  });

  it('each calls its action with the RIGHT-CLICKED node’s relative path', () => {
    const expandChildren = vi.fn();
    const collapseChildren = vi.fn();
    const items = build({ relPath: 'src/deep/nested', kind: 'folder' }, { expandChildren, collapseChildren });
    row(items, COLLAPSE).onClick?.();
    row(items, EXPAND).onClick?.();
    expect(collapseChildren).toHaveBeenCalledWith('src/deep/nested');
    expect(expandChildren).toHaveBeenCalledWith('src/deep/nested');
  });

  it('the root’s rows act on the root’s own empty relative path, not on a selection', () => {
    const expandChildren = vi.fn();
    const collapseChildren = vi.fn();
    const items = buildContextMenuItems({
      node: { relPath: '', kind: 'folder' },
      selectedRelPaths: ['src/other'],
      clipboard: null,
      ops: ops({ expandChildren, collapseChildren }),
      projectRoot: 'D:/project',
    });
    row(items, COLLAPSE).onClick?.();
    row(items, EXPAND).onClick?.();
    expect(collapseChildren).toHaveBeenCalledWith('');
    expect(expandChildren).toHaveBeenCalledWith('');
  });

  it('E3 — neither carries a keyboard shortcut, because neither is bound to one', () => {
    const items = build({ relPath: 'src', kind: 'folder' });
    expect(row(items, COLLAPSE).shortcut).toBeUndefined();
    expect(row(items, EXPAND).shortcut).toBeUndefined();
  });

  it('neither is ever drawn disabled for a folder — nothing about a folder makes them unavailable', () => {
    const items = build({ relPath: 'src', kind: 'folder' });
    expect(row(items, COLLAPSE).disabled).toBeFalsy();
    expect(row(items, EXPAND).disabled).toBeFalsy();
  });

  it('neither is a submenu — each is a single act', () => {
    const items = build({ relPath: 'src', kind: 'folder' });
    expect(row(items, COLLAPSE).submenu).toBeUndefined();
    expect(row(items, EXPAND).submenu).toBeUndefined();
  });
});

describe('a FILE draws NEITHER item (033 US4, E2, FR-038)', () => {
  it('E2 — neither label appears anywhere in a file’s menu, at any depth', () => {
    const items = build({ relPath: 'src/app.ts', kind: 'file' });
    const everyLabel: string[] = [];
    const walk = (rows: readonly MenuAction[]): void => {
      for (const r of rows) {
        everyLabel.push(r.label ?? '');
        if (r.submenu) walk(r.submenu);
      }
    };
    walk(items);
    expect(everyLabel).not.toContain(COLLAPSE);
    expect(everyLabel).not.toContain(EXPAND);
  });

  it('E2 — and not as a DISABLED row either: absent, not greyed', () => {
    const items = build({ relPath: 'src/app.ts', kind: 'file' });
    const disabled = items.filter((i) => i.disabled === true).map((i) => i.label);
    expect(disabled).not.toContain(COLLAPSE);
    expect(disabled).not.toContain(EXPAND);
    expect(items.find((i) => i.label === COLLAPSE)).toBeUndefined();
    expect(items.find((i) => i.label === EXPAND)).toBeUndefined();
  });

  it('E2 — a file’s Navigate section is otherwise exactly what it was', () => {
    const items = build({ relPath: 'src/app.ts', kind: 'file' });
    expect(labels(items.filter((i) => i.section === 'navigate'))).toEqual(['Open In', 'Copy Path']);
  });
});
