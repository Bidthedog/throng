/**
 * 054 — embedding a Mermaid file in a Markdown preview (manual test decision, 2026-10-11).
 *
 * Two spellings embed: `![[diagram.mmd]]` (the wikilink embed form) and `![alt](diagram.mmd)` (image
 * syntax). Both name the file as a REFERENCE written the way an image's is: relative to the document's
 * folder, or to the project root with a leading `/`. A link to the same file — `[x](diagram.mmd)` or
 * `[[diagram.mmd]]` — stays a link, and an embed of any other kind of file stays exactly what it was
 * (an image, or literal text), so nothing here changes how a normal file link behaves.
 *
 * Pure: main resolves and reads the file (`PreviewService.readEmbeds`), confined to the run's project.
 */

/** The extensions a Mermaid embed may name — the Mermaid preview provider's own. */
export const MERMAID_EMBED_EXTENSIONS: readonly string[] = ['.mmd', '.mermaid'];

/** At most this many embeds are read for one draw; the rest show their not-found notice. */
export const MAX_EMBEDS_PER_READ = 50;

/** The longest reference a read accepts. */
export const MAX_EMBED_REF_LENGTH = 1024;

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Whether `ref` (an image `src`, or a wikilink embed's target) names a Mermaid file to embed: no scheme, no
 * network reference, and a Mermaid extension once any `?query` or `#fragment` is set aside. Case-insensitive.
 */
export function isMermaidEmbedRef(ref: string): boolean {
  const text = ref.trim();
  if (text.length === 0 || text.length > MAX_EMBED_REF_LENGTH) return false;
  if (SCHEME.test(text) || text.startsWith('//') || text.startsWith('#')) return false;
  const path = text.split(/[?#]/, 1)[0] ?? '';
  const lower = path.toLowerCase();
  return MERMAID_EMBED_EXTENSIONS.some((ext) => lower.endsWith(ext) && lower.length > ext.length);
}

/**
 * 068 FR-010 — the image types a preview may draw, by extension, with the MIME type the asset route
 * serves each as (contracts/preview-ipc.md §4). One table: the protocol's allowlist and the embed rule
 * both read it, so a type added here is added everywhere. `image/apng` and `application/pdf` are
 * deliberately absent.
 */
export const PREVIEW_IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

/** The extensions of {@link PREVIEW_IMAGE_MIME_BY_EXTENSION}. */
export const PREVIEW_IMAGE_EXTENSIONS: readonly string[] = Object.keys(PREVIEW_IMAGE_MIME_BY_EXTENSION);

/**
 * Whether `ref` (a wikilink embed's target) names an image the preview can draw (068 FR-010, FR-014):
 * a known image extension, any case, on a non-empty file name. `![[note.md]]` and `![[a.pdf]]` are not.
 */
export function isImageEmbedRef(ref: string): boolean {
  const text = ref.trim();
  if (text.length === 0 || text.length > MAX_EMBED_REF_LENGTH) return false;
  const lower = (text.split(/[?#]/, 1)[0] ?? '').toLowerCase();
  return PREVIEW_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext) && lower.length > ext.length);
}

/** An image embed's alias, read for Obsidian's size forms (068 FR-056). `null` fields are absent, never `0`. */
export interface ImageEmbedAlias {
  /** The alt text written, or `null` when none was (the caller falls back to the file name, FR-010). */
  alt: string | null;
  /** CSS pixels wide, or `null`. */
  width: number | null;
  /** CSS pixels high, or `null`. */
  height: number | null;
}

const IMAGE_SIZE = /^(\d{1,5})(?:x(\d{1,5}))?$/;

/**
 * 068 FR-056 (supersedes FR-015) — the text after `|` in `![[image.png|…]]`. A LAST `|` segment of the form `W`
 * is a width and `WxH` a width and a height; the alt text is the segment(s) before it, when there are any. Any
 * other last segment stays the alt text. A dimension of `0` is no size [derived]: it is dropped, and the
 * segment still counts as a size form, so `|0` is never alt text.
 */
export function parseImageEmbedAlias(alias: string | null): ImageEmbedAlias {
  if (alias === null) return { alt: null, width: null, height: null };
  const cut = alias.lastIndexOf('|');
  const last = alias.slice(cut + 1).trim();
  const size = IMAGE_SIZE.exec(last);
  if (size === null) {
    const alt = alias.trim();
    return { alt: alt.length > 0 ? alt : null, width: null, height: null };
  }
  const before = cut < 0 ? '' : alias.slice(0, cut).trim();
  const width = Number(size[1]);
  const height = size[2] === undefined ? 0 : Number(size[2]);
  return {
    alt: before.length > 0 ? before : null,
    width: width > 0 ? width : null,
    height: height > 0 ? height : null,
  };
}

/**
 * 068 FR-066 — the same size forms on a STANDARD image: a last `|W` or `|WxH` segment of its destination
 * (`![alt](path.png|200)`) or of its alt text (`![alt|200](path.png)`). Returns what came before that segment
 * and the size, or `null` when the last segment is not a size form or nothing precedes it (the text is then
 * used as written). A dimension of `0` is dropped and the segment still removed [derived, as FR-056].
 */
export function splitTrailingImageSize(text: string): { rest: string; width: number | null; height: number | null } | null {
  const cut = text.lastIndexOf('|');
  if (cut <= 0) return null;
  const size = IMAGE_SIZE.exec(text.slice(cut + 1).trim());
  if (size === null) return null;
  const width = Number(size[1]);
  const height = size[2] === undefined ? 0 : Number(size[2]);
  return { rest: text.slice(0, cut), width: width > 0 ? width : null, height: height > 0 ? height : null };
}

/**
 * 068 FR-013 (research D3) — the SPELLING flag. `![[x.mmd]]` falls back to the project root when the
 * document's folder has no such file; `![alt](x.mmd)` keeps 054 FR-049b's image-path rule (the document's
 * folder only). The flag rides IN the reference a read carries, as a scheme prefix: a real reference never
 * has one (`isMermaidEmbedRef` refuses any scheme), so it cannot collide with a file name, and the answer's
 * `ref` echoes it, which keeps the two spellings of one reference apart in the renderer's cache.
 */
const WIKI_EMBED_PREFIX = 'throng-wiki:';

/** `ref` as the `![[ ]]` spelling sends it to a read. */
export function wikiEmbedRef(ref: string): string {
  return `${WIKI_EMBED_PREFIX}${ref}`;
}

/** A read's reference → the reference as written, and whether it was the `![[ ]]` spelling. */
export function splitEmbedRef(wire: string): { ref: string; wiki: boolean } {
  return wire.startsWith(WIKI_EMBED_PREFIX)
    ? { ref: wire.slice(WIKI_EMBED_PREFIX.length), wiki: true }
    : { ref: wire, wiki: false };
}

/** Why an embed could not be shown — each drawn as one inline notice where the diagram would be. */
export type EmbedRefusal = 'missing' | 'outside' | 'unsupported' | 'unreadable' | 'too-large';

/** One embed's answer, in the order the references were asked for. */
export type PreviewEmbedRead = { ref: string; ok: true; text: string } | { ref: string; ok: false; reason: EmbedRefusal };

/** The notice an embed refusal draws, naming the reference as written. */
export function embedRefusalText(ref: string, reason: EmbedRefusal): string {
  switch (reason) {
    case 'missing':
      return `Embedded diagram not found: ${ref}`;
    case 'outside':
      return `Embedded diagram is outside the project: ${ref}`;
    case 'unsupported':
      return `Not a Mermaid file: ${ref}`;
    case 'too-large':
      return `Embedded diagram is too large to show: ${ref}`;
    default:
      return `Embedded diagram could not be read: ${ref}`;
  }
}
