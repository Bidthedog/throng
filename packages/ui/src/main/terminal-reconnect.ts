import type { IFileWatcher, Disposable } from '@throng/core';
import {
  reconnectsReleasedBy,
  watchTargetFor,
  type PendingReconnect,
} from '@throng/core';

/**
 * 039 US3 (#237) — terminals that failed on an unavailable working directory start themselves when
 * that directory comes back.
 *
 * ══ WHY THIS IS IN MAIN AND NOT IN THE PANEL ══
 *
 * The renderer cannot do it. `files.onChange` is the explorer's watcher and is confined to the
 * ACTIVE PROJECT ROOT — which is precisely the directory that has gone missing in the case this
 * feature is about, so the watch that would tell us it came back is the watch that could not be
 * established. There is nothing else in the preload bridge that watches an arbitrary path.
 *
 * Main has `IFileWatcher`, which is what `EditorCoordinator` already uses for the same purpose at
 * `editor-coordinator.ts:1110` — a watch on the containing directory, armed per document. This is
 * the terminal's equivalent, and it is deliberately a separate instance rather than a shared signal:
 * see the 039 spec, Finding 2 and decision D-1, and #306 for the consolidation.
 *
 * ══ ONE WATCH PER DIRECTORY, NOT PER PANEL ══
 *
 * Every terminal in a project whose root went away resolves to the SAME nearest existing ancestor,
 * so arming per panel would place N identical watches on one directory and fire N times for one
 * rename. Keying by directory means one watch, one event, and N panels released together — which is
 * what FR-033 asks for when it says recovery raises no per-panel notice, and what makes the issue's
 * "one path-availability event" true as an observable even though no such event exists in the system
 * (Finding 2).
 */
export interface TerminalReconnectDeps {
  fileWatcher: IFileWatcher;
  /** Does this path exist and resolve to a directory? Injected so the class stays testable. */
  exists: (path: string) => boolean;
  /** The parent directory, or `null` at a filesystem root. */
  parentOf: (path: string) => string | null;
  /** Tell the renderer these panels may start again. Called ONCE per event, with every panel. */
  notify: (panelIds: string[]) => void;
}

export class TerminalReconnect {
  private readonly pending: PendingReconnect[] = [];
  private readonly watches = new Map<string, Disposable>();

  constructor(private readonly deps: TerminalReconnectDeps) {}

  /**
   * A terminal failed to start because `target` could not be resolved. Watch for its return.
   *
   * The CALLER decides whether the failure qualifies — `shouldWatchForRecovery` in core owns that
   * rule (FR-035: only `path-missing`, never a permission refusal or a bad shell binary). This
   * method is not the place to re-derive it, because the cause lives with the failure and not here.
   *
   * Idempotent per panel: re-arming replaces the previous entry rather than accumulating a second,
   * so a panel that fails, is retried by hand, and fails again does not end up with two watches and
   * two retries.
   */
  arm(panelId: string, projectId: string, target: string): void {
    this.disarm(panelId);
    const watching = watchTargetFor(target, this.deps.exists, this.deps.parentOf);
    // Nothing in the chain exists — an unmounted drive, a disconnected share. There is nowhere to
    // put a watch, so this panel cannot self-recover and ↻ Retry stays its route back (FR-039).
    if (watching === null) return;
    this.pending.push({ panelId, projectId, target, watching });
    if (!this.watches.has(watching)) {
      this.watches.set(
        watching,
        this.deps.fileWatcher.watch(watching, () => this.onChanged(watching)),
      );
    }
  }

  /**
   * Stop watching for this panel — FR-042.
   *
   * Called when the terminal starts by ANY route (the reconnect, ↻ Retry, or a remount), when the
   * Panel is destroyed, and when the project closes. A watch left behind after its panel is gone is
   * a leak that fires into nothing, and on a project the user has closed it is a watch on a
   * directory they may be about to delete.
   */
  disarm(panelId: string): void {
    const i = this.pending.findIndex((p) => p.panelId === panelId);
    if (i < 0) return;
    const [gone] = this.pending.splice(i, 1);
    this.releaseWatchIfUnused(gone!.watching);
  }

  /** Every panel of a project — used when the project closes (FR-042, FR-037). */
  disarmProject(projectId: string): void {
    for (const p of this.pending.filter((x) => x.projectId === projectId)) this.disarm(p.panelId);
  }

  /** Everything, for shutdown. */
  dispose(): void {
    this.pending.length = 0;
    for (const [, w] of this.watches) w.dispose();
    this.watches.clear();
  }

  private onChanged(watching: string): void {
    /*
     * The watch is on an ANCESTOR, so "something changed under here" is not "my directory is back".
     * `reconnectsReleasedBy` re-checks each target, which is what stops an unrelated sibling folder
     * being created from releasing every terminal waiting on that parent — each would then fail
     * again immediately, which is the thrash FR-035 forbids arriving by a different door.
     *
     * The project id is carried on the pending entry rather than derived from the path, because two
     * projects under one parent (a monorepo) legitimately watch the same directory and FR-037 says a
     * path event in one must never start the other's terminals.
     */
    const projects = new Set(
      this.pending.filter((p) => p.watching === watching).map((p) => p.projectId),
    );
    const released: PendingReconnect[] = [];
    for (const projectId of projects) {
      released.push(
        ...reconnectsReleasedBy(this.pending, { projectId, path: watching }, this.deps.exists),
      );
    }
    if (released.length === 0) return;
    // Disarm BEFORE notifying. The retry is bounded to one attempt per failure (FR-030), and a
    // notify that synchronously drove a restart which failed again would otherwise re-enter here
    // against entries still in the list.
    for (const p of released) this.disarm(p.panelId);
    this.deps.notify(released.map((p) => p.panelId));
  }

  private releaseWatchIfUnused(dir: string): void {
    if (this.pending.some((p) => p.watching === dir)) return;
    this.watches.get(dir)?.dispose();
    this.watches.delete(dir);
  }
}
