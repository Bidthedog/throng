/**
 * file-search-ipc — wires the `fileSearch.*` preload bridge to the {@link FileSearchService}
 * (043 T055, contracts/file-search-ipc.md).
 *
 * It copies `file-index-ipc.ts` deliberately, because the channel it registers copies the file
 * index's channel deliberately (research R3): subscribe-by-starting, then deltas pushed to named
 * `webContents`, with the subscriber taken from `event.sender` and never from the payload. A
 * renderer-supplied `webContents` id would let one window stream another window's project, and the
 * push would then be perfectly well targeted at the wrong window.
 *
 * Round two (043 R23, FR-078) adds `attach`, because starting was no longer the only way to
 * subscribe: one panel can be displayed in two windows, and the second one has nothing to start. The
 * recipients are still NAMED — the run's viewer set — so there is still no broadcast here and
 * `getAllWindows()` is still never asked.
 *
 * `packages/ui/tests/unit/ipc-bridge-parity.test.ts` fails the build if a `throng:*` channel appears
 * here and not in `preload.cts`, or the reverse. All seven of the contract's channels are named in
 * this file for that reason as much as for their own.
 */
import { ipcMain, webContents } from 'electron';
import type { MatchModes } from '@throng/core';
import type { FileSearchService, FileSearchUpdate, StartScanRequest } from './file-search-service.js';
import type { CommitRequest, CommitResult, CommitTarget } from './replace-commit-service.js';

/**
 * The replace commit (contracts/file-search-ipc.md, `throng:fileSearch:commit`) — the one call in
 * this feature that writes (043 T094).
 *
 * Declared and registered here because the CHANNEL belongs to this surface, while the behaviour
 * behind it — the open/closed partition, the pre-write re-check, the authority relay — belongs to
 * {@link ReplaceCommitService}. `registerFileSearchIpc` takes it as an option because the two are
 * constructed at different points in the composition root: the scan service exists before the
 * editor coordinator does, and the commit needs the coordinator.
 */
export type CommitReplace = (request: CommitRequest) => Promise<CommitResult>;

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

const asModes = (value: unknown): MatchModes => {
  const modes = (value as { modes?: { caseSensitive?: unknown; wholeWord?: unknown } } | null)?.modes;
  // Anything that is not literally `true` is `false` — the same safe default the file index takes
  // for its own flag, and the one that matches the shipped find bar's off state.
  return { caseSensitive: modes?.caseSensitive === true, wholeWord: modes?.wholeWord === true };
};

const asStartRequest = (value: unknown): StartScanRequest => {
  const payload = (value ?? {}) as Record<string, unknown>;
  const scope = payload.scopeSubPath;
  return {
    panelId: asString(payload.panelId),
    projectRoot: asString(payload.projectRoot),
    scopeSubPath: typeof scope === 'string' && scope.length > 0 ? scope : null,
    term: asString(payload.term),
    modes: asModes(payload),
  };
};

/**
 * Parse a commit payload from the renderer (043 T094).
 *
 * Every field is coerced rather than trusted, for the same reason `asStartRequest` coerces its own:
 * this is the one call in the feature that WRITES, so a payload that is merely well-intentioned is
 * not good enough. A malformed edit becomes no edit — never an edit at an offset the sender did not
 * mean — and an unparseable target contributes an empty edit list, which the service skips.
 *
 * What is deliberately NOT validated here: whether the paths exist, whether they are open, and
 * whether the offsets still hold. All three are the service's, and all three must be answered in the
 * same main-side turn as the write (research R8) rather than one layer earlier.
 */
function asCommitRequest(value: unknown): CommitRequest {
  const payload = (value ?? {}) as Record<string, unknown>;
  const rawTargets = Array.isArray(payload.targets) ? payload.targets : [];
  const targets: CommitTarget[] = rawTargets.map((raw) => {
    const t = (raw ?? {}) as Record<string, unknown>;
    const rawEdits = Array.isArray(t.edits) ? t.edits : [];
    return {
      relPath: asString(t.relPath),
      edits: rawEdits
        .map((e) => (e ?? {}) as Record<string, unknown>)
        .filter((e) => Number.isInteger(e.from) && Number.isInteger(e.to))
        .map((e) => ({ from: e.from as number, to: e.to as number })),
    };
  });
  return {
    // FR-083c — WHICH panel is writing. Sent since the channel existed and coerced like everything
    // else here: an unreadable one becomes `''`, which matches no run, so the commit still writes
    // and nothing is spared a staleness marking it has earned.
    panelId: asString(payload.panelId),
    projectRoot: asString(payload.projectRoot),
    term: asString(payload.term),
    modes: asModes(payload),
    // An empty string is a VALID replacement and deletes (FR-046a) — which is exactly why the
    // fallback for a missing one is also `''` rather than a refusal.
    replacement: asString(payload.replacement),
    targets: targets.filter((t) => t.relPath.length > 0),
    confirmedIrreversible: payload.confirmedIrreversible === true,
  };
}

