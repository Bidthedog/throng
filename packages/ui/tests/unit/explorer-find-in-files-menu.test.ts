/**
 * 043 T254 — the tree's *Open In → Search* submenu (FR-090, FR-090a), which REPLACES FR-029b's row.
 *
 * ══ WHAT THIS FILE USED TO ASSERT, AND WHY IT NO LONGER DOES ══
 *
 * It was T067, and it pinned FR-029b: a folder draws a top-level **Find in Files** row closing the
 * Navigate group, and a file draws none — "not even a disabled one", because "a file can never
 * become a directory, so a row offering to search inside one would be dead on every file the user
 * ever right-clicks".
 *
 * Round five withdrew both halves. FR-092 makes a single file a legitimate scope, which removes the
 * only reason a file never had the item. And FR-090 moves the row into *Open In → Search* rather
 * than keeping it beside the new submenu — 006 FR-030's own precedent for the OS reveal, "moved
 * under this submenu (removed from its previous top-level position, no duplication)". The file was
 * rewritten rather than amended line by line because every assertion in it was about a shape that
 * no longer exists; the two properties that DID survive — the item acts on the right-clicked node,
 * and it carries no chord — are carried forward below on their own terms.
 *
 * ══ WHY THIS IS A UNIT TEST ══
 *
 * `buildContextMenuItems` is a pure function over a node, a clipboard and a bag of handlers, and
 * every claim FR-090 makes is a claim about the array it returns.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, type TargetNode } from '@throng/core';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import { buildContextMenuItems } from '../../src/renderer/explorer/context-menu-items.js';

const noop = (): void => {};

type FindInFiles = (relPath: string, replace: boolean) => void;

const ops = (findInFiles: FindInFiles) => ({
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
  findInFiles,
});

function build(node: TargetNode, findInFiles: FindInFiles = noop): MenuAction[] {
  return buildContextMenuItems({
    node,
    selectedRelPaths: [],
    clipboard: null,
    ops: ops(findInFiles),
    keybindings: DEFAULT_KEYBINDINGS,
    projectRoot: 'D:/project',
    undoState: { canUndo: false, canRedo: false },
  });
}

const labels = (items: readonly MenuAction[]): string[] => items.map((i) => i.label ?? '');

const openIn = (items: readonly MenuAction[]): MenuAction[] =>
  items.find((i) => i.label === 'Open In')?.submenu ?? [];

const search = (items: readonly MenuAction[]): MenuAction | undefined =>
  openIn(items).find((i) => i.label === 'Search');

const leaf = (items: readonly MenuAction[], label: string): MenuAction | undefined =>
  search(items)?.submenu?.find((i) => i.label === label);

const FILE: TargetNode = { relPath: 'src/app.ts', kind: 'file' };
const FOLDER: TargetNode = { relPath: 'src/renderer', kind: 'folder' };
const ROOT: TargetNode = { relPath: '', kind: 'folder' };

describe('Open In → Search holds exactly Find and Find & Replace (FR-090, FR-090a)', () => {
  for (const [what, node] of [
    ['a file', FILE],
    ['a folder', FOLDER],
    ['the project root', ROOT],
  ] as const) {
    it(`on ${what}`, () => {
      // The labels the maintainer asked for, verbatim. FR-090a records the tension with FR-015's
      // "Find" and the two-string fallback; these assertions are what that fallback would change.
      expect(labels(search(build(node))?.submenu ?? [])).toEqual(['Find', 'Find & Replace']);
    });
  }

  it('sits LAST inside Open In, after Terminal — the first row stays the OS reveal', () => {
    // `explorer.e2e.ts` clicks the flyout's first row expecting the OS reveal. Appending keeps that
    // true without the E2E having to know this submenu exists.
    const drawn = labels(openIn(build(FOLDER)));
    expect(drawn[0]).toBe('OS File Explorer');
    expect(drawn.at(-1)).toBe('Search');
    expect(drawn.indexOf('Terminal')).toBeLessThan(drawn.indexOf('Search'));
  });

  it('declares navigate on the parent and on both leaves, so the flyout derives no divider', () => {
    const parent = search(build(FILE));
    expect(parent?.section).toBe('navigate');
    expect(parent?.submenu?.map((i) => i.section)).toEqual(['navigate', 'navigate']);
  });

  it('carries no chord on either leaf — they act on the right-clicked node, a chord has none', () => {
    /*
     * Carried forward from T067 unchanged. `search.findInFiles` and `search.replaceInFiles` ARE
     * bound, and showing them here would advertise a keystroke that does something else: the chord
     * keeps its term and searches where the panel already looks.
     */
    for (const label of ['Find', 'Find & Replace']) {
      expect(leaf(build(FOLDER), label)?.shortcut).toBeUndefined();
    }
  });
});

describe('each leaf hands over the node under the pointer and its disclosure', () => {
  it('Find searches the right-clicked FILE, with replace hidden', () => {
    const findInFiles = vi.fn();
    leaf(build(FILE, findInFiles), 'Find')?.onClick?.();
    expect(findInFiles).toHaveBeenCalledWith('src/app.ts', false);
  });

  it('Find & Replace searches the right-clicked FOLDER, with replace shown', () => {
    const findInFiles = vi.fn();
    leaf(build(FOLDER, findInFiles), 'Find & Replace')?.onClick?.();
    expect(findInFiles).toHaveBeenCalledWith('src/renderer', true);
  });

  it('the root hands over the empty path, which the scope box reads as the whole project', () => {
    const findInFiles = vi.fn();
    leaf(build(ROOT, findInFiles), 'Find')?.onClick?.();
    expect(findInFiles).toHaveBeenCalledWith('', false);
  });
});

describe('the old row is GONE, not joined (FR-090 supersedes FR-029b)', () => {
  /*
   * Asserted as an ABSENCE on purpose. A row that is moved and also left behind is the duplication
   * 006 FR-030 forbids — two rows naming one command on one menu — and a test that only looked for
   * the new submenu would pass against exactly that.
   */
  for (const [what, node] of [
    ['a folder', FOLDER],
    ['the root', ROOT],
    ['a file', FILE],
  ] as const) {
    it(`draws no top-level Find in Files row on ${what}`, () => {
      expect(labels(build(node))).not.toContain('Find in Files');
    });
  }
});
