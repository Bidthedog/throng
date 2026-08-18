/**
 * The Files & Folders menu as DRAWN: where the horizontal rules land, that a rule is not an item,
 * and what the "Open In" flyout actually contains once it is open (US5/#158, FR-018a; 033 US5
 * FR-048/FR-050).
 *
 * PLACE AT: `packages/ui/tests/component/menu-section-rendering.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/context-menu-sections.e2e.ts` (its single test, and with it
 * the whole file and its `runApp` launch). 034 FR-045.
 *
 * ══ WHY IT COMES DOWN, AND WHY IT IS NOT ALREADY COVERED ══
 *
 * Three of that test's four claims are already proved at the BUILDER, and were before this file
 * existed — see the evidence table in `mig-menu-verbs.md`. What was NOT proved anywhere is the half
 * the E2E was reaching for with `.context-menu__separator`: that the derived boundary becomes a
 * RENDERED ROW. `menu-sections.test.ts` drives `withDividers`, a pure function returning
 * `{ separator: true }` objects; nothing asserted that `ContextMenu` turns one into an element, that
 * it lands at the same index among the drawn rows, or that it is excluded from `role="menuitem"`.
 * Delete the `isSeparator` branch in `context-menu.tsx` and every existing unit test stays green
 * while the menu draws a blank, unnavigable row. So this is a real replacement rather than a
 * restatement — it is the rendered half, at the layer that renders.
 *
 * IT LANDS STRONGER THAN THE E2E DID, in three places:
 *   - the E2E asked only that the FIRST separator was visible; this pins all four INDICES against
 *     the drawn rows, so a rule appearing in the wrong place is a failure rather than a pass
 *   - the E2E never asked what a separator IS; here it must carry `role="separator"` and must not be
 *     one of the `role="menuitem"` rows, which is what FR-051's "keyboard navigation skips it"
 *     actually rests on
 *   - the root menu is added: two rules, and NEITHER at the top nor the bottom (M5), which no E2E
 *     asserted at all
 *
 * ══ WHAT STAYS END-TO-END ══
 *
 *   - That a right-click on a real tree row builds THIS menu from the real explorer state. That call
 *     site is `file-tree.tsx`'s, and it stays proved by `context-menu-shortcuts.e2e.ts`, which
 *     right-clicks `a.txt` in a real project and reads the menu that comes back.
 *   - Anything about how a rule LOOKS — `theme.css`'s `.context-menu__separator` height, colour and
 *     margins. jsdom applies no stylesheet, so a rule that renders as an invisible zero-height line
 *     passes every assertion here (034 FR-049).
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * In `packages/ui/src/renderer/workspace/context-menu.tsx`, replace
 *   `const items: MenuItem[] = withDividers(actions);`
 * with
 *   `const items: MenuItem[] = [];`
 * The component then renders an empty `<ul>`. ALL SIX tests in this file fail. Nothing here is
 * satisfied by an unrendered menu — which is the failure mode four tests on this branch were caught
 * passing under.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDINGS, type FlavourOption } from '@throng/core';
import { ContextMenu, type MenuAction } from '../../src/renderer/workspace/context-menu.js';
import {
  buildContextMenuItems,
  type ContextMenuOps,
} from '../../src/renderer/explorer/context-menu-items.js';

const noop = (): void => undefined;

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
};

/** The catalogue `useFlavours()` hands over in a running app, so the Terminal parent is ENABLED. */
const FLAVOURS: readonly FlavourOption[] = [
  { value: 'cmd', label: 'Command Prompt', defaultShellArguments: '/K' },
  { value: 'pwsh', label: 'PowerShell', defaultShellArguments: '-NoLogo' },
];

/** A file row, with the editor "Open In" targets the real explorer supplies for a file (FR-011a). */
const explorerFile = (): MenuAction[] =>
  buildContextMenuItems({
    node: { relPath: 'a.txt', kind: 'file' },
    selectedRelPaths: ['a.txt'],
    clipboard: { mode: 'copy', relPaths: ['src/other.ts'] },
    ops: { ...ops, openInTerminal: noop },
    openIn: [
      { label: 'Last Active Editor', icon: 'add', section: 'navigate', onClick: noop },
      { label: 'New Editor', icon: 'add', section: 'navigate', onClick: noop },
    ],
    keybindings: DEFAULT_KEYBINDINGS,
    projectRoot: 'D:/project',
    undoState: { canUndo: true, canRedo: false },
    flavours: FLAVOURS,
  });

/** A folder row. Folders get NO editor targets — that absence is what claim (d) is about. */
const explorerFolder = (): MenuAction[] =>
  buildContextMenuItems({
    node: { relPath: 'src', kind: 'folder' },
    selectedRelPaths: [],
    clipboard: null,
    ops: { ...ops, openInTerminal: noop },
    keybindings: DEFAULT_KEYBINDINGS,
    projectRoot: 'D:/project',
    undoState: { canUndo: false, canRedo: false },
    flavours: FLAVOURS,
  });

/** The tree's empty space. No Destroy group and no Hide group, so two boundaries rather than four. */
const explorerRoot = (): MenuAction[] =>
  buildContextMenuItems({
    node: { relPath: '', kind: 'folder' },
    selectedRelPaths: [],
    clipboard: null,
    ops,
    keybindings: DEFAULT_KEYBINDINGS,
    projectRoot: 'D:/project',
  });

