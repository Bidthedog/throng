/**
 * 039 FR-008a — "Run as administrator by default", in the Preferences window.
 *
 * The per-panel checkbox has been gated on the daemon's elevation since 005 FR-025a. The
 * PREFERENCE that seeds it shipped with no gate at all: on an unelevated throng it was tickable,
 * it stayed ticked, and it turned the New Panel dialog's admin control on behind a box the user
 * could not untick.
 *
 * ══ THE THREE CLAIMS, AND WHY THEY ARE THREE ══
 *
 * FR-008a binds at three places and they are different rules — seed, display, launch. This file
 * owns DISPLAY for the preference itself: inert, unticked, and saying why. The SEED is
 * `panel-type-descriptor.test.ts` (core, cheaper) and the New Panel dialog's own composition is
 * `terminal-admin-default-gate.test.ts`. LAUNCH was never broken and is `shouldDeElevate`'s.
 *
 * ══ WHY COMPONENT AND NOT E2E ══
 *
 * Every claim here is `SettingsTab` deciding what to render from one boolean the preload bridge
 * hands it. `preferences-settings-search.test.ts` established that this tab mounts under three
 * providers and reads the shipped settings from a defaulted context, which is the whole harness.
 * An Electron window would add a second process and answer nothing extra.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Delete the `ResetNoticeProvider` element from `mount()`. `useResetNotice` THROWS rather than
 * defaulting, so `SettingsTab` cannot render and every test here fails inside `mount()` before an
 * assertion runs. Each test below also asserts a PRESENCE (the control, or the reason paragraph)
 * beside anything it asserts about state, so a form that rendered nothing fails rather than passes.
 *
 * A SECOND control, because the first does not reach the stored value: delete `ConfigProvider` from
 * `mount()` and the third test fails, because the stored `true` never arrives. It is called out
 * separately because omitting that provider is what made the second test pass vacuously while this
 * file was being written — see `mount()`.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { SettingsTab } from '../../src/renderer/preferences/settings-tab.js';

const KEY = 'terminals.defaultRunAsAdmin';

/**
 * The bridge, with the daemon's elevation as the one variable.
 *
 * `config.get` is deliberately absent: `useAppSettings` falls back to the shipped document, in
 * which `defaultRunAsAdmin` is already `false` (039 FR-002). Every test that needs the preference
 * turned ON says so through `storedOn`, so the stored value is never accidental.
 */
function stubBridge({ elevated, storedOn = false }: { elevated: boolean; storedOn?: boolean }): void {
  Reflect.set(window, 'throng', {
    terminal: { capabilities: () => Promise.resolve({ elevated }) },
    config: {
      onChange: () => () => {},
      ...(storedOn
        ? { get: () => Promise.resolve({ settings: { terminals: { defaultRunAsAdmin: true } } }) }
        : {}),
    },
  });
}

/**
 * The three providers `SettingsTab` throws without — AND `ConfigProvider`, which it does not.
 *
 * ══ THE CONFIG PROVIDER IS NOT OPTIONAL HERE, AND LEAVING IT OUT PASSED ══
 *
 * `preferences-settings-search.test.ts` deliberately omits it: `useAppSettings` falls back to a
 * context default holding the SHIPPED document, which is exactly what that file wants. Copying
 * that harness here was wrong and the suite said so — the second test below asserts an unticked
 * control "even when settings.json holds true", and with no provider `config.get` is never called,
 * so the stored value stayed the shipped `false` and the assertion was satisfied by a value the
 * test had not set. It passed while proving nothing; the third test failing is what exposed it.
 *
 * That is the same shape as the impossible fixtures found earlier on this branch: the tell was in
 * the SETUP, never in the assertion.
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
          createElement(ConfigProvider, null, createElement(SettingsTab, null)),
        ),
      ),
    ),
  );
}

const control = (): HTMLInputElement => screen.getByTestId(`control-${KEY}`) as HTMLInputElement;

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('"Run as administrator by default" is not selectable unelevated (039 FR-008a)', () => {
  it('is DISABLED, and says why on the row rather than only on hover', async () => {
    stubBridge({ elevated: false });
    mount();

    // The control exists — it is disabled, not hidden. A control that vanishes takes its
    // explanation with it, and the user cannot see that the preference is still there waiting
    // for the elevated session that would honour it.
    await waitFor(() => expect(control()).toBeDisabled());

    // The reason, in the SAME WORDS the per-panel checkbox uses (`terminal-inputs.tsx`), so the
    // two controls explain themselves identically rather than in two dialects of one fact.
    expect(screen.getByTestId(`setting-inert-${KEY}`)).toHaveTextContent(
      /Relaunch throng as administrator to enable admin terminals/i,
    );
  });

  /*
   * The defect the maintainer reported, at its source.
   *
   * A stored `true` — set legitimately during an elevated session — must not render as ticked
   * while throng is unelevated, because it does not take effect and the user cannot clear it.
   * "Disabled and ticked" is the exact state that made the New Panel dialog claim an elevated
   * terminal it was never going to start.
   */
  it('shows UNTICKED even when settings.json holds true', async () => {
    stubBridge({ elevated: false, storedOn: true });
    mount();

    await waitFor(() => expect(control()).toBeDisabled());
    expect(control()).not.toBeChecked();
  });

  /*
   * The other direction, and it is not symmetry for its own sake.
   *
   * FR-006 forbids a preference change from rewriting stored configuration, and FR-008a keeps the
   * resolution READ-SIDE for the same reason: an unelevated session that wrote `false` over the
   * user's deliberate `true` would be the same defect with its sign flipped — they would relaunch
   * as administrator and find their preference quietly gone. This asserts that the stored value
   * survived the unelevated render by finding it honoured once elevation is reported.
   */
  it('honours the stored true again as soon as the daemon IS elevated', async () => {
    stubBridge({ elevated: true, storedOn: true });
    mount();

    await waitFor(() => expect(control()).toBeChecked());
    expect(control()).toBeEnabled();
    expect(screen.queryByTestId(`setting-inert-${KEY}`)).toBeNull();
  });
});
