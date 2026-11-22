/**
 * 018 / US7 — numbers are editable by dragging and readable at a glance (FR-032 … FR-039).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/preferences-slider.e2e.ts` (034 FR-045).
 *
 * That spec opened a real preferences WINDOW — a second Electron window, reached through the cog
 * menu — five times, to assert things about one control: that a bounded numeric renders a slider
 * beside its field, that the two drive each other, that a large value is displayed grouped, that a
 * fast fill-then-blur still commits, that an out-of-bounds entry is refused and the last valid value
 * stands, and that the slider carries the descriptor's min/max/step.
 *
 * None of that needs a window. All of it is `SettingControl` deciding what to render and when to
 * call `onCommit`, which is exactly what a DOM can see.
 *
 * WHAT DID NOT COME HERE, and why the E2E is not deleted outright: each of those tests also asserted
 * what reached `settings.json` or `themes/throng.json` on disk. That is the config-write path, not
 * the control, and it is covered at the integration layer
 * (`packages/ui/tests/integration/config-write-*.test.ts`). What survives as an E2E is one test
 * proving the two are actually wired to each other through a real preferences window — see the
 * spec's header for what remains there.
 *
 * The distinction matters because it is the one this whole feature turns on: the control's behaviour
 * and the file's contents are separate claims, and gluing them together with a window made a
 * two-second Electron launch the cheapest way to check a number was formatted with commas.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { formatGrouped, type FieldDescriptor } from '@throng/core';
import { SettingControl } from '../../src/renderer/preferences/form-controls.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';

/**
 * The descriptor the settings tab feeds this control. `behaviour.tabHoverActivateMs` is the real
 * one the E2E drove; its bounds are restated here rather than imported so a change to the shipped
 * default cannot silently rewrite what this test claims.
 */
const bounded: FieldDescriptor = {
  key: 'behaviour.tabHoverActivateMs',
  label: 'Tab hover activate',
  control: 'slider',
  type: 'number',
  min: 100,
  max: 3000,
  step: 100,
} as FieldDescriptor;

/** The eight-digit one. `10485760` is what nobody reads as ten megabytes. */
const large: FieldDescriptor = {
  key: 'editor.maxOpenFileBytes',
  label: 'Maximum openable file size',
  control: 'slider',
  type: 'number',
  min: 1_048_576,
  max: 52_428_800,
  step: 5_242_880,
} as FieldDescriptor;

function renderControl(descriptor: FieldDescriptor, value: unknown) {
  const onCommit = vi.fn();
  // 077 FR-024 — under the provider, as in the Preferences window: a box's problem is a toast carrying its `…-invalid` id.
  render(createElement(NotificationProvider, null, createElement(SettingControl, { descriptor, value, onCommit })));
  return { onCommit, user: userEvent.setup({ delay: null }) };
}

/**
 * The same control with a parent that holds the value, which is what the settings tab is.
 *
 * `SettingControl` is CONTROLLED — its value comes from props — so in isolation the slider cannot
 * follow the field, because nothing re-renders it. The E2E saw them track each other because the
 * real tab commits to the config store and re-renders with the new value, and that round trip is a
 * property of the pair rather than of the control.
 *
 * Discovered by writing the naive version of this test first and watching it fail: it asserted the
 * slider read 1200 and got 500, which is the control behaving exactly as designed. Worth keeping
 * both shapes — `renderControl` for what the control decides, this for what the user sees.
 */
function renderBound(descriptor: FieldDescriptor, initial: unknown) {
  const onCommit = vi.fn();
  function Host() {
    const [value, setValue] = useState<unknown>(initial);
    return createElement(SettingControl, {
      descriptor,
      value,
      onCommit: (v: unknown) => {
        onCommit(v);
        setValue(v);
      },
    });
  }
  render(createElement(NotificationProvider, null, createElement(Host)));
  return { onCommit, user: userEvent.setup({ delay: null }) };
}

