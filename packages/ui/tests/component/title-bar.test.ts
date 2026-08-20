/**
 * The application-drawn title bar — identity, accent dot, the cog, and which window controls each
 * kind of window gets (007 FR-001/002/003/004/006/007; 020 FR-003; US9/FR-034).
 *
 * PLACE AT: `packages/ui/tests/component/title-bar.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/subworkspace-titlebar.e2e.ts:9` (034 FR-045).
 *
 * ══ NOTHING RENDERED THIS COMPONENT BELOW E2E BEFORE ══
 *
 * `TitleBar` has four call sites — the main window, a sub-workspace, Preferences and About — and each
 * one differs ONLY in the props it passes: `showCog`, `closeOnly`, `showMinimise`, `colour`. So four
 * separate windows had to be launched to observe four boolean branches of one component, and three of
 * those windows are child windows that take focus, which is what makes their specs serial.
 *
 * It takes props and nothing else. `Icon` inside `WindowControls` resolves through ConfigContext's
 * real defaults, so the only provider below is `ContextMenuProvider`, and only in the one test that
 * asks for a cog — `CogMenu` calls `useContextMenu`, which throws outside it.
 *
 * ══ WHAT STAYS END-TO-END ══
 *
 *   - The bar sitting at the very top with no OS chrome above it (`boundingBox().y <= 1`). That is a
 *     measured box against a real frameless window and is exactly the real-layout reserve the
 *     constitution keeps at E2E (034 FR-049).
 *   - That a sub-workspace window passes `showCog={false}` and the name it passes as `identity`.
 *     Those are `subworkspace-app.tsx`'s, and the identity string comes from the window's own state.
 *   - That the window controls actually minimise, maximise and close a real window. What is asserted
 *     here is only that the button relays to the bridge.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TitleBar } from '../../src/renderer/title-bar/title-bar.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';

/**
 * The preload bridge the window controls relay to.
 *
 * All five members are supplied because the ambient type requires them, and `isMaximized` in
 * particular is CALLED on mount — a partial stub would surface as a rejected promise inside an effect
 * rather than as a failed assertion.
 */
function stubWindowBridge() {
  const bridge = {
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(() => Promise.resolve(false)),
    onMaximizeChange: vi.fn(() => () => {}),
  };
  window.throng = { window: bridge };
  return bridge;
}

afterEach(() => {
  // `window` is shared across every test in the file; a bridge left behind would let one test's spy
  // answer another's click.
  delete window.throng;
});

const bar = (): HTMLElement => screen.getByTestId('title-bar');

describe('the window identity (FR-001, FR-006)', () => {
  it('shows the identity text it is given, beside the brand mark', () => {
    render(createElement(TitleBar, { identity: 'throng — Demo · Editor' }));

    expect(screen.getByTestId('title-bar-identity')).toHaveTextContent('throng — Demo · Editor');
    // The mark is chrome, not an icon-pack token — a user's pack must not be able to replace the
    // application's own identity — so it is asserted by its own test id rather than as an `.icon`.
    expect(screen.getByTestId('throng-mark')).toBeInTheDocument();
  });

  it('draws the accent dot only when a colour is given', () => {
    /*
     * Both halves in one claim, because the dot is the active project's colour and a dot with NO
     * colour behind it is a smear of whatever the last theme token happened to be. Preferences and
     * About pass no colour at all.
     */
    const { unmount } = render(createElement(TitleBar, { identity: 'throng', colour: '#ff8800' }));
    const dot = bar().querySelector('.title-bar__dot');
    expect(dot).not.toBeNull();
    expect(dot as HTMLElement).toHaveStyle({ background: '#ff8800' });

    unmount();
    render(createElement(TitleBar, { identity: 'throng' }));
    expect(bar().querySelector('.title-bar__dot')).toBeNull();
  });
});

describe('the cog is main-window only (FR-005, FR-007)', () => {
  it('draws NO cog by default — which is the state every child window is in', () => {
    /*
     * The migrated spec's `toHaveCount(0)` on `title-bar-cog`, asserted against the DEFAULT rather
     * than against an explicit `showCog={false}`: a default that flipped would reach the sub-workspace,
     * Preferences and About windows all at once, and each of those specs is a separate app launch.
     */
    render(createElement(TitleBar, { identity: 'Sub-workspace 1' }));

    expect(screen.queryByTestId('title-bar-cog')).toBeNull();
  });

  it('draws it when asked, so the absence above is a decision and not a broken import', () => {
    /*
     * Without this half, deleting `<CogMenu />` entirely would leave the negative test green — the
     * classic vacuous pass, and the one worth spending a provider on. `CogMenu` calls
     * `useContextMenu`, so the provider is what makes it renderable at all.
     */
    render(
      createElement(ContextMenuProvider, {
        children: createElement(TitleBar, { identity: 'throng', showCog: true }),
      }),
    );

    expect(screen.getByTestId('title-bar-cog')).toBeVisible();
  });
});

