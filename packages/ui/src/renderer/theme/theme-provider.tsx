import { useEffect, type ReactElement, type ReactNode } from 'react';
import { THRONG_THEME, toCssVariables, type Theme } from '@throng/core';
import './tokens.css';

/**
 * Applies the active theme's tokens as CSS custom properties on the document root
 * (FR-030). This first iteration applies the built-in "throng" theme; the
 * config-store + hot-reload wiring (T033–T039) will later feed the user's selected
 * theme and re-apply on change. Components consume `var(--throng-*)`.
 */
export function ThemeProvider({
  theme = THRONG_THEME,
  children,
}: {
  theme?: Theme;
  children: ReactNode;
}): ReactElement {
  useEffect(() => {
    const root = document.documentElement;
    const vars = toCssVariables(theme);

    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
    }

    // Which theme is actually on screen — readable from CSS (`:root[data-theme="Matrix"]`), from the
    // devtools, and from a test that needs to know the switch has LANDED rather than guess at when.
    root.dataset.theme = theme.name;

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
  }, [theme]);
  return <>{children}</>;
}
