/**
 * 074 FR-018 — "Open <files> in: Default OS Program": hand a file to the operating system's default program
 * through the route File Explorer's Open in OS Default Program and a followed link already take (067 FR-018,
 * FR-131), with the same one notice when the OS refuses it.
 *
 * A hook, because the notice needs the window's project list and its failure-notice context; the open router
 * receives the function it returns as `OpenRoute.openInOs`, so the router itself names no link module.
 */
import { useCallback, useRef } from 'react';
import { useProjects } from '../state/projects-store.js';
import { useReportSubjectFailure } from '../workspace/panel-failure-notice.js';
import { linkFailureReport, osLinkActions } from './link-actions.js';

/**
 * The event a surface without the notice context (Quick Open) raises to have the window's `EditorOpenListener`
 * open a file in the OS for it, through {@link useOpenInOs}.
 */
export const OPEN_IN_OS_EVENT = 'throng:open-path-in-os';

export interface OpenInOsDetail {
  absPath: string;
  projectId?: string;
}

/** Raise {@link OPEN_IN_OS_EVENT}. Resolves at once: the listener reports its own failure. */
export function requestOpenInOs(absPath: string, projectId?: string): Promise<void> {
  const detail: OpenInOsDetail = { absPath, ...(projectId ? { projectId } : {}) };
  window.dispatchEvent(new CustomEvent(OPEN_IN_OS_EVENT, { detail }));
  return Promise.resolve();
}

/**
 * #720 — the asker named when the caller has no panel (Quick Open, the open router's Default OS Program). Main's
 * link gate refuses a request with no panel id (`link-ipc.ts`, I2), so an empty one would have the OS open
 * nothing; the id only identifies who asked, and carries no authority (core `LinkResolutionRequest.panelId`).
 */
export const OPEN_IN_OS_ASKER = 'open-in-os';

/** `(absPath, projectId?, panelId?) => Promise<void>`; stable across renders. */
export function useOpenInOs(): (absPath: string, projectId?: string, panelId?: string) => Promise<void> {
  const reportSubject = useReportSubjectFailure();
  const { projects } = useProjects();
  const latest = useRef({ reportSubject, projects });
  latest.current = { reportSubject, projects };
  return useCallback(async (absPath, projectId, panelId) => {
    const outcome = await osLinkActions().openInOsDefaultProgram({
      text: absPath,
      kind: 'detectedPath',
      // Identifies the asker only; it carries no authority (core `LinkResolutionRequest.panelId`).
      panelId: panelId || OPEN_IN_OS_ASKER,
      ...(projectId ? { originProjectId: projectId } : {}),
    });
    if (outcome.ok) return;
    const { reportSubject: report, projects: list } = latest.current;
    const projectRoot = list.find((p) => p.id === projectId)?.rootFolder ?? null;
    report(
      linkFailureReport(outcome, {
        projectRoot,
        osName: window.throng?.osName ?? 'windows',
        ...(projectId ? { projectId } : {}),
      }),
    );
  }, []);
}
