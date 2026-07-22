import { useEffect, type ReactElement, type ReactNode } from 'react';
import { THRONG_THEME, toCssVariables, themeColorScheme, type Theme } from '@throng/core';
import { useConfigLoaded } from '../config/config-store.js';
import './tokens.css';

/**
 * Applies the active theme's tokens as CSS custom properties on the document root
 * (FR-030). Components consume `var(--throng-*)`, and the theme re-applies on every
 * change (hot-reload).
 *
 * The preload has already painted the SAVED theme onto `<html>` before this
 * renderer's first frame (issue 132). Until the config has loaded, `theme` is still
 * the bundled default, so applying it here would overwrite that correct paint with
 * the default theme and flash — visibly so on a custom saved theme. So the effect
 * waits for the config to load before it touches the document; the preload's paint
 * carries the first frames, and once the real theme is known this applies it (a
 * visual no-op when it matches what the preload painted).
 */
export function ThemeProvider({
  theme = THRONG_THEME,
  children,
}: {
  theme?: Theme;
  children: ReactNode;
}): ReactElement {
  const loaded = useConfigLoaded();
  useEffect(() => {
    if (!loaded) return;
    const root = document.documentElement;
    const vars = toCssVariables(theme);

    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
    }

    // Which theme is actually on screen — readable from CSS (`:root[data-theme="Matrix"]`), from the
    // devtools, and from a test that needs to know the switch has LANDED rather than guess at when.
    root.dataset.theme = theme.name;

    // The document's colour-scheme follows the theme's lightness (issue 132). The preload already set
    // this inline before first paint from the same derivation; re-affirming it here keeps a live theme
    // switch (dark → light hot-reload) in step, so Chromium's canvas backdrop and native controls track
    // the new theme instead of staying dark. Setting `root.style.colorScheme` (inline) overrides the
    // stylesheet's fallback.
    root.style.colorScheme = themeColorScheme(theme);

    /*
     * 018 — REMOVE the properties this theme no longer emits.
     *
     * The provider only ever ADDED, and for a theme whose token set never shrank that was fine. It
     * stopped being fine the moment tokens became OPTIONAL: an unset `iconColour` means "emit
     * nothing, so the glyph inherits its host's colour", and an unset `menuItemHoverSurface` means
     * "emit nothing, so the highlight follows the active project".
     *
     * Without this, CLEARING one of them did nothing at all: the property was omitted from the new
     * map, so the loop above simply skipped it — and the value the user had just deleted stayed
     * written on the root element, painting away. Setting a colour worked; unsetting it silently
     * did not, which is the worst shape a bug can take.
     */
    for (const name of Array.from(root.style)) {
      if (name.startsWith('--throng-') && !(name in vars)) root.style.removeProperty(name);
    }
  }, [theme, loaded]);
  return <>{children}</>;
}
