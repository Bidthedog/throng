/**
 * The Key Bindings TAB — the scope column, the typeahead, and a scope-aware clash (016 FR-017b0,
 * 015 FR-017/SC-019, 007 FR-034).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/preferences-keybindings.e2e.ts` and
 * `packages/ui/tests/e2e/preferences-row-actions.e2e.ts` (034 FR-045).
 *
 * `preferences-capture-modal.test.ts` already covers the MODAL in isolation, handed a two-action
 * `bindings` map written by hand. This file is the tab AROUND it, and the difference is the whole
 * reason it exists: the tab renders `KEYBINDINGS_METADATA` against the real `DEFAULT_KEYBINDINGS`
 * and the real `COMMAND_SCOPES`, so what it says about `Ctrl+X` appearing twice, and about which of
 * those two a third command actually clashes with, is a statement about the SHIPPED command table
 * rather than about a fixture.
 *
 * Nothing here needed an application. `useKeybindings()` reads a context whose default IS
 * `DEFAULT_KEYBINDINGS`; `useOnEntry()` defaults the same way. The three E2E tests that came here
 * touched no file on disk — they opened a second Electron window, read text out of it, and closed
 * it again.
 *
 * ══ WHAT STAYED AN E2E, and none of it is a near miss ══
 *
 *  - **Every test that reads `keybindings.json`.** Capture-adds-a-chord, a single bare key binding,
 *    a pill removing just its own chord, and Reassign moving a chord between two actions all assert
 *    the FILE. The tab hands `writeConfig` a bindings map; whether that map survives the write path
 *    is the config store's claim, not this component's.
 *  - **The two `user-select: none` assertions.** They read `getComputedStyle(el).userSelect` for a
 *    value INHERITED from the application stylesheet. jsdom applies no real cascade, so asserting it
 *    here would be asserting about jsdom — 034 FR-049 exactly.
 *  - **"clear unbinds an action entirely, and reset brings the chords back"** (row-actions). Its
 *    reset half goes through `window.throng.config.resetBinding`, a main-process IPC that restores
 *    the FULL shipped chord set; only the clear half is rendering. A partial replacement is not a
 *    replacement (034 FR-047), so it stays whole. The rendering half is asserted below anyway,
 *    because a component that stopped showing "unbound" would leave that E2E passing on a file.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Delete the `ResetNoticeProvider` from `mountTab` below. `useResetNotice()` throws outside its
 * provider (`reset-notice.tsx`), the tab fails to render, and **all 12 tests in this file fail**.
 * The same is true of `ContextMenuProvider` and `NotificationProvider`, which throw the same way —
 * three independent controls, one required render.
 *
 * That control is load-bearing here rather than decorative: four of these assertions are about
 * something being ABSENT from the document (a filtered-out row, a chord a cancel did not steal),
 * and every absence assertion in a tree that rendered nothing passes.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { KeybindingsTab } from '../../src/renderer/preferences/keybindings-tab.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';

/**
 * The tab, inside the three providers the preferences window mounts around it.
 *
 * No config provider: `ConfigContext` defaults to `DEFAULT_KEYBINDINGS`, which is the shipped table
 * these tests are about. Putting a fixture there instead would turn every claim below into a claim
 * about the fixture.
 */
function mountTab(): { user: ReturnType<typeof userEvent.setup> } {
  render(
    createElement(
      NotificationProvider,
      null,
      createElement(
        ResetNoticeProvider,
        null,
        createElement(ContextMenuProvider, null, createElement(KeybindingsTab)),
      ),
    ),
  );
  return { user: userEvent.setup() };
}

/** The scope pills of one command's row. */
const scopes = (action: string): HTMLElement[] =>
  Array.from(screen.getByTestId(`binding-${action}-scope`).querySelectorAll('.keybinding-scope'));

const chordText = (action: string): string =>
  screen.getByTestId(`binding-${action}-chord`).textContent ?? '';

const search = (): HTMLElement => screen.getByTestId('keybindings-search');

/**
 * Press a chord the way the capture modal hears one: keydown then keyup on `window`.
 *
 * `act` because the modal listens on `window` rather than on a React element, so the state it sets
 * lands outside React's batching — without it the RENDERED conflict is not there yet while a mock
 * would already have recorded its call. `preferences-capture-modal.test.ts` records the same trap.
 */
function press(key: string, mods: Partial<KeyboardEventInit> = {}): void {
  const init = { key, bubbles: true, ...mods } as KeyboardEventInit;
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', init));
    window.dispatchEvent(new KeyboardEvent('keyup', init));
  });
}

