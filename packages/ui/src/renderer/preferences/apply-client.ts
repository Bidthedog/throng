/**
 * Preferences apply-client (feature 007, FR-016/017/018). Turns a validated edit
 * into an immediate config write: discrete controls (toggle/select/array) apply
 * at once; free-text/number edits settle via a short debounce before applying,
 * consistent with the editor's auto-save debounce. The write rides the existing
 * config watcher, so applying an edit and the app reacting to it are the same
 * path — no explicit Save, no restart.
 */
import type { ConfigDocId } from '@throng/core';
import { writeConfig, debounce, type ConfigWriteResult } from '../config/write-config.js';

export interface ApplyClient {
  /** Apply a whole document immediately (discrete control change / blur / close). */
  applyNow(value: unknown): Promise<ConfigWriteResult>;
  /** Apply after the debounce quiets (free-text/number typing). */
  applyDebounced(value: unknown): void;
  /** Force a pending debounced apply to run now (e.g. window closing). */
  flush(): void;
  /** Drop a pending debounced apply. */
  cancel(): void;
}

export function createApplyClient(id: ConfigDocId, debounceMs = 250): ApplyClient {
  const debounced = debounce((json: string) => {
    void writeConfig(id, json);
  }, debounceMs);

  return {
    applyNow(value) {
      debounced.cancel();
      return writeConfig(id, JSON.stringify(value));
    },
    applyDebounced(value) {
      debounced(JSON.stringify(value));
    },
    flush() {
      debounced.flush();
    },
    cancel() {
      debounced.cancel();
    },
  };
}
