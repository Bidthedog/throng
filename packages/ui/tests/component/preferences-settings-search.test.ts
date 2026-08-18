/**
 * The settings typeahead — the box, the debounce, and the reset (007 FR-049).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/preferences-settings.e2e.ts` (034 FR-045/FR-046):
 *   - "the settings search is debounced and has a reset (X) button (FR-049)"
 *
 * That test launched Electron, opened a second window through the cog menu, and then asserted four
 * things about React state: the X appears only once there is something to clear, typing updates the
 * field before the filter has run, the filter applies once the debounce quiets, and the X restores
 * every row. It wrote nothing, read no file and made no claim about layout. All of it is
 * `SettingsTab` holding two pieces of state — `query` (instant) and `applied` (debounced) — which is
 * exactly what a DOM plus a clock can see.
 *
 * ══ WHERE IT LANDS STRONGER THAN THE E2E ══
 *
 *  - The E2E proved the debounce by racing it: it wrote the value through the native setter, read
 *    the DOM in the same task, and trusted that 150ms had not elapsed. That is a timing assumption
 *    dressed as an assertion, and on a loaded machine it is the kind that goes quiet rather than red.
 *    Here the clock is fake and advanced BY HAND, so "the filter has not run yet" is a fact about the
 *    timer rather than about how fast the machine was.
 *  - The E2E asserted the X clears the query. It could not distinguish clearing that takes effect at
 *    once from clearing that goes through the same 150ms debounce, because it polled. `clearSearch`
 *    calls `applySearch.cancel()` for precisely that reason, and the test below asserts the rows are
 *    back WITHOUT advancing the clock — which is the only way that call is load-bearing.
 *  - A pending keystroke is asserted to be cancelled rather than to land after the reset. Nothing at
 *    any layer asked before, and it is the failure the `cancel()` exists to prevent.
 *
 * ══ WHAT `filterFields` DECIDES IS NOT ASSERTED HERE ══
 *
 * Which settings a query matches — name, description, value, the OR of two words, a section name,
 * nested sub-groups — is a pure function over the registry with twenty-three cases against it in
 * `packages/core/tests/unit/settings-search.test.ts`. This file uses exactly one query, `theme`, and
 * only ever asks whether the FORM followed it.
 *
 * ══ WHAT STAYS END-TO-END ══
 *
 * `preferences-settings.e2e.ts` › "the settings search box is wired to the filter, and empties the
 * form when nothing matches" stays, and must: its first assertion compares the search box's bounding
 * box against the first group's, which is real layout and has no meaning in jsdom (034 FR-049,
 * constitution v5.1.0 Principle V).
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Delete the `ResetNoticeProvider` element from `mount()` below, leaving `NotificationProvider` and
 * `ConfirmProvider` in place. `useResetNotice` THROWS rather than defaulting
 * (`reset-notice.tsx`: "must be used inside a ResetNoticeProvider"), so `SettingsTab` cannot render
 * at all and **ALL 6 tests fail** inside `mount()`, before a single assertion runs.
 *
 * That control is the one that matters here because four of the six tests assert an ABSENCE — a
 * row that is gone, a group that is gone, an X that is not there yet. Each of those sits beside a
 * positive assertion in the SAME test (a surviving row, the empty-state paragraph, a restored row),
 * so a form that rendered nothing fails them rather than passing them.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';
import { SettingsTab } from '../../src/renderer/preferences/settings-tab.js';

/** The tab's own default, restated so the waits below are anchored to a number this file owns. */
const DEBOUNCE_MS = 150;

/**
 * The three providers `SettingsTab` reaches for, and nothing else.
 *
 * `useAppSettings` and `useOnEntry` both read a context with a real DEFAULT — the shipped settings
 * and the shipped key bindings — so no config provider is mounted and the form renders the shipped
 * document deterministically. `useResetNotice` and `useConfirm` throw without theirs; the notice one
 * needs `useNotify`, hence the outermost.
 */
function mount(): void {
  render(
    createElement(
      NotificationProvider,
      null,
      createElement(
        ResetNoticeProvider,
        null,
        createElement(
          ConfirmProvider,
          null,
          createElement(SettingsTab, { searchDebounceMs: DEBOUNCE_MS }),
        ),
      ),
    ),
  );
}

