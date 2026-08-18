/**
 * The font-family pill editor (007 H4, FR-038a/FR-038b).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/preferences-themes.e2e.ts` (034 FR-045).
 *
 * A theme stores a font as a comma-separated CSS stack. The control shows each family as an ordered,
 * deletable pill, opens a typeahead on click, appends a pill on selection, and serialises the pills
 * back to a stack. All of that is `ThemeTokenControl` — an exported component taking `descriptor`,
 * `value`, `fonts` and `onCommit`, and no context whatsoever.
 *
 * The parsing and serialising underneath it are already proved on their own in
 * `packages/core/tests/unit/font-stack.test.ts` (quote stripping, whitespace, round-trip). What was
 * missing was the layer between: that the parsed families become pills IN ORDER, that picking
 * appends rather than replaces, and that removing one re-serialises the rest. Those were being asked
 * through Electron, a preferences window and a theme file on disk.
 *
 * WHAT STAYS END-TO-END: that a committed stack reaches `<theme>.json` and the running application
 * re-renders with it. `onCommit` firing with the right string is not the same claim as a file on disk
 * changing, and it is the file that the live-reload path reads.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { FieldDescriptor } from '@throng/core';
import { ThemeTokenControl } from '../../src/renderer/preferences/pickers.js';

const KEY = 'typography.paneTitle.family';

/**
 * A font-family descriptor.
 *
 * `paneTitle` is the one the E2E used on purpose: it pins no family in the shipped theme, so the
 * control has to appear for a role that has never had a value — which was the actual defect (T106).
 */
const descriptor = {
  key: KEY,
  label: 'Pane title font',
  description: 'The font stack for pane titles.',
  control: 'font-family',
  type: 'string',
} as unknown as FieldDescriptor;

const FONTS = ['Arial', 'Georgia', 'Segoe UI', 'system-ui', 'sans-serif'] as const;

function mount(value: unknown) {
  const onCommit = vi.fn();
  render(
    createElement(ThemeTokenControl, { descriptor, value, fonts: FONTS, onCommit }),
  );
  return { onCommit, user: userEvent.setup() };
}

const pill = (i: number): HTMLElement => screen.getByTestId(`control-${KEY}-pill-${i}`);
const pills = (): HTMLElement[] =>
  Array.from(document.querySelectorAll(`[data-testid^="control-${KEY}-pill-"]`));
const input = (): HTMLElement => screen.getByTestId(`control-${KEY}`);

describe('loading an existing stack (FR-038b)', () => {
  it('shows each family as a pill, IN THE ORDER the stack declares them', () => {
    // The order is the whole point of a font stack — it is the fallback chain. A control that showed
    // the right three families in the wrong order would look correct and mean something else.
    mount("'Segoe UI', system-ui, sans-serif");
    expect(pills()).toHaveLength(3);
    expect(pill(0)).toHaveTextContent('Segoe UI');
    expect(pill(1)).toHaveTextContent('system-ui');
    expect(pill(2)).toHaveTextContent('sans-serif');
  });

  it('strips the quotes a CSS stack needs and the pill does not', () => {
    mount("'Segoe UI', system-ui");
    expect(pill(0).textContent).not.toContain("'");
  });

  it('shows no pills at all for a role that pins no family', () => {
    // `paneTitle` pins nothing in the shipped theme, and the control still has to render — that was
    // the defect (T106): the font control appeared only for roles that already had a value.
    mount(undefined);
    expect(pills()).toHaveLength(0);
    expect(input()).toBeVisible();
  });
});

describe('building a stack', () => {
  it('appends a picked family rather than replacing what is there', async () => {
    const { user } = mount('');
    await user.click(input());
    await user.type(input(), 'Arial');
    await user.click(screen.getByTestId(`control-${KEY}-option-Arial`));
    expect(pill(0)).toHaveTextContent('Arial');

    await user.clear(input());
    await user.type(input(), 'Georgia');
    await user.click(screen.getByTestId(`control-${KEY}-option-Georgia`));
    expect(pill(1)).toHaveTextContent('Georgia');
    expect(pills()).toHaveLength(2);
  });

  it('commits the pills as a comma-separated stack', async () => {
    const { user, onCommit } = mount('');
    await user.click(input());
    await user.type(input(), 'Arial');
    await user.click(screen.getByTestId(`control-${KEY}-option-Arial`));
    await user.clear(input());
    await user.type(input(), 'Georgia');
    await user.click(screen.getByTestId(`control-${KEY}-option-Georgia`));

    expect(onCommit).toHaveBeenLastCalledWith('Arial, Georgia');
  });

  it('filters the dropdown to what was typed', async () => {
    const { user } = mount('');
    await user.click(input());
    await user.type(input(), 'Geor');
    expect(screen.getByTestId(`control-${KEY}-option-Georgia`)).toBeVisible();
    expect(screen.queryByTestId(`control-${KEY}-option-Arial`)).toBeNull();
  });
});

describe('removing a family', () => {
  it('drops that pill and re-serialises the REST, keeping their order', async () => {
    const { user, onCommit } = mount('Arial, Georgia, system-ui');
    await user.click(screen.getByTestId(`control-${KEY}-remove-0`));

    expect(onCommit).toHaveBeenLastCalledWith('Georgia, system-ui');
    expect(pills()).toHaveLength(2);
    expect(pill(0)).toHaveTextContent('Georgia');
  });

  it('commits an empty stack when the last family goes', async () => {
    const { user, onCommit } = mount('Arial');
    await user.click(screen.getByTestId(`control-${KEY}-remove-0`));
    expect(onCommit).toHaveBeenLastCalledWith('');
    expect(pills()).toHaveLength(0);
  });
});
