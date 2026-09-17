/**
 * Links and headings as they sit in a rendered preview's DOM (044, FR-090 – FR-096,
 * contracts/security-policy.md Layer 2 "Fragment lookup").
 *
 * The sanitiser's link hook classifies every `<a>` once, while the document is being sanitised, and
 * carries the answer on the element as `data-throng-link` — never an `href`, so a click, a middle-click
 * or a drag has nothing to navigate with (R6). Everything that later needs to know what a link IS — the
 * body's gestures, the chrome's menu and Ctrl+Enter, copy's export profile — reads it back through
 * {@link linkOf} rather than classifying the text a second time.
 *
 * The attribute cannot be planted by a document: the sanitiser profile admits no `data-*` it does not
 * name (`ALLOW_DATA_ATTR: false`), and the hook that sets this one runs after that check.
 *
 * Provider-neutral on purpose: the chrome imports this, and a later provider that draws links marks them
 * the same way.
 */
import { headingSlug, type PreviewLink } from '@throng/core';

/**
 * Bidirectional formatting controls: the Arabic letter mark (U+061C), embeddings and overrides
 * (U+202A–U+202E), isolates (U+2066–U+2069) and the marks U+200E/U+200F. In text naming a link's target they
 * can reorder what a reader sees, so `…/gnp.exe` reads as `…/exe.png`. Built from code points so no
 * invisible character sits in this file.
 */
const BIDI_CONTROLS = new RegExp(
  `[${[0x061c, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200e, 0x200f]
    .map((c) => `\\u${c.toString(16).padStart(4, '0')}`)
    .join('')}]`,
  'g',
);

/**
 * `text` with every bidi control removed — for DISPLAYING a link target (a link's title, a link notice),
 * never for classifying or following one. The one place the set is defined (fix round 2).
 */
export function stripBidiControls(text: string): string {
  return text.replace(BIDI_CONTROLS, '');
}

/** The attribute a followable link's classification is carried in. */
export const LINK_ATTRIBUTE = 'data-throng-link';

const LINK_SELECTOR = `[${LINK_ATTRIBUTE}]`;

/**
 * The attribute a followable link's target is carried in for DISPLAY (iteration 2026-09-15, FR-118): the text
 * its title names, without the gesture hint, bidi controls already stripped. The status bar readout shows it.
 * Like {@link LINK_ATTRIBUTE}, only the sanitiser's hook can set it.
 */
export const TARGET_ATTRIBUTE = 'data-throng-target';

/** The display target of the followable link `target` is, or is inside; `null` for anything else. */
export function linkTargetOf(target: EventTarget | Element | null): string | null {
  return linkElementOf(target)?.getAttribute(TARGET_ATTRIBUTE) ?? null;
}

/** A link's classification, as the attribute holds it. */
export function serialiseLink(link: PreviewLink): string {
  return JSON.stringify(link);
}

function parseLink(raw: string): PreviewLink | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const str = (key: string): boolean => typeof v[key] === 'string';
  switch (v.kind) {
    case 'external':
      return str('url') ? { kind: 'external', url: v.url as string } : null;
    case 'file':
      if (!str('absPath')) return null;
      return str('fragment')
        ? { kind: 'file', absPath: v.absPath as string, fragment: v.fragment as string }
        : { kind: 'file', absPath: v.absPath as string };
    case 'heading':
      return str('fragment') ? { kind: 'heading', fragment: v.fragment as string } : null;
    case 'outside':
      return str('target') ? { kind: 'outside', target: v.target as string } : null;
    default:
      return null;
  }
}

/** The followable link element `target` is, or is inside; `null` for anything else. */
export function linkElementOf(target: EventTarget | Element | null): HTMLElement | null {
  if (target === null || typeof (target as Element).closest !== 'function') return null;
  return (target as Element).closest<HTMLElement>(LINK_SELECTOR);
}

/** The classification of the followable link `target` is, or is inside; `null` for anything else. */
export function linkOf(target: EventTarget | Element | null): PreviewLink | null {
  const el = linkElementOf(target);
  const raw = el?.getAttribute(LINK_ATTRIBUTE);
  return raw ? parseLink(raw) : null;
}

/**
 * The heading a `#fragment` names in a rendered preview, or `null` (FR-090b, FR-090f).
 *
 * The fragment is slugged with the same `headingSlug` the pipeline gave each heading, so `#Install` and
 * `#install` both find `## Install`, and `#install-1` the second one. Compared attribute by attribute
 * rather than through a selector built from the fragment, so no fragment can be a selector.
 */
export function findHeading(root: ParentNode, fragment: string): HTMLElement | null {
  const slug = headingSlug(fragment, new Set());
  if (slug.length === 0) return null;
  for (const heading of root.querySelectorAll<HTMLElement>('[data-heading-slug]')) {
    if (heading.getAttribute('data-heading-slug') === slug) return heading;
  }
  return null;
}
