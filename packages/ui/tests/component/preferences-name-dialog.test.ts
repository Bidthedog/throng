/**
 * The theme name dialog — what it REFUSES, and what it refuses to hand back (014 FR-006/FR-007).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/preferences-themes.e2e.ts` (034 FR-045/FR-046):
 *   - "the rename dialog refuses a reserved built-in name and writes nothing"
 *
 * That test launched Electron, seeded a custom theme file into a running config root, opened the
 * preferences window, selected a theme, clicked Rename — and then made three assertions about a
 * modal (`theme-name-dialog` is visible, `theme-name-error` is visible, `theme-name-confirm` is
 * disabled) plus two `existsSync` calls standing in for "nothing was written".
 *
 * `NameDialog` takes `reserved`, `existing`, `renamingFrom`, `onConfirm` and `onCancel` as props and
 * reaches nothing else — no context, no bridge, no store. Every one of those assertions is a DOM
 * fact about a component handed five props.
 *
 * ══ WHERE IT LANDS STRONGER THAN THE E2E ══
 *
 *  - "Nothing was written" was `existsSync(throng.json) && existsSync(CustomOne.json)` — which a
 *    dialog that wrote a THIRD file would have satisfied perfectly. `onConfirm` is the dialog's only
 *    output, so asserting it was never called covers the whole surface, not two paths of it.
 *  - The E2E clicked the disabled button only. **Enter** submits too (`onKeyDown`), and a disabled
 *    button does not disable a keyboard handler — an invalid name reaching `onConfirm` through Enter
 *    is the way this guard would realistically be lost, and no test at any layer asked before.
 *  - The refusal REASONS are distinguished. The E2E asserted the error element merely existed, so
 *    `messageFor` returning one sentence for all three cases would have passed it; empty, reserved
 *    and duplicate now each assert their own words.
 *
 * ══ WHAT STAYED END-TO-END, AND WHY ══
 *
 *  - That clicking `theme-rename` OPENS this dialog, and that confirming a valid name RENAMES the
 *    file on disk: `preferences-themes.e2e.ts` › "US3: Clone is the sole creation path …" does both
 *    and stays. FR-047 — the migrated test's own steps are still witnessed end-to-end.
 *  - That the reserved set the tab passes in comes from `reservedThemeNames()` and NOT from the
 *    themes present on disk (FR-007). That is `themes-tab.tsx` WIRING; this file is handed the
 *    reserved list, so it cannot tell where the tab got it. `preferences-themes.e2e.ts` ›
 *    "US3: a DELETED built-in name is still reserved" deletes the file first and stays for exactly
 *    that reason. The test below with `existing` omitting Debian is reinforcement, not its
 *    replacement.
 *
 * The pure predicate underneath (`validateThemeName`, `cloneName`) is unit-tested in
 * `packages/core/tests/unit/theme-editor-model.test.ts`; what is asserted here is the DIALOG — that
 * a refusal reaches the disabled attribute, the rendered sentence, and the silent callback.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * In `packages/ui/src/renderer/preferences/name-dialog.tsx`, change the name field's
 * `data-testid="theme-name-input"` to `data-testid="theme-name-input-x"`. Every test in this file
 * reaches the input — to fill it, to read its value, or to press a key at it — through
 * `getByTestId`, which THROWS on a miss. **ALL 10 tests fail.** No assertion here can pass against a
 * dialog that did not render.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cloneName, reservedThemeNames } from '@throng/core';
import { NameDialog } from '../../src/renderer/preferences/name-dialog.js';

/**
 * The REAL reserved set — `Object.keys(shipped.themes)` — not a hand-written list.
 *
 * A literal `['throng', 'Matrix', 'Debian']` would keep passing after a built-in was renamed, which
 * is the failure the E2E's use of the running app made impossible. Reading the shipped record keeps
 * that property at this layer.
 */
const RESERVED = reservedThemeNames();

type Props = Parameters<typeof NameDialog>[0];

function open(overrides: Partial<Props> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const props: Props = {
    title: 'Rename theme',
    initialValue: 'CustomOne',
    reserved: RESERVED,
    existing: ['throng', 'CustomOne'],
    renamingFrom: 'CustomOne',
    confirmLabel: 'Rename',
    onConfirm,
    onCancel,
    ...overrides,
  } as Props;
  render(createElement(NameDialog, props));
  return { onConfirm, onCancel, user: userEvent.setup() };
}

const input = (): HTMLInputElement => screen.getByTestId('theme-name-input') as HTMLInputElement;
const confirm = (): HTMLElement => screen.getByTestId('theme-name-confirm');
const error = (): HTMLElement | null => screen.queryByTestId('theme-name-error');

