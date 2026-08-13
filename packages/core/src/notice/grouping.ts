/**
 * 030 FR-029 / FR-029a — what decides that two failures are ONE notice.
 *
 * Rename a project's root folder with editors and terminals open and every casualty reports
 * separately: a storm of near-identical toasts, none of which says how many others there are. This
 * key is what collapses them, and the dimensions it carries are the ones that make consolidation
 * correct rather than merely quiet:
 *
 *   • the OPERATION, so everything one action defeated lands in one notice — whatever each casualty's
 *     own error turned out to be, and whether or not 029 could classify it at all;
 *   • the CAUSE, for a failure with no action behind it, so unrelated failures never merge — 029's
 *     `causeKey`, reused rather than re-derived, which is what makes this insensitive to the fact
 *     that one cause produces different message text from different reporters;
 *   • the PROJECT, so "one notice per project" (FR-029) is a property of the key rather than a rule
 *     somebody has to remember to apply at every raise site.
 *
 * ══ WHY THIS DOES NOT TOUCH `FailureKind` (FR-029b) ══
 *
 * Consolidation is the obvious place to want a sixth kind for whatever this failure was. The set is
 * closed on purpose: a closed set has a completion signal and can be tested to exhaustion, and
 * anything unmatched keeps today's behaviour EXACTLY. So an unclassified failure gets the operation
 * branch below instead of a new kind — it consolidates by what the user DID, which needs no
 * classifier at all.
 */
import { causeKey, type FailureCause } from '../failure/cause.js';

export interface GroupInput {
  /** 029's classification, `null` when the error matched none of the five kinds. */
  cause?: FailureCause | null;
  /**
   * Minted ONCE per user- or system-initiated action, at the point the action starts, and carried
   * to every failure that action produces. Opening a project mints one; restoring a tab inside that
   * open does not mint a second, or two panels defeated by two different unclassified failures
   * during one open would land in two notices.
   */
  operationId?: string;
  projectId?: string;
}

/** The project dimension, spelled so a project-less failure still has one stable key. */
function projectPart(projectId: string | undefined): string {
  return projectId ?? 'none';
}

/**
 * The key two failures must share to become one notice, or `undefined` when there is nothing to
 * group on — in which case the notice does not consolidate and behaves exactly as it does today.
 *
 * ══ THE OPERATION OUTRANKS THE CAUSE (FR-029a) ══
 *
 * The reverse reads more natural and is wrong, measured against the real classification. `causeKey`
 * is `kind + subject`, and a PANEL's subject is its own file — so six editors defeated by one missing
 * project root are six DIFFERENT causes, and a cause-first key would raise six notices: the storm
 * this feature exists to remove, renamed. Worse, an editor's load failure carries a `LoadResult`
 * reason and no errno, so 029 correctly declines to classify it at all; half the casualties of one
 * absent root have no cause to group by even in principle.
 *
 * So: by the operation for anything an action defeated, by the cause for a failure with no action
 * behind it, and per-panel only where there is neither. The feared merge — a missing folder joined
 * to an unrelated permission refusal during one project open — is the correct outcome and not a
 * hazard: they are two casualties of one thing the user did, the notice lists both panels, and each
 * panel's own raw error rides beside it (FR-048a).
 *
 * This also means a caller cannot get it wrong by supplying both. A panel casualty passes its
 * operation id and whatever cause it happens to have, and the operation wins without the raise site
 * having to know that it should.
 */
export function groupKey(input: GroupInput): string | undefined {
  // Trimmed, because an operation id that is present but blank is an absent one that would otherwise
  // mint the key `op:::p1` and silently merge every unclassified failure in the project.
  const operationId = input.operationId?.trim();
  if (operationId) return `op:${operationId}::${projectPart(input.projectId)}`;
  if (input.cause) return `${causeKey(input.cause)}::${projectPart(input.projectId)}`;
  return undefined;
}
