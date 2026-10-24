/**
 * Runs the estimates reporter in a window for as long as SOME window holds a detail subscription (055
 * R7): main broadcasts that demand to every window (`detailDemand` / `onDetailDemand`), because a
 * sub-workspace's renderer cannot otherwise know the main window's monitor is open. With no demand the
 * reporter neither reads nor sends.
 *
 * Mounted once per window by `<EstimatesReporterMount />`: the main window's `app.tsx` and the
 * sub-workspace's `subworkspace-app.tsx`.
 */
import { useEffect, useRef, type ReactElement } from 'react';
import type { WorkspaceLayout } from '@throng/core';
import { requestAttentionNavigation, requestPlaceNavigation } from '../attention/attention-navigation.js';
import { useServicesOptional } from '../composition-root.js';
import { useProjectsOptional } from '../state/projects-store.js';
import { useWorkspaceOptional } from '../state/workspace-store.js';
import { useUnloadProject } from '../sidebar/use-unload-project.js';
import { useEditorStateVersion } from '../editor/editor-state.js';
import { useTerminalCommandVersion } from '../terminal/command-store.js';
import { useTerminalCwdVersion } from '../terminal/cwd-store.js';
import { useTerminalTitleContextVersion } from '../terminal/title-context.js';
import { useTerminalTitleVersion } from '../terminal/title-store.js';
import { requestPanelDestroy } from '../workspace/panel-destroy.js';
import { requestTabDestroy } from '../workspace/tab-destroy.js';
import { createEstimatesReporter, type EstimatesReporter } from './estimates-reporter.js';
import { buildWorkspaceContext, collectRendererEstimates, loadOtherLayouts, type WorkspaceFacts } from './estimates-sources.js';
import { getStatusItemRect } from './monitor-store.js';
import { useResourceMonitorSettings } from './use-monitor-settings.js';

export function useEstimatesReporter(subWorkspaceName: string | null): void {
  const workspace = useWorkspaceOptional();
  const projects = useProjectsOptional();
  const { intervalSeconds } = useResourceMonitorSettings();

  const services = useServicesOptional();
  // The other projects' saved layouts (T092): read from the daemon while the monitor is open, kept here
  // between reports. Only the main window reads them; a sub-workspace window reports its own tabs alone.
  const others = useRef<ReadonlyMap<string, WorkspaceLayout>>(new Map());
  // What the reporter reads is always the latest, without the reporter being rebuilt around it.
  const facts = useRef<WorkspaceFacts | null>(null);
  facts.current = {
    projects: projects?.projects ?? [],
    activeProjectId: projects?.activeProject?.id ?? null,
    loadedIds: projects?.loadedIds ?? new Set(),
    layout: workspace?.layout ?? null,
    subWorkspaceName,
    otherLayouts: others.current,
  };
  const reporter = useRef<EstimatesReporter | null>(null);
  const demand = useRef(false);
  /** Re-read the other projects' layouts, then report the context again if it changed. */
  const refreshOthers = useRef<() => void>(() => undefined);
  refreshOthers.current = () => {
    const f = facts.current;
    if (subWorkspaceName !== null || services === null || f === null) return;
    const ids = f.projects.map((p) => p.id).filter((id) => id !== f.activeProjectId);
    void loadOtherLayouts(ids, (id) => services.workspace.load(id)).then((layouts) => {
      if (!demand.current) return;
      others.current = layouts;
      reporter.current?.contextChanged();
    });
  };
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const interval = useRef(intervalSeconds);
  interval.current = intervalSeconds;

  useEffect(() => {
    const api = window.throng?.resources;
    if (!api?.onDetailDemand) return;
    const r = createEstimatesReporter({
      reportPanels: api.reportPanels,
      readContext: () => buildWorkspaceContext(facts.current as WorkspaceFacts),
      readEstimates: () => collectRendererEstimates(facts.current?.layout ?? null),
    });
    reporter.current = r;

    const apply = (on: boolean): void => {
      demand.current = on;
      r.setSubscribed(on);
      if (on) refreshOthers.current();
      else others.current = new Map();
      if (timer.current !== null) clearInterval(timer.current);
      timer.current = on ? setInterval(() => r.tick(), interval.current * 1000) : null;
    };
    let cancelled = false;
    const off = api.onDetailDemand(apply);
    void api.detailDemand().then((on) => {
      if (!cancelled && on !== demand.current) apply(on);
    });
    return () => {
      cancelled = true;
      off();
      if (timer.current !== null) clearInterval(timer.current);
      timer.current = null;
      r.setSubscribed(false);
      reporter.current = null;
      demand.current = false;
    };
  }, []);

  // A changed capture interval re-times a running report.
  useEffect(() => {
    if (!demand.current || reporter.current === null) return;
    if (timer.current !== null) clearInterval(timer.current);
    const r = reporter.current;
    timer.current = setInterval(() => r.tick(), intervalSeconds * 1000);
  }, [intervalSeconds]);

  // The tabs, panels or projects changed: report the context if it differs from what main holds.
  const layout = workspace?.layout;
  const projectList = projects?.projects;
  const loaded = projects?.loadedIds;
  const active = projects?.activeProject?.id;
  useEffect(() => {
    reporter.current?.contextChanged();
    // Another project became the active one, or one was loaded or unloaded: the layouts of the rest moved.
    if (demand.current) refreshOthers.current();
  }, [projectList, loaded, active]);
  // A panel's name is the one its header shows (D2): its live title, command, working folder, an editor's
  // file. Any of those changing re-reports — the reporter itself drops a context that did not change.
  const titles = useTerminalTitleVersion();
  const commands = useTerminalCommandVersion();
  const cwds = useTerminalCwdVersion();
  const titleContext = useTerminalTitleContextVersion();
  const editors = useEditorStateVersion();
  useEffect(() => {
    reporter.current?.contextChanged();
  }, [layout, titles, commands, cwds, titleContext, editors]);
}

