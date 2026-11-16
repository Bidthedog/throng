import type { Locator, Page } from '@playwright/test';

/**
 * A control's `title`, as the app holds it (constitution v6.7.0, "One popup style"): on the element, or moved aside to
 * `data-throng-title` while the pointer rests on it, so the OS draws no tooltip of its own and the app draws one in
 * its shared popup style (`common/title-tooltips.tsx`). A spec that finds or reads a control by its title where the
 * pointer may be resting on it — after a click that moves the layout under the pointer, or while hovering on purpose
 * — reads it through these, or it reads an attribute that is momentarily somewhere else.
 */
export const MOVED_TITLE = 'data-throng-title';

/** `getByTitle` for either place the title can be: a case-insensitive substring match, as `getByTitle` is. */
export function byTitle(scope: Page | Locator, title: string): Locator {
  const quoted = JSON.stringify(title);
  return scope.locator(`[title*=${quoted} i], [${MOVED_TITLE}*=${quoted} i]`);
}

/** The title of the first element `locator` matches, wherever it is held now; '' when it has none. */
export function titleOf(locator: Locator): Promise<string> {
  return locator.first().evaluate((el, moved) => el.getAttribute('title') || el.getAttribute(moved) || '', MOVED_TITLE);
}
