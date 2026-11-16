/**
 * The one component that draws an icon (017 / #54, FR-002/FR-006b/FR-006c).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/icon-packs.e2e.ts` (034 FR-045): "icons are DECORATIVE to
 * assistive technology".
 *
 * That test launched Electron, created a project, then swept the whole running window for `.icon`
 * and asserted every one carried `aria-hidden="true"`. A sweep of a real DOM is the only way to make
 * an app-wide claim — unless the claim reduces, and this one does, into two halves that are each
 * cheaper AND stronger than the sweep:
 *
 *   1. `<Icon>` marks what it draws as decorative. That is this file, and it is asserted on BOTH
 *      branches — a bundled SVG pack and a theme glyph — because they are two different returns and
 *      the sweep could only ever see whichever the running theme happened to use.
 *   2. Nothing else in the renderer draws an icon. That is already a source guard,
 *      `packages/ui/tests/unit/icon-call-sites.test.ts`, which fails the build if any renderer module
 *      reaches for the deleted `resolveIcon` — and it is a stronger statement than a sweep, because
 *      a sweep only sees the icons that happened to be ON SCREEN in one window at one moment.
 *
 * The half that guard was making about decorativeness was a grep of this component's SOURCE for the
 * string `aria-hidden`, which would pass on a file that mentioned it in a comment. These tests
 * render.
 *
 * WHAT STAYS END-TO-END in `icon-sets.e2e.ts` (spec 069): that a reloaded user icon set re-skins the
 * MAIN window live with no restart, and that its art takes its colour from the theme rather than
 * rendering black, which needs real style resolution. Neither is about one component's markup.
 */
import { render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, DEFAULT_KEYBINDINGS, THRONG_THEME } from '@throng/core';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { Icon } from '../../src/renderer/common/icon.js';

/** Every `.icon` in the rendered tree — the same selector the E2E sweep used. */
const icons = (): HTMLElement[] => Array.from(document.querySelectorAll('.icon'));

describe('every icon is decorative (FR-006c / SC-010)', () => {
  it('hides the default svg from the accessibility tree', () => {
    /*
     * An icon is svg markup, always (069 FR-009) — there is no glyph branch, so no raw character
     * for a screen reader to read aloud. The name comes from the enclosing control.
     */
    render(createElement(Icon, { token: 'retry' }));
    expect(icons()).toHaveLength(1);
    expect(icons()[0]).toHaveAttribute('aria-hidden', 'true');
    expect(icons()[0].querySelector('svg')).not.toBeNull();
  });

  it('carries no accessible name of its own', () => {
    // The name comes from the ENCLOSING control, which the constitution already requires to carry a
    // hover title naming its action. An icon that named itself would be announced twice.
    render(createElement(Icon, { token: 'retry' }));
    expect(icons()[0]).not.toHaveAttribute('aria-label');
    expect(icons()[0]).not.toHaveAttribute('title');
  });

  it('hides a user override too, and draws it instead of the default art', async () => {
    /*
     * The override is a second return path from `resolveIcon`; the attribute is exactly what gets
     * forgotten on a second path. The set rides the config payload, as it does in the running app.
     */
    const override = '<svg data-test="override" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/></svg>';
    Reflect.set(window, 'throng', {
      config: {
        get: () =>
          Promise.resolve({
            settings: DEFAULT_APP_SETTINGS,
            theme: { ...THRONG_THEME, iconPack: 'mine' },
            keybindings: DEFAULT_KEYBINDINGS,
            iconSets: [{ name: 'mine', overrides: { retry: override }, failures: {}, unrecognised: [] }],
          }),
        onChange: () => () => undefined,
      },
    });
    render(createElement(ConfigProvider, null, createElement(Icon, { token: 'retry' }), createElement(Icon, { token: 'add' })));
    await waitFor(() => expect(document.querySelector('[data-test="override"]')).not.toBeNull());
    expect(icons()).toHaveLength(2);
    for (const el of icons()) expect(el).toHaveAttribute('aria-hidden', 'true');
    // A key the set does not override still draws the default art — the set holds only what it overrides.
    expect(icons()[1].querySelector('svg')).not.toBeNull();
    expect(icons()[1].querySelector('[data-test="override"]')).toBeNull();
  });

  it('keeps its class when the caller adds one, so the sweep’s selector still finds it', () => {
    // The E2E found every icon by `.icon`. A component that dropped the base class when given a
    // custom one would have made that sweep silently see fewer icons — and pass.
    render(createElement(Icon, { token: 'retry', className: 'panel-failure__glyph' }));
    expect(icons()).toHaveLength(1);
    expect(icons()[0].className).toContain('panel-failure__glyph');
  });
});