/**
 * A destroy the Resource Monitor asked for on a tab or panel THIS window holds (055 FR-063, T076): main
 * routes it here because the monitor's own window does not have the tab. It runs this window's own flow,
 * so this window's confirmations apply. An id this window does not hold is ignored — main picked the
 * window by what it reported, which can be a moment stale.
 */
export function useResourceActionRoute(): void {
  useEffect(() => {
    return window.throng?.resources?.onAction?.((req) => {
      // Unload Project is the main window's alone (`UnloadRouteMount`); it is not a panel.
      if (req.action === 'destroyTab') requestTabDestroy(req.id);
      else if (req.action === 'destroyPanel') requestPanelDestroy(req.id);
      // FR-110 — Activate: a panel is gone to as a toast's link goes to one (project, tab, the panel
      // focused); a tab or a project switches project first, then selects. Main brought this window forward.
      else if (req.action === 'activate') {
        const going =
          req.panelId !== undefined
            ? requestAttentionNavigation({ projectId: req.projectId, panelId: req.panelId })
            : requestPlaceNavigation({ projectId: req.projectId, ...(req.tabId !== undefined ? { tabId: req.tabId } : {}) });
        // Main holds the monitor's route open for this answer: a navigation that fails here becomes the
        // monitor's one notice, "Couldn't go to …" (FR-086), rather than nothing at all.
        const { requestId } = req;
        void going.then(
          (ok) => {
            if (requestId !== undefined) window.throng?.resources?.answerAction?.(requestId, ok);
          },
          () => {
            if (requestId !== undefined) window.throng?.resources?.answerAction?.(requestId, false);
          },
        );
      }
    });
  }, []);
}

/**
 * Where the monitor window should shrink to when it is minimised (055 FR-085): main asks every window
 * for the status-bar figures' rectangle. The main window has them; a window without a status bar item
 * (a sub-workspace) answers `null`, and main closes the monitor at once.
 */
export function useStatusRectAnswer(): void {
  useEffect(() => window.throng?.resources?.onStatusRectRequest?.(getStatusItemRect), []);
}

/**
 * An Unload Project the monitor window asked for (055 FR-086): main always delivers it to the main
 * window, which runs the shared unload command with the same variant and the same no-dialog behaviour as
 * the project list's own row. Mounted by the main window only — a sub-workspace holds no projects.
 */
export function UnloadRouteMount(): ReactElement | null {
  const unload = useUnloadProject();
  // The latest closure behind one subscription: the command reads dirty editors and sub-workspaces.
  const latest = useRef(unload);
  latest.current = unload;
  useEffect(() => {
    return window.throng?.resources?.onAction?.((req) => {
      if (req.action === 'unloadProject') latest.current({ id: req.id, name: req.name }, req.variant);
    });
  }, []);
  return null;
}

/** Renders nothing; mounts the reporter, the action route and the status-rect answer for this window. */
export function EstimatesReporterMount({ subWorkspaceName = null }: { subWorkspaceName?: string | null }): ReactElement | null {
  useEstimatesReporter(subWorkspaceName);
  useResourceActionRoute();
  useStatusRectAnswer();
  return null;
}
