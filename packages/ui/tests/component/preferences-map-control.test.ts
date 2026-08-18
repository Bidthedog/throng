/**
 * 016 / 019 — a keyed map is edited as a TABLE (FR-022, FR-022c).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/preferences-map-control.e2e.ts` (034 FR-045).
 *
 * The defect this control exists to prevent is not a crash. A `map` descriptor with no case in the
 * control dispatch falls through to the DEFAULT arm and renders as a TEXT FIELD showing
 * `[object Object]` — a valid descriptor, a valid control, and nonsense on screen. Nothing throws,
 * nothing fails a type check, and only looking at it reveals the problem. Which is exactly the kind
 * of thing a DOM can look at.
 *
 * WHAT STAYED AN E2E: that a removal reaches `settings.json` as `{}` rather than falling back to the
 * shipped value. FR-022c is a claim about the config layer's empty-versus-absent handling — a map
 * that fell back whenever it was empty could never be cleared, so the user deleted the row, saved,
 * and watched it come straight back. `onCommit({})` is what this control owes; what happens to that
 * `{}` afterwards is the write path's business.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { FieldDescriptor } from '@throng/core';
import { MapControl, validateKey } from '../../src/renderer/preferences/map-control.js';

/** The extension map: keys must LOOK like extensions, which is the interesting validation. */
const byExtension: FieldDescriptor = {
  key: 'editor.languageByExtension',
  label: 'Language by extension',
  control: 'map',
  type: 'object',
} as FieldDescriptor;

/**
 * A parent that holds the value, because MapControl is controlled — the same lesson the numeric
 * control taught: added and removed rows only appear if something re-renders with the new map.
 */
function renderMap(descriptor: FieldDescriptor, initial: Record<string, unknown>) {
  const onCommit = vi.fn();
  function Host() {
    const [value, setValue] = useState<unknown>(initial);
    return createElement(MapControl, {
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

const id = (suffix: string): string => `${suffix}-${byExtension.key}`;

describe('a keyed map renders as a table (FR-022)', () => {
  it('renders its rows, not "[object Object]" in a text box', () => {
    renderMap(byExtension, { '.ts': 'typescript' });
    expect(screen.getByTestId(`control-${byExtension.key}`)).toBeVisible();
    expect(screen.getByTestId(`map-row-${byExtension.key}-.ts`)).toBeVisible();
    // The tell of the default-arm fallback, asserted directly rather than by its absence elsewhere.
    expect(screen.queryByDisplayValue('[object Object]')).toBeNull();
  });
});

describe('adding a row', () => {
  it('REFUSES a key that does not look like an extension, and says why', async () => {
    // "Invalid" with no reason is a dead end for a user who cannot see what the rule is.
    const { user, onCommit } = renderMap(byExtension, {});
    await user.type(screen.getByTestId(id('map-new-key')), 'foo');
    await user.click(screen.getByTestId(id('map-add')));
    expect(screen.getByTestId(id('map-error'))).toHaveTextContent(/dot/i);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('accepts a valid key and commits the new map', async () => {
    const { user, onCommit } = renderMap(byExtension, {});
    await user.type(screen.getByTestId(id('map-new-key')), '.foo');
    await user.click(screen.getByTestId(id('map-add')));
    expect(screen.getByTestId(`map-row-${byExtension.key}-.foo`)).toBeVisible();
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ '.foo': expect.anything() }));
  });

  it('REFUSES a duplicate key — two rows claiming one extension have no defined winner', async () => {
    const { user, onCommit } = renderMap(byExtension, { '.foo': 'typescript' });
    await user.type(screen.getByTestId(id('map-new-key')), '.foo');
    await user.click(screen.getByTestId(id('map-add')));
    expect(screen.getByTestId(id('map-error'))).toHaveTextContent(/already mapped/i);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('removing a row', () => {
  it('commits a map without the removed key, and stops rendering its row', async () => {
    const { user, onCommit } = renderMap(byExtension, { '.bar': 'typescript' });
    await user.click(screen.getByTestId(`map-remove-${byExtension.key}-.bar`));
    expect(onCommit).toHaveBeenCalledWith({});
    expect(screen.queryByTestId(`map-row-${byExtension.key}-.bar`)).toBeNull();
  });
});

describe('validateKey, directly (it is exported and pure)', () => {
  // The rules, without a render at all. Worth having beside the rendered cases: when one of these
  // fails and the rendered ones pass, the fault is in the control rather than in the rule.
  it('requires a key', () => {
    expect(validateKey('   ', [], byExtension)).toMatch(/required/i);
  });

  it('rejects a duplicate by name', () => {
    expect(validateKey('.foo', ['.foo'], byExtension)).toMatch(/already mapped/i);
  });

  it('requires an extension to start with a dot', () => {
    expect(validateKey('foo', [], byExtension)).toMatch(/dot/i);
    expect(validateKey('.foo', [], byExtension)).toBeNull();
  });
});
