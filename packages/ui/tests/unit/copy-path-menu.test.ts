/**
 * US9 (#156) — the "Copy Path" submenu, at the builder that decides every one of its guarantees.
 *
 * `copy-path.e2e.ts` launched Electron, created a project, expanded a folder and drove three nested
 * menus to read four strings back out of a clipboard. The clipboard it read is not the operating
 * system's: `harness.ts` sets `THRONG_E2E_CLIPBOARD: 'memory'` because "Electron's clipboard DOES NOT
 * WORK under this harness — text written to it reads back empty". So the launch bought a round trip
 * through an in-process store, not OS clipboard fidelity, and the reserve in Principle V it looked
 * like it was claiming was never actually being exercised.
 *
 * What the E2E was really asserting is two separable things, and BOTH are covered:
 *   1. the four RENDERINGS — `packages/core/tests/unit/path-forms.test.ts`, which pins all four by
 *      exact equality where the E2E used `toContain` / `not.toContain`;
 *   2. the WIRING — that the submenu offers exactly those four labels and that each one hands its own
 *      form to the clipboard, verbatim. Nothing asserted that anywhere. This file does, and it is the
 *      half that would silently rot: swapping `forms.absWin` for `forms.absPosix` on one row leaves
 *      `pathForms` perfectly correct and every other test in the repo green.
 *
 * ANTI-VACUITY CONTROL: delete the `vi.stubGlobal('window', …)` line in `beforeEach`. Every test here
 * clicks at least one submenu leaf and asserts on what reached the clipboard, so with no `window`
 * the production line `window.throng?.clipboard?.write(…)` throws `ReferenceError: window is not
 * defined` and ALL SEVEN tests fail. None of them can pass against a menu that was never built.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, pathForms, type TargetNode } from '@throng/core';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import {
  buildContextMenuItems,
  type ContextMenuOps,
} from '../../src/renderer/explorer/context-menu-items.js';

const noop = (): void => undefined;

const OPS: ContextMenuOps = {
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
};

/** Every entry handed to `clipboard.write`, in the order the leaves were clicked. */
interface ClipEntry {
  text: string;
  mode: string;
}
let written: ClipEntry[] = [];