/**
 * Deliver one update to one window.
 *
 * Exported so the composition root can hand it to the service as its `push` without either of them
 * knowing about the other — the service never touches Electron, and this never walks a directory.
 */
export function pushFileSearchUpdate(webContentsId: number, payload: FileSearchUpdate): void {
  const target = webContents.fromId(webContentsId);
  // A window can be gone between a batch being cut and the push reaching it; that is ordinary, and
  // `release` in the composition root drops the runs it owned.
  if (!target || target.isDestroyed()) return;
  target.send('throng:fileSearch:update', payload);
}

export function registerFileSearchIpc(service: FileSearchService, commit?: CommitReplace): void {
  /*
   * The subscribing window is `event.sender`, never anything the renderer said.
   *
   * Starting IS subscribing on this channel — there is no separate subscribe call, because a scan
   * has exactly one consumer and no reason to outlive it.
   */
  ipcMain.handle('throng:fileSearch:start', (event, payload: unknown) => {
    const request = asStartRequest(payload);
    if (request.panelId.length === 0) return { started: false as const, reason: 'noProject' as const };
    return service.start(event.sender.id, request);
  });

  /*
   * A second window is now displaying this panel (043 FR-078, R23) — join its run.
   *
   * The gap this closes is #380 and US5 scenario 6: a Find in Files panel synced into a
   * sub-workspace showed an EMPTY panel, indistinguishable from a search that found nothing, so the
   * user retyped a search that was already correct. Starting was the only way to subscribe, and the
   * mirror had started nothing.
   *
   * `event.sender.id` for the same reason every other channel here uses it, and it carries more
   * weight on this one: a window may now attach to any panel it names, so the id of the window
   * RECEIVING one project's paths and match text is the last thing deciding where they can land.
   */
  ipcMain.on('throng:fileSearch:attach', (event, payload: unknown) => {
    const panelId = asString((payload as { panelId?: unknown } | null)?.panelId);
    if (panelId.length > 0) service.attach(event.sender.id, panelId);
  });

  ipcMain.on('throng:fileSearch:cancel', (event, payload: unknown) => {
    // Fire and forget, and idempotent: cancelling a scan that has already finished is a no-op, so
    // the renderer never has to know whether it won the race.
    const panelId = asString((payload as { panelId?: unknown } | null)?.panelId);
    if (panelId.length > 0) service.cancel(event.sender.id, panelId);
  });

  /*
   * The panel is gone — release its run (data-model §7).
   *
   * Distinct from `cancel`, which abandons a scan and KEEPS its partial results answerable to
   * FR-045a. Without a channel of its own the service could only release a run when the whole
   * WINDOW was destroyed, so the ordinary case — a finished scan whose panel the user closed — held
   * its stamps and cost a stat per held file on every watcher tick for the life of the window.
   *
   * `event.sender.id` for the same reason `start` uses it: a run belongs to the window that asked
   * for it, and a renderer-supplied id would let one window drop another's scan.
   */
  ipcMain.on('throng:fileSearch:drop', (event, payload: unknown) => {
    const panelId = asString((payload as { panelId?: unknown } | null)?.panelId);
    if (panelId.length > 0) service.drop(event.sender.id, panelId);
  });

  /*
   * 043 FR-091a — empty the panel's run, for every window watching it.
   *
   * The third lever beside `cancel` and `drop`, and neither of them would do: `cancel` KEEPS the rows
   * a synced view is showing, and `drop` detaches only the asking window and releases the run when
   * the last one goes — which would let the next scan restart its generation count below what every
   * renderer has already seen. `event.sender.id` for `cancel`'s reason: only a window displaying the
   * panel may clear it.
   */
  ipcMain.on('throng:fileSearch:clear', (event, payload: unknown) => {
    const panelId = asString((payload as { panelId?: unknown } | null)?.panelId);
    if (panelId.length > 0) service.clear(event.sender.id, panelId);
  });

  /*
   * The one call that writes. Everything about it — the partition, the pre-write re-check and the
   * write — happens inside the handler, in one main-side turn (contract, research R8).
   *
   * `event.sender` is deliberately unused: unlike the scan, a commit pushes nothing back to a
   * window, so there is no subscriber to record and nothing that could be mis-targeted. Its result
   * returns to whoever invoked it, which is what `invoke` already guarantees.
   */
  if (commit) {
    ipcMain.handle('throng:fileSearch:commit', (_event, payload: unknown) =>
      commit(asCommitRequest(payload)),
    );
  }
}
