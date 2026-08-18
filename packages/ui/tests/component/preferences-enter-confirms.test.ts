/**
 * 021 — ENTER is the confirm key, in every box in the preferences window that takes typing.
 *
 * MIGRATED FROM `packages/ui/tests/e2e/theme-sizes-and-notices.e2e.ts` (034 FR-045):
 *
 *   "ENTER confirms a box — it is the confirm key, in every box that takes typing"
 *
 * That test launched Electron, opened the preferences window as a SECOND window, typed into two
 * boxes, and read `settings.json` back off disk twice. Its subject is a keydown handler.
 *
 * ══ WHY IT IS WORTH RE-WRITING RATHER THAN RELOCATING ══
 *
 * The E2E's SECOND half could not fail for the reason it claimed. It filled
 * `control-explorer.excludeGlobs-item-0`, pressed Enter, and asserted the glob had reached
 * `settings.json`. But `StringArrayControl` (form-controls.tsx) commits on `onChange` — every
 * keystroke calls `set(next)` → `onCommit` — and its Enter handler does exactly one thing:
 *
 *     onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
 *
 * Delete that handler entirely and the E2E stays green, because the value the assertion reads was
 * already written by the typing. The only Enter-specific behaviour in a list row is that the field
 * LETS GO, and the E2E asserted nothing about focus. So the test below asserts the blur, and asserts
 * separately that the commit had already happened before Enter — which is the honest statement of
 * what that control does, and the thing the E2E's file read was silently standing in for.
 *
 * The FIRST half (a number field: type, Enter, and it is the value) is genuinely Enter-coupled —
 * `NumberControl`'s Enter handler commits and does NOT blur — so it is asserted here with the extra
 * claim the E2E could not make: that focus is still in the box afterwards, which is what
 * distinguishes "Enter committed it" from "something blurred and blur committed it".
 *
 * ══ WHAT DID NOT COME HERE ══
 *
 * `settings.json`. That is the config-write path, not the control, and it is covered at the
 * integration layer (`packages/ui/tests/integration/config-write*.test.ts`). The seam — a real
 * preferences window whose control is bound to the real config store, driven with the SAME
 * fill-then-Enter gesture — is the one test deliberately kept in
 * `packages/ui/tests/e2e/preferences-slider.e2e.ts:74`, which types `1200`, presses Enter, and
 * requires the value to come back out of the store. This file does not claim to replace that.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Every test here reaches its subject through `renderBound` / `renderControl`. Replace the body of
 * `renderBound`'s `Host` with `createElement('div')` — i.e. render no control at all — and ALL SIX
 * tests in this file fail (`Unable to find an element by: [data-testid="control-…"]`). None of them
 * is of the form "X is absent", so none can pass on an empty DOM.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { FieldDescriptor } from '@throng/core';
import { SettingControl } from '../../src/renderer/preferences/form-controls.js';

/** The number box the E2E drove, with its real bounds restated rather than imported. */
const tabHover: FieldDescriptor = {
  key: 'behaviour.tabHoverActivateMs',
  label: 'Tab hover activate',
  control: 'slider',
  type: 'number',
  min: 100,
  max: 3000,
  step: 100,
} as FieldDescriptor;

/** The list the E2E drove. `itemControl: 'text'` is what routes it to `StringArrayControl`. */
const excludeGlobs: FieldDescriptor = {
  key: 'explorer.excludeGlobs',
  label: 'Excluded globs',
  control: 'array',
  itemControl: 'text',
  type: 'array',
} as FieldDescriptor;

/**
 * A probe for `SettingControl`'s DEFAULT arm.
 *
 * No shipped settings descriptor declares `control: 'text'` — `TextControl` is reached by
 * FALL-THROUGH, which on the Themes tab is how a token with no dedicated picker is edited
 * (`ThemeTokenControl`'s own default arm hands straight back to `SettingControl`). Being reached by
 * fall-through is exactly why it is worth pinning: nothing names it, so nothing else asserts that
 * its Enter handler — a different implementation from `NumberControl`'s, which commits AND blurs —
 * still behaves.
 */
const freeText: FieldDescriptor = {
  key: 'probe.freeText',
  label: 'Free text',
  control: 'text',
  type: 'string',
} as FieldDescriptor;

/** The control in isolation: what it decides, and when it calls `onCommit`. */
function renderControl(descriptor: FieldDescriptor, value: unknown) {
  const onCommit = vi.fn();
  render(createElement(SettingControl, { descriptor, value, onCommit }));
  return { onCommit, user: userEvent.setup() };
}

