/**
 * The explorer toolbar — which controls it draws, in what order, what their titles say, and what a
 * click asks for (004 FR-031/032; 033 / #219 FR-018, FR-018a–c, FR-074, V1–V5, AS-16/AS-17).
 *
 * PLACE AT: `packages/ui/tests/component/explorer-toolbar.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/quick-open-toolbar.e2e.ts:209` (whole) and the tooltip half of
 * `:122` (034 FR-045).
 *
 * `ExplorerToolbar` is props-only. It takes five optional handlers, a `Keybindings` object and a
 * boolean; the only thing in it that touches a context is `Icon`, which resolves through
 * ConfigContext's REAL defaults, so no provider appears below. Passing a `Keybindings` object is the
 * whole of what the E2E spent a preferences window, a chord capture, a pill removal and a config
 * hot-reload to arrange.
 *
 * ══ WHAT STAYS END-TO-END ══
 *
 *   - That the CHORD opens the modal, and that it opens nothing with no project (A5). That is
 *     `app.tsx`'s window-level capture listener and `NavigationChrome`'s registration, not this
 *     component.
 *   - The rebind round trip itself (`:287`): a real `keybindings.json` write, main's hot reload, and
 *     the new chord actually firing. What moves here is the narrower claim that the TITLE is computed
 *     from whatever bindings the component is holding — which is what makes the reload observable.
 *   - That an icon PACK's artwork is drawn. `Icon` has its own component test; the toolbar's claim is
 *     only that it draws through `Icon` at all.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, type Keybindings } from '@throng/core';
import { ExplorerToolbar } from '../../src/renderer/explorer/toolbar.js';
import { registerQuickOpen } from '../../src/renderer/navigate/navigation-store.js';
import {
  registerFindInFilesOpener,
  type FindInFilesRequest,
} from '../../src/renderer/find-in-files/open-find-in-files.js';

/** The shipped chord for `navigate.quickOpen`, taken from the defaults rather than retyped. */
const DEFAULT_CHORD = DEFAULT_KEYBINDINGS.bindings['navigate.quickOpen'][0];

/** 043 FR-029a — the same, for the control this feature adds beside it. */
const FIF_CHORD = DEFAULT_KEYBINDINGS.bindings['search.findInFiles'][0];

const bound = (chords: string[]): Keybindings => ({
  version: DEFAULT_KEYBINDINGS.version,
  bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'navigate.quickOpen': chords },
});

const boundFif = (chords: string[]): Keybindings => ({
  version: DEFAULT_KEYBINDINGS.version,
  bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'search.findInFiles': chords },
});

/**
 * `registerQuickOpen` writes to a MODULE-LEVEL slot in `navigation-store.js` — one per window realm,
 * and in a test file, one per file. Leaving an opener registered would let a later test's click be
 * answered by an earlier test's spy, so it is cleared after every test rather than only where it is
 * set.
 */
afterEach(() => {
  registerQuickOpen(null);
  registerFindInFilesOpener(null);
});

function mount(props: Partial<Parameters<typeof ExplorerToolbar>[0]> = {}) {
  const handlers = {
    onExpand: vi.fn(),
    onCollapseAll: vi.fn(),
    onNewFolder: vi.fn(),
    onDelete: vi.fn(),
  };
  render(
    createElement(ExplorerToolbar, {
      ...handlers,
      keybindings: DEFAULT_KEYBINDINGS,
      quickOpenEnabled: true,
      findInFilesEnabled: true,
      ...props,
    } as Parameters<typeof ExplorerToolbar>[0]),
  );
  return { ...handlers, user: userEvent.setup({ delay: null }) };
}

/** Every control, by accessible name, in the order it is drawn. */
const names = (): string[] =>
  Array.from(screen.getByTestId('explorer-toolbar').querySelectorAll('button')).map(
    (b) => b.getAttribute('aria-label') ?? '',
  );

const quickOpen = (): HTMLElement => screen.getByRole('button', { name: 'Quick Open' });

/**
 * By its ACCESSIBLE NAME, which is the bare action — the same split Quick Open makes, and for the
 * same reason (043 R21): the title carries a LIVE chord, so a name-based locator would break on the
 * very rebind the title exists to follow.
 */
const findInFiles = (): HTMLElement => screen.getByRole('button', { name: 'Find in Files' });

