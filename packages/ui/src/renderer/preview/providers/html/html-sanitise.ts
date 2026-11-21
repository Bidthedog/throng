/**
 * The HTML preview's own sanitiser profile (074 FR-072 – FR-082, FR-090; research R6, steps 1–4).
 *
 * A page is shown as STATIC MARKUP in a sandboxed, opaque-origin `srcdoc` frame (`html-body.tsx`). This module
 * turns the file's text into that frame's document, and is the first of the four independent layers (FR-091):
 *
 * 1. **Remove what runs or escapes** — DOMPurify, `WHOLE_DOCUMENT`, with a profile of its own (never the Markdown
 *    one in `markdown/sanitise.ts`): no script, noscript, frame, object, embed, applet, portal, base or meta; no
 *    `on*` attribute or `javascript:` URL; no form `action`/`formaction`, `target`, `ping`, `srcdoc`, `autofocus`;
 *    no `<link>` but a stylesheet. Whether anything script-like was there is reported for FR-081's notice.
 * 2. **Rewrite every resource URL** — `src`, `srcset`, `poster`, a stylesheet's `href`, an SVG `href`, and `url()` /
 *    `@import` in `<style>` and `style=""`. A relative URL resolves against the file's folder (a root-absolute one
 *    against the project root) to `throng-preview://asset/<panelId>/<root-relative path>`, one path segment at a
 *    time, so a served stylesheet's own relative `url()` resolves to the same route. A path that climbs out of the
 *    project, and anything absolute (`http:`, `https:`, `//host`, `data:`, `file:`), is dropped.
 * 3. **Rewrite every link** but a `#fragment` to `throng-preview://follow/<panelId>?href=<link>`, titled as every
 *    preview titles a link. A plain click navigates the frame to that route, which answers 204 (nothing happens);
 *    a Ctrl+click reaches main's window-open guard, which hands it back to the panel to follow (FR-079). A
 *    `#fragment` link keeps its href and gets the same kind of title; the body follows it (`frame-fragments.ts`).
 * 4. **Inject the frame's own CSP** first in `<head>`, on top of the policy the `srcdoc` document inherits, and the
 *    themed default colours at zero specificity, so the page's own rules always win (FR-082).
 *
 * Pure apart from the DOM it is handed; no I/O.
 */
import DOMPurify, { type WindowLike } from 'dompurify';
import { classifyPreviewLink, logExpected, matchesSafeSource, relPathUnderRoot, sourceOf } from '@throng/core';
import { previewLinkHoverText } from '../../link-dom.js';
import { primaryModifierLabel } from '../../../config/host-modifiers.js';

/** The frame document's own policy (FR-075): the preview protocol and the page's inline style, nothing else. */
export const FRAME_CSP =
  "default-src 'none'; img-src throng-preview:; style-src 'unsafe-inline' throng-preview:; font-src throng-preview:; media-src throng-preview:";

/**
 * 074 FR-072a — the frame's policy for a page whose panel trusts `sources` (canonical, from `safeSourceList`): images,
 * stylesheets and fonts may also come from them. Never a script source, whatever is listed.
 */
export function frameCsp(sources: readonly string[]): string {
  if (sources.length === 0) return FRAME_CSP;
  const extra = ` ${sources.join(' ')}`;
  return `default-src 'none'; img-src throng-preview:${extra}; style-src 'unsafe-inline' throng-preview:${extra}; font-src throng-preview:${extra}; media-src throng-preview:`;
}

/** What a page asked for, as far as the notice is concerned (FR-093a). */
export type BlockedKind = 'image' | 'stylesheet' | 'font' | 'media' | 'script' | 'other';

/** 074 FR-093a — one remote resource the page names that the preview did not load. */
export interface BlockedResource {
  /** As the page wrote it. */
  url: string;
  kind: BlockedKind;
  /** The origin that would allow it (`https://cdn.example.com`). */
  source: string;
  /** Whether adding `source` to a safe list would load it: an `https:` stylesheet, font or image only. */
  allowable: boolean;
}