/** Replace the field's contents, as the user renaming something does. */
async function typeName(user: ReturnType<typeof open>['user'], name: string): Promise<void> {
  await user.clear(input());
  if (name.length > 0) await user.type(input(), name);
}

describe('a reserved built-in name is refused, and nothing is handed back (FR-007)', () => {
  it('refuses the name, says why, and disables confirm', async () => {
    const { user } = open();
    await typeName(user, 'throng');
    expect(error()).toHaveTextContent('That name is reserved for a built-in theme.');
    expect(confirm()).toBeDisabled();
  });

  it('hands nothing to onConfirm — by click OR by Enter', async () => {
    // The E2E proved "nothing was written" by looking for two files that were already there. The
    // dialog's ONLY way to write anything is `onConfirm`, and Enter reaches `submit()` without
    // going near the disabled button.
    const { user, onConfirm } = open();
    await typeName(user, 'throng');
    await user.click(confirm());
    await user.type(input(), '{Enter}');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('refuses it in ANY case — a theme name is a FILE name (FR-007)', async () => {
    // `MATRIX.json` IS `Matrix.json` on Windows, so a case-only difference would silently overwrite
    // the built-in. Asserted for a second built-in so the check cannot be satisfied by one alias.
    const { user, onConfirm } = open();
    for (const name of ['THRONG', 'mAtRiX']) {
      await typeName(user, name);
      expect(error(), `${name} was accepted`).toHaveTextContent(
        'That name is reserved for a built-in theme.',
      );
      expect(confirm()).toBeDisabled();
    }
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('refuses a built-in name that is NOT among the themes present', async () => {
    /*
     * Reinforcement for FR-007, not a replacement for its E2E: `existing` here lists only two
     * themes, so `Debian` is absent from the set of names on disk and is refused by the RESERVED set
     * alone. What this cannot see is which list `themes-tab.tsx` passes as `reserved` — see the
     * header.
     */
    const { user } = open({ existing: ['throng', 'CustomOne'] });
    await typeName(user, 'Debian');
    expect(error()).toHaveTextContent('That name is reserved for a built-in theme.');
    expect(confirm()).toBeDisabled();
  });
});

describe('the other two refusals read differently (messageFor)', () => {
  it('names a duplicate as a duplicate, not as reserved', async () => {
    const { user, onConfirm } = open({
      existing: ['throng', 'CustomOne', 'MyTheme'],
      renamingFrom: 'CustomOne',
    });
    await typeName(user, 'MyTheme');
    expect(error()).toHaveTextContent('A theme with that name already exists.');
    expect(confirm()).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('asks for a name when the field is emptied', async () => {
    const { user, onConfirm } = open();
    await typeName(user, '');
    expect(error()).toHaveTextContent('Enter a name.');
    expect(confirm()).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('a name it accepts', () => {
  it('shows no error, enables confirm, and hands back the TRIMMED name', async () => {
    // The positive control for every refusal above: the same dialog, one keystroke different, does
    // let go of a name. Without it, a dialog wired to refuse everything would pass this whole file.
    const { user, onConfirm } = open();
    await typeName(user, '  MyTheme  ');
    expect(error()).toBeNull();
    expect(confirm()).toBeEnabled();
    await user.click(confirm());
    expect(onConfirm).toHaveBeenCalledWith('MyTheme');
  });

  it('lets a rename keep its own current name (renamingFrom is not a collision)', async () => {
    const { user, onConfirm } = open({ initialValue: 'CustomOne', renamingFrom: 'CustomOne' });
    expect(input().value).toBe('CustomOne');
    expect(error()).toBeNull();
    await user.click(confirm());
    expect(onConfirm).toHaveBeenCalledWith('CustomOne');
  });
});

describe('the Clone prefill (FR-006)', () => {
  it('opens on "<source> - Clone" with the trailing word pre-selected', () => {
    /*
     * Reinforcement for `preferences-themes.e2e.ts` › "US3: Clone is the sole creation path …",
     * which stays: the E2E's remaining claims are that Clone CREATES the file and ACTIVATES it.
     * What the prefill is, and what the caret is sitting on, is this component plus `cloneName`.
     */
    const initial = cloneName('throng');
    open({
      initialValue: initial,
      preselect: { start: initial.length - 'Clone'.length, end: initial.length },
      existing: ['throng'],
      renamingFrom: undefined,
      confirmLabel: 'Clone',
    });
    const el = input();
    expect(el.value).toBe('throng - Clone');
    expect(el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0)).toBe('Clone');
  });
});

describe('cancelling', () => {
  it('Escape cancels and confirms nothing', async () => {
    const { user, onConfirm, onCancel } = open();
    await user.type(input(), '{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