const field = (key: string): HTMLInputElement => screen.getByTestId(`control-${key}`) as HTMLInputElement;
const slider = (key: string): HTMLInputElement =>
  screen.getByTestId(`control-${key}-slider`) as HTMLInputElement;

describe('a bounded numeric preference (FR-033)', () => {
  it('renders a slider AND a field', () => {
    renderControl(bounded, 500);
    expect(slider(bounded.key)).toBeVisible();
    expect(field(bounded.key)).toBeVisible();
  });

  it('carries the descriptor bounds on the slider (FR-039)', () => {
    // The font weights had NO BOUNDS AT ALL before 018 — no minimum, no maximum, no step — which is
    // why this is asserted rather than assumed. The E2E checked it on the THEMES tab; the control is
    // shared, so the claim is about the control.
    renderControl(bounded, 500);
    const s = slider(bounded.key);
    expect(s).toHaveAttribute('min', '100');
    expect(s).toHaveAttribute('max', '3000');
    expect(s).toHaveAttribute('step', '100');
  });

  it('moves the slider when the field is typed into and committed', async () => {
    const { user } = renderBound(bounded, 500);
    await user.clear(field(bounded.key));
    await user.type(field(bounded.key), '1200{Enter}');
    expect(slider(bounded.key).value).toBe('1200');
  });

  it('moves the field when the slider is dragged, grouping what it shows', async () => {
    // The other direction, and the one the E2E used `setSlider` for. `fireEvent.change` is the
    // honest way to drive a range input here: user-event's keyboard stepping is a browser behaviour
    // jsdom does not implement, so asserting through it would be asserting about jsdom.
    renderBound(bounded, 500);
    fireEvent.change(slider(bounded.key), { target: { value: '2000' } });
    expect(field(bounded.key).value).toBe('2,000');
  });

  it('shows a dragged value immediately but writes it only when the drag ends', () => {
    /*
     * Two claims, and the E2E could not separate them because it only ever looked at the file
     * afterwards.
     *
     * Dragging a range input fires `change` for every step it passes through. Committing each one
     * would write the config file dozens of times for a single gesture, so the control shows the
     * value as the thumb moves and writes when the user lets go — `onPointerUp` / `onKeyUp` /
     * `onBlur`.
     *
     * Worth knowing that the comment above this input in `form-controls.tsx` claimed the opposite
     * ("commits on every change") until this test was written. The code was right and the comment
     * was wrong.
     *
     * A correction to an earlier version of this note, which claimed nothing could have caught the
     * drift: `preferences-fonts-and-sliders.e2e.ts` ("a slider writes when you LET GO — not on every
     * pixel, and not on a timer") reads settings.json MID-DRAG and asserts it unchanged, so it does
     * distinguish the two behaviours and has been asserting the right one all along. What this test
     * adds is not the discovery — it is the same guarantee in milliseconds rather than an app
     * launch, and one that names the two halves separately.
     */
    const { onCommit } = renderControl(bounded, 500);
    const s = slider(bounded.key);

    fireEvent.change(s, { target: { value: '600' } });
    expect(onCommit, 'a value passed through mid-drag must not reach the config file').not.toHaveBeenCalled();

    fireEvent.pointerUp(s);
    expect(onCommit).toHaveBeenCalledWith(600);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

describe('grouping (FR-037, FR-038)', () => {
  it('DISPLAYS a large value grouped', () => {
    renderControl(large, 10_485_760);
    expect(field(large.key).value).toBe('10,485,760');
  });

  it('accepts back the grouped form it just rendered, and commits a PLAIN number', async () => {
    const { user, onCommit } = renderControl(large, 10_485_760);
    await user.clear(field(large.key));
    await user.type(field(large.key), '20,971,520{Enter}');
    // A grouping character must never reach the value — the file assertion in the E2E was the same
    // claim one layer further on.
    expect(onCommit).toHaveBeenCalledWith(20_971_520);
  });
});

describe('committing and refusing (FR-036, FR-017)', () => {
  it('commits a fast fill-then-blur, reading the live DOM rather than React state', async () => {
    /*
     * THE regression this control is most likely to reintroduce, and the reason it is worth a test
     * of its own rather than a line in another one.
     *
     * The field commits on blur reading the LIVE input, not React state, because a fast
     * fill-then-blur fires before React has re-rendered and a handler closing over the previous
     * state silently drops the edit. It was a real CI flake: a debounce filled to 1500, blurred,
     * and stayed 900.
     *
     * The tempting way to add a slider is to make the field commit on every change so the two
     * "match". That is exactly what brings the defect back.
     */
    /*
     * ══ WHY THIS DOES NOT USE `user.type` ══
     *
     * It did, and a vacuity audit showed the test could not fail. `user.type` is act-wrapped, so
     * React has already re-rendered by the time `blur` fires and its state EQUALS the input's value.
     * Both readings agree, so `commit(e.currentTarget.value)` and `commit(text)` behave identically
     * and the mutation that restores the defect leaves the test green.
     *
     * The defect only exists in the window where the DOM has moved and React has not. So the value is
     * written straight onto the element, bypassing React entirely, and `fireEvent.blur` is dispatched
     * without an intervening render — which is what a fast paste-then-blur actually does.
     */
    const { onCommit } = renderControl(bounded, 900);
    const f = field(bounded.key);
    f.value = '1500';
    fireEvent.blur(f);
    expect(onCommit).toHaveBeenCalledWith(1500);
  });

  /*
   * 077 FR-008, FR-009 supersede the refusals these three cases asserted (018 FR-036, 044 T163e): a value is checked
   * AS IT IS TYPED, the message names the bound while the user is still typing, and confirming a value past a bound
   * stores that bound. Only text that is no number is refused, and confirming it puts the stored value back.
   */
  it('says a non-numeric entry is not a number while it is typed, and on Enter stores nothing and keeps it', async () => {
    const { user, onCommit } = renderControl(bounded, 900);
    await user.clear(field(bounded.key));
    await user.type(field(bounded.key), 'not-a-number');
    expect(screen.getByTestId(`control-${bounded.key}-invalid`)).toHaveTextContent('Tab hover activate must be a whole number');
    await user.keyboard('{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
    // Never discarded (040 FR-007): the entry and its message stay until corrected, or Escape restores.
    expect(field(bounded.key).value).toBe('not-a-number');
    expect(screen.getByTestId(`control-${bounded.key}-invalid`)).toHaveTextContent('Tab hover activate must be a whole number');
    await user.keyboard('{Escape}');
    expect(field(bounded.key).value).toBe('900');
    expect(screen.queryByTestId(`control-${bounded.key}-invalid`)).toBeNull();
  });

  it('names the maximum while a value above it is typed, and stores the maximum on Enter', async () => {
    const { user, onCommit } = renderControl(bounded, 900);
    await user.clear(field(bounded.key));
    await user.type(field(bounded.key), '999999');
    expect(screen.getByTestId(`control-${bounded.key}-invalid`)).toHaveTextContent(`Tab hover activate must be between ${formatGrouped(100)} and ${formatGrouped(3000)}`);
    await user.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledWith(3000);
  });

  it('names the minimum while a value below it is typed, and stores the minimum on Enter', async () => {
    const { user, onCommit } = renderControl(bounded, 900);
    await user.clear(field(bounded.key));
    await user.type(field(bounded.key), '40');
    expect(screen.getByTestId(`control-${bounded.key}-invalid`)).toHaveTextContent(`Tab hover activate must be between ${formatGrouped(100)} and ${formatGrouped(3000)}`);
    await user.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledWith(100);
  });

  it('restores the stored value on Escape', async () => {
    const { user, onCommit } = renderControl(bounded, 900);
    await user.clear(field(bounded.key));
    await user.type(field(bounded.key), '1700{Escape}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(field(bounded.key).value).toBe('900');
  });
});

/**
 * 077 — one numeric control for every setting: the slider and the value shown in the setting's display unit, the box
 * holding the exact stored value, and a slider greyed — but still live — while the stored value is off its grid
 * (FR-004, FR-005, FR-007, FR-008, FR-009). Grouped digits are built with `formatGrouped` (locale separator).
 */
const MiB = 1024 * 1024;
const sizeCap: FieldDescriptor = {
  key: 'editor.maxOpenFileBytes',
  label: 'Max open file size',
  description: '',
  group: 'Editor',
  control: 'slider',
  storedUnit: 'bytes',
  display: 'MB',
  min: 5 * MiB,
  max: 250 * MiB,
  step: 5 * MiB,
  hardMin: 1024,
  hardMax: 2048 * MiB,
};
const quiet: FieldDescriptor = {
  key: 'terminals.attention.quietMs',
  label: 'Quiet time',
  description: '',
  group: 'Terminal',
  control: 'slider',
  storedUnit: 'ms',
  display: 's',
  min: 10_000,
  max: 600_000,
  step: 10_000,
  hardMin: 1000,
  hardMax: 3_600_000,
};
const value = (key: string): HTMLElement => screen.getByTestId(`control-${key}-value`);

describe('077 — a size in MB, or exactly in bytes (US1)', () => {
  it('shows the value in MB beside its slider and the exact bytes, grouped, in the box', () => {
    renderControl(sizeCap, 10 * MiB);
    expect(value(sizeCap.key)).toHaveTextContent(`${formatGrouped(10)} MB`);
    expect(field(sizeCap.key).value).toBe(formatGrouped(10 * MiB));
    expect(slider(sizeCap.key)).toHaveAttribute('aria-valuetext', `${formatGrouped(10)} MB`);
    expect(slider(sizeCap.key)).not.toHaveAttribute('data-overridden', 'true');
  });

  it('stores an exact byte count typed in the box, and greys the slider, which stays live', async () => {
    const { user, onCommit } = renderBound(sizeCap, 10 * MiB);
    await user.clear(field(sizeCap.key));
    await user.type(field(sizeCap.key), `${formatGrouped(12_345_678)}{Enter}`);
    expect(onCommit).toHaveBeenLastCalledWith(12_345_678);
    expect(slider(sizeCap.key)).toHaveAttribute('data-overridden', 'true');
    expect(slider(sizeCap.key)).toBeEnabled();
    expect(value(sizeCap.key)).toHaveTextContent(`${formatGrouped(11.77)} MB`);
  });

  it('takes a value past the slider maximum, up to the hard maximum, with the slider greyed at its end', async () => {
    const { user, onCommit } = renderBound(sizeCap, 10 * MiB);
    await user.clear(field(sizeCap.key));
    await user.type(field(sizeCap.key), `${1024 * MiB}{Enter}`);
    expect(onCommit).toHaveBeenLastCalledWith(1024 * MiB);
    expect(slider(sizeCap.key)).toHaveAttribute('data-overridden', 'true');
    expect(slider(sizeCap.key).value).toBe(String(250 * MiB));
  });

  it('un-greys the slider when it is moved, storing that stop', () => {
    const { onCommit } = renderBound(sizeCap, 12_345_678);
    expect(slider(sizeCap.key)).toHaveAttribute('data-overridden', 'true');
    fireEvent.change(slider(sizeCap.key), { target: { value: String(20 * MiB) } });
    fireEvent.pointerUp(slider(sizeCap.key));
    expect(onCommit).toHaveBeenLastCalledWith(20 * MiB);
    expect(slider(sizeCap.key)).not.toHaveAttribute('data-overridden', 'true');
    expect(field(sizeCap.key).value).toBe(formatGrouped(20 * MiB));
  });

  it('names the hard maximum in bytes while typing, and stores it on Enter', async () => {
    const { user, onCommit } = renderControl(sizeCap, 10 * MiB);
    await user.clear(field(sizeCap.key));
    await user.type(field(sizeCap.key), '999999999999');
    expect(screen.getByTestId(`control-${sizeCap.key}-invalid`)).toHaveTextContent(`Max open file size must be between ${formatGrouped(1024)} and ${formatGrouped(2048 * MiB)} bytes`);
    await user.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledWith(2048 * MiB);
  });
});

describe('077 — a duration in its own unit, or exactly in ms (US2)', () => {
  it('shows seconds beside the slider and ms in the box, and greys the slider for an off-grid value', async () => {
    const { user, onCommit } = renderBound(quiet, 10_000);
    expect(value(quiet.key)).toHaveTextContent(`${formatGrouped(10)} s`);
    expect(field(quiet.key).value).toBe(formatGrouped(10_000));
    await user.clear(field(quiet.key));
    await user.type(field(quiet.key), `${formatGrouped(45_500)}{Enter}`);
    expect(onCommit).toHaveBeenLastCalledWith(45_500);
    expect(value(quiet.key)).toHaveTextContent(`${formatGrouped(45.5)} s`);
    expect(slider(quiet.key)).toHaveAttribute('data-overridden', 'true');
  });
});

/**
 * 030 / FR-010, FR-011 — the notification duration.
 *
 * MIGRATED FROM `packages/ui/tests/e2e/notification-prefs.e2e.ts`, a spec measured at 60.8 seconds
 * and among the ten slowest in the suite. Two of its eight tests are about this control alone:
 * the duration is bounded, and it goes inert when the mode beside it takes its meaning away.
 *
 * The other six stay end-to-end, and deservedly — they watch a real notice appear, survive, and
 * vanish on a timer. That is the product doing the thing, and no DOM can stand in for it.
 */
const duration: FieldDescriptor = {
  key: 'notifications.error.timeoutMs',
  label: 'Error notification duration',
  control: 'slider',
  type: 'number',
  min: 3000,
  max: 30_000,
  step: 500,
} as FieldDescriptor;

describe('the notification duration (030 FR-010, FR-011)', () => {
  // 077 FR-009 supersedes the refusal: a duration past the floor or the ceiling stores that bound.
  it('holds a duration below the floor or above the ceiling to that bound', async () => {
    const { user, onCommit } = renderControl(duration, 5000);
    await user.clear(field(duration.key));
    await user.type(field(duration.key), '2999{Enter}');
    expect(onCommit).toHaveBeenLastCalledWith(3000);
    await user.clear(field(duration.key));
    await user.type(field(duration.key), '30001{Enter}');
    expect(onCommit).toHaveBeenLastCalledWith(30_000);
  });

  it('accepts a duration inside the bounds', async () => {
    const { user, onCommit } = renderControl(duration, 5000);
    await user.clear(field(duration.key));
    await user.type(field(duration.key), '7500{Enter}');
    expect(onCommit).toHaveBeenCalledWith(7500);
  });

  it('goes INERT — shown, not hidden — when a sibling value takes its meaning away (FR-011)', () => {
    /*
     * `notifications.<severity>.timeoutMs` means nothing unless the mode beside it is *Display for*.
     * The control is shown and disabled rather than hidden, and that is the requirement rather than
     * a style choice: a control that vanishes takes its own explanation with it, and the user cannot
     * see that the duration is still there waiting for the mode that uses it.
     */
    const onCommit = vi.fn();
    render(createElement(SettingControl, { descriptor: duration, value: 5000, onCommit, disabled: true }));
    expect(field(duration.key)).toBeVisible();
    expect(field(duration.key)).toBeDisabled();
    expect(slider(duration.key)).toBeDisabled();
  });
});
