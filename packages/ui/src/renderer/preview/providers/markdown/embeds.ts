/**
 * 054 — Mermaid file embeds in a Markdown preview (manual test decision, 2026-10-11).
 *
 * `![[diagram.mmd]]` and `![alt](diagram.mmd)` render as a PLACEHOLDER span carrying the reference; the body
 * reads the file through main (`readEmbeds`, confined to the project) and draws it as an inline diagram, the
 * same way a ```` ```mermaid ```` fence is drawn. Nothing else changes meaning:
 *
 * - `[x](diagram.mmd)` and `[[diagram.mmd]]` stay LINKS (no `!`);
 * - `![alt](photo.png)` stays an image, and `![[note.md]]` stays literal text (047 FR-056) — only a Mermaid
 *   extension embeds (`isMermaidEmbedRef`).
 *
 * The reference is carried URI-encoded with no scheme, so the sanitiser's URI test admits it (as the wikilink
 * href body is, `wikilinks.ts`).
 */
import type { MarkdownIt as MarkdownItInstance, StateInline } from 'markdown-it';
import { isImageEmbedRef, isMermaidEmbedRef, parseImageEmbedAlias, parseWikilink, relPathUnderRoot, wikiEmbedRef } from '@throng/core';
import { DIAGRAM_HEIGHT_ATTRIBUTE, DIAGRAM_PENDING_ATTRIBUTE, parseDiagramHeight } from '../../diagram/diagram-host.js';
import { logCaught, logExpected } from '@throng/core';
import { WIKI_HREF_ATTRIBUTE, WIKI_INDEX_ATTRIBUTE } from './wikilinks.js';
import { assetUrl, BLOCKED_IMAGE_ATTRIBUTE } from './sanitise.js';

/** The placeholder's attribute: the reference as written, URI-encoded. */
export const EMBED_ATTRIBUTE = 'data-throng-embed';

const BANG = 0x21; // !
const OPEN = 0x5b; // [

/** `![[x.mmd]]` — matched at the `!`, before the standard image rule. Anything else falls through. */
function embedRule(state: StateInline, silent: boolean): boolean {
  const { src, posMax } = state;
  const start = state.pos;
  if (src.charCodeAt(start) !== BANG || src.charCodeAt(start + 1) !== OPEN || src.charCodeAt(start + 2) !== OPEN) return false;
  if (state.linkLevel > 0) return false;
  const close = src.indexOf(']]', start + 3);
  if (close === -1 || close > posMax) return false;
  const target = parseWikilink(src.slice(start + 3, close));
  if (target === null || target.fragment !== null) return false;
  const ref = (target.rooted ? '/' : '') + target.path;
  if (isImageEmbedRef(ref)) {
    // 068 FR-010 – FR-015 — an image embed is markdown-it's own `image` token, so the sanitiser's image hook
    // (containment, the asset route, the alt-text fallback) handles it like `![alt](path)`. The alias is the
    // alt text; with none it is the file name, extension included.
    if (!silent) {
      // 068 FR-056 (supersedes FR-015) — a last `|W` / `|WxH` segment is Obsidian's size, drawn as width/height
      // (the sanitiser keeps them on an embed only); the alt text is what comes before it, else the file name.
      const parsed = parseImageEmbedAlias(target.alias);
      const alt = parsed.alt ?? target.path.slice(target.path.lastIndexOf('/') + 1);
      const token = state.push('image', 'img', 0);
      token.attrs = [
        ['src', state.md.normalizeLink(ref)],
        ['alt', ''],
        ...(parsed.width === null ? [] : [['width', String(parsed.width)] as [string, string]]),
        ...(parsed.height === null ? [] : [['height', String(parsed.height)] as [string, string]]),
        // The reference travels as a wikilink body so the pipeline batches it with the wikilinks to main
        // (`pipeline.ts`): which of the document folder / project root holds the file is main's answer, and
        // the sanitiser HOLDS the image with no `src` until it comes (`sanitise.ts`'s `onImage`).
        [WIKI_HREF_ATTRIBUTE, encodeURIComponent(ref)],
      ];
      token.content = alt;
      const text = new state.Token('text', '', 0);
      text.content = alt;
      token.children = [text];
    }
    state.pos = close + 2;
    return true;
  }
  if (!isMermaidEmbedRef(ref)) return false; // ![[note.md]] stays literal (047 FR-056)
  if (!silent) {
    const token = state.push('throng_embed', 'span', 0);
    // FR-046m — a whole-number alias is Obsidian's size slot, read as the box height; any other is a title.
    const height = parseDiagramHeight(target.alias?.trim());
    token.meta = { ref, alt: height === null ? (target.alias ?? '') : '', height, wiki: true };
  }
  state.pos = close + 2;
  return true;
}