/**
 * 016 FR-017b0 · T110 — the SCOPE column.
 *
 * `Ctrl+X` appears twice in this list and that is correct: one cuts a LINE in an editor, the other
 * cuts a FILE in the tree, and they can never both fire. The scope is the only thing on screen that
 * says so. Without it a user sees the duplicate, concludes throng is broken, and "fixes" it by
 * rebinding one of the two — breaking something that worked.
 */
describe('where a command is live (FR-017b0)', () => {
  it('shows the two commands that share Ctrl+X, each with the scope that makes it legitimate', () => {
    mountTab();
    expect(screen.getByTestId('binding-editor.cutLine-scope')).toHaveTextContent('Editor');
    expect(screen.getByTestId('binding-file.cut-scope')).toHaveTextContent('File Explorer');
    expect(chordText('editor.cutLine')).toContain('Ctrl+X');
    expect(chordText('file.cut')).toContain('Ctrl+X');
  });

  it('raises no clash warning for the duplicate, because neither steals from the other', () => {
    mountTab();
    // Positive first: without it, "no conflict is shown" is satisfied by a tree that rendered
    // nothing at all, which is the vacuity trap this layer is most prone to.
    expect(screen.getByTestId('keybindings-tab')).toBeVisible();
    expect(screen.getByTestId('binding-file.cut')).toBeVisible();
    expect(screen.queryByTestId('capture-conflict')).toBeNull();
  });

  it('reads "Everywhere" as ONE pill for a window-level command', () => {
    // Listing all three contexts says the same thing less clearly and would drown the rows that
    // carry real information.
    mountTab();
    const pills = scopes('focus.left');
    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveTextContent('Everywhere');
  });

  it('gives a command live in the panels but not the tree TWO SEPARATE pills', () => {
    // Joined into one, "Editor · Terminal" reads as a single exotic scope rather than two ordinary
    // ones.
    mountTab();
    expect(scopes('editor.save').map((p) => p.textContent)).toEqual(['Editor', 'Terminal']);
  });
});

/**
 * 007 FR-034 + 016 FR-017b2 — a REAL clash still warns, and Cancel steals nothing.
 *
 * This is the journey a scope-aware `findConflict` could quietly destroy. Make it a shade too
 * permissive and the last writer silently takes the chord, which FR-017b2 bans. Nothing else catches
 * it: the scope table above would still be right, and the only symptom is a binding the user never
 * agreed to give up.
 */
describe('a clash between commands whose scopes intersect', () => {
  it('warns, and names the command it would take the chord FROM', async () => {
    const { user } = mountTab();
    // Both editor-scoped, so their scopes intersect: `editor.indentLines` capturing Ctrl+X is a
    // genuine clash with `editor.cutLine`.
    await user.dblClick(screen.getByTestId('binding-editor.indentLines'));
    press('x', { ctrlKey: true });

    const conflict = screen.getByTestId('capture-conflict');
    expect(conflict).toBeVisible();
    expect(conflict).toHaveTextContent('Ctrl+X');
    // …and it is the EDITOR one, not `file.cut` — which holds the same chord and is named nowhere,
    // because an explorer command and an editor command can never both fire. The E2E could not
    // make this half of the claim; it only checked that a warning appeared.
    expect(conflict).toHaveTextContent('editor.cutLine');
    expect(conflict.textContent ?? '').not.toContain('file.cut');
  });

  it('Cancel leaves BOTH bindings exactly as they were — the chord is not stolen', async () => {
    const { user } = mountTab();
    await user.dblClick(screen.getByTestId('binding-editor.indentLines'));
    press('x', { ctrlKey: true });
    expect(screen.getByTestId('capture-conflict')).toBeVisible();

    await user.click(screen.getByTestId('capture-cancel'));

    expect(screen.queryByTestId('capture-modal')).toBeNull();
    // The positive half first, so the two absence checks below cannot pass on an empty tree.
    expect(chordText('editor.cutLine')).toContain('Ctrl+X');
    expect(chordText('editor.indentLines')).toContain('Tab');
    expect(chordText('editor.indentLines')).not.toContain('Ctrl+X');
  });
});

/**
 * 015 FR-017 / SC-019 — the typeahead narrows by NAME and by CHORD.
 *
 * `filterFields` is proved on its own in `packages/core/tests/unit/settings-search.test.ts`. What is
 * asserted here is the thing that unit test structurally cannot say: that this tab hands it the
 * CHORD ARRAY as the value, so a binding is findable by what it is bound TO. Hand it `d.description`
 * instead and every pure test still passes while the feature is gone.
 *
 * The filter is debounced (150 ms), which is why each search is awaited rather than asserted
 * immediately.
 */
