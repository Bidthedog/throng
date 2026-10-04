/**
 * Items a paste placed, waiting to be revealed in their project's tree (050 FR-025b, R12).
 *
 * A paste can finish while a DIFFERENT project is showing — the user switched away while it ran. The
 * result is for the window, but the reveal is for one project's tree, and that tree may not exist right
 * now. So the result queues its placed paths here, keyed by the project they landed in, and that
 * project's tree drains its own queue the next time it is ready: the user is NOT taken to the project
 * ("not by switching to it"), the reveal simply happens when they next come to look.
 *
 * Module-level and in memory, like the clipboard it follows: nothing here outlives the window, and a
 * queue for a project the user never revisits is a few strings.
 */

const queued = new Map<string, string[]>();
const listeners = new Set<() => void>();

/** Remember `paths` (absolute) for `projectId`. Later calls append; duplicates are kept once. */
export function queueReveal(projectId: string, paths: readonly string[]): void {
  if (paths.length === 0) return;
  const existing = queued.get(projectId) ?? [];
  const merged = [...existing];
  for (const p of paths) if (!merged.includes(p)) merged.push(p);
  queued.set(projectId, merged);
  for (const l of [...listeners]) l();
}

/** Take (and forget) everything queued for `projectId`, in the order it was queued. */
export function takeReveal(projectId: string): string[] {
  const taken = queued.get(projectId) ?? [];
  queued.delete(projectId);
  return taken;
}

/** Whether anything waits for `projectId` — for a drain that must not consume while not ready. */
export function hasPendingReveal(projectId: string): boolean {
  return (queued.get(projectId)?.length ?? 0) > 0;
}

/** Be told whenever something is queued. Returns the unsubscriber. */
export function subscribeReveal(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam. */
export function resetPendingRevealForTests(): void {
  queued.clear();
  listeners.clear();
}
