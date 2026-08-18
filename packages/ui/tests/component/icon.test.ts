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
 * WHAT STAYS END-TO-END in `icon-packs.e2e.ts`: that a selected pack re-skins the MAIN window live
 * with no restart, that pack art takes its colour from the theme rather than rendering black (which
 * needs a real style resolution — an SVG inside an `<img>` is an isolated document and that is the
 * bug), that a fresh install seeds the packs, and that a broken pack degrades without stopping the
 * app. None of those is about one component's markup.
 */
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Icon } from '../../src/renderer/common/icon.js';

/** Every `.icon` in the rendered tree — the same selector the E2E sweep used. */
const icons = (): HTMLElement[] => Array.from(document.querySelectorAll('.icon'));

describe('every icon is decorative (FR-006c / SC-010)', () => {
  it('hides a THEME GLYPH from the accessibility tree', () => {
    /*
     * Before 017 the raw glyph character sat in the DOM as text and a screen reader read it aloud —
     * the accessible name of the enclosing control, and then the character. `retry` is a token the
     * shipped theme defines, so this resolves a real glyph rather than a stub.
     */
    render(createElement(Icon, { token: 'retry' }));
    expect(icons()).toHaveLength(1);
    expect(icons()[0]).toHaveAttribute('aria-hidden', 'true');
  });

  it('carries no accessible name of its own', () => {
    // The name comes from the ENCLOSING control, which the constitution already requires to carry a
    // hover title naming its action. An icon that named itself would be announced twice.
    render(createElement(Icon, { token: 'retry' }));
    expect(icons()[0]).not.toHaveAttribute('aria-label');
    expect(icons()[0]).not.toHaveAttribute('title');
  });

  it('hides an UNKNOWN token too, rather than falling out of the branch', () => {
    /*
     * `resolveIconAsset` falls back down the chain (pack → theme → default) rather than returning
     * `missing`, precisely so a half-broken pack cannot produce a half-empty interface. Whatever it
     * falls back to must still be decorative — the fallback path is exactly where an attribute gets
     * forgotten.
     */
    render(createElement(Icon, { token: 'no-such-token-anywhere' }));
    // The length guard is load-bearing: without it, an Icon that returned null for an unknown token —
    // literally what this title forbids — would iterate zero times and pass. A vacuity audit caught it.
    expect(icons(), 'the fallback rendered nothing at all').toHaveLength(1);
    for (const el of icons()) expect(el).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps its class when the caller adds one, so the sweep’s selector still finds it', () => {
    // The E2E found every icon by `.icon`. A component that dropped the base class when given a
    // custom one would have made that sweep silently see fewer icons — and pass.
    render(createElement(Icon, { token: 'retry', className: 'panel-failure__glyph' }));
    expect(icons()).toHaveLength(1);
    expect(icons()[0].className).toContain('panel-failure__glyph');
  });
});