export interface HtmlPageContext {
  /** The preview panel whose run the asset and follow routes are keyed by. */
  panelId: string;
  /** The page's own path: relative resources resolve against its folder. */
  docPath: string;
  /** The project the page may load from; nothing outside it is named. */
  projectRoot: string;
  /** FR-082 — concrete colours (the frame cannot see the renderer's CSS variables), applied where the page sets none. */
  defaults?: { background: string; text: string };
  /** 074 FR-072a — the panel's Safe HTML preview sources (global ∪ project), canonical. Absent = none. */
  safeSources?: readonly string[];
}

export interface SanitisedHtmlPage {
  /** The frame's whole document, doctype included, for `srcdoc`. */
  html: string;
  /** FR-081 — the page carried script (an element, a handler or a `javascript:` URL) that was removed. */
  scriptsRemoved: boolean;
  /** 074 FR-093a — every remote resource the page names that was left out, once each, in document order. */
  blocked: BlockedResource[];
}

/** The window the page is parsed and purified in: one that has a `DOMParser` (the renderer's, or jsdom's). */
type ParsingWindow = Window & { DOMParser: typeof DOMParser };

const FORBID_TAGS = ['script', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal', 'base', 'meta'];
const FORBID_ATTR = ['action', 'formaction', 'target', 'ping', 'srcdoc', 'autofocus', 'http-equiv'];
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Whether the page as written carried anything that would run (FR-081). Parsed inertly: nothing here executes. */
function carriesScript(source: string, win: ParsingWindow): boolean {
  const doc = new win.DOMParser().parseFromString(source, 'text/html');
  if (doc.querySelector('script') !== null) return true;
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of el.attributes) {
      if (attr.name.toLowerCase().startsWith('on')) return true;
      if (/^\s*javascript:/i.test(attr.value)) return true;
    }
  }
  return false;
}