describe('the shape of the toolbar (V1, V5)', () => {
  it('draws Quick Open BESIDE Collapse all, and leaves the four shipped controls alone', () => {
    /*
     * The whole list rather than just the new button, because that is what makes V5 — "it is the only
     * new toolbar control" — checkable at all. A test that only found Quick Open would stay green if
     * the feature had also dropped Delete.
     */
    mount();
    expect(names()).toEqual([
      'Expand',
      'Collapse all',
      'Quick Open',
      'Find in Files',
      'New folder',
      'Delete',
    ]);
  });

  it('draws every control as an icon, with no text label of its own (V2)', () => {
    /*
     * "No label" is asserted as "no text OUTSIDE the icon", not as "no text at all", and the
     * distinction is the migrated spec's own: at the shipped defaults no icon pack is selected, so
     * `Icon` takes its GLYPH branch and renders the theme's character as text. An empty-textContent
     * assertion would therefore fail on all five controls and would be testing that a pack was
     * installed — which is not what V2 says.
     */
    mount();

    for (const button of Array.from(
      screen.getByTestId('explorer-toolbar').querySelectorAll('button'),
    )) {
      const icons = button.querySelectorAll('.icon');
      expect(icons).toHaveLength(1);
      expect((button.textContent ?? '').trim()).toBe((icons[0].textContent ?? '').trim());
    }
  });
});

describe('the Quick Open title names the LIVE chord (FR-018a, V3, AS-16)', () => {
  it('names the action and the command’s current chord', () => {
    mount();
    const title = quickOpen().getAttribute('title') ?? '';
    expect(title).toContain('Quick Open');
    expect(title).toContain(DEFAULT_CHORD);
  });

  it('follows a REBIND, because it is computed from the bindings it is given', () => {
    /*
     * AS-17's mechanism, one layer below the round trip. The E2E proves the rebound file reaches this
     * component; this proves that when it does, the title changes — and, critically, that the OLD
     * chord goes. A title built by appending would satisfy the first assertion and fail the second,
     * and the failure a user sees is a tooltip advertising a shortcut that no longer works.
     */
    mount({ keybindings: bound(['F8']) });

    const title = quickOpen().getAttribute('title') ?? '';
    expect(title).toContain('F8');
    expect(title).not.toContain(DEFAULT_CHORD);
  });

  it('names the action alone when the command is UNBOUND, with no empty brackets', () => {
    // A user may remove every chord. "Quick Open ()" is the shape that ships when the empty case is
    // an afterthought rather than a branch.
    mount({ keybindings: bound([]) });

    expect(quickOpen()).toHaveAttribute('title', 'Quick Open');
  });
});

describe('with no project open the control is drawn and disabled (FR-018c, FR-074, V4)', () => {
  it('is visible and disabled rather than hidden', () => {
    mount({ quickOpenEnabled: false });

    expect(quickOpen()).toBeVisible();
    expect(quickOpen()).toBeDisabled();
  });

  it('says WHY, and recites NO chord', () => {
    /*
     * Both halves, because either alone passes for the wrong reason: a title that merely omitted the
     * chord could be empty, and a title that merely explained itself could still trail "(Ctrl+Shift+T)".
     * FR-074 narrows FR-018a to "whenever the button can act" — a disabled control should answer
     * "why can I not use this?" rather than recite a shortcut that would do nothing.
     */
    mount({ quickOpenEnabled: false });

    const title = quickOpen().getAttribute('title') ?? '';
    expect(title).toContain('Quick Open');
    expect(title).toContain('no project is open');
    expect(title).not.toContain(DEFAULT_CHORD);
  });

  it('asks for nothing when it is clicked', async () => {
    const opener = vi.fn(() => true);
    registerQuickOpen(opener);
    const { user } = mount({ quickOpenEnabled: false });

    await user.click(quickOpen());

    expect(opener).not.toHaveBeenCalled();
  });
});

describe('clicking Quick Open goes through the ONE opener (FR-018, V3)', () => {
  it('asks the registered opener rather than opening a second modal of its own', async () => {
    /*
     * The migrated spec's "…and clicking it opens the same modal the chord opens" (`:209`). SAME is
     * the load-bearing word: the button and the chord both go through `requestQuickOpen`, so there is
     * one opener rather than two that must be kept in step. A toolbar that rendered its own picker
     * would satisfy an "a modal appeared" assertion and break FR-066's one-slot rule the moment the
     * chord was pressed as well.
     */
    const opener = vi.fn(() => true);
    registerQuickOpen(opener);
    const { user } = mount();

    await user.click(quickOpen());

    expect(opener).toHaveBeenCalledTimes(1);
  });

  it('is harmless when no chrome is mounted to answer', async () => {
    // `requestQuickOpen` returns false when nothing is registered — a sub-workspace mid-teardown, a
    // window that has not mounted its chrome yet. The click must not throw.
    const { user } = mount();
    await expect(user.click(quickOpen())).resolves.toBeUndefined();
  });
});

/*
 * ══ 043 T065 — the Find in Files control (FR-029a, FR-029e) ══
 *
 * It copies Quick Open's raw `<button>` deliberately, including the split between `title` and
 * `aria-label` (R21), so it is asserted the same way and the two live side by side. The Find in
 * Files PANEL type is absent from the New Panel dialog (FR-017), which makes this control and the
 * folder context-menu item the feature's only discoverable routes (FR-029c) — so "drawn and
 * disabled, never hidden" is not a nicety here, it is the whole of what the user can see with no
 * project open.
 */
