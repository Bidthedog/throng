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
 *
 * ══ THIS CLASS SPAWNS NOTHING, AND THAT MUST STAY TRUE — OR ONE THING MUST CHANGE WITH IT ══
 *
 * All it does is tell the renderer "these panels may start again". The renderer starts them by the
 * ORDINARY route, which lands on `terminal.attach`'s cold-start path, where the daemon stamps
 * `session.shellStartedAt` immediately before `host.start()`.
 *
 * That matters to code outside this feature. Spec 038's #280 fix uses `shellStartedAt` as the floor
 * for a pid-reuse guard — a command observed on a pid older than the shell cannot belong to that
 * shell. Because every reconnect here is a cold start, the floor is refreshed each time, which is
 * exactly what the guard needs.
 *
 * **If this is ever changed to respawn a shell while REUSING an existing session record,
 * `shellStartedAt` MUST be re-stamped at the same moment.** Left alone it would describe the
 * PREVIOUS shell — older than the live one — and the guard would silently stop bounding what it was
 * written to bound. It would still err toward admitting rather than rejecting, so nothing would look
 * broken, and **no test would catch it**: the wiring test asserts the argument is passed, not that
 * its value is fresh. This comment is the only guard that will exist.
 */
/**
 * What arming produced. A VALUE, never an exception — 039 US3's whole premise is that recovery
 * happens without the user asking, so there is no gesture to report a throw against.
 *
 * This is the shape `subworkspace-open.contract.test.ts` was written to establish, and the reasoning
 * transfers exactly: its handler was `ipcMain.on(…, () => { void (async () => { … })(); })`, so
 * anything that threw became an unhandled rejection — no window, no error, no notice, and the user
 * left pressing a button that did nothing. Here it is worse, because there is no button: a throw
 * from `arm` would leave the terminal permanently unrecoverable with nothing on screen to say so,
 * and nobody would even know an attempt had been made.
 */
export type ArmResult =
  | { ok: true; watching: string }
  /** Nothing in the path's chain exists — an unmounted drive, a disconnected share. */
  | { ok: false; reason: 'no-existing-ancestor' }
  /** The filesystem probe itself failed: a path too long, an ACL on an ancestor, a vanished drive. */
  | { ok: false; reason: 'probe-failed' }
  /** The directory exists but the watcher would not attach to it. */
  | { ok: false; reason: 'watch-failed' };

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
  arm(panelId: string, projectId: string, target: string): ArmResult {
    this.disarm(panelId);
    let watching: string | null;
    try {
      watching = watchTargetFor(target, this.deps.exists, this.deps.parentOf);
    } catch {
      // `exists` is a filesystem call and CAN throw — a path too long, a permission refusal on an
      // ancestor, a drive that disappeared between two calls.
      return { ok: false, reason: 'probe-failed' };
    }
    // Nothing in the chain exists — an unmounted drive, a disconnected share. There is nowhere to
    // put a watch, so this panel cannot self-recover and ↻ Retry stays its route back (FR-039).
    if (watching === null) return { ok: false, reason: 'no-existing-ancestor' };
    if (!this.watches.has(watching)) {
      let handle: Disposable;
      try {
        handle = this.deps.fileWatcher.watch(watching, () => this.onChanged(watching!));
      } catch {
        return { ok: false, reason: 'watch-failed' };
      }
      this.watches.set(watching, handle);
    }
    // Recorded only once a watch genuinely exists for it. Pushing first and failing to watch would
    // leave a panel waiting on an event that can never arrive — indistinguishable, from the outside,
    // from a panel that is being watched properly.
    this.pending.push({ panelId, projectId, target, watching });
    return { ok: true, watching };
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
    let released: PendingReconnect[];
    try {
      const projects = new Set(
        this.pending.filter((p) => p.watching === watching).map((p) => p.projectId),
      );
      released = [];
      for (const projectId of projects) {
        released.push(
          ...reconnectsReleasedBy(this.pending, { projectId, path: watching }, this.deps.exists),
        );
      }
    } catch {
      /*
       * `exists` touches the filesystem and can throw — and this runs inside a WATCHER CALLBACK, so
       * a throw here is an unhandled exception in the main process rather than something a caller
       * sees. Swallowing it leaves every pending panel armed, which is the right failure: the next
       * event re-asks the same question, and ↻ Retry was never taken away.
       */
      return;
    }
    if (released.length === 0) return;
    // Disarm BEFORE notifying. The retry is bounded to one attempt per failure (FR-030), and a
    // notify that synchronously drove a restart which failed again would otherwise re-enter here
    // against entries still in the list.
    for (const p of released) this.disarm(p.panelId);
    try {
      this.deps.notify(released.map((p) => p.panelId));
    } catch {
      // Broadcasting to a window that is being destroyed can throw. The panels are already
      // disarmed, so there is nothing to unwind — and a throw escaping a watcher callback would
      // take down more than this feature.
    }
  }

  private releaseWatchIfUnused(dir: string): void {
    if (this.pending.some((p) => p.watching === dir)) return;
    try {
      this.watches.get(dir)?.dispose();
    } catch {
      // A watcher that fails to close is not worth propagating out of a disarm — the entry is
      // dropped either way, so the alternative is a leaked map entry AND an exception.
    }
    this.watches.delete(dir);
  }
}