/** The asset-route URL for `raw` as the page wrote it, or `null` when it may not load (absolute, outside, empty). */
function assetUrl(raw: string, ctx: HtmlPageContext): string | null {
  const value = raw.trim();
  if (value === '' || value.startsWith('#') || value.startsWith('//') || SCHEME.test(value)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value.replace(/[?#].*$/, ''));
  } catch (error) {
    logExpected('html-sanitise: decode a resource URL', 'a page may carry a malformed percent escape; it names no file', error);
    return null;
  }
  const docRel = relPathUnderRoot(ctx.projectRoot, ctx.docPath);
  if (docRel === null) return null;
  const segments = decoded.startsWith('/') ? [] : docRel.split('/').slice(0, -1);
  for (const segment of decoded.replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      // Climbing past the project root names nothing it may load (FR-073).
      if (segments.length === 0) return null;
      segments.pop();
    } else segments.push(segment);
  }
  if (segments.length === 0) return null;
  return `throng-preview://asset/${encodeURIComponent(ctx.panelId)}/${segments.map(encodeURIComponent).join('/')}`;
}

/** Whether `raw` names something off the machine: `http:`, `https:` or protocol-relative. */
function isRemote(raw: string): boolean {
  return /^(?:https?:)?\/\//i.test(raw.trim());
}

const FONT_FILE = /\.(?:woff2?|ttf|otf|eot)(?:[?#]|$)/i;

/**
 * Resolves each resource reference once: a local one to the asset route, a remote one from a safe source to itself
 * (FR-072a), anything else to `null` — recording a remote one left out (FR-093a).
 */
class Resolver {
  readonly blocked: BlockedResource[] = [];
  private readonly seen = new Set<string>();

  constructor(private readonly ctx: HtmlPageContext) {}

  resolve(raw: string, kind: BlockedKind): string | null {
    const value = raw.trim();
    if (!isRemote(value)) return assetUrl(value, this.ctx);
    const absolute = value.startsWith('//') ? `https:${value}` : value;
    const loadable = kind === 'image' || kind === 'stylesheet' || kind === 'font';
    if (loadable && matchesSafeSource(absolute, this.ctx.safeSources ?? [])) return absolute;
    this.record(value, kind);
    return null;
  }

  record(url: string, kind: BlockedKind): void {
    const key = `${kind} ${url}`;
    const source = sourceOf(url);
    if (source === null || this.seen.has(key)) return;
    this.seen.add(key);
    const allowable = source.startsWith('https:') && (kind === 'image' || kind === 'stylesheet' || kind === 'font');
    this.blocked.push({ url, kind, source, allowable });
  }
}

/** `url()` and `@import` in a stylesheet's text, rewritten; a reference that may not load is removed. */
function rewriteCss(css: string, r: Resolver): string {
  // An @import names a stylesheet, quoted or in url(), so it is resolved first: the general url() pass below would
  // otherwise take it for an image or a font (FR-093a lists each left-out resource by its kind).
  const imports = css
    .replace(
      /@import\s+(?:url\(\s*(['"]?)([^'")]*)\1\s*\)|(['"])([^'"]*)\3)/gi,
      (_whole, _q1: string, inUrl: string | undefined, _q2: string, quoted: string | undefined) => {
        const kept = r.resolve(inUrl ?? quoted ?? '', 'stylesheet');
        return kept === null ? '@import none' : `@import url("${kept}")`;
      },
    )
    .replace(/@import\s+none[^;]*;?/gi, '');
  // Every url() but an @import's, which the pass above already resolved: no placeholder a page could forge.
  return imports.replace(/(?<!@import\s*)url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (whole, _q: string, ref: string) => {
    if (ref.trim().startsWith('#')) return whole; // an SVG paint-server or filter reference, inside the page
    const kept = r.resolve(ref, FONT_FILE.test(ref) ? 'font' : 'image');
    return kept === null ? 'none' : `url("${kept}")`;
  });
}

/** A `srcset`'s loadable candidates, rewritten; the rest dropped. */
function rewriteSrcset(srcset: string, r: Resolver): string {
  return srcset
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/))
    .map(([url, ...descriptors]) => {
      const kept = url === undefined ? null : r.resolve(url, 'image');
      return kept === null ? null : [kept, ...descriptors].join(' ');
    })
    .filter((c): c is string => c !== null)
    .join(', ');
}

/** What a `src` names, by the element carrying it. */
function srcKind(el: Element): BlockedKind {
  const tag = el.localName;
  if (tag === 'img' || tag === 'image' || tag === 'input') return 'image';
  if (tag === 'source') return el.parentElement?.localName === 'picture' ? 'image' : 'media';
  if (tag === 'video' || tag === 'audio' || tag === 'track') return 'media';
  return 'other';
}

/** 074 FR-093a — remote things DOMPurify will remove outright, read from the page as written (inertly). */
function recordRemovedRemote(source: string, win: ParsingWindow, r: Resolver): void {
  const doc = new win.DOMParser().parseFromString(source, 'text/html');
  for (const el of doc.querySelectorAll('script[src]')) {
    const src = el.getAttribute('src') ?? '';
    if (isRemote(src)) r.record(src.trim(), 'script');
  }
  for (const el of doc.querySelectorAll('iframe[src], frame[src], object[data], embed[src]')) {
    const src = el.getAttribute('src') ?? el.getAttribute('data') ?? '';
    if (isRemote(src)) r.record(src.trim(), 'other');
  }
}

function setOrRemove(el: Element, name: string, value: string | null): void {
  if (value === null || value === '') el.removeAttribute(name);
  else el.setAttribute(name, value);
}

/** Sanitise and rewrite `source` into the frame's document (see the module comment). Never throws. */
export function sanitiseHtmlPage(source: string, ctx: HtmlPageContext, win: ParsingWindow = window): SanitisedHtmlPage {
  const scriptsRemoved = carriesScript(source, win);
  const r = new Resolver(ctx);
  recordRemovedRemote(source, win, r);
  const purify = DOMPurify(win as unknown as WindowLike);
  const clean = purify.sanitize(source, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['link', 'style'],
    ADD_ATTR: ['srcset', 'poster'],
    FORBID_TAGS,
    FORBID_ATTR,
  });
  const doc = new win.DOMParser().parseFromString(clean, 'text/html');

  // 1. A <link> stays only as a stylesheet, local or from a safe source.
  for (const link of [...doc.querySelectorAll('link')]) {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
    const href = rel.includes('stylesheet') ? r.resolve(link.getAttribute('href') ?? '', 'stylesheet') : null;
    if (href === null) link.remove();
    else {
      for (const attr of [...link.attributes]) if (attr.name !== 'rel' && attr.name !== 'href' && attr.name !== 'media') link.removeAttribute(attr.name);
      link.setAttribute('rel', 'stylesheet');
      link.setAttribute('href', href);
    }
  }

  // 2. Resources and links.
  for (const el of doc.querySelectorAll('*')) {
    if (el.hasAttribute('src')) setOrRemove(el, 'src', r.resolve(el.getAttribute('src') ?? '', srcKind(el)));
    if (el.hasAttribute('poster')) setOrRemove(el, 'poster', r.resolve(el.getAttribute('poster') ?? '', 'image'));
    if (el.hasAttribute('srcset')) setOrRemove(el, 'srcset', rewriteSrcset(el.getAttribute('srcset') ?? '', r));
    if (el.hasAttribute('style')) el.setAttribute('style', rewriteCss(el.getAttribute('style') ?? '', r));
    if (el.namespaceURI === SVG_NS) {
      for (const [ns, name] of [[null, 'href'], [XLINK_NS, 'href']] as const) {
        const value = ns === null ? el.getAttribute(name) : el.getAttributeNS(ns, name);
        if (value === null || value.trim().startsWith('#')) continue;
        const local = el.localName === 'a' ? null : r.resolve(value, 'image');
        if (ns === null) setOrRemove(el, name, local);
        else if (local === null) el.removeAttributeNS(ns, name);
        else el.setAttributeNS(ns, `xlink:${name}`, local);
      }
    }
  }
  for (const style of doc.querySelectorAll('style')) style.textContent = rewriteCss(style.textContent ?? '', r);
  for (const anchor of doc.querySelectorAll('a[href], area[href]')) {
    const href = anchor.getAttribute('href') ?? '';
    if (href.trim().startsWith('#')) {
      // A same-page link stays a fragment; the body follows it on the gesture only (`frame-fragments.ts`, FR-079).
      const hover = previewLinkHoverText({ kind: 'heading', fragment: href.trim().slice(1) }, primaryModifierLabel());
      if (hover !== '') anchor.setAttribute('title', hover);
      continue;
    }
    if (href.trim() === '') {
      anchor.removeAttribute('href');
      continue;
    }
    anchor.setAttribute('href', `throng-preview://follow/${encodeURIComponent(ctx.panelId)}?href=${encodeURIComponent(href)}`);
    // 074 convergence T067 — the hover in every preview's words: what following it does, under the platform's modifier.
    const hover = previewLinkHoverText(classifyPreviewLink(href, { docPath: ctx.docPath, projectRoot: ctx.projectRoot }), primaryModifierLabel());
    if (hover !== '') anchor.setAttribute('title', hover);
  }

  // 4. The frame's own policy first, then the themed defaults, ahead of every page rule.
  const head = doc.head;
  if (ctx.defaults !== undefined) {
    const defaults = doc.createElement('style');
    defaults.textContent = `:where(html) { background: ${ctx.defaults.background}; color: ${ctx.defaults.text}; }`;
    head.prepend(defaults);
  }
  const csp = doc.createElement('meta');
  csp.setAttribute('http-equiv', 'Content-Security-Policy');
  csp.setAttribute('content', frameCsp(ctx.safeSources ?? []));
  head.prepend(csp);

  return { html: `<!doctype html>${doc.documentElement.outerHTML}`, scriptsRemoved, blocked: r.blocked };
}
