/**
 * What the WINDOW does when a paste ends (050), mounted once in `app.tsx`.
 *
 * ══ WHY THIS IS NOT INSIDE `useExplorerData` ══
 *
 * A paste outlives the project it was started in. The user can switch projects while it runs, and
 * `file-explorer-pane.tsx` remounts the tree for the new one — so a handler living in the tree would
 * simply not exist when the result arrives, and the undo entry, the language-override carry and the
 * reveal would all be lost with it. The result belongs to the window, and so does this: one
 * subscription for the window's lifetime, which does what needs doing whichever project is showing and
 * then TELLS whichever trees are mounted (`onTransferCompleted`) so they can re-read what changed.
 *
 * Drags are not handled here: a drag's result reaches the tree that started it through the awaited
 * `transfer.drop` call (FR-019e), and a drag is over before a project can be switched.
 */
import { useEffect, type ReactElement } from 'react';
import {
  recordFileOp,
  relPathUnderRoot,
  type FileOpUndoEntry,
  type TransferResult,
} from '@throng/core';
import { useServices, type Services } from '../composition-root.js';
import { queueReveal } from './pending-reveal.js';

type CompletedListener = (result: TransferResult) => void;
const completed = new Set<CompletedListener>();

/**
 * Be told when a paste has finished and everything the window had to do about it is done or begun.
 * A mounted tree uses it to re-read the folders the run touched. Returns the unsubscriber.
 */
export function onTransferCompleted(listener: CompletedListener): () => void {
  completed.add(listener);
  return () => {
    completed.delete(listener);
  };
}

/** A fresh entry id where main supplied none (it writes one for every new entry; older paths may not). */
const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

type StacksListener = (projectIds: readonly string[]) => void;
const stacksChanged = new Set<StacksListener>();

/**
 * Be told that these projects' persisted undo stacks were written by the WINDOW rather than by the tree
 * showing one of them (050 FR-020). A mounted tree holds its project's stack in memory and re-reads it
 * on this signal, so what the host recorded is undoable at once.
 */
export function onUndoStacksChanged(listener: StacksListener): () => void {
  stacksChanged.add(listener);
  return () => {
    stacksChanged.delete(listener);
  };
}

/** Which projects an entry belongs to: the target always, and the source of a cross-project one. */
function projectsOf(entry: FileOpUndoEntry, fallback: string): string[] {
  const named = entry.kind === 'move' || entry.kind === 'paste' ? entry.projects : undefined;
  return [...new Set([fallback, ...(named ? [named.source, named.target] : [])])];
}

/**
 * Record a finished paste's undo entry in EVERY stack it belongs to (050 FR-020, R10).
 *
 * One operation, two histories: a cross-project move sits in the target's stack and the source's,
 * matched by `id`. It is written through `FileOpUndoClient` — the other project's stack is not live in
 * memory (only one explorer is mounted at a time) — and recording never fails a paste that succeeded.
 */
async function recordUndo(result: TransferResult, services: Services): Promise<void> {
  const entry = result.undo;
  if (entry === null) return;
  const withId: FileOpUndoEntry = entry.id ? entry : { ...entry, id: newId() };
  const ids = projectsOf(withId, result.targetProjectId);
  for (const id of ids) {
    try {
      const stack = await services.fileOpUndo.load(id);
      await services.fileOpUndo.save(id, recordFileOp(stack, withId));
    } catch {
      /* history that could not be recorded must not fail the paste */
    }
  }
  for (const l of [...stacksChanged]) l(ids);
}

/**
 * A language override follows a MOVED file (016 FR-028e; 050 FR-016, R10).
 *
 * One daemon `movePath` per moved item, naming the target project when it differs. The daemon does
 * it in one transaction, and a moved FOLDER carries the overrides of every file beneath it (#471) —
 * which a read-write-clear composed here could not, since an override is keyed to a file and the
 * folder's own path has none. A file with no override is the common case and is not a failure, and
 * neither is a store that cannot be reached: a file operation must never fail because a preference
 * could not follow it.
 *
 * Exported because an UNDO of a cross-project move is a move too, and carries the override back.
 */
export async function carryOverrides(
  pairs: readonly { from: string; to: string }[],
  fromProject: string,
  toProject: string,
  services: Services,
): Promise<void> {
  if (pairs.length === 0) return;
  const projects = await services.projects.list().catch(() => []);
  const rel = (project: string, abs: string): string | null => {
    const root = projects.find((p) => p.id === project)?.rootFolder;
    return root ? relPathUnderRoot(root, abs) : null;
  };
  for (const { from, to } of pairs) {
    const fromRel = rel(fromProject, from);
    const toRel = rel(toProject, to);
    if (!fromRel || !toRel) continue;
    try {
      await services.documents.movePath(fromProject, fromRel, toRel, toProject);
    } catch {
      /* see the doc comment: nothing here is worth failing an operation over */
    }
  }
}

/** The (from, to) pairs a result's undo entry says were MOVED — a copy has none, so it carries nothing. */
function movedPairs(result: TransferResult): { from: string; to: string }[] {
  const entry = result.undo;
  if (entry === null) return [];
  if (entry.kind === 'move') return entry.items;
  if (entry.kind === 'paste') return entry.moved;
  return [];
}

export function TransferCompletionHost(): ReactElement | null {
  const services = useServices();

  useEffect(() => {
    const transfer = window.throng?.transfer;
    if (!transfer) return undefined;
    return transfer.onDone((result) => {
      if (result.kind !== 'paste') return;

      // FR-025b — what the run placed is revealed in its project, now or when the user next shows it.
      if (result.outcome !== 'rolled-back') queueReveal(result.targetProjectId, result.placed);

      // FR-013 — the failures are reported by the run's own notice (`paste-progress-notice.tsx`), the
      // same card that showed its progress, not by a second one raised from here.

      // FR-020 — one operation, recorded in every project's stack it belongs to.
      void recordUndo(result, services);
      // FR-016 — overrides follow what moved.
      void carryOverrides(movedPairs(result), result.sourceProjectId, result.targetProjectId, services);

      for (const l of [...completed]) l(result);
    });
  }, [services]);

  return null;
}
