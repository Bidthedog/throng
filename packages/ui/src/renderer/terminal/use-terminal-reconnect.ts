import { useEffect } from 'react';
import { shouldWatchForRecovery, type FailureCause } from '@throng/core';

/**
 * 039 US3 (#237) — arm a path-availability watch for a terminal that failed on a missing working
 * directory, and retry once when it comes back.
 *
 * ══ WHY THE RETRY GOES THROUGH `onRetry` AND NOT A SHORTCUT ══
 *
 * FR-041 requires the reconnect to be driven exactly as a start is, and FR-039 requires ↻ Retry to
 * keep working unchanged. Both are satisfied by handing this hook the SAME callback the retry
 * control uses: there is one start path, and the watch simply presses the same button the user
 * would have. A private restart here would be a second way to start a terminal, and the two would
 * drift the first time either changed.
 *
 * ══ WHAT THIS DELIBERATELY DOES NOT COVER ══
 *
 * Only the panels that are MOUNTED, which is the active tab's (`tab-group.tsx:1538` renders only
 * `activeTab`'s tree). That is not a gap — see spec 039 Finding 3. A terminal in a background tab
 * never started, so it never failed and has nothing to recover; when the user opens that tab it
 * mounts and starts, and if the path is back it simply works. Unmounting and remounting IS a retry.
 */
export function useTerminalReconnect(opts: {
  panelId: string;
  /** The project the Panel belongs to. A path event must never cross projects (FR-037). */
  projectId: string | null;
  /** The working directory the terminal wanted — what must come back before it retries (FR-031). */
  target: string | null;
  /** The classified start failure, or `null` while the terminal is fine. */
  failure: FailureCause | null;
  /** The retry the ↻ control runs. The watch presses the same button (FR-039, FR-041). */
  onRetry: () => void;
}): void {
  const { panelId, projectId, target, failure, onRetry } = opts;
  const armed = shouldWatchForRecovery(failure?.kind ?? null) && !!projectId && !!target;

  useEffect(() => {
    if (!armed) return;
    void window.throng?.terminal?.armReconnect?.(panelId, projectId!, target!);
    /*
     * FR-042 — the watch never outlives the reason for it.
     *
     * This cleanup runs on unmount (the tab was switched away, the Panel destroyed, the project
     * closed) AND whenever `armed` goes false, which is what happens the moment the terminal
     * attaches successfully: `onAttached` clears the start failure, so the cause is gone and this
     * effect tears down. A terminal that recovered therefore disarms itself without anyone having to
     * remember to.
     */
    return () => {
      void window.throng?.terminal?.disarmReconnect?.(panelId);
    };
  }, [armed, panelId, projectId, target]);

  useEffect(() => {
    if (!armed) return;
    /*
     * ONE message carries EVERY released panel (FR-033), so each mounted panel checks whether it is
     * named rather than each getting its own event. A panel not in the list does nothing at all —
     * including a panel in another project, which main has already excluded before sending.
     */
    return window.throng?.terminal?.onPathBack?.((evt) => {
      if (evt.panelIds.includes(panelId)) onRetry();
    });
  }, [armed, panelId, onRetry]);
}
