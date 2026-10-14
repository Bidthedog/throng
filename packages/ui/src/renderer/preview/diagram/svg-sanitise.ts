/**
 * The diagram SVG profile (054 FR-045, research R5): the second sanitiser, for what a diagram renderer drew.
 *
 * ══ REACHED ONLY BY DYNAMIC IMPORT ══
 *
 * DOMPurify rides in the lazy `preview` chunk, and this module in the lazy `app-preview-diagram` one
 * (`vite.config.ts`). Only `mermaid-renderer.ts` imports it, and the block registry reaches that with
 * `import()`.
 *
 * ══ WHY A SECOND PROFILE ══
 *
 * The document profile forbids `svg` with its content (044 FR-081): a document can never plant markup a
 * diagram renderer would have drawn. A diagram is drawn by mermaid, from source the document supplies,
 * and mermaid at `securityLevel: 'strict'` already refuses click callbacks and HTML labels — this is what
 * makes that structural rather than trusted:
 *
 * - DOMPurify's `svg` + `svgFilters` profiles, minus `foreignObject` (HTML inside SVG), `script`, `a` (a
 *   diagram is never a link surface), `image`/`feImage` (a fetch), and the `animate*` elements (which can
 *   rewrite an attribute after sanitising). `use` is not on the profile at all.
 * - No event-handler attribute (DOMPurify's own rule), and no `href`/`xlink:href` but a local `#` fragment.
 * - No network from CSS: a `<style>` element's text and every `style` attribute lose `@import` rules, and
 *   every `url(…)` that is not a local `#` reference becomes `none` (044 FR-093).
 *
 * The result is one `SVGSVGElement` in the root's document, or `null` when the input was not an SVG.
 */
import DOMPurify, { type Config, type WindowLike } from 'dompurify';

export const DIAGRAM_SVG_PROFILE = Object.freeze({
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ['foreignObject', 'script', 'a', 'image', 'feImage', 'animate', 'animateColor', 'animateMotion', 'animateTransform', 'set', 'use'],
  RETURN_DOM_FRAGMENT: true,
} satisfies Config & { RETURN_DOM_FRAGMENT: true });

export type DiagramSvgSanitiser = (svg: string) => SVGSVGElement | null;

const XLINK = 'http://www.w3.org/1999/xlink';

/** `@import` rules, whatever they import. */
const IMPORT_RULE = /@import[^;]*;?/gi;
/** A `url(…)` whose target is not a local `#` fragment. */
const REMOTE_URL = /url\(\s*(?!['"]?\s*#)[^)]*\)/gi;

/** `css` with nothing in it that could reach the network. */
export function neutraliseCss(css: string): string {
  return css.replace(IMPORT_RULE, '').replace(REMOTE_URL, 'none');
}

/** A sanitiser bound to `root` — the renderer's own window by default — on its own DOMPurify instance. */
export function createDiagramSvgSanitiser(root: WindowLike = window): DiagramSvgSanitiser {
  const purify = DOMPurify(root);

  purify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'style' && node.textContent !== null) node.textContent = neutraliseCss(node.textContent);
  });

  purify.addHook('afterSanitizeAttributes', (node) => {
    const href = node.getAttribute('href');
    if (href !== null && !href.trim().startsWith('#')) node.removeAttribute('href');
    const xlink = node.getAttributeNS(XLINK, 'href') ?? node.getAttribute('xlink:href');
    if (xlink !== null && !xlink.trim().startsWith('#')) {
      node.removeAttributeNS(XLINK, 'href');
      node.removeAttribute('xlink:href');
    }
    const style = node.getAttribute('style');
    if (style !== null) node.setAttribute('style', neutraliseCss(style));
  });

  return (svg) => {
    const fragment = purify.sanitize(svg, DIAGRAM_SVG_PROFILE);
    const first = fragment.firstElementChild;
    if (first === null || first.localName !== 'svg' || fragment.childElementCount !== 1) return null;
    return first as SVGSVGElement;
  };
}

let shared: DiagramSvgSanitiser | null = null;

/** The window's one diagram sanitiser, built on first use. */
export function sanitiseDiagramSvg(svg: string): SVGSVGElement | null {
  shared ??= createDiagramSvgSanitiser(window);
  return shared(svg);
}
