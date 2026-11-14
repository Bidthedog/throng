/**
 * The `throng_wikilinks` markdown-it inline rule (047 T061, R12, FR-050, FR-056).
 *
 * Recognises `[[Target]]`, `[[Target|Alias]]`, `[[Target#Heading]]`, `[[#Heading]]` and
 * `[[Target#^block]]` and emits an ordinary `link_open` / `text` / `link_close` triplet — the sanitiser
 * never learns a wikilink was involved (`sanitise.ts`'s `onLink` classifies `href` through
 * `classifyPreviewLink`, which already has core's wiki case, R12). `![[…]]` (an embed — `embeds.ts`
 * owns it) and `[[…]]` malformed per core's `parseWikilink` are left LITERAL: this rule declines to
 * match, and markdown-it's ordinary text handling renders the brackets as written.
 *
 * ══ CANDIDATE 0 IS PROVISIONAL (068 FR-002) ══
 *
 * The classification the sanitiser gives a wikilink targets candidate 0 only. Which candidate EXISTS is
 * main's answer (`resolveWikiTargets`), and {@link applyWikiResolution} rewrites each link's
 * `data-throng-link` to it — so styling, follow, Copy Link and the status bar all use the one decision.
 *
 * ══ NEVER INSIDE CODE (FR-050) ══
 *
 * Not handled here at all: markdown-it never runs an inline rule inside a `code_inline` span or a
 * fenced/indented code block — those are consumed whole by earlier rules (or never inline-tokenised in
 * the first place) before this one would ever see their contents.
 *
 * ══ THE HREF ENCODING (R12) ══
 *
 * The logical href is `throng-wiki:<path>#<fragment>` — the convention `classifyPreviewLink`'s
 * `classifyWiki` (`@throng/core`, `preview/links.ts`) decodes, sibling to how a plain relative href
 * already marks a ROOTED path with a leading `/`. `path`/`fragment` are each `encodeURIComponent`-
 * escaped as ONE unit (never per path segment), so `decodeURIComponent` on the reading side is the
 * exact inverse — a `/` inside the encoded path decodes back to `/` whether or not it was itself
 * escaped, and a literal `#` or `%` in a filename cannot be mistaken for the scheme's own fragment
 * separator.
 *
 * That full string is never written into the DOM as a real `href`, or as any attribute value DOMPurify
 * inspects — see {@link WIKI_HREF_ATTRIBUTE}.
 */
import type { MarkdownIt as MarkdownItInstance, StateInline } from 'markdown-it';
import { classifyResolvedWiki, parseWikilink, wikiDisplayText } from '@throng/core';
import { LINK_ATTRIBUTE, linkOf, serialiseLink } from '../../link-dom.js';
import { logCaught } from '@throng/core';

const OPEN = 0x5b; // [
const BANG = 0x21; // !

/** The scheme every wikilink href carries — shared with {@link decodeWikiHref} below. */
export const WIKI_SCHEME_PREFIX = 'throng-wiki:';

/**
 * The attribute the href's BODY (everything after `throng-wiki:`) travels in until the sanitiser
 * reconstructs the real href (`sanitise.ts`'s `onLink`).
 *
 * The `throng-wiki:` SCHEME never appears in this attribute's value, or in any attribute value
 * DOMPurify inspects at all — DOMPurify checks EVERY allowed attribute's value against
 * `ALLOWED_URI_REGEXP` (`sanitise.ts`'s `PROFILE`), by value, not only attributes it recognises by
 * NAME as URI-bearing (`href`, `src`, …). That regexp admits only `https:`, `mailto:`, `#` and a
 * colon-free value, so a bespoke scheme written into ANY attribute at markdown-it's output stage would
 * be stripped before `onLink` ever ran — exactly Layer 1's job for an unrecognised scheme on a REAL
 * link, applied here to an attribute name DOMPurify does not otherwise treat as a URI. The body alone
 * (both halves `encodeURIComponent`-escaped) never contains a raw colon, so it survives untouched; the
 * scheme is prepended back in `onLink`'s own code — never written as HTML text — before the string
 * reaches `classifyPreviewLink`. The same trick `assetUrl()` uses in reverse for an image's `src` (a
 * colon-free placeholder that survives sanitising, rewritten to the real address afterwards, in code,
 * once DOMPurify's own pass has finished).
 */
export const WIKI_HREF_ATTRIBUTE = 'data-throng-wiki-href';

/**
 * The attribute's BODY (no scheme) → the `{path, rooted}` `main`'s `resolveWikiTargets` (047 T062,
 * T063) wants. `null` when the path fails to decode (a malformed percent escape, which
 * `encodeURIComponent` itself never produces, so this is defensive rather than reachable from this
 * pipeline's own output).
 */
export function decodeWikiHref(body: string): { path: string; rooted: boolean } | null {
  const hashIndex = body.indexOf('#');
  const encodedPath = hashIndex < 0 ? body : body.slice(0, hashIndex);
  let path: string;
  try {
    path = decodeURIComponent(encodedPath);
  } catch (error) {
    logCaught('wikilinks: decode a wikilink href', error);
    return null;
  }
  const rooted = path.startsWith('/');
  return { path: rooted ? path.slice(1) : path, rooted };
}

/**
 * The attribute's BODY → the target as the author wrote it (`folder/sub/Target#Some Heading`, a rooted
 * one with its leading `/`) for the link's tooltip and the status bar (068 FR-004, FR-005): decoded, no
 * `throng-wiki:` scheme, no `%2F`. `null` when a part fails to decode.
 */
