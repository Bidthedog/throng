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
import { useServicesOptional } from '../composition-root.js';
import { useProjectsOptional } from '../state/projects-store.js';
import { useWorkspaceOptional } from '../state/workspace-store.js';
import { requestPanelDestroy } from '../workspace/panel-destroy.js';
import { requestTabDestroy } from '../workspace/tab-destroy.js';
import { createEstimatesReporter, type EstimatesReporter } from './estimates-reporter.js';
import { buildWorkspaceContext, collectRendererEstimates, loadOtherLayouts, type WorkspaceFacts } from './estimates-sources.js';
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
  useEffect(() => {
    reporter.current?.contextChanged();
  }, [layout]);
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
      if (req.action === 'destroyTab') requestTabDestroy(req.id);
      else requestPanelDestroy(req.id);
    });
  }, []);
}

/** Renders nothing; mounts the reporter, and the action route, for this window. */
export function EstimatesReporterMount({ subWorkspaceName = null }: { subWorkspaceName?: string | null }): ReactElement | null {
  useEstimatesReporter(subWorkspaceName);
  useResourceActionRoute();
  return null;
}
