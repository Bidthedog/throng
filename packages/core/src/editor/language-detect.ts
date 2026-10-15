/**
 * Language detection and the precedence chain (016 FR-002/FR-005a, widened by 055 FR-001–FR-008).
 *
 * Detection reads the NAME and never the content — no shebang, no doctype, no keyword sniffing. That
 * is why {@link detectLanguage} takes a path and has no parameter through which content could reach
 * it: the guarantee is expressed in the signature, not merely promised in a comment.
 *
 * Two built-in rungs: a FILENAME descriptor (an exact name, a single-wildcard pattern, or a name
 * inside a named folder — 055) and then the EXTENSION (016). Only a folder-qualified descriptor
 * looks past the basename, and then only at the immediate parent folder's name.
 *
 * Pure; no OS, no DOM, no I/O.
 */
import { LANGUAGES, PLAIN_TEXT_ID, isKnownLanguage, type LanguageDescriptor } from './languages.js';

/** Which rung of the precedence chain decided the language (FR-005a). */
export type LanguageSource = 'override' | 'user-mapping' | 'registry' | 'plaintext';

export interface LanguageResolution {
  /** {@link PLAIN_TEXT_ID} when nothing matched. */
  languageId: string;
  source: LanguageSource;
}

/**
 * Every declared suffix, longest first — so `types.d.ts` resolves `.d.ts` ahead of `.ts`
 * (FR-002b). Built once: the registry is immutable.
 */
const SUFFIXES: readonly { suffix: string; id: string }[] = suffixTable(LANGUAGES);

/** The final path segment of a Windows or POSIX path. */
function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut >= 0 ? path.slice(cut + 1) : path;
}

/**
 * True when the filename has no extension at all (016 FR-002b): no dot, or a dot only in first
 * position — `Makefile` and `.bazelignore` alike. The extension rung gives these plain text; the
 * filename rung in front of it is what claims the ones a descriptor names (055).
 */
function hasNoExtension(name: string): boolean {
  return name.indexOf('.', 1) === -1;
}

/** The language `name` (lower-cased basename) is claimed by through its extension, if any. */
function extensionMatch(name: string, suffixes: readonly { suffix: string; id: string }[]): string | undefined {
  if (hasNoExtension(name)) return undefined;
  return suffixes.find(({ suffix }) => name.endsWith(suffix))?.id;
}

/** A `prefix*suffix` filename pattern (055 FR-003). */
interface FilenamePattern {
  prefix: string;
  suffix: string;
  id: string;
}

/**
 * Build a matcher for the filename descriptors of `languages` (055 FR-002–FR-005, FR-003a, FR-008).
 * Exported so the rules can be proven against a fixture registry; the editor uses
 * {@link matchFilename}, built once from the shipped registry.
 *
 * Every entry is lower-case and takes one of three forms, told apart by a character:
 *   - `dockerfile`            exact — the whole basename;
 *   - `tsconfig.*.json`       pattern — one `*` for any run of characters, never a separator;
 *   - `.vscode/settings.json` folder-qualified — the basename AND its immediate parent folder.
 *
 * Exact and folder-qualified entries are tried first (FR-008). A pattern ending in `*` never claims
 * a basename that ends in an extension the registry claims (FR-003a): the trailing wildcard names a
 * VARIANT of the file (`.env.local`), while a known extension names its FORMAT (`.env.json`).
 */
export function createFilenameMatcher(languages: readonly LanguageDescriptor[]): (path: string) => string | undefined {
  const exact = new Map<string, string>();
  const patterns: FilenamePattern[] = [];
  for (const lang of languages) {
    for (const entry of lang.filenames ?? []) {
      const star = entry.indexOf('*');
      if (star < 0) exact.set(entry, lang.id);
      else patterns.push({ prefix: entry.slice(0, star), suffix: entry.slice(star + 1), id: lang.id });
    }
  }
  const suffixes = suffixTable(languages);

  return (path: string): string | undefined => {
    const normalised = path.replace(/\\/g, '/').toLowerCase();
    const segments = normalised.split('/');
    const name = segments[segments.length - 1] ?? '';
    if (name.length === 0) return undefined;
    const folder = segments.length > 1 ? segments[segments.length - 2] : undefined;

    const byName = (folder !== undefined ? exact.get(`${folder}/${name}`) : undefined) ?? exact.get(name);
    if (byName !== undefined) return byName;

    for (const { prefix, suffix, id } of patterns) {
      if (name.length < prefix.length + suffix.length) continue;
      if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue;
      if (suffix.length === 0 && extensionMatch(name, suffixes) !== undefined) continue;
      return id;
    }
    return undefined;
  };
}

