/**
 * 030 US3 (FR-029/FR-030/FR-031) — THE ONE PLACE A PANEL CASUALTY IS REPORTED.
 *
 * A panel that a wider failure has defeated — an editor whose file went with its project root, a
 * terminal whose working directory is no longer there — reports through here and nowhere else.
 * Every such report becomes one row of one notice per project, and the merging is the notification
 * model's (`notification.tsx`); what this owns is the three facts a row needs and the raise site
 * does not have to hand:
 *
 *   • WHERE the panel is — its tab, and the ORDER of both (FR-031a). Tab order is the index in
 *     `layout.tabs` and panel order is the depth-first position in the split tree, which is the
 *     order the panels are drawn in. A list ordered by whichever panel failed first would read
 *     differently on every run, because the failures race.
 *   • WHICH PROJECT — from the panel's `originProjectId`, never the window's active project. A
 *     sub-workspace window may hold panels from several at once (INV-5), and naming the wrong one
 *     is the ambiguity #195 is about.
 *   • WHAT ACTION it belongs to — `operation.ts`, which is what makes editors and terminals defeated
 *     by one absent folder land in one list rather than one list each.
 *
 * The RAW error never becomes the message (029 FR-016/FR-018a, 030 FR-034). It rides on the row as
 * `detail`, which is copied and logged and never rendered — a consolidated notice assembled by
 * pasting each casualty's errno together would undo 029 in a single commit.
 */
import { useCallback, useRef } from 'react';
import {
  causeKey,
  collectPanels,
  type AffectedPanel,
  type FailureCause,
  type LayoutNode,
  type NoticeSubject,
  type WorkspaceLayout,
} from '@throng/core';

import { useNotify } from '../common/notification.js';
import { useProjects } from '../state/projects-store.js';
import { useWorkspace } from '../state/workspace-store.js';
import { operationGroupKey } from './operation.js';

/** The test id every consolidated notice carries — one surface, one identifier. */
export const PANEL_FAILURE_TEST_ID = 'panel-failure-notice';

export interface PanelFailureReport {
  panelId: string;
  /** What the user should read. Already spoken — never a raw errno (FR-034). */
  message: string;
  /** The raw system error, for Copy and the log only. */
  detail?: string;
  /** 029's classification, where the reporter has one. Absent is the common case for editors. */
  cause?: FailureCause | null;
}

interface Place {
  panel: { id: string; title: string; originProjectId?: string };
  tabId: string;
  tabName: string;
  tabOrder: number;
  panelOrder: number;
}

/**
 * Find a panel and its position, or `undefined` when it is not in this window's layout.
 *
 * `undefined` is a real answer the caller must handle: a panel can be destroyed between the failure
 * and the render that reports it, and inventing a place for one that no longer exists would be the
 * placeholder FR-027 forbids.
 */
function locate(layout: WorkspaceLayout | null | undefined, panelId: string): Place | undefined {
  if (!layout) return undefined;
  for (const [tabOrder, tab] of layout.tabs.entries()) {
    const panels = collectPanels(tab.root as LayoutNode);
    const panelOrder = panels.findIndex((p) => p.id === panelId);
    if (panelOrder < 0) continue;
    return {
      panel: panels[panelOrder]!,
      tabId: tab.id,
      tabName: tab.title,
      tabOrder,
      panelOrder,
    };
  }
  return undefined;
}

/**
 * Report a panel defeated by something wider than itself.
 *
 * Returns a stable callback, so a caller may hold it in a ref and call it from a timer or an IPC
 * handler without re-arming anything. The layout and the project list are read through refs for the
 * same reason: this must not re-raise every time a panel is dragged.
 */
export function useReportPanelFailure(): (report: PanelFailureReport) => void {
  const { notify } = useNotify();
  const { layout } = useWorkspace();
  const { projects } = useProjects();
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  return useCallback(
    (report: PanelFailureReport) => {
      const place = locate(layoutRef.current, report.panelId);
      if (!place) return;
      const projectId = place.panel.originProjectId ?? layoutRef.current?.projectId;
      const projectName = projectsRef.current.find((p) => p.id === projectId)?.name;

      const affected: AffectedPanel = {
        panelId: place.panel.id,
        panelName: place.panel.title,
        tabId: place.tabId,
        tabName: place.tabName,
        tabOrder: place.tabOrder,
        panelOrder: place.panelOrder,
        ...(report.detail ? { detail: report.detail } : {}),
      };

      /*
       * FR-031 — the PROJECT is the subject, named once in the heading and never on a row.
       *
       * The notice is not about any one panel; it is about the thing that broke them all, and the
       * panels are the list. A subject naming the first casualty would make the heading depend on
       * which failure won a race, and every later row would read as an afterthought.
       */
      const subject: NoticeSubject = projectName
        ? { kind: 'project', name: projectName }
        : { kind: 'none' };

      notify({
        severity: 'error',
        subject,
        // The heading composes to `Couldn't open <Project>` — what was attempted, on what.
        action: 'open',
        message: report.message,
        testId: PANEL_FAILURE_TEST_ID,
        ...(report.cause ? { causeKey: causeKey(report.cause) } : {}),
        groupKey: operationGroupKey(projectId),
        affected: [affected],
      });
    },
    [notify],
  );
}
