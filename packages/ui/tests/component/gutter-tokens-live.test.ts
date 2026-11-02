/**
 * Hiding the gutter does not make 009's gutter tokens inert (040 US4 — FR-045).
 *
 * ══ THE REQUIREMENT, AND THE FAILURE IT IS AIMED AT ══
 *
 * 009 FR-010 – FR-014 gave the gutter its own themeable background and foreground. 040 gives the
 * user a switch that makes the gutter go away. The tempting simplification, once that switch exists,
 * is to treat the tokens as dead weight — drop them from the registry, or gate their row on the
 * setting so the Themes editor "does not show controls for something you cannot see". Either would
 * be a regression that no gutter test could catch, because with the gutter hidden there is nothing
 * to look at: the damage only surfaces when the user turns it back on and finds their theme edits
 * gone, or discovers a theme they cannot finish authoring because the rows come and go.
 *
 * ══ WHY THIS IS NOT AN ASSERTION ON `.cm-gutters` ══
 *
 * With the gutter hidden that element does not exist, and the house helper style
 * (`getComputedStyle(document.querySelector(s)!)`) throws a `TypeError` on it rather than failing
 * cleanly. Worse, jsdom does not substitute `var()` at all, so a colour read here would answer with
 * the literal `var(--throng-colour-editorGutterBg, #151a23)` whatever the theme said. So the claims
 * below are about the three places a token can be made inert — the registry, the form, and the
 * stylesheet rule that consumes it — none of which needs the gutter to be on screen.
 *
 * The registry and stylesheet halves (declared, consumed) read no rendered DOM and live in
 * `unit/gutter-tokens-declared.test.ts`; this file keeps the half that renders the Themes tab.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Change `TOKENS` to a colour key no theme declares. The registry tests fail on the missing
 * descriptor and the form tests fail on the missing row; none of them passes on an absence.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemesTab } from '../../src/renderer/preferences/themes-tab.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';

/** 009's two gutter tokens, by the colour keys a theme document writes. */
const TOKENS = ['editorGutterBg', 'editorGutterFg'] as const;

/**
 * The Themes tab in a window whose settings have the gutter OFF.
 *
 * A real `ConfigProvider` over a bridge that answers `config.get` with `editor.showGutter: false`,
 * so the tab renders in exactly the state FR-045 is about rather than in the shipped one. The
 * provider fills every other key from the shipped defaults, so nothing else moves.
 */
function mountWithGutterHidden(): void {
  Reflect.set(window, 'throng', {
    config: {
      get: () => Promise.resolve({ settings: { editor: { showGutter: false } } }),
      onChange: () => () => {},
      write: () => Promise.resolve({ ok: true }),
    },
  });
  render(
    createElement(
      NotificationProvider,
      null,
      createElement(
        ConfigProvider,
        null,
        createElement(ConfirmProvider, null, createElement(ThemesTab)),
      ),
    ),
  );
}

beforeEach(() => {
  // 056 FR-016 folds sections by default; these cases read rows, so open the sections (research R10).
  window.history.replaceState(null, '', '/?foldDefault=open');
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'throng');
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Editable — the Themes editor still offers a live control for each
 * ────────────────────────────────────────────────────────────────────────── */

describe('the gutter tokens are still editable with the gutter hidden (FR-045)', () => {
  it('renders a row and an enabled control for each in the Themes editor', async () => {
    mountWithGutterHidden();
    // The provider's payload arrives on a microtask; waiting for the first row is what proves the
    // tab rendered under the gutter-off settings rather than before them.
    await waitFor(() => expect(screen.getByTestId('theme-row-colours.editorGutterBg')).toBeVisible());

    for (const token of TOKENS) {
      expect(screen.getByTestId(`theme-row-colours.${token}`), token).toBeVisible();
      const control = screen.getByTestId(`control-colours.${token}`) as HTMLInputElement;
      expect(
        control.disabled,
        `colours.${token} must stay editable — a control the user cannot reach is an inert token`,
      ).toBe(false);
    }
  });
});
