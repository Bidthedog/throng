/**
 * 074 FR-079 and Constitution 5.5.0 ("one gesture follows a link") for an HTML page's `#fragment` links.
 *
 * The sanitiser hands every other link to the follow route, where a plain click lands on a 204 and Ctrl+click reaches
 * main's window-open guard. A `#fragment` link stays a same-document jump the frame would take on a PLAIN click, and a
 * Ctrl+click asks for `about:srcdoc#…` in a new window, which the guard refuses — so the gesture did nothing and the
 * plain click moved the page. Here, in the frame's own (same-origin) document: a plain click on one moves nothing, and
 * Ctrl+click or Ctrl+Enter (Cmd on macOS) scrolls the page to its target.
 */
import { logExpected } from '@throng/core';
import { primaryModifierHeld } from '../../../config/host-modifiers.js';

/** The `#fragment` link an event landed on, or `null`. */
function fragmentLinkOf(target: EventTarget | null): HTMLAnchorElement | HTMLAreaElement | null {
  const el = target as Element | null;
  if (el === null || typeof el.closest !== 'function') return null;
  const link = el.closest('a[href], area[href]');
  if (link === null) return null;
  return (link.getAttribute('href') ?? '').trim().startsWith('#') ? (link as HTMLAnchorElement | HTMLAreaElement) : null;
}

/** The element a fragment names: an id first, then a named anchor; the top of the page for `#` and `#top`. */
function scrollToFragment(doc: Document, href: string): void {
  let name = href.trim().slice(1);
  try {
    name = decodeURIComponent(name);
  } catch (error) {
    logExpected('frame-fragments: decode a fragment', 'a page may carry a malformed percent escape; it names its own text', error);
  }
  const target = name === '' ? null : (doc.getElementById(name) ?? doc.getElementsByName(name)[0] ?? null);
  if (target !== null) {
    target.scrollIntoView({ block: 'start' });
    return;
  }
  if (name === '' || name.toLowerCase() === 'top') doc.defaultView?.scrollTo(0, 0);
}

/** Listen in the frame's current document; the returned function removes the listeners. */
export function listenToFrameFragments(doc: Document): () => void {
  const onClick = (e: MouseEvent): void => {
    const link = fragmentLinkOf(e.target);
    if (link === null) return;
    e.preventDefault();
    if (primaryModifierHeld(e)) scrollToFragment(doc, link.getAttribute('href') ?? '');
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter') return;
    const link = fragmentLinkOf(e.target);
    if (link === null) return;
    e.preventDefault();
    if (primaryModifierHeld(e)) scrollToFragment(doc, link.getAttribute('href') ?? '');
  };
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('keydown', onKeyDown, true);
  return () => {
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('keydown', onKeyDown, true);
  };
}
