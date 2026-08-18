/**
 * The Themes TAB — its typeahead, its icon section, and what its token rows offer
 * (021 FR-021/SC-024, 015 FR-018/SC-020, 018 follow-up).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/preferences-row-actions.e2e.ts` and
 * `packages/ui/tests/e2e/preferences-fonts-and-sliders.e2e.ts` (034 FR-045).
 *
 * Those four tests opened a SECOND Electron window through the cog menu in order to type into a
 * search box and count what was left on screen. `ThemesTab` takes no props and reads three contexts
 * — the config store (whose defaults ARE the shipped settings and the shipped theme), the shared
 * confirmation, and the shared notification — so a render is the whole application state these
 * claims need.
 *
 * That is not the same as saying the E2E was worthless. It is saying the claims are about a
 * DOCUMENT, and the ones that are not have been left where they were:
 *
 * ══ WHAT STAYED AN E2E ══
 *
 *  - **"the Themes tab groups tokens by app area, General first and Icons last"**. It reads
 *    `boundingBox()` and compares two `y` coordinates. jsdom has no layout, so every box is zero —
 *    the constitution's v5.1.0 real-layout reserve, and 034 FR-049.
 *  - **"revert restores the value the window OPENED with"** and **"reset leaves a revert behind"**.
 *    Both turn on which BASELINE a row reads: the shipped record, or the snapshot taken when the
 *    preferences window mounted. Those baselines live in the config store and in the window's own
 *    lifecycle, and both tests assert `settings.json`.
 *  - **"a built-in theme row offers all three actions"**. Its themes half is asserted below, but the
 *    test also switches TABS and makes the same claim about a Settings row, and a partial
 *    replacement is not a replacement (034 FR-047).
 *  - **"a role WEIGHT is a slider"** and **"the preferences window inherits the BASE application
 *    font"** — both drag a real slider and read a real `getComputedStyle`, or a theme file.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Delete the `ConfirmProvider` from `mount` below. `useConfirm()` throws outside it
 * (`confirm-dialog.tsx:229`), `ThemesTab` cannot render, and **all 11 tests in this file fail**.
 * `NotificationProvider` is a second, independent control that fails the same 11.
 *
 * It is worth stating why that control is not a formality here. Six of these assertions say a row,
 * a section or a control is ABSENT after a search — and in a tree that rendered nothing, every one
 * of them passes. Four tests at this layer on this branch could not fail for exactly that reason.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemesTab } from '../../src/renderer/preferences/themes-tab.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';

afterEach(() => {
  // `window` is shared by every test in the file; a bridge left standing would let one test's write
  // path answer another's.
  Reflect.deleteProperty(window, 'throng');
});

/**
 * The tab inside the providers the preferences window mounts around it.
 *
 * No config provider and no bridge: `ConfigContext` defaults to `DEFAULT_APP_SETTINGS` and
 * `THRONG_THEME`, which is precisely the state a first-run preferences window opens in, and the
 * state all four migrated tests were in. `window.throng.config.listThemes` / `listFonts` are
 * optional-chained, so their absence leaves the theme dropdown empty and the token editor —
 * which is what these tests are about — fully rendered.
 */
function mount(): { user: ReturnType<typeof userEvent.setup> } {
  render(
    createElement(
      NotificationProvider,
      null,
      createElement(ConfirmProvider, null, createElement(ThemesTab)),
    ),
  );
  return { user: userEvent.setup() };
}

/**
 * The same tab wired to a LIVE write path — the real `ConfigProvider`, over a bridge whose `write`
 * succeeds.
 *
 * Needed by exactly one test, and the reason is the trap this layer keeps setting. `ThemesTab` is
 * CONTROLLED by the config store: a token edit is scheduled through `write-config.ts`, and the
 * editor only re-renders when the written document is adopted back (`config-store.tsx`, issue #50).
 * Rendered bare, clicking Clear would call `onCommit` and change nothing on screen — and a test
 * asserting "no pills remain" would pass without the clear ever working.
 *
 * So this mounts the production adoption path and stubs only the process boundary.
 */
function mountLive(): { user: ReturnType<typeof userEvent.setup>; written: string[] } {
  const written: string[] = [];
  Reflect.set(window, 'throng', {
    config: {
      // No `get` and no `onChange`: the provider then keeps its shipped defaults, which is the
      // starting state this test wants. `write` is the only member the edit path reaches.
      write: (_id: unknown, json: string) => {
        written.push(json);
        return Promise.resolve({ ok: true });
      },
    },
  });
  render(
    createElement(
      NotificationProvider,
      null,
      createElement(ConfigProvider, null, createElement(ConfirmProvider, null, createElement(ThemesTab))),
    ),
  );
  return { user: userEvent.setup(), written };
}

