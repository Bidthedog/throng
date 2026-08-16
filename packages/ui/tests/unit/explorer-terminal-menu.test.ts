/**
 * 033 US3 (T079) — the **Terminal** submenu nested inside the explorer's existing "Open In"
 * submenu, over the ONE flavour catalogue.
 *
 * At the builder, not in the app, because that is where every guarantee in contract §A.1 is
 * actually decided: which items exist, which section they declare, and whether the parent is drawn
 * disabled or not drawn at all. The E2E (`open-in-terminal.e2e.ts`) proves the half a builder cannot
 * — that choosing a flavour puts a live shell in the right directory with the keyboard in it.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, type FlavourOption, type TargetNode } from '@throng/core';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import { withDividers } from '../../src/renderer/workspace/menu-dividers.js';
import {
  buildContextMenuItems,
  type ContextMenuOps,
} from '../../src/renderer/explorer/context-menu-items.js';

const noop = (): void => undefined;

const FLAVOURS: readonly FlavourOption[] = [
  { value: 'cmd', label: 'Command Prompt', defaultShellArguments: '/K' },
  { value: 'pwsh', label: 'PowerShell', defaultShellArguments: '-NoLogo' },
  { value: 'my-wsl', label: 'WSL: Ubuntu', defaultShellArguments: '--cd ~' },
];

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
    openInTerminal: noop,
    // 033 US4 — required on ContextMenuOps; this suite asserts nothing about them.
    expandChildren: noop,
    collapseChildren: noop,
    ...over,
  };
}

function build(
  node: TargetNode,
  flavours: readonly FlavourOption[] | undefined,
  over: Partial<ContextMenuOps> = {},
): MenuAction[] {
  return buildContextMenuItems({
    node,
    selectedRelPaths: [],
    clipboard: null,
    ops: ops(over),
    openIn:
      node.kind === 'file'
        ? [{ label: 'New Editor', icon: 'add', section: 'navigate', onClick: noop }]
        : undefined,
    keybindings: DEFAULT_KEYBINDINGS,
    projectRoot: 'D:/project',
    undoState: { canUndo: false, canRedo: false },
    flavours,
  });
}

const openIn = (items: MenuAction[]): MenuAction => {
  const found = items.find((i) => i.label === 'Open In');
  if (!found) throw new Error('no "Open In" item');
  return found;
};

const terminal = (items: MenuAction[]): MenuAction => {
  const found = (openIn(items).submenu ?? []).find((i) => i.label === 'Terminal');
  if (!found) throw new Error('no "Terminal" item inside "Open In"');
  return found;
};

describe('Open In → Terminal (033 US3, FR-029/FR-030/FR-035, contract A1–A6)', () => {
  it('A1 — a FOLDER’s "Open In" holds a nested "Terminal" submenu', () => {
    const items = build({ relPath: 'src', kind: 'folder' }, FLAVOURS);
    expect(openIn(items).submenu?.map((i) => i.label)).toEqual(['OS File Explorer', 'Terminal']);
  });

  it('A1 — a FILE’s "Open In" holds it too, after the editor targets', () => {
    const items = build({ relPath: 'src/app.ts', kind: 'file' }, FLAVOURS);
    expect(openIn(items).submenu?.map((i) => i.label)).toEqual([
      'OS File Explorer',
      'New Editor',
      'Terminal',
    ]);
  });

  it('A2 — its children are exactly the supplied catalogue, in order (no second copy of the list)', () => {
    const items = build({ relPath: 'src', kind: 'folder' }, FLAVOURS);
    expect(terminal(items).submenu?.map((i) => i.label)).toEqual([
      'Command Prompt',
      'PowerShell',
      'WSL: Ubuntu',
    ]);
  });

  it('A2 — choosing a flavour launches it for the right-clicked node', () => {
    const openInTerminal = vi.fn();
    const node: TargetNode = { relPath: 'src/deep', kind: 'folder' };
    const items = build(node, FLAVOURS, { openInTerminal });
    terminal(items).submenu?.[1]?.onClick?.();
    expect(openInTerminal).toHaveBeenCalledWith(node, FLAVOURS[1]);
  });

  it('A3/FR-035 — with an empty catalogue the parent is DRAWN and DISABLED, never hidden', () => {
    for (const flavours of [undefined, [] as FlavourOption[]]) {
      const items = build({ relPath: 'src', kind: 'folder' }, flavours);
      expect(terminal(items).disabled).toBe(true);
    }
  });

  it('A3 — with a catalogue it is enabled', () => {
    expect(terminal(build({ relPath: 'src', kind: 'folder' }, FLAVOURS)).disabled).toBeFalsy();
  });

  it('A6 — every new item declares section "navigate", so neither level draws a divider', () => {
    const items = build({ relPath: 'src/app.ts', kind: 'file' }, FLAVOURS);
    const openInItems = openIn(items).submenu ?? [];
    const terminalItems = terminal(items).submenu ?? [];
    for (const item of [...openInItems, ...terminalItems]) {
      expect(item.section, `${item.label ?? '(no label)'} declares its section`).toBe('navigate');
    }
    const separators = (rows: MenuAction[]): number =>
      withDividers(rows).filter((r) => 'separator' in r).length;
    expect(separators(openInItems)).toBe(0);
    expect(separators(terminalItems)).toBe(0);
  });
});
