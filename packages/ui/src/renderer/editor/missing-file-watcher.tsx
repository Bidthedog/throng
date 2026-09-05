/**
 * Tab-open "could not open" watcher (006, FR-100/105 · 030 US3, FR-030/FR-035).
 *
 * The failure is reported HERE — once per tab activation — and not inside each editor's mount
 * effect, so merely dragging or moving a panel (which remounts an editor without changing the active
 * tab) never re-warns. Gated by `editor.warnOnMissingFile`. Mounted once per window (in
 * EditorChrome).
 *
 * ══ WHAT 030 CHANGED ══
 *
 * This used to hand the whole tab to `showMissingFilesNotice`, which composed ONE "Cannot open 3
 * files" dialog per tab. FR-035 removes that batching outright: the tab is not the unit a user
 * thinks in, the CAUSE is, and one absent project root defeats editors across four tabs and
 * terminals across two. So each panel is now reported individually and the notification model merges
 * them — which is also what makes the notice GROW as tabs are visited, rather than raising a fresh
 * dialog for each one (FR-030/FR-037).
 *
 * The per-tab scan itself survives untouched, and is now doing a different job: it is what DISCOVERS
 * the casualties in a tab nothing has rendered yet.
 */
import { useEffect, useRef } from 'react';
import { collectPanels, EDITOR_KIND } from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';
import { useAppSettings } from '../config/config-store.js';
import { useReportPanelFailure } from '../workspace/panel-failure-notice.js';
import { getEditorState, subscribeEditorStates } from './editor-state.js';
import { missingFileDetail, missingFileMessage } from './editor-missing-notice.js';

/**
 * How long to let the tab's editors mount and publish before looking.
 *
 * It is a DEBOUNCE, not a deadline (#369). A panel that has not answered by the time this elapses is
 * waited for by name — see the watch below — so this number decides only how soon the first report
 * can go out, never whether one goes out at all. It used to decide both, which is why a slower
 * machine silently lost the consolidated notice altogether.
 */
const SCAN_DELAY_MS = 300;

/** A panel, as much of one as this component needs. */
interface Casualty {
  id: string;
  title: string;
}