const search = (): HTMLElement => screen.getByTestId('themes-search');
const iconCells = (): HTMLElement[] =>
  Array.from(screen.getByTestId('icon-grid').querySelectorAll('.icon-cell'));

/**
 * 021 FR-021 / SC-024 — the Themes tab was the last of the three tabs to get a typeahead, and the
 * one that needed it most: several hundred token rows and no way to find anything in them.
 *
 * `filterFields` is proved on its own in `packages/core/tests/unit/settings-search.test.ts`. What is
 * asserted here is what that unit test structurally cannot say — that THIS tab is wired to it, over
 * its own registry, and that the empty and clear states exist at all.
 *
 * The filter is debounced by 150 ms, which is why every search below is awaited.
 */
describe('the Themes typeahead (FR-021, SC-024)', () => {
  it('narrows the token rows to the ones that match', async () => {
    const { user } = mount();
    // Both present first — the control that stops the absence assertion below being vacuous.
    expect(screen.getByTestId('theme-row-colours.terminalBg')).toBeVisible();
    expect(screen.getByTestId('theme-row-colours.editorBg')).toBeVisible();

    await user.type(search(), 'terminal');

    await waitFor(() => expect(screen.queryByTestId('theme-row-colours.editorBg')).toBeNull());
    expect(screen.getByTestId('theme-row-colours.terminalBg')).toBeVisible();
  });

  it('says so when nothing matches, rather than showing a blank tab', async () => {
    const { user } = mount();
    expect(screen.getByTestId('theme-row-colours.terminalBg')).toBeVisible();

    await user.type(search(), 'zzzznothing');

    await waitFor(() => expect(screen.getByTestId('themes-search-empty')).toBeVisible());
    expect(screen.queryByTestId('theme-row-colours.terminalBg')).toBeNull();
  });

  it('brings every row back when the search is cleared', async () => {
    const { user } = mount();
    await user.type(search(), 'zzzznothing');
    await waitFor(() => expect(screen.getByTestId('themes-search-empty')).toBeVisible());

    // The clear CANCELS the pending filter rather than queueing behind it, so it is immediate.
    await user.click(screen.getByTestId('themes-search-clear'));

    expect(search()).toHaveValue('');
    await waitFor(() => expect(screen.getByTestId('theme-row-colours.editorBg')).toBeVisible());
    expect(screen.queryByTestId('themes-search-empty')).toBeNull();
  });
});

/**
 * The icon section is PART of the theme, so it is part of the search.
 *
 * It used to sit outside the filtered groups and simply ignore the query: search for "terminal" and
 * you got two matching colour rows and, still, the entire icon grid underneath. A section that
 * ignores the filter is worse than one with no filter at all, because it looks like a result.
 */
describe('the icon section is not exempt from the search (FR-021)', () => {
  it('renders the whole grid when no search is active', () => {
    mount();
    expect(screen.getByTestId('settings-group-Icons')).toBeVisible();
    expect(iconCells().length).toBeGreaterThan(5);
  });

  it('DISAPPEARS entirely for a query that matches no icon and no colour', async () => {
    const { user } = mount();
    expect(screen.getByTestId('settings-group-Icons')).toBeVisible();

    await user.type(search(), 'zzzznothing');

    await waitFor(() => expect(screen.queryByTestId('settings-group-Icons')).toBeNull());
    expect(screen.getByTestId('themes-search-empty')).toBeVisible();
  });

  it('keeps the section but NARROWS the grid for a query that matches an icon token', async () => {
    const { user } = mount();
    const unfiltered = iconCells().length;

    await user.type(search(), 'destroy');

    await waitFor(() => expect(screen.queryByTestId('icon-cell-rename')).toBeNull());
    expect(screen.getByTestId('settings-group-Icons')).toBeVisible();
    expect(screen.getByTestId('icon-cell-destroy')).toBeVisible();

    /*
     * A REAL result, not the whole grid surviving the filter untouched — and deliberately not an
     * exact count. The search matches an icon's DESCRIPTION as well as its name, and `dismiss` is
     * described as clearing a message "without destroying anything", so it legitimately matches
     * "destroy" too. That is the search working. What the requirement says is that the grid
     * NARROWS, so that is what this asserts.
     */
    const shown = iconCells().length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(unfiltered);
  });
});

