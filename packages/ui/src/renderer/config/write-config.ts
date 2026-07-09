/**
 * Renderer config-write plumbing (feature 007, T010). The base helpers every
 * preferences tab's apply-client builds on: {@link writeConfig} (the sandbox
 * bridge to the main-process write path) and {@link debounce} (settle text/number
 * edits before applying, FR-016 immediate-apply). Kept free of React/DOM
 * module-scope so the debounce timing is unit-testable in the node env.
 */
import type { ConfigDocId } from '@throng/core';

export type ConfigWriteResult = { ok: true } | { ok: false; error: string };

/**
 * Persist a config document as raw JSON via the preload bridge. Returns the
 * main-process {@link ConfigWriteResult}; if the bridge is unavailable (e.g. a
 * test render without preload) it resolves to a failure rather than throwing so
 * callers can surface it without crashing.
 */
export async function writeConfig(id: ConfigDocId, json: string): Promise<ConfigWriteResult> {
  const write = window.throng?.config?.write;
  if (!write) return { ok: false, error: 'bridge-unavailable' };
  return write(id, json);
}

/** A debounced function with imperative {@link Debounced.cancel}/{@link Debounced.flush}. */
export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  /** Drop any pending invocation. */
  cancel(): void;
  /** Invoke a pending call now (with its latest args), if one is scheduled. */
  flush(): void;
}

/**
 * Trailing-edge debounce: coalesces rapid calls into a single invocation `ms`
 * after the last call, using the most recent arguments. Used to settle
 * text/number edits before applying (FR-016; consistent with the editor's
 * existing auto-save debounce).
 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: A | null = null;

  const run = (): void => {
    timer = null;
    const args = pendingArgs;
    pendingArgs = null;
    if (args) fn(...args);
  };

  const debounced = ((...args: A): void => {
    pendingArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, ms);
  }) as Debounced<A>;

  debounced.cancel = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    pendingArgs = null;
  };

  debounced.flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      run();
    }
  };

  return debounced;
}