describe('the Find in Files control sits beside Quick Open (FR-029a, FR-029c)', () => {
  it('names the action and the command’s current chord in its title', () => {
    mount();
    const title = findInFiles().getAttribute('title') ?? '';
    expect(title).toContain('Find in Files');
    expect(title).toContain(FIF_CHORD);
  });

  it('keeps the chord OUT of the accessible name', () => {
    /*
     * The same rule Quick Open's own comment records: a locator built on the accessible name would
     * break on a rebind. Both halves are asserted, because a name that merely omitted the chord
     * could also be empty.
     */
    mount({ keybindings: boundFif(['F9']) });

    expect(findInFiles()).toHaveAttribute('aria-label', 'Find in Files');
    expect(findInFiles().getAttribute('title')).toContain('F9');
    expect(findInFiles().getAttribute('title')).not.toContain(FIF_CHORD);
  });

  it('names the action alone when the command is UNBOUND, with no empty brackets', () => {
    mount({ keybindings: boundFif([]) });
    expect(findInFiles()).toHaveAttribute('title', 'Find in Files');
  });

  it('is drawn and DISABLED with no project, saying why and reciting no chord', () => {
    mount({ findInFilesEnabled: false });

    expect(findInFiles()).toBeVisible();
    expect(findInFiles()).toBeDisabled();
    const title = findInFiles().getAttribute('title') ?? '';
    expect(title).toContain('Find in Files');
    expect(title).toContain('no project is open');
    expect(title).not.toContain(FIF_CHORD);
  });

  it('asks for nothing when a disabled control is clicked', async () => {
    const opener = vi.fn((_request: FindInFilesRequest) => true);
    registerFindInFilesOpener(opener);
    const { user } = mount({ findInFilesEnabled: false });

    await user.click(findInFiles());

    expect(opener).not.toHaveBeenCalled();
  });

  it('goes through the ONE opener, on the TOOLBAR route (FR-031b)', async () => {
    /*
     * The route is part of the request rather than inferred, because it is what decides seeding:
     * FR-031b forbids this control from seeding the search input, and the chord requires it. A
     * request that did not name where it came from would leave that decision to whichever caller
     * remembered to make it.
     */
    const opener = vi.fn((_request: FindInFilesRequest) => true);
    registerFindInFilesOpener(opener);
    const { user } = mount();

    await user.click(findInFiles());

    expect(opener).toHaveBeenCalledTimes(1);
    expect(opener.mock.calls[0][0]).toMatchObject({ route: 'toolbar', replace: false });
  });

  it('asks for the WHOLE PROJECT, so a reused panel does not keep a folder scope (FR-029a)', async () => {
    /*
     * 043 round five — found while reading the entry routes, not reported.
     *
     * FR-029a says this control "starts a search over the whole project", and US3-12 says the panel
     * it opens is "scoped to the project root". The request used to carry NO scope at all, and
     * `openFindInFiles` reads an absent scope as "leave it alone" — which is right for the chord and
     * wrong here. So: right-click `src` → Find in Files, type a term, then press this control, and
     * the reused panel went on searching `src` with nothing on screen saying the toolbar had not done
     * what its requirement says.
     *
     * Asserted on the REQUEST, because that is where the defect lived: the opener behaves correctly
     * for the request it is given. `''` is the control's own spelling of the project root.
     */
    const opener = vi.fn((_request: FindInFilesRequest) => true);
    registerFindInFilesOpener(opener);
    const { user } = mount();

    await user.click(findInFiles());

    expect(opener.mock.calls[0][0]).toMatchObject({ scopeSubPath: '' });
  });

  it('is harmless when no chrome is mounted to answer', async () => {
    const { user } = mount();
    await expect(user.click(findInFiles())).resolves.toBeUndefined();
  });
});

describe('a tree action with no handler is an action with nothing to act on', () => {
  it('disables exactly the controls whose handler is absent', () => {
    /*
     * The props are optional because the pane renders this toolbar in BOTH of its states, not because
     * a caller may forget them. Asserting one omitted and one supplied in the same render is what
     * distinguishes "disabled when omitted" from "always disabled".
     */
    mount({ onExpand: undefined, onDelete: undefined });

    expect(screen.getByRole('button', { name: 'Expand' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Collapse all' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'New folder' })).toBeEnabled();
  });

  it('calls the handler it was given', async () => {
    const { user, onCollapseAll } = mount();

    await user.click(screen.getByRole('button', { name: 'Collapse all' }));

    expect(onCollapseAll).toHaveBeenCalledTimes(1);
  });
});


// MOVED DOWN (pass 2): the toolbar control's stylesheet guards (FR-079, FR-079a) read `explorer.css` as
// text and render nothing; they are `unit/explorer-toolbar-css.test.ts`.
