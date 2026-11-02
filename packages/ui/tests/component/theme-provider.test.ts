import { render, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { THRONG_THEME, type Theme } from '@throng/core';
import { ThemeProvider } from '../../src/renderer/theme/theme-provider.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';

/**
 * What `ThemeProvider` writes onto the document (018; issue 132).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/theme-flash.e2e.ts:156` (035 T055) — `test('the default (dark)
 * throng theme keeps color-scheme dark — the fix does not over-correct (issue 132)')`.
 *
 * ══ THE DERIVATION IS PROVEN; WRITING IT DOWN WAS NOT ══
 *
 * `themeColorScheme` is pure and is covered in `core/tests/unit/theme.test.ts`. `ThemeProvider` is
 * the renderer's side — it writes the CSS variables, the `data-theme` attribute and the inline
 * `color-scheme` onto `<html>` — and it had no test at any layer.
 *
 * The E2E read `getComputedStyle(document.documentElement).colorScheme`. This reads
 * `root.style.colorScheme`, which is STRICTER rather than weaker: the value is set inline precisely
 * so it overrides the stylesheet's fallback (`theme-provider.tsx:45`), and a computed read cannot
 * tell an inline write from a stylesheet that happened to agree. Issue 132 is the two disagreeing.
 *
 * ══ WHAT IS NOT HERE ══
 *
 * The FLASH. `theme-flash.e2e.ts` exists because a window can paint before the renderer runs at all,
 * and its remaining tests assert the preload's pre-paint write and the native `BrowserWindow`
 * backgroundColor. Neither is reachable from a component, and that file keeps both.
 */

/** A light theme, for the half that says the answer is DERIVED rather than hard-coded. */
const LIGHT: Theme = {
  ...THRONG_THEME,
  name: 'Daylight',
  colours: { ...THRONG_THEME.colours, appBg: '#ffffff', editorBg: '#fdfdfd' },
};

const root = (): HTMLElement => document.documentElement;

const tree = (theme?: Theme): ReactElement =>
  createElement(
    ConfigProvider,
    null,
    createElement(ThemeProvider, { theme, children: createElement('div', null, 'x') }),
  );

beforeEach(() => {
  // `ConfigProvider` pulls its payload through the bridge; without one it stays unloaded and the
  // provider's effect — which is the whole subject here — never runs.
  Reflect.set(window, 'throng', {
    config: {
      get: () => Promise.resolve({ settings: {}, theme: THRONG_THEME }),
      onChange: () => () => {},
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
  // The provider writes to the REAL document, which outlives a render. Left behind, one test's
  // theme decides the next one's answer.
  root().removeAttribute('style');
  root().removeAttribute('data-theme');
});

describe('the provider names the theme that is actually on screen', () => {
  // Stamping data-theme with the theme's name at mount is the first assertion of the test below.
  it('follows a theme SWITCH rather than stamping once at mount', async () => {
    // A live hot-reload is the case the attribute exists for: it is how a test, the devtools and
    // `:root[data-theme="…"]` all learn the switch has LANDED rather than guessing at when.
    const { rerender } = render(tree());
    await waitFor(() => expect(root().dataset.theme).toBe(THRONG_THEME.name));

    rerender(tree(LIGHT));

    await waitFor(() => expect(root().dataset.theme).toBe('Daylight'));
  });
});

describe('color-scheme follows the theme’s lightness (issue 132)', () => {
  it('follows a switch from the default (dark) theme to a light one, which is what a hot-reload does', async () => {
    /*
     * Issue 132 was a LIGHT theme leaving the document reporting `dark`; forcing `light` unconditionally
     * would break the default, so both ends are asserted: the default is DARK, and the light theme derives
     * LIGHT (a provider that hard-coded either would fail one of them). `style.colorScheme` is the INLINE
     * property, which is what overrides the stylesheet's fallback.
     */
    const { rerender } = render(tree());
    await waitFor(() => expect(root().style.colorScheme).toBe('dark'));

    rerender(tree(LIGHT));

    await waitFor(() => expect(root().style.colorScheme).toBe('light'));
  });
});

describe('the theme’s tokens reach the document', () => {
  // Writing the custom properties the theme emits is the first assertion of the removal test below.
  it('REMOVES a property the new theme no longer emits (018)', async () => {
    /*
     * The provider only ever ADDED until 018, and that was fine while token sets never shrank. It
     * stopped being fine when tokens became optional: an unset `iconColour` means "emit nothing, so
     * the glyph inherits its host's colour". Without the removal pass, CLEARING one did nothing —
     * the property was simply skipped and the deleted value stayed on the root, painting away.
     * Setting a colour worked and unsetting it silently did not, which is the worst shape a bug
     * takes.
     */
    const withIcon: Theme = {
      ...THRONG_THEME,
      colours: { ...THRONG_THEME.colours, iconColour: '#abcdef', menuItemHoverSurface: '#00ff00' },
    };
    const { rerender } = render(tree(withIcon));
    await waitFor(() =>
      expect(root().style.getPropertyValue('--throng-colour-iconColour').trim()).toBe('#abcdef'),
    );
    expect(root().style.getPropertyValue('--throng-colour-menuItemHoverSurface').trim()).toBe('#00ff00');

    // Migrated from theme-sweep.e2e.ts (SC-004): BOTH optional tokens go when the next theme omits them.
    const withoutIcon: Theme = {
      ...THRONG_THEME,
      colours: {
        ...THRONG_THEME.colours,
        iconColour: undefined,
        menuItemHoverSurface: undefined,
      },
    };
    rerender(tree(withoutIcon));

    await waitFor(() =>
      expect(root().style.getPropertyValue('--throng-colour-iconColour').trim()).toBe(''),
    );
    expect(
      root().style.getPropertyValue('--throng-colour-menuItemHoverSurface').trim(),
      'the previous theme’s menu hover is stuck',
    ).toBe('');
  });
});
