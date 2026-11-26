/**
 * Opening the guide (080 FR-009, FR-011, FR-048).
 *
 * Every Help route — the cog menu's Help item, F1, every (?) — ends here. The URL comes from `@throng/core`'s
 * help-urls (never written out by hand) under the shipped guide's root, and goes to main, which shows it in the one
 * Help window. It never opens a preview panel (FR-011): a help page is not a document in the project.
 */
import { HELP_APP_BASE_URL } from '@throng/core';

/** Shows `url` in the Help window. A window with no `openHelp` does nothing. */
export function openHelp(url: string): void {
  window.throng?.openHelp?.(url);
}

/** The guide's root for Help: the guide shipped with the app (FR-049). */
export function effectiveHelpBase(): string {
  return HELP_APP_BASE_URL;
}