/**
 * 018 follow-up — EVERY typography role offers EVERY attribute.
 *
 * The editor used to expose only the fields a theme happened to PIN, plus an injected family. So a
 * role declared as `tab: { weight: 500 }` offered a weight and a family, and there was no way to
 * italicise a tab title however much you wanted to. The editor's completeness is meant to be a
 * property of the MODEL, not a shadow of one theme's choices.
 *
 * `theme-metadata.test.ts` can say the DESCRIPTORS exist. It cannot say a control was rendered for
 * each of them, and that gap is not theoretical: a descriptor whose `control` has no case in the
 * dispatch falls through to the default arm and renders as a text box — a valid descriptor, a valid
 * control, and nonsense on screen. Which is what a DOM can look at.
 */
describe('every typography role offers every attribute', () => {
  it('renders a control for each of the seven attributes of a non-editor role', () => {
    mount();
    for (const key of [
      'typography.tab.italic',
      'typography.tab.underline',
      'typography.tab.strikethrough',
      'typography.tab.case',
      'typography.tab.sizePx',
      'typography.tab.weight',
      'typography.tab.family',
    ]) {
      expect(screen.getByTestId(`control-${key}`), `${key} is not editable`).toBeVisible();
    }
  });

  it('has RETIRED the dialog role — the preferences window inherits the base application font', () => {
    mount();
    // Preceded by a positive on the same registry, so "absent" cannot mean "nothing rendered".
    expect(screen.getByTestId('control-typography.tab.family')).toBeVisible();
    expect(screen.queryByTestId('control-typography.dialog.family')).toBeNull();
  });

  it('sheds casing and decoration on the EDITOR role — source text is not prose', () => {
    mount();
    expect(screen.getByTestId('control-typography.editor.sizePx')).toBeVisible();
    for (const gone of ['case', 'italic', 'underline', 'strikethrough']) {
      expect(
        screen.queryByTestId(`control-typography.editor.${gone}`),
        `editor.${gone} must be gone`,
      ).toBeNull();
    }
  });
});

/**
 * 015 FR-016a / FR-018 / SC-020 — the font stack can be emptied outright, and put back.
 *
 * The value's validity when EMPTY is what makes it clearable, not the shape of its default: the
 * stack ships populated and is still clearable. And the affordance goes inert rather than
 * disappearing (FR-015), because the row's geometry must not change just because the user emptied
 * something.
 *
 * `preferences-font-pills.test.ts` covers the CONTROL — parsing a stack into ordered pills,
 * appending, re-serialising. This covers the row AROUND it: the tab's Clear, and the round trip that
 * makes the emptied value reach the control at all.
 */
describe('emptying and re-populating the font stack (FR-018, SC-020)', () => {
  it('empties the stack, keeps the add control, and goes inert rather than vanishing', async () => {
    const { user } = mountLive();
    // It ships POPULATED — the positive that makes "no pills remain" mean something.
    expect(screen.getByTestId('control-fonts.family-pill-0')).toBeVisible();
    const clear = screen.getByTestId('theme-clear-fonts.family');
    expect(clear).toBeEnabled();

    await user.click(clear);

    await waitFor(() =>
      expect(document.querySelectorAll('[data-testid^="control-fonts.family-pill-"]')).toHaveLength(0),
    );
    // An empty stack is a value, not a hole: the add control survives so a family can be put back…
    const input = screen.getByTestId('control-fonts.family');
    expect(input).toBeVisible();
    expect(input).toHaveAttribute('placeholder', 'Add a font family…');
    // …and clearing again would be a no-op, so the affordance is disabled — still on screen (FR-015).
    expect(screen.getByTestId('theme-clear-fonts.family')).toBeVisible();
    await waitFor(() => expect(screen.getByTestId('theme-clear-fonts.family')).toBeDisabled());
  });

  it('puts a family back, and the clear becomes live again', async () => {
    const { user } = mountLive();
    await user.click(screen.getByTestId('theme-clear-fonts.family'));
    await waitFor(() =>
      expect(document.querySelectorAll('[data-testid^="control-fonts.family-pill-"]')).toHaveLength(0),
    );

    // Free text, committed with Enter — the typeahead offers no list here (no bridge, so no system
    // fonts), and a family the user names must bind whether or not this machine has it installed.
    await user.type(screen.getByTestId('control-fonts.family'), 'Consolas{Enter}');

    expect(screen.getByTestId('control-fonts.family-pill-0')).toHaveTextContent('Consolas');
    await waitFor(() => expect(screen.getByTestId('theme-clear-fonts.family')).toBeEnabled());
  });
});