/**
 * Render the menu. `submenuDelayMs` is a whole minute, the choice
 * `context-menu-lifecycle.test.ts` explains: with the dwell at zero, merely moving the pointer onto
 * "Open In" opens its flyout, and the tests below would then pass without the click ever mattering.
 */
function open(items: MenuAction[]) {
  render(
    createElement(ContextMenu, { x: 10, y: 10, items, onClose: noop, submenuDelayMs: 60_000 }),
  );
  return userEvent.setup();
}

/** The root menu's own rows — direct children only, so an open flyout's rows never leak in. */
const rows = (testId = 'context-menu'): HTMLElement[] =>
  Array.from(screen.getByTestId(testId).children) as HTMLElement[];

const separatorIndices = (testId = 'context-menu'): number[] =>
  rows(testId)
    .map((el, i) => (el.classList.contains('context-menu__separator') ? i : -1))
    .filter((i) => i >= 0);

/** The labels of the drawn ACTION rows of one level, in order. */
const labels = (testId = 'context-menu'): string[] =>
  rows(testId)
    .filter((el) => el.classList.contains('context-menu__item'))
    .map((el) => el.querySelector('.context-menu__label')?.textContent ?? '');

describe('a section boundary is DRAWN as a rule, at the boundary and nowhere else (FR-018a/FR-050)', () => {
  it('a file row draws four rules, at rows 6, 9, 11 and 14', () => {
    /*
     * The same four indices `menu-sections.test.ts` pins on `withDividers` — asked here of the
     * ELEMENTS the component actually put in the list. That the two agree is the point: the pure
     * derivation and the rendering are separate code, and only one of them was ever tested.
     */
    open(explorerFile());

    expect(separatorIndices()).toEqual([6, 9, 11, 14]);
    // Every action reached the DOM: 18 file-row actions + 4 rules = 22 rows.
    expect(rows()).toHaveLength(explorerFile().length + 4);
  });

  it('a rule is not an item: role="separator", never role="menuitem", and no label', () => {
    /*
     * FR-051 — "keyboard navigation skips it" is not a claim about arrows here; it is a claim about
     * what the row IS. `MenuLevel` builds its navigable set from the rows that are not separators, so
     * a rule that arrived carrying role="menuitem" would be announced to a screen reader as a
     * choosable, unlabelled row. The E2E asked only that one was visible.
     */
    open(explorerFile());
    const rules = rows().filter((el) => el.classList.contains('context-menu__separator'));

    expect(rules).toHaveLength(4);
    for (const rule of rules) {
      expect(rule).toHaveAttribute('role', 'separator');
      expect(rule).toHaveAttribute('aria-hidden');
      expect(rule).toBeEmptyDOMElement();
    }
    // And the navigable rows are exactly the actions — no rule among them.
    expect(rows().filter((el) => el.getAttribute('role') === 'menuitem')).toHaveLength(
      explorerFile().length,
    );
  });

  it('the tree’s empty space draws two rules, and neither opens nor closes the menu (M5)', () => {
    /*
     * The root has no Destroy group and no Hide group. An EMPTY group must draw no rule at all —
     * which is the difference between two boundaries and four — and the list can therefore neither
     * begin nor end with one. Nothing at any layer asserted the rendered form of that.
     */
    open(explorerRoot());

    expect(separatorIndices()).toEqual([3, 6]);
    expect(rows()[0]).toHaveClass('context-menu__item');
    expect(rows().at(-1)).toHaveClass('context-menu__item');
  });
});

describe('"Open in OS Explorer" leads the "Open In" flyout, and is nowhere else (#158, FR-018a)', () => {
  it('a file: OS File Explorer is not a top-level row, and is the first row of the flyout', async () => {
    const user = open(explorerFile());

    // Not top level — the parent already says "Open In", so "Open in OS File Explorer" doubled it.
    expect(screen.queryByTestId('menu-item-OS File Explorer')).toBeNull();
    expect(screen.getByTestId('menu-item-Open In')).toBeVisible();

    await user.click(screen.getByTestId('menu-item-Open In'));

    // The whole flyout, in order. The E2E asserted only that the first row contained the OS reveal;
    // pinning all four means an editor target overtaking it is a failure rather than a pass.
    expect(labels('submenu-Open In')).toEqual([
      'OS File Explorer',
      'Last Active Editor',
      'New Editor',
      'Terminal',
    ]);
  });

  it('a folder: exactly the OS reveal and Terminal — no editor targets (033 FR-029, SC-011’s one exception)', async () => {
    const user = open(explorerFolder());

    await user.click(screen.getByTestId('menu-item-Open In'));

    expect(labels('submenu-Open In')).toEqual(['OS File Explorer', 'Terminal']);
    expect(rows('submenu-Open In')).toHaveLength(2);
  });

  it('the flyout draws no rule of its own — every row in it is Navigate', async () => {
    // The nested level derives its dividers for ITSELF (FR-048 "per level"), and a level whose rows
    // all share one section must come back with none. Asserted on the drawn flyout, not on the
    // function that feeds it.
    const user = open(explorerFile());

    await user.click(screen.getByTestId('menu-item-Open In'));

    expect(separatorIndices('submenu-Open In')).toEqual([]);
  });
});
