/**
 * The sanitiser every rendered Markdown document passes through (044, FR-081, FR-082, FR-084,
 * FR-090 – FR-094, contracts/security-policy.md Layer 2, research R2, R6, R7).
 *
 * ══ REACHED ONLY BY DYNAMIC IMPORT ══
 *
 * DOMPurify rides in the lazily loaded `preview` chunk (`vite.config.ts`); see `pipeline.ts`.
 *
 * ══ AN ALLOWLIST, RETURNED AS A FRAGMENT ══
 *
 * `PROFILE` is the contract's, verbatim (as amended in 61aa91ba and 4ca45e68). Everything not named is
 * dropped. Script, style, frames, objects, `svg` and `math` go with their content, and so does everything
 * on DOMPurify's own default list (`audio`, `video`, `noembed`, `noframes`, `xmp`, `title`, …) —
 * `ADD_FORBID_CONTENTS` adds to that list, where `FORBID_CONTENTS` would have replaced it and let a
 * `<video><img src="//host/y"></video>` keep its image. `mark` goes with its text kept. No
 * `id`, no `name`, no `class`, no `style`, no `on*`, no `aria-*` (DOMPurify admits `aria-*` ahead of the
 * allowlist unless `ALLOW_ARIA_ATTR` is false), and only the pipeline's four `data-*` attributes survive.
 *
 * Every attribute value that is not on DOMPurify's URI-safe list — `data-lang` included — is tested
 * against `ALLOWED_URI_REGEXP`, whose `[^:]*$` refuses a colon. The pipeline therefore never emits a
 * colon in a data attribute (see its fence rule).
 *
 * The result is a `DocumentFragment` for `replaceChildren`. Nothing downstream turns a sanitised string
 * back into markup through `innerHTML`, so there is no second parse for a mutation-XSS payload to use.
 *
 * ══ THE HOOKS — REGISTERED ONCE, PER INSTANCE ══
 *
 * `afterSanitizeAttributes`, in the contract's order, on this sanitiser's own DOMPurify instance (never
 * the shared default, so no other caller inherits them). They are added ONCE, when the sanitiser is
 * built; what differs between renders — the document, the project, the setting, the pipeline's slugs —
 * reaches them through `current`, set for the duration of one synchronous `sanitize` call. A hook added
 * per render would be a hook added per keystroke, each one running on every later document.
 *
 * Every attribute a hook SETS is set after DOMPurify's own checks on that element, which is what lets it
 * write a JSON classification, a URL title or a `throng-preview:` source the profile itself would refuse
 * — and why none of those can be supplied by the document: the profile already removed any it wrote.
 *
 * 1. **Any element** — a `src` beginning `data:` is removed. `ALLOWED_URI_REGEXP` alone does NOT do
 *    this: DOMPurify keeps a `data:` `src` on `img`, `audio`, `video`, `source` and `track` whatever the
 *    URI regexp says (its `DATA_URI_TAGS` exception). An `href` on anything but a link goes too.
 * 2. **`a`** — `classifyPreviewLink`, then the `href` is removed. A followable link carries its
 *    classification in `data-throng-link`, `tabindex=0`, `role=link` and a title naming its target and
 *    the gesture (FR-094, FR-096b), and that target alone in `data-throng-target` for the status bar
 *    readout (FR-118). An inert link carries nothing, so it is not focusable and offers no
 *    link menu (FR-091, FR-095). Every element INSIDE a followable link loses its `title`, so no tooltip
 *    but the link's own can show over it (adversarial review I3).
 * 3. **`img`** — `resolvePreviewImage`: a project image is served by `throng-preview://asset/…`, a
 *    permitted `https:` image keeps its source, and everything else loses its `src` and is marked
 *    `data-throng-alt` for the body's alt-text fallback (FR-084, FR-092, FR-093). Outside a followable link
 *    its title becomes the source as written, then the document's own title (FR-120); inside one it has
 *    none.
 * 4. **`input`** — anything but a checkbox is removed; a checkbox is forced `disabled` (FR-080, FR-020).
 * 5. **`h1`–`h6`** — `data-heading-slug` is kept only where the element carries this render's
 *    `data-heading-nonce` AND the slug is the one the pipeline recorded for its `data-source-line`. The
 *    nonce is random per render and never reaches the DOM, so raw HTML — a `<h2 data-heading-slug="spoof">`,
 *    or one copying a real heading's line and slug — cannot plant or steal a fragment target (FR-090b,
 *    FR-090f). On any other element the slug is removed, and the nonce is removed from every element.
 *
 * ══ THE EXPORT PROFILE (FR-035a) ══
 *
 * A rich copy re-sanitises the copied selection with `EXPORT_PROFILE` on a second instance
 * (`createHtmlExporter`, below): stricter than the render profile, and with one hook of its own that puts
 * back an external link's address.
 */