export function wikiHrefDisplayText(body: string): string | null {
  const hashIndex = body.indexOf('#');
  const target = decodeWikiHref(body);
  if (target === null) return null;
  let fragment: string | null = null;
  if (hashIndex >= 0 && hashIndex < body.length - 1) {
    try {
      fragment = decodeURIComponent(body.slice(hashIndex + 1));
    } catch (error) {
      logCaught('wikilinks: decode a wikilink fragment', error);
      return null;
    }
  }
  return wikiDisplayText({ path: target.path, rooted: target.rooted, fragment, alias: null });
}

/** The attribute {@link decodeWikiHref}'s caller (`pipeline.ts`) marks each wikilink `<a>` with. */
export const WIKI_INDEX_ATTRIBUTE = 'data-throng-wiki-index';

/** The class an unresolved wikilink carries (FR-055), styled from tokens in `markdown.css`. */
export const UNRESOLVED_CLASS = 'preview-link--unresolved';

/**
 * `resolved[i]` is `main`'s answer for the wikilink whose `<a>` carries
 * `data-throng-wiki-index="i"` (T062's `resolveWikiTargets`, in the SAME order `render()`'s
 * `wikiTargets` were collected) — `null` means no candidate exists on disk. Toggles
 * `preview-link--unresolved` accordingly; an index past the end of `resolved` (T062's 500-target cap)
 * is treated as unresolved, the same as a `null` answer.
 *
 * 068 FR-002, FR-006 — main's answer is the ONE decision. A resolved link's `data-throng-link` is
 * rewritten to `classifyResolvedWiki` of the answer (the fragment kept), so Ctrl+click, Ctrl+Enter, the
 * link menu's Open and Copy Link all read the file that EXISTS, never candidate 0 the sanitiser guessed.
 * An unresolved link keeps candidate 0, so the missing-target notice names the document-folder path
 * (FR-003). `projectRoot` is `''` for a run with no owning project, as everywhere in the pipeline.
 */
export function applyWikiResolution(
  root: HTMLElement,
  resolved: readonly (string | null)[],
  projectRoot: string,
): void {
  for (const el of root.querySelectorAll<HTMLElement>(`[${WIKI_INDEX_ATTRIBUTE}]`)) {
    if (el.tagName === 'IMG') continue; // an image embed: `applyImageEmbedResolution` (`embeds.ts`) owns it
    const index = Number(el.getAttribute(WIKI_INDEX_ATTRIBUTE));
    const found = Number.isInteger(index) && index >= 0 && index < resolved.length ? resolved[index] : null;
    el.classList.toggle(UNRESOLVED_CLASS, found === null || found === undefined);
    if (found === null || found === undefined) continue;
    const current = linkOf(el);
    if (current === null) continue;
    const fragment = current.kind === 'file' ? (current.fragment ?? null) : null;
    el.setAttribute(LINK_ATTRIBUTE, serialiseLink(classifyResolvedWiki(found, fragment, { docPath: '', projectRoot })));
  }
}

/** The text a segment like `sub/Note.md` or `sub/Note` displays as: `Note`, extension stripped. */
function nameOf(path: string): string {
  const segment = path.split(/[\\/]/).filter((s) => s.length > 0).pop() ?? '';
  const dot = segment.lastIndexOf('.');
  return dot > 0 ? segment.slice(0, dot) : segment;
}

function wikilinkRule(state: StateInline, silent: boolean): boolean {
  const { src, posMax } = state;
  const start = state.pos;
  if (src.charCodeAt(start) !== OPEN || src.charCodeAt(start + 1) !== OPEN) return false;
  // FR-056 — an embed (`![[…]]`) is out of scope and stays literal: decline so the `!` and both
  // bracket pairs fall through to ordinary text.
  if (start > 0 && src.charCodeAt(start - 1) === BANG) return false;
  // CommonMark: a link inside a link is invalid — the standard `link`/`image` rules honour the same
  // field, and a wikilink is no different.
  if (state.linkLevel > 0) return false;

  const close = src.indexOf(']]', start + 2);
  if (close === -1 || close > posMax) return false;

  const target = parseWikilink(src.slice(start + 2, close));
  if (target === null) return false; // malformed → literal (FR-050's implicit "otherwise")

  if (!silent) {
    const path = (target.rooted ? '/' : '') + target.path;
    // No `throng-wiki:` prefix here — see WIKI_HREF_ATTRIBUTE's own comment for why the scheme is
    // never written into an attribute value at all.
    const body = `${encodeURIComponent(path)}${target.fragment !== null ? `#${encodeURIComponent(target.fragment)}` : ''}`;
    const text = target.alias ?? (target.path.length > 0 ? nameOf(target.path) : (target.fragment ?? ''));

    state.linkLevel += 1;
    const open = state.push('link_open', 'a', 1);
    open.attrSet(WIKI_HREF_ATTRIBUTE, body);
    open.markup = 'throng-wikilink';

    const textToken = state.push('text', '', 0);
    textToken.content = text;

    state.push('link_close', 'a', -1);
    state.linkLevel -= 1;
  }

  state.pos = close + 2;
  return true;
}

/** Registers the rule ahead of the standard `link` rule (`pipeline.ts`'s `createMarkdownIt`). */
export function installWikilinks(md: MarkdownItInstance): void {
  md.inline.ruler.before('link', 'throng_wikilinks', wikilinkRule);
}