/**
 * The control with a parent that holds its value — which is what the settings tab is.
 *
 * `SettingControl` is CONTROLLED, so a list row that commits as you type only shows the accumulated
 * text if something re-renders it with the new array. Without this host, typing a multi-character
 * glob into a row would leave one character behind.
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
  render(createElement(Host));
  return { onCommit, user: userEvent.setup() };
}

const box = (testId: string): HTMLInputElement => screen.getByTestId(testId) as HTMLInputElement;

describe('a NUMBER box confirms on Enter (021)', () => {
  it('commits the typed value on Enter, with the caret still in the box', async () => {
    /*
     * The claim, precisely: it was ENTER that committed, not a blur that happened to follow.
     *
     * `NumberControl`'s Enter handler commits and deliberately does NOT blur — a number beside a
     * slider is a thing you keep adjusting, so confirming it should not throw you out of the field.
     * Asserting the focus is what separates this from the blur-commit path the same control also
     * has; without it, deleting the Enter handler would still look green the moment anything else
     * moved focus.
     */
    const { user, onCommit } = renderControl(tabHover, 900);
    const field = box('control-behaviour.tabHoverActivateMs');
    await user.clear(field);
    await user.type(field, '1234{Enter}');
    expect(onCommit).toHaveBeenCalledWith(1234);
    expect(document.activeElement, 'Enter must confirm without ejecting the user from the box').toBe(
      field,
    );
  });

  it('does NOT commit on typing alone — Enter is doing the work', async () => {
    // The control for the test above. If the field committed as it went, the assertion up there
    // would pass with the Enter handler deleted.
    const { user, onCommit } = renderControl(tabHover, 900);
    const field = box('control-behaviour.tabHoverActivateMs');
    await user.clear(field);
    await user.type(field, '1234');
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("a free-TEXT box confirms on Enter and lets go (SettingControl's default arm)", () => {
  it('commits what was typed and releases the field', async () => {
    const { user, onCommit } = renderControl(freeText, 'before');
    const field = box('control-probe.freeText');
    await user.clear(field);
    await user.type(field, 'after{Enter}');
    expect(onCommit).toHaveBeenCalledWith('after');
    // Unlike the number box, a plain text box has no slider beside it to keep adjusting, so Enter
    // ends the interaction outright.
    expect(document.activeElement).not.toBe(field);
  });

  it('releases the field WITHOUT committing when nothing was changed', async () => {
    /*
     * `if (raw !== value) onCommit(raw)`. A confirm that rewrites the config file with the value it
     * already held is a write for nothing — and on the Themes tab that write is a round trip out to
     * a file and back through a watcher, which is visible as a flicker.
     */
    const { user, onCommit } = renderControl(freeText, 'unchanged');
    const field = box('control-probe.freeText');
    await user.click(field);
    await user.keyboard('{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(field);
  });
});

describe('a LIST row confirms on Enter by LETTING GO (021)', () => {
  it('releases the row on Enter', async () => {
    /*
     * This is the whole of Enter's job in a list row, and it is the assertion the E2E never made.
     *
     * A row of a list has no natural end to its gesture, so it commits as you type; a user who then
     * presses Enter — as anyone would — is saying "done with this one". Before 021 that keystroke
     * did nothing at all and the field kept the caret, which reads as a box that refuses to accept
     * an answer.
     */
    const { user } = renderBound(excludeGlobs, ['**/node_modules']);
    const row = box('control-explorer.excludeGlobs-item-0');
    await user.clear(row);
    await user.type(row, '**/.hidden{Enter}');
    expect(document.activeElement, 'Enter must let go of a list row').not.toBe(row);
  });

  it('has ALREADY committed by the time Enter arrives — which is why the E2E proved nothing', async () => {
    /*
     * Stated as a test rather than a comment, because it is the reason this migration exists.
     *
     * `theme-sizes-and-notices.e2e.ts` filled this row, pressed Enter, and read the glob back out of
     * `settings.json`. That assertion is satisfied by the `onChange` commit alone: remove the Enter
     * handler and it stays green. Pinning the ordering here means a future change that moves the
     * list row to commit-on-Enter has to come past this test and say so, instead of quietly
     * inheriting a green bar from a test that was measuring the wrong keystroke.
     */
    const { user, onCommit } = renderBound(excludeGlobs, ['**/node_modules']);
    const row = box('control-explorer.excludeGlobs-item-0');
    await user.clear(row);
    await user.type(row, '**/.hidden');

    expect(onCommit).toHaveBeenLastCalledWith(['**/.hidden']);
    const beforeEnter = onCommit.mock.calls.length;

    await user.keyboard('{Enter}');
    expect(onCommit.mock.calls.length, 'Enter must not re-commit a value the row already stored').toBe(
      beforeEnter,
    );
  });
});
