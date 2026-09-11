/**
 * 043 T203 / FR-082b — the two dependent-control gates in the settings form reach the replace
 * summary notice's pair, not only `notifications.*`.
 *
 * ══ WHY THIS FILE EXISTS AT ALL, AND WHY THE SECOND GATE IS THE POINT ══
 *
 * `settings-tab.tsx` carries TWO rules keyed to a hardcoded `^notifications\.` pattern, and they are
 * not the same kind of rule:
 *
 *   1. `NOTICE_TIMEOUT_KEY` greys out a duration whose sibling mode is not `timed`. Ungeneralised,
 *      the new duration renders LIVE while nothing will read it — the exact lie the mechanism exists
 *      to prevent (030 FR-011).
 *   2. `SILENCEABLE_FAILURE_KEY` gates the consent 030 FR-008 requires before *Never display* may
 *      silence a FAILURE report. Ungeneralised, a user silences the replace summary — which reports
 *      files that could not be written, and why — with none of that consent.
 *
 * The second is a safety consequence rather than a cosmetic one, and it is the one a reading of the
 * change request would miss, because FR-082 only ever says "its own display mode". The mode it offers
 * includes `never`, and the notice it governs reports failures, so 030 FR-008 applies to it in full.
 *
 * ══ WHAT 030 FR-008 ACTUALLY REQUIRES ══
 *
 * Read rather than inferred, because "asks first" is not what it says. Verbatim: *"Choosing Never
 * display for `error` or `warning` MUST ask the user to confirm, stating that events of that severity
 * will thereafter reach only the diagnostic log. Declining MUST leave the mode as it was."* Three
 * obligations, and each is a separate test below:
 *
 *   - a confirmation is asked for;
 *   - it STATES THE CONSEQUENCE — the events reach only the diagnostic log. Not "are you sure?", and
 *     not a title that merely repeats the option's name;
 *   - declining changes nothing.
 *
 * The consequence assertion reads the MESSAGE element, never the whole dialog. That is the mistake
 * the equivalent notifications test records having made: its title is "Never display …?", so an
 * alternation containing "never" matched before the message was ever consulted, and replacing the
 * entire message with "Are you sure?" left it green.
 *
 * ══ WHY THE COMPONENT TIER ══
 *
 * Both claims are about a rendered form: an input's `disabled` attribute, and a dialog appearing in
 * the DOM in the same task as a change event. jsdom sees all of it, and the sibling this file is
 * modelled on (`preferences-settings-search.test.ts`) already migrated the `notifications.*` half of
 * exactly these assertions down from an E2E.
 *
 * ══ ANTI-VACUITY ══
 *
 * The inert test asserts the control is disabled under `dismiss` AND live under `timed`, from two
 * seeded documents — a form that disabled everything, or nothing, fails one of the two. The consent
 * tests sit beside a control that asks for NO confirmation (the duration's own value, and `info`),
 * so a form that raised a dialog on every commit fails too.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';
import { SettingsTab } from '../../src/renderer/preferences/settings-tab.js';

const DEBOUNCE_MS = 150;
const MODE_KEY = 'search.inFiles.summaryNoticeMode';
const TIMEOUT_KEY = 'search.inFiles.summaryNoticeTimeoutMs';

let settingsPayload: Record<string, unknown> = { version: 1 };
let writes: string[] = [];

beforeEach(() => {
  settingsPayload = { version: 1 };
  writes = [];
  Reflect.set(window, 'throng', {
    notices: { log: () => {} },
    config: {
      get: () => Promise.resolve({ settings: settingsPayload }),
      // writePatch, NOT write: `applyChange` goes through `writeConfigPatch`, so a spy on `write`
      // observes nothing at all and every assertion about what was written would be vacuous.
      writePatch: (_id: unknown, changes: unknown) => {
        writes.push(JSON.stringify(changes));
        return Promise.resolve({ ok: true });
      },
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

let loaded = false;

function LoadProbe(): ReactElement | null {
  loaded = useConfigLoaded();
  return null;
}

/**
 * Mount the tab over the REAL config store, seeded with `inFiles`.
 *
 * The sibling file mounts without a config provider and reads the shipped document, which is enough
 * for everything it asserts. Here it is not: the inert gate is a claim about a control's dependence
 * on a SIBLING VALUE, and proving it needs two different sibling values.
 */