import DOMPurify, { type Config, type WindowLike } from 'dompurify';
import { classifyPreviewLink, resolvePreviewImage, type PreviewLink } from '@throng/core';
import {
  LINK_ATTRIBUTE,
  TARGET_ATTRIBUTE,
  linkOf,
  serialiseLink,
  stripBidiControls,
} from '../../link-dom.js';
import type { PipelineContext } from './pipeline.js';

type Profile = Config & { RETURN_DOM_FRAGMENT: true };

export const PROFILE = Object.freeze({
  ALLOWED_TAGS: [
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'em', 'strong', 'del', 's', 'ins', 'a', 'img',
    'ul', 'ol', 'li', 'input', 'blockquote', 'hr', 'br', 'pre', 'code', 'span', 'div',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'dl', 'dt', 'dd',
    'details', 'summary', 'kbd', 'sub', 'sup',
  ],
  ALLOWED_ATTR: [
    'href', 'src', 'alt', 'title', 'start', 'checked', 'disabled', 'type', 'open', 'colspan', 'rowspan',
    'data-source-line', 'data-lang', 'data-align', 'data-heading-slug',
    'data-heading-nonce',   // admitted only so the heading hook can verify it; the hook removes it from every element
  ],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ADD_FORBID_CONTENTS: ['script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math'],
  RETURN_DOM_FRAGMENT: true,
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|[^:]*$)/i,
} satisfies Profile);

/** The attribute a blocked image is marked with, for the body to show its alternative text (FR-084). */
export const BLOCKED_IMAGE_ATTRIBUTE = 'data-throng-alt';

/*
 * 045 FR-169a's note — a link's title carries NO gesture wording at all now.
 *
 * It was a fixed `FOLLOW_HINT` string here, then FR-168 made it `previewLinkHoverText`, worded by
 * destination so the three surfaces could not disagree about what "Ctrl+Click" would do. Round five
 * removed the wording from the hover entirely, in all three: the title is the target address and
 * nothing else. The wording lives on, unchanged and still shared, in the plain-click hint — which is
 * where it is actually read, because a hint is asked for and a tooltip is not.
 */

/** Sanitises markdown-it's HTML. Shaped to be the pipeline's injected `Sanitiser`. */
export type MarkdownSanitiser = (html: string, context?: PipelineContext) => DocumentFragment;

const HEADING = /^H[1-6]$/;

/**
 * A reference as a reader would recognise it: percent escapes decoded where they decode, and no bidi
 * control left to reorder it (`stripBidiControls`, shared with the link notice). Display only — the
 * classification is untouched.
 */
function displayTarget(raw: string): string {
  let shown: string;
  try {
    shown = decodeURI(raw.trim());
  } catch {
    shown = raw.trim();
  }
  return stripBidiControls(shown);
}

/** `relPath` as a `throng-preview://asset/` URL: the panel id and every segment percent-encoded. */
function assetUrl(panelId: string, relPath: string): string {
  const path = relPath.split('/').map(encodeURIComponent).join('/');
  return `throng-preview://asset/${encodeURIComponent(panelId)}/${path}`;
}

/** Per-render state the hooks read. `null` outside a `sanitize` call. */
interface RenderScope {
  context: PipelineContext | undefined;
}

/**
 * A sanitiser bound to `root` — the renderer's own window by default — with its own DOMPurify instance,
 * so the hooks registered here apply to preview documents and nothing else.
 */
