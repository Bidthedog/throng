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
  type FailureKind,
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
  /** 029's classification, where the reporter has one already built (the terminal path). */
  cause?: FailureCause | null;
  /**
   * The KIND alone, for a reporter that knows what went wrong but not what to call it (FR-029).
   *
   * ══ WHY A KIND AND NOT A CAUSE ══
   *
   * A `causeKey` is `kind:subject`, and the subject has to be the one this notice is ABOUT — the
   * project — or the key cannot match the surface-level notice it must supersede. The reporters do
   * not know the project's name; this hook already resolves it for the heading. So they say the kind
   * and the subject is supplied below, which makes "a notice's cause is about the notice's own
   * subject" true by construction rather than by every call site remembering.
   *
   * That invariant was broken, and a user found it: the editor's missing-file scan reported with no
   * cause at all — this type said "absent is the common case for editors" — so the consolidated
   * notice carried no key, could supersede nothing, and renaming a project's root produced TWO
   * notices for one absent folder. The terminal path passed a cause, which is why the E2E asserting
   * the rule passed throughout.
   */
  causeKind?: FailureKind;
}

/**
 * The last segment of a path, either separator.
 *
 * Hand-rolled rather than `node:path`: this is renderer code, and the separator is whichever the
 * stored root folder was written with. It mirrors `files-service.ts#subjectOf`, which is what the
 * key produced here has to agree with — a trailing separator yields the segment before it, so a root
 * stored as `D:\work\test 1\` keys the same as `D:\work\test 1`.
 */
function folderName(absPath: string): string {
  const parts = absPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
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
/**
 * 041 FR-014 (#327) — a refusal that never had a panel, and could not report through the one above.
 *
 * ══ THE TRAP THIS EXISTS TO AVOID ══
 *
 * `useReportPanelFailure` opens with `const place = locate(...); if (!place) return;`. That guard is
 * CORRECT and stays: a panel destroyed between the failure and the render that reports it must not
 * get an invented row (030 FR-027).
 *
 * But FR-013 stops creating a panel for a refused open — so a refusal routed through that hook takes
 * the early return and the user is told NOTHING. "No panel is created" would silently become "no
 * panel and no notification", which is worse than the defect being fixed and would look, from every
 * test that only counts panels, exactly like success.
 *
 * So a refusal reports through here instead. Same notice, same consolidation, same project heading —
 * the row simply carries a SUBJECT rather than a panel, which is what `AffectedSubject` is for.
 */
export interface SubjectFailureReport {
  /** What the open was attempted on — half the casualty's identity (FR-007). */
  subject: string;
  /** Why it was refused — the other half. One of `NOT_A_MISSING_FILE`. */
  reason: string;
  /** What the user should read. Already spoken — never a raw errno (FR-034). */
  message: string;
  /** The path RENDERED on the row, relative to the project root (FR-018). */
  displayPath: string;
  /** The absolute path and any raw error. Copy and the log only (FR-018c). */
  detail?: string;
  /** Which project the notice is about, so the heading names the right one (030 FR-031). */
  projectId?: string;
}

/**
 * Report an open that was refused before any panel existed.
 *
 * Deliberately a sibling of {@link useReportPanelFailure} rather than a branch inside it: the two
 * differ in what they can locate, not in what they mean, and folding them together would put the
 * `locate` guard back on a path that must never take it.
 */
export function useReportSubjectFailure(): (report: SubjectFailureReport) => void {
  const { notify } = useNotify();
  const { layout } = useWorkspace();
  const { projects } = useProjects();
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  return useCallback(
    (report: SubjectFailureReport) => {
      const projectId = report.projectId ?? layoutRef.current?.projectId;
      const projectName = projectsRef.current.find((p) => p.id === projectId)?.name;

      notify({
        severity: 'error',
        subject: projectName ? { kind: 'project', name: projectName } : { kind: 'none' },
        action: 'open',
        message: report.message,
        testId: PANEL_FAILURE_TEST_ID,
        groupKey: operationGroupKey(projectId),
        affected: [
          {
            subject: report.subject,
            reason: report.reason,
            displayPath: report.displayPath,
            ...(report.detail ? { detail: report.detail } : {}),
          },
        ],
      });
    },
    [notify],
  );
}

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

      /*
       * The cause, keyed to THE FOLDER THAT WENT MISSING — not to this notice's own subject.
       *
       * A supplied cause wins: the terminal path has already classified the failure and knows more
       * than a kind. Otherwise the kind is paired with the project's ROOT FOLDER NAME, because that
       * is what the other half of the pair keys on. Main classifies a filesystem failure against
       * `subjectOf(raw)` — the last segment of the first path the errno quotes (`files-service.ts`)
       * — so the file tree's report of an absent root carries `path-missing:<folder>`.
       *
       * The project's NAME is the obvious-looking choice and is wrong: a project may be called
       * anything, and keying on it matches only when the two happen to coincide. They did in the
       * session that reported this — a project named "test 1" in a folder named "test 1" — which is
       * exactly the kind of coincidence that ships a fix working for one case.
       *
       * The notice's own subject stays the project (the heading names what the user chose to call
       * it); the CAUSE is about the thing that disappeared.
       */
      const rootName = folderName(
        projectsRef.current.find((p) => p.id === projectId)?.rootFolder ?? '',
      );
      const cause: FailureCause | undefined =
        report.cause ??
        (report.causeKind && rootName
          ? { kind: report.causeKind, subject: rootName, raw: report.detail ?? '' }
          : undefined);

      notify({
        severity: 'error',
        subject,
        // The heading composes to `Couldn't open <Project>` — what was attempted, on what.
        action: 'open',
        message: report.message,
        testId: PANEL_FAILURE_TEST_ID,
        ...(cause ? { causeKey: causeKey(cause) } : {}),
        groupKey: operationGroupKey(projectId),
        affected: [affected],
      });
    },
    [notify],
  );
}
