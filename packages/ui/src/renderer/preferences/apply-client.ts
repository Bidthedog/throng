/**
 * Preferences apply-client (feature 007, FR-016/017/018; 032 FR-001). Turns a validated edit into an
 * immediate config write. The write rides the existing config watcher, so applying an edit and the
 * app reacting to it are the same path — no explicit Save, no restart.
 *
 * ══ WHAT 032 CHANGED, AND WHY IT IS THE WHOLE FEATURE ══
 *
 * This used to take the finished document: `applyNow(value)` serialised whatever the caller handed
 * it and replaced the file. Every caller built that document by copying the settings it was
 * rendering and changing one key — so the write carried a snapshot of EVERY key, taken whenever the
 * renderer last heard from the watcher.
 *
 * That is the mechanism behind #249 and #260. The main window and the Preferences window each keep
 * their own copy; whichever writes second reverts every key the first one changed, because its copy
 * predates them and it has no way to know. Nothing errors. The setting simply goes back.
 *
 * The fix is not a better merge, a longer debounce or a freshness check — it is removing the ability
 * to express the mistake. A caller that says "`appearance.theme` is now Matrix" cannot revert
 * anything else, whatever its copy says, because it never mentions anything else.
 */
import type { ConfigDocId } from '@throng/core';
import { writeConfigPatch, type ConfigWriteResult } from '../config/write-config.js';

export interface ApplyClient {
  /**
   * Apply ONE key-scoped change immediately (discrete control change / blur / close).
   *
   * `path` is an array of segments rather than a dotted string, matching the IPC contract: a dotted
   * string cannot address a key that itself contains a dot, and this repository has them.
   */
  applyChange(path: readonly string[], value: unknown): Promise<ConfigWriteResult>;
}

/**
 * This client applies IMMEDIATELY, and always has.
 *
 * It once carried a 250ms `applyDebounced`, plus the `flush`/`cancel` that drove it. That
 * debounce was UNREACHABLE (019 C24): `applyDebounced` had no callers, every write went through
 * `applyNow` — which cancelled the debounce and wrote at once — and so the flush its callers ran
 * on unmount had only ever flushed a timer that could not be armed. Four analyses of the shutdown
 * drain described a deferred write here that never existed. Deleted rather than converted
 * (Principle VIII): a debounce nobody arms is not a write the drain has to settle, and the
 * writers that ARE deferred schedule through the write module instead.
 */
export function createApplyClient(id: ConfigDocId): ApplyClient {
  return {
    applyChange(path, value) {
      return writeConfigPatch(id, [{ path, value }]);
    },
  };
}
