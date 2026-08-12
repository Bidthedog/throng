/**
 * 030 FR-029 / FR-029a — what decides that two failures are ONE notice.
 *
 * Rename a project's root folder with editors and terminals open and every casualty reports
 * separately: a storm of near-identical toasts, none of which says how many others there are. This
 * key is what collapses them, and the two dimensions it carries are the two that make consolidation
 * correct rather than merely quiet:
 *
 *   • the CAUSE, so unrelated failures never merge — 029's `causeKey`, reused rather than
 *     re-derived, which is what makes this insensitive to the fact that one cause produces
 *     different message text from different reporters;
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
 * A classified cause outranks an operation id: the cause is the more specific statement of what went
 * wrong, and grouping by the action instead would merge a missing folder with an unrelated
 * permission refusal that happened during the same project open.
 */
export function groupKey(input: GroupInput): string | undefined {
  if (input.cause) return `${causeKey(input.cause)}::${projectPart(input.projectId)}`;
  // Trimmed, because an operation id that is present but blank is an absent one that would otherwise
  // mint the key `op:::p1` and silently merge every unclassified failure in the project.
  const operationId = input.operationId?.trim();
  if (operationId) return `op:${operationId}::${projectPart(input.projectId)}`;
  return undefined;
}
