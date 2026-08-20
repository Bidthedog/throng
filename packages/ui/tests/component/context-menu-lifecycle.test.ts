/**
 * How a context menu OPENS, CLOSES and is REPLACED (018 FR-013a/FR-016/FR-017/FR-017a, 024 FR-018).
 *
 * PLACE AT: `packages/ui/tests/component/context-menu-lifecycle.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/context-menu.e2e.ts` (one menu app-wide; outside-click closes;
 * a sub-menu parent click is an idempotent open) and `packages/ui/tests/e2e/menus.e2e.ts` (the shared
 * menu is keyboard-navigable; opening any menu closes any other, and a menu closes on window blur).
 * 034 FR-045.
 *
 * `packages/ui/tests/component/menu-keyboard.test.ts` already renders this exact component for
 * sub-menu keyboard navigation, and this file follows its setup — a hand-built `MenuAction[]`, a
 * `submenuDelayMs` chosen to take the hover dwell out of the question, and focus asserted on the
 * ELEMENT rather than on its text (#244).
 *
 * ══ WHY THESE PARTICULAR E2E TESTS COME DOWN ══
 *
 * Each of them built a project, a second tab and sometimes a second panel — in order to obtain a
 * menu. Everything they then asserted is inside one component and one provider:
 *
 *   - The outside-click and blur closes are two `window` listeners in `context-menu.tsx`. The blur
 *     test is the plainest case of all: `menus.e2e.ts` closes the menu with
 *     `win.evaluate(() => window.dispatchEvent(new Event('blur')))` — a SYNTHETIC event, identical in
 *     jsdom, so Electron was contributing nothing but its start-up cost.
 *   - "Only one menu is open app-wide" is `ContextMenuProvider` holding ONE `menu` state. The other
 *     half of that claim — that nothing else in the renderer renders a `<ContextMenu>` — is a source
 *     guard, `packages/ui/tests/unit/single-menu-host.test.ts`, because no rendered DOM can say what
 *     is absent from every other module.
 *   - The cog menu's keyboard behaviour is roving focus inside `MenuLevel`, driven over the real
 *     `cogMenuItems()` so the row order and the identifiers are the shipped ones.
 *
 * ══ WHAT STAYS END-TO-END ══
 *
 *   - `menus.e2e.ts`'s edge flip (FR-016), which reads `boundingBox()` against a real viewport. The
 *     positioner is unit-proved in `clamp-to-viewport.test.ts`; that the DRAWN menu, at its real
 *     measured size, lands on screen is not — and this is precisely the over-claim the colour-picker
 *     migration nearly made.
 *   - `menus.e2e.ts`'s Key Bindings menu, which asserts a chord removal ON DISK.
 *   - `context-menu.e2e.ts`'s "Send to Tab moves the panel", which is workspace state.
 *   - That a right-click on a panel handle, a tab chip or a tree row calls `openMenu` at all. This
 *     file starts from a menu; those call sites are the app's.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenu, type MenuAction } from '../../src/renderer/workspace/context-menu.js';
import { ContextMenuProvider, useContextMenu } from '../../src/renderer/context-menu-provider.js';
import { cogMenuItems } from '../../src/renderer/title-bar/cog-menu-items.js';

/**
 * The outside-pointer listener is attached a MACROTASK after mount, and deliberately: the pointer
 * event that OPENS a menu is still travelling when the menu mounts, so a listener attached
 * synchronously would catch that very event and close the menu it had just opened. Every test about
 * an outside click therefore has to let that macrotask run first — otherwise it asserts on a menu
 * that is not yet listening, and passes for the wrong reason.
 */
const listenersAttached = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A leaf and a parent bearing a flyout — the shape 023 introduced and the migrated specs navigated. */
const items = (onSend = vi.fn()): MenuAction[] => [
  { label: 'Destroy Panel', section: 'destroy', onClick: vi.fn() },
  {
    label: 'Send to Tab',
    section: 'navigate',
    submenu: [{ label: 'Tab 2', section: 'navigate', onClick: onSend }],
  },
];

