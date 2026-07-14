/**
 * Language detection and the precedence chain (016, FR-002/FR-005a).
 *
 * Detection is EXTENSION-ONLY (FR-002): the filename decides, and content is never inspected —
 * no shebang, no doctype, no keyword sniffing. That is why {@link detectLanguage} takes a
 * filename and has no parameter through which content could reach it: the guarantee is expressed
 * in the signature, not merely promised in a comment.
 *
 * Pure; no OS, no DOM, no I/O.
 */
import { LANGUAGES, PLAIN_TEXT_ID, isKnownLanguage } from './languages.js';

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
const SUFFIXES: readonly { suffix: string; id: string }[] = LANGUAGES.flatMap((lang) =>
  lang.extensions.map((suffix) => ({ suffix, id: lang.id })),
).sort((a, b) => b.suffix.length - a.suffix.length);

/** The final path segment of a Windows or POSIX path. */
function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut >= 0 ? path.slice(cut + 1) : path;
}

/**
 * True when the filename has no extension at all (FR-002b): no dot, or a dot only in first
 * position — `Dockerfile` and `.gitignore` alike are extension-less, and both are plain text
 * until exact-filename descriptors land (#70).
 */
function hasNoExtension(name: string): boolean {
  return name.indexOf('.', 1) === -1;
}

/**
 * The language claimed by `fileName`'s extension, or plain text. Case-insensitive; the longest
 * declared suffix wins. Reads the FILENAME ONLY — never content (FR-002).
 */
export function detectLanguage(fileName: string): string {
  const name = baseName(fileName).toLowerCase();
  if (hasNoExtension(name)) return PLAIN_TEXT_ID;
  for (const { suffix, id } of SUFFIXES) {
    if (name.endsWith(suffix)) return id;
  }
  return PLAIN_TEXT_ID;
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
 * Resolve the language to RENDER, highest precedence first (FR-005a):
 * document override → user extension mapping → built-in registry → plain text.
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

  if (args.userMapping) {
    const mapped = userMappedId(name, args.userMapping);
    if (mapped && isKnownLanguage(mapped)) {
      return { languageId: mapped, source: 'user-mapping' };
    }
  }

  const detected = detectLanguage(name);
  return detected === PLAIN_TEXT_ID
    ? { languageId: PLAIN_TEXT_ID, source: 'plaintext' }
    : { languageId: detected, source: 'registry' };
}
