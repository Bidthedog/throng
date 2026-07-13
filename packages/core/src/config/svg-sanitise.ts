/**
 * Allowlist sanitiser for icon-pack SVG markup (017 / #54).
 *
 * WHY THIS EXISTS
 * ---------------
 * A pack icon must take its colour from the active theme. The bundled art is authored
 * `stroke="currentColor"` for exactly that reason — but an SVG rendered inside an `<img>` is an
 * ISOLATED DOCUMENT: its `currentColor` resolves against that document's own initial colour (black),
 * not against the host page. The only way to theme a pack icon is to INLINE its markup into the DOM.
 *
 * Inlining means markup from `%USERPROFILE%\.throng\icon-packs\` — a user-writable directory, and a
 * pack is a shareable artifact people pass around — reaches the DOM via `dangerouslySetInnerHTML`.
 * That is untrusted input on a script-injection path. It is sanitised ONCE, in the main process, at
 * pack-load time, before it ever crosses IPC.
 *
 * FAIL CLOSED — the hard-won rule
 * -------------------------------
 * An earlier version of this sanitiser RECONSTRUCTED its output with `String.replace(TAG, …)`, which
 * quietly passed through any text the tag regex could not tokenise. A single unbalanced quote
 * (`<img onerror=alert(1) title="`) made the regex fail to recognise the tag — so the raw `<img>`
 * was emitted untouched, while the browser's lenient HTML parser still read it as a live element.
 * An adversarial review broke it with exactly that input.
 *
 * The rule that fixes it: **anything that is not recognised as a well-formed ALLOWED tag is escaped,
 * never emitted verbatim.** Every `<` in the output begins a tag this function itself produced;
 * every other `<` becomes `&lt;`. There is no path by which raw input markup reaches the DOM.
 *
 * ALLOWLIST, NOT DENYLIST. A denylist bets you thought of every attack; an allowlist bets you
 * thought of every icon. The second bet is easier to win, and it fails safe.
 */

/** Elements an icon may legitimately contain. Anything else has its tag dropped. */
const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'defs',
  'symbol',
  'use',
  'clippath',
  'mask',
  'lineargradient',
  'radialgradient',
  'stop',
]);
// Note: `desc` and `title` are deliberately NOT allowed. They are HTML-integration points (content
// inside them is parsed as HTML, not SVG), and an aria-hidden icon has no use for them anyway.

/** Removed ENTIRELY, with their contents — a pre-pass, before the main scan. */
const DANGEROUS_ELEMENTS = ['script', 'style', 'foreignObject'];

/** Attributes an icon may carry. `stroke`/`fill` are how `currentColor` — the theming — gets in. */
const ALLOWED_ATTRS = new Set([
  'xmlns',
  'xmlns:xlink',
  'viewbox',
  'width',
  'height',
  'preserveaspectratio',
  'class',
  'id',
  'transform',
  'd',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'fill-rule',
  'fill-opacity',
  'stroke-opacity',
  'clip-rule',
  'clip-path',
  'opacity',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'points',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientunits',
  'gradienttransform',
  'href',
  'xlink:href',
]);

/** Only these may carry a reference, and only to a bare in-document `#fragment`. */
const REFERENCE_ATTRS = new Set(['href', 'xlink:href']);

/**
 * A full tag, anchored, that RESPECTS QUOTES.
 *
 * The attribute run is `(?:"[^"]*"|'[^']*'|[^>"'])*` — a quoted string, OR a single-quoted string,
 * OR any char that is not `>` or a quote. So the tag ends at the first *unquoted* `>`, and — this is
 * the anti-bypass — an UNBALANCED quote makes the run unable to consume the stray `"`, the match
 * fails, and the caller escapes the `<` instead of trusting it.
 */
const TAG_RE = /^<(\/?)([a-zA-Z][a-zA-Z0-9:_-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)\/?>/;
const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Escape only `<` and `>`. `&` is left alone so the function is idempotent; text is not tag-parsed. */
function escapeText(s: string): string {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function stripDangerousElements(markup: string): string {
  let out = markup;
  for (const name of DANGEROUS_ELEMENTS) {
    out = out.replace(new RegExp(`<${name}\\b[\\s\\S]*?</${name}\\s*>`, 'gi'), '');
    out = out.replace(new RegExp(`<${name}\\b[^>]*/?>`, 'gi'), '');
  }
  return out;
}

function sanitiseAttributes(raw: string): string {
  const kept: string[] = [];
  let match: RegExpExecArray | null;
  ATTR.lastIndex = 0;
  while ((match = ATTR.exec(raw)) !== null) {
    const name = match[1];
    const value = match[2] ?? match[3] ?? '';
    const lower = name.toLowerCase();

    if (lower.startsWith('on')) continue; // every event handler, any case
    if (!ALLOWED_ATTRS.has(lower)) continue;
    // A reference may point INSIDE this document and nowhere else — rules out javascript:, data:,
    // and any remote fetch without enumerating schemes.
    if (REFERENCE_ATTRS.has(lower) && !value.startsWith('#')) continue;
    // The value is re-emitted inside double quotes; a double quote in it would break out.
    if (value.includes('"')) continue;

    kept.push(`${name}="${value}"`); // original-case name preserved (e.g. viewBox)
  }
  return kept.length > 0 ? ` ${kept.join(' ')}` : '';
}

/**
 * Sanitise icon SVG markup.
 *
 * @returns the safe markup, or `null` if this is not an SVG at all — in which case the caller treats
 *   the token as unreadable and falls back down the icon chain (FR-003), rather than rendering a hole.
 *
 * Idempotent: `sanitiseSvg(sanitiseSvg(x)) === sanitiseSvg(x)`.
 */
export function sanitiseSvg(markup: string): string | null {
  if (typeof markup !== 'string' || markup.trim() === '') return null;

  const src = stripDangerousElements(
    markup
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<!\[CDATA\[[\s\S]*?\]\]>/gi, '')
      .replace(/<\?[\s\S]*?\?>/g, '')
      .replace(/<!DOCTYPE[\s\S]*?>/gi, ''),
  ).trim();

  // The root must BE an svg. A pack file that is not an icon is not an icon.
  if (!/^<svg[\s/>]/i.test(src)) return null;

  const out: string[] = [];
  let i = 0;
  let svgDepth = 0;
  let rootClosed = false;

  while (i < src.length && !rootClosed) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      out.push(escapeText(src.slice(i)));
      break;
    }
    if (lt > i) out.push(escapeText(src.slice(i, lt)));

    const m = TAG_RE.exec(src.slice(lt));
    if (!m) {
      // Not a well-formed tag (e.g. an unbalanced-quote injection). Escape the `<` and carry on —
      // this is the fail-closed branch. Whatever follows becomes inert text.
      out.push('&lt;');
      i = lt + 1;
      continue;
    }

    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    const rawAttrs = m[3] ?? '';
    const selfClosing = /\/\s*>$/.test(m[0]);
    i = lt + m[0].length;

    if (!ALLOWED_ELEMENTS.has(name)) continue; // disallowed tag → dropped (children still scanned)

    if (closing) {
      out.push(`</${name}>`);
      if (name === 'svg') {
        svgDepth -= 1;
        if (svgDepth <= 0) rootClosed = true; // ignore anything after the root </svg>
      }
    } else {
      const attrs = sanitiseAttributes(rawAttrs);
      out.push(selfClosing ? `<${name}${attrs}/>` : `<${name}${attrs}>`);
      if (name === 'svg' && !selfClosing) svgDepth += 1;
    }
  }

  const result = out.join('').trim();
  return result.startsWith('<svg') ? result : null;
}
