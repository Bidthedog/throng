/**
 * `[[Target]]` wikilinks (047, data-model.md "WikiTarget", research R12, FR-050 – FR-056).
 *
 * `parseWikilink` reads the text BETWEEN the double brackets — the pipeline's inline rule strips the
 * `[[`/`]]` and any leading `!` (an embed, FR-056, out of scope) before calling this, so a `|` or `#`
 * inside a code span never reaches it (markdown-it never runs an inline rule inside one). Pure: no
 * markdown-it, no DOM.
 *
 * `wikiCandidates` turns a parsed target into the ordered absolute paths FR-052c names, reusing the
 * SAME string-only resolution ordinary relative/rooted links use (`path-resolve.ts`) — FR-053's "not a
 * second resolver". `path` on {@link WikiTarget} deliberately does NOT carry a leading `/`: `rooted`
 * is the one place that fact lives, so a caller never has to re-test the string for it.
 */
import { resolveAgainst, separatorOf } from './path-resolve.js';

export interface WikiTarget {
  /** As written, with any leading `/` stripped; `''` for `[[#Heading]]`. */
  path: string;
  /** Written with a leading `/` — resolves from the project root, not the document's folder. */
  rooted: boolean;
  /** A heading, or `null`. A `^block` fragment is DROPPED (FR-056) — set to `null`, not kept. */
  fragment: string | null;
  alias: string | null;
}

const ROOTED = /^[\\/]/;
/** A path segment naming a real extension — the LAST segment, so `sub.dir/Note` is extension-free. */
const HAS_EXTENSION = /\.[^./\\]+$/;

/**
 * The text between `[[` and `]]` → a {@link WikiTarget}, or `null` for a malformed one — empty, or
 * carrying no path AND no fragment (`[[]]`, `[[|Alias]]`) — which the caller leaves as literal text
 * (FR-050's "otherwise" is implicit: markdown-it's own literal-bracket rendering takes over).
 */
export function parseWikilink(inner: string): WikiTarget | null {
  const pipeIndex = inner.indexOf('|');
  const left = pipeIndex < 0 ? inner : inner.slice(0, pipeIndex);
  const aliasText = pipeIndex < 0 ? '' : inner.slice(pipeIndex + 1).trim();
  const alias = aliasText.length > 0 ? aliasText : null;

  const hashIndex = left.indexOf('#');
  const rawPath = (hashIndex < 0 ? left : left.slice(0, hashIndex)).trim();
  const rawFragment = hashIndex < 0 ? '' : left.slice(hashIndex + 1).trim();

  if (rawPath.length === 0 && rawFragment.length === 0) return null;

  const rooted = ROOTED.test(rawPath);
  const path = rooted ? rawPath.slice(1) : rawPath;
  // FR-056 — a `^block-id` fragment names a block, not a heading: link to the TARGET and drop it.
  const fragment = rawFragment.length > 0 && !rawFragment.startsWith('^') ? rawFragment : null;

  return { path, rooted, fragment, alias };
}

/**
 * The ordered absolute candidates FR-052c names for `target`, resolved from `docDir` — the
 * document's own FOLDER, already a directory, not its file path — for a relative target, or
 * `projectRoot` for a rooted one, exactly as an ordinary link resolves (`path-resolve.ts`, FR-053).
 * `[]` for: an empty path (nothing to resolve as a file — a same-document `[[#Heading]]`); a rooted
 * target with no project root (FR-052b, a sub-workspace preview); or a path that climbs above its
 * base's own root.
 *
 * These are candidates, not verified files — which one EXISTS needs the filesystem, so main answers
 * that (contracts/preview-ipc-047.md §3, research R12). No project containment check either: that is
 * `classifyPreviewLink`'s job, over whichever candidate it uses.
 */
export function wikiCandidates(target: WikiTarget, docDir: string, projectRoot: string | null): string[] {
  if (target.path.length === 0) return [];
  if (target.rooted && projectRoot === null) return [];

  const base = target.rooted ? (projectRoot as string) : docDir;
  const sep = separatorOf(base);
  const suffixes = HAS_EXTENSION.test(target.path) ? [''] : ['.md', '.markdown', ''];

  const candidates: string[] = [];
  for (const suffix of suffixes) {
    const resolved = resolveAgainst(base, target.path + suffix, sep);
    if (resolved !== null) candidates.push(resolved);
  }
  return candidates;
}
