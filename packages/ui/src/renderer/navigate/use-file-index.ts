/**
 * The renderer's mirror of one project's file index (033, contracts/file-index.md §4, R1–R5).
 *
 * ══ THE ONE CONSUMER OF THE `fileIndex` BRIDGE ══
 *
 * R1. Every component that wants candidate paths goes through this hook, and nothing calls
 * `window.throng.fileIndex` directly. That is not tidiness: the subscription is REF-COUNTED in UI
 * main (S9), so a second caller subscribing and forgetting to unsubscribe keeps a filesystem watch
 * alive for the life of the window.
 *
 * ══ WHY TYPING COSTS NOTHING ══
 *
 * R5, and it is the whole architecture of Quick Open. The candidate array is held HERE, in the
 * renderer, kept current by deltas main pushes when the disk changes (FR-016). A keystroke reads
 * that array and does nothing else — no IPC, no walk, no `files.*` call. `quick-open-perf.e2e.ts`
 * asserts exactly that by counting the messages the renderer sends while ten characters are typed.
 */
import { useEffect, useState } from 'react';

export interface FileIndexView {
  status: 'idle' | 'building' | 'ready';
  paths: readonly string[];
}

const IDLE: FileIndexView = { status: 'idle', paths: [] };
const BUILDING: FileIndexView = { status: 'building', paths: [] };

/**
 * Subscribe to `root`'s index while `active`, and mirror it.
 *
 * `root === null` — no project open in this window — is `idle` with no subscription (R3), which is
 * what the Quick Open command reads to decide not to open at all.
 */
export function useFileIndex(root: string | null, active: boolean): FileIndexView {
  const [view, setView] = useState<FileIndexView>(IDLE);

  useEffect(() => {
    if (root === null || root === '' || !active) {
      setView(IDLE);
      return;
    }

    /*
     * R4 — a root change clears `paths` BEFORE the new root's arrive.
     *
     * React runs the previous effect's cleanup before this body, so the old root is already
     * unsubscribed by the time we get here. Resetting to `building` is the other half: without it a
     * window would render the OLD project's files under the NEW project's name for as long as the
     * walk takes, which is FR-005's failure wearing a timing disguise.
     */
    setView(BUILDING);

    let live = true;
    /*
     * True once a PUSH has been applied. The `subscribe` reply and the first push race — main
     * answers `{ status: 'building' }` and completes the walk moments later — and applying a stale
     * `building` reply on top of a delivered `ready` would blank a list the user is already reading.
     */
    let pushed = false;

    // Registered BEFORE subscribing, so a walk that finishes between the two is not missed.
    const off = window.throng?.fileIndex?.onUpdate?.((evt) => {
      if (!live || evt.root !== root) return;
      pushed = true;
      setView((current) => {
        if (evt.paths !== undefined) return { status: evt.status, paths: evt.paths };
        if (evt.added === undefined && evt.removed === undefined) {
          return { status: evt.status, paths: current.paths };
        }
        const removed = new Set(evt.removed ?? []);
        const next = current.paths.filter((p) => !removed.has(p));
        // The index is produced in `Array.prototype.sort()` order (W7) and `diffPaths` merges with
        // `<` against that same order — so re-sorting the patched array the same way keeps the
        // renderer's copy identical to main's rather than merely equal as a set.
        for (const added of evt.added ?? []) next.push(added);
        next.sort();
        return { status: evt.status, paths: next };
      });
    });

    void (async () => {
      const initial = await window.throng?.fileIndex?.subscribe?.(root);
      if (!live || !initial || pushed) return;
      setView({ status: initial.status, paths: initial.paths ?? [] });
    })();

    return () => {
      live = false;
      off?.();
      window.throng?.fileIndex?.unsubscribe?.(root);
    };
  }, [root, active]);

  return view;
}
