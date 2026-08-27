/**
 * 041 FR-013/FR-014 (#327) — refused opens, on their way to a notice.
 *
 * ══ WHY A STORE, AND NOT A RETURN VALUE ══
 *
 * `editor-open.tsx` is a MODULE, not a component: it is called from menu handlers, drop handlers and
 * Quick Open, none of which is a React render. So it cannot call `useReportSubjectFailure` itself,
 * and the notice has to be raised by something that can.
 *
 * Threading the refusal back through every caller's return value was the alternative and is worse in
 * the specific way this feature cares about: FR-013a binds EVERY entry point, and a reason that each
 * caller must remember to forward is a rule that the next entry point will forget — which is exactly
 * how `openFileInNewEditor` came to bypass the check it needed. A sink the open path publishes to has
 * one producer and one consumer however many gestures reach it.
 *
 * The same idiom as `unsaved-open-store.ts`, deliberately: a tiny external store bridging module code
 * to a component, already established in this directory for the same reason.
 *
 * ══ IT IS A QUEUE, NOT A SLOT ══
 *
 * A drop carries n files and refuses them individually (018 FR-065), so two refusals can arrive
 * before either is rendered. A single slot would drop the first — silently, and only for multi-file
 * drops, which is the shape of bug that survives review.
 */
import { useSyncExternalStore } from 'react';

export interface RefusedOpen {
  /** What the user asked to open. Half the casualty's identity (FR-007). */
  absPath: string;
  /** Why throng declined. One of `NOT_A_MISSING_FILE`. */
  reason: string;
}

let queue: readonly RefusedOpen[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Record an open throng refused, for the notice surface to pick up. */
export function publishRefusedOpen(refusal: RefusedOpen): void {
  queue = [...queue, refusal];
  emit();
}

/** Take everything queued, leaving the queue empty. */
export function drainRefusedOpens(): readonly RefusedOpen[] {
  const taken = queue;
  queue = [];
  emit();
  return taken;
}

export function useRefusedOpens(): readonly RefusedOpen[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => queue,
    () => queue,
  );
}

/** Test seam: forget anything queued, so one spec cannot leak a refusal into the next. */
export function resetRefusedOpens(): void {
  queue = [];
  emit();
}