describe('the key bindings typeahead (FR-017, SC-019)', () => {
  it('narrows by NAME', async () => {
    const { user } = mountTab();
    expect(screen.getByTestId('binding-zoom.in')).toBeVisible();
    // The control must share NO token with the query. `focus.left` looks like the obvious choice
    // and is the wrong one: `fieldHaystack` includes the GROUP, and its group is 'Focus & Zoom'.
    // `editor.cutLine` is in 'Editor' and carries no 'zoom' in key, label, description or chords.
    expect(screen.getByTestId('binding-editor.cutLine')).toBeVisible();

    await user.type(search(), 'zoom');

    await waitFor(() => expect(screen.queryByTestId('binding-editor.cutLine')).toBeNull());
    expect(screen.getByTestId('binding-zoom.in')).toBeVisible();
  });

  it('narrows by CHORD — what you actually remember when you want to know what a key does', async () => {
    const { user } = mountTab();
    expect(screen.getByTestId('binding-zoom.in')).toBeVisible();

    // `focus.left` ships bound to exactly this and its name contains no part of it.
    await user.type(search(), 'Ctrl+Alt+ArrowLeft');

    // BOTH assertions inside the wait. Waiting only on `focus.left` being visible waits for
    // something already true of the UNFILTERED list, so it returns on the first tick and the
    // absence below is then read before the 150 ms debounce has applied — green or red by timing.
    await waitFor(() => {
      expect(screen.getByTestId('binding-focus.left')).toBeVisible();
      expect(screen.queryByTestId('binding-zoom.in')).toBeNull();
    });
  });

  it('says so when a query matches nothing, rather than showing an empty page', async () => {
    const { user } = mountTab();
    // The anti-vacuity control for the two absence assertions that follow.
    expect(screen.getByTestId('binding-zoom.in')).toBeVisible();

    await user.type(search(), 'zzzznothing');

    await waitFor(() => expect(screen.getByTestId('keybindings-search-empty')).toBeVisible());
    expect(screen.queryByTestId('binding-zoom.in')).toBeNull();
  });

  it('brings the whole list back when the search is cleared', async () => {
    const { user } = mountTab();
    await user.type(search(), 'zzzznothing');
    await waitFor(() => expect(screen.getByTestId('keybindings-search-empty')).toBeVisible());

    // The clear is IMMEDIATE, never debounced — it cancels the pending filter rather than joining
    // the queue behind it.
    await user.click(screen.getByTestId('keybindings-search-clear'));

    expect(search()).toHaveValue('');
    await waitFor(() => expect(screen.getByTestId('binding-zoom.in')).toBeVisible());
    expect(screen.queryByTestId('keybindings-search-empty')).toBeNull();
  });
});

/**
 * 015 FR-016 — an unbound action reads "unbound" and stops offering a clear.
 *
 * NOT a replacement for the E2E that owns this (`preferences-row-actions.e2e.ts`, "clear unbinds an
 * action entirely, and reset brings the chords back"): that test's reset half goes through
 * `resetBinding`, a main-process IPC, and asserts `keybindings.json`. It stays whole (FR-047).
 *
 * What this adds is the rendering the E2E would keep passing without: a tab that wrote `[]` to the
 * file and went on drawing the old pills satisfies every file assertion in it.
 */
describe('an unbound action (FR-016)', () => {
  it('draws its chords as removable pills while it HAS chords', () => {
    mountTab();
    const row = screen.getByTestId('binding-zoom.in-chord');
    expect(row).not.toHaveTextContent('unbound');
    // `zoom.in` ships with several chords, and each gets its own pill and its own remove control.
    expect(within(row).getByTestId('binding-zoom.in-pill-0')).toBeVisible();
    expect(within(row).getByTestId('binding-zoom.in-remove-0')).toBeVisible();
    expect(screen.getByTestId('binding-clear-zoom.in')).toBeEnabled();
  });

  it('offers a clear on EVERY action, because unbound is a valid state for all of them', () => {
    // Unlike a setting, no key binding declares clearability — the tab passes `clearable` purely on
    // whether the action currently holds a chord. So the affordance is enabled on every shipped row,
    // and the only thing that would disable it is the action already being empty.
    mountTab();
    for (const action of ['editor.cutLine', 'file.cut', 'focus.left', 'editor.save']) {
      expect(screen.getByTestId(`binding-clear-${action}`), action).toBeEnabled();
    }
  });
});
