/**
 * US3 (#126) + 023 (#127) — no menu row is left with a blank icon cell, and the fixed native chords
 * are advertised.
 *
 * PLACE AT: `packages/ui/tests/unit/menu-icon-tokens.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/context-menu-icons.e2e.ts` (034 FR-045), all four tests.
 *
 * ══ WHAT THOSE TESTS ACTUALLY ASSERTED ══
 *
 * Each one opened the app, made a project, opened a file / an editor / a real PowerShell / the cog
 * menu, right-clicked, and then read `.context-menu__icon` with `not.toBeEmpty()`. Playwright's
 * "empty" is `textContent.trim() === ''`, so what those assertions came down to is: the builder gave
 * the row an `icon` token, and that token resolves to a non-empty glyph in the shipped theme. Both
 * halves are data. Neither needs a window, and one of them needed a real shell to reach.
 *
 * ══ THE GAP THIS CLOSES, WHICH IS THE POINT ══
 *
 * `icon-tokens-exist.test.ts` scans the renderer for `<Icon token="…">` LITERALS. A menu item names
 * its token in an `icon:` FIELD, which that regex cannot see — so the tokens most likely to be wrong
 * (a menu row's, added by whoever added the row) were checked nowhere but in a running app. That is
 * exactly how #127 happened: the clipboard rows referenced tokens the shipped set never had, resolved
 * to an empty glyph, and rendered as blank cells with nothing failing anywhere.
 *
 * ══ WHAT THIS DOES NOT CLAIM ══
 *
 * That `ContextMenu` renders the token it is given. That is one line of the component
 * (`{item.icon ? <Icon token={item.icon}/> : ''}`) and it is asserted where it belongs —
 * `packages/ui/tests/component/context-menu-lifecycle.test.ts` renders a row with an icon and a row
 * without — plus `menus.e2e.ts`'s surviving `menu.locator('.icon')` count on the Key Bindings menu,
 * which is a real menu drawn by the real provider.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDINGS, THRONG_THEME } from '@throng/core';
import type { EditorView } from '@codemirror/view';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import { buildContextMenuItems } from '../../src/renderer/explorer/context-menu-items.js';
import { editorContentMenu } from '../../src/renderer/editor/content-menu.js';
import { terminalContentMenu } from '../../src/renderer/terminal/terminal-content-menu.js';
import { cogMenuItems } from '../../src/renderer/title-bar/cog-menu-items.js';

const noop = (): void => {};

/*
 * The fixtures, one per menu the migrated spec opened. They mirror `menu-sections.test.ts`'s table
 * deliberately — same shapes, same names — so the two read as one description of the menus rather
 * than as two half-remembered ones.
 */
