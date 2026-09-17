/**
 * What a link or an image in a rendered preview is allowed to be (044, FR-084, FR-086, FR-090 – FR-093,
 * research R5 – R7).
 *
 * These run inside the sanitiser's `afterSanitizeAttributes` hook on every `<a>` and `<img>`
 * (contracts/security-policy.md Layer 2), so they are a SECURITY decision before they are a
 * navigation one. The rule is a whitelist stated twice:
 *
 * - a link is `external` only for `http:`, `https:` and `mailto:`; `file` only for a path that
 *   resolves inside the project; `heading` only for a non-empty same-document fragment; everything
 *   else is `outside` (a path that escapes) or `inert`.
 * - an image is `remote` only for `https:` while remote images are permitted, and `project` only for
 *   a path inside the project; everything else is `blocked`.
 *
 * ══ AN OBFUSCATED SCHEME IS NEVER HONOURED ══
 *
 * Control characters are removed first (a browser ignores a tab inside `java\tscript:`), and then a
 * scheme is read from the text AS WRITTEN. If the scheme only appears after decoding an entity
 * (`javascript&#58;`) or a percent escape (`javascript%3A`), the value is refused outright — even
 * when what it hides is `https:`. A document that disguises a scheme has no legitimate reason to, and
 * reading the disguise generously is exactly how a filter ends up agreeing with an attacker.
 *
 * Pure: no OS, no DOM, no `node:path`.
 */
import { isUnderPath } from '../fs/path-id.js';
import { relPathUnderRoot } from '../explorer/path-rules.js';
import { LANGUAGES, PLAIN_TEXT_ID, languageById } from '../editor/languages.js';
import { directoryOf, resolveAgainst, separatorOf } from './path-resolve.js';

export type PreviewLink =
  /** `http:`, `https:`, `mailto:` (FR-091). */
  | { kind: 'external'; url: string }
  /** A path inside the project (FR-090). */
  | { kind: 'file'; absPath: string; fragment?: string }
  /** The same document (FR-090f). */
  | { kind: 'heading'; fragment: string }
  /** Resolves outside the project; `target` is the link as written, for the notice (FR-090e). */
  | { kind: 'outside'; target: string }
  /** Anything else (FR-091). */
  | { kind: 'inert' };

export type PreviewImage =
  /** Inside the project, relative to its root with `/` separators (FR-084). */
  | { kind: 'project'; relPath: string }
  /** `https:` only, and only while permitted (FR-092). */
  | { kind: 'remote'; url: string }
  | { kind: 'blocked' };

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const EXTERNAL_SCHEMES = new Set(['http', 'https', 'mailto']);
/** `//host` and `\\server`: a network reference, whatever separators spell it. */
const NETWORK_REFERENCE = /^[\\/]{2}/;
// eslint-disable-next-line no-control-regex -- removing control characters is the point.
const CONTROL = /[\x00-\x1f\x7f]/g;

const NAMED_ENTITIES: Record<string, string> = {
  colon: ':',
  tab: '\t',
  newline: '\n',
  sol: '/',
  period: '.',
  amp: '&',
};

/** The character a numeric reference names, or `null` when it names no Unicode code point. */
function codePoint(digits: string, radix: 10 | 16): string | null {
  const value = Number.parseInt(digits, radix);
  // 309+ decimal or 257+ hex digits parse to Infinity; anything past U+10FFFF is no character.
  // `String.fromCodePoint` THROWS for both, and this runs inside the sanitiser hook for every href
  // and src — an exception there fails the render of the whole file.
  return Number.isInteger(value) && value <= 0x10ffff ? String.fromCodePoint(value) : null;
}

/**
 * `value` with numeric and the handful of named references a scheme can be spelled with decoded, or
 * `null` when a numeric reference names no code point — which fails the whole value closed.
 */
function decodeEntities(value: string): string | null {
  let invalid = false;
  const decode = (digits: string, radix: 10 | 16): string => {
    const ch = codePoint(digits, radix);
    if (ch === null) invalid = true;
    return ch ?? '';
  };
  const decoded = value
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) => decode(hex, 16))
    .replace(/&#(\d+);?/g, (_m, dec: string) => decode(dec, 10))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
  return invalid ? null : decoded;
}

function decodePercent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * The value with control characters removed and whitespace trimmed, plus whether it hides a scheme
 * behind an entity or a percent escape. `null` for a value that is empty or malformed.
 */
function prepare(value: string): { text: string; scheme: string | null } | null {
  const text = value.replace(CONTROL, '').trim();
  if (text.length === 0) return null;
  const written = SCHEME.exec(text);
  if (written) return { text, scheme: written[1].toLowerCase() };
  const percent = decodePercent(text);
  const entities = decodeEntities(text);
  if (percent === null || entities === null) return null;
  const hidden = SCHEME.test(entities.replace(CONTROL, '')) || SCHEME.test(percent);
  return hidden ? null : { text, scheme: null };
}

