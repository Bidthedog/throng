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
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

/* ────────────────────────────────────────────────────────────────────────── *
 * The Notifications category, and the confirmation on silencing a severity
 * (030 FR-001/FR-008, migrated from notification-prefs.e2e.ts:304 and :654)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Both migrated tests launched Electron, opened a SECOND WINDOW and drove the Settings tab. What
 * they assert is the tab's own markup and one confirmation — neither needs an application.
 *
 * ══ WHAT :304 IS REALLY FOR, WHICH ITS TITLE UNDERSTATES ══
 *
 * Its own comment records the defect: the value assertion "was the whole of this test, and it
 * passed for months while the dropdown read Never / Timed / Dismiss". Every other test in that file
 * drives the STORED TOKEN (`selectOption('never')`), so nothing anywhere ever read the words on the
 * screen, and the generic Title-Case fallback was indistinguishable from the specified names.
 *
 * That makes the visible TEXT the assertion, and it is kept as such below.
 */

const SEVERITIES = ['error', 'warning', 'info', 'success'] as const;

/** The mode `<select>` for one severity. */
const modeFor = (severity: string): HTMLSelectElement =>
  screen.getByTestId(`control-notifications.${severity}.mode`) as HTMLSelectElement;

describe('the Notifications category (migrated from notification-prefs.e2e.ts:304)', () => {
  it('offers a mode and a duration for every severity — eight leaves, no more', () => {
    mount();

    expect(screen.getByTestId('settings-group-Notifications')).toBeVisible();
    for (const severity of SEVERITIES) {
      expect(modeFor(severity)).toBeVisible();
      // `timeoutMs`, and it renders TWO controls — a slider and a number field, which the E2E's
      // `durationMs` guess would have missed even had the name been right.
      expect(screen.getByTestId(`control-notifications.${severity}.timeoutMs`)).toBeVisible();
      expect(screen.getByTestId(`control-notifications.${severity}.timeoutMs-slider`)).toBeVisible();
    }
    // "No more" is the half the migrated test could not state: it looked up four names it already
    // knew. A fifth severity added without a duration, or a stray control in the group, is exactly
    // the drift a per-severity surface accumulates.
    const modes = screen.getAllByTestId(/^control-notifications\.[a-z]+\.mode$/);
    const durations = screen.getAllByTestId(/^control-notifications\.[a-z]+\.timeoutMs$/);
    expect(modes).toHaveLength(SEVERITIES.length);
    expect(durations).toHaveLength(SEVERITIES.length);
  });

  it('names each mode as FR-001 names it — the words, not the stored token', () => {
    /*
     * The assertion the migrated test was rewritten to add, and the reason is worth keeping: the
     * stored token is what every other test drives, so a dropdown reading "Never / Timed / Dismiss"
     * passed for months. A user does not read `never`.
     */
    mount();

    for (const severity of SEVERITIES) {
      const options = [...modeFor(severity).querySelectorAll('option')];
      expect(options.map((o) => o.value)).toEqual(['never', 'timed', 'dismiss']);
      expect(options.map((o) => o.textContent?.trim())).toEqual([
        'Never display',
        'Display for',
        'Dismiss only',
      ]);
    }
  });
});

describe('silencing a FAILURE severity is confirmed (FR-008, migrated from notification-prefs.e2e.ts:654)', () => {
  /** Choose a mode the way the tab's own `commit()` is reached — a change event on the select. */
  const choose = (severity: string, value: string): void => {
    fireEvent.change(modeFor(severity), { target: { value } });
  };

  it('asks before an ERROR is silenced, and names the consequence rather than the word', () => {
    mount();

    choose('error', 'never');

    /*
     * SYNCHRONOUS, and it has to be: this file runs on fake timers for its debounce, and
     * `findBy*` polls on a real interval that never advances — every await here hung to the 5s
     * test timeout. `commit()` calls `confirm()` in the change handler, so the dialog is in the
     * DOM by the time `fireEvent.change` returns, and asserting that directly is stronger than
     * waiting for it.
     */
    /*
     * The MESSAGE element, not the dialog — and without the word "never".
     *
     * The migrated assertion was `/report nothing|not be shown|never/i` against the whole dialog,
     * and its red step showed it proved nothing: the TITLE is "Never display error notices?", so
     * the alternation matched before the message was ever consulted. Replacing the entire message
     * with "Are you sure?" left it green — which is the exact thing the assertion exists to forbid.
     */
    const message = within(screen.getByTestId('confirm-dialog')).getByTestId('confirm-message');
    expect(message.textContent ?? '').toMatch(/report nothing/i);
    expect(message.textContent ?? '').toMatch(/diagnostic log/i);
  });

  it('leaves the setting alone when the dialog is declined — and writes NOTHING', async () => {
    /*
     * The select's VALUE proves nothing here, and its red step said so: this mount has no config
     * bridge, so the control reads the shipped document and could not change whatever `applyEdit`
     * did. Making the change apply on decline left all twelve green.
     *
     * The observable that does discriminate is the WRITE. `commit()` calls `applyEdit` only inside
     * the confirm promise's `.then((accepted) => accepted && …)`, so a decline must reach the bridge
     * not at all — and a write spy is the only thing in this mount that can tell.
     */
    const writes: string[] = [];
    Reflect.set(window, 'throng', {
      config: {
        // writePatch, NOT write. applyChange goes through writeConfigPatch (write-config.ts
        // :164), which reads window.throng.config.writePatch and returns an unavailable result if it
        // is absent - so a spy on write() observes nothing and the assertion is vacuous, which is
        // what its red step reported.
        writePatch: (_id: unknown, changes: unknown) => {
          writes.push(JSON.stringify(changes));
          return Promise.resolve({ ok: true });
        },
      },
    });
    mount();
    expect(modeFor('error').value).toBe('dismiss');

    choose('error', 'never');
    expect(screen.getByTestId('confirm-dialog')).toBeVisible();
    // Nothing yet: the question is asked BEFORE anything is written, which is what makes it a
    // question rather than a notification.
    expect(writes).toEqual([]);

    fireEvent.click(screen.getByTestId('confirm-cancel'));

    // No wait is needed and the migrated test explains why: `commit()` only calls `applyEdit` inside
    // the confirm promise's `.then((accepted) => accepted && …)`, so a decline never starts a write.
    // The dialog's removal is proof the decision landed. It settles on a microtask (the confirm
    // promise's `.then`), which `act` flushes — no timer is involved, so fake timers are no
    // obstacle here.
    await act(async () => {});
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    expect(writes, 'a declined confirmation wrote to the settings document').toEqual([]);
    expect(modeFor('error').value).toBe('dismiss');
    Reflect.deleteProperty(window, 'throng');
  });

  it('asks for a WARNING too — a partly-failed operation reporting nothing is the same bargain', () => {
    mount();

    choose('warning', 'never');

    expect(screen.getByTestId('confirm-dialog')).toBeVisible();
  });

  it('does NOT ask for INFO or SUCCESS — there is no failure to miss, so a prompt would nag', () => {
    /*
     * The discriminating half, and the one an "asks first" test cannot make on its own: a dialog on
     * every severity would satisfy all three assertions above. The migrated test checked `info`;
     * `success` is the same bargain and had no test at all.
     */
    mount();

    choose('info', 'never');
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();

    choose('success', 'never');
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });
});
