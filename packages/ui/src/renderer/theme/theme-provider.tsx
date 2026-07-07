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
  }, [theme]);
  return <>{children}</>;
}