export function createSanitiser(root: WindowLike = window): MarkdownSanitiser {
  const purify = DOMPurify(root);
  let current: RenderScope | null = null;

  const classify = (href: string | null): PreviewLink => {
    if (href === null) return { kind: 'inert' };
    const env = current?.context?.environment;
    if (env) return classifyPreviewLink(href, { docPath: env.docPath, projectRoot: env.projectRoot });
    // No document to resolve against: only what needs no location is followable.
    const link = classifyPreviewLink(href, { docPath: '', projectRoot: '' });
    return link.kind === 'external' || link.kind === 'heading' ? link : { kind: 'inert' };
  };

  const onLink = (node: Element): void => {
    const href = node.getAttribute('href');
    node.removeAttribute('href');
    node.removeAttribute('title');
    const link = classify(href);
    if (link.kind === 'inert' || href === null) return;
    node.setAttribute(LINK_ATTRIBUTE, serialiseLink(link));
    node.setAttribute('tabindex', '0');
    node.setAttribute('role', 'link');
    const target = displayTarget(link.kind === 'external' ? link.url : link.kind === 'outside' ? link.target : href);
    /*
     * FR-169a (round five) — the title is the TARGET, and nothing else.
     *
     * ══ SUPERSEDES FR-168's "<target> — <wording>" ══
     *
     * Round four gave every surface a tooltip that named the gesture and its destination, worded by
     * one shared function so the three could not disagree. Hands-on, that reads as noise over a link
     * whose address is the thing you wanted to see. The gesture is still explained — by the
     * plain-click hint, which is where the maintainer asked for it and which still uses
     * `previewLinkHoverText`. The hover's only job is now to show the full address, untruncated,
     * which is what a native `title` is for.
     */
    node.setAttribute('title', target);
    // FR-118 — the same text, for the status bar readout. Set after DOMPurify's checks, so never the document's.
    node.setAttribute(TARGET_ATTRIBUTE, target);
  };

  /**
   * FR-120 — an image's tooltip: the source AS WRITTEN (`src` before the rewrite below), then the document's own
   * title, each in the link title's display form. Never the rewritten `throng-preview://asset/<panelId>/…`
   * address, which would expose the internal scheme and the panel id. Inside a followable link there is none:
   * the link's own title must show over it (I3), and the status bar readout names that link (FR-118).
   */
  const imageTitle = (node: Element, src: string | null): void => {
    const authored = node.getAttribute('title');
    node.removeAttribute('title');
    if (node.closest(`[${LINK_ATTRIBUTE}]`) !== null) return;
    const parts: string[] = [];
    if (src !== null && src.trim().length > 0) parts.push(displayTarget(src));
    const title = authored === null ? '' : stripBidiControls(authored).trim();
    if (title.length > 0) parts.push(title);
    if (parts.length > 0) node.setAttribute('title', parts.join(' — '));
  };

  const onImage = (node: Element): void => {
    const src = node.getAttribute('src');
    imageTitle(node, src);
    const env = current?.context?.environment;
    const image =
      src === null || env === undefined
        ? ({ kind: 'blocked' } as const)
        : resolvePreviewImage(src, { docPath: env.docPath, projectRoot: env.projectRoot, remoteImages: env.remoteImages });
    if (image.kind === 'project' && env !== undefined) {
      node.setAttribute('src', assetUrl(env.panelId, image.relPath));
    } else if (image.kind === 'remote') {
      node.setAttribute('src', image.url);
    } else {
      node.removeAttribute('src');
      node.setAttribute(BLOCKED_IMAGE_ATTRIBUTE, '');
    }
  };

  const onHeading = (node: Element, nonce: string | null): void => {
    const slug = node.getAttribute('data-heading-slug');
    if (slug === null) return;
    const context = current?.context;
    const lineText = node.getAttribute('data-source-line');
    const line = lineText !== null && /^\d+$/.test(lineText) ? Number(lineText) : NaN;
    const recorded = context?.headingSlugs.get(line);
    const emittedByPipeline = context !== undefined && nonce !== null && nonce === context.headingNonce;
    if (emittedByPipeline && recorded !== undefined && recorded === slug) return;
    node.removeAttribute('data-heading-slug');
  };

  purify.addHook('afterSanitizeAttributes', (node) => {
    if (/^data:/i.test((node.getAttribute('src') ?? '').trim())) node.removeAttribute('src');
    const tag = node.tagName.toUpperCase();

    if (tag === 'A') onLink(node);
    else if (node.hasAttribute('href')) node.removeAttribute('href');

    // Inside a followable link, the link's own title is the only one: Chromium shows the INNERMOST title,
    // so an image's or a span's would name a target Ctrl+click does not follow (adversarial review I3).
    // DOMPurify walks in document order, so every ancestor link has already been through `onLink`.
    if (tag !== 'A' && node.hasAttribute('title') && node.closest(`[${LINK_ATTRIBUTE}]`) !== null) {
      node.removeAttribute('title');
    }

    if (tag === 'IMG') onImage(node);

    if (tag === 'INPUT') {
      if ((node.getAttribute('type') ?? '').trim().toLowerCase() !== 'checkbox') {
        node.remove();
        return;
      }
      node.setAttribute('disabled', '');
    }

    const nonce = node.getAttribute('data-heading-nonce');
    node.removeAttribute('data-heading-nonce');
    if (HEADING.test(tag)) onHeading(node, nonce);
    else if (node.hasAttribute('data-heading-slug')) node.removeAttribute('data-heading-slug');
  });

  return (html, context) => {
    current = { context };
    try {
      return purify.sanitize(html, PROFILE);
    } finally {
      current = null;
    }
  };
}

