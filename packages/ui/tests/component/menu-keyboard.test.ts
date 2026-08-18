/**
 * US6 (#157, spec 024 FR-018b): full keyboard navigation of context sub-menus. Arrow into a sub-menu
 * (→ / Enter) focuses its first child; arrow back out (← / Escape) closes it and returns focus to the
 * parent; only at the root does Escape close the whole menu.
 *
 * MIGRATED FROM `packages/ui/tests/e2e/menu-keyboard.e2e.ts` (034 FR-045).
 *
 * Every assertion here is about roving focus INSIDE one component, so the Electron window the E2E
 * launched was proving nothing the DOM could not. The migration also removes a defect the E2E could
 * not have caught, because it was in the E2E itself: #244 records that the spec's focus guard
 * polled `document.activeElement?.textContent` for the row's name, and react-arborist keeps DOM
 * focus on the TREE CONTAINER — whose textContent concatenates every row. The predicate was true
 * from the first sample whether or not focus had moved, so a guard written to make the test
 * deterministic guarded nothing. At this layer focus is asserted on the element itself, so the same
 * mistake is not expressible.
 *
 * What did NOT come with it: the other three tests in that file assert things this layer genuinely
 * cannot see — Shift+F10 arriving from outside the menu, focus returning to the Files & Folders
 * tree, and a Ctrl+C that must produce a de-duplicated copy on disk. Those are tracked separately
 * (034 FR-047: every assertion of a deleted test is accounted for).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenu, type MenuAction } from '../../src/renderer/workspace/context-menu.js';

/**
 * The shape 023 introduced and the E2E navigated to: a leaf, then a parent bearing a sub-menu.
 * `Copy Path` keeps its real label because the test ids are derived from it, and a reader comparing
 * this file with the spec it replaced should see the same names.
 *
 * `section` is REQUIRED as of spec 033 (constitution v4.6.0, "One section vocabulary for every
 * menu"), and this test is how that landed on the branch: every one of these five tests failed with
 * "could not focus menu-item-Copy Path by arrows" after the rebase. The reason is worth keeping,
 * because it is not a compile error — `isSeparator` is `!('section' in item)`, so a section-less
 * action is not rejected, it is silently reclassified as a DIVIDER: excluded from keyboard
 * navigation, rendered as a horizontal rule, its `onClick` unreachable. Nothing throws; the row is
 * simply not there.
 *
 * Which is the component layer paying for itself on its first contact with someone else's refactor.
 * The E2E specs did not notice, because they drive menus built by the real builders, and the real
 * builders were updated with the type. A hand-built fixture is the only place the old shape
 * survived — so this file found the contract change, at the cost of one run rather than one
 * Electron launch.
 *
 * Sections per the vocabulary: Copy acts on content; Copy Path takes you somewhere (FR-047 names
 * it under `navigate` explicitly).
 */
const items = (onCopy = vi.fn()): MenuAction[] => [
  { label: 'Copy', section: 'content', onClick: onCopy },
  {
    label: 'Copy Path',
    section: 'navigate',
    submenu: [
      { label: 'Absolute', section: 'navigate', onClick: vi.fn() },
      { label: 'Relative', section: 'navigate', onClick: vi.fn() },
    ],
  },
];

/** Render the root menu at a fixed point. `submenuDelayMs: 0` removes the hover dwell from the test. */
function open(onClose = vi.fn()) {
  render(
    createElement(ContextMenu, { x: 10, y: 10, items: items(), onClose, submenuDelayMs: 0 }),
  );
  return { onClose, user: userEvent.setup() };
}

/** Arrow-Down until the focused element carries the given test id (bounded, like the spec it replaces). */
async function focusItemByArrows(user: ReturnType<typeof userEvent.setup>, testId: string): Promise<void> {
  for (let i = 0; i < 12; i++) {
    if (document.activeElement?.getAttribute('data-testid') === testId) return;
    await user.keyboard('{ArrowDown}');
  }
  throw new Error(`could not focus ${testId} by arrows`);
}

