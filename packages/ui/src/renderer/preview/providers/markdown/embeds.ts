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
import { isMermaidEmbedRef, parseWikilink } from '@throng/core';
import { DIAGRAM_HEIGHT_ATTRIBUTE, DIAGRAM_PENDING_ATTRIBUTE, parseDiagramHeight } from '../../diagram/diagram-host.js';

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
  if (!isMermaidEmbedRef(ref)) return false; // ![[note.md]] stays literal (047 FR-056)
  if (!silent) {
    const token = state.push('throng_embed', 'span', 0);
    // FR-046m — a whole-number alias is Obsidian's size slot, read as the box height; any other is a title.
    const height = parseDiagramHeight(target.alias?.trim());
    token.meta = { ref, alt: height === null ? (target.alias ?? '') : '', height };
  }
  state.pos = close + 2;
  return true;
}

function placeholder(md: MarkdownItInstance, ref: string, alt: string, height: number | null = null): string {
  const title = alt.length > 0 ? ` title="${md.utils.escapeHtml(alt)}"` : '';
  const size = height === null ? '' : ` ${DIAGRAM_HEIGHT_ATTRIBUTE}="${height}"`;
  return `<span ${EMBED_ATTRIBUTE}="${md.utils.escapeHtml(encodeURIComponent(ref))}" ${DIAGRAM_PENDING_ATTRIBUTE}${title}${size}></span>`;
}

/** Install both embed spellings on `md` (`pipeline.ts`'s `createMarkdownIt`). */
export function installEmbeds(md: MarkdownItInstance): void {
  md.inline.ruler.before('image', 'throng_embed', embedRule);
  md.renderer.rules.throng_embed = (tokens, idx) => {
    const meta = tokens[idx].meta as { ref: string; alt: string; height: number | null };
    return placeholder(md, meta.ref, meta.alt, meta.height);
  };
  const image = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = String(token.attrGet('src') ?? '');
    if (isMermaidEmbedRef(src)) {
      let ref = src;
      try {
        ref = decodeURI(src); // markdown-it percent-encodes the destination; carry it as written
      } catch {
        // keep the encoded form
      }
      return placeholder(md, ref, self.renderInlineAsText(token.children ?? [], options, env));
    }
    return image ? image(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
  };
}

/** The reference a placeholder carries, or `null` when the attribute is missing or malformed. */
export function embedRefOf(el: Element): string | null {
  const raw = el.getAttribute(EMBED_ATTRIBUTE);
  if (raw === null) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