/* ── The export profile (FR-035a, contracts/security-policy.md "Export profile") ──────────────────── */

/**
 * What a rich copy puts on the clipboard: the same tags a preview draws, and of the attributes only those
 * that mean something to a mail composer or a word processor. No `class` (a highlight span's theme class
 * names nothing outside throng), no `data-*` (link classifications, source lines, a blocked image's mark),
 * no `id`, no `role`, no `tabindex`, and no `src` — a `throng-preview:` address resolves nowhere else.
 *
 * `span` is left OUT of the tag list, which is what unwraps highlight spans to their text: DOMPurify keeps a
 * disallowed element's content (`KEEP_CONTENT`, on by default). Once `class` is gone a span says nothing,
 * so unwrapping every span — the alternative-text span included — loses nothing.
 *
 * `img` is left out too (amended 2026-09-15, US3 review). An image's `throng-preview:` or remote address
 * means nothing outside the app, so the exporter replaces each image with its alt text before sanitising
 * (`createHtmlExporter`); the allowlist is the backstop that removes any image that pass did not reach.
 */
export const EXPORT_PROFILE = Object.freeze({
  ALLOWED_TAGS: PROFILE.ALLOWED_TAGS.filter((tag) => tag !== 'span' && tag !== 'img'),
  ALLOWED_ATTR: ['href', 'alt', 'title', 'start', 'checked', 'disabled', 'type', 'open', 'colspan', 'rowspan'],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ADD_FORBID_CONTENTS: PROFILE.ADD_FORBID_CONTENTS,
  ALLOWED_URI_REGEXP: PROFILE.ALLOWED_URI_REGEXP,
} satisfies Config);

/** Serialises a copied selection under the export profile. */
export type PreviewHtmlExporter = (selection: DocumentFragment) => string;

/**
 * An exporter bound to `root`, on its own DOMPurify instance so its hook never runs for a render.
 *
 * The input is a clone of the preview's own DOM — already sanitised once — but it is sanitised AGAIN rather
 * than stripped by hand: the body adds nodes after the render sanitiser has run (highlighting, alternative
 * text), and an allowlist is the one rule that holds whatever a later change adds there.
 *
 * One hook, before DOMPurify reads the attributes: a link's `href` was removed when it was drawn, and is
 * restored from its classification for an EXTERNAL link only. A project file, a heading or an outside path
 * means nothing to whoever receives the copy, so those links keep their text and no address. Every link's
 * title is throng's own follow hint (the document's was removed at render), so it does not travel.
 *
 * Before sanitising, every image in the selection is replaced by a text node of its alt text — or removed,
 * when it has none. The selection is the caller's own clone, so rewriting it touches nothing on screen.
 */
export function createHtmlExporter(root: WindowLike = window): PreviewHtmlExporter {
  const purify = DOMPurify(root);
  purify.addHook('beforeSanitizeAttributes', (node) => {
    if (node.tagName?.toUpperCase() !== 'A') return;
    node.removeAttribute('title');
    node.removeAttribute('href');
    const link = linkOf(node);
    if (link?.kind === 'external') node.setAttribute('href', link.url);
  });
  return (selection) => {
    for (const img of [...selection.querySelectorAll('img')]) {
      const alt = img.getAttribute('alt') ?? '';
      if (alt.length > 0) img.replaceWith(img.ownerDocument.createTextNode(alt));
      else img.remove();
    }
    return purify.sanitize(selection, EXPORT_PROFILE);
  };
}
