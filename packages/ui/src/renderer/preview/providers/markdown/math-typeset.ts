/**
 * Typesetting the Markdown preview's maths placeholders (075, FR-040, FR-043 – FR-048, research R6,
 * contracts/math-markup.md §Typesetting).
 *
 * ══ REACHED ONLY BY DYNAMIC IMPORT ══
 *
 * This module imports KaTeX and its stylesheet (which names its fonts). `vite.config.ts` gives it a chunk of its
 * own, and the body imports it only when the drawn document holds a placeholder (`math-dom.ts`'s `hasMath`), so
 * a document without maths loads no typesetter code and no font (FR-046). The fonts ship inside the KaTeX
 * package and are bundled with the app; nothing is ever fetched from anywhere else.
 *
 * ══ KaTeX's OUTPUT IS SANITISED TOO (FR-047) ══
 *
 * `trust: false` disables every command that could emit a link, raw HTML, a class, an id, a style or a
 * resource (`\href`, `\url`, `\includegraphics`, `\htmlClass`, `\htmlId`, `\htmlStyle`, `\htmlData`); they render
 * as errors. KaTeX's HTML then passes this module's own DOMPurify instance with a profile that admits the span,
 * MathML and SVG subset KaTeX draws and no URI-bearing attribute at all, and a hook drops any inline style that
 * names `url(`. The result is a fragment, inserted with `replaceChildren` — no second parse.
 *
 * ══ LIMITS (FR-048) ══
 *
 * `maxExpand` stops a macro that expands without end; `maxSize` caps any user-specified dimension, so neither can
 * hang or flood the window. Hitting one is a KaTeX error, shown like any other (FR-044).
 */
import katex from 'katex';
import 'katex/dist/katex.min.css';
import DOMPurify, { type WindowLike } from 'dompurify';
import { logExpected } from '@throng/core';
import { MATH_ATTRIBUTE, MATH_OPEN_ATTRIBUTE } from '../../math-host.js';
import { MATH_ERROR_ATTRIBUTE, MATH_PENDING_ATTRIBUTE, MATH_SOURCE_ATTRIBUTE, MATH_TYPESET_ATTRIBUTE, hasMath, mathLiteral } from './math-dom.js';

export { MATH_ERROR_ATTRIBUTE, MATH_SOURCE_ATTRIBUTE, MATH_TYPESET_ATTRIBUTE, hasMath };

/** How many expressions are drawn before yielding a frame (SC-006: 500 expressions never block input). */
export const MATH_BATCH = 25;

const KATEX_OPTIONS = { trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 50, output: 'htmlAndMathml', throwOnError: true } as const;

const MATHML_TAGS = [
  'math', 'semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn', 'ms', 'mtext', 'mspace', 'msup', 'msub', 'msubsup',
  'mfrac', 'msqrt', 'mroot', 'mover', 'munder', 'munderover', 'mtable', 'mtr', 'mtd', 'mpadded', 'mphantom',
  'menclose', 'mstyle', 'mglyph', 'mlabeledtr', 'mprescripts', 'none', 'mmultiscripts',
];
const SVG_TAGS = ['svg', 'path', 'line', 'g', 'rect'];

