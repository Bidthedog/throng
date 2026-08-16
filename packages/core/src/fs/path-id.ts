/**
 * Path IDENTITY — is this the same file, and is this file under that folder? (019 / FR-007.)
 *
 * A path arrives here spelled however its producer spells it: the File Explorer tree hands the
 * renderer forward-slashed paths, `node:path.join` in UI main produces back-slashed ones, and a
 * folder may or may not carry a trailing separator. All of those name the same thing, and every
 * comparison that used the raw string got the answer wrong SILENTLY — which is how a move can be
 * announced, match nothing, and leave the editor pointing at a file that has gone.
 *
 * ## What this consolidated, and what it did NOT (Principle VIII, honestly)
 *
 * It replaced the copy inlined in `markDeleted` and the one in #87's E2E helper, and it is the one
 * rule the whole move signal is measured by. It did not consolidate the OTHER normaliser, and this
 * docstring used to claim that it had.
 *
 * `normaliseFolder` (`projects/project.ts`) still exists and is not a synonym: it trims, and it
 * collapses repeated separators, neither of which happens here. It is what keys the app-wide open
 * registry (`editor/open-registry.ts`) — the very map `markMoved` re-keys — and `isUnderPath` below
 * is byte-for-byte the predicate already spelled as `isWithinRoot` (`explorer/path-rules.ts`) and as
 * `isFolderConflict` (`projects/project.ts`), each built on that other normaliser.
 *
 * So there are two rules where there should be one, and the one-buffer invariant across a move
 * (FR-002/FR-011a) holds only while they AGREE: this decides what moved, and `normaliseFolder`
 * decides where the registry files the result. They agree on every path either has ever been handed
 * — an absolute, `join`-produced or tree-produced path, with no repeated separators — which is why
 * this is a debt and not a defect. Merging them means changing the key of the open registry and of
 * the project-overlap rule (FR-029), which is a change with its own tests to write and is not #87's
 * to make. Whoever makes it: this is the rule that should survive, and this docstring is the only
 * warning that the other one exists.
 *
 * ## Case-insensitivity is a DECISION, not an accident
 *
 * `C:/P/Note.txt` and `c:/p/note.txt` are treated as one path. throng is Windows-first
 * (constitution I), and on Windows they ARE one file. On a case-sensitive filesystem this rule
 * would fuse two genuinely different files — the cost is a false "already open" on a pair of
 * paths differing only in case, and the alternative (matching by spelling) is #87 itself. When
 * throng grows a case-sensitive platform, this is the one place that has to learn about it.
 *
 * Pure: no OS calls and no filesystem access. Normalisation is a RULE about strings, not a
 * platform capability, so it belongs in core (Principle II) — nothing here touches a disk, and
 * nothing here resolves a symlink (that is `realpath`'s job, behind the `IFileSystem` seam).
 */

/** `\`→`/`, drop any trailing separator, lowercase. The comparable form of a path. */
export function normaliseForCompare(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** Do these two paths name the same file or folder, however each is spelled? */
export function samePath(a: string, b: string): boolean {
  return normaliseForCompare(a) === normaliseForCompare(b);
}

/** A `..` PATH SEGMENT — not a file whose name merely contains two dots (`..hidden`, `a..b`). */
const PARENT_SEGMENT = /(^|\/)\.\.(\/|$)/;

/**
 * Is `file` `folder` itself, or somewhere beneath it?
 *
 * The boundary is a SEGMENT boundary, never a character one: `C:/a/package-lock.json` is not
 * under `C:/a/pack`, however much its first four characters suggest otherwise. That is the
 * predicate `markDeleted` has always used (`editor-coordinator.ts:270-276`).
 *
 * ══ A `..` SEGMENT IS REFUSED, NOT RESOLVED (033 FR-032) ══
 *
 * This is a rule about STRINGS — it has no filesystem and cannot resolve anything, which is the
 * whole reason it lives in core (see the header). So `C:/project/../../Windows/System32` is a
 * prefix match against `C:/project` and used to answer TRUE, while every consumer that then goes
 * to the disk — `statSync` in `terminal-ipc.ts`, the shell it launches — resolves the `..` happily
 * and lands outside the folder that was supposed to contain it. The predicate and the OS disagreed
 * about what the same string meant, and the predicate was the one making the safety decision.
 *
 * Refusing is right where resolving would be wrong. Resolving needs `path.resolve`, which is
 * platform behaviour this module deliberately does not have, and it would answer a question nobody
 * asks: no producer in this codebase emits a `..` segment. The tree builds paths by joining names,
 * the daemon reports a real OS working directory, and `node:path.join` has already collapsed them.
 * A `..` arriving here therefore means the path came from somewhere it should not have — the
 * user-editable workspace layout JSON is the one such source (033's `startDirectory`) — and the
 * safe answer to "is this contained?" for a path we cannot evaluate is NO. The caller's fallback is
 * the project root, which is exactly where an uninterpretable start directory belongs.
 */
export function isUnderPath(file: string, folder: string): boolean {
  const f = normaliseForCompare(file);
  const g = normaliseForCompare(folder);
  // Either side: a `..` in the FOLDER makes the containment question just as unanswerable as one in
  // the file, and a root that needs traversing to name is not a root this app ever produced.
  if (PARENT_SEGMENT.test(f) || PARENT_SEGMENT.test(g)) return false;
  return f === g || f.startsWith(g + '/');
}
