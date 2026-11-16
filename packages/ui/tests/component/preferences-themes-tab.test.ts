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
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemesTab } from '../../src/renderer/preferences/themes-tab.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { DEFAULT_APP_SETTINGS, THRONG_THEME } from '@throng/core';

beforeEach(() => {
  // 056 FR-016 folds sections by default; these cases drive rows, so open the sections (research R10).
  window.history.replaceState(null, '', '/?foldDefault=open');
});

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
  return { user: userEvent.setup({ delay: null }) };
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
  return { user: userEvent.setup({ delay: null }), written };
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
 *
 * The icon section is PART of the theme, so it is part of the search. It used to sit outside the
 * filtered groups and simply ignore the query: search for "terminal" and you got two matching colour
 * rows and, still, the entire icon grid underneath. A section that ignores the filter is worse than
 * one with no filter at all, because it looks like a result.
 */
describe('the Themes typeahead, icon section included (FR-021, SC-024)', () => {
  it('narrows the token rows, says so when nothing matches, drops or narrows the icon section, and restores everything when cleared', async () => {
    // Chained from six tests on six mounts (audit, component-2a); each step ends clearing the box.
    const { user } = mount();
    // Both present first — the control that stops the absence assertions below being vacuous.
    expect(screen.getByTestId('theme-row-colours.terminalBg')).toBeVisible();
    expect(screen.getByTestId('theme-row-colours.editorBg')).toBeVisible();
    // The icon section renders the whole grid when no search is active.
    expect(screen.getByTestId('settings-group-Icons')).toBeVisible();
    const unfiltered = iconCells().length;
    expect(unfiltered).toBeGreaterThan(5);

    // Narrows the token rows to the ones that match.
    await user.type(search(), 'terminal');
    await waitFor(() => expect(screen.queryByTestId('theme-row-colours.editorBg')).toBeNull());
    expect(screen.getByTestId('theme-row-colours.terminalBg')).toBeVisible();
    await user.click(screen.getByTestId('themes-search-clear'));
    await waitFor(() => expect(screen.getByTestId('theme-row-colours.editorBg')).toBeVisible());

    // Says so when nothing matches, rather than showing a blank tab — and the icon section
    // DISAPPEARS entirely for a query that matches no icon and no colour.
    await user.type(search(), 'zzzznothing');
    await waitFor(() => expect(screen.getByTestId('themes-search-empty')).toBeVisible());
    expect(screen.queryByTestId('theme-row-colours.terminalBg')).toBeNull();
    expect(screen.queryByTestId('settings-group-Icons')).toBeNull();

    // Brings every row back when the search is cleared. The clear CANCELS the pending filter rather
    // than queueing behind it, so it is immediate.
    await user.click(screen.getByTestId('themes-search-clear'));
    expect(search()).toHaveValue('');
    await waitFor(() => expect(screen.getByTestId('theme-row-colours.editorBg')).toBeVisible());
    expect(screen.queryByTestId('themes-search-empty')).toBeNull();
    expect(screen.getByTestId('settings-group-Icons')).toBeVisible();

    // Keeps the icon section but NARROWS the grid for a query that matches an icon token.
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
  it('renders all seven attributes of a non-editor role, has RETIRED the dialog role, and sheds casing and decoration on the EDITOR role', () => {
    // Merged from three read-only tests on one mount (audit, component-2a).
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

    // The dialog role is retired — the preferences window inherits the base application font. The
    // positive on the same registry (`typography.tab.family`, above) makes "absent" mean something.
    expect(screen.queryByTestId('control-typography.dialog.family')).toBeNull();

    // Source text is not prose.
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

/* ────────────────────────────────────────────────────────────────────────── *
 * Restore All, per-theme restore, and Delete — the WIRING
 * (010 FR-001/002/003/005/005a, migrated in part from
 *  preferences-themes.e2e.ts:226, :322 and :362)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * ══ THE SPLIT, AND WHY IT IS A SPLIT RATHER THAN A MOVE ══
 *
 * Those three E2Es launched Electron, opened a second window, and then asserted almost entirely
 * about FILES ON DISK: an edited built-in reverted, a deleted one recreated, a custom one byte-
 * identical, a theme file gone.
 *
 * Every one of those file claims is already made, against a real filesystem, one layer down:
 * `integration/restore-theme.test.ts` (six cases, including an unwritable target and idempotency
 * across repeated calls) and `integration/restore-default-themes.test.ts` (three, including "does
 * not overwrite an existing, possibly user-edited default"). Those are better tests of the same
 * thing — they can make the file unwritable, which a UI driving the same call cannot.
 *
 * What NOTHING covered is the half between: this tab reaching those services at all, and the
 * confirmation standing between the user and a destructive one. That is what is here.
 *
 * ══ WHAT REMAINS END-TO-END, AND IT IS NOT NOTHING ══
 *
 * The three specs keep their live-CSS halves — an edit reaching the running window's custom
 * properties is a real browser applying a real stylesheet. This asserts the CALL; they assert the
 * consequence.
 */

/**
 * A themes tab over a bridge that records every theme-service call, answers them all `ok`, and —
 * crucially — ADOPTS what it is written.
 *
 * ══ WHY THE ADOPTION IS NOT OPTIONAL ══
 *
 * The theme dropdown is CONTROLLED by the config store: it renders `settings.appearance.theme`, and
 * choosing a theme is not a selection but an ACTIVATION — `applyChange(['appearance','theme'], name)`
 * writes the settings document, and the select only moves once that document comes back.
 *
 * A fake that accepted the write and re-emitted nothing left the select on `throng` for every test,
 * silently: `user.selectOptions(sel, 'Debian')` appeared to work and the delete dialog then said
 * *Delete "throng"?*. That is the same trap `mountLive` above records for token edits, arriving
 * through the settings document instead of the theme one — so the fix is the same, and it is here
 * rather than in a wait: the round trip is production behaviour, not latency.
 */
function mountThemeStore(
  options: { themes?: string[]; restoreAllOk?: boolean; active?: string } = {},
) {
  const calls: Array<{ method: string; arg?: string }> = [];
  const themes = options.themes ?? ['throng', 'Matrix', 'Debian', 'MyCustom'];
  let listed = [...themes];
  // The state AFTER an activation, which is what the delete and restore controls act on. The
  // activation itself is `preferences-themes.e2e.ts:179`'s claim and stays there.
  let settings: unknown = {
    ...DEFAULT_APP_SETTINGS,
    appearance: { ...DEFAULT_APP_SETTINGS.appearance, theme: options.active ?? 'throng' },
  };
  let push: ((payload: unknown) => void) | null = null;
  const emit = (): void => push?.({ settings, theme: THRONG_THEME });

  Reflect.set(window, 'throng', {
    config: {
      get: () => Promise.resolve({ settings, theme: THRONG_THEME }),
      onChange: (cb: (payload: unknown) => void) => {
        push = cb;
        return () => {
          push = null;
        };
      },
      // The settings document is written whole, so adopting it is a parse and a re-emit — the same
      // two steps `config-store.tsx` takes when the real watcher reports the file changed.
      write: (id: unknown, json: string) => {
        if (id === 'settings') {
          try {
            settings = JSON.parse(json);
            emit();
          } catch {
            // A malformed write is the caller's bug, and swallowing it here would hide it.
            throw new Error('the tab wrote settings that are not JSON');
          }
        }
        return Promise.resolve({ ok: true });
      },
      listThemes: () => Promise.resolve([...listed]),
      restoreAllThemes: () => {
        calls.push({ method: 'restoreAllThemes' });
        // The restore recreates whatever was deleted, which is what makes the list refresh visible.
        listed = [...themes];
        return Promise.resolve({ ok: options.restoreAllOk !== false });
      },
      restoreTheme: (name: string) => {
        calls.push({ method: 'restoreTheme', arg: name });
        return Promise.resolve({ ok: true });
      },
      deleteTheme: (name: string) => {
        calls.push({ method: 'deleteTheme', arg: name });
        listed = listed.filter((t) => t !== name);
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
  return { user: userEvent.setup({ delay: null }), calls, listedNow: () => [...listed] };
}

const themeOptions = (): string[] =>
  [...screen.getByTestId('theme-select').querySelectorAll('option')].map(
    (o) => o.textContent?.trim() ?? '',
  );

describe('Restore All is confirmed before it destroys anything (FR-004)', () => {
  it('asks first, and calls nothing if the answer is no', async () => {
    const { user, calls } = mountThemeStore();
    await waitFor(() => expect(themeOptions()).toContain('Matrix'));

    await user.click(screen.getByTestId('theme-restore-all'));

    // The dialog is the requirement: Restore All overwrites every edit a user has made to a
    // built-in, and there is no undo for it.
    const dialog = await screen.findByTestId('theme-confirm-dialog');
    expect(dialog).toBeVisible();
    expect(calls).toEqual([]);

    await user.click(screen.getByTestId('theme-confirm-no'));

    await waitFor(() => expect(screen.queryByTestId('theme-confirm-dialog')).toBeNull());
    expect(calls).toEqual([]);
  });

  it('calls the restore-all service exactly once when confirmed', async () => {
    const { user, calls } = mountThemeStore();
    await waitFor(() => expect(themeOptions()).toContain('Matrix'));

    await user.click(screen.getByTestId('theme-restore-all'));
    await screen.findByTestId('theme-confirm-dialog');
    await user.click(screen.getByTestId('theme-confirm-yes'));

    await waitFor(() => expect(calls).toEqual([{ method: 'restoreAllThemes' }]));
  });

  it('says so, and names the reason, when the restore fails', async () => {
    /*
     * SC-007. `doRestoreAll` treats a MISSING bridge method's `undefined` as a failure rather than a
     * success, because reporting "restored" when nothing happened is an untruthful result. Nothing
     * asserted that at any layer — the E2Es only ever took the happy path.
     */
    const { user } = mountThemeStore({ restoreAllOk: false });
    await waitFor(() => expect(themeOptions()).toContain('Matrix'));

    await user.click(screen.getByTestId('theme-restore-all'));
    await screen.findByTestId('theme-confirm-dialog');
    await user.click(screen.getByTestId('theme-confirm-yes'));

    const strip = await screen.findByText(/Restore failed/i);
    expect(strip).toBeVisible();
    // …and it says nothing was changed, which is the fact a user needs in order to decide what to do
    // next. A bare "failed" leaves them wondering whether half the themes moved.
    expect(strip.textContent).toMatch(/No theme was changed/i);
  });
});

describe('a built-in name stays reserved when its theme is gone from disk (FR-007)', () => {
  /*
   * Migrated from preferences-themes.e2e.ts "US3: a DELETED built-in name is still reserved". The tab
   * must hand the dialog `reservedThemeNames()`, not the themes it listed from disk. The listing here
   * has no Debian, so the reserved set alone has to refuse it.
   * Mutation: `reserved` = the listed themes only (themes-tab.tsx:185) turns this red.
   */
  it('refuses a built-in name the listing no longer contains', async () => {
    const { user } = mountThemeStore({ themes: ['throng', 'MyCustom'] });
    await waitFor(() => expect(themeOptions()).toContain('MyCustom'));
    expect(themeOptions(), 'Debian is absent from the listing').not.toContain('Debian');

    await user.click(screen.getByTestId('theme-clone'));
    const input = await screen.findByTestId('theme-name-input');
    await user.clear(input);
    await user.type(input, 'Debian');

    expect(screen.getByTestId('theme-name-error'), 'refused as reserved').toBeVisible();
    expect(screen.getByTestId('theme-name-confirm')).toBeDisabled();
  });
});

describe('deleting a theme (FR-005a, migrated in part from preferences-themes.e2e.ts:226)', () => {
  it('asks first, names the theme, and deletes nothing when refused', async () => {
    const { user, calls } = mountThemeStore({ active: 'Debian' });
    await waitFor(() => expect(themeOptions()).toContain('Debian'));

    await user.click(screen.getByTestId('theme-delete'));

    const dialog = await screen.findByTestId('theme-delete-confirm');
    expect(dialog).toHaveTextContent('Debian');
    // A BUILT-IN says how to get it back; that sentence is the whole difference between a delete a
    // user can undo and one they cannot, and it is chosen by `reserved.includes(name)`.
    expect(dialog).toHaveTextContent(/Restore all themes to default/i);

    await user.click(screen.getByTestId('theme-confirm-no'));
    await waitFor(() => expect(screen.queryByTestId('theme-delete-confirm')).toBeNull());
    expect(calls).toEqual([]);
  });

  it('warns a CUSTOM theme cannot be restored afterwards — a different sentence, not the same one', async () => {
    // The two branches of one ternary, and the reason the wording matters: a custom theme has no
    // shipped default, so "Restore all" would not bring it back and saying so would be a lie.
    const { user } = mountThemeStore({ active: 'MyCustom' });
    await waitFor(() => expect(themeOptions()).toContain('MyCustom'));

    await user.click(screen.getByTestId('theme-delete'));

    const dialog = await screen.findByTestId('theme-delete-confirm');
    expect(dialog).toHaveTextContent(/cannot be restored afterwards/i);
    expect(dialog.textContent).not.toMatch(/Restore all themes to default/i);
  });

  it('removes it from the LIST when confirmed, and Restore All brings a built-in back', async () => {
    /*
     * FR-005a, and the pair the migrated tests spread across two specs: a deleted built-in leaves
     * the dropdown entirely — it does not grey out or stay selectable — and the ONLY way back is
     * Restore All.
     */
    const { user, calls } = mountThemeStore({ active: 'Debian' });
    await waitFor(() => expect(themeOptions()).toContain('Debian'));

    await user.click(screen.getByTestId('theme-delete'));
    await screen.findByTestId('theme-delete-confirm');
    await user.click(screen.getByTestId('theme-confirm-yes'));

    await waitFor(() => expect(themeOptions()).not.toContain('Debian'));
    expect(calls).toEqual([{ method: 'deleteTheme', arg: 'Debian' }]);
    // The others are untouched — a delete that refreshed the list by emptying it would also pass
    // the assertion above.
    expect(themeOptions()).toContain('Matrix');
    expect(themeOptions()).toContain('MyCustom');

    await user.click(screen.getByTestId('theme-restore-all'));
    await screen.findByTestId('theme-confirm-dialog');
    await user.click(screen.getByTestId('theme-confirm-yes'));

    await waitFor(() => expect(themeOptions()).toContain('Debian'));
  });
});

describe('every toolbar action is on screen, greyed out when it cannot be used (069 FR-049)', () => {
  const toolbar = (): string[] =>
    [...screen.getByTestId('themes-tab').querySelectorAll('.themes-toolbar__actions button')].map((b) => b.getAttribute('data-testid') ?? '');

  it('draws the same toolbar for a built-in and a custom theme, disabling what each cannot do', async () => {
    mountThemeStore({ active: 'Debian' });
    await waitFor(() => expect((screen.getByTestId('theme-select') as HTMLSelectElement).value).toBe('Debian'));
    const builtIn = toolbar();
    expect(screen.getByTestId('theme-revert')).toBeDisabled(); // nothing edited yet
    expect(screen.getByTestId('theme-revert')).toHaveAttribute('title', '“Debian” has not changed since this window opened');
    expect(screen.getByTestId('theme-restore')).not.toBeDisabled();
    expect(screen.getByTestId('theme-rename')).toBeDisabled();
    expect(screen.getByTestId('theme-rename')).toHaveAttribute('title', '“Debian” is built in and cannot be renamed');
    cleanup();

    mountThemeStore({ active: 'MyCustom' });
    await waitFor(() => expect((screen.getByTestId('theme-select') as HTMLSelectElement).value).toBe('MyCustom'));
    expect(toolbar()).toEqual(builtIn);
    expect(screen.getByTestId('theme-restore')).toBeDisabled();
    expect(screen.getByTestId('theme-rename')).not.toBeDisabled();
  });

  it('shows the search clear greyed out while the search is empty', async () => {
    const { user } = mountThemeStore();
    const clear = screen.getByTestId('themes-search-clear');
    expect(clear).toBeDisabled();
    await user.type(screen.getByTestId('themes-search'), 'bg');
    expect(screen.getByTestId('themes-search-clear')).not.toBeDisabled();
  });
});
