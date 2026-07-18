/**
 * Preferences apply-client (feature 007, FR-016/017/018). Turns a validated edit
 * into an immediate config write: discrete controls (toggle/select/array) apply
 * at once; free-text/number edits settle via a short debounce before applying,
 * consistent with the editor's auto-save debounce. The write rides the existing
 * config watcher, so applying an edit and the app reacting to it are the same
 * path — no explicit Save, no restart.
 */
import type { ConfigDocId } from '@throng/core';
import { writeConfig, type ConfigWriteResult } from '../config/write-config.js';

export interface ApplyClient {
  /** Apply a whole document immediately (discrete control change / blur / close). */
  applyNow(value: unknown): Promise<ConfigWriteResult>;
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
    applyNow(value) {
      return writeConfig(id, JSON.stringify(value));
    },
  };
}