describe('which window controls each window gets (FR-002, FR-003, FR-034)', () => {
  it('gives a normal window minimise, maximise and close', () => {
    stubWindowBridge();
    render(createElement(TitleBar, { identity: 'throng' }));

    expect(screen.getByTestId('window-min')).toBeVisible();
    expect(screen.getByTestId('window-max')).toBeVisible();
    expect(screen.getByTestId('window-close')).toBeVisible();
  });

  it('drops minimise alone for a non-minimisable window (Preferences, US9/FR-034)', () => {
    // Maximise is still offered — the requirement removes one affordance, not the pair, and a test
    // that only checked minimise's absence would not notice if both had gone.
    stubWindowBridge();
    render(createElement(TitleBar, { identity: 'Preferences', showMinimise: false }));

    expect(screen.queryByTestId('window-min')).toBeNull();
    expect(screen.getByTestId('window-max')).toBeVisible();
    expect(screen.getByTestId('window-close')).toBeVisible();
  });

  it('leaves a fixed-size dialog with close alone (About, 020 FR-003)', () => {
    // Offering minimise and maximise on a window that can do neither is dead chrome.
    stubWindowBridge();
    render(createElement(TitleBar, { identity: 'About — throng', closeOnly: true }));

    expect(screen.queryByTestId('window-min')).toBeNull();
    expect(screen.queryByTestId('window-max')).toBeNull();
    expect(screen.getByTestId('window-close')).toBeVisible();
  });

  it('relays each control to the preload bridge', async () => {
    // The buttons are drawn in the renderer because the windows are frameless; the OS action they
    // stand for happens in main. This asserts the relay, not the OS.
    const bridge = stubWindowBridge();
    render(createElement(TitleBar, { identity: 'throng' }));
    const user = userEvent.setup();

    await user.click(screen.getByTestId('window-min'));
    await user.click(screen.getByTestId('window-max'));
    await user.click(screen.getByTestId('window-close'));

    expect(bridge.minimize).toHaveBeenCalledTimes(1);
    expect(bridge.maximize).toHaveBeenCalledTimes(1);
    expect(bridge.close).toHaveBeenCalledTimes(1);
  });
});

describe('the drag zone toggles maximise on double-click (FR-004)', () => {
  it('maximises a normal window', async () => {
    const bridge = stubWindowBridge();
    render(createElement(TitleBar, { identity: 'throng' }));
    const user = userEvent.setup();

    await user.dblClick(bar().querySelector('.title-bar__drag-zone') as HTMLElement);

    expect(bridge.maximize).toHaveBeenCalledTimes(1);
  });

  it('is INERT on a fixed-size dialog, which has nothing to maximise', async () => {
    // 020 FR-003. A double-click that resized the About window would leave it in a state its own
    // layout was never written for, and there is no control to put it back.
    const bridge = stubWindowBridge();
    render(createElement(TitleBar, { identity: 'About — throng', closeOnly: true }));
    const user = userEvent.setup();

    await user.dblClick(bar().querySelector('.title-bar__drag-zone') as HTMLElement);

    expect(bridge.maximize).not.toHaveBeenCalled();
  });
});

/**
 * Every control is drawn from the theme's icon pack (018 FR-014b, SC-002).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/menus.e2e.ts:93` (035 T055) — `test('the cog gear comes from
 * the theme's icon pack — no inline vector')`.
 *
 * ══ THE NEGATIVE WAS ALREADY PROVEN, REPO-WIDE ══
 *
 * SC-002's ban on inline artwork is `packages/ui/tests/unit/no-inline-artwork.test.ts:60` — "no
 * component draws an inline `<svg>`, except the brand mark" — which sweeps every component rather
 * than the four this test happened to name. It is one of the guards `guards-are-live.test.ts` exists
 * to keep un-skipped.
 *
 * So the E2E's remaining half is the POSITIVE, and it is the one that can fail quietly: a control
 * that stopped drawing anything at all satisfies "no inline vector" perfectly. That is why the
 * migrated test counts `.icon` elements rather than asserting their absence.
 *
 * ══ WHY THIS IS THE RIGHT FILE ══
 *
 * `Icon` resolves its glyph through `ConfigContext`, whose default is the shipped theme — the fact
 * this file's own header already records. So the pack really is consulted here; nothing is stubbed
 * into place to make the icons appear.
 *
 * The fifth control the E2E checked, the Projects pane's "new project" button, is not this
 * component's. It is asserted in `projects-panel-form.test.ts` alongside the panel it belongs to.
 */
describe('the chrome draws icons, not characters (FR-014b, SC-002)', () => {
  const iconsIn = (testId: string): number =>
    screen.getByTestId(testId).querySelectorAll('.icon').length;

  it('gives each window control exactly one icon', () => {
    /*
     * Exactly one, not at-least-one. Two would mean a glyph rendered twice — which is what a control
     * that keeps its old literal AND gains an Icon looks like, and it is the shape of a half-finished
     * migration rather than an invented failure.
     */
    stubWindowBridge();
    render(createElement(TitleBar, { identity: 'throng' }));

    expect(iconsIn('window-min')).toBe(1);
    expect(iconsIn('window-max')).toBe(1);
    expect(iconsIn('window-close')).toBe(1);
  });

  it('draws the cog gear from the pack too', () => {
    // The gear used to come from a hard-coded path, because the theme had no settings glyph to
    // resolve. 018 added the token; the same one serves the project-settings options icon.
    stubWindowBridge();
    render(
      createElement(ContextMenuProvider, {
        children: createElement(TitleBar, { identity: 'throng', showCog: true }),
      }),
    );

    const glyph = screen.getByTestId('cog-glyph');
    expect(glyph.querySelectorAll('.icon')).toHaveLength(1);
  });
});