async function mount(inFiles: Record<string, unknown>): Promise<void> {
  loaded = false;
  settingsPayload = { version: 1, search: { inFiles } };
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(
        NotificationProvider,
        null,
        createElement(
          ResetNoticeProvider,
          null,
          createElement(
            ConfirmProvider,
            null,
            createElement(LoadProbe, { key: 'probe' }),
            createElement(SettingsTab, { searchDebounceMs: DEBOUNCE_MS, key: 'tab' }),
          ),
        ),
      ),
    ),
  );
  await waitFor(() => {
    expect(loaded, 'the seeded settings never reached the config store').toBe(true);
  });
}

const modeControl = (): HTMLSelectElement =>
  screen.getByTestId(`control-${MODE_KEY}`) as HTMLSelectElement;
const durationField = (): HTMLInputElement =>
  screen.getByTestId(`control-${TIMEOUT_KEY}`) as HTMLInputElement;
const durationSlider = (): HTMLInputElement =>
  screen.getByTestId(`control-${TIMEOUT_KEY}-slider`) as HTMLInputElement;

const DISMISS_ONLY = { summaryNoticeMode: 'dismiss', summaryNoticeTimeoutMs: 5000 };
const TIMED = { summaryNoticeMode: 'timed', summaryNoticeTimeoutMs: 5000 };

describe('the replace summary duration is inert unless its own mode is Display for (FR-082b, 030 FR-011)', () => {
  it('greys out BOTH halves of the duration control under Dismiss only', async () => {
    await mount(DISMISS_ONLY);

    expect(
      durationField().disabled,
      'a duration nothing will read is live, which invites the user to tune a value the app ignores',
    ).toBe(true);
    // Both halves or neither: a disabled thumb beside a live text box is not an inert control.
    expect(durationSlider().disabled).toBe(true);
  });

  it('leaves both halves live under Display for', async () => {
    await mount(TIMED);

    expect(durationField().disabled).toBe(false);
    expect(durationSlider().disabled).toBe(false);
  });

  it('never greys out the MODE itself — that is the control the dependency reads', async () => {
    await mount(DISMISS_ONLY);

    expect(modeControl().disabled).toBe(false);
  });
});

describe('silencing the replace summary is confirmed (FR-082b, 030 FR-008)', () => {
  const choose = (value: string): void => {
    fireEvent.change(modeControl(), { target: { value } });
  };

  it('asks before Never display takes effect', async () => {
    await mount(DISMISS_ONLY);

    choose('never');

    /*
     * SYNCHRONOUS. `commit()` calls `confirm()` inside the change handler, so the dialog is in the
     * DOM by the time `fireEvent.change` returns, and asserting that directly is stronger than
     * waiting for it — a `findBy*` would pass just as well against a form that put the dialog up a
     * second later, after the write had already gone.
     */
    expect(
      screen.queryByTestId('confirm-dialog'),
      'Never display silenced a notice that reports failures with no consent at all (030 FR-008)',
    ).not.toBeNull();
  });

  it('states the consequence — that the outcome will reach only the log', async () => {
    await mount(DISMISS_ONLY);

    choose('never');

    // The MESSAGE, not the dialog: the title says "Never display …?", so any assertion run over the
    // whole dialog matches the option's own name and proves nothing about what the user was told.
    const message = within(screen.getByTestId('confirm-dialog')).getByTestId('confirm-message');
    expect(message.textContent ?? '').toMatch(/report nothing/i);
    expect(message.textContent ?? '').toMatch(/log/i);
  });

  it('writes NOTHING when the dialog is declined', async () => {
    await mount(DISMISS_ONLY);

    choose('never');
    const dialog = screen.getByTestId('confirm-dialog');
    fireEvent.click(within(dialog).getByTestId('confirm-cancel'));
    await act(async () => {
      await Promise.resolve();
    });

    /*
     * The WRITE is the observable, not the select's value: `commit()` reaches `applyEdit` only inside
     * the confirm promise's `then`, and the control is React-controlled from settings that have not
     * changed — so a decline that wrongly applied the change would still leave the select looking
     * right until the patch came back.
     */
    expect(writes, `a declined silencing still wrote: ${writes.join(' | ')}`).toEqual([]);
  });

  it('does NOT ask for Display for or Dismiss only — a prompt on every change is a prompt nobody reads', async () => {
    // The discriminating half. A form that confirmed every commit would satisfy all three tests
    // above and be a worse control than the one it replaced.
    await mount(DISMISS_ONLY);

    choose('timed');
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();

    choose('dismiss');
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('does NOT ask when the DURATION beside it changes', async () => {
    // The other half of the same discrimination, and the one that catches a gate keyed to the pair
    // rather than to the mode: a duration is not a silencing, whatever its value.
    await mount(TIMED);

    fireEvent.change(durationField(), { target: { value: '9000' } });
    fireEvent.blur(durationField());

    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });
});
