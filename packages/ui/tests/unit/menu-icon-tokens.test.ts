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
import { panelHeaderMenu } from '../../src/renderer/workspace/panel-header-menu.js';

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
      reloadTerminal: noop,
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

/* ────────────────────────────────────────────────────────────────────────── *
 * The CONTENT menu and the panel-HEADER menu are different menus
 * (016 FR-014 — migrated from editor-content-menu.e2e.ts:203, 035 T055)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * ══ WHAT THE E2E WAS ASSERTING ══
 *
 * That right-clicking the TEXT offers Cut and Set Language and NOT Save, and right-clicking the
 * panel HANDLE offers Save and NOT Cut. Two menus, four claims, all about which labels each builder
 * produces.
 *
 * It reached them by launching Electron, creating a project on a real temp directory, opening a file
 * in an editor panel, right-clicking a rendered line, reading the menu, pressing Escape, then
 * right-clicking the panel handle and reading the other one.
 *
 * Every one of those claims is a property of two PURE FUNCTIONS. `editorContentMenu` touches its
 * `view` only inside the `onClick` closures — which is why the harness above can already build it
 * with `{} as EditorView` — and `panelHeaderMenu` takes a plain panel record. Neither needs a
 * document, a selection, a project or a window to say what it contains.
 *
 * ══ WHY IT IS ASSERTED AS A DISJOINTNESS AND NOT AS FOUR LABELS ══
 *
 * FR-014's claim is that these are *distinct* menus — the content menu acts on the text, the header
 * menu acts on the panel. Four hand-picked labels test four examples of that; the overlap check
 * below tests the rule. It is what would catch a future item added to the wrong builder, which is
 * the actual regression FR-014 exists to prevent and the one four literals would sail past.
 *
 * The four original labels are kept as well, because a disjointness assertion is satisfied by two
 * EMPTY menus and would then prove nothing at all.
 */
