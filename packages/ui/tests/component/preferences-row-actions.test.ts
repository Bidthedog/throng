/**
 * 021 / US1 — every editable row offers reset, revert and clear (FR-015, SC-016).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/preferences-row-actions.e2e.ts` and
 * `preferences-theme-reset.e2e.ts` (034 FR-045).
 *
 * The requirement is a statement about geometry and about absence, and both are DOM facts:
 *
 *  - an action that does not apply YET is **shown and disabled**, never hidden, so the row's control
 *    cannot move out from under the pointer at the moment the user touches it;
 *  - an action that will NEVER apply on this surface is **absent entirely** — Reset on a custom
 *    theme, which has no shipped value to return to.
 *
 * Declining and disabling look similar in a screenshot and are opposites in meaning, which is why
 * the distinction is worth a test rather than a comment. Reading it needed no application: the
 * component is handed `overridden`, `changed`, `clearable` and three optional handlers, and an
 * omitted handler IS the decline.
 *
 * WHAT STAYED AN E2E: what each action actually does to the file — Reset returning a token to its
 * SHIPPED value versus Revert returning it to the value the window OPENED with. Those differ only in
 * which baseline they read, and the baselines live in the config store and the window's own opening
 * snapshot. A component handed an `onReset` callback cannot tell you which of the two it is wired to.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RowActions } from '../../src/renderer/preferences/row-actions.js';

type Props = Parameters<typeof RowActions>[0];

function renderRow(overrides: Partial<Props> = {}) {
  const onReset = vi.fn();
  const onRevert = vi.fn();
  const onClear = vi.fn();
  const props: Props = {
    kind: 'setting',
    itemKey: 'editor.autoSave',
    label: 'Auto save',
    overridden: false,
    changed: false,
    clearable: false,
    onReset,
    onRevert,
    onClear,
    ...overrides,
  } as Props;
  render(createElement(RowActions, props));
  return { onReset, onRevert, onClear, user: userEvent.setup() };
}

const action = (name: string, key = 'editor.autoSave'): HTMLElement =>
  screen.getByTestId(`setting-${name}-${key}`);

describe('the three row actions (FR-015)', () => {
  it('shows all three even when none of them applies yet', () => {
    // The requirement is that the row's control MUST NOT move. Hiding an affordance changes the
    // row's geometry the instant the user edits something.
    renderRow();
    expect(action('reset')).toBeVisible();
    expect(action('revert')).toBeVisible();
    expect(action('clear')).toBeVisible();
  });

  it('DISABLES rather than hides an action that does not apply yet', () => {
    renderRow();
    expect(action('reset')).toBeDisabled();
    expect(action('revert')).toBeDisabled();
    expect(action('clear')).toBeDisabled();
  });

  it('enables reset once the value is overridden, and revert once it has changed', () => {
    renderRow({ overridden: true, changed: true, clearable: true });
    expect(action('reset')).toBeEnabled();
    expect(action('revert')).toBeEnabled();
    expect(action('clear')).toBeEnabled();
  });

  it('calls the handler belonging to the action that was clicked', async () => {
    const { user, onReset, onRevert, onClear } = renderRow({
      overridden: true,
      changed: true,
      clearable: true,
    });
    await user.click(action('reset'));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onRevert).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });

  it('names its own scope in each hover title', () => {
    // Every action title carries the row's label, so a user hovering "Reset" on a list of forty
    // rows learns which one it would reset.
    renderRow({ overridden: true, changed: true, clearable: true, label: 'Auto save' });
    for (const name of ['reset', 'revert', 'clear']) {
      expect(action(name)).toHaveAttribute('title', expect.stringContaining('Auto save') as never);
    }
  });
});

describe('declining an action is not disabling it (issue #76)', () => {
  it('omits Reset entirely on a surface where it can never apply', () => {
    // A CUSTOM theme has no shipped value to return to. Reset is absent, not greyed — because it
    // will never apply here, rather than not applying yet.
    renderRow({ kind: 'theme', itemKey: 'colours.accent', onReset: undefined });
    expect(screen.queryByTestId('theme-reset-colours.accent')).toBeNull();
  });

  it('still offers Revert on that same surface', () => {
    // The half that makes the previous assertion meaningful: declining Reset must not quietly take
    // Revert with it, which is what a blanket "hide the actions here" would have done.
    renderRow({ kind: 'theme', itemKey: 'colours.accent', changed: true, onReset: undefined });
    expect(screen.getByTestId('theme-revert-colours.accent')).toBeVisible();
    expect(screen.getByTestId('theme-revert-colours.accent')).toBeEnabled();
  });
});
