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
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Change `TOKENS` to a colour key no theme declares. The registry tests fail on the missing
 * descriptor and the form tests fail on the missing row; none of them passes on an absence.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTRAST_PAIRINGS, THEME_METADATA, THRONG_THEME } from '@throng/core';
import { ThemesTab } from '../../src/renderer/preferences/themes-tab.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';

/** 009's two gutter tokens, by the colour keys a theme document writes. */
const TOKENS = ['editorGutterBg', 'editorGutterFg'] as const;

const EDITOR_CSS = resolve(process.cwd(), 'packages/ui/src/renderer/editor/editor.css');

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

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'throng');
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Declared — the registry still carries both, with their copy
 * ────────────────────────────────────────────────────────────────────────── */

describe('the gutter tokens are still declared (FR-045)', () => {
  it('keeps a descriptor for each, with a label and a description', () => {
    for (const token of TOKENS) {
      const descriptor = THEME_METADATA.find((d) => d.key === `colours.${token}`);
      expect(descriptor, `no theme descriptor for colours.${token}`).toBeDefined();
      expect(descriptor?.label.length, token).toBeGreaterThan(0);
      expect(descriptor?.description.length, token).toBeGreaterThan(0);
    }
  });

  it('keeps a shipped value for each in the default theme', () => {
    for (const token of TOKENS) {
      expect(THRONG_THEME.colours[token], token).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('keeps measuring the gutter contrast pair', () => {
    /*
     * 009's promise that the line numbers are READABLE on every bundled theme is enforced by this
     * pairing and by nothing else. A setting that can hide the gutter is the obvious excuse to stop
     * measuring it — and the moment it is turned back on, an unmeasured theme is one nobody checked.
     */
    const pair = CONTRAST_PAIRINGS.find(
      (p) => p.fg === 'editorGutterFg' && p.bg === 'editorGutterBg',
    );
    expect(pair, 'the gutter pairing was dropped from the theme quality audit').toBeDefined();
  });
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

/* ────────────────────────────────────────────────────────────────────────── *
 * Consumed — the stylesheet rule that repaints the gutter still reads them
 * ────────────────────────────────────────────────────────────────────────── */

describe('the stylesheet still paints the gutter from those tokens (FR-045)', () => {
  it('declares .cm-gutters against both custom properties', () => {
    /*
     * Read as TEXT rather than through `getComputedStyle`, because jsdom does not substitute
     * `var()`: the claim here is that the RULE still names the tokens, which is what makes turning
     * the gutter back on restore the user's colours rather than the built-in fallbacks.
     */
    expect(existsSync(EDITOR_CSS), `editor.css was not found at ${EDITOR_CSS}`).toBe(true);
    const css = readFileSync(EDITOR_CSS, 'utf8');
    const rule = /\.editor-panel \.cm-gutters\s*\{[^}]*\}/.exec(css)?.[0];
    expect(rule, 'the .cm-gutters rule is gone from editor.css').toBeDefined();
    expect(rule).toContain('--throng-colour-editorGutterBg');
    expect(rule).toContain('--throng-colour-editorGutterFg');
  });
});
