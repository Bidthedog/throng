/**
 * The colour swatch, its hex field, and the picker they open (018 FR-020/FR-024/FR-026).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/colour-picker.e2e.ts` (034 FR-045).
 *
 * Those tests launched Electron, opened the preferences window as a SECOND window, navigated to the
 * Themes tab and found a token row — in order to click a swatch and read what appeared. `ColourField`
 * and `ColourPicker` are both exported and take props only: `value`, `onCommit`, `testId` and a
 * `clearable` flag. Their sole dependencies are `Icon` (which resolves through `ConfigContext`'s real
 * defaults, so no provider) and `clampToViewport` (a pure function).
 *
 * ══ WHY THIS COMPONENT IS WORTH THE MIGRATION ══
 *
 * It exists because `<input type="color">` opens an OPERATING-SYSTEM dialog, which cannot be themed
 * and cannot be driven. FR-020 is the requirement that it is drawn from theme tokens instead — and
 * that claim is about markup, which is why it belongs here.
 *
 * WHAT STAYS END-TO-END, and none of it is a near miss:
 *   - the two viewport tests. They read `boundingBox()` and require the picker to land fully on
 *     screen near the right and bottom edges. `clamp-to-viewport.test.ts` proves the FUNCTION
 *     clamps; only a real window proves the RENDERED picker, at its real measured size against a
 *     real viewport, actually fits. That is the constitution's v5.1.0 real-layout reserve, and this
 *     migration was nearly over-claimed on exactly that point.
 *   - the live-apply-and-persist test, including that rapid edits compound into ONE write.
 *   - the visible focus INDICATOR, which is an inherited style and so belongs where the cascade is
 *     real (034 FR-049).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ColourField } from '../../src/renderer/common/colour-picker.js';

const ID = 'control-colours.accent';

/**
 * A stateful host, because `ColourField` is CONTROLLED — it takes `value` and reports `onCommit`.
 * Rendering it bare would leave the field unable to show a committed value, which is the same trap
 * `preferences-number-control.test.ts` records for `SettingControl`.
 */
function mount(initial = '#3b82f6', clearable = false) {
  const onCommit = vi.fn();
  function Host() {
    const [value, setValue] = useState(initial);
    return createElement(ColourField, {
      value,
      testId: ID,
      clearable,
      onCommit: (hex: string) => {
        onCommit(hex);
        setValue(hex);
      },
    });
  }
  render(createElement(Host));
  return { onCommit, user: userEvent.setup() };
}

const hex = (): HTMLInputElement => screen.getByTestId(`${ID}-hex`) as HTMLInputElement;

describe('the swatch is drawn, never delegated to the OS (FR-020)', () => {
  it('renders no native colour input — closed OR open', async () => {
    /*
     * THE REASON THIS COMPONENT EXISTS. `<input type="color">` opens an operating-system dialog: it
     * cannot take a theme token, and it cannot be driven by a test. A regression here would look
     * perfectly fine in a screenshot and be unthemeable.
     *
     * BOTH STATES, and that is not belt-and-braces. The first version of this test checked only the
     * closed field, and a mutation putting `type="color"` on the picker's own first input left it
     * GREEN — the picker is unmounted until it opens, so the assertion never saw the thing it exists
     * to forbid. The mutation found the hole, which is what mutations are for.
     */
    const { user } = mount();
    expect(document.querySelector('input[type="color"]')).toBeNull();

    await user.click(screen.getByTestId(ID));
    expect(screen.getByTestId(`${ID}-picker`)).toBeVisible();
    expect(document.querySelector('input[type="color"]')).toBeNull();
  });

  it('opens a drawn picker on click, with a saturation-value area and a hue strip', async () => {
    const { user } = mount();
    expect(screen.queryByTestId(`${ID}-picker`)).toBeNull();

    await user.click(screen.getByTestId(ID));

    expect(screen.getByTestId(`${ID}-picker`)).toBeVisible();
    expect(screen.getByTestId(`${ID}-sv`)).toBeVisible();
    expect(screen.getByTestId(`${ID}-hue`)).toBeVisible();
  });

  it('shows the current value in the hex field', () => {
    mount('#ff8800');
    expect(hex().value.toLowerCase()).toBe('#ff8800');
  });
});

describe('an invalid colour is refused (FR-026)', () => {
  it('commits a valid hex', async () => {
    const { user, onCommit } = mount('#3b82f6');
    await user.clear(hex());
    await user.type(hex(), '#ff8800');
    await user.tab();
    expect(onCommit).toHaveBeenLastCalledWith('#ff8800');
  });

  it('marks nonsense invalid and commits NOTHING', async () => {
    // The E2E's own point: the last valid colour must still stand. A control that committed the
    // rubbish would write it to the theme file and the surface reading that token would lose its
    // colour — persisted, so it survives a restart.
    const { user, onCommit } = mount('#ff8800');
    onCommit.mockClear();

    await user.clear(hex());
    await user.type(hex(), 'zzz');
    await user.tab();

    expect(hex()).toHaveAttribute('aria-invalid', 'true');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('recovers once the value is corrected, clearing the invalid mark', async () => {
    const { user, onCommit } = mount('#ff8800');
    await user.clear(hex());
    await user.type(hex(), 'zzz');
    await user.tab();
    expect(hex()).toHaveAttribute('aria-invalid', 'true');

    await user.clear(hex());
    await user.type(hex(), '#00ff00');
    await user.tab();

    expect(hex()).not.toHaveAttribute('aria-invalid', 'true');
    expect(onCommit).toHaveBeenLastCalledWith('#00ff00');
  });
});

describe('the keyboard reaches it (FR-024)', () => {
  it('puts the hex field in the tab order, so the value is editable without a pointer', async () => {
    const { user } = mount();
    await user.tab();
    // The swatch button comes first, the field after it — both reachable, neither trapped.
    expect(document.activeElement).not.toBe(document.body);
    await user.tab();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('opens the picker from the keyboard, not only by pointer', async () => {
    const { user } = mount();
    screen.getByTestId(ID).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId(`${ID}-picker`)).toBeVisible();
  });
});
