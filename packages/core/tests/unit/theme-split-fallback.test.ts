import { describe, expect, it } from 'vitest';

import {
  DEFAULT_THEMES,
  THRONG_THEME,
  TOKEN_PARENT,
  resolveSplitColour,
  toCssVariables,
} from '../../src/index.js';
import type { Theme } from '../../src/index.js';

/**
 * 018 / FR-008 — a theme authored BEFORE the surface split must keep its appearance exactly.
 *
 * This is the single easiest thing in the feature to get quietly wrong, and the wrong way looks
 * right: express the fallback as a CSS `var(--throng-colour-menuSurface, var(--surface))` and it
 * reads perfectly. It is also dead. `toCssVariables()` merges every theme over THRONG_THEME before
 * emitting, so the custom property is ALWAYS defined and the CSS fallback can never fire — it
 * applies only in the instant before the provider mounts.
 *
 * The consequence, if you get it wrong: a user theme that sets `surface: #ff0000` and (being older
 * than the split) has no `menuSurface` renders its menus in THRONG's default blue-grey. The user's
 * red theme silently grows blue-grey menus. That is precisely what FR-008 forbids.
 *
 * There is already a dead precedent of this exact mistake in the tree — `--btn-bg` in theme.css has
 * carried an inert `var(--bg-panel)` fallback since feature 007.
 *
 * So the chain lives HERE, in the resolution layer, and these tests pin it.
 */

/** A theme authored before the split: it knows `surface` and `surfaceActive` and nothing newer. */
function preSplitTheme(colours: Record<string, string>): Theme {
  return { ...THRONG_THEME, name: 'pre-split', colours };
}

describe('the split-fallback chain (FR-008)', () => {
  it('resolves a carved-out token to THAT THEME’s parent, not to the built-in default', () => {
    const theme = preSplitTheme({ surface: '#ff0000', surfaceActive: '#00ff00', accent: '#0000ff' });

    // Carved out of `surface` — must inherit the theme's OWN red, never THRONG's #1b2230. 021 removed
    // `menuSurface`/`dialogSurface`, so `inputSurface`/`hoverSurface` are the remaining carve-outs.
    expect(resolveSplitColour(theme, 'inputSurface')).toBe('#ff0000');
    expect(resolveSplitColour(theme, 'hoverSurface')).toBe('#ff0000');
  });

  it('lets an explicit value win over the parent', () => {
    const theme = preSplitTheme({ surface: '#ff0000', inputSurface: '#123456' });
    expect(resolveSplitColour(theme, 'inputSurface')).toBe('#123456');
    expect(resolveSplitColour(theme, 'hoverSurface')).toBe('#ff0000');
  });

  it('falls through to the built-in default when neither the token nor its parent is set', () => {
    const theme = preSplitTheme({});
    expect(resolveSplitColour(theme, 'inputSurface')).toBe(THRONG_THEME.colours.inputSurface);
  });

  it('treats an EMPTY or null value as unset, not as a colour', () => {
    // The Themes editor puts this one keystroke away: select the hex field, press Delete. If '' were
    // treated as "set", the emitter would write `--throng-colour-inputSurface: ''`, which REMOVES the
    // custom property — and since the re-pointed rules carry no literal fallbacks, every field in the
    // application would render with no background at all. A null survives a hand-edited theme file too.
    const cleared = preSplitTheme({ surface: '#ff0000', inputSurface: '' });
    expect(resolveSplitColour(cleared, 'inputSurface')).toBe('#ff0000');

    const whitespace = preSplitTheme({ surface: '#ff0000', inputSurface: '   ' });
    expect(resolveSplitColour(whitespace, 'inputSurface')).toBe('#ff0000');

    const nulled = { ...preSplitTheme({ surface: '#ff0000' }) };
    (nulled.colours as Record<string, unknown>).inputSurface = null;
    expect(resolveSplitColour(nulled, 'inputSurface')).toBe('#ff0000');

    // And with no parent either, it must still land on a real colour rather than emitting nothing.
    const bare = preSplitTheme({ inputSurface: '' });
    expect(resolveSplitColour(bare, 'inputSurface')).toBe(THRONG_THEME.colours.inputSurface);
  });

  it('keeps every bundled theme visually identical after the split', () => {
    // The derivation in makeTheme() reads TOKEN_PARENT, so a bundled theme's carved-out roles must
    // equal their parents exactly. If they ever diverge, the split has restyled throng — which it is
    // explicitly not allowed to do.
    for (const [name, theme] of Object.entries(DEFAULT_THEMES)) {
      for (const [token, parent] of Object.entries(TOKEN_PARENT)) {
        expect(theme.colours[token], `${name}.${token} must equal its parent ${parent}`).toBe(
          theme.colours[parent],
        );
      }
    }
  });

  it('emits the resolved value as a CSS variable — not a CSS-level fallback', () => {
    const vars = toCssVariables(preSplitTheme({ surface: '#ff0000', accent: '#0000ff' }));

    // If the fallback had been written in CSS, these would carry THRONG's defaults and the user's
    // red theme would sprout blue-grey fields. The whole point of FR-008 is that they do not.
    expect(vars['--throng-colour-inputSurface']).toBe('#ff0000');
    expect(vars['--throng-colour-hoverSurface']).toBe('#ff0000');
  });

  it('names a parent for every carved-out token, and only for those', () => {
    // The map is the single statement of this knowledge — the resolver and makeTheme both read it,
    // so the two cannot drift. 021 removed `menuSurface`/`dialogSurface` (the menu/dialog cards were
    // consolidated back onto `surfaceActive`/`surface`), leaving the two field/hover carve-outs.
    expect(Object.keys(TOKEN_PARENT).sort()).toEqual(['hoverSurface', 'inputSurface']);
  });
});

