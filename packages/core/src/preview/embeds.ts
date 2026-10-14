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