const explorerOps = {
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

/** The explorer menu on a FILE — the one the spec right-clicked `a.txt` to get. */
const explorerFile = (): MenuAction[] =>
  buildContextMenuItems({
    node: { relPath: 'src/app.ts', kind: 'file' },
    selectedRelPaths: ['src/app.ts'],
    clipboard: { mode: 'copy', relPaths: ['src/other.ts'] },
    ops: explorerOps,
    openIn: [{ label: 'New Editor', icon: 'add', section: 'navigate', onClick: noop }],
    keybindings: DEFAULT_KEYBINDINGS,
    projectRoot: 'D:/project',
    undoState: { canUndo: true, canRedo: false },
  });

const editorMenu = (): MenuAction[] =>
  editorContentMenu({
    view: {} as EditorView,
    panelId: 'p1',
    viewId: 'v1',
    lineEnding: () => 'lf',
    wordWrap: { on: true, toggle: noop, chord: 'Alt+Z' },
    gotoLine: { open: noop, chord: 'Ctrl+G' },
  });

/** The terminal menu with NO selection — the state the spec asserted in, where Copy is disabled. */
const terminalMenu = (): MenuAction[] =>
  terminalContentMenu({
    link: null,
    selection: '',
    redrawChord: 'Ctrl+Shift+R',
    startFailure: false,
    actions: {
      openLink: noop,
      copyLinkAddress: noop,
      copySelection: noop,
      paste: noop,
      redraw: noop,
      tryAgain: noop,
      copyDetails: noop,
      clearPanelType: noop,
    },
  });

const cogMenu = (): MenuAction[] =>
  cogMenuItems({ openPreferences: noop, openLogs: noop, openAbout: noop });

const MENUS: { name: string; build: () => MenuAction[] }[] = [
  { name: 'explorer (file)', build: explorerFile },
  { name: 'editor content', build: editorMenu },
  { name: 'terminal content', build: terminalMenu },
  { name: 'cog', build: cogMenu },
];

/** Every action in a menu, including every level of every submenu. */
function flatten(items: MenuAction[]): MenuAction[] {
  return items.flatMap((item) => [item, ...(item.submenu ? flatten(item.submenu) : [])]);
}

/** The row with this label, at any depth. */
function row(items: MenuAction[], label: string): MenuAction {
  const found = flatten(items).find((item) => item.label === label);
  expect(found, `no menu row labelled "${label}"`).toBeDefined();
  return found!;
}

/**
 * The glyph the shipped theme draws for a token, or `undefined` when it defines none.
 *
 * This is what `Icon` resolves for the default configuration, and therefore what the migrated spec's
 * `not.toBeEmpty()` was reading. A token the theme does not define renders NOTHING — no warning, no
 * fallback glyph, no failing test — so a missing entry and an empty one are the same defect and are
 * treated the same way here.
 */
const glyphFor = (token: string): string | undefined =>
  (THRONG_THEME.icons as Record<string, string>)[token];

describe('the shipped theme is a real icon set (guards against a vacuous pass)', () => {
  it('defines enough tokens for the assertions below to mean something', () => {
    // Empty or renamed the `icons` map, and "every declared token resolves" would still hold — of
    // nothing. `icon-tokens-exist.test.ts` closes the same hole from the other side.
    expect(Object.keys(THRONG_THEME.icons).length).toBeGreaterThan(10);
  });
});

describe.each(MENUS)('$name menu', ({ build }) => {
  it('every icon token it declares draws a real glyph', () => {
    /*
     * Not "every row has an icon" — that is deliberately false. 023's rule is an icon only where a
     * token exists, so Open Link, Go To Line…, Word Wrap and the failure rows carry none, and adding a
     * blank cell to them would be the opposite of the fix. What must hold is that a token a builder
     * DOES name is one the theme draws.
     */
    const blank = flatten(build())
      .filter((item) => item.icon !== undefined)
      .filter((item) => (glyphFor(item.icon!) ?? '').trim() === '')
      .map((item) => `${item.label ?? '(no label)'}: icon="${item.icon}"`);

    expect(
      blank,
      'these menu rows name an icon token the shipped theme does not draw, so their icon cell ' +
        'renders BLANK — with the label intact and nothing failing anywhere:\n  ' +
        blank.join('\n  '),
    ).toEqual([]);
  });

  it('declares at least one icon, so the sweep above is not sweeping an empty menu', () => {
    expect(flatten(build()).filter((item) => item.icon !== undefined).length).toBeGreaterThan(0);
  });
});

describe('the rows #126 shipped blank now carry a glyph (#127)', () => {
  /*
   * Named individually rather than left to the sweep above, because the sweep only checks the tokens
   * that ARE declared: deleting `icon: 'cut'` from a row would leave it blank in the app and green up
   * there. These are the exact rows the four migrated tests read.
   */
  it('the explorer’s clipboard, rename, delete and hide rows', () => {
    const items = explorerFile();
    for (const label of ['Rename', 'Delete', 'Cut', 'Copy', 'Paste', 'Hide in this project']) {
      const item = row(items, label);
      expect(item.icon, `${label} has no icon token`).toBeDefined();
      expect(glyphFor(item.icon!)?.trim(), `${label}: icon="${item.icon}"`).toBeTruthy();
    }
  });

  it('the relocated OS reveal, which lives inside the Open In submenu', () => {
    // It moved under a parent in 023 (US5/#158) — and a row that moves is a row whose icon is easy to
    // lose, which is why the spec followed it into the flyout.
    const item = row(explorerFile(), 'OS File Explorer');
    expect(glyphFor(item.icon ?? '')?.trim()).toBeTruthy();
  });

  it('every editing row of the editor content menu', () => {
    const items = editorMenu();
    for (const label of ['Cut', 'Copy', 'Paste', 'Select All', 'Undo', 'Redo', 'Set Language…']) {
      const item = row(items, label);
      expect(item.icon, `${label} has no icon token`).toBeDefined();
      expect(glyphFor(item.icon!)?.trim(), `${label}: icon="${item.icon}"`).toBeTruthy();
    }
  });

  it('the terminal’s Copy and Paste, including while Copy is disabled', () => {
    // The spec made this point explicitly: Copy is disabled without a selection, and its glyph must
    // still render in the reserved cell — a disabled row is not a blank one.
    const items = terminalMenu();
    const copy = row(items, 'Copy');
    expect(copy.disabled, 'the fixture is meant to be the no-selection state').toBe(true);
    expect(glyphFor(copy.icon ?? '')?.trim()).toBeTruthy();
    expect(glyphFor(row(items, 'Paste').icon ?? '')?.trim()).toBeTruthy();
  });

  it('all five cog rows, which read as one gear beside four blank lines before 023', () => {
    const items = cogMenu();
    for (const testId of [
      'cog-menu-settings',
      'cog-menu-keybindings',
      'cog-menu-themes',
      'cog-menu-logs',
      'cog-menu-about',
    ]) {
      const item = flatten(items).find((i) => i.testId === testId);
      expect(item, `no cog row ${testId}`).toBeDefined();
      expect(glyphFor(item!.icon ?? '')?.trim(), `${testId}: icon="${item!.icon}"`).toBeTruthy();
    }
    // Distinct glyphs, not the opening gear repeated — each row says WHICH window it opens.
    const glyphs = flatten(items).map((i) => glyphFor(i.icon ?? ''));
    expect(new Set(glyphs).size, 'the cog rows must not all wear the same icon').toBe(glyphs.length);
  });
});

describe('the fixed native chords are advertised on the row (FR-017c)', () => {
  /*
   * These actions keep their native bindings and are deliberately off the rebindable list, so the
   * chord is display-only and is a literal in the builder. The spec read it out of
   * `menu-shortcut-<label>`; the brackets around it are the component's, and are asserted in
   * `context-menu-lifecycle.test.ts`.
   */
  it('the editor menu advertises Ctrl+X on Cut and Ctrl+Z on Undo', () => {
    const items = editorMenu();
    expect(row(items, 'Cut').shortcut).toBe('Ctrl+X');
    expect(row(items, 'Undo').shortcut).toBe('Ctrl+Z');
  });

  it('the terminal menu advertises Ctrl+V on Paste', () => {
    expect(row(terminalMenu(), 'Paste').shortcut).toBe('Ctrl+V');
  });
});
