import type { ReactElement } from 'react';
import { logExpected } from '@throng/core';
import { openHelp } from '../help/help-opener.js';
import { IconButton } from './icon-button.js';

/**
 * A (?) that opens one section of the guide or reference in the OS browser, never in a throng surface
 * (080 FR-011, FR-014, FR-017, FR-028).
 *
 * The shared themeable icon control, so it wears the active icon set's `help` glyph, takes its colours from the
 * theme, is a real button (a Tab stop, activated by Enter and Space) and carries a hover title that the window's
 * title tooltip draws in the one popup style. The title names where it goes — "Help: {label}" — and is also the
 * accessible name; the icon itself is decorative.
 *
 * The URL is built by the caller from `@throng/core` (`settingHelpUrl`, `keyBindingHelpUrl`, `themeTokenHelpUrl`
 * or `helpUrl`) and the effective base, never written out here (FR-009). A target those builders do not know — a row
 * from a registry other than the shipped one — has no section to open, so {@link helpUrlOrNone} hands back nothing and
 * no (?) is drawn.
 */
export function HelpLink({
  url,
  label,
  testId,
  className = 'icon-button settings-row__help',
}: {
  /** Where the (?) goes: a complete guide URL, built by the caller; none draws no (?). */
  url: string | undefined;
  /** What the (?) is about, as the surface labels it. */
  label: string;
  testId: string;
  className?: string;
}): ReactElement | null {
  if (url === undefined) return null;
  // `help-link` draws every (?) at one small size, whatever button class the surface lends it (theme.css).
  return <IconButton token="help" title={`Help: ${label}`} className={`${className} help-link`} testId={testId} onClick={() => openHelp(url)} />;
}

/** A help URL, or undefined when its builder does not know the target (it throws for an unknown id). */
export function helpUrlOrNone(build: () => string): string | undefined {
  try {
    return build();
  } catch (error) {
    logExpected('help-link: build URL', 'a row from a registry other than the shipped one has no reference section, so it draws no (?)', error);
    return undefined;
  }
}