describe('the optional menu highlight — Principle I, the project colour stays dominant', () => {
  it('emits NO custom property when unset, so the highlight follows the ACTIVE PROJECT’s colour', () => {
    // The CSS reads `var(--throng-colour-menuItemHoverSurface, var(--accent))`, and the projects
    // store overrides `--accent` at runtime with the open project's dominant colour. So emitting
    // nothing here is what lets the menu highlight track the project — which is what it did before
    // 018, and what Principle I requires ("the selected project's colour MUST be visually dominant").
    //
    // Pinning this token to the theme's accent was a real regression: switch to a project whose
    // colour is red and every menu highlight would have stubbornly stayed the theme's blue.
    expect(toCssVariables(THRONG_THEME)['--throng-colour-menuItemHoverSurface']).toBeUndefined();
    expect(THRONG_THEME.colours.menuItemHoverSurface).toBeUndefined();

    for (const [name, theme] of Object.entries(DEFAULT_THEMES)) {
      expect(
        theme.colours.menuItemHoverSurface,
        `${name} must leave the menu highlight unset so it follows the project`,
      ).toBeUndefined();
    }
  });

  it('emits the property when an author pins it, and then the theme wins', () => {
    const pinned = toCssVariables(preSplitTheme({ menuItemHoverSurface: '#ff00ff' }));
    expect(pinned['--throng-colour-menuItemHoverSurface']).toBe('#ff00ff');
  });
});

describe('the optional icon colour (FR-029)', () => {
  it('emits NO custom property when unset, so icons keep inheriting their host’s colour', () => {
    const vars = toCssVariables(THRONG_THEME);
    expect(vars['--throng-colour-iconColour']).toBeUndefined();
  });

  it('emits the property when a theme sets it', () => {
    const vars = toCssVariables(preSplitTheme({ iconColour: '#abcdef' }));
    expect(vars['--throng-colour-iconColour']).toBe('#abcdef');
  });

  it('is absent from the built-in theme — its ABSENCE is its meaning', () => {
    // Give it a default value and every bundled theme's icons repaint on the day it lands, which is
    // exactly what FR-029 promises will not happen.
    expect(THRONG_THEME.colours.iconColour).toBeUndefined();
  });
});
