/**
 * A submenu parent that has nothing to offer is DRAWN AND DISABLED, never hidden
 * (033 US3 / AS-6 / FR-035; constitution Principle VI, "disabled when unavailable").
 *
 * MIGRATED FROM `packages/ui/tests/e2e/open-in-terminal.e2e.ts` (034 FR-045):
 * "AS-6 — with nothing launchable the Terminal parent is drawn and disabled, never hidden".
 *
 * ══ WHY IT COMES DOWN ══
 *
 * That test launched Electron against a seeded `THRONG_CONFIG_ROOT` in which every built-in shell was
 * disabled and no user flavour was defined, created a project, right-clicked a tree row, opened
 * "Open In", and then asserted three things — `aria-disabled="true"`, the `--disabled` class, and
 * that a click opened no flyout. All three are `ContextMenu` rendering a `MenuAction` whose
 * `disabled` is true. The seeded config root was only ever a way of ARRANGING for that flag to be
 * set; nothing about the assertion needed a shell, a daemon or a window.
 *
 * The DECISION half — that an empty catalogue produces `disabled: true` — is already asserted at the
 * builder, `packages/ui/tests/unit/explorer-terminal-menu.test.ts:113` ("A3/FR-035 — with an empty
 * catalogue the parent is DRAWN and DISABLED, never hidden", `expect(terminal(items).disabled).toBe(true)`
 * for both `undefined` and `[]`). What that unit CANNOT say is whether a disabled flag reaches the
 * screen as a disabled row, and that gap is exactly the shape 034 keeps rejecting claims over: the
 * lower test proves the DATA, the E2E proved the RENDER. So this file renders.
 *
 * It is also STRICTLY STRONGER than the E2E it replaces, in two ways:
 *   • it drives the REAL builder (`buildContextMenuItems`) rather than a hand-written fixture, so the
 *     rows under test are the shipped rows — the empty-catalogue case AND the populated one;
 *   • it asserts the ENABLED case alongside, which the E2E never did in the same session. Without it,
 *     "no flyout opened" is satisfied by a menu that can never open a flyout at all.
 *
 * WHAT STAYS END-TO-END in `open-in-terminal.e2e.ts`: that a chosen flavour puts a live shell in the
 * right directory with the keyboard already in it (AS-2), that the submenu's list IS the panel
 * type-picker's live list on this machine (AS-1), that a user-defined flavour written into
 * `settings.json` reaches the menu (AS-4), that the start directory survives a cold restart (B5), and
 * that three flyout levels stand open at once under a real mouse (AS-7). None of those is one
 * component's markup.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Make `build()` below return `[]` instead of `buildContextMenuItems(...)`. ALL FOUR tests in this
 * file must fail, at `getByTestId('menu-item-Open In')` — a menu that renders nothing would otherwise
 * satisfy every "…is not there" assertion here for free.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, type FlavourOption, type TargetNode } from '@throng/core';
import { ContextMenu, type MenuAction } from '../../src/renderer/workspace/context-menu.js';
import {
  buildContextMenuItems,
  type ContextMenuOps,
} from '../../src/renderer/explorer/context-menu-items.js';

const noop = (): void => undefined;

/** A machine that reported one shell. Only the LENGTH matters to the rule under test. */
const FLAVOURS: readonly FlavourOption[] = [
  { value: 'cmd', label: 'Command Prompt', defaultShellArguments: '/K' },
];

const NODE: TargetNode = { relPath: 'deep', kind: 'folder' };

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
    expandChildren: noop,
    collapseChildren: noop,
    ...over,
  };
}

/** The SHIPPED rows for a right-clicked folder, over the catalogue this machine reported. */
function build(flavours: readonly FlavourOption[] | undefined): MenuAction[] {
  return buildContextMenuItems({
    node: NODE,
    selectedRelPaths: [],
    clipboard: null,
    ops: ops(),
    openIn: undefined,
    keybindings: DEFAULT_KEYBINDINGS,
    projectRoot: 'D:/project',
    undoState: { canUndo: false, canRedo: false },
    flavours,
  });
}

/**
 * Render the menu and step into "Open In", which is where Terminal lives.
 *
 * `submenuDelayMs` is a minute on purpose — the same reasoning as `context-menu-lifecycle.test.ts`.
 * With the dwell at zero, merely moving the pointer over a parent opens its flyout, and "a click on
 * a DISABLED parent opened nothing" would be satisfied by a click that never mattered.
 */
async function openInLevel(flavours: readonly FlavourOption[] | undefined) {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(
    createElement(ContextMenu, {
      x: 10,
      y: 10,
      items: build(flavours),
      onClose,
      submenuDelayMs: 60_000,
    }),
  );
  await user.click(screen.getByTestId('menu-item-Open In'));
  expect(screen.getByTestId('submenu-Open In')).toBeVisible();
  return { user, onClose };
}

describe('AS-6 / FR-035 — nothing launchable: drawn, and unusable', () => {
  it('draws the Terminal parent rather than dropping it from the menu', async () => {
    // An item that vanishes teaches the user nothing about what the menu can do — which is the whole
    // of Principle VI and the reason "hidden" is not an acceptable rendering of "unavailable".
    await openInLevel([]);
    expect(screen.getByTestId('menu-item-Terminal')).toBeVisible();
  });

  it('marks it disabled to assistive technology AND to the theme', async () => {
    // Both, because they are two different readers of the same fact and each has been forgotten
    // independently: `aria-disabled` is what a screen reader announces, the class is what dims it.
    await openInLevel([]);
    const terminal = screen.getByTestId('menu-item-Terminal');
    expect(terminal).toHaveAttribute('aria-disabled', 'true');
    expect(terminal.className).toContain('context-menu__item--disabled');
  });

  it('opens no flyout when it is clicked, and does not close the menu either', async () => {
    /*
     * The E2E clicked with `{ force: true }` to get past Playwright's own actionability check. Here
     * the click is ordinary and the component's `if (item.disabled) return;` is what has to hold.
     *
     * `onClose` is asserted too, which the E2E did not: a disabled row that fell through to the leaf
     * branch would dismiss the menu without doing anything, which reads to the user as a control that
     * silently failed rather than as one that is unavailable.
     */
    const { user, onClose } = await openInLevel([]);
    await user.click(screen.getByTestId('menu-item-Terminal'));
    expect(screen.queryByTestId('submenu-Terminal')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('the control: with a catalogue, the same row is usable', () => {
  it('is enabled and opens its flyout onto the catalogue', async () => {
    /*
     * THE test that stops the three above from being vacuous.
     *
     * Every one of them is satisfied by a Terminal row that can never open a flyout under any
     * circumstances — a builder that stopped attaching the submenu entirely, say. This is the same
     * component, the same click, and the only difference is the catalogue.
     */
    const { user } = await openInLevel(FLAVOURS);
    const terminal = screen.getByTestId('menu-item-Terminal');
    expect(terminal).toHaveAttribute('aria-disabled', 'false');
    expect(terminal.className).not.toContain('context-menu__item--disabled');

    await user.click(terminal);
    const flyout = screen.getByTestId('submenu-Terminal');
    expect(flyout).toBeVisible();
    expect(
      Array.from(flyout.querySelectorAll('.context-menu__item .context-menu__label')).map((n) =>
        (n.textContent ?? '').trim(),
      ),
    ).toEqual(['Command Prompt']);
  });
});
