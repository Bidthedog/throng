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

/**
 * "Hide in this project" acts on the right-clicked path (004 US3).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/explorer.e2e.ts:474` (035 T055) — `test('right-click Hide
 * removes the item from this project view (US3 hide)')`.
 *
 * ══ THE CHAIN, AND THE LINK NOBODY HELD ══
 *
 * Hiding a file is three steps, and two of them were already proven:
 *
 *   the menu row calls `ops.hide` with the right path   ← NOTHING asserted this
 *   `hiddenPaths` filters the DERIVED tree data          `component/file-tree.test.ts:488`
 *   the hidden set persists and can be undone            `e2e/project-settings.e2e.ts:39`
 *
 * `ops.hide` appears in three existing test files and is a `noop` in every one of them. So the row
 * could have called it with the wrong path, with the SELECTION instead of the clicked node, or not
 * at all, and only an Electron launch would have said so.
 *
 * The wrong-path case is not hypothetical: this menu operates on the selection when the clicked node
 * is part of it (`context-menu-items.ts:83`), and `hide` is one of the rows that must NOT — hiding
 * is per-item, and a Hide that took the selection would vanish several files from a single click.
 */
describe('Hide in this project (004 US3, migrated from explorer.e2e.ts:474)', () => {
  const HIDE = 'Hide in this project';

  it('is offered on a file', () => {
    expect(labels(build({ relPath: 'a.txt', kind: 'file' }))).toContain(HIDE);
  });

  it('calls hide with the RIGHT-CLICKED path', () => {
    const hide = vi.fn();
    row(build({ relPath: 'src/a.txt', kind: 'file' }, { hide }), HIDE).onClick?.();

    expect(hide).toHaveBeenCalledWith('src/a.txt');
  });

  it('acts on the clicked node even when a SELECTION is present', () => {
    /*
     * The row that must not follow the selection. This menu deliberately operates on the whole
     * selection for the file operations (`context-menu-items.ts:83`), and hiding is not one of
     * them — a Hide that took the selection would vanish several files from one click, and the user
     * would have no way to tell which.
     */
    const hide = vi.fn();
    const items = buildContextMenuItems({
      node: { relPath: 'src/a.txt', kind: 'file' },
      selectedRelPaths: ['src/a.txt', 'src/b.txt', 'README.md'],
      clipboard: null,
      ops: ops({ hide }),
      keybindings: DEFAULT_KEYBINDINGS,
      projectRoot: 'D:/project',
      undoState: { canUndo: false, canRedo: false },
    });

    row(items, HIDE).onClick?.();

    expect(hide).toHaveBeenCalledTimes(1);
    expect(hide).toHaveBeenCalledWith('src/a.txt');
  });

  it('declares the viewState section — hiding changes the VIEW, not the files', () => {
    // The vocabulary carries the promise the E2E's own comment made: "still on disk, just hidden".
    // A row filed under content would sit beside Delete, which is a different kind of gone.
    expect(row(build({ relPath: 'a.txt', kind: 'file' }), HIDE).section).toBe('viewState');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * What a destructive item OPERATES ON
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * MIGRATED FROM `delete-mixed.e2e.ts:73` (035 T056) — `test('Ctrl-selecting files + folders and
 * deleting removes ALL of them')` — and the menu half of `fileop-undo.e2e.ts:73`.
 *
 * ══ THE SELECTION, NOT THE ROW ══
 *
 * `delete-mixed.e2e.ts:73` launched an app and Ctrl-clicked four rows to establish one thing the
 * filesystem cannot see: that Delete is addressed to the SELECTION rather than to the row under the
 * pointer. What it then asserted — all four gone, files and folders alike, in any order, and an
 * ENOENT part-way through not aborting the rest — is
 * `integration/files-delete-mixed.integration.test.ts:39-57`, four cases against a real filesystem.
 *
 * The targeting rule itself (`context-menu-items.ts:85`) had NO test, for either branch. This file
 * used the multi-select shape for `Hide` — which deliberately does NOT take the selection — so the
 * shape was present and the rule was not.
 *
 * ══ AND AN ACTION THAT IS OFFERED WHILE UNAVAILABLE ══
 *
 * `fileop-undo.e2e.ts:73` opened with an assertion worth keeping and cheap to make here: before
 * anything has happened, Undo is present and DISABLED, carrying its chord. The source says why in
 * as many words — "an action that exists and is unavailable teaches what the menu can do; one that
 * vanishes teaches nothing (and leaves the user wondering whether undo exists at all)".
 */
describe('a destructive item is addressed to the SELECTION (FR-020, migrated from delete-mixed.e2e.ts:73)', () => {
  const DELETE = 'Delete';

  it('deletes every selected path when the clicked row is part of the selection', () => {
    const remove = vi.fn();
    const items = buildContextMenuItems({
      node: { relPath: 'b.txt', kind: 'file' },
      selectedRelPaths: ['dir1', 'a.txt', 'dir2', 'b.txt'],
      clipboard: null,
      ops: ops({ remove }),
      keybindings: DEFAULT_KEYBINDINGS,
      projectRoot: 'D:/project',
      undoState: { canUndo: false, canRedo: false },
    });

    row(items, DELETE).onClick?.();

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(['dir1', 'a.txt', 'dir2', 'b.txt']);
  });

  it('deletes only the CLICKED row when it is not in the selection', () => {
    /*
     * The other branch, and the one that protects the user: right-clicking a row outside the
     * selection must not sweep the selection up with it. A rule that always took the selection
     * would pass the test above and delete four files when the user pointed at a fifth.
     */
    const remove = vi.fn();
    const items = buildContextMenuItems({
      node: { relPath: 'elsewhere.txt', kind: 'file' },
      selectedRelPaths: ['dir1', 'a.txt'],
      clipboard: null,
      ops: ops({ remove }),
      keybindings: DEFAULT_KEYBINDINGS,
      projectRoot: 'D:/project',
      undoState: { canUndo: false, canRedo: false },
    });

    row(items, DELETE).onClick?.();

    expect(remove).toHaveBeenCalledWith(['elsewhere.txt']);
  });

  it('deletes the clicked row when nothing is selected at all', () => {
    // The ordinary case, and the one that would break if the rule were written as "prefer the
    // selection": an empty selection is not a reason to delete nothing.
    const remove = vi.fn();
    const items = buildContextMenuItems({
      node: { relPath: 'a.txt', kind: 'file' },
      selectedRelPaths: [],
      clipboard: null,
      ops: ops({ remove }),
      keybindings: DEFAULT_KEYBINDINGS,
      projectRoot: 'D:/project',
      undoState: { canUndo: false, canRedo: false },
    });

    row(items, DELETE).onClick?.();

    expect(remove).toHaveBeenCalledWith(['a.txt']);
  });

  it('applies the same rule to Cut and Copy, which share it', () => {
    // `targets` is computed once and used by three items. A rule that had drifted for one of them
    // would be invisible from Delete alone — and Cut taking the wrong set is a move, not a copy.
    const cut = vi.fn();
    const copy = vi.fn();
    const items = buildContextMenuItems({
      node: { relPath: 'b.txt', kind: 'file' },
      selectedRelPaths: ['a.txt', 'b.txt'],
      clipboard: null,
      ops: ops({ cut, copy }),
      keybindings: DEFAULT_KEYBINDINGS,
      projectRoot: 'D:/project',
      undoState: { canUndo: false, canRedo: false },
    });

    row(items, 'Cut').onClick?.();
    row(items, 'Copy').onClick?.();

    expect(cut).toHaveBeenCalledWith(['a.txt', 'b.txt']);
    expect(copy).toHaveBeenCalledWith(['a.txt', 'b.txt']);
  });
});

describe('Undo is OFFERED before it is available (migrated from fileop-undo.e2e.ts:73)', () => {
  const build = (undoState: { canUndo: boolean; canRedo: boolean }) =>
    buildContextMenuItems({
      node: { relPath: 'before.txt', kind: 'file' },
      selectedRelPaths: [],
      clipboard: null,
      ops: ops({}),
      keybindings: DEFAULT_KEYBINDINGS,
      projectRoot: 'D:/project',
      undoState,
    });

  it('draws Undo and Redo disabled when there is nothing to undo', () => {
    /*
     * Present, not absent. The source states the reason: "an action that exists and is unavailable
     * teaches what the menu can do; one that vanishes teaches nothing (and leaves the user wondering
     * whether undo exists at all)".
     */
    const items = build({ canUndo: false, canRedo: false });

    expect(row(items, 'Undo').disabled).toBe(true);
    expect(row(items, 'Redo').disabled).toBe(true);
  });

  it('carries the chord, so the menu teaches the keyboard route as well as the mouse one', () => {
    // The migrated test asserted the item "contains Ctrl". That the chord is `Ctrl+Z` and that it
    // reaches the FILE undo in the tree — and nothing in an editor or a terminal — is
    // `core/tests/unit/file-undo-redo-binding.test.ts:32`.
    const items = build({ canUndo: false, canRedo: false });

    expect(row(items, 'Undo').shortcut).toContain('Ctrl');
    expect(row(items, 'Redo').shortcut).toContain('Ctrl');
  });

  it('enables each one only when its own stack has something in it', () => {
    // Two flags, two items. A menu that keyed both off `canUndo` would pass every assertion above
    // and offer a Redo that does nothing.
    const undoOnly = build({ canUndo: true, canRedo: false });
    expect(row(undoOnly, 'Undo').disabled).toBe(false);
    expect(row(undoOnly, 'Redo').disabled).toBe(true);

    const redoOnly = build({ canUndo: false, canRedo: true });
    expect(row(redoOnly, 'Undo').disabled).toBe(true);
    expect(row(redoOnly, 'Redo').disabled).toBe(false);
  });
});