/** Every declared suffix of `languages`, longest first (016 FR-002b). */
function suffixTable(languages: readonly LanguageDescriptor[]): readonly { suffix: string; id: string }[] {
  return languages
    .flatMap((lang) => lang.extensions.map((suffix) => ({ suffix, id: lang.id })))
    .sort((a, b) => b.suffix.length - a.suffix.length);
}

/**
 * The language a built-in filename descriptor claims for `path`, or undefined (055 FR-002–FR-008).
 * Accepts a bare name or a full path, with either separator. Reads the NAME only.
 */
export const matchFilename: (path: string) => string | undefined = createFilenameMatcher(LANGUAGES);

/**
 * Built-in detection: the filename rung, then the extension rung (longest declared suffix,
 * case-insensitive), then plain text. Reads the NAME only — never content (016 FR-002).
 */
export function detectLanguage(fileName: string): string {
  return matchFilename(fileName) ?? extensionMatch(baseName(fileName).toLowerCase(), SUFFIXES) ?? PLAIN_TEXT_ID;
}

export interface ResolveLanguageArgs {
  fileName: string;
  /** The document's persisted override, if it has one (highest precedence). */
  override?: string | null;
  /** The user's extension → language id remaps (`editor.languageByExtension`). */
  userMapping?: Readonly<Record<string, string>>;
}

/** The user's mapping for this filename's longest matching declared suffix, if any. */
function userMappedId(name: string, mapping: Readonly<Record<string, string>>): string | undefined {
  let best: { suffix: string; id: string } | undefined;
  for (const [rawSuffix, id] of Object.entries(mapping)) {
    const suffix = rawSuffix.toLowerCase();
    if (!name.endsWith(suffix)) continue;
    if (!best || suffix.length > best.suffix.length) best = { suffix, id };
  }
  return best?.id;
}

/**
 * Resolve the language to RENDER, highest precedence first (016 FR-005a, 055 FR-007):
 * document override → built-in filename match → user extension mapping → built-in extension match →
 * plain text.
 *
 * The filename match sits ABOVE the user's extension mapping: a whole name is more specific than any
 * extension, so mapping `.json` → JSON leaves `tsconfig.json` as JSON with Comments. Only the
 * document's own override changes a file a filename descriptor claims. Both built-in rungs report
 * `'registry'` — they are one registry, and the only consumer compares sources for change detection.
 *
 * Two rules that look alike and must never be conflated:
 *
 *   - An **explicit Plain Text** at any rung is a DECISION. It terminates the chain (FR-004c):
 *     the user said this file is plain text, and detection does not get to overrule them.
 *   - An **unresolvable id** — a language a later build removed, or an older build has not gained —
 *     is NOT a decision. It contributes nothing and FALLS THROUGH to the next rung (FR-005b). The
 *     stored id is never rewritten (this function is pure and returns what to render), so a build
 *     that reintroduces the language resolves it again.
 */
export function resolveLanguage(args: ResolveLanguageArgs): LanguageResolution {
  const name = baseName(args.fileName).toLowerCase();

  if (args.override && isKnownLanguage(args.override)) {
    return { languageId: args.override, source: 'override' };
  }

  const byName = matchFilename(args.fileName);
  if (byName !== undefined) return { languageId: byName, source: 'registry' };

  if (args.userMapping) {
    const mapped = userMappedId(name, args.userMapping);
    if (mapped && isKnownLanguage(mapped)) {
      return { languageId: mapped, source: 'user-mapping' };
    }
  }

  const detected = extensionMatch(name, SUFFIXES) ?? PLAIN_TEXT_ID;
  return detected === PLAIN_TEXT_ID
    ? { languageId: PLAIN_TEXT_ID, source: 'plaintext' }
    : { languageId: detected, source: 'registry' };
}