/**
 * Render a menu with something OUTSIDE it to click.
 *
 * `submenuDelayMs` is a whole minute on purpose. With the dwell at zero — `menu-keyboard.test.ts`'s
 * choice, correct there — merely moving the pointer onto a parent opens its flyout, and the
 * idempotent-CLICK test below would then pass without the click ever mattering. A dwell that cannot
 * elapse during the test leaves the click as the only thing that can open it.
 */
function open() {
  const onClose = vi.fn();
  render(
    createElement(
      'div',
      null,
      createElement('button', { 'data-testid': 'outside' }, 'somewhere else'),
      createElement(ContextMenu, { x: 10, y: 10, items: items(), onClose, submenuDelayMs: 60_000 }),
    ),
  );
  return { onClose, user: userEvent.setup() };
}

describe('a menu closes when the user leaves it (FR-017, FR-017a)', () => {
  it('closes on a pointer press OUTSIDE it', async () => {
    const { onClose, user } = open();
    await listenersAttached();

    await user.click(screen.getByTestId('outside'));

    expect(onClose).toHaveBeenCalled();
  });

  it('does NOT close on a press inside it', async () => {
    /*
     * The negative half, and it is not padding: the outside test alone is satisfied by a listener that
     * closes on EVERY pointer press, which would make a menu unusable — the first click on any item
     * would dismiss it before the item's own handler could matter. Pressing a parent is the sharpest
     * case, because a parent click deliberately does not close the menu at all.
     */
    const { onClose, user } = open();
    await listenersAttached();

    await user.click(screen.getByTestId('menu-item-Send to Tab'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes when the window loses focus', () => {
    /*
     * FR-017a. The single-menu invariant holds WITHIN a window — throng runs the main window, each
     * sub-workspace and the preferences window as separate renderer processes — so what "application
     * wide" was reaching for is delivered by this listener: the user never sees a menu hanging open in
     * a window they have clicked away from.
     *
     * Dispatched exactly as the migrated spec dispatched it, as a bare `Event('blur')` on `window`.
     */
    const { onClose } = open();

    fireEvent(window, new Event('blur'));

    expect(onClose).toHaveBeenCalled();
  });

  it('stops listening once it is gone, so a later click cannot close a menu that has closed', async () => {
    // The teardown half of the same listeners. A leaked `pointerdown` handler is invisible until a
    // second menu is opened and the FIRST menu's listener closes it — a bug that reads as "menus
    // sometimes do not open".
    const onClose = vi.fn();
    const { unmount } = render(
      createElement(ContextMenu, { x: 10, y: 10, items: items(), onClose, submenuDelayMs: 60_000 }),
    );
    await listenersAttached();
    unmount();

    fireEvent(window, new Event('blur'));
    fireEvent.pointerDown(document.body);

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('a sub-menu parent opens, and never toggles (#157 / FR-018)', () => {
  it('a second click on an open parent leaves the flyout open and its children reachable', async () => {
    // Regression for #157: a parent click used to TOGGLE, so clicking an already-open parent closed
    // its flyout and the children could not be reached by pointer at all. A parent click is an
    // idempotent OPEN.
    const { user } = open();

    await user.click(screen.getByTestId('menu-item-Send to Tab'));
    expect(screen.getByTestId('submenu-Send to Tab')).toBeVisible();

    await user.click(screen.getByTestId('menu-item-Send to Tab'));

    expect(screen.getByTestId('submenu-Send to Tab')).toBeVisible();
    expect(screen.getByTestId('menu-item-Tab 2')).toBeVisible();
  });
});

describe('the cog menu is the shared menu, and is keyboard-navigable (FR-013a)', () => {
  /*
   * Driven over the REAL `cogMenuItems()` rather than a fixture, because half of what the migrated
   * spec asserted is the row ORDER and the surviving identifiers (`cog-menu-settings` is how roughly
   * ten preferences suites reach the preferences window, FR-053). A fixture would have restated the
   * order rather than checked it.
   */
  const cog = (): MenuAction[] =>
    cogMenuItems({ openPreferences: vi.fn(), openLogs: vi.fn(), openAbout: vi.fn() });

  const openCog = () => {
    const onClose = vi.fn();
    render(
      createElement(ContextMenu, {
        x: 0,
        y: 0,
        items: cog(),
        onClose,
        testId: 'cog-menu',
        submenuDelayMs: 60_000,
      }),
    );
    return { onClose, user: userEvent.setup() };
  };

  const focused = (): string | null | undefined =>
    document.activeElement?.getAttribute('data-testid');

  it('opens with the MENU focused and no item chosen', () => {
    /*
     * It used to focus the first item, and "Settings" sat there highlighted whether or not the pointer
     * was anywhere near it — a menu that has answered a question the user has not asked. The list
     * still takes focus, so the first arrow key lands in the menu rather than scrolling the page
     * behind it.
     */
    openCog();
    expect(focused()).toBe('cog-menu');
    expect(document.querySelectorAll('.context-menu__item:focus')).toHaveLength(0);
  });

  it('arrows move through the rows, and End jumps to the last', async () => {
    const { user } = openCog();

    await user.keyboard('{ArrowDown}');
    expect(focused()).toBe('cog-menu-settings');
    await user.keyboard('{ArrowDown}');
    expect(focused()).toBe('cog-menu-keybindings');
    await user.keyboard('{ArrowUp}');
    expect(focused()).toBe('cog-menu-settings');

    await user.keyboard('{End}');
    // "About throng" is last (020 FR-003), after Settings / Key Bindings / Themes / Open Logs Folder.
    expect(focused()).toBe('cog-menu-about');
  });

  it('Enter fires the focused row and closes the menu', async () => {
    const openPreferences = vi.fn();
    const onClose = vi.fn();
    render(
      createElement(ContextMenu, {
        x: 0,
        y: 0,
        items: cogMenuItems({ openPreferences, openLogs: vi.fn(), openAbout: vi.fn() }),
        onClose,
        testId: 'cog-menu',
        submenuDelayMs: 60_000,
      }),
    );
    const user = userEvent.setup();

    await user.keyboard('{ArrowDown}{Enter}');

    expect(openPreferences).toHaveBeenCalledWith('settings');
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape closes it', async () => {
    const { onClose, user } = openCog();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('offers exactly Settings / Key Bindings / Themes / Open Logs Folder / About throng', () => {
    /*
     * MIGRATED FROM `packages/ui/tests/e2e/titlebar-chrome.e2e.ts:107` (035 FR-001).
     *
     * The E2E asserted the same five NAMES off the rendered menu, and its own comment says why it
     * asserted names rather than whole rows: *"keeps the test about WHICH COMMANDS the cog offers…
     * a decorative change should not redden this, but a command appearing or vanishing must."*
     *
     * Everything it needed was already here except this. The rows are built by the REAL
     * `cogMenuItems()` (see `cog()` above), rendered through the REAL `ContextMenu`, and the
     * dismissal half is the Escape test directly above. What no test asserted anywhere — unit
     * included — is the LABELS: `menu-sections.test.ts:562` pins the five `testId`s and
     * `:556` pins the sections, but nothing pinned the words the user actually reads.
     *
     * So a rename to "Preferences", or a sixth command appearing, was invisible to the whole suite
     * below E2E. Reading them off `role="menuitem"` is deliberate: that is what a screen reader and
     * a user both see, and it is the assertion the E2E was making.
     */
    openCog();
    const labels = screen
      .getAllByRole('menuitem')
      .map((el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '');

    expect(labels).toHaveLength(5);
    expect(labels[0]).toMatch(/Settings/);
    expect(labels[1]).toMatch(/Key Bindings/);
    expect(labels[2]).toMatch(/Themes/);
    expect(labels[3]).toMatch(/Open Logs Folder/);
    expect(labels[4]).toMatch(/About throng/);
  });
});

describe('a row draws what its builder gave it', () => {
  /*
   * The RENDER half of `context-menu-icons.e2e.ts` and of the shortcut assertions beside it. Which
   * tokens the builders name, and whether the shipped theme draws them, is data and lives in
   * `packages/ui/tests/unit/menu-icon-tokens.test.ts`; that this component puts the token in the
   * reserved cell, and the chord in brackets after the label, is markup and lives here. Neither test
   * is sufficient alone, which is exactly why the pair is written down.
   */
  const mixed: MenuAction[] = [
    { label: 'Cut', icon: 'cut', shortcut: 'Ctrl+X', section: 'content', onClick: vi.fn() },
    // 023's rule is an icon only where a token exists, so a row without one is legitimate — and its
    // cell must stay reserved (and empty) rather than collapsing the column.
    { label: 'Word Wrap', section: 'content', onClick: vi.fn() },
  ];

  const cell = (label: string): HTMLElement =>
    screen.getByTestId(`menu-item-${label}`).querySelector('.context-menu__icon') as HTMLElement;

  it('renders the icon token into the reserved cell, and leaves it empty when there is none', () => {
    render(
      createElement(ContextMenu, { x: 0, y: 0, items: mixed, onClose: vi.fn(), submenuDelayMs: 0 }),
    );

    expect(cell('Cut')).not.toBeEmptyDOMElement();
    expect(cell('Word Wrap')).toBeEmptyDOMElement();
    // The cell exists for BOTH, so the labels stay aligned down the column.
    expect(cell('Word Wrap')).not.toBeNull();
  });

  it('renders an advertised chord in brackets after the label, and nothing when unbound', () => {
    render(
      createElement(ContextMenu, { x: 0, y: 0, items: mixed, onClose: vi.fn(), submenuDelayMs: 0 }),
    );

    expect(screen.getByTestId('menu-shortcut-Cut')).toHaveTextContent('(Ctrl+X)');
    // An unbound item is byte-identical to before the feature: no brackets, no layout shift (FR-004).
    expect(screen.queryByTestId('menu-shortcut-Word Wrap')).toBeNull();
  });
});

describe('exactly one menu is open at a time (FR-017)', () => {
  /**
   * A host that can open two different menus, standing in for the panel handle and the tab chip the
   * migrated spec right-clicked. What matters is only that both go through `useContextMenu()`, which
   * every menu in the renderer does — see `single-menu-host.test.ts` for that half.
   */
  function Host() {
    const { openMenu, isOpen } = useContextMenu();
    return createElement(
      'div',
      null,
      createElement('span', { 'data-testid': 'is-open' }, String(isOpen)),
      createElement('button', {
        'data-testid': 'open-panel-menu',
        onClick: () => openMenu(5, 5, [{ label: 'Destroy Panel', section: 'destroy', onClick: vi.fn() }]),
      }),
      createElement('button', {
        'data-testid': 'open-tab-menu',
        onClick: () => openMenu(80, 5, [{ label: 'Destroy Tab', section: 'destroy', onClick: vi.fn() }]),
      }),
    );
  }

  const menus = (): NodeListOf<Element> =>
    document.querySelectorAll('[data-testid="context-menu"]');

  it('opening a second menu REPLACES the first rather than adding to it', async () => {
    /*
     * The provider holds ONE menu state, so this is structural — no leftover can make it two. The
     * migrated spec made the same point by right-clicking a panel and then a tab, and checking that
     * "Destroy Panel" had gone; the negative is the load-bearing assertion, because a menu that merely
     * rendered on top of the old one would satisfy the positive one.
     */
    render(createElement(ContextMenuProvider, null, createElement(Host)));
    const user = userEvent.setup();

    await user.click(screen.getByTestId('open-panel-menu'));
    await listenersAttached();
    expect(menus()).toHaveLength(1);
    expect(screen.getByTestId('menu-item-Destroy Panel')).toBeVisible();

    await user.click(screen.getByTestId('open-tab-menu'));

    expect(menus()).toHaveLength(1);
    expect(screen.getByTestId('menu-item-Destroy Tab')).toBeVisible();
    expect(screen.queryByTestId('menu-item-Destroy Panel')).toBeNull();
  });

  it('tells an opener whether a menu is already showing, so it can toggle its own', async () => {
    /*
     * `isOpen` exists because the provider closes on any window `pointerdown`, which fires BEFORE the
     * opener's own click — so an opener that just calls `openMenu` closes the menu and immediately
     * reopens it, and can never close its own. The cog lost exactly that when it moved onto the shared
     * menu, which is why the controller exposes this at all.
     */
    render(createElement(ContextMenuProvider, null, createElement(Host)));
    const user = userEvent.setup();
    expect(screen.getByTestId('is-open')).toHaveTextContent('false');

    await user.click(screen.getByTestId('open-panel-menu'));

    expect(screen.getByTestId('is-open')).toHaveTextContent('true');
  });
});