/** The path part of a reference, split from its query and fragment, both percent-decoded. */
function splitReference(text: string): { path: string; fragment: string } | null {
  const hash = text.indexOf('#');
  const beforeHash = hash < 0 ? text : text.slice(0, hash);
  const query = beforeHash.indexOf('?');
  const path = decodePercent(query < 0 ? beforeHash : beforeHash.slice(0, query));
  const fragment = decodePercent(hash < 0 ? '' : text.slice(hash + 1));
  return path === null || fragment === null ? null : { path, fragment };
}

/**
 * The absolute path a document-relative reference names, or `null` when it climbs out of the
 * filesystem root. A root-relative path (`/docs/a.md`) is relative to the PROJECT root, as GitHub
 * reads it; anything else is relative to the document's own folder.
 */
function resolveReference(path: string, ctx: { docPath: string; projectRoot: string }): string | null {
  const sep = separatorOf(ctx.projectRoot);
  const base = /^[\\/]/.test(path) ? ctx.projectRoot : directoryOf(ctx.docPath, sep);
  return resolveAgainst(base, path, sep);
}

export function classifyPreviewLink(
  href: string,
  ctx: { docPath: string; projectRoot: string },
): PreviewLink {
  const prepared = prepare(href);
  if (prepared === null) return { kind: 'inert' };
  const { text, scheme } = prepared;

  if (scheme !== null) {
    return EXTERNAL_SCHEMES.has(scheme) ? { kind: 'external', url: text } : { kind: 'inert' };
  }
  if (NETWORK_REFERENCE.test(text)) return { kind: 'inert' };

  const reference = splitReference(text);
  if (reference === null) return { kind: 'inert' };

  if (text.startsWith('#')) {
    return reference.fragment.length > 0 ? { kind: 'heading', fragment: reference.fragment } : { kind: 'inert' };
  }
  if (reference.path.length === 0) return { kind: 'inert' };

  const absPath = resolveReference(reference.path, ctx);
  if (absPath === null || !isUnderPath(absPath, ctx.projectRoot)) return { kind: 'outside', target: text };
  return reference.fragment.length > 0
    ? { kind: 'file', absPath, fragment: reference.fragment }
    : { kind: 'file', absPath };
}

export function resolvePreviewImage(
  src: string,
  ctx: { docPath: string; projectRoot: string; remoteImages: boolean },
): PreviewImage {
  const prepared = prepare(src);
  if (prepared === null) return { kind: 'blocked' };
  const { text, scheme } = prepared;

  if (scheme !== null) {
    return scheme === 'https' && ctx.remoteImages ? { kind: 'remote', url: text } : { kind: 'blocked' };
  }
  if (NETWORK_REFERENCE.test(text) || text.startsWith('#')) return { kind: 'blocked' };

  const reference = splitReference(text);
  if (reference === null || reference.path.length === 0) return { kind: 'blocked' };

  const absPath = resolveReference(reference.path, ctx);
  const relPath = absPath === null ? null : relPathUnderRoot(ctx.projectRoot, absPath);
  return relPath === null ? { kind: 'blocked' } : { kind: 'project', relPath };
}

/** Per `taken` Set: for each base, the first suffix its search has not tried. Collected with the Set. */
const nextSuffixes = new WeakMap<Set<string>, Map<string, number>>();

/**
 * A GitHub-style heading slug: lower-cased, everything but letters, marks, numbers, connector
 * punctuation, hyphens and spaces removed, spaces → `-`. A slug already in `taken` gets `-1`, `-2`, …
 * and the slug handed out is added to `taken`, so one Set threaded through a document de-duplicates it.
 *
 * ══ THE SUFFIX SEARCH RESUMES ══
 *
 * Restarting at `-1` for every heading made N identical (or empty) headings cost N²/2 lookups: 50,000 of
 * them held the renderer for over two minutes (adversarial review I2). Each base's search now resumes at
 * the first suffix its previous search had not yet tried, as github-slugger does. The slugs are unchanged:
 * every suffix below that point was found taken, and a Set only grows, so it is taken still — a literal
 * `A-1` heading added in between is skipped over exactly as before.
 */
export function headingSlug(text: string, taken: Set<string>): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
  let next = nextSuffixes.get(taken);
  if (next === undefined) {
    next = new Map();
    nextSuffixes.set(taken, next);
  }
  let slug = base;
  let n = next.get(base) ?? 1;
  if (taken.has(slug)) {
    for (slug = `${base}-${n}`; taken.has(slug); slug = `${base}-${n}`) n += 1;
    next.set(base, n + 1);
  }
  taken.add(slug);
  return slug;
}

/**
 * The editor language id for a fenced block's info string, or plain text (FR-086, research R5).
 *
 * Resolved against the editor's own registry — exact id, then display name, then `.<info>` as an
 * extension — so `ts`, `py` and `sh` resolve with no alias table to keep in step. `mermaid` is not a
 * language the registry knows, so it renders as ordinary code, which is what FR-086 asks for.
 */
export function languageForFenceInfo(info: string): string {
  const token = (info.trim().split(/\s+/)[0] ?? '').toLowerCase();
  if (token.length === 0) return PLAIN_TEXT_ID;
  const language =
    languageById(token) ??
    LANGUAGES.find((l) => l.name.toLowerCase() === token) ??
    LANGUAGES.find((l) => l.extensions.includes(`.${token}`));
  return language?.id ?? PLAIN_TEXT_ID;
}