export const MATH_PROFILE = Object.freeze({
  ALLOWED_TAGS: ['span', ...MATHML_TAGS, ...SVG_TAGS],
  ALLOWED_ATTR: [
    'class', 'style', 'aria-hidden', 'encoding', 'xmlns', 'viewBox', 'd', 'width', 'height', 'x', 'y', 'x1', 'x2',
    'y1', 'y2', 'preserveAspectRatio', 'fill', 'stroke', 'stroke-width', 'mathvariant', 'stretchy', 'fence',
    'separator', 'lspace', 'rspace', 'accent', 'accentunder', 'columnalign', 'rowspacing', 'columnspacing',
    'display', 'displaystyle', 'scriptlevel', 'linethickness', 'minsize', 'maxsize', 'movablelimits', 'symmetric',
    'notation', 'mathcolor', 'mathbackground', 'depth', 'voffset', 'columnlines', 'rowlines', 'frame', 'side',
  ],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ADD_FORBID_CONTENTS: ['script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'foreignObject'],
  // No attribute KaTeX emits is a URI; refuse anything with a scheme.
  ALLOWED_URI_REGEXP: /^[^:]*$/,
  RETURN_DOM_FRAGMENT: true,
} as const);

export type MathSanitiser = (html: string) => DocumentFragment;

/** A sanitiser for KaTeX's output, on its own DOMPurify instance (its hook applies to maths and nothing else). */
export function createMathSanitiser(root: WindowLike = window): MathSanitiser {
  const purify = DOMPurify(root);
  purify.addHook('afterSanitizeAttributes', (node) => {
    const style = node.getAttribute('style');
    if (style !== null && /url\s*\(|expression\s*\(|@import/i.test(style)) node.removeAttribute('style');
    for (const name of ['href', 'src', 'xlink:href', 'id', 'name']) node.removeAttribute(name);
  });
  return (html) => purify.sanitize(html, { ...MATH_PROFILE, ALLOWED_TAGS: [...MATH_PROFILE.ALLOWED_TAGS], ALLOWED_ATTR: [...MATH_PROFILE.ALLOWED_ATTR], ADD_FORBID_CONTENTS: [...MATH_PROFILE.ADD_FORBID_CONTENTS] });
}

let shared: MathSanitiser | null = null;

/** How many typeset expressions each sanitiser keeps for reuse; past it, the oldest is dropped. */
export const MATH_CACHE_LIMIT = 4000;

/** What one expression typesets to: its sanitised drawing, or the error KaTeX refused it with. */
type Typeset = { readonly fragment: DocumentFragment } | { readonly error: string };

/**
 * Each sanitiser's typeset expressions, keyed by mode and source (SC-006). A redraw — every keystroke in a parented
 * editor — redraws every placeholder, and a document repeats expressions; KaTeX and the sanitiser run once per
 * distinct one, and every placeholder after that gets a copy. Keyed by sanitiser so that what one profile admitted
 * is never handed out under another.
 */
const caches = new WeakMap<MathSanitiser, Map<string, Typeset>>();

function typesetSource(source: string, displayMode: boolean, sanitise: MathSanitiser): Typeset {
  let cache = caches.get(sanitise);
  if (cache === undefined) caches.set(sanitise, (cache = new Map()));
  const key = `${displayMode ? 'd' : 'i'}${source}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    // Most recently used goes last, so the oldest is the first dropped.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  let result: Typeset;
  try {
    result = { fragment: sanitise(katex.renderToString(source, { ...KATEX_OPTIONS, displayMode })) };
  } catch (error) {
    logExpected('math-typeset: typeset an expression', 'a malformed expression is shown as its source with the error in its hover (075 FR-044)', error);
    result = { error: error instanceof Error ? error.message.replace(/^KaTeX parse error:\s*/, '') : String(error) };
  }
  cache.set(key, result);
  if (cache.size > MATH_CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return result;
}

/** Put a typeset expression in its placeholder, or mark the placeholder as an error showing its source. */
function draw(el: HTMLElement, source: string, typeset: Typeset): void {
  el.removeAttribute(MATH_PENDING_ATTRIBUTE);
  if ('fragment' in typeset) {
    el.replaceChildren(typeset.fragment.cloneNode(true));
    el.setAttribute(MATH_SOURCE_ATTRIBUTE, source);
    el.setAttribute(MATH_TYPESET_ATTRIBUTE, '');
    el.removeAttribute('title');
    // KaTeX's drawing is aria-hidden and its MathML is `display: none` (markdown.css): the source names it.
    el.setAttribute('role', 'math');
    el.setAttribute('aria-label', source);
    return;
  }
  el.removeAttribute('role');
  el.removeAttribute('aria-label');
  el.textContent = mathLiteral(el.getAttribute(MATH_OPEN_ATTRIBUTE), source);
  el.setAttribute(MATH_ERROR_ATTRIBUTE, '');
  el.setAttribute('title', `Maths error: ${typeset.error}`);
}

/**
 * Typeset every placeholder under `root` not yet drawn. The expressions are typeset `batch` at a time, awaiting
 * `yieldFrame` between batches (Principle XII), WITHOUT touching the page; once all are ready they are drawn in
 * one go, so the document is laid out once rather than once per batch — each batch drawn in place re-laid the
 * whole document out (SC-006, measured: ten frames of 80 – 100 ms for 500 expressions). Stops, drawing nothing, as
 * soon as `signal.cancelled` is set — a newer draw has replaced this one. Resolves with the number drawn or refused.
 */
export async function typesetMath(
  root: ParentNode,
  yieldFrame: () => Promise<void>,
  batch: number = MATH_BATCH,
  signal: { readonly cancelled: boolean } = { cancelled: false },
  sanitise: MathSanitiser = (shared ??= createMathSanitiser()),
): Promise<number> {
  const pending = [...root.querySelectorAll<HTMLElement>(`[${MATH_ATTRIBUTE}]:not([${MATH_TYPESET_ATTRIBUTE}]):not([${MATH_ERROR_ATTRIBUTE}])`)];
  const ready: { readonly el: HTMLElement; readonly source: string; readonly typeset: Typeset }[] = [];
  for (let i = 0; i < pending.length; i += batch) {
    if (signal.cancelled) return 0;
    if (i > 0) await yieldFrame();
    if (signal.cancelled) return 0;
    for (const el of pending.slice(i, i + batch)) {
      // A pending expression's text is its placeholder (FR-043a); its source waits in the attribute.
      const source = el.hasAttribute(MATH_PENDING_ATTRIBUTE) ? (el.getAttribute(MATH_SOURCE_ATTRIBUTE) ?? '') : (el.textContent ?? '');
      ready.push({ el, source, typeset: typesetSource(source, el.getAttribute(MATH_ATTRIBUTE) === 'display', sanitise) });
    }
  }
  if (signal.cancelled) return 0;
  let done = 0;
  for (const { el, source, typeset } of ready) {
    if (!el.isConnected && root instanceof Node && !root.contains(el)) continue;
    draw(el, source, typeset);
    done += 1;
  }
  return done;
}
