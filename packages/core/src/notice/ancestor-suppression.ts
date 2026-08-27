/**
 * 041 FR-003c/FR-003d (#278) — is this removed folder a CAUSE, or a casualty of one?
 *
 * ══ THE DEFECT THIS ANSWERS ══
 *
 * One `git worktree remove` produced five dialogs. Main classifies a filesystem failure against the
 * last segment of the first path the errno quotes, so five vanished folders mint five different cause
 * keys (`path-missing:<folder>`); `notice-suppression.ts` compares those keys for EQUALITY, matches
 * none of them, and 029 FR-019's one-cause-one-notice rule never engages. The keys were never the
 * problem — the problem is that four of those five removals were not causes at all.
 *
 * ══ TWO MODULES CALLED "SUPPRESSION", AND THEY COMPOSE ══
 *
 * `renderer/common/notice-suppression.ts` implements 029 FR-019: given the cause keys already on
 * screen, should this notice be raised? It is not the defect and it is unchanged.
 *
 * This one runs EARLIER, before a key is minted at all, and answers a different question: is this
 * removal something to report in the first place? A folder whose ancestor also went is a casualty of
 * that ancestor's removal (FR-003), and the ancestor is the thing the user acted on and would
 * recognise (FR-002).
 *
 * ══ WHY IT NEVER WAITS, AND WHY THAT MATTERS ══
 *
 * The obvious implementation buffers removals briefly and keeps the shallowest. It is forbidden: 030
 * FR-036 says consolidation is by cause or by originating operation, "never by time or by window",
 * and FR-003b does not supersede it. It is also unnecessary — "is an ancestor of this also absent?"
 * is answerable from the path and the filesystem alone, referring to no other event. So a watcher may
 * report `/a/b/c` before `/a/b` and the answer is unchanged, which is what lets FR-003d forbid
 * raising a notice and later amending its subject: there is no first answer to revise.
 *
 * ══ WHY THE PROBE IS A PARAMETER ══
 *
 * Two reasons that happen to agree. A filesystem call here would breach Constitution II
 * (platform-abstracted core), and the composition root is where the implementation belongs
 * (Constitution IX). And SC-006f's sweep over every arrival order of five events is only affordable
 * as a unit test if the absence answer is a function the test supplies rather than 120 directory
 * trees it has to build.
 */

/** Split a path on either separator, dropping empties — the stored root may use either. */
function segments(path: string): string[] {
  return path.split(/[\\/]/).filter(Boolean);
}

/**
 * Is an ancestor of `removedPath`, inside `projectRoot`, also absent?
 *
 * `true` means this removal is a casualty and must raise no notice of its own — the ancestor is its
 * own cause and reports for both (FR-003). `false` means it is a removed folder whose parent
 * survives, which is exactly the unit FR-003a defines as a cause.
 *
 * The walk stops AT the project root and never above it: beyond the root, absence says nothing about
 * this project, and a root that has itself gone is FR-002's fallback case, where the notice names the
 * highest thing it can name truthfully rather than reaching outside the project for a subject.
 */
export function isSuppressedByAncestor(
  removedPath: string,
  projectRoot: string,
  isAbsent: (path: string) => boolean,
): boolean {
  return ancestorsWithinRoot(removedPath, projectRoot).some(isAbsent);
}

/**
 * The paths {@link isSuppressedByAncestor} will ask about — deepest first.
 *
 * Exported because the real caller's absence probe is ASYNCHRONOUS (`files.exists` over IPC) while
 * the predicate above is pure and synchronous. The caller therefore has to resolve absence for a set
 * of paths BEFORE it can answer, and it can only know which paths those are by performing this same
 * walk. Exporting it is what stops the two drifting: a call site that probed a different set from the
 * one the predicate consults would be asking questions the answer never reads, and would look
 * correct while suppressing nothing.
 *
 * Two exclusions, both load-bearing:
 *
 *   • THE PATH ITSELF. It is absent by definition — that is why we are being asked — so counting it
 *     would suppress every removal, including the one the user actually made.
 *   • THE ROOT. Beyond it absence says nothing about this project, and a root that has itself gone is
 *     FR-002's fallback case: name the highest thing nameable rather than reach outside the project.
 */
export function ancestorsWithinRoot(removedPath: string, projectRoot: string): string[] {
  const root = segments(projectRoot);
  const removed = segments(removedPath);

  // Not inside this project — nothing to walk, so nothing can be reported as its cause.
  if (removed.length <= root.length) return [];
  for (const [i, part] of root.entries()) {
    if (removed[i] !== part) return [];
  }

  const separator = projectRoot.includes('\\') ? '\\' : '/';
  const ancestors: string[] = [];
  for (let depth = removed.length - 1; depth > root.length; depth -= 1) {
    ancestors.push(removed.slice(0, depth).join(separator));
  }
  return ancestors;
}
