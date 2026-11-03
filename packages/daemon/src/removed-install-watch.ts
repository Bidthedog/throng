/**
 * When a daemon whose package was removed should end (063 FR-013, research D7).
 *
 * The daemon outlives the window by design, and nothing can start it again once its files are gone. So it ends by
 * itself, once nothing needs it: no window is connected, and no terminal is still running. A shell is the user's,
 * so removing a package never ends one; the daemon waits for the last to finish.
 *
 * An upgrade keeps this version's folder, so its entry is still there and this never fires (research D2).
 */
export function shouldExitForRemovedInstall(state: {
  readonly entryExists: boolean;
  readonly clients: number;
  readonly liveSessions: number;
}): boolean {
  return !state.entryExists && state.clients === 0 && state.liveSessions === 0;
}
