/**
 * 074 FR-079 and Constitution 5.5.0 ("one gesture follows a link") for an HTML page's `#fragment` links.
 *
 * The sanitiser hands every other link to the follow route, where a plain click lands on a 204 and Ctrl+click reaches
 * main's window-open guard. A `#fragment` link stays a same-document jump the frame would take on a PLAIN click, and a
 * Ctrl+click asks for `about:srcdoc#…` in a new window, which the guard refuses — so the gesture did nothing and the
 * plain click moved the page. Here, in the frame's own (same-origin) document: a plain click on one moves nothing, and
 * Ctrl+click or Ctrl+Enter (Cmd on macOS) scrolls the page to its target.
 *
 * Also the menu over a link (T075): a right-click on any link in the page opens the panel's link menu — Open Link and
 * Copy Link to Clipboard — as a right-click on a link does in every other preview.
 */
import { classifyPreviewLink, logExpected, type PreviewLink } from '@throng/core';
import { primaryModifierHeld } from '../../../config/host-modifiers.js';
import { framePointToClient } from './frame-input.js';

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

/** The link as the page wrote it: a follow-route href gives back its `href` parameter; a `#fragment` stays one. */
function writtenHref(href: string): string | null {
  const value = href.trim();
  if (value.startsWith('#')) return value;
  if (!value.startsWith('throng-preview://follow/')) return null;
  try {
    return new URL(value).searchParams.get('href');
  } catch (error) {
    logExpected('frame-fragments: read a follow link', 'the sanitiser writes every follow link; a malformed one names nothing', error);
    return null;
  }
}

/**
 * Constitution VI, FR-079, FR-085a — a right-click on a link in the frame's document reports it through `report` (the
 * panel's link menu) instead of the body menu. Listened for on the frame's WINDOW in the capture phase, so it runs
 * before the document's own handler that hands every other right-click to the panel's body menu. A right-click over a
 * selection keeps the body menu: that menu copies it. The returned function removes the listener.
 */
export function listenToFrameLinkMenu(
  frame: HTMLIFrameElement,
  doc: Document,
  where: { docPath: string; projectRoot: string },
  report: (link: PreviewLink, point: { x: number; y: number }) => void,
): () => void {
  const view = doc.defaultView;
  if (view === null) return () => undefined;
  const onContextMenu = (e: MouseEvent): void => {
    const el = e.target as Element | null;
    const anchor = el !== null && typeof el.closest === 'function' ? el.closest('a[href], area[href]') : null;
    if (anchor === null || (doc.getSelection()?.toString() ?? '') !== '') return;
    const written = writtenHref(anchor.getAttribute('href') ?? '');
    if (written === null) return;
    const link: PreviewLink = written.startsWith('#')
      ? { kind: 'heading', fragment: written.slice(1) }
      : classifyPreviewLink(written, where);
    e.preventDefault();
    e.stopPropagation();
    report(link, framePointToClient(frame, e.clientX, e.clientY));
  };
  view.addEventListener('contextmenu', onContextMenu, true);
  return () => view.removeEventListener('contextmenu', onContextMenu, true);
}