describe('FR-014 — the content menu and the panel-header menu are distinct', () => {
  const headerMenu = (): MenuAction[] =>
    panelHeaderMenu({
      panel: {
        id: 'p1',
        kind: 'editor',
        title: 'app.ts',
        titleIsCustom: false,
      } as unknown as Parameters<typeof panelHeaderMenu>[0]['panel'],
      panelVerb: 'Destroy',
      keybindings: DEFAULT_KEYBINDINGS,
      otherTabs: [],
      editor: { filePath: 'D:/project/src/app.ts', dirty: false } as unknown as Parameters<
        typeof panelHeaderMenu
      >[0]['editor'],
      editorFailure: false,
      detach: null,
      actions: new Proxy({}, { get: () => noop }) as Parameters<
        typeof panelHeaderMenu
      >[0]['actions'],
    });

  const labelsOf = (items: MenuAction[]): string[] =>
    flatten(items)
      .map((i) => i.label)
      .filter((l): l is string => typeof l === 'string' && l.length > 0);

  it('both menus actually have items — otherwise the disjointness below proves nothing', () => {
    expect(labelsOf(editorMenu()).length).toBeGreaterThan(3);
    expect(labelsOf(headerMenu()).length).toBeGreaterThan(3);
  });

  it('the CONTENT menu acts on the text: Cut and Set Language, and no Save', () => {
    const labels = labelsOf(editorMenu());
    expect(labels).toContain('Cut');
    expect(labels.some((l) => l.startsWith('Set Language'))).toBe(true);
    expect(labels).not.toContain('Save');
  });

  it('the HEADER menu acts on the panel: Save, and no Cut', () => {
    const labels = labelsOf(headerMenu());
    expect(labels).toContain('Save');
    expect(labels).not.toContain('Cut');
  });

  it('and no label appears in BOTH — the rule, not four examples of it', () => {
    /*
     * The assertion the E2E could not afford to make. It checked four labels; this checks every
     * label in both menus, so an item added to the wrong builder fails here rather than being
     * discovered by a user wondering why Save is in the text menu.
     */
    const content = new Set(labelsOf(editorMenu()));
    const header = labelsOf(headerMenu());
    const shared = header.filter((l) => content.has(l));
    expect(shared, `these labels appear in BOTH menus: ${shared.join(', ')}`).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The Set Language item NAMES the current language
 * (016 — migrated from editor-content-menu.e2e.ts:256, 035 T055)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * ══ WHY A MENU THAT ONLY OFFERS TO CHANGE SOMETHING IS WORSE THAN ONE THAT STATES IT ══
 *
 * `content-menu.ts` puts it plainly: the item carries the document's effective language "so the menu
 * states the" language rather than only offering to change it. A user who wants to know what throng
 * thinks a file is has nowhere else to look — the strip shows it, but the menu is the panel's index
 * of what it can do, and an item reading only "Set Language…" answers the question with a question.
 *
 * ══ WHAT MOVED, AND WHAT DID NOT ══
 *
 * The E2E made three claims. Two are these — the item names the CURRENT language, and after a change
 * it names the NEW one — and both are `args.languageName` reaching a label, which is a pure input to
 * a pure function.
 *
 * The third is that choosing a language returns the caret to the DOCUMENT, and it stays end-to-end
 * for now: it asserts `document.activeElement.closest('[data-testid="editor-…"]')` after the picker
 * closes, which needs the real editor to have taken focus. `component/language-picker-keyboard.test.ts`
 * owns the picker's own keyboard behaviour; where the caret lands in a real CodeMirror afterwards is
 * not something that file can currently say.
 */
describe('the Set Language item states the language, not just the offer', () => {
  const setLanguageLabel = (languageName?: string): string | undefined => {
    const items = editorContentMenu({
      view: {} as EditorView,
      panelId: 'p1',
      viewId: 'v1',
      lineEnding: () => 'lf',
      wordWrap: { on: true, toggle: noop, chord: 'Alt+Z' },
      gotoLine: { open: noop, chord: 'Ctrl+G' },
      languageName,
    } as Parameters<typeof editorContentMenu>[0]);
    return flatten(items).find((i) => i.testId === 'menu-item-Set Language…')?.label;
  };

  it('names a plain-text document as Plain Text — the E2E’s opening assertion', () => {
    expect(setLanguageLabel('Plain Text')).toBe('Set Language… (Plain Text)');
  });

  it('names the NEW language once one has been chosen — its closing assertion', () => {
    expect(setLanguageLabel('JSON')).toBe('Set Language… (JSON)');
  });

  it('falls back to the bare offer when there is no language to state', () => {
    /*
     * Not in the E2E, and the branch that would otherwise go untested: `languageName` is optional,
     * so an implementation that interpolated regardless would render "Set Language… (undefined)" —
     * which is worse than saying nothing and is exactly the shape a template literal produces when
     * nobody checks.
     */
    expect(setLanguageLabel(undefined)).toBe('Set Language…');
  });

  it('never renders the word "undefined" for any input the type allows', () => {
    for (const name of [undefined, '', 'JSON']) {
      expect(setLanguageLabel(name) ?? '').not.toContain('undefined');
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * A failing panel offers its three recovery commands IN THE MENU
 * (FR-042c/FR-042d — migrated from panel-failure-banner.e2e.ts:408, 035 T055)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * ══ WHY THE MENU AND NOT ONLY THE BANNER ══
 *
 * `panel-header-menu.ts` states the rule it is keeping: the constitution binds a feature that adds a
 * panel action to add its menu item in the same increment, because *"an action reachable only as an
 * icon on a banner is unreachable from where users look for panel commands, and undiscoverable by
 * anyone who does not recognise the glyph."*
 *
 * And the LABELS are the banner's, unchanged (FR-042d) — that is what makes them the same command
 * rather than a second one that looks like it.
 *
 * ══ WHAT THE E2E PAID TO ASSERT THIS ══
 *
 * A 240-second budget, a real editor driven into a real unreadable-file state, a real terminal
 * driven into a real start failure, two right-clicks and two menu dismissals — to check that three
 * labels are present twice.
 *
 * Both menus gate those rows on a plain boolean: `editorFailure` for the panel header,
 * `startFailure` for the terminal content menu. Neither needs a broken file or a dead shell to say
 * what it contains; producing the failure was the expensive half, and it is not the claim.
 *
 * The NEGATIVE case below is the one the E2E never made, and it is the one that matters most: these
 * rows must be absent from a healthy panel. Offering "Try again" to a terminal that is running is
 * noise, and a builder that always emitted them would satisfy every assertion the E2E made.
 */
describe('the failure rows appear only while there is a failure (FR-042c)', () => {
  const FAILURE_ROWS = ['Try again', 'Copy details', 'Clear panel type'];

  const headerLabels = (editorFailure: boolean): string[] =>
    flatten(
      panelHeaderMenu({
        panel: {
          id: 'p1',
          kind: 'editor',
          title: 'app.ts',
          titleIsCustom: false,
        } as unknown as Parameters<typeof panelHeaderMenu>[0]['panel'],
        panelVerb: 'Destroy',
        keybindings: DEFAULT_KEYBINDINGS,
        otherTabs: [],
        editor: { filePath: 'D:/project/src/app.ts', dirty: false } as unknown as Parameters<
          typeof panelHeaderMenu
        >[0]['editor'],
        editorFailure,
        detach: null,
        actions: new Proxy({}, { get: () => noop }) as Parameters<
          typeof panelHeaderMenu
        >[0]['actions'],
      }),
    )
      .map((i) => i.label)
      .filter((l): l is string => typeof l === 'string');

  const terminalLabels = (startFailure: boolean): string[] =>
    flatten(
      terminalContentMenu({
        link: null,
        selection: '',
        redrawChord: 'Ctrl+Shift+R',
        startFailure,
        actions: {
          openLink: noop,
          copyLinkAddress: noop,
          copySelection: noop,
          paste: noop,
          redraw: noop,
          tryAgain: noop,
          reloadTerminal: noop,
          copyDetails: noop,
          clearPanelType: noop,
        },
      }),
    )
      .map((i) => i.label)
      .filter((l): l is string => typeof l === 'string');

  it('the EDITOR panel menu offers all three while it is failing', () => {
    const labels = headerLabels(true);
    for (const row of FAILURE_ROWS) expect(labels).toContain(row);
  });

  it('the TERMINAL content menu offers all three while it is failing', () => {
    const labels = terminalLabels(true);
    for (const row of FAILURE_ROWS) expect(labels).toContain(row);
  });

  it('a HEALTHY editor panel offers none of them', () => {
    /*
     * The assertion the E2E never made. Every one of its checks was a presence check against a panel
     * it had deliberately broken first, so a builder that emitted these rows unconditionally would
     * have passed it — while offering "Try again" to a panel with nothing wrong.
     */
    const labels = headerLabels(false);
    expect(labels.length, 'a healthy menu must still have rows, or this proves nothing')
      .toBeGreaterThan(3);
    for (const row of FAILURE_ROWS) expect(labels).not.toContain(row);
  });

  it('a HEALTHY terminal offers none of them either', () => {
    const labels = terminalLabels(false);
    expect(labels.length).toBeGreaterThan(2);
    for (const row of FAILURE_ROWS) expect(labels).not.toContain(row);
  });

  it('both panel types name the commands IDENTICALLY (FR-042d)', () => {
    /*
     * The labels are the banner's, unchanged, and both menus must use the same words — otherwise
     * they are two commands that look alike rather than one command with two surfaces. The E2E
     * asserted the same three literals twice, which happens to test this and does not say so; here
     * it is the claim.
     */
    const editor = headerLabels(true).filter((l) => FAILURE_ROWS.includes(l)).sort();
    const terminal = terminalLabels(true).filter((l) => FAILURE_ROWS.includes(l)).sort();
    expect(editor).toEqual(terminal);
    expect(editor).toHaveLength(FAILURE_ROWS.length);
  });
});
