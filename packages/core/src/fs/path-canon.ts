/**
 * Path STORAGE canon — what spelling of a path gets written down (#229).
 *
 * Distinct from `path-id.ts`, and the two must not be confused. That module answers *is this the
 * same file?* by flattening a path into a comparable form (lower-cased, forward-slashed) that is
 * never shown to anyone and never stored. This one answers *how do we write it down?*, and its
 * output is the value that lands in SQLite and comes back out.
 *
 * The problem it solves: a path's spelling depends on which producer happened to build it. The
 * explorer tree concatenates a native root with a forward-slashed tail
 * (`file-tree.tsx` — `` `${rootFolder}/${node.data.relPath}` ``), while a save returns a native path
 * from the main process (`use-editor.ts`). Both name the same file; one reads `D:\p/notes.md` and the
 * other `D:\p\notes.md`. Nothing downstream breaks today — every consumer normalises before it
 * compares — but "correct as long as every future consumer remembers" is not an invariant, it is a
 * standing invitation.
 *
 * ## The separator is a PARAMETER, not a lookup
 *
 * Core is OS-agnostic (Principle II) and imports no `node:path`, so the host separator arrives from
 * the caller. That is not a workaround: it is what lets both branches be tested on either platform,
 * which is exactly what #229's acceptance criteria ask for.
 *
 * ## Why the rule is asymmetric
 *
 * On Windows BOTH `\` and `/` separate, so rewriting `/` to `\` is lossless — the two spellings
 * already named one file. On POSIX only `/` separates and a backslash is an ordinary, legal
 * character in a filename, so rewriting one would RENAME the file. The canon there is therefore the
 * path unchanged, and a POSIX host has no mixed form to canonicalise in the first place.
 *
 * Nothing here collapses repeated separators. `normaliseFolder` does, and for its own purpose that
 * is right — but a leading `\\` is a UNC root, not a doubled separator, and this value is going to
 * be handed back to the filesystem rather than compared. No producer in this codebase emits a
 * doubled separator, so there is nothing to collapse and a real risk in trying.
 *
 * Pure: no OS calls, no filesystem access, no `node:path`.
 */

/** The host's path separator, supplied by the (platform-aware) caller. */
export type PathSeparator = '/' | '\\';

/**
 * The form a path is STORED in: the host's separator throughout, and no foreign one left behind.
 *
 * A no-op on POSIX, by construction — see the header. An empty string passes through unchanged so a
 * caller need not special-case an absent path.
 */
export function toCanonicalPath(path: string, sep: PathSeparator): string {
  if (sep !== '\\') return path;
  return path.replace(/\//g, '\\');
}

/** Is this path already in the stored canon for `sep`? */
export function isCanonicalPath(path: string, sep: PathSeparator): boolean {
  return toCanonicalPath(path, sep) === path;
}