const box = (): HTMLInputElement => screen.getByTestId('settings-search') as HTMLInputElement;
const rowCount = (key: string): number => screen.queryAllByTestId(`setting-${key}`).length;
const groupCount = (group: string): number => screen.queryAllByTestId(`settings-group-${group}`).length;

/** Type into the box the way a keystroke does — instantly, and without touching the clock. */
function typeQuery(text: string): void {
  fireEvent.change(box(), { target: { value: text } });
}

/** Let the debounce fire. */
function settleDebounce(): void {
  act(() => {
    vi.advanceTimersByTime(DEBOUNCE_MS + 10);
  });
}

/**
 * A row that `theme` does NOT match, and one that it does.
 *
 * `behaviour.tabHoverActivateMs` and `appearance.theme` are the pair the E2E used; keeping them
 * keeps this test comparable to the one it replaces, and `settings-search.test.ts` owns the question
 * of WHY each matches.
 */
const UNMATCHED = 'behaviour.tabHoverActivateMs';
const MATCHED = 'appearance.theme';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the reset (X) button appears only when there is something to reset', () => {
  it('is absent on an empty query', () => {
    mount();
    // Paired with a positive: the box itself IS there, so this is an absence in a rendered form
    // rather than an absence in an empty document.
    expect(box()).toBeVisible();
    expect(screen.queryByTestId('settings-search-clear')).toBeNull();
  });
});

describe('typing is never blocked, but the filter waits (FR-049)', () => {
  it('updates the field at once while the form is still unfiltered', () => {
    /*
     * The claim the E2E could only approximate. The clock has not moved, so the debounced
     * `setApplied` provably has not run — not "probably has not run in the 3ms this took".
     */
    mount();
    expect(rowCount(UNMATCHED)).toBe(1);
    typeQuery('theme');
    expect(box().value).toBe('theme'); // typing is never laggy
    expect(rowCount(UNMATCHED), 'the filter ran before its debounce elapsed').toBe(1);
  });

  it('narrows the form once the debounce quiets, taking emptied groups with it', () => {
    mount();
    typeQuery('theme');
    settleDebounce();
    expect(rowCount(MATCHED)).toBe(1);
    expect(rowCount(UNMATCHED)).toBe(0);
    // A group with no surviving rows goes with them, rather than staying as an empty heading.
    expect(groupCount('Confirmations')).toBe(0);
  });

  it('shows an empty state, and no groups at all, when nothing matches', () => {
    mount();
    typeQuery('nosuchsettinganywhere');
    settleDebounce();
    expect(screen.getByTestId('settings-search-empty')).toBeVisible();
    expect(groupCount('Appearance')).toBe(0);
  });
});

describe('the reset restores every row AT ONCE (clearSearch cancels the pending filter)', () => {
  it('clears the query, brings the rows back without waiting, and hides itself', () => {
    /*
     * Three things in one press, and the middle one is why `clearSearch` calls `applySearch.cancel()`
     * before it sets state. The clock is deliberately NOT advanced after the click: a reset routed
     * through the debounce would leave the form still filtered here, and the E2E — which polled —
     * could not have told the difference.
     */
    mount();
    typeQuery('theme');
    settleDebounce();
    expect(rowCount(UNMATCHED)).toBe(0);

    const clear = screen.getByTestId('settings-search-clear');
    expect(clear).toBeVisible();
    fireEvent.click(clear);

    expect(box().value).toBe('');
    expect(rowCount(UNMATCHED), 'the reset was debounced rather than immediate').toBe(1);
    expect(rowCount(MATCHED)).toBe(1);
    expect(screen.queryByTestId('settings-search-clear')).toBeNull();
  });

  it('cancels a keystroke that was still in flight when it was pressed', () => {
    /*
     * The half `applySearch.cancel()` exists for. Without it the pending timer fires 150ms after the
     * user has already emptied the box, and the form silently re-filters itself to a query that is
     * no longer on screen.
     */
    mount();
    typeQuery('theme');
    // NOT settled — the timer is armed and has not fired.
    fireEvent.click(screen.getByTestId('settings-search-clear'));
    expect(box().value).toBe('');
    expect(rowCount(UNMATCHED)).toBe(1);

    settleDebounce();
    expect(box().value, 'the cleared box was refilled').toBe('');
    expect(rowCount(UNMATCHED), 'a cancelled keystroke landed after the reset').toBe(1);
  });
});