describe('context sub-menu keyboard navigation (FR-018b)', () => {
  it('ArrowRight opens the sub-menu and focuses its first child', async () => {
    const { user } = open();
    await focusItemByArrows(user, 'menu-item-Copy Path');

    await user.keyboard('{ArrowRight}');

    const submenu = screen.getByTestId('submenu-Copy Path');
    expect(submenu).toBeVisible();
    // Focus is INSIDE the sub-menu, on its first item — not merely "the sub-menu is open".
    expect(submenu.querySelectorAll('.context-menu__item:focus')).toHaveLength(1);
    expect(document.activeElement).toHaveAttribute('data-testid', 'menu-item-Absolute');
  });

  it('ArrowLeft closes the sub-menu and returns focus to the parent item', async () => {
    const { user } = open();
    await focusItemByArrows(user, 'menu-item-Copy Path');
    await user.keyboard('{ArrowRight}');

    await user.keyboard('{ArrowLeft}');

    expect(screen.queryByTestId('submenu-Copy Path')).toBeNull();
    expect(document.activeElement).toHaveAttribute('data-testid', 'menu-item-Copy Path');
  });

  it('Enter also opens the sub-menu onto its first child', async () => {
    const { user } = open();
    await focusItemByArrows(user, 'menu-item-Copy Path');

    await user.keyboard('{Enter}');

    expect(screen.getByTestId('submenu-Copy Path')).toBeVisible();
    /*
     * Assert the element, not its text. `toHaveTextContent('Absolute')` also passes when focus
     * falls to the enclosing <ul>, because a list's textContent concatenates every child — and
     * that is precisely the mistake #244 records in the E2E this file replaces. It was caught
     * here by deliberately disabling the autofocus and watching this test stay green.
     */
    expect(document.activeElement).toHaveAttribute('data-testid', 'menu-item-Absolute');
  });

  it('Escape inside a sub-menu steps back to the parent and leaves the root menu open', async () => {
    const { user, onClose } = open();
    await focusItemByArrows(user, 'menu-item-Copy Path');
    await user.keyboard('{Enter}');

    await user.keyboard('{Escape}');

    expect(screen.queryByTestId('submenu-Copy Path')).toBeNull();
    expect(screen.getByTestId('context-menu')).toBeVisible();
    expect(document.activeElement).toHaveAttribute('data-testid', 'menu-item-Copy Path');
    // The distinction the whole requirement rests on: stepping out of a level is not closing the menu.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape at the root closes the whole menu', async () => {
    const { user, onClose } = open();
    await focusItemByArrows(user, 'menu-item-Copy');

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });
});

describe('the same rule at THREE levels', () => {
  /*
   * `Open In → Terminal → <flavour>` is three levels deep, and `open-in-terminal.e2e.ts` asserted
   * that ArrowRight opens each level and focuses its FIRST child there, with real shell flavours.
   *
   * The recursion is the same `MenuLevel` at every depth, so in principle depth two proves depth
   * three. In principle is not a Red proof, and "the recursion is the same code" is exactly the
   * reasoning that would hide an `isRoot`-style special case at one level — this component already
   * has one of those (see its `isRoot` prop, which used to be INFERRED from the test id and broke
   * the moment a folded-in menu kept its own). So the depth is asserted rather than argued.
   */
  const nested: MenuAction[] = [
    {
      label: 'Open In',
      section: 'navigate',
      submenu: [
        {
          label: 'Terminal',
          section: 'navigate',
          submenu: [
            { label: 'PowerShell', section: 'navigate', onClick: vi.fn() },
            { label: 'cmd', section: 'navigate', onClick: vi.fn() },
          ],
        },
      ],
    },
  ];

  it('ArrowRight opens each level and lands on the first child of the third', async () => {
    const user = userEvent.setup();
    render(
      createElement(ContextMenu, {
        x: 10,
        y: 10,
        items: nested,
        onClose: vi.fn(),
        submenuDelayMs: 0,
      }),
    );

    await focusItemByArrows(user, 'menu-item-Open In');
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toHaveAttribute('data-testid', 'menu-item-Terminal');

    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('submenu-Terminal')).toBeVisible();
    expect(document.activeElement).toHaveAttribute('data-testid', 'menu-item-PowerShell');
  });

  it('Enter on a leaf in the deepest level fires its action and closes the menu', async () => {
    /*
     * The other half of `open-in-terminal`'s AS-8. That test traversed three levels by keyboard and
     * pressed Enter on a flavour, then asserted a real terminal appeared — two claims in one: that
     * the keyboard reaches the leaf and fires it, and that the handler launches a shell.
     *
     * The first is this. The second stays end-to-end in AS-2, which drives every detected flavour
     * against a real PTY, because no DOM can tell you a shell started.
     */
    const onLaunch = vi.fn();
    const onClose = vi.fn();
    const items: MenuAction[] = [
      {
        label: 'Open In',
        section: 'navigate',
        submenu: [
          {
            label: 'Terminal',
            section: 'navigate',
            submenu: [{ label: 'PowerShell', section: 'navigate', onClick: onLaunch }],
          },
        ],
      },
    ];
    const user = userEvent.setup();
    render(createElement(ContextMenu, { x: 10, y: 10, items, onClose, submenuDelayMs: 0 }));

    await focusItemByArrows(user, 'menu-item-Open In');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(document.activeElement).toHaveAttribute('data-testid', 'menu-item-PowerShell');

    await user.keyboard('{Enter}');
    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('ArrowLeft walks back out one level at a time', async () => {
    const user = userEvent.setup();
    render(
      createElement(ContextMenu, {
        x: 10,
        y: 10,
        items: nested,
        onClose: vi.fn(),
        submenuDelayMs: 0,
      }),
    );

    await focusItemByArrows(user, 'menu-item-Open In');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(document.activeElement).toHaveAttribute('data-testid', 'menu-item-PowerShell');

    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toHaveAttribute('data-testid', 'menu-item-Terminal');
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toHaveAttribute('data-testid', 'menu-item-Open In');
  });
});
