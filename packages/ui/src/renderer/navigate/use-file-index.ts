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
import { useEffect, useRef, useState } from 'react';
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
  /** The root the effect last subscribed to, so a re-run can tell WHICH dependency moved. */
  const subscribedRoot = useRef<string | null>(null);

  useEffect(() => {
    if (root === null || root === '' || !active) {
      setView(IDLE);
      subscribedRoot.current = null;
      return;
    }

    const rootChanged = subscribedRoot.current !== root;
    subscribedRoot.current = root;

    /*
     * R4 — a ROOT change clears `paths` BEFORE the new root's arrive.
     *
     * React runs the previous effect's cleanup before this body, so the old root is already
     * unsubscribed by the time we get here. Resetting to `building` is the other half: without it a
     * window would render the OLD project's files under the NEW project's name for as long as the
     * walk takes, which is FR-005's failure wearing a timing disguise.
     *
     * ══ BUT A FLAG CHANGE IS NOT A ROOT CHANGE ══
     *
     * Flipping `includeHidden` re-runs this effect too, and blanking there was WRONG in a way the
     * user could see: switching the exclusion toggle OFF is a subscription key main has to walk
     * fresh, so the emptied list stayed empty long enough to read as a flash — while switching it
     * back ON hit an index main already held and returned too fast to notice. One toggle, two
     * behaviours, for no reason the user could infer.
     *
     * The distinction that matters is stale versus FALSE. Another project's files under this
     * project's name are false and must go. The same project's files under a slightly different
     * filter are merely stale, and holding them for the few hundred milliseconds the second walk
     * takes is both honest and quiet — the `building` status still renders FR-069d's "still
     * listing" line ALONGSIDE the list, so nothing claims the old answer is the new one.
     */
    setView((current) =>
      rootChanged || current.status !== 'ready' ? BUILDING : { status: 'building', paths: current.paths },
    );

    let live = true;
    /*
     * True while this subscription is still showing the PREVIOUS key's paths.
     *
     * Keeping them in `setView` above was not enough on its own, and the reason is worth stating
     * because it is the whole of the remaining flash. Two other paths blank the list, and both look
     * correct in isolation:
     *
     *   - the `subscribe` reply below does `paths: initial.paths ?? []`, and a fresh subscription's
     *     first reply is `{ status: 'building' }` with no paths at all;
     *   - `applyIndexUpdate` implements FR-075 — a push carrying NEITHER a set nor a delta means
     *     main has DISOWNED this index, so what is held is discarded.
     *
     * A brand-new subscription's opening message and a disown are the same shape. The difference is
     * history: a disown can only follow a `ready` we have already been given for THIS key. So until
     * the first `ready` arrives, a bare `building` means "still walking" and the carried-over list
     * stays; afterwards it means what FR-075 says and the list goes.
     */
    let carriedOver = !rootChanged;
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
      // A bare `building` before this key has ever delivered a `ready` is the walk starting, not a
      // disown — hold the carried-over list rather than blanking it (see `carriedOver` above).
      if (carriedOver && evt.status === 'building' && !evt.paths && !evt.added && !evt.removed) return;
      if (evt.status === 'ready') carriedOver = false;
      // The fold itself is pure and lives in core (FR-075) — including the rule that a push carrying
      // NEITHER a set nor a delta means main has disowned this one, so what is held is discarded.
      setView((current) => applyIndexUpdate(current, evt));
    });

    void (async () => {
      const initial = await window.throng?.fileIndex?.subscribe?.(root, includeHidden);
      if (!live || !initial || pushed) return;
      // Same rule as the push handler: an opening `building` with no paths must not blank a list
      // carried over from the previous key, or the toggle flashes empty while main walks.
      if (carriedOver && initial.status === 'building' && !initial.paths) return;
      if (initial.status === 'ready') carriedOver = false;
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
