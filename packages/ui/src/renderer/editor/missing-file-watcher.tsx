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
import { collectPanels, EDITOR_KIND, type Panel } from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';
import { useAppSettings } from '../config/config-store.js';
import { useReportPanelFailure } from '../workspace/panel-failure-notice.js';
import { getEditorState, subscribeEditorStates } from './editor-state.js';
import { isMissingReason, missingFileDetail, missingFileMessage } from './editor-missing-notice.js';
import { isPanelHidden, subscribeMaximise } from '../workspace/maximise-store.js';

const SCAN_DELAY_MS = 300; // let the tab's editors mount + publish their load state

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
    // 050 FR-035 — a panel a move took out of its project holds no file this scan could report: the moved
    // notice is its one notice, and the file is no longer its to find missing.
    const panels = collectPanels(tab.root).filter(
      (p) => p.kind === EDITOR_KIND && (p.config as { movedOut?: boolean } | undefined)?.movedOut !== true,
    );

    /** Torn down with the activation, so a tab change never leaves a watch behind (see below). */
    let unwatch: (() => void) | undefined;
    /** The Focus Mode subscription holding hidden casualties (081 FR-012a), torn down with the activation too. */
    let unwatchHidden: (() => void) | undefined;

    const timer = setTimeout(() => {
      const os = window.throng?.osName ?? 'windows';

      const report = (
        p: Panel,
        st: NonNullable<ReturnType<typeof getEditorState>>,
      ): void => {
        /*
         * DEFEATED BY THE PATH — on either of the two flags that can say so (#277).
         *
         * `fileMissing` is set by a view that ATTEMPTED A LOAD and was refused. `unloadable` is the
         * AUTHORITY's verdict on the path, broadcast to every view of the document. They are
         * deliberately distinct (see `EditorUiState`), and reading only the first is what made the
         * consolidated notice never appear on a cold restart into a project whose root had been
         * renamed away:
         *
         *   - restoring a persisted panel takes the `getContent` branch, which adopts the
         *     authority's `fileMissing` — still FALSE, because nothing has read the disk yet — and
         *     returns without ever attempting a load of its own;
         *   - it then asks for a verification, and the verdict comes back on the sync channel as
         *     `unloadable: true`, which sets the banner the user can see;
         *   - `fileMissing` is never written by that path, so it stays false forever, and this scan
         *     skipped every panel. Measured with a probe: two panels, both `hasState: true`, both
         *     `unloadable: true`, both `fileMissing: false`, nothing reported.
         *
         * So the user saw two per-panel banners and the file tree's notice, and the consolidated
         * notice that FR-034a requires to supersede the tree's — the one naming which panels the
         * absent folder defeated — was never raised at all.
         *
         * This does NOT weaken FR-105. That rule is about not warning from an editor's own mount
         * effect; the guard enforcing it is this effect's once-per-activation gate above, which is
         * untouched.
         *
         * 081 FR-010 / FR-011 (#728) — the REASON the read returned, not `missing` for every unreadable path. A
         * folder, a file too large or a file outside the project is there, and calling it missing sent the user
         * looking for something sitting where they left it. A panel whose read nobody in this window saw (the
         * authority's verdict alone carries no reason) keeps the missing wording, as the cold-restart case above
         * needs.
         */
        const reason = st.unloadableReason ?? 'missing';
        reportRef.current({
          panelId: p.id,
          message: missingFileMessage(reason),
          // The path rides as the row's own detail — copied and logged, never rendered (FR-034).
          detail: missingFileDetail({ filePath: st.filePath, reason }, os),
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
           *
           * Only for a path that is not there (081 FR-011): a folder carrying `path-missing` superseded the File
           * Explorer's report as an absent folder would.
           */
          ...(isMissingReason(reason) ? { causeKind: 'path-missing' as const } : {}),
        });
      };

      /*
       * 081 FR-012 / FR-012a (#728) — a notice names only a panel the user can find and open.
       *
       * A Back/Forward stand-in is skipped: the banner is that condition's one surface (044 FR-106d), and the path
       * is one the user only stepped through. A panel Focus Mode hides is held until it is shown, then reported
       * once, if its file still cannot be opened by then (Q3).
       */
      const hidden = new Map<string, Panel>();
      const judge = (p: Panel, st: NonNullable<ReturnType<typeof getEditorState>>): void => {
        if (st.movedOut || st.historyStandIn) return;
        if (!st.fileMissing && !st.unloadable) return;
        if (isPanelHidden(activeTabId, p.id)) hidden.set(p.id, p);
        else report(p, st);
      };
      unwatchHidden = subscribeMaximise(() => {
        for (const [id, p] of [...hidden]) {
          if (isPanelHidden(activeTabId, id)) continue;
          hidden.delete(id);
          const st = getEditorState(id);
          if (st) judge(p, st); // re-read: a file that opened meanwhile, or a closed panel, raises nothing
        }
      });

      /*
       * ══ THE SAMPLE, AND THE PANELS IT CANNOT JUDGE YET (#369) ══
       *
       * A panel is in one of three states, not two, and the third is the one this scan used to get
       * wrong. `fileMissing` and `unloadable` both false means EITHER the file is there OR the open
       * has not answered — and reading those two as one made 300 ms a verdict deadline: a panel
       * whose open answered at 301 ms was not reported late, it was never reported at all, because
       * the effect re-arms only on a tab change or a settings change.
       *
       * On the reference workstation the initial `load()` answers well inside the delay, so the
       * third state is over before the sample and the defect is invisible. On a machine ~2.5x
       * slower it is the NORMAL case: 3/3 on the self-hosted gate runner, where the consolidated
       * notice FR-034a requires never appeared and the user got two per-panel banners and the file
       * tree's report of the same absent folder instead.
       *
       * So the sample partitions rather than filters, and the fix is to publish the third state
       * rather than to lengthen the delay — no constant is left here to be wrong on the next
       * machine.
       *
       * NO STATE AT ALL is the same third state, one step earlier. `use-editor` first publishes after
       * its first IPC round trip, so an editor that has not mounted yet — or has mounted and is still
       * waiting on `getContent` — has no entry in the store. Reading that as "nothing to report" put
       * the deadline back, measured from mount instead of from the load: on hosted macOS a tab visited
       * after its sibling notice was dismissed raised nothing at all (pipeline run 44475351379).
       */
      const pending = new Map<string, Panel>();
      for (const p of panels) {
        const st = getEditorState(p.id);
        if (!st || st.openPending) {
          pending.set(p.id, p);
          continue;
        }
        judge(p, st); // a panel moved out in this session is skipped, whatever its persisted config says yet
      }
      if (pending.size === 0) return;

      /*
       * ══ WAIT ON AN ANSWER, NOT ON A DURATION ══
       *
       * Only the panels that were STILL PENDING WHEN THIS SAMPLED are watched, and each is dropped
       * the moment its open decides — reported if the answer was that the path is defeated, and
       * forgotten otherwise.
       *
       * That membership rule is what keeps FR-105 intact, and it is the whole of it. A panel that
       * had already answered cleanly is not in this set, so a file deleted under a tab the user is
       * already looking at is as silent as it was — which `missing-file-watcher.test.ts:234` pins.
       * The set only ever shrinks, and it is torn down with the activation that built it.
       */
      unwatch = subscribeEditorStates(() => {
        for (const [id, p] of [...pending]) {
          const st = getEditorState(id);
          if (!st || st.openPending) continue; // still undecided — keep waiting
          pending.delete(id);
          judge(p, st);
        }
        if (pending.size === 0) {
          unwatch?.();
          unwatch = undefined;
        }
      });
    }, SCAN_DELAY_MS);
    return () => {
      clearTimeout(timer);
      unwatch?.();
      unwatchHidden?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, warn]);

  return null;
}
