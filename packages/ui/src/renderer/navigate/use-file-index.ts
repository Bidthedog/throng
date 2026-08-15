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
import { IDLE_FILE_INDEX_VIEW, applyIndexUpdate, type FileIndexView } from '@throng/core';

export type { FileIndexView };

const IDLE = IDLE_FILE_INDEX_VIEW;
const BUILDING: FileIndexView = { status: 'building', paths: [] };

/**
 * Subscribe to `root`'s index while `active`, and mirror it.
 *
 * `root === null` — no project open in this window — is `idle` with no subscription (R3), which is
 * what the Quick Open command reads to decide not to open at all.
 *
 * `includeHidden` selects WHICH of the root's two indices to mirror (033 FR-069). It is part of the
 * subscription, not a filter: main walks with or without the project's exclusions, so the toggle
 * never asks the renderer to hold a set nobody wanted. Two hooks on one root at different flags are
 * two independent subscriptions, and each recognises its own pushes by the flag they echo.
 */
export function useFileIndex(
  root: string | null,
  active: boolean,
  includeHidden = false,
): FileIndexView {
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
      /*
       * The flag is part of the identity being matched, not decoration.
       *
       * A window may hold two subscriptions to one root — the standing one at the setting's value
       * and a short-lived one at the opposite (FR-069) — and both arrive on this single channel.
       * Matching on `root` alone would fold one index's deltas into the other's set, which produces
       * a list that is neither, silently, and only while the toggle is flipped.
       */
      if (!live || evt.root !== root || evt.includeHidden !== includeHidden) return;
      pushed = true;
      // The fold itself is pure and lives in core (FR-075) — including the rule that a push carrying
      // NEITHER a set nor a delta means main has disowned this one, so what is held is discarded.
      setView((current) => applyIndexUpdate(current, evt));
    });

    void (async () => {
      const initial = await window.throng?.fileIndex?.subscribe?.(root, includeHidden);
      if (!live || !initial || pushed) return;
      setView({ status: initial.status, paths: initial.paths ?? [] });
    })();

    return () => {
      live = false;
      off?.();
      window.throng?.fileIndex?.unsubscribe?.(root, includeHidden);
    };
  }, [root, active, includeHidden]);

  return view;
}
