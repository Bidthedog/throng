/**
 * 030 US3 (FR-029a) — THE ACTION A FAILURE BELONGS TO.
 *
 * `grouping.ts` groups by 029's cause where there is one and by the ORIGINATING OPERATION where
 * there is not. This module is the operation: an id minted once per user- or system-initiated
 * action, carried to every failure that action produces.
 *
 * ══ WHY THE OPERATION AND NOT THE CAUSE, FOR PANEL CASUALTIES ══
 *
 * This is the one place US3 departs from what the artifacts describe, and the reason is arithmetic
 * rather than preference. `causeKey` is `kind + subject`, and the subject of a panel's own failure is
 * that panel's own file or folder: six editors defeated by one absent project root classify as six
 * DIFFERENT causes (`path-missing:one.txt`, `path-missing:two.txt`, …), so grouping panel casualties
 * by cause would produce six notices — the storm FR-029 exists to end, renamed. Worse, an editor's
 * load failure carries a `LoadResult` reason and no errno at all, so 029 correctly declines to
 * classify it (FR-011b) and half the casualties would have no cause to group on in the first place.
 *
 * What every casualty genuinely shares is the ACTION: one project open, however many things it
 * broke. So panel casualties group by operation, and the cause branch of `groupKey` continues to
 * serve the failures that have one and no action behind them. FR-029b is untouched either way —
 * nothing here widens `FailureKind`, which is precisely why the operation branch exists.
 *
 * ══ WHY THE ID DOES NOT EXPIRE ══
 *
 * "Minted once per action" reads as though the id should die when the action's synchronous work
 * finishes. It must not, and US3's headline says why: the list GROWS as the user visits tabs. A
 * panel in a tab that has never been rendered has not failed yet — nothing has tried — and it may be
 * minutes before the user goes there. That later discovery is a casualty of the same open and must
 * join the same notice, so the id lives until the next operation replaces it.
 *
 * Deliberately module state and not a React context: the failures that consult it are raised from
 * effects, timers and IPC callbacks scattered across the tree, and threading a provider through all
 * of them would be a lot of plumbing for one string. `terminal/exit-store.ts` sets the precedent.
 */
import { groupKey } from '@throng/core';

interface Operation {
  id: string;
  projectId?: string;
}

let current: Operation | undefined;
let seq = 0;

/**
 * Start an operation and return its id. Replaces whatever was current.
 *
 * Called once per project open — including a restore, which is a system-initiated open and produces
 * exactly the same casualties as a user-initiated one.
 */
export function beginOperation(projectId?: string): string {
  seq += 1;
  current = { id: `op${seq}`, ...(projectId ? { projectId } : {}) };
  return current.id;
}

/** The operation in progress, or `undefined` when nothing has started one. */
export function currentOperation(): Readonly<Operation> | undefined {
  return current;
}

/**
 * The group key a failure produced by the current operation carries.
 *
 * `undefined` — no operation, or an operation belonging to a different project — is a real answer:
 * the notice then does not consolidate and behaves exactly as it does today. A key minted for the
 * wrong project would be far worse than none, because it would merge one project's casualties into
 * another project's notice, and FR-029's "one notice per project" is a property of this key.
 */
export function operationGroupKey(projectId?: string): string | undefined {
  if (!current) return undefined;
  if (projectId !== undefined && current.projectId !== undefined && current.projectId !== projectId) {
    return undefined;
  }
  return groupKey({ operationId: current.id, projectId: projectId ?? current.projectId });
}

/** Test seam: forget the current operation. Not called by the application. */
export function resetOperationForTests(): void {
  current = undefined;
}
