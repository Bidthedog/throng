/**
 * Killing processes from the monitor (055 FR-063a, FR-063b, FR-064, FR-066): the confirmation, the
 * request, and what a failure says.
 *
 * ══ THE CONFIRMATION IS THE SHARED ONE ══
 *
 * `confirmations.killProcesses` is read through `planConfirmations('killProcesses', …)` exactly as
 * Destroy Tab and Destroy Panel read theirs: none asks nothing, single asks once, double asks and then
 * the wry "absolutely sure" question. What is new is only its CONTENT — the dialog names the node with
 * its owning project, tab and panel and LISTS the processes that will end, by friendly name and id,
 * collapsing a long list to "and N more" (FR-063b). The list rides in the `details` slot of the shared
 * `ConfirmProvider`, so this adds no dialog of its own.
 *
 * The collector, not this module, decides what may be killed (FR-062): a request outside Projects comes
 * back `denied`. Authorisation here would be a second opinion that could only disagree.
 */
import { type ReactElement } from 'react';
import { killOrder, planConfirmations, type ResourceNode } from '@throng/core';
import type { KillMode, KillResult } from '@throng/ipc-contract';
import { useAppSettings } from '../config/config-store.js';
import { useConfirm } from '../confirm-dialog.js';
import { formatGrouped } from '@throng/core';
import { ownerNames } from './owner-names.js';
import { killCauseText } from './kill-cause.js';
import { getSessionSnapshot, isEnded, setNotice } from './monitor-session.js';

/** How many processes the confirmation names before it counts the rest. */
export const MAX_LISTED = 8;

interface Listed {
  readonly id: string;
  readonly label: string;
  readonly pid: number;
}

function find(root: ResourceNode, id: string): ResourceNode | undefined {
  if (root.id === id) return root;
  for (const c of root.children) {
    const hit = find(c, id);
    if (hit) return hit;
  }
  return undefined;
}

/** The live processes a kill will end, leaves first (the order they are killed in). */
export function processesToKill(node: ResourceNode, mode: KillMode): ResourceNode[] {
  if (mode === 'process') return node.process !== undefined && !isEnded(node.id) ? [node] : [];
  const out: ResourceNode[] = [];
  const visit = (n: ResourceNode): void => {
    for (const c of n.children) visit(c);
    if (n.kind === 'process' && n.process !== undefined && !isEnded(n.id)) out.push(n);
  };
  visit(node);
  return out;
}

/** The list a kill confirmation shows: the first {@link MAX_LISTED} by name and id, then a count. */
export function KillDetails({ processes }: { processes: readonly Listed[] }): ReactElement {
  const shown = processes.slice(0, MAX_LISTED);
  const more = processes.length - shown.length;
  return (
    <div className="kill-details" data-testid="kill-details">
      <ul className="kill-details__list">
        {shown.map((p) => (
          <li key={p.id} className="kill-details__item" data-testid="kill-details-item">
            {p.label} ({p.pid})
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <p className="kill-details__more" data-testid="kill-details-more">
          and {formatGrouped(more)} more
        </p>
      ) : null}
    </div>
  );
}

/** Kill `node`'s process (`mode: 'process'`) or everything below it (`'below'`), after confirming. */
export function useKillProcesses(): (node: ResourceNode, mode: KillMode) => Promise<void> {
  const settings = useAppSettings();
  const confirm = useConfirm();

  return async (node, mode) => {
    const snapshot = getSessionSnapshot();
    const tree = snapshot.tree;
    const doomed = processesToKill(node, mode);
    if (tree === null || doomed.length === 0) return;
    const listed: Listed[] = doomed.map((p) => ({ id: p.id, label: p.label, pid: p.process?.pid ?? 0 }));
    // A project, tab or panel is its own deepest owner; the dialog already names it, so it is not repeated.
    const ownedBy = ownerNames(node, tree);
    const owners = node.kind === 'project' || node.kind === 'tab' || node.kind === 'panel' ? ownedBy.slice(0, -1) : ownedBy;
    const where = owners.length > 0 ? ` in ${owners.join(' › ')}` : '';

    const plan = planConfirmations('killProcesses', settings.confirmations);
    const verb = mode === 'process' ? 'Kill Process' : 'Kill All Below';
    if (plan.dialogs > 0) {
      const ok = await confirm({
        title: verb,
        message:
          mode === 'process'
            ? `End “${node.label}”${where}? It stops at once and anything it has not saved is lost.`
            : `End ${listed.length === 1 ? '1 process' : `${formatGrouped(listed.length)} processes`} under “${node.label}”${where}? They stop at once and anything they have not saved is lost.`,
        details: <KillDetails processes={listed} />,
        confirmLabel: verb,
        cancelLabel: 'Cancel',
        danger: true,
      });
      if (!ok) return;
    }
    if (plan.wryFinal) {
      const sure = await confirm({
        title: 'Are you absolutely sure?',
        message: `This force-ends ${listed.length === 1 ? 'a process' : `${formatGrouped(listed.length)} processes`} under “${node.label}”. It cannot be undone.`,
        confirmLabel: "Yes, I'm absolutely sure",
        cancelLabel: 'No, I concede',
        danger: true,
      });
      if (!sure) return;
    }

    const api = window.throng?.resources;
    if (!api) return;
    // Kill Process ends that process only; Kill All Below ends the subtree, leaves first (R8).
    const targets = mode === 'process' && node.process ? [node.process.key] : killOrder(node, { isEnded: (n) => isEnded(n.id) });
    const result: KillResult = await api.kill({ mode, nodeId: node.id, targets });
    reportKillFailures(result, tree, listed, node);
  };
}

/** One notice for everything that went wrong in one request — or none when nothing did. */
function reportKillFailures(result: KillResult, tree: ResourceNode, listed: readonly Listed[], node: ResourceNode): void {
  // A target that was already gone is reported too (US3/AC9) — in the SAME notice as any that failed.
  const failed = result.results.filter((r) => r.outcome === 'denied' || r.outcome === 'failed' || r.outcome === 'gone');
  if (failed.length === 0) return;
  const nameOf = (key: string): string => {
    const id = `x:${key}`;
    return listed.find((p) => p.id === id)?.label ?? find(tree, id)?.label ?? 'A process';
  };
  const lines = failed.slice(0, MAX_LISTED).map((r) => `${nameOf(r.key)}: ${killCauseText(r, nameOf(r.key))}`);
  const rest = failed.length - lines.length;
  if (rest > 0) lines.push(`and ${formatGrouped(rest)} more.`);
  const total = result.results.length;
  // Gone with no other cause is not a failure to end anything: it had already ended, and the heading says so.
  const wasGone = (r: { outcome: string; cause?: string }): boolean => r.outcome === 'gone' && r.cause !== 'identityChanged';
  const allGone = failed.every(wasGone);
  const couldnt = failed.filter((r) => !wasGone(r));
  const one = total === 1 || failed.length === 1;
  const heading = allGone
    ? one
      ? `${nameOf(failed[0]!.key)} had already ended`
      : `${formatGrouped(failed.length)} of ${formatGrouped(total)} processes under ${node.label} had already ended`
    : couldnt.length === 1
      ? `Couldn't end ${nameOf(couldnt[0]!.key)}`
      : `Couldn't end ${formatGrouped(couldnt.length)} of ${formatGrouped(total)} processes under ${node.label}`;
  setNotice({ heading, lines });
}
