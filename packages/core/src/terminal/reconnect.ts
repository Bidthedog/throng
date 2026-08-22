/**
 * 039 US3 (#237) — a terminal that failed because its working directory was unavailable starts
 * itself when that directory comes back.
 *
 * ══ WHY THERE IS A WATCH PER FAILED PANEL, AND NOT ONE SIGNAL ══
 *
 * #237 asks for this to hang off "the same path-availability signal that drives editor recovery".
 * There is no such signal. Editor recovery (027 / #161) is TWO per-document mechanisms in
 * `packages/ui/src/main/editor-coordinator.ts` — a mount-time pull (`verifyPath`, `:711`) and a
 * per-document watch on the file's containing directory (`onDiskChange`, armed at `:1110`) — both
 * converging on one private method. Nothing project-wide exists to subscribe to.
 *
 * That distinction decides the design rather than merely describing it. FR-032 requires terminals in
 * tabs NEVER RENDERED in this session to recover, and a mount-time pull cannot do that by
 * construction: it fires when a view mounts. Only a push mechanism armed by the FAILURE — which
 * happens for every tab when the project loads, rendered or not — satisfies it.
 *
 * So this is N watches that happen to fire together, not one event. #237's phrase "one
 * path-availability event" describes what the user observes. The shared signal that would make it
 * literally true is #306, deliberately deferred; see the 039 spec, Finding 2 and decision D-1.
 *
 * Everything here is pure. The renderer/main process owns the actual watch; this owns the rules
 * about when one is armed, and those are the rules worth testing.
 */

import type { FailureKind } from '../failure/cause.js';

/**
 * Should a failed terminal start arm a path-availability watch?
 *
 * **Only `path-missing`.** FR-035 requires that a start which failed for a reason unrelated to the
 * path never retries — a bad shell binary and a permission refusal are not going to be fixed by the
 * directory reappearing, and a watch armed for them is a retry loop waiting for a filesystem event
 * that means nothing to it.
 *
 * `permission-denied` is the interesting exclusion, because it is the one that LOOKS recoverable: an
 * ACL can change, and the path is right there in the error. But nothing this feature watches would
 * observe that change — a directory watch fires on the directory's contents, not on its ACL — so
 * arming for it would produce a watch that either never fires or fires for an unrelated reason.
 *
 * A `null` cause is an unclassified failure (FR-011b: the raw message is reported unchanged). It
 * gets no watch, because "we could not tell what went wrong" is not evidence that the path is the
 * problem.
 */
export function shouldWatchForRecovery(cause: FailureKind | null | undefined): boolean {
  return cause === 'path-missing';
}

/**
 * The directory to watch for a start that failed on an unresolvable working directory.
 *
 * A watch can only be placed on something that EXISTS, and the whole premise here is that the
 * target does not — so this walks up to the nearest ancestor that does. When the project root
 * itself has been renamed away, that is typically its parent, and the rename back is what the watch
 * sees.
 *
 * `exists` is injected rather than imported: this stays pure, and the caller owns the filesystem.
 * Returns `null` when nothing in the chain exists — a path on a drive that is not mounted, say —
 * because there is then nowhere to put a watch and the honest answer is "this one cannot recover
 * automatically". FR-039's manual Retry remains, which is what it is for.
 */
export function watchTargetFor(
  target: string,
  exists: (path: string) => boolean,
  parentOf: (path: string) => string | null,
): string | null {
  let candidate: string | null = target;
  const seen = new Set<string>();
  while (candidate !== null && candidate.length > 0) {
    // A parentOf that returns its input at a filesystem root would otherwise spin forever. Guarding
    // on identity rather than on a depth limit keeps it correct for any path shape.
    if (seen.has(candidate)) return null;
    seen.add(candidate);
    if (exists(candidate)) return candidate;
    candidate = parentOf(candidate);
  }
  return null;
}

/** A terminal Panel awaiting the return of its working directory. */
export interface PendingReconnect {
  panelId: string;
  /** The project that owns the Panel. A path event must never cross into another (FR-037). */
  projectId: string;
  /** The working directory the terminal was configured for — what it must come back IN (FR-031). */
  target: string;
  /** The existing directory actually being watched, which may be an ancestor of `target`. */
  watching: string;
}

/**
 * Which pending reconnects a filesystem event releases.
 *
 * Two filters, and both are requirements rather than optimisations:
 *
 * - **`projectId`** — FR-037 / Principle I. A path returning in project A must not start a terminal
 *   in project B, and two projects can easily watch the same directory (a shared parent, a monorepo,
 *   a network share). The event carries the project it belongs to, so the check is exact rather than
 *   a guess from the path.
 * - **the target must now resolve** — the watch fires on the ANCESTOR, so "something changed under
 *   the parent" is not "my directory is back". Without this, a sibling folder being created would
 *   release every terminal waiting on that parent, and each would fail again immediately. That is
 *   the thrash FR-035 forbids, arriving by a different door.
 *
 * Bounded by construction: the caller removes what this returns, so each pending reconnect is
 * released at most once (FR-030). A terminal that fails again is a fresh failure and arms afresh —
 * which is a retry, not a loop, because it only happens when the directory genuinely reappeared.
 */
export function reconnectsReleasedBy(
  pending: readonly PendingReconnect[],
  event: { projectId: string; path: string },
  resolves: (target: string) => boolean,
): PendingReconnect[] {
  return pending.filter(
    (p) => p.projectId === event.projectId && p.watching === event.path && resolves(p.target),
  );
}