beforeEach(() => {
  written = [];
  // The unit layer runs in `environment: 'node'`, which has no `window` at all — and the production
  // call site is `window.throng?.clipboard?.write(...)`, a BARE identifier, so it throws rather than
  // optional-chaining away. That is exactly what makes this stub the anti-vacuity control.
  vi.stubGlobal('window', {
    throng: {
      clipboard: {
        write: (entry: ClipEntry): void => {
          written.push(entry);
        },
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function copyPathSubmenu(projectRoot: string, node: TargetNode): MenuAction[] {
  const items = buildContextMenuItems({
    node,
    selectedRelPaths: [],
    clipboard: null,
    ops: OPS,
    keybindings: DEFAULT_KEYBINDINGS,
    projectRoot,
    undoState: { canUndo: false, canRedo: false },
  });
  const parent = items.find((i) => i.label === 'Copy Path');
  if (!parent) throw new Error('no "Copy Path" row in the menu');
  const submenu = parent.submenu;
  if (!submenu) throw new Error('"Copy Path" has no submenu');
  return submenu;
}

/** Click one leaf by its label and return the text it put on the clipboard. */
function copyForm(projectRoot: string, node: TargetNode, form: string): string {
  const leaf = copyPathSubmenu(projectRoot, node).find((i) => i.label === form);
  if (!leaf) throw new Error(`no "${form}" form in the Copy Path submenu`);
  const before = written.length;
  leaf.onClick?.();
  if (written.length !== before + 1) {
    throw new Error(`"${form}" wrote ${written.length - before} clipboard entries, expected 1`);
  }
  return written[written.length - 1].text;
}

const FILE: TargetNode = { relPath: 'src/b.txt', kind: 'file' };
const ROOT = 'D:/proj';

describe('the Copy Path submenu offers four forms and hands each to the clipboard (US9, #156)', () => {
  it('offers exactly the four absolute/relative × slash forms, in the shipped order, each writing its own', () => {
    const submenu = copyPathSubmenu(ROOT, FILE);
    expect(submenu.map((i) => i.label)).toEqual([
      'Absolute (Windows)',
      'Absolute (POSIX)',
      'Relative (Windows)',
      'Relative (POSIX)',
    ]);
    // Click them in the order they are drawn. The written texts must come back in the SAME order —
    // which is the assertion that catches two rows wired to each other's form, a swap that leaves
    // `pathForms` correct and every existing test green.
    for (const leaf of submenu) leaf.onClick?.();
    const forms = pathForms(ROOT, FILE.relPath);
    expect(written.map((e) => e.text)).toEqual([
      forms.absWin,
      forms.absPosix,
      forms.relWin,
      forms.relPosix,
    ]);
    // And by literal value, so this test does not merely restate `pathForms` back to itself.
    expect(written.map((e) => e.text)).toEqual([
      'D:\\proj\\src\\b.txt',
      '/d/proj/src/b.txt',
      'src\\b.txt',
      'src/b.txt',
    ]);
  });

  it('Absolute (POSIX) is the MSYS `/<drive>/…` root: forward slashes, no backslash, no drive colon', () => {
    const absPosix = copyForm(ROOT, FILE, 'Absolute (POSIX)');
    // The four shape assertions the E2E made, kept verbatim...
    expect(absPosix).toMatch(/^\/[a-z]\//);
    expect(absPosix).toContain('/src/b.txt');
    expect(absPosix).not.toContain('\\');
    expect(absPosix).not.toContain(':');
    // ...and then the whole string, which the E2E never pinned.
    expect(absPosix).toBe('/d/proj/src/b.txt');
  });

  it('Absolute (Windows) keeps the drive letter and uses only backslashes', () => {
    const absWin = copyForm(ROOT, FILE, 'Absolute (Windows)');
    expect(absWin).toContain('\\src\\b.txt');
    expect(absWin).not.toContain('/');
    expect(absWin).toBe('D:\\proj\\src\\b.txt');
  });

  it('the relative forms are relative to the project root and carry no drive', () => {
    expect(copyForm(ROOT, FILE, 'Relative (POSIX)')).toBe('src/b.txt');
    expect(copyForm(ROOT, FILE, 'Relative (Windows)')).toBe('src\\b.txt');
  });

  it('writes VERBATIM — a path with spaces is neither quoted nor escaped on the way out', () => {
    const spaced = copyForm('D:/My Projects/app', FILE, 'Absolute (Windows)');
    expect(spaced).toBe('D:\\My Projects\\app\\src\\b.txt');
    expect(spaced).not.toContain('"');
    expect(spaced).not.toContain('^');
    // `mode: 'verbatim'` is the contract with the clipboard service, and it is what stops a copied
    // path arriving somewhere else shell-quoted (cf. `terminal-drop-paths.test.ts`).
    expect(written.map((e) => e.mode)).toEqual(['verbatim']);
  });

  it('the project ROOT itself copies the root, and its relative forms are empty rather than "."', () => {
    const root: TargetNode = { relPath: '', kind: 'folder' };
    expect(copyForm(ROOT, root, 'Absolute (Windows)')).toBe('D:\\proj');
    expect(copyForm(ROOT, root, 'Absolute (POSIX)')).toBe('/d/proj');
    expect(copyForm(ROOT, root, 'Relative (Windows)')).toBe('');
    expect(copyForm(ROOT, root, 'Relative (POSIX)')).toBe('');
  });

  it('normalises a mixed-separator project root, so the copied path never mixes slashes', () => {
    const mixed = 'C:\\git/proj\\';
    expect(copyForm(mixed, FILE, 'Absolute (Windows)')).toBe('C:\\git\\proj\\src\\b.txt');
    expect(copyForm(mixed, FILE, 'Absolute (POSIX)')).toBe('/c/git/proj/src/b.txt');
  });
});
