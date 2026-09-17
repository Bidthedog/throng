/**
 * Synchronise Scrolling — the ONE command body (044 FR-122, FR-122d, FR-122e; plan decision 7;
 * contracts/menus-and-controls.md §10).
 *
 * Every surface that shows the toggle runs this: the `preview.toggleSyncScroll` chord, the editor's and
 * the preview's body and header menu items, and the two status-bar buttons. Nothing else writes this
 * preference outside the Preferences window.
 *
 * ══ ONE KEY, NEVER THE DOCUMENT ══
 *
 * A key-scoped patch (032 FR-001), so a toggle made here cannot revert a key another window changed a
 * moment ago. Two windows toggling at once is last-write-wins (032 FR-003) — acceptable for a boolean
 * every surface shows.
 *
 * ══ NO OPTIMISTIC STATE ══
 *
 * The caller passes the value the window currently holds, read from its config store; the store changes
 * only when the patch lands (`onConfigPatched`) or the watcher broadcasts. So a write that fails leaves
 * every surface showing the stored value with nothing to roll back, and the failure is reported once, in
 * this window, by the write-failure subscriber every writing window mounts (FR-122e;
 * `config-write-notices.ts`). The result is returned for a caller that wants it, never needed.
 */
import { writeConfigPatch, type ConfigWriteResult } from '../config/write-config.js';

const SYNC_SCROLL_PATH = ['editor', 'previews', 'syncScroll'] as const;

/** Flip scroll sync from `current` — the value this window's config store holds now. */
export function toggleSyncScroll(current: boolean): Promise<ConfigWriteResult> {
  return writeConfigPatch({ kind: 'settings' }, [{ path: SYNC_SCROLL_PATH, value: !current }]);
}