export function MissingFileWatcher(): null {
  const ws = useWorkspace();
  const warn = useAppSettings().editor.warnOnMissingFile;
  const activeTabId = ws.layout?.activeTabId;
  const prev = useRef<string | undefined>(undefined);
  const prevWarn = useRef(warn);
  const report = useReportPanelFailure();
  const reportRef = useRef(report);
  reportRef.current = report;

  useEffect(() => {
    /*
     * Two things may have moved, and only one of them used to count (#288).
     *
     * The rule this effect exists for is FR-105: react to an actual tab CHANGE — open or re-select
     * — and not to every re-render, because dragging or moving a panel rebuilds the layout without
     * changing the active tab, and a warning fired from each editor's own mount effect would
     * re-warn on every such move.
     *
     * But the guard that enforced it compared ONLY the tab, so `warn` — the second entry in this
     * effect's hand-written dependency list — was inert. Turning `editor.warnOnMissingFile` back on
     * while looking at a tab returned here before the setting was ever read, and the user got
     * silence until they switched tabs and came back. The dependency was deliberate; the guard
     * simply never let it through.
     *
     * So both are tracked. A rebuild on an unchanged tab with an unchanged setting still returns —
     * which is the case `missing-file-watcher.test.ts:197` pins, and it must stay pinned.
     */
    const tabChanged = activeTabId !== prev.current;
    const warnChanged = warn !== prevWarn.current;
    prev.current = activeTabId;
    prevWarn.current = warn;
    if (!tabChanged && !warnChanged) return;
    if (!activeTabId || !warn) return;
    const tab = ws.layout?.tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    const panels = collectPanels(tab.root).filter((p) => p.kind === EDITOR_KIND);

    let unwatch: (() => void) | undefined;

    const raise = (p: Casualty): void => {
      const st = getEditorState(p.id);
      const os = window.throng?.osName ?? 'windows';
      reportRef.current({
        panelId: p.id,
        message: missingFileMessage('missing'),
        // The path rides as the row's own detail — copied and logged, never rendered (FR-034).
        detail: missingFileDetail(
          { filePath: st?.filePath ?? null, panelName: p.title, reason: 'missing' },
          os,
        ),
        /*
         * WHAT KIND OF FAILURE THIS IS (FR-029) — the half that was missing.
         *
         * A file that is not there is `path-missing`, and saying so is what lets the consolidated
         * notice supersede the file tree's report of the same absent folder. Reporting without it
         * left the notice with no cause key, so the two stood side by side: measured in a real
         * session as "Couldn't list the contents of test 1" and "Couldn't open test 1", 265 ms
         * apart, for one renamed folder.
         *
         * The KIND only. The subject has to be the project the notice is about, and this scan does
         * not know its name — `useReportPanelFailure` does, and supplies it.
         */
        causeKind: 'path-missing',
      });
    };

    /**
     * DEFEATED BY THE PATH — on either of the two flags that can say so (#277).
     *
     * `fileMissing` is set by a view that ATTEMPTED A LOAD and was refused. `unloadable` is the
     * AUTHORITY's verdict on the path, broadcast to every view of the document. They are
     * deliberately distinct (see `EditorUiState`), and reading only the first is what made the
     * consolidated notice never appear on a cold restart into a project whose root had been renamed
     * away:
     *
     *   - restoring a persisted panel takes the `getContent` branch, which adopts the authority's
     *     `fileMissing` — still FALSE, because nothing has read the disk yet — and returns without
     *     ever attempting a load of its own;
     *   - it then asks for a verification, and the verdict comes back on the sync channel as
     *     `unloadable: true`, which sets the banner the user can see;
     *   - `fileMissing` is never written by that path, so it stays false forever, and this scan
     *     skipped every panel. Measured with a probe: two panels, both `hasState: true`, both
     *     `unloadable: true`, both `fileMissing: false`, nothing reported.
     *
     * So the user saw two per-panel banners and the file tree's notice, and the consolidated notice
     * that FR-034a requires to supersede the tree's was never raised at all.
     */
    const defeated = (id: string): boolean => {
      const st = getEditorState(id);
      return !!st?.fileMissing || !!st?.unloadable;
    };

    const timer = setTimeout(() => {
      /*
       * ══ #369 — A PANEL THAT HAS NOT ANSWERED IS NOT A PANEL THAT IS FINE ══
       *
       * Both flags are false in two entirely different situations: the file is there, and the open
       * has not come back yet. This scan used to read them as one, so a panel still opening at the
       * sample point was dropped FOREVER — the effect re-arms only on a tab change or a settings
       * change, and nothing ever asked again.
       *
       * That made 300 ms a verdict deadline tuned on one machine's speed. On a slower one, two
       * editors restored into a project whose root had been renamed away were both still inside
       * their initial `load()` when it fired: the user got a banner in each panel and the file
       * tree's own notice, and the consolidated notice FR-034a requires to supersede the tree's was
       * never raised. Measured on the self-hosted gate runner, three attempts out of three.
       *
       * So the ones still opening are WAITED FOR BY NAME, and reported the moment they answer. The
       * wait ends on an answer rather than on a duration, which leaves no constant to be wrong on
       * the next machine.
       */
      const pending = new Set<string>();
      const byId = new Map<string, Casualty>(panels.map((p) => [p.id, p]));

      for (const p of panels) {
        if (getEditorState(p.id)?.openPending) pending.add(p.id);
        else if (defeated(p.id)) raise(p);
      }
      if (pending.size === 0) return;

      /*
       * FR-105 IS NOT REOPENED BY THIS, and the membership of `pending` is the reason.
       *
       * Only panels that were STILL OPENING when the scan sampled are watched, and each leaves the
       * set the moment it answers. A file deleted under a tab the user is already looking at belongs
       * to a panel that answered long ago, so nothing here ever sees it — which is the rule this
       * component exists for, and the test file pins it from both directions.
       */
      unwatch = subscribeEditorStates(() => {
        for (const id of [...pending]) {
          if (getEditorState(id)?.openPending) continue;
          pending.delete(id);
          const p = byId.get(id);
          if (p && defeated(id)) raise(p);
        }
        if (pending.size === 0) {
          unwatch?.();
          unwatch = undefined;
        }
      });
    }, SCAN_DELAY_MS);

    return () => {
      clearTimeout(timer);
      // The ACTIVATION owns the watch. Clicking away before a slow panel answers must not report it
      // into a notice about a tab the user has left.
      unwatch?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, warn]);

  return null;
}