/** 068 FR-013 — marks the `![[ ]]` spelling (presence only): it falls back to the project root; `![alt](x.mmd)` does not. */
export const EMBED_WIKI_ATTRIBUTE = 'data-throng-embed-wiki';

function placeholder(md: MarkdownItInstance, ref: string, alt: string, height: number | null = null, wiki = false): string {
  const title = alt.length > 0 ? ` title="${md.utils.escapeHtml(alt)}"` : '';
  const size = height === null ? '' : ` ${DIAGRAM_HEIGHT_ATTRIBUTE}="${height}"`;
  const spelling = wiki ? ` ${EMBED_WIKI_ATTRIBUTE}` : '';
  return `<span ${EMBED_ATTRIBUTE}="${md.utils.escapeHtml(encodeURIComponent(ref))}"${spelling} ${DIAGRAM_PENDING_ATTRIBUTE}${title}${size}></span>`;
}

/** Install both embed spellings on `md` (`pipeline.ts`'s `createMarkdownIt`). */
export function installEmbeds(md: MarkdownItInstance): void {
  md.inline.ruler.before('image', 'throng_embed', embedRule);
  md.renderer.rules.throng_embed = (tokens, idx) => {
    const meta = tokens[idx].meta as { ref: string; alt: string; height: number | null; wiki?: boolean };
    return placeholder(md, meta.ref, meta.alt, meta.height, meta.wiki === true);
  };
  const image = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = String(token.attrGet('src') ?? '');
    if (isMermaidEmbedRef(src)) {
      let ref = src;
      try {
        ref = decodeURI(src); // markdown-it percent-encodes the destination; carry it as written
      } catch (error) {
        // keep the encoded form
        logExpected('embeds: decode an embed destination', 'the document may carry a malformed percent-escape; the encoded form is kept', error);
      }
      return placeholder(md, ref, self.renderInlineAsText(token.children ?? [], options, env));
    }
    return image ? image(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
  };
}

/**
 * 068 FR-011, FR-012 — apply main's answer to each held image embed (`<img data-throng-wiki-index>`, no
 * `src`): the file it resolved to inside the project draws from the asset route exactly as a standard
 * image does; no file, or one outside the project (Principle I), is marked for the alt-text fallback.
 * `resolved` is the batch `applyWikiResolution` also reads. Returns the images marked, for the body to
 * replace with their alt text.
 */
export function applyImageEmbedResolution(
  root: HTMLElement,
  resolved: readonly (string | null)[],
  projectRoot: string,
  panelId: string,
): HTMLImageElement[] {
  const refused: HTMLImageElement[] = [];
  for (const img of root.querySelectorAll<HTMLImageElement>(`img[${WIKI_INDEX_ATTRIBUTE}]`)) {
    const index = Number(img.getAttribute(WIKI_INDEX_ATTRIBUTE));
    const found = Number.isInteger(index) && index >= 0 && index < resolved.length ? resolved[index] : null;
    const relPath = found === null || found === undefined || projectRoot.length === 0 ? null : relPathUnderRoot(projectRoot, found);
    if (relPath === null) {
      img.setAttribute(BLOCKED_IMAGE_ATTRIBUTE, '');
      refused.push(img);
    } else {
      img.setAttribute('src', assetUrl(panelId, relPath));
    }
  }
  return refused;
}

/**
 * The reference a placeholder asks main to read: {@link embedRefOf}, flagged with its spelling (068 FR-013,
 * `wikiEmbedRef`) so main knows whether the project root is a fallback. Also the key of the draw's read cache.
 */
export function embedReadRefOf(el: Element): string | null {
  const ref = embedRefOf(el);
  return ref !== null && el.hasAttribute(EMBED_WIKI_ATTRIBUTE) ? wikiEmbedRef(ref) : ref;
}

/** The reference a placeholder carries, or `null` when the attribute is missing or malformed. */
export function embedRefOf(el: Element): string | null {
  const raw = el.getAttribute(EMBED_ATTRIBUTE);
  if (raw === null) return null;
  try {
    return decodeURIComponent(raw);
  } catch (error) {
    // The attribute is written by `placeholder` with `encodeURIComponent`, so one that does not decode is a surprise.
    logCaught('embeds: decode an embed placeholder', error);
    return null;
  }
}
