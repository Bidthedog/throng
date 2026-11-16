/**
 * What a rendered icon looks like, for component tests that assert WHICH icon a control draws (069).
 *
 * An icon is svg markup resolved by `resolveIcon`; the DOM serialises it differently from the source
 * string, so both sides are compared after one round trip through an element.
 */
import { resolveIcon, THRONG_THEME, type IconKey } from '@throng/core';

/** The default set's markup for `key`, as the DOM reads it back. */
export function iconMarkup(key: IconKey): string {
  const host = document.createElement('div');
  host.innerHTML = resolveIcon(THRONG_THEME, [], key);
  return host.innerHTML;
}

/** The markup of the icon `el` is, or contains (the first `.icon`), as the DOM reads it back. */
export function drawnIcon(el: Element | null | undefined): string | undefined {
  if (!el) return undefined;
  const icon = el.matches('.icon') ? el : el.querySelector('.icon');
  return icon?.innerHTML;
}
