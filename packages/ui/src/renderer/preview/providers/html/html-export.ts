/**
 * 074 FR-085a — what Copy as Rich Text puts on the clipboard from an HTML Preview: the selected part of the page under
 * the preview's shared export profile (the Markdown provider's `EXPORT_PROFILE`: no `class`, `style`, `id` or
 * `data-*`), widened by the inline and sectioning tags a web page uses that a Markdown preview never draws (`b`, `i`,
 * `u`, `figure`, …).
 *
 * The page's own rules, in a pass before the profile:
 * - an image never travels: its address is the preview's own `throng-preview:` route or a remote source, which means
 *   nothing outside the app, so it becomes its alt text, or nothing;
 * - a link was drawn as the preview's follow route (`html-sanitise.ts`); it travels with the address the page wrote
 *   when that is a web or mail address (`https:`, `http:`, `mailto:`), and as its text alone otherwise.
 *
 * Loaded on the first rich copy, with DOMPurify (R21).
 */
import DOMPurify from 'dompurify';
import { EXPORT_PROFILE } from '../markdown/sanitise.js';
import { logExpected } from '@throng/core';

const OUTSIDE_ADDRESS = /^(?:https?:|mailto:)/i;
const FOLLOW_ROUTE = 'throng-preview://follow/';

const PAGE_TAGS = [
  'b', 'i', 'u', 'mark', 'small', 'abbr', 'cite', 'q', 'dfn', 'var', 'samp', 'time',
  'caption', 'tfoot', 'col', 'colgroup', 'figure', 'figcaption',
  'section', 'article', 'header', 'footer', 'nav', 'aside', 'main', 'address',
];

const PAGE_EXPORT_PROFILE = Object.freeze({ ...EXPORT_PROFILE, ALLOWED_TAGS: [...EXPORT_PROFILE.ALLOWED_TAGS, ...PAGE_TAGS] });

/** The address a link in the page was written with: the follow route's `href`, else the attribute as it stands. */
export function pageAddressOf(href: string): string {
  if (!href.startsWith(FOLLOW_ROUTE)) return href;
  try {
    return new URL(href).searchParams.get('href') ?? '';
  } catch (error) {
    logExpected('html-export: a link\'s address', 'a follow-route href that is not a URL names no address', error);
    return '';
  }
}

let purify: ReturnType<typeof DOMPurify> | null = null;

function exporter(): ReturnType<typeof DOMPurify> {
  if (purify !== null) return purify;
  purify = DOMPurify(window);
  purify.addHook('beforeSanitizeAttributes', (node) => {
    if (node.tagName?.toUpperCase() !== 'A') return;
    node.removeAttribute('title'); // the preview's own follow hint
    const address = pageAddressOf(node.getAttribute('href')?.trim() ?? '').trim();
    if (OUTSIDE_ADDRESS.test(address)) node.setAttribute('href', address);
    else node.removeAttribute('href');
  });
  return purify;
}

/** The selection (the caller's own clone, so rewriting it touches nothing on screen) as rich-copy HTML. */
export function exportHtmlSelection(captured: DocumentFragment): string {
  // The selection was cloned in the frame's document, another realm: DOMPurify recognises a node by THIS realm's
  // `Node`, so the clone is brought into this document first.
  const selection = captured.ownerDocument === document ? captured : document.importNode(captured, true);
  for (const img of [...selection.querySelectorAll('img')]) {
    const alt = img.getAttribute('alt') ?? '';
    if (alt.length > 0) img.replaceWith(img.ownerDocument.createTextNode(alt));
    else img.remove();
  }
  return exporter().sanitize(selection, PAGE_EXPORT_PROFILE);
}
